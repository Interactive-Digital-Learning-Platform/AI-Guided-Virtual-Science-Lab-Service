// Controlled vocabulary + hand-written validator for AI-generated Biology visualizations
// (see aiVisualizationService.js). No Zod/Joi/ajv anywhere else in this backend, so this stays
// consistent with the existing style — plain field/type/enum checks, same as request validation
// elsewhere in this codebase.
//
// Keep ASSET_TYPES/ACTION_TYPES in lockstep with the mobile renderer's registries:
// Mobile-Application/components/lab/biology/assets/AnimatedSceneAsset.tsx (ASSET_VISUALS) and
// its action-handling switch — the LLM is constrained to exactly these names.

const ASSET_TYPES = [
  "sun",
  "cloud",
  "plant",
  "leaf",
  "root",
  "stem",
  "xylem",
  "stomata",
  "water_particle",
  "water_vapour",
  "oxygen_molecule",
  "co2_molecule",
  "blood_cell",
  "alveolus",
  "food_particle",
  "enzyme",
];

const ACTION_TYPES = [
  "appear",
  "disappear",
  "fadeIn",
  "fadeOut",
  "move",
  "flow",
  "particleFlow",
  "arrowFlow",
  "grow",
  "shrink",
  "pulse",
  "rotate",
  "highlight",
];

const DIFFICULTIES = ["easy", "medium", "hard"];

const MIN_STAGES = 4;
const MAX_STAGES = 8;
const MIN_DURATION_SEC = 15;
const MAX_DURATION_SEC = 60;

const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;
const isFiniteNumber = (v) => typeof v === "number" && Number.isFinite(v);
const isPct = (v) => isFiniteNumber(v) && v >= 0 && v <= 100;

// Returns { valid: true } or { valid: false, reason: "..." } — reason is fed back into the
// retry prompt so the model gets a concrete correction, not just "try again".
const validateGeneratedVisualization = (data) => {
  if (!data || typeof data !== "object") return { valid: false, reason: "Response was not a JSON object." };

  if (!isNonEmptyString(data.title)) return { valid: false, reason: "title must be a non-empty string." };
  if (!isNonEmptyString(data.description)) return { valid: false, reason: "description must be a non-empty string." };
  if (!isNonEmptyString(data.syllabusTopic)) return { valid: false, reason: "syllabusTopic must be a non-empty string." };
  if (!isNonEmptyString(data.learningObjective)) return { valid: false, reason: "learningObjective must be a non-empty string." };
  if (!isNonEmptyString(data.keyConcept)) return { valid: false, reason: "keyConcept must be a non-empty string." };
  if (!DIFFICULTIES.includes(data.difficulty)) {
    return { valid: false, reason: `difficulty must be one of: ${DIFFICULTIES.join(", ")}.` };
  }
  if (!isFiniteNumber(data.durationSec) || data.durationSec < MIN_DURATION_SEC || data.durationSec > MAX_DURATION_SEC) {
    return { valid: false, reason: `durationSec must be a number between ${MIN_DURATION_SEC} and ${MAX_DURATION_SEC}.` };
  }
  if (!Array.isArray(data.stages) || data.stages.length < MIN_STAGES || data.stages.length > MAX_STAGES) {
    return { valid: false, reason: `stages must be an array of ${MIN_STAGES}-${MAX_STAGES} items.` };
  }
  if (!Array.isArray(data.components)) return { valid: false, reason: "components must be an array." };
  if (!Array.isArray(data.learningQuestions)) return { valid: false, reason: "learningQuestions must be an array." };

  const componentIds = new Set();
  for (const component of data.components) {
    if (!isNonEmptyString(component?.componentId) || !isNonEmptyString(component?.label) || !isNonEmptyString(component?.shortInfo)) {
      return { valid: false, reason: "Every component needs componentId, label and shortInfo as non-empty strings." };
    }
    componentIds.add(component.componentId);
  }

  const stageIds = new Set();
  for (const [index, stage] of data.stages.entries()) {
    if (typeof stage?.stageId !== "number") return { valid: false, reason: `stages[${index}].stageId must be a number.` };
    if (!isNonEmptyString(stage?.title)) return { valid: false, reason: `stages[${index}].title must be a non-empty string.` };
    if (!isNonEmptyString(stage?.explanation)) return { valid: false, reason: `stages[${index}].explanation must be a non-empty string.` };
    if (!isFiniteNumber(stage?.durationMs) || stage.durationMs <= 0) {
      return { valid: false, reason: `stages[${index}].durationMs must be a positive number.` };
    }
    if (!Array.isArray(stage?.componentIds)) return { valid: false, reason: `stages[${index}].componentIds must be an array.` };
    if (!Array.isArray(stage?.sceneElements) || stage.sceneElements.length === 0) {
      return { valid: false, reason: `stages[${index}].sceneElements must be a non-empty array.` };
    }

    for (const [elIndex, element] of stage.sceneElements.entries()) {
      const where = `stages[${index}].sceneElements[${elIndex}]`;
      if (!isNonEmptyString(element?.elementId)) return { valid: false, reason: `${where}.elementId must be a non-empty string.` };
      if (!ASSET_TYPES.includes(element?.assetType)) {
        return { valid: false, reason: `${where}.assetType must be one of: ${ASSET_TYPES.join(", ")}.` };
      }
      if (!ACTION_TYPES.includes(element?.action)) {
        return { valid: false, reason: `${where}.action must be one of: ${ACTION_TYPES.join(", ")}.` };
      }
      if (!isPct(element?.fromX) || !isPct(element?.fromY)) {
        return { valid: false, reason: `${where}.fromX/fromY must be numbers between 0 and 100.` };
      }
      // toX/toY only matter for actions that actually move the element — still required so the
      // renderer never has to special-case a missing field, but not range-checked as strictly
      // relevant when the action ignores them (e.g. "pulse" stays at fromX/fromY).
      if (!isPct(element?.toX) || !isPct(element?.toY)) {
        return { valid: false, reason: `${where}.toX/toY must be numbers between 0 and 100.` };
      }
    }

    stageIds.add(stage.stageId);
  }

  for (const [index, question] of data.learningQuestions.entries()) {
    if (!isNonEmptyString(question?.question)) return { valid: false, reason: `learningQuestions[${index}].question must be a non-empty string.` };
    if (!Array.isArray(question?.options) || question.options.length < 2) {
      return { valid: false, reason: `learningQuestions[${index}].options must be an array of at least 2 strings.` };
    }
    if (typeof question?.correctIndex !== "number" || question.correctIndex < 0 || question.correctIndex >= question.options.length) {
      return { valid: false, reason: `learningQuestions[${index}].correctIndex must be a valid index into options.` };
    }
    if (question.replayStageId != null && !stageIds.has(question.replayStageId)) {
      return { valid: false, reason: `learningQuestions[${index}].replayStageId must match a real stageId or be null.` };
    }
  }

  return { valid: true };
};

module.exports = { ASSET_TYPES, ACTION_TYPES, DIFFICULTIES, MIN_STAGES, MAX_STAGES, MIN_DURATION_SEC, MAX_DURATION_SEC, validateGeneratedVisualization };
