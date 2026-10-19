const Misconception = require("../models/Misconception");

/**
 * Rule-Based Behavior Analysis Engine
 * Analyzes session actions and detects misconceptions
 */
// opts.modelDiagnosis (M5) — when present (treatment-arm session, STUDENT_MODEL_DRIVES_DIAGNOSIS),
// the Bayesian misconception posterior REPLACES the rule-derived list below; everything downstream
// (strengths, struggle analysis, understanding, the LLM feedback) then reflects the model's view.
// Absent ⇒ nothing changes (shadow / control / flags off).
const analyzeSession = async (session, actions, opts = {}) => {
  let misconceptionsDetected = [];
  const strengths = [];
  const suggestions = [];

  const features = session.behaviorFeatures;
  const { generatePersonalizedFeedback } = require("./feedbackService");

  // ── Rule 1: High error rate → procedural confusion ──────────────────────
  if (features.errorRate > 0.4) {
    misconceptionsDetected.push({
      code: "PROC_001",
      description: "High error rate suggests procedural confusion — steps performed in wrong order or with wrong action.",
      relatedStep: null,
      correctionStrategy: "Review the experiment procedure carefully before starting each step.",
    });
  }

  // ── Rule 2: Many hints requested → knowledge gaps ────────────────────────
  if (features.totalHintsRequested >= 3) {
    suggestions.push("You needed several hints. Review the related concepts before trying again.");
  }

  // ── Rule 3: Fast steps (< 10s) → rushed / not reading ────────────────────
  if (features.fastSteps >= 2) {
    misconceptionsDetected.push({
      code: "PROC_002",
      description: "Several steps were completed very quickly, suggesting instructions may not have been read carefully.",
      relatedStep: null,
      correctionStrategy: "Read each step instruction fully before performing the action.",
    });
  }

  // ── Rule 4: Specific step errors — map to misconception KB ───────────────
  const incorrectActions = actions.filter((a) => a.actionType === "incorrect" && a.conceptViolated);
  const uniqueViolations = [...new Set(incorrectActions.map((a) => a.conceptViolated))];

  const conceptsToImprove = new Set();
  for (const code of uniqueViolations) {
    const misconception = await Misconception.findOne({ code }).lean();
    if (misconception) {
      const relatedAction = incorrectActions.find((a) => a.conceptViolated === code);
      misconceptionsDetected.push({
        code: misconception.code,
        description: misconception.description,
        relatedStep: relatedAction?.stepId || null,
        correctionStrategy: misconception.correctionStrategy,
      });
      (misconception.relatedConcepts || []).forEach((name) => conceptsToImprove.add(name));
    }
  }

  // ── Rule 4b: Struggled Compound Builder attempts → map to misconception KB ──
  // Mirrors Rule 4, but keyed off session.builtCompounds.lastMisconceptionCode (set by
  // submitCompoundBuild's classifyCompoundBuildMistake) instead of Action.conceptViolated,
  // since compound-build attempts aren't recorded as Action documents.
  const struggledBuilds = (session.builtCompounds || []).filter((b) => b.attempts >= 2 && b.lastMisconceptionCode);
  const uniqueBuildViolations = [...new Set(struggledBuilds.map((b) => b.lastMisconceptionCode))];
  for (const code of uniqueBuildViolations) {
    const misconception = await Misconception.findOne({ code }).lean();
    if (misconception) {
      misconceptionsDetected.push({
        code: misconception.code,
        description: misconception.description,
        relatedStep: null,
        correctionStrategy: misconception.correctionStrategy,
      });
      (misconception.relatedConcepts || []).forEach((name) => conceptsToImprove.add(name));
    }
  }

  // ── Rule 5: Struggled steps → targeted suggestion ────────────────────────
  if (features.struggledSteps.length > 0) {
    suggestions.push(`You struggled with step(s) ${features.struggledSteps.join(", ")}. Try repeating those steps.`);
  }

  // ── Rule 6: Strengths detection ─────────────────────────────────────────
  if (features.errorRate < 0.15) strengths.push("Excellent accuracy — very few mistakes made.");
  if (features.totalHintsRequested === 0) strengths.push("Great independent thinking — no hints needed!");
  if (session.score >= 80) strengths.push("Strong overall performance on this experiment.");
  if (features.totalRetries === 0) strengths.push("You completed all steps correctly on the first attempt.");

  // ── M5: model-driven diagnosis swap ────────────────────────────────────
  const ruleMisconceptionCodes = misconceptionsDetected.map((m) => m.code).filter(Boolean);
  if (Array.isArray(opts.modelDiagnosis) && opts.modelDiagnosis.length) {
    misconceptionsDetected = opts.modelDiagnosis.map((d) => ({
      code: d.code,
      description: d.description,
      relatedStep: d.relatedStep ?? null,
      correctionStrategy: d.correctionStrategy,
    }));
    conceptsToImprove.clear();
    for (const d of opts.modelDiagnosis) for (const c of d.relatedConcepts || []) conceptsToImprove.add(c);
  }

  // ── Deterministic performance context (Phase 2 analytics) ───────────────
  // Everything below is verified/pre-computed — this is exactly what the personalized-feedback
  // LLM is handed (spec §18/§22: the model rephrases, it never derives numbers or rankings).
  const { buildReportAnalytics, formatDuration } = require("./reportAnalyticsService");
  const { practicalCurriculumReference } = require("./curriculumReferenceService");
  const experiment = session.experimentId || null;
  const analytics = buildReportAnalytics({
    session,
    experiment,
    actions,
    misconceptions: misconceptionsDetected,
  });

  const grade = experiment?.grades?.[0] || session.userId?.grade || 8;

  const performanceContext = {
    experiment: experiment?.title || "the practical",
    subject: experiment?.subject || null,
    finalScore: session.score,
    performanceScore: session.performanceScore ?? session.score,
    timeScore: session.timeScore ?? null, // null = time was not scored for this practical
    totalActiveTime: formatDuration(session.totalActiveTime || 0),
    totalSessionTime: formatDuration(session.totalTime || 0),
    steps: analytics.stepBreakdown.map((b) => ({
      step: `${b.stepId}. ${b.title}`,
      score: b.score,
      time: formatDuration(b.timeSpentSeconds),
      hints: b.hintsRequested,
      helpUsed: b.helpUsed,
      retries: b.retries,
      equipmentMistakes: b.equipmentMistakes,
      chemicalMistakes: b.chemicalMistakes,
      status: b.status,
    })),
    mostStruggledSteps: analytics.mostStruggledSteps.map((s) => ({ step: s.title, reasons: s.reasons })),
    guidanceSummary: analytics.guidanceSummary,
    proceduralErrors: analytics.proceduralErrors.map(
      (e) => `${e.message} (step ${e.stepId}${e.count > 1 ? `, ${e.count} times` : ""})`
    ),
    misconceptions: misconceptionsDetected.map((m) => ({ concept: m.description, step: m.relatedStep, fix: m.correctionStrategy })),
    detectedStrengths: strengths, // rule-based seeds; the LLM makes them specific
    conceptsToImprove: [...conceptsToImprove],
    understanding: buildFinalUnderstandingAssessment(session.score, misconceptionsDetected),
    curriculumReference: (practicalCurriculumReference(experiment) || {}).displayText || null,
  };

  // ── Personalized, behaviour-aware feedback (structured) ─────────────────
  let personalized;
  try {
    personalized = await generatePersonalizedFeedback({ performanceContext, grade });
  } catch {
    personalized = { summary: buildFallbackSummary(session.score, misconceptionsDetected, strengths), strengths, struggleAnalysis: [], recommendations: [] };
  }

  return {
    summary: personalized.summary,
    misconceptionsDetected,
    // LLM-personalized where available, rule-based seeds otherwise.
    strengths: personalized.strengths && personalized.strengths.length ? personalized.strengths : strengths,
    struggleAnalysis: personalized.struggleAnalysis || [],
    recommendations: personalized.recommendations || [],
    suggestions, // rule-based, kept for back-compat / analytics
    conceptsToImprove: [...conceptsToImprove],
    finalUnderstandingAssessment: performanceContext.understanding,
    feedbackGeneratedAt: new Date(),
    // Not part of the aiFeedback sub-schema (Mongoose drops it on save) — the caller reads it off
    // the return value to store studentModel.shadowRuleMisconceptions for the research comparison.
    _ruleMisconceptions: ruleMisconceptionCodes,
  };
};

/**
 * A short qualitative assessment of the student's conceptual understanding — distinct from
 * the numeric score, which only measures step correctness. Severity-weighted: a single
 * high-severity misconception caps the assessment even with a high score.
 */
const buildFinalUnderstandingAssessment = (score, misconceptionsDetected) => {
  const hasHighSeverityGap = misconceptionsDetected.some((m) => m.code && m.code.startsWith("PROC_") === false);

  if (score >= 80 && misconceptionsDetected.length === 0) {
    return "Advanced understanding — the student applied the underlying concepts correctly and consistently.";
  }
  if (score >= 60 && misconceptionsDetected.length <= 1) {
    return "Developing understanding — the core concept was mostly grasped, with a specific gap worth revisiting.";
  }
  if (hasHighSeverityGap) {
    return "Foundational understanding — one or more core concepts need to be revisited before attempting similar experiments.";
  }
  return "Foundational understanding — procedure was followed inconsistently; focus on reading each step carefully before acting.";
};

const buildFallbackSummary = (score, misconceptions, strengths) => {
  let text = `You scored ${score}%. `;
  if (strengths.length > 0) text += `Well done: ${strengths[0]}. `;
  if (misconceptions.length > 0) {
    text += `Area to improve: ${misconceptions[0].description}. `;
    text += `Tip: ${misconceptions[0].correctionStrategy}`;
  } else {
    text += "Great job — no major misconceptions detected!";
  }
  return text;
};

module.exports = { analyzeSession };
