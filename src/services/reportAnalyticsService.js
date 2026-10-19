// Deterministic post-practical analytics. Turns Session.stepProgress + Action history + the AI
// misconception list into: a per-Main-Step performance breakdown (with its Current Tasks), a
// struggle ranking, a guidance (hint/help) summary, and student-readable procedural errors.
//
// 100% deterministic — no LLM. This is the structured context the Report screen renders AND the
// exact block Phase 3's feedback LLM is handed (it is never asked to derive "which step was
// hardest" from a raw action log).

const scoring = require("./labScoringService");

const sum = (arr, f) => arr.reduce((a, x) => a + (f ? f(x) : x), 0);
const round1 = (n) => Math.round(n * 10) / 10;

// mm:ss / Xm Ys — kept human, matched to how the mobile report shows durations.
const formatDuration = (seconds) => {
  const s = Math.max(0, Math.round(seconds || 0));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m === 0) return `${rem}s`;
  return `${m}m ${String(rem).padStart(2, "0")}s`;
};

// conceptViolated code → one plain sentence. Fallback keeps it generic rather than leaking a code.
const PROCEDURAL_ERROR_MESSAGES = {
  LAB_MISSING_EQUIPMENT: "Tried to work with a piece of equipment before it was on the bench.",
  LAB_MISSING_CHEMICAL: "Tried to carry out the step before the material it needs was added.",
  LAB_TRANSFER_METHOD: "Added the substance directly instead of using the transfer tool this step calls for.",
  CHEM_WRONG_REACTANTS: "Combined substances that don't produce the change this step is looking for.",
  PHY_MEASUREMENT_OUT_OF_TOLERANCE: "Recorded a value outside the acceptable range for this measurement.",
  PHY_CIRCUIT_MISCONFIGURED: "The circuit wasn't connected the way this step needs.",
  PROC_001: "Some steps were done out of order or with the wrong action.",
  PROC_002: "Some steps were completed very quickly — the instructions may not have been read in full.",
};
const friendlyProceduralMessage = (code) =>
  PROCEDURAL_ERROR_MESSAGES[code] || "Performed an action that didn't fit this step.";

// ── Struggle index ───────────────────────────────────────────────────────────────────────────
// Weighted blend of everything that signals difficulty on a step. Higher = harder. Deterministic
// and reusable (Report "Where You Struggled" + Phase 3 LLM context). Raw number isn't shown to the
// student — only the ranking and the plain-language `reasons` are.
const STRUGGLE_WEIGHTS = {
  perHint: 1, // each hint request
  hintLadderTopped: 2, // bonus for climbing to hint level 3 on any task in the step
  helpUsed: 5,
  perRetry: 2, // each incorrect attempt
  perMistake: 1, // each equipment/chemical mistake
  perConceptual: 3, // a misconception mapped to this step
  timeOverrunMax: 6, // capped contribution from spending well over the expected time
};
const STRUGGLE_SURFACE_THRESHOLD = 4; // below this a step isn't called out as "struggled"

const timeOverrunPoints = (actualSeconds, expectedSeconds) => {
  if (!expectedSeconds || expectedSeconds <= 0 || !actualSeconds) return 0;
  const ratio = actualSeconds / expectedSeconds;
  if (ratio <= 1.5) return 0; // matches the "gentle" time score — mild slowness isn't struggle
  return Math.min((ratio - 1.5) * 2, STRUGGLE_WEIGHTS.timeOverrunMax);
};

const calculateStruggleIndex = (row, expectedSeconds) =>
  round1(
    row.hintsRequested * STRUGGLE_WEIGHTS.perHint +
      (row.highestHintLevel >= 3 ? STRUGGLE_WEIGHTS.hintLadderTopped : 0) +
      (row.helpUsed ? STRUGGLE_WEIGHTS.helpUsed : 0) +
      row.retries * STRUGGLE_WEIGHTS.perRetry +
      (row.equipmentMistakes + row.chemicalMistakes) * STRUGGLE_WEIGHTS.perMistake +
      row.conceptualErrorCount * STRUGGLE_WEIGHTS.perConceptual +
      timeOverrunPoints(row.timeSpentSeconds, expectedSeconds)
  );

const struggleReasons = (row, expectedSeconds) => {
  const reasons = [];
  if (row.highestHintLevel >= 3) reasons.push("Used all three hints");
  else if (row.highestHintLevel === 2) reasons.push("Used two hints");
  else if (row.highestHintLevel === 1) reasons.push("Used one hint");
  if (row.helpUsed) reasons.push("Used Help to reveal the answer");
  if (row.retries >= 2) reasons.push(`${row.retries} incorrect attempts`);
  else if (row.retries === 1) reasons.push("One incorrect attempt");
  if (row.equipmentMistakes > 0)
    reasons.push(`${row.equipmentMistakes} equipment ${row.equipmentMistakes === 1 ? "mistake" : "mistakes"}`);
  if (row.chemicalMistakes > 0)
    reasons.push(`${row.chemicalMistakes} material ${row.chemicalMistakes === 1 ? "mistake" : "mistakes"}`);
  if (expectedSeconds && row.timeSpentSeconds / expectedSeconds > 1.5) {
    const mult = Math.round(row.timeSpentSeconds / expectedSeconds);
    reasons.push(`Spent ${formatDuration(row.timeSpentSeconds)} — about ${mult}× the usual time`);
  }
  if (row.conceptualErrorCount > 0) reasons.push("A misconception was detected on this step");
  return reasons;
};

const statusForStep = (row) => {
  if (row.struggleIndex >= 6) return "Challenging";
  if (row.score >= 95) return "Strong";
  if (row.score >= 85) return "Good";
  return "Fair";
};

/**
 * @param {{ session, experiment, actions, misconceptions }} args
 *   session      — the completed Session doc (lean or hydrated)
 *   experiment   — the populated Experiment (may be null; handled)
 *   actions      — every Action for this session (lean)
 *   misconceptions — session.aiFeedback.misconceptionsDetected
 * @returns {{ stepBreakdown, mostStruggledSteps, guidanceSummary, proceduralErrors }}
 */
const buildReportAnalytics = ({ session, experiment, actions = [], misconceptions = [] }) => {
  const steps = (experiment && experiment.steps) || [];
  const stepCount = steps.length || (session.stepProgress || []).length || 1;

  const hintActions = actions.filter((a) => a.actionType === "hint_requested");
  const helpActions = actions.filter((a) => a.actionType === "help_used");
  const incorrectActions = actions.filter((a) => a.actionType === "incorrect");
  const retriesByStep = incorrectActions.reduce((acc, a) => {
    acc[a.stepId] = (acc[a.stepId] || 0) + 1;
    return acc;
  }, {});

  const stepBreakdown = (session.stepProgress || []).map((sp) => {
    const expStep = steps.find((s) => s.stepId === sp.stepId) || null;
    const expMicroSteps = (expStep && expStep.microSteps) || [];
    const migrated = (sp.microSteps || []).length > 0;

    const tasks = (sp.microSteps || []).map((mp) => {
      const expMs = expMicroSteps.find((m) => m.microStepId === mp.microStepId) || null;
      return {
        microStepId: mp.microStepId,
        prompt: (expMs && expMs.studentPrompt) || null,
        timeSpentSeconds: mp.timeSpentSeconds || 0,
        expectedTimeSeconds: mp.expectedTimeSeconds ?? null,
        score: mp.taskScore ?? 100,
        hintsRequested: mp.hintsRequested || 0,
        highestHintLevel: mp.highestHintLevel || 0,
        helpUsed: !!mp.helpUsed,
        hintPenalty: mp.hintPenalty || 0,
        helpPenalty: mp.helpPenalty || 0,
        timeScore: mp.timeScore ?? null,
        equipmentMistakes: mp.equipmentMistakes || 0,
        chemicalMistakes: mp.chemicalMistakes || 0,
      };
    });

    const equipmentMistakes = migrated ? sum(tasks, (t) => t.equipmentMistakes) : sp.equipmentMistakes || 0;
    const chemicalMistakes = migrated ? sum(tasks, (t) => t.chemicalMistakes) : sp.chemicalMistakes || 0;
    const hintsRequested = migrated ? sum(tasks, (t) => t.hintsRequested) : sp.hintsRequested || 0;
    const highestHintLevel = migrated
      ? tasks.reduce((mx, t) => Math.max(mx, t.highestHintLevel), 0)
      : sp.highestHintLevel || 0;
    const helpUsed = migrated ? tasks.some((t) => t.helpUsed) : !!sp.helpUsed;
    const timeSpentSeconds = sp.timeSpentSeconds || sum(tasks, (t) => t.timeSpentSeconds);
    const conceptualErrorCount = (misconceptions || []).filter((m) => m.relatedStep === sp.stepId).length;
    const proceduralErrorCount = incorrectActions.filter(
      (a) => a.stepId === sp.stepId && (!a.conceptViolated || String(a.conceptViolated).startsWith("PROC") || String(a.conceptViolated).startsWith("LAB") || String(a.conceptViolated).startsWith("PHY"))
    ).length;

    // Expected duration for the whole step — sum of its tasks' expected, or derive for an
    // unmigrated step. Used only for the struggle "×N the usual time" signal.
    const expectedStepSeconds = migrated
      ? sum(
          expMicroSteps.map((m) =>
            scoring.expectedTaskSeconds({
              microStep: m,
              step: expStep,
              experiment,
              stepCount,
              stepMicroStepCount: expMicroSteps.length,
            }) || 0
          )
        ) || null
      : scoring.expectedStepSeconds({ step: expStep, experiment, stepCount });

    const row = {
      stepId: sp.stepId,
      title: (expStep && expStep.title) || `Step ${sp.stepId}`,
      timeSpentSeconds,
      expectedTimeSeconds: expectedStepSeconds || null,
      score: sp.stepScore ?? 100,
      timeScore: sp.timeScore ?? null,
      hintsRequested,
      highestHintLevel,
      helpUsed,
      retries: retriesByStep[sp.stepId] || 0,
      equipmentMistakes,
      chemicalMistakes,
      hintPenalty: sp.hintPenalty ?? 0,
      helpPenalty: sp.helpPenalty ?? 0,
      conceptualErrorCount,
      proceduralErrorCount,
      tasks,
    };
    row.struggleIndex = calculateStruggleIndex(row, expectedStepSeconds);
    row.status = statusForStep(row);
    row.reasons = struggleReasons(row, expectedStepSeconds);
    return row;
  });

  const mostStruggledSteps = stepBreakdown
    .filter((b) => b.struggleIndex >= STRUGGLE_SURFACE_THRESHOLD)
    .slice()
    .sort((a, b) => b.struggleIndex - a.struggleIndex)
    .slice(0, 2)
    .map((b) => ({ stepId: b.stepId, title: b.title, struggleIndex: b.struggleIndex, reasons: b.reasons }));

  const guidanceSummary = {
    hint1Count: hintActions.filter((a) => a.hintLevel === 1).length,
    hint2Count: hintActions.filter((a) => a.hintLevel === 2).length,
    hint3Count: hintActions.filter((a) => a.hintLevel === 3).length,
    helpCount: helpActions.length,
    totalDeduction: (session.totalHintPenalty || 0) + (session.totalHelpPenalty || 0),
  };

  // Group incorrect actions by (step, code) → one friendly line each, with a count.
  const byKey = new Map();
  for (const a of incorrectActions) {
    const code = a.conceptViolated || "GENERIC";
    const key = `${a.stepId}:${code}`;
    const entry = byKey.get(key) || {
      stepId: a.stepId,
      stepTitle: (steps.find((s) => s.stepId === a.stepId) || {}).title || `Step ${a.stepId}`,
      message: friendlyProceduralMessage(code),
      count: 0,
    };
    entry.count += 1;
    byKey.set(key, entry);
  }
  const proceduralErrors = [...byKey.values()].sort((a, b) => a.stepId - b.stepId);

  return { stepBreakdown, mostStruggledSteps, guidanceSummary, proceduralErrors };
};

/**
 * Normalized, self-contained student-performance context for the Notes feature (spec §24). The
 * Lab side's ONLY job at handoff — Notes fetches this by sessionId and owns turning it into a
 * revision note. Deliberately contains NO raw Action documents. Everything here is already
 * computed/verified: score components (Phase 1), the deterministic breakdown + struggle ranking
 * (Phase 2), and the LLM-written narrative/strengths/struggleAnalysis/recommendations (Phase 3).
 *
 * @param {{ session, experiment, actions, curriculumReference }} args
 */
const buildLabNoteContext = ({ session, experiment, actions = [], curriculumReference = null }) => {
  const aiFeedback = session.aiFeedback || {};
  const analytics = buildReportAnalytics({
    session,
    experiment,
    actions,
    misconceptions: aiFeedback.misconceptionsDetected || [],
  });

  return {
    source: "lab_practical",
    sessionId: String(session._id),
    experimentId: experiment ? String(experiment._id) : null,
    experimentName: (experiment && experiment.title) || "Practical",
    subject: (experiment && experiment.subject) || null,
    grade: (experiment && experiment.grades && experiment.grades[0]) || null,
    completedAt: session.endTime || session.updatedAt || null,

    finalScore: session.score,
    performanceScore: session.performanceScore ?? session.score,
    timeScore: session.timeScore ?? null,
    totalTimeSeconds: session.totalTime || 0,
    totalActiveTimeSeconds: session.totalActiveTime || 0,

    understanding: aiFeedback.finalUnderstandingAssessment || null,
    summary: aiFeedback.summary || null,
    strengths: Array.isArray(aiFeedback.strengths) ? aiFeedback.strengths : [],
    struggleAnalysis: Array.isArray(aiFeedback.struggleAnalysis) ? aiFeedback.struggleAnalysis : [],
    recommendations: Array.isArray(aiFeedback.recommendations)
      ? aiFeedback.recommendations
      : Array.isArray(aiFeedback.suggestions)
        ? aiFeedback.suggestions
        : [],
    conceptsToImprove: Array.isArray(aiFeedback.conceptsToImprove) ? aiFeedback.conceptsToImprove : [],

    stepPerformance: analytics.stepBreakdown.map((b) => ({
      stepId: b.stepId,
      title: b.title,
      timeSpentSeconds: b.timeSpentSeconds,
      score: b.score,
      hintsUsed: b.hintsRequested,
      helpUsed: b.helpUsed,
      retries: b.retries,
      equipmentMistakes: b.equipmentMistakes,
      chemicalMistakes: b.chemicalMistakes,
      status: b.status,
    })),
    mostStruggledSteps: analytics.mostStruggledSteps.map((s) => ({
      stepId: s.stepId,
      title: s.title,
      reasons: s.reasons,
    })),
    misconceptions: (aiFeedback.misconceptionsDetected || []).map((m) => ({
      code: m.code,
      description: m.description,
      relatedStep: m.relatedStep ?? null,
      correctionStrategy: m.correctionStrategy,
    })),
    proceduralErrors: analytics.proceduralErrors,
    curriculumReference,
  };
};

module.exports = {
  buildReportAnalytics,
  buildLabNoteContext,
  formatDuration,
  calculateStruggleIndex,
  STRUGGLE_SURFACE_THRESHOLD,
};
