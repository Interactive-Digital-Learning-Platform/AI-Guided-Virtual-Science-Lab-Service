const LabRun = require("../models/LabRun");
const Chemical = require("../models/Chemical");
const { findReaction } = require("../services/reactionEngine");
const { generateTutorResponse } = require("../services/labTutorService");

const MAX_TUTOR_HISTORY = 6; // turns kept in the doc; only the last few are sent as prompt context
const RECENT_ACTIONS_FOR_TUTOR = 5;

// POST /api/lab/runs
const startLabRun = async (req, res, next) => {
  try {
    const existing = await LabRun.findOne({ userId: req.user._id, status: "active" });
    if (existing) {
      return res.status(200).json({ success: true, message: "Resuming active lab run.", data: existing });
    }

    const labRun = await LabRun.create({ userId: req.user._id });
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
const logLabAction = async (req, res, next) => {
  try {
    const { actionType, equipment, chemicalIds, quantity, unit, temperature } = req.body;
    if (!actionType) return res.status(400).json({ success: false, message: "actionType is required." });

    const labRun = await LabRun.findOne({ _id: req.params.id, userId: req.user._id });
    if (!labRun) return res.status(404).json({ success: false, message: "Lab run not found." });
    if (labRun.status !== "active")
      return res.status(400).json({ success: false, message: "Lab run is not active." });

    labRun.actions.push({ actionType, equipment, chemicalIds, quantity, unit, temperature });

    if (equipment) {
      const prevState = labRun.equipmentState[equipment] || {};
      labRun.equipmentState[equipment] = {
        ...prevState,
        equipmentType: prevState.equipmentType || equipment,
        chemicalIds: actionType === "reset" ? [] : chemicalIds || prevState.chemicalIds || [],
        temperature: temperature ?? prevState.temperature ?? null,
      };
      labRun.markModified("equipmentState");
    }

    await labRun.save();

    res.status(201).json({ success: true, data: labRun });
  } catch (error) {
    next(error);
  }
};

// POST /api/lab/runs/:id/mix
const mixChemicals = async (req, res, next) => {
  try {
    const { equipment, chemicalIds, conditions = {} } = req.body;
    if (!equipment || !Array.isArray(chemicalIds) || chemicalIds.length < 2) {
      return res
        .status(400)
        .json({ success: false, message: "equipment and at least 2 chemicalIds are required." });
    }

    const labRun = await LabRun.findOne({ _id: req.params.id, userId: req.user._id });
    if (!labRun) return res.status(404).json({ success: false, message: "Lab run not found." });
    if (labRun.status !== "active")
      return res.status(400).json({ success: false, message: "Lab run is not active." });

    const result = await findReaction(chemicalIds, conditions);

    labRun.actions.push({
      actionType: "mix",
      equipment,
      chemicalIds,
      temperature: conditions.temperature ?? null,
      reactionId: result.found ? result.reaction._id : null,
      resultType: result.found ? "reaction_success" : "no_reaction",
    });

    if (result.found) {
      labRun.reactionsTriggered.push(result.reaction._id);
      labRun.equipmentState[equipment] = {
        equipmentType: equipment,
        chemicalIds: result.reaction.products.map((p) => p.chemical._id),
        temperature: conditions.temperature ?? null,
      };
      labRun.markModified("equipmentState");
    }

    await labRun.save();

    if (result.found) {
      const reaction = result.reaction;
      return res.status(200).json({
        success: true,
        data: {
          found: true,
          reaction: {
            id: reaction._id,
            name: reaction.name,
            balancedEquation: reaction.balancedEquation,
            reactionType: reaction.reactionType,
            products: reaction.products.map((p) => ({
              chemical: p.chemical,
              coefficient: p.coefficient,
            })),
            observableChanges: reaction.observableChanges,
            educationalInfo: reaction.educationalInfo,
            safetyNotes: reaction.safetyNotes,
          },
        },
      });
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

    const chemicalIdsPresent = Object.values(labRun.equipmentState)
      .flatMap((e) => e.chemicalIds || [])
      .filter(Boolean);
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
