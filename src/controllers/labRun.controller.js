const LabRun = require("../models/LabRun");
const Chemical = require("../models/Chemical");
const Session = require("../models/Session");
const { findReaction, serializeReactionMatch } = require("../services/reactionEngine");
const { generateTutorResponse } = require("../services/labTutorService");
const { generateInterventionHint } = require("../services/labHintService");
const { computeContainerPh } = require("../services/phService");
const FREEFORM_EXPERIMENT_TITLE = "this virtual lab"; // no Experiment/Session title to reference outside a guided practical

const MAX_TUTOR_HISTORY = 6; // turns kept in the doc; only the last few are sent as prompt context
const RECENT_ACTIONS_FOR_TUTOR = 5;

/**
 * Checks an equipment instance's current contents against the reaction engine every time they
 * change (called from add_chemical/heat below) — no separate "Mix" action needed, per the
 * "reactions should happen continuously" design goal. Mutates `instance.contents` to the
 * reaction's products on a match (quantities carried over with simple, non-stoichiometric
 * summation — precise scaling is out of scope) and records it on reactionsTriggered.
 * Returns a ReactionResultType, or null if there weren't at least 2 chemicals present to check.
 */
const checkAndApplyReaction = async (labRun, instance) => {
  const chemicalIds = instance.contents.map((c) => c.chemical.toString());
  if (chemicalIds.length < 2) return null;

  const conditions = { heated: instance.isHeated, temperature: instance.temperature };
  const result = await findReaction(chemicalIds, conditions);

  if (!result.found) {
    return { found: false, reason: result.reason, explanation: result.explanation || null, hint: result.hint || null };
  }

  labRun.reactionsTriggered.push(result.reaction._id);

  const totalVolume = instance.contents.reduce((sum, c) => sum + (c.volume || 0), 0) || null;
  const totalMass = instance.contents.reduce((sum, c) => sum + (c.mass || 0), 0) || null;
  instance.contents = result.reaction.products.map((p, i) => ({
    chemical: p.chemical._id,
    volume: i === 0 ? totalVolume : null,
    mass: i === 0 ? totalMass : null,
  }));

  return serializeReactionMatch(result.reaction);
};

/**
 * Proactive AI Tutor safety check, run after add_chemical/heat alongside checkAndApplyReaction —
 * the student never has to ask; the tutor flags it immediately, same as the guided-Session flow's
 * repeated_mistake/unnecessary_heat interventions (generateInterventionHint, labHintService.js).
 * Returns { type, hint } or null. Only one check fires per action — heating empty glassware is the
 * more specific/actionable signal, so it takes priority when both could apply.
 */
const checkSafetyIntervention = async ({ actionType, instance, reactionResult, experimentTitle }) => {
  if (actionType === "heat" && instance.isHeated && instance.contents.length === 0) {
    const hint = await generateInterventionHint({
      triggerType: "heating_empty_container",
      experimentTitle,
      context: { equipmentType: instance.equipmentType },
    });
    return { type: "heating_empty_container", hint };
  }

  if (actionType === "add_chemical" && reactionResult && !reactionResult.found && reactionResult.reason === "no_known_reaction") {
    const hint = await generateInterventionHint({
      triggerType: "unknown_combination",
      experimentTitle,
      context: { equipmentType: instance.equipmentType },
    });
    return { type: "unknown_combination", hint };
  }

  return null;
};

// POST /api/lab/runs
// Body: { sessionId? } — when present, this LabRun is the live bench backing a specific guided
// practical Session (see session.controller.js) instead of a standalone freeform run. Scoped
// separately from the student's freeform "one active run" so the two never collide.
const startLabRun = async (req, res, next) => {
  try {
    const { sessionId } = req.body;
    const filter = sessionId
      ? { userId: req.user._id, sessionId, status: "active" }
      : { userId: req.user._id, status: "active", sessionId: null };

    const existing = await LabRun.findOne(filter);
    if (existing) {
      if (sessionId) await Session.findByIdAndUpdate(sessionId, { labRunId: existing._id });
      return res.status(200).json({ success: true, message: "Resuming active lab run.", data: existing });
    }

    const labRun = await LabRun.create({ userId: req.user._id, sessionId: sessionId || null });
    // Link back from the Session so session.controller.js's mix-step grading (Phase 4) can find
    // this run's live bench state without the client having to pass it separately.
    if (sessionId) await Session.findByIdAndUpdate(sessionId, { labRunId: labRun._id });
    res.status(201).json({ success: true, message: "Lab run started.", data: labRun });
  } catch (error) {
    next(error);
  }
};

// GET /api/lab/runs/:id
const getLabRun = async (req, res, next) => {
  try {
    const labRun = await LabRun.findOne({ _id: req.params.id, userId: req.user._id }).lean();
    if (!labRun) return res.status(404).json({ success: false, message: "Lab run not found." });
    res.status(200).json({ success: true, data: labRun });
  } catch (error) {
    next(error);
  }
};

// POST /api/lab/runs/:id/action
// Body varies by actionType:
//   create_equipment: { instanceId, equipmentType, position? }
//   move_equipment:   { instanceId, position }
//   remove_equipment: { instanceId }
//   add_chemical:     { instanceId, chemicalId, quantity?, unit? }  — unit "g" -> mass, else volume
//   reset:            { instanceId }
//   heat:             { instanceId, heated?, temperature? }
//   probe_measure:    { instanceId, targetInstanceId }  — instanceId is the probe (e.g. pH meter)
//   probe_detach:     { instanceId }
// Equipment instances are keyed by a client-generated instanceId (e.g. "beaker-<timestamp>"), not
// equipmentType, so a student can place multiple beakers on the bench at once.
const logLabAction = async (req, res, next) => {
  try {
    const { actionType, instanceId, equipmentType, position, chemicalId, quantity, unit, temperature, heated, targetInstanceId } =
      req.body;
    if (!actionType) return res.status(400).json({ success: false, message: "actionType is required." });

    const labRun = await LabRun.findOne({ _id: req.params.id, userId: req.user._id });
    if (!labRun) return res.status(404).json({ success: false, message: "Lab run not found." });
    if (labRun.status !== "active")
      return res.status(400).json({ success: false, message: "Lab run is not active." });

    const instance = instanceId ? labRun.equipment.find((e) => e.instanceId === instanceId) : null;
    let actionEquipmentLabel = instance?.equipmentType || equipmentType || null;
    let reactionResult = null;
    let intervention = null;
    // probe_measure can't know its result (the measured value) until the switch below runs, unlike
    // add_chemical where quantity/unit are already known from the request — so the history entry
    // pushed at the end of this function reads these instead of the raw request fields.
    let resultQuantity = quantity;
    let resultUnit = unit;

    switch (actionType) {
      case "create_equipment": {
        if (!instanceId || !equipmentType) {
          return res.status(400).json({ success: false, message: "instanceId and equipmentType are required." });
        }
        if (instance) {
          return res.status(400).json({ success: false, message: "An equipment instance with this id already exists." });
        }
        labRun.equipment.push({
          instanceId,
          equipmentType,
          position: position || { x: 0, y: 0 },
          contents: [],
          temperature: 25,
          isHeated: false,
        });
        actionEquipmentLabel = equipmentType;
        break;
      }

      case "move_equipment": {
        if (!instance) return res.status(404).json({ success: false, message: "Equipment instance not found." });
        if (!position) return res.status(400).json({ success: false, message: "position is required." });
        instance.position = position;
        break;
      }

      case "remove_equipment": {
        if (!instance) return res.status(404).json({ success: false, message: "Equipment instance not found." });
        labRun.equipment = labRun.equipment.filter((e) => e.instanceId !== instanceId);
        break;
      }

      case "add_chemical": {
        if (!instance) return res.status(404).json({ success: false, message: "Equipment instance not found." });
        if (!chemicalId) return res.status(400).json({ success: false, message: "chemicalId is required." });
        instance.contents.push({
          chemical: chemicalId,
          volume: unit === "g" ? null : quantity ?? null,
          mass: unit === "g" ? quantity ?? null : null,
        });
        reactionResult = await checkAndApplyReaction(labRun, instance);
        intervention = await checkSafetyIntervention({
          actionType,
          instance,
          reactionResult,
          experimentTitle: FREEFORM_EXPERIMENT_TITLE,
        });
        break;
      }

      case "reset": {
        if (!instance) return res.status(404).json({ success: false, message: "Equipment instance not found." });
        instance.contents = [];
        break;
      }

      case "heat": {
        if (!instance) return res.status(404).json({ success: false, message: "Equipment instance not found." });
        instance.isHeated = heated ?? !instance.isHeated;
        instance.temperature = temperature ?? (instance.isHeated ? Math.max(instance.temperature, 80) : 25);
        // Heating can be what a reaction was waiting on (conditions.requiresHeat) — re-check.
        reactionResult = await checkAndApplyReaction(labRun, instance);
        intervention = await checkSafetyIntervention({
          actionType,
          instance,
          reactionResult,
          experimentTitle: FREEFORM_EXPERIMENT_TITLE,
        });
        break;
      }

      case "probe_measure": {
        if (!instance) return res.status(404).json({ success: false, message: "Equipment instance not found." });
        if (!targetInstanceId) return res.status(400).json({ success: false, message: "targetInstanceId is required." });
        const target = labRun.equipment.find((e) => e.instanceId === targetInstanceId);
        if (!target) return res.status(404).json({ success: false, message: "Target equipment not found." });

        const chemicalIds = target.contents.map((c) => c.chemical);
        const chemicalDocs = chemicalIds.length ? await Chemical.find({ _id: { $in: chemicalIds } }).lean() : [];
        const chemicalsById = Object.fromEntries(chemicalDocs.map((c) => [c._id.toString(), c]));
        const phResult = computeContainerPh(target, chemicalsById);

        instance.probeTargetId = targetInstanceId;
        instance.lastMeasurement = phResult.measurable
          ? { measurementType: "ph", value: phResult.value, targetId: targetInstanceId, measuredAt: new Date() }
          : { measurementType: null, value: null, targetId: targetInstanceId, measuredAt: new Date() };

        resultQuantity = phResult.measurable ? phResult.value : null;
        resultUnit = "pH";
        break;
      }

      case "probe_detach": {
        if (!instance) return res.status(404).json({ success: false, message: "Equipment instance not found." });
        instance.probeTargetId = null;
        instance.lastMeasurement = null;
        break;
      }

      default:
        return res.status(400).json({ success: false, message: `Unsupported actionType: ${actionType}` });
    }

    labRun.actions.push({
      actionType,
      equipment: actionEquipmentLabel,
      chemicalIds: chemicalId ? [chemicalId] : [],
      quantity: resultQuantity ?? null,
      unit: resultUnit || null,
      temperature: temperature ?? null,
      reactionId: reactionResult?.found ? reactionResult.reaction.id : null,
      resultType: reactionResult ? (reactionResult.found ? "reaction_success" : "no_reaction") : null,
    });

    await labRun.save();

    res.status(201).json({ success: true, data: labRun, meta: { reactionResult, intervention } });
  } catch (error) {
    next(error);
  }
};

// POST /api/lab/runs/:id/mix
// Superseded by the continuous check in logLabAction (add_chemical/heat) — kept for backward
// compatibility in case anything still calls it explicitly.
// Body: { instanceId, chemicalIds, conditions? }
const mixChemicals = async (req, res, next) => {
  try {
    const { instanceId, chemicalIds, conditions = {} } = req.body;
    if (!instanceId || !Array.isArray(chemicalIds) || chemicalIds.length < 2) {
      return res
        .status(400)
        .json({ success: false, message: "instanceId and at least 2 chemicalIds are required." });
    }

    const labRun = await LabRun.findOne({ _id: req.params.id, userId: req.user._id });
    if (!labRun) return res.status(404).json({ success: false, message: "Lab run not found." });
    if (labRun.status !== "active")
      return res.status(400).json({ success: false, message: "Lab run is not active." });

    const instance = labRun.equipment.find((e) => e.instanceId === instanceId);
    if (!instance) return res.status(404).json({ success: false, message: "Equipment instance not found." });

    const result = await findReaction(chemicalIds, conditions);

    labRun.actions.push({
      actionType: "mix",
      equipment: instance.equipmentType,
      chemicalIds,
      temperature: conditions.temperature ?? null,
      reactionId: result.found ? result.reaction._id : null,
      resultType: result.found ? "reaction_success" : "no_reaction",
    });

    if (result.found) {
      labRun.reactionsTriggered.push(result.reaction._id);
      instance.contents = result.reaction.products.map((p) => ({ chemical: p.chemical._id, volume: null, mass: null }));
      if (conditions.temperature != null) instance.temperature = conditions.temperature;
    }

    await labRun.save();

    if (result.found) {
      return res.status(200).json({ success: true, data: serializeReactionMatch(result.reaction) });
    }

    return res.status(200).json({
      success: true,
      data: {
        found: false,
        reason: result.reason,
        explanation: result.explanation || null,
        hint: result.hint || null,
      },
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/lab/runs/:id/complete
const completeLabRun = async (req, res, next) => {
  try {
    const labRun = await LabRun.findOne({ _id: req.params.id, userId: req.user._id });
    if (!labRun) return res.status(404).json({ success: false, message: "Lab run not found." });

    labRun.status = "completed";
    labRun.endedAt = new Date();
    await labRun.save();

    res.status(200).json({ success: true, message: "Lab run completed.", data: labRun });
  } catch (error) {
    next(error);
  }
};

// POST /api/lab/runs/:id/tutor
const askTutor = async (req, res, next) => {
  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ success: false, message: "question is required." });

    const labRun = await LabRun.findOne({ _id: req.params.id, userId: req.user._id });
    if (!labRun) return res.status(404).json({ success: false, message: "Lab run not found." });

    const chemicalIdsPresent = labRun.equipment.flatMap((e) => e.contents.map((c) => c.chemical)).filter(Boolean);
    const chemicalsPresent = chemicalIdsPresent.length
      ? await Chemical.find({ _id: { $in: chemicalIdsPresent } }).lean()
      : [];

    const recentActions = labRun.actions.slice(-RECENT_ACTIONS_FOR_TUTOR);
    const conversationHistory = labRun.tutorConversation.slice(-MAX_TUTOR_HISTORY);

    const answer = await generateTutorResponse({
      chemicalsPresent,
      recentActions,
      conversationHistory,
      question,
      grade: req.user.grade,
    });

    labRun.tutorConversation.push({ role: "user", content: question });
    labRun.tutorConversation.push({ role: "assistant", content: answer });
    await labRun.save();

    res.status(200).json({ success: true, data: { answer } });
  } catch (error) {
    next(error);
  }
};

module.exports = { startLabRun, getLabRun, logLabAction, mixChemicals, completeLabRun, askTutor };
