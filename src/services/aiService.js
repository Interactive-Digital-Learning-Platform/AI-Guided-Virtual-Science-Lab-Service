const Misconception = require("../models/Misconception");

/**
 * Rule-Based Behavior Analysis Engine
 * Analyzes session actions and detects misconceptions
 */
const analyzeSession = async (session, actions) => {
  const misconceptionsDetected = [];
  const strengths = [];
  const suggestions = [];

  const features = session.behaviorFeatures;
  const { generateFeedback } = require("./feedbackService");

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

  // ── Generate natural language summary via Gemini ────────────────────────
  let summary = "";
  try {
    summary = await generateFeedback({
      experimentTitle: session.experimentId?.title || "the experiment",
      score: session.score,
      misconceptions: misconceptionsDetected,
      strengths,
      grade: session.userId?.grade || 8,
    });
  } catch {
    // Fallback summary if Gemini fails
    summary = buildFallbackSummary(session.score, misconceptionsDetected, strengths);
  }

  return {
    summary,
    misconceptionsDetected,
    strengths,
    suggestions,
    feedbackGeneratedAt: new Date(),
  };
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
