const { isConfigured, generateText } = require("./groqClient");

const hintLevelForAttempts = (attempts) => Math.min(attempts, 3);

/**
 * Non-revealing hint for an incomplete/incorrect equipment or chemical selection.
 * Escalates over repeated attempts but NEVER names the missing item directly —
 * only Gemini-backed hints get more concept-specific with each level; the rule-based
 * fallback intentionally stays generic at every level rather than risk naming the answer.
 */
const generateSelectionHint = async ({ phase, experimentTitle, relatedConcepts, missingCount, unnecessaryCount, attempts }) => {
  const level = hintLevelForAttempts(attempts);

  if (!isConfigured()) return buildFallbackSelectionHint(phase, level, missingCount, unnecessaryCount);

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
    return await generateText(prompt);
  } catch (error) {
    console.error("Groq API error:", error.message);
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
  const fallback = buildFallbackIntervention(triggerType, context);
  if (!isConfigured()) return fallback;

  const prompt = `
You are a science teacher supervising a student's virtual experiment "${experimentTitle}".
The student just triggered a "${triggerType}" safety/process check. Context: ${JSON.stringify(context)}.

Write ONE short in-character teacher intervention (max 30 words), as a reflective question or gentle warning —
not an instruction, and not revealing what to do next. Do not use quotation marks in your answer.
`;

  try {
    return await generateText(prompt);
  } catch (error) {
    console.error("Groq API error:", error.message);
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
    case "transfer_contamination":
      return `Using the same ${context?.instrument || "transfer tool"} in two different solutions can carry traces of the first into the second — think about whether that matters here.`;
    case "off_task":
      return "This looks like it belongs to a different part of the experiment — have a look at what the current task is actually asking for.";
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

  if (!isConfigured()) return buildFallbackCompoundHint(compoundName, level, misconceptionCode);

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
    return await generateText(prompt);
  } catch (error) {
    console.error("Groq API error:", error.message);
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
 * student attempts a step with the wrong (or no) equipment on the bench (see evaluateOnBench /
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
  const fallback = buildFallbackEquipmentHint({ level, stepActionType, requiredEquipment, benchEquipmentTypes });
  if (!isConfigured()) return fallback;

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
    return await generateText(prompt);
  } catch (error) {
    console.error("Groq API error:", error.message);
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
  // Non-blocking selection: false → the needed substance isn't in the student's lab at all, so
  // the hint should steer them toward the in-workspace Material Library ("+ Add Materials")
  // rather than toward their bench — still without ever naming the substance. Defaults true so
  // legacy callers / un-seeded runs behave exactly as before.
  materialAvailable = true,
  level,
}) => {
  const fallback = buildFallbackChemicalHint({ level, requiredChemicalCategories, materialAvailable });
  if (!isConfigured()) return fallback;

  const levelGuidance = materialAvailable
    ? `- Level 2 (functional): describe what the chemical should DO in this reaction/test, still no name or formula.
- Level 3 (direct): point them toward checking their materials for a substance with that property — still never name it.`
    : `IMPORTANT: the student does NOT currently have any suitable substance available in their lab, so
they need to bring one in from the in-workspace Material Library ("+ Add Materials") — the hint must
make that recovery path discoverable without ever naming the substance.
- Level 2 (functional): tell them they may need to bring another material into their lab and to open the Material Library, and describe (abstractly) what the substance should DO — no name or formula.
- Level 3 (direct): tell them to look in the Material Library for a substance with the relevant property (e.g. one that shows whether a solution is acidic, basic or neutral) and add it to their lab — still never name it.`;

  const prompt = `
You are a science teacher standing beside a student during a virtual "${experimentTitle}" practical.
The student is on this step: "${stepTitle}" — ${stepInstruction}
They have not yet added the right chemical(s) for this step. The general category involved: ${requiredChemicalCategories.join(", ") || "a specific substance"}.
This is hint level ${level} of 3 for this step.

Write ONE short in-character hint (max 30 words) that helps the student figure out which chemical(s)
this step needs, WITHOUT ever naming the specific chemical, its formula, or its symbol.
- Level 1 (conceptual): ask about the chemical property or role needed (e.g. acidic vs alkaline) — stay abstract.
${levelGuidance}

Do not use quotation marks.
`;

  try {
    return await generateText(prompt);
  } catch (error) {
    console.error("Groq API error:", error.message);
    return fallback;
  }
};

const buildFallbackChemicalHint = ({ level, requiredChemicalCategories, materialAvailable = true }) => {
  if (!materialAvailable) {
    // The needed substance isn't in the student's lab — steer toward the Material Library, never
    // naming it (only the server-gated Help reveal may do that). Mirrors spec §12's ladder.
    const byLevel = {
      1: "Think about whether the materials currently in your lab are enough to complete this task.",
      2: "You may need to bring another material into the lab — open the Material Library and think about what kind of substance would help you here.",
      // Concept-oriented, still never names the substance or its exact class — the student maps
      // "the property this task needs" to a material in the Library themselves.
      3: "Look in the Material Library for a material with the property this task depends on, and add it to your lab.",
    };
    return byLevel[level] || byLevel[3];
  }
  const byLevel = {
    1: "What kind of solution does this step call for — think about the property being tested or produced.",
    2: "Consider which of your materials would actually cause the change this step describes.",
    3: `Check your materials for a substance that matches this step's purpose${
      requiredChemicalCategories.length ? ` (${requiredChemicalCategories.join(", ")})` : ""
    } — you've already got the right container.`,
  };
  return byLevel[level] || byLevel[3];
};

// Non-revealing category phrase for a Current Task's expectedIntent — used only by the
// rule-based fallback below, mirrors EQUIPMENT_CATEGORY_BY_ACTION_TYPE's role for
// generateEquipmentHint.
const ACTION_CATEGORY_BY_INTENT = {
  OBSERVE_RESULT: "a change you should be watching for",
  MEASURE_RESULT: "a value you need to read and record",
  RECORD_RESULT: "an observation you need to write down",
  PREPARE_SAMPLE: "getting your materials ready before the main action",
  HEAT_SAMPLE: "applying heat carefully and purposefully",
};

/**
 * Sibling to generateEquipmentHint/generateChemicalHint, for a Current Task whose expectedIntent
 * has no equipment/chemical gap to hang a hint on (OBSERVE_RESULT, MEASURE_RESULT, RECORD_RESULT,
 * etc. — the student already has everything they need on the bench, they just need to notice or
 * record something). Same three-level non-revealing shape and same Gemini-backed-with-fallback
 * pattern as its two siblings — reuses labHintService's existing groqClient wiring rather than a
 * second AI integration.
 */
const generateTaskHint = async ({ experimentTitle, stepTitle, studentPrompt, expectedIntent, level }) => {
  const fallback = buildFallbackTaskHint({ level, expectedIntent });
  if (!isConfigured()) return fallback;

  const prompt = `
You are a science teacher standing beside a student during a virtual "${experimentTitle}" practical.
The student is on this step: "${stepTitle}". Their current task: "${studentPrompt}"
This is hint level ${level} of 3 for this task.

Write ONE short in-character hint (max 25 words) that helps the student figure out what to do,
WITHOUT ever stating the specific result, reading, or observation they should record.
- Level 1 (conceptual): ask a reflective question about what they should be paying attention to.
- Level 2 (functional): describe what kind of change or value they're looking for, still no specifics.
- Level 3 (direct): point them toward exactly where on the bench to look or what to check — still never state the actual result.

Do not use quotation marks in your answer.
`;

  try {
    return await generateText(prompt);
  } catch (error) {
    console.error("Groq API error:", error.message);
    return fallback;
  }
};

const buildFallbackTaskHint = ({ level, expectedIntent }) => {
  const category = ACTION_CATEGORY_BY_INTENT[expectedIntent] || "what this task is asking you to do";
  const byLevel = {
    1: `Re-read the current task carefully — what is it actually asking you to notice or do?`,
    2: `Think about ${category} — take a closer look at your lab bench.`,
    3: `Look closely at what's currently on your bench and compare it to what you expected — that's ${category}.`,
  };
  return byLevel[level] || byLevel[3];
};

/**
 * Sibling to generateEquipmentHint, for Electricity (Phase B) PLACE_COMPONENT tasks — surfaced
 * when a circuit slot is missing a component or filled with the wrong one (see evaluateBoard,
 * circuitEngine.js). Placement itself is never blocked server-side (see place_component,
 * labRun.controller.js), so this is the only signal a misplacement gets — same three-level
 * non-revealing structure as its siblings, and deliberately never names which slot is wrong or
 * which component belongs there, since that would just hand over the answer through repetition.
 */
const generateCircuitHint = async ({ experimentTitle, stepTitle, stepInstruction, level }) => {
  const fallback = buildFallbackCircuitHint({ level });
  if (!isConfigured()) return fallback;

  const prompt = `
You are a physics teacher standing beside a student building a circuit during a virtual "${experimentTitle}" practical.
The student is on this step: "${stepTitle}" — ${stepInstruction}
Something about their current circuit isn't right yet — either a position is empty or has the wrong instrument in it.
This is hint level ${level} of 3 for this task.

Write ONE short in-character hint (max 25 words) that helps the student figure out what's wrong with their circuit,
WITHOUT ever naming which specific position is wrong or which component belongs there.
- Level 1 (conceptual): ask what physical quantity they're trying to measure or control at this point in the circuit.
- Level 2 (functional): ask them to consider the difference between the instruments involved (e.g. what current vs. potential difference each measures, or how series vs. parallel connections behave), without naming a slot.
- Level 3 (direct): point them toward re-checking how each instrument is connected relative to the rest of the loop — still never name a specific slot or component.

Do not use quotation marks in your answer.
`;

  try {
    return await generateText(prompt);
  } catch (error) {
    console.error("Groq API error:", error.message);
    return fallback;
  }
};

const buildFallbackCircuitHint = ({ level }) => {
  const byLevel = {
    1: "Think about what physical quantity you're trying to measure at this point in the circuit.",
    2: "Consider whether the instrument here measures current or potential difference — and how that changes where it belongs.",
    3: "Trace the loop your current would actually follow, and check each instrument's connection against that path.",
  };
  return byLevel[level] || byLevel[3];
};

/**
 * Misconception-targeted hint (M5 — dev-docs/implementation-plan-student-model.md §3.5). The
 * Bayesian student model has concluded the student probably holds `misconceptionDescription`;
 * this gently makes them question that specific belief, without naming the equipment/chemical or
 * giving the step away. Escalates over 3 levels. Falls back to one sentence of `correctionStrategy`
 * when Groq is unavailable.
 */
const generateMisconceptionHint = async ({
  experimentTitle,
  studentPrompt,
  misconceptionDescription,
  correctionStrategy,
  level = 1,
  grade = 10,
}) => {
  const fallback = buildFallbackMisconceptionHint({ correctionStrategy, level });
  if (!isConfigured()) return fallback;

  const prompt = `
You are a Sri Lankan O/L science teacher helping a Grade ${grade} student working ALONE in a
virtual lab on "${experimentTitle || "this practical"}". Their current task: "${studentPrompt || "the current step"}".

From how they have been using the equipment, they appear to hold this misconception:
"${misconceptionDescription || "a misunderstanding about the science of this step"}"

Write ONE short hint (max 30 words, hint level ${level} of 3) that gently makes them question that
specific belief — WITHOUT naming the correct equipment or chemical, and without giving the step away.
- Level 1: a reflective question about the underlying idea
- Level 2: contrast the belief with what actually drives the result
- Level 3: be near-explicit about the principle, but still not the exact action
Do not use quotation marks. Do not use markdown or bullet characters.
`;

  try {
    return await generateText(prompt);
  } catch (error) {
    console.error("Groq API error:", error.message);
    return fallback;
  }
};

const buildFallbackMisconceptionHint = ({ correctionStrategy, level }) => {
  const clean = String(correctionStrategy || "Think about the science behind what this step is asking.")
    .replace(/\s+/g, " ")
    .trim();
  const firstSentence = (clean.match(/^[^.!?]*[.!?]/) || [clean])[0].trim();
  const prefix = level >= 3 ? "" : level === 2 ? "Consider this: " : "Think about this: ";
  return `${prefix}${firstSentence}`;
};

module.exports = {
  generateSelectionHint,
  generateInterventionHint,
  generateCompoundBuildHint,
  generateEquipmentHint,
  generateChemicalHint,
  generateTaskHint,
  generateCircuitHint,
  generateMisconceptionHint,
  classifyCompoundBuildMistake,
  hintLevelForAttempts,
};
