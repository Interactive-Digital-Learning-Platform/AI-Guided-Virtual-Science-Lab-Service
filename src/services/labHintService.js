const { GoogleGenerativeAI } = require("@google/generative-ai");

let genAI = null;

const getGenAI = () => {
  if (!genAI && process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "your_gemini_api_key_here") {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return genAI;
};

const hintLevelForAttempts = (attempts) => Math.min(attempts, 3);

/**
 * Non-revealing hint for an incomplete/incorrect equipment or chemical selection.
 * Escalates over repeated attempts but NEVER names the missing item directly —
 * only Gemini-backed hints get more concept-specific with each level; the rule-based
 * fallback intentionally stays generic at every level rather than risk naming the answer.
 */
const generateSelectionHint = async ({ phase, experimentTitle, relatedConcepts, missingCount, unnecessaryCount, attempts }) => {
  const level = hintLevelForAttempts(attempts);
  const client = getGenAI();

  if (!client) return buildFallbackSelectionHint(phase, level, missingCount, unnecessaryCount);

  const model = client.getGenerativeModel({ model: "gemini-1.5-flash" });
  const conceptText = relatedConcepts.length > 0 ? relatedConcepts.join(", ") : "the experiment's purpose";

  const prompt = `
You are a science teacher guiding a student through "${experimentTitle}" in a virtual lab.
The student is choosing which ${phase === "equipment" ? "equipment" : "chemicals"} to use before starting.
Their current selection is incomplete or has extra, unneeded items (missing: ${missingCount}, unnecessary: ${unnecessaryCount}).
This is attempt ${attempts} at this selection (hint level ${level} of 3).

Related concepts: ${conceptText}

Write ONE short guiding sentence (max 25 words) that helps them think about what's missing or unneeded,
WITHOUT naming any specific ${phase === "equipment" ? "equipment item" : "chemical"}.
- Level 1: a vague observation prompt ("Think about...")
- Level 2: point toward the relevant concept, still no names
- Level 3: be more direct about the *purpose* they're missing, but still do not name the item

Do not use quotation marks in your answer.
`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text().trim();
  } catch (error) {
    console.error("Gemini API error:", error.message);
    return buildFallbackSelectionHint(phase, level, missingCount, unnecessaryCount);
  }
};

const buildFallbackSelectionHint = (phase, level, missingCount, unnecessaryCount) => {
  const noun = phase === "equipment" ? "equipment" : "chemicals";

  if (unnecessaryCount > 0 && missingCount === 0) {
    return "Look at what you've selected — does everything on your bench serve this experiment's purpose?";
  }

  const byLevel = {
    1: `Look back at the experiment's objective. Does your current ${noun} selection let you do everything it describes?`,
    2: `Think about each stage of the experiment — is there something you'd need to observe or measure that you haven't accounted for yet?`,
    3: `Consider the specific property you're trying to detect or produce in this experiment. What kind of ${noun} would let you do that?`,
  };
  return byLevel[level] || byLevel[3];
};

/**
 * Event-driven proactive hint for actions during the "Perform Experiment" phase
 * (spec's "AI Intervention Examples"): unknown-chemical combinations, unnecessary
 * heating, repeated mistakes. Rule-based trigger selection, optionally Gemini-phrased.
 */
const generateInterventionHint = async ({ triggerType, experimentTitle, context }) => {
  const client = getGenAI();
  const fallback = buildFallbackIntervention(triggerType, context);
  if (!client) return fallback;

  const model = client.getGenerativeModel({ model: "gemini-1.5-flash" });
  const prompt = `
You are a science teacher supervising a student's virtual experiment "${experimentTitle}".
The student just triggered a "${triggerType}" safety/process check. Context: ${JSON.stringify(context)}.

Write ONE short in-character teacher intervention (max 30 words), as a reflective question or gentle warning —
not an instruction, and not revealing what to do next. Do not use quotation marks in your answer.
`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text().trim();
  } catch (error) {
    console.error("Gemini API error:", error.message);
    return fallback;
  }
};

const buildFallbackIntervention = (triggerType, context) => {
  switch (triggerType) {
    case "unknown_combination":
      return "Safety check: before combining substances, consider whether you know their properties.";
    case "unnecessary_heat":
      return "Why do you think heating is required in this experiment? Consider the purpose before continuing.";
    case "repeated_mistake":
      return `I noticed this step has been attempted ${context?.attempts || "several"} times. Let's review the concept behind this process.`;
    case "rushed_step":
      return "That happened quickly — take a moment to observe what changed before moving on.";
    default:
      return "Pause for a moment and consider what you expect to happen next.";
  }
};

/**
 * Heuristic classification of a wrong Compound Builder attempt, from the submitted coefficients
 * alone — used both to tailor the hint below and to record a misconception code on the session
 * (see submitCompoundBuild). Leaving every coefficient at 1 suggests the student never counted
 * atoms at all (CHEM_BUILD_002); any other wrong, non-uniform guess suggests they tried to
 * balance but misjudged the elements' valency/combining ratio (CHEM_BUILD_001).
 */
const classifyCompoundBuildMistake = ({ reactantCoefficients, productCoefficient }) => {
  const allOnes = reactantCoefficients.every((r) => r.coefficient === 1) && productCoefficient === 1;
  return allOnes ? "CHEM_BUILD_002" : "CHEM_BUILD_001";
};

/**
 * Non-revealing, escalating hint for an incorrect Compound Builder equation-balancing attempt —
 * mirrors generateSelectionHint's style (Gemini-backed with a rule-based fallback, 3 levels
 * keyed off attempt count), tailored by the suspected misconception from classifyCompoundBuildMistake.
 */
const generateCompoundBuildHint = async ({ compoundName, attempts, misconceptionCode }) => {
  const level = hintLevelForAttempts(attempts);
  const client = getGenAI();

  if (!client) return buildFallbackCompoundHint(compoundName, level, misconceptionCode);

  const model = client.getGenerativeModel({ model: "gemini-1.5-flash" });
  const focusHint =
    misconceptionCode === "CHEM_BUILD_002"
      ? "The student appears to have left every coefficient at 1 without counting atoms on each side."
      : "The student appears to be guessing coefficients without considering the elements' valency or combining ratio.";

  const prompt = `
You are a science teacher guiding a student who is trying to balance the equation for forming ${compoundName}
in a virtual Compound Builder activity.

${focusHint}
This is attempt ${attempts} at this equation (hint level ${level} of 3).

Write ONE short guiding sentence (max 25 words) that helps them think about how to balance the equation,
WITHOUT stating the correct coefficients or the balanced equation itself.
- Level 1: prompt them to count atoms of each element on both sides
- Level 2: point them toward checking valency/combining ratio for the elements involved
- Level 3: suggest adjusting one coefficient at a time and recounting, without naming any value

Do not use quotation marks in your answer.
`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text().trim();
  } catch (error) {
    console.error("Gemini API error:", error.message);
    return buildFallbackCompoundHint(compoundName, level, misconceptionCode);
  }
};

const buildFallbackCompoundHint = (compoundName, level, misconceptionCode) => {
  if (misconceptionCode === "CHEM_BUILD_002") {
    const byLevel = {
      1: `Count how many atoms of each element appear on each side of the equation for ${compoundName} — are they equal yet?`,
      2: `Leaving every coefficient at 1 only works if the two sides already match — recount rather than assuming they do.`,
      3: `Try adjusting one coefficient at a time and recount both sides after each change, rather than guessing the whole equation at once.`,
    };
    return byLevel[level] || byLevel[3];
  }
  const byLevel = {
    1: `Look at the formula for ${compoundName} itself — how many of each atom does it contain? That tells you what the reactant side must add up to.`,
    2: `Think about how many bonds each element typically forms — that combining ratio affects the coefficients you'll need.`,
    3: `Try adjusting one coefficient at a time and recount both sides after each change, rather than guessing the whole equation at once.`,
  };
  return byLevel[level] || byLevel[3];
};

module.exports = {
  generateSelectionHint,
  generateInterventionHint,
  generateCompoundBuildHint,
  classifyCompoundBuildMistake,
  hintLevelForAttempts,
};
