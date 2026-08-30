const { isConfigured, generateText, generateJSON } = require("./groqClient");

// ─────────────────────────────────────────────────────────────────────────────────────────────
// PERSONALIZED, BEHAVIOUR-AWARE FEEDBACK (Phase 3)
//
// The caller (aiService.analyzeSession) hands us a fully-computed, verified `performanceContext`
// (score components, per-step breakdown, the deterministic struggle ranking, misconceptions,
// procedural errors, strengths). The LLM's ONLY job is to turn that into student-friendly prose —
// it never computes a score, a duration, or a ranking (spec §22). Structured JSON out so the
// mobile report and the future Notes handoff can consume it cleanly (spec §20).
// ─────────────────────────────────────────────────────────────────────────────────────────────

const asStringArray = (v, max = 5) =>
  (Array.isArray(v) ? v : [])
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean)
    .slice(0, max);

/**
 * @param {{ performanceContext: object, grade: number }} args
 * @returns {Promise<{ summary, strengths[], struggleAnalysis[], recommendations[] }>}
 */
const generatePersonalizedFeedback = async ({ performanceContext, grade = 8 }) => {
  const fallback = buildDeterministicFeedback(performanceContext);
  if (!isConfigured()) return fallback;

  const prompt = `
You are an encouraging science teacher writing feedback for a Grade ${grade} student who has just
finished a virtual science practical.

Every number, step name, duration, count, status and ranking in the DATA below has ALREADY been
calculated and verified by the system. Use them EXACTLY as given. Do NOT compute, estimate,
re-rank, round, or invent any value, step, time, score, or fact. If something is not in the DATA,
do not claim it. Do not use markdown or bullet characters inside the strings.

DATA:
${JSON.stringify(performanceContext, null, 2)}

Respond with a JSON object with EXACTLY these keys:

{
  "summary": "3 to 5 flowing sentences (no lists). Open with a genuine, specific strength. Then, if
     mostStruggledSteps is non-empty, name the single hardest step and use its reasons to say what
     specifically was difficult (e.g. choosing/using the right transfer method) versus what the
     student clearly did understand. Mention heavy hint use, Help use, or spending far longer than
     usual ONLY if the DATA shows it. Finish with one encouraging, forward-looking sentence. Grade
     ${grade} vocabulary.",
  "strengths": ["2 to 4 SPECIFIC things the student did well, each grounded in the DATA — a step
     completed with no hints, a fast and accurate step, not needing Help overall, recovering after
     a wrong attempt. Avoid generic praise like 'good job'."],
  "struggleAnalysis": ["One entry for EACH step in mostStruggledSteps, in the same order, formatted
     '<step name> — <one sentence on what was hard and, from its reasons, why>'. Return [] when
     mostStruggledSteps is empty."],
  "recommendations": ["2 to 4 concrete, actionable things to do before repeating this practical.
     Tie each one to something in the DATA: a misconception's fix, a struggled step, a procedural
     error, or the curriculumReference. e.g. 'Practise using a dropper to transfer a few drops
     before retrying step 2.' Never 'study more' or 'revise the topic', and do not invent target
     times or scores to aim for."]
}

Return ONLY the JSON object, nothing else.`;

  try {
    const raw = await generateJSON(prompt);
    const summary = typeof raw.summary === "string" && raw.summary.trim() ? raw.summary.trim() : fallback.summary;
    return {
      summary,
      strengths: asStringArray(raw.strengths, 4).length ? asStringArray(raw.strengths, 4) : fallback.strengths,
      struggleAnalysis: asStringArray(raw.struggleAnalysis, 3),
      recommendations: asStringArray(raw.recommendations, 4).length
        ? asStringArray(raw.recommendations, 4)
        : fallback.recommendations,
    };
  } catch (error) {
    console.error("Groq personalized-feedback error:", error.message);
    return fallback;
  }
};

// Deterministic feedback built purely from the verified context — used when the LLM is
// unavailable or returns junk. Still specific (names the hardest step, its reasons) — never the
// old "Great job! Keep practicing." filler.
const buildDeterministicFeedback = (ctx = {}) => {
  const score = ctx.finalScore ?? 0;
  const steps = Array.isArray(ctx.steps) ? ctx.steps : [];
  const struggled = Array.isArray(ctx.mostStruggledSteps) ? ctx.mostStruggledSteps : [];
  const misconceptions = Array.isArray(ctx.misconceptions) ? ctx.misconceptions : [];

  const cleanSteps = steps.filter((s) => (s.hints || 0) === 0 && !s.helpUsed && (s.score ?? 0) >= 95);
  const opener =
    score >= 90
      ? `You completed ${ctx.experiment || "the practical"} with a strong final score of ${score}.`
      : score >= 70
        ? `You worked through ${ctx.experiment || "the practical"} and finished with a score of ${score}.`
        : `You completed ${ctx.experiment || "the practical"} with a score of ${score} — there is room to build on this.`;

  const strengths = [];
  cleanSteps.slice(0, 3).forEach((s) => strengths.push(`Completed ${s.step} independently, with no hints.`));
  if (ctx.guidanceSummary && ctx.guidanceSummary.helpCount === 0) strengths.push("Did not need to reveal any answers with Help.");
  if (!strengths.length) strengths.push("Worked through every step of the practical to completion.");

  const struggleAnalysis = struggled.map(
    (s) => `${s.step} — this was the step you found hardest: ${(s.reasons || []).slice(0, 3).join("; ")}.`
  );

  const recommendations = [];
  misconceptions.slice(0, 2).forEach((m) => m.fix && recommendations.push(m.fix));
  if (struggled[0]) recommendations.push(`Repeat ${struggled[0].step} and try to finish it without using Help.`);
  if (ctx.curriculumReference) recommendations.push(`Read the linked lesson: ${String(ctx.curriculumReference).replace(/\.\s*$/, "")}.`);
  if (!recommendations.length) recommendations.push("Try this practical again and aim to complete each step without requesting hints.");

  const summaryParts = [opener];
  if (strengths[0]) summaryParts.push(strengths[0].replace(/\.$/, "") + ".");
  if (struggled[0]) {
    summaryParts.push(
      `You had the most difficulty on ${struggled[0].step}${
        (struggled[0].reasons || []).length ? ` — ${struggled[0].reasons.slice(0, 2).join(" and ").toLowerCase()}` : ""
      }.`
    );
  }
  summaryParts.push("Reviewing the points below before your next attempt will help.");

  return { summary: summaryParts.join(" "), strengths: strengths.slice(0, 4), struggleAnalysis, recommendations: recommendations.slice(0, 4) };
};

/**
 * Generate personalized natural-language feedback using Groq
 */
const generateFeedback = async ({ experimentTitle, score, misconceptions, strengths, grade }) => {
  if (!isConfigured()) {
    // Return rule-based feedback if Grok is not configured
    return buildRuleBasedFeedback(experimentTitle, score, misconceptions, strengths);
  }

  const misconceptionText =
    misconceptions.length > 0
      ? misconceptions.map((m) => `- ${m.description} (Step ${m.relatedStep || "N/A"})`).join("\n")
      : "None detected.";

  const strengthText =
    strengths.length > 0 ? strengths.map((s) => `- ${s}`).join("\n") : "Keep practicing to build strengths.";

  const prompt = `
You are a friendly, encouraging science teacher giving feedback to a Grade ${grade} student.
The student just completed the virtual experiment: "${experimentTitle}".
Their score: ${score}/100.

Strengths observed:
${strengthText}

Misconceptions detected:
${misconceptionText}

Write a short, encouraging 3-4 sentence feedback message. 
- Start with a positive note
- Gently mention one misconception if any, with a clear explanation
- End with an encouraging next step
- Use simple language appropriate for Grade ${grade}
- Do NOT use bullet points. Write as natural flowing sentences.
`;

  try {
    return await generateText(prompt);
  } catch (error) {
    console.error("Groq API error:", error.message);
    return buildRuleBasedFeedback(experimentTitle, score, misconceptions, strengths);
  }
};

const buildRuleBasedFeedback = (experimentTitle, score, misconceptions, strengths) => {
  const parts = [];

  if (score >= 80) {
    parts.push(`Fantastic work on "${experimentTitle}"! You scored ${score}% — that's excellent!`);
  } else if (score >= 50) {
    parts.push(`Good effort on "${experimentTitle}"! You scored ${score}% — you're making great progress.`);
  } else {
    parts.push(`Thank you for trying "${experimentTitle}"! You scored ${score}% — don't worry, practice makes perfect.`);
  }

  if (strengths.length > 0) {
    parts.push(strengths[0]);
  }

  if (misconceptions.length > 0) {
    parts.push(`One thing to work on: ${misconceptions[0].description} ${misconceptions[0].correctionStrategy}`);
  } else {
    parts.push("Great job — no major misconceptions were detected in this session!");
  }

  parts.push("Keep exploring and experimenting — every attempt makes you a better scientist! 🔬");

  return parts.join(" ");
};

module.exports = { generateFeedback, generatePersonalizedFeedback, buildDeterministicFeedback };
