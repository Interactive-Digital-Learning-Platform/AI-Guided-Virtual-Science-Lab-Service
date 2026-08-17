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
    case "heating_empty_container":
      return `Heating an empty ${context?.equipmentType || "container"} won't do much — did you mean to add something first?`;
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

// Coarse, non-revealing category phrase for a step's actionType — used only by the rule-based
// fallback below to keep hints loosely on-topic without ever naming actual equipment.
const EQUIPMENT_CATEGORY_BY_ACTION_TYPE = {
  measure: "measuring instruments",
  record: "measuring instruments",
  observe: "observation tools",
  heat: "heating equipment",
  mix: "the right container or mixing tool",
  stir: "the right container or mixing tool",
  pour: "the right container",
  add: "the right container or a tool for adding small amounts",
  filter: "filtration equipment",
  setup: "the equipment set",
  calculate: "the equipment set",
};

/**
 * Step-level equipment hint for the Laboratory Workspace — surfaced automatically the moment the
 * student attempts a step with the wrong (or no) equipment on the bench (see evaluateStepOnBench /
 * logAction, session.controller.js), and also available on demand from the bulb (requestHint).
 * Never reveals the equipment name, per generateSelectionHint's "no names" principle. Scoped to a
 * single step's requiredEquipment (Experiment.steps[].requiredEquipment) and what's actually on the
 * student's live bench right now — distinct from the pre-procedure equipment/chemical selection
 * screens, which stay non-blocking.
 */
const generateEquipmentHint = async ({
  experimentTitle,
  stepTitle,
  stepInstruction,
  stepActionType,
  requiredEquipment,
  benchEquipmentTypes,
  level,
}) => {
  const client = getGenAI();
  const fallback = buildFallbackEquipmentHint({ level, stepActionType, requiredEquipment, benchEquipmentTypes });
  if (!client) return fallback;

  const model = client.getGenerativeModel({ model: "gemini-1.5-flash" });
  const benchText = benchEquipmentTypes.length ? benchEquipmentTypes.join(", ") : "nothing yet";

  const prompt = `
You are a science teacher standing beside a student during a virtual "${experimentTitle}" practical.
The student is on this step: "${stepTitle}" — ${stepInstruction}
Equipment currently on their lab bench: ${benchText}.
This is hint level ${level} of 3 for this step.

Write ONE short in-character hint (max 25 words) that helps the student figure out what equipment
this step needs, WITHOUT ever naming a specific piece of equipment.
- Level 1 (conceptual): ask about the scientific property or purpose of this step — no mention of equipment or tools at all.
- Level 2 (functional): describe the FUNCTION of the needed equipment (e.g. "an instrument that measures acidity") without naming it.
- Level 3 (direct): point them toward checking a category in the equipment set (e.g. "measuring instruments") — still never say the equipment's actual name.

Do not use quotation marks. Never mention any of: ${requiredEquipment.join(", ") || "no specific items"}.
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

const buildFallbackEquipmentHint = ({ level, stepActionType, requiredEquipment, benchEquipmentTypes }) => {
  const stillMissing = requiredEquipment.filter((r) => !benchEquipmentTypes.includes(r));
  if (stillMissing.length === 0) {
    return "You've got the right equipment on your bench for this step — think about how to use it.";
  }

  const category = EQUIPMENT_CATEGORY_BY_ACTION_TYPE[stepActionType] || "the equipment set";
  const byLevel = {
    1: "What property of the solution are you trying to measure or change in this step?",
    2: "Consider whether an observation tool or a measurement tool would be more useful here.",
    3: `Take another look at ${category} in the equipment set — one of those is designed exactly for this step.`,
  };
  return byLevel[level] || byLevel[3];
};

/**
 * Step-level chemical hint — sibling to generateEquipmentHint, same three-level non-revealing
 * structure and same trigger points (automatic on a wrong attempt, or on demand from the bulb),
 * but scoped to Experiment.steps[].requiredChemicalsForStep instead of requiredEquipment. Chemical
 * names/formulas are withheld from the prompt itself (not just instructed against), since an LLM
 * asked not to mention a name is far more reliable when it was never given that name to begin with.
 */
const generateChemicalHint = async ({
  experimentTitle,
  stepTitle,
  stepInstruction,
  stepActionType,
  requiredChemicalCategories,
  level,
}) => {
  const client = getGenAI();
  const fallback = buildFallbackChemicalHint({ level, requiredChemicalCategories });
  if (!client) return fallback;

  const model = client.getGenerativeModel({ model: "gemini-1.5-flash" });

  const prompt = `
You are a science teacher standing beside a student during a virtual "${experimentTitle}" practical.
The student is on this step: "${stepTitle}" — ${stepInstruction}
They have not yet added the right chemical(s) for this step. The general category involved: ${requiredChemicalCategories.join(", ") || "a specific substance"}.
This is hint level ${level} of 3 for this step.

Write ONE short in-character hint (max 25 words) that helps the student figure out which chemical(s)
this step needs, WITHOUT ever naming the specific chemical, its formula, or its symbol.
- Level 1 (conceptual): ask about the chemical property or role needed (e.g. acidic vs alkaline) — stay abstract.
- Level 2 (functional): describe what the chemical should DO in this reaction/test, still no name or formula.
- Level 3 (direct): point them toward checking their materials for a substance with that property — still never name it.

Do not use quotation marks.
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

const buildFallbackChemicalHint = ({ level, requiredChemicalCategories }) => {
  const byLevel = {
    1: "What kind of solution does this step call for — think about the property being tested or produced.",
    2: "Consider which of your materials would actually cause the change this step describes.",
    3: `Check your materials for a substance that matches this step's purpose${
      requiredChemicalCategories.length ? ` (${requiredChemicalCategories.join(", ")})` : ""
    } — you've already got the right container.`,
  };
  return byLevel[level] || byLevel[3];
};

module.exports = {
  generateSelectionHint,
  generateInterventionHint,
  generateCompoundBuildHint,
  generateEquipmentHint,
  generateChemicalHint,
  classifyCompoundBuildMistake,
  hintLevelForAttempts,
};
