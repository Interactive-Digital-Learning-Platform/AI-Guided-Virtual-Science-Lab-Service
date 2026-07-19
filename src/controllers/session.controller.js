const Session = require("../models/Session");
const Action = require("../models/Action");
const Experiment = require("../models/Experiment");
const User = require("../models/User");
const { analyzeSession } = require("../services/aiService");
const { generateFeedback } = require("../services/feedbackService");
const { generateSelectionHint } = require("../services/labHintService");

// POST /api/sessions/start
const startSession = async (req, res, next) => {
  try {
    const { experimentId } = req.body;
    if (!experimentId) return res.status(400).json({ success: false, message: "experimentId is required." });

    const experiment = await Experiment.findById(experimentId);
    if (!experiment) return res.status(404).json({ success: false, message: "Experiment not found." });

    // Check if there's an in_progress session already
    const existingSession = await Session.findOne({
      userId: req.user._id,
      experimentId,
      status: "in_progress",
    });
    if (existingSession) {
      return res.status(200).json({ success: true, message: "Resuming existing session.", data: existingSession });
    }

    // Count previous attempts
    const prevAttempts = await Session.countDocuments({ userId: req.user._id, experimentId });

    const session = await Session.create({
      userId: req.user._id,
      experimentId,
      attemptNumber: prevAttempts + 1,
    });

    res.status(201).json({ success: true, message: "Session started.", data: session });
  } catch (error) {
    next(error);
  }
};

// POST /api/sessions/:id/equipment-selection
// Body: { selectedEquipment: [String] }
const submitEquipmentSelection = async (req, res, next) => {
  try {
    const { selectedEquipment } = req.body;
    if (!Array.isArray(selectedEquipment)) {
      return res.status(400).json({ success: false, message: "selectedEquipment array is required." });
    }

    const session = await Session.findById(req.params.id).populate("experimentId");
    if (!session) return res.status(404).json({ success: false, message: "Session not found." });
    if (session.phase !== "equipment_selection") {
      return res.status(400).json({ success: false, message: "This session is not in the equipment selection phase." });
    }

    const experiment = session.experimentId;
    const required = experiment.requiredEquipment || [];
    const optional = experiment.optionalEquipment || [];

    const correct = selectedEquipment.filter((e) => required.includes(e));
    const missing = required.filter((e) => !selectedEquipment.includes(e));
    const unnecessary = selectedEquipment.filter((e) => !required.includes(e) && !optional.includes(e));

    session.equipmentSelection.selected = selectedEquipment;
    session.equipmentSelection.correct = correct;
    session.equipmentSelection.missing = missing;
    session.equipmentSelection.unnecessary = unnecessary;
    session.equipmentSelection.attempts += 1;

    const isComplete = missing.length === 0 && unnecessary.length === 0;
    if (isComplete) {
      session.phase = "chemical_selection";
      await session.save();
      return res.status(200).json({
        success: true,
        data: { complete: true, correct, unnecessaryCount: 0, missingCount: 0, nextPhase: session.phase },
      });
    }

    await session.save();

    const relatedConcepts = await require("../models/Concept")
      .find({ _id: { $in: experiment.relatedConcepts } })
      .select("name")
      .lean();

    const hint = await generateSelectionHint({
      phase: "equipment",
      experimentTitle: experiment.title,
      relatedConcepts: relatedConcepts.map((c) => c.name),
      missingCount: missing.length,
      unnecessaryCount: unnecessary.length,
      attempts: session.equipmentSelection.attempts,
    });

    res.status(200).json({
      success: true,
      data: {
        complete: false,
        correct,
        unnecessaryItems: unnecessary, // safe to reveal — these are the student's own choices
        missingCount: missing.length, // count only — names are withheld, per the guidance design
        hint,
      },
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/sessions/:id/chemical-selection
// Body: { selectedChemicalIds: [String] }
const submitChemicalSelection = async (req, res, next) => {
  try {
    const { selectedChemicalIds } = req.body;
    if (!Array.isArray(selectedChemicalIds)) {
      return res.status(400).json({ success: false, message: "selectedChemicalIds array is required." });
    }

    const session = await Session.findById(req.params.id).populate("experimentId");
    if (!session) return res.status(404).json({ success: false, message: "Session not found." });
    if (session.phase !== "chemical_selection") {
      return res.status(400).json({ success: false, message: "This session is not in the chemical selection phase." });
    }

    const experiment = session.experimentId;
    const requiredIds = (experiment.requiredChemicals || []).map((r) => r.chemical.toString());

    const correct = selectedChemicalIds.filter((id) => requiredIds.includes(id));
    const missing = requiredIds.filter((id) => !selectedChemicalIds.includes(id));
    const unnecessary = selectedChemicalIds.filter((id) => !requiredIds.includes(id));

    session.chemicalSelection.selected = selectedChemicalIds;
    session.chemicalSelection.correct = correct;
    session.chemicalSelection.missing = missing;
    session.chemicalSelection.unnecessary = unnecessary;
    session.chemicalSelection.attempts += 1;

    const isComplete = missing.length === 0 && unnecessary.length === 0;
    if (isComplete) {
      session.phase = "procedure";
      await session.save();
      return res.status(200).json({
        success: true,
        data: { complete: true, correct, unnecessaryCount: 0, missingCount: 0, nextPhase: session.phase },
      });
    }

    await session.save();

    const relatedConcepts = await require("../models/Concept")
      .find({ _id: { $in: experiment.relatedConcepts } })
      .select("name")
      .lean();

    const hint = await generateSelectionHint({
      phase: "chemical",
      experimentTitle: experiment.title,
      relatedConcepts: relatedConcepts.map((c) => c.name),
      missingCount: missing.length,
      unnecessaryCount: unnecessary.length,
      attempts: session.chemicalSelection.attempts,
    });

    res.status(200).json({
      success: true,
      data: {
        complete: false,
        correct,
        unnecessaryItems: unnecessary,
        missingCount: missing.length,
        hint,
      },
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/sessions/:id/action
const logAction = async (req, res, next) => {
  try {
    let { stepId, actionType, actionDetail, expectedAction, timeTaken, hintLevel, conceptViolated } = req.body;
    const { equipmentType, chemicalIds, quantity, unit, conditions } = req.body;

    const session = await Session.findById(req.params.id).populate("experimentId");
    if (!session) return res.status(404).json({ success: false, message: "Session not found." });
    if (session.status !== "in_progress")
      return res.status(400).json({ success: false, message: "Session is not in progress." });

    const experiment = session.experimentId;
    const step = experiment.steps.find((s) => s.stepId === stepId);

    // Mix steps tied to a curated reaction are graded server-side rather than trusting the
    // client's self-reported actionType — the backend remains the source of truth on whether
    // the student picked the right chemicals, per the architecture principle.
    let reactionResult = null;
    if (step?.actionType === "mix" && Array.isArray(chemicalIds) && chemicalIds.length >= 2) {
      const { findReaction } = require("../services/reactionEngine");
      reactionResult = await findReaction(chemicalIds, conditions || {});

      if (step.requiredChemicalsForStep?.length > 0) {
        const requiredSet = step.requiredChemicalsForStep.map((id) => id.toString()).sort();
        const selectedSet = [...chemicalIds].sort();
        const matches = requiredSet.length === selectedSet.length && requiredSet.every((id, i) => id === selectedSet[i]);
        actionType = matches ? "correct" : "incorrect";
        if (!matches) conceptViolated = conceptViolated || "CHEM_WRONG_REACTANTS";
      }
    }

    // Count attempts for this step in this session
    const stepAttempts = await Action.countDocuments({
      sessionId: session._id,
      stepId,
      actionType: { $in: ["correct", "incorrect"] },
    });

    const action = await Action.create({
      sessionId: session._id,
      userId: req.user._id,
      experimentId: experiment._id,
      stepId,
      actionType,
      actionDetail: actionDetail || "",
      expectedAction: expectedAction || "",
      timeTaken: timeTaken || 0,
      attemptNumber: stepAttempts + 1,
      hintLevel: hintLevel || null,
      conceptViolated: conceptViolated || null,
      equipmentType: equipmentType || null,
      chemicalIds: chemicalIds || [],
      quantity: quantity ?? null,
      unit: unit || null,
    });

    // Update session behavior features
    session.actions.push(action._id);
    session.behaviorFeatures.totalActions += 1;
    if (actionType === "incorrect") session.behaviorFeatures.totalErrors += 1;
    if (actionType === "hint_requested") session.behaviorFeatures.totalHintsRequested += 1;
    if (actionType === "repeated") session.behaviorFeatures.totalRetries += 1;
    if (actionType === "skipped") session.behaviorFeatures.totalSkips += 1;
    if (timeTaken < 10 && actionType === "correct") session.behaviorFeatures.fastSteps += 1;
    if (stepAttempts >= 2 && !session.behaviorFeatures.struggledSteps.includes(stepId)) {
      session.behaviorFeatures.struggledSteps.push(stepId);
    }

    // Advance step if correct
    if (actionType === "correct" && stepId === session.currentStep) {
      session.currentStep = stepId + 1;
    }

    await session.save();

    // Real-time hint trigger: if 2+ errors on same step, suggest hint
    const stepErrors = await Action.countDocuments({ sessionId: session._id, stepId, actionType: "incorrect" });
    const suggestHint = stepErrors >= 2;

    // Event-driven proactive intervention (spec's "AI Intervention Examples") — at most one
    // per action, checked in priority order.
    let intervention = null;
    const { generateInterventionHint } = require("../services/labHintService");
    if (step?.actionType === "mix" && reactionResult && !reactionResult.found && reactionResult.reason === "no_known_reaction") {
      intervention = {
        type: "unknown_combination",
        hint: await generateInterventionHint({ triggerType: "unknown_combination", experimentTitle: experiment.title, context: { stepId } }),
      };
    } else if (step?.actionType === "heat" && experiment.reactionId) {
      const Reaction = require("../models/Reaction");
      const reaction = await Reaction.findById(experiment.reactionId).select("conditions.requiresHeat").lean();
      if (reaction && !reaction.conditions.requiresHeat) {
        intervention = {
          type: "unnecessary_heat",
          hint: await generateInterventionHint({ triggerType: "unnecessary_heat", experimentTitle: experiment.title, context: { stepId } }),
        };
      }
    } else if (stepErrors >= 3) {
      intervention = {
        type: "repeated_mistake",
        hint: await generateInterventionHint({ triggerType: "repeated_mistake", experimentTitle: experiment.title, context: { stepId, attempts: stepErrors } }),
      };
    }

    res.status(201).json({
      success: true,
      data: action,
      meta: { suggestHint, stepErrors, currentStep: session.currentStep, reactionResult, intervention },
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/sessions/:id/complete
const completeSession = async (req, res, next) => {
  try {
    const session = await Session.findById(req.params.id).populate("experimentId");
    if (!session) return res.status(404).json({ success: false, message: "Session not found." });

    const allActions = await Action.find({ sessionId: session._id }).lean();

    // Calculate score
    const correctActions = allActions.filter((a) => a.actionType === "correct").length;
    const totalSteps = session.experimentId.steps.length;
    const score = Math.round((correctActions / totalSteps) * 100);

    // Calculate total time
    const totalTime = Math.round((Date.now() - session.startTime.getTime()) / 1000);

    // Calculate average step time
    const stepTimes = allActions.filter((a) => a.timeTaken > 0).map((a) => a.timeTaken);
    const avgStepTime = stepTimes.length > 0 ? stepTimes.reduce((a, b) => a + b, 0) / stepTimes.length : 0;

    session.status = "completed";
    session.endTime = new Date();
    session.score = score;
    session.totalTime = totalTime;
    session.behaviorFeatures.averageStepTime = Math.round(avgStepTime);
    session.behaviorFeatures.errorRate =
      session.behaviorFeatures.totalActions > 0
        ? parseFloat((session.behaviorFeatures.totalErrors / session.behaviorFeatures.totalActions).toFixed(2))
        : 0;

    // Run AI analysis
    const analysisResult = await analyzeSession(session, allActions);
    session.aiFeedback = analysisResult;

    await session.save();

    // Update user learning profile
    await User.findByIdAndUpdate(req.user._id, {
      $inc: { "learningProfile.totalSessions": 1 },
      $set: { "learningProfile.lastActiveDate": new Date() },
    });

    // Update experiment stats
    await Experiment.findByIdAndUpdate(session.experimentId._id, {
      $inc: { totalAttempts: 1 },
    });

    res.status(200).json({
      success: true,
      message: "Session completed. AI analysis done.",
      data: { score, totalTime, feedback: session.aiFeedback },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/sessions/:id/report
// Assembles the full post-experiment laboratory report from Session + Action + Experiment data.
const getSessionReport = async (req, res, next) => {
  try {
    const session = await Session.findById(req.params.id)
      .populate("experimentId")
      .populate("chemicalSelection.selected")
      .lean();
    if (!session) return res.status(404).json({ success: false, message: "Session not found." });
    if (session.status !== "completed") {
      return res.status(400).json({ success: false, message: "Report is available once the session is completed." });
    }

    const experiment = session.experimentId;
    const actions = await Action.find({ sessionId: session._id })
      .populate("chemicalIds", "name symbol")
      .sort({ timestamp: 1 })
      .lean();

    const equipmentUsed = [...new Set(actions.map((a) => a.equipmentType).filter(Boolean))];
    const chemicalsUsed = [
      ...new Map(
        actions.flatMap((a) => a.chemicalIds || []).map((c) => [c._id.toString(), { _id: c._id, name: c.name, symbol: c.symbol }])
      ).values(),
    ];

    const proceduralErrors = actions.filter((a) => a.actionType === "incorrect" && (!a.conceptViolated || a.conceptViolated.startsWith("PROC")));
    const conceptualErrors = session.aiFeedback.misconceptionsDetected || [];

    res.status(200).json({
      success: true,
      data: {
        experimentName: experiment.title,
        subject: experiment.subject,
        studentActions: actions.map((a) => ({
          actionType: a.actionType,
          stepId: a.stepId,
          equipment: a.equipmentType,
          chemicals: (a.chemicalIds || []).map((c) => c.name),
          quantity: a.quantity,
          unit: a.unit,
          timestamp: a.timestamp,
        })),
        equipmentUsed,
        chemicalsUsed,
        procedureFollowed: experiment.steps.map((s) => ({ stepId: s.stepId, title: s.title, instruction: s.instruction })),
        observations: experiment.expectedObservations || [],
        errorsDetected: {
          procedural: proceduralErrors.map((a) => ({ stepId: a.stepId, detail: a.actionDetail })),
          conceptual: conceptualErrors,
        },
        aiFeedback: session.aiFeedback,
        conceptsToImprove: session.aiFeedback.conceptsToImprove || [],
        finalUnderstandingAssessment: session.aiFeedback.finalUnderstandingAssessment || null,
        score: session.score,
        totalTime: session.totalTime,
        timestamp: session.updatedAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/sessions/:id
const getSession = async (req, res, next) => {
  try {
    const session = await Session.findById(req.params.id)
      // Pure-exclusion select (Mongo disallows mixing inclusion/exclusion outside sub-paths of
      // the same field) — excludes the mix-step "answer" fields, same reasoning as
      // getExperimentById. Everything else on Experiment is included, which is fine here.
      .populate("experimentId", "-requiredEquipment -requiredChemicals -reactionId -steps.expectedAction -steps.requiredChemicalsForStep")
      .lean();
    if (!session) return res.status(404).json({ success: false, message: "Session not found." });
    res.status(200).json({ success: true, data: session });
  } catch (error) {
    next(error);
  }
};

// GET /api/sessions/user/history
const getUserSessions = async (req, res, next) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const sessions = await Session.find({ userId: req.user._id, status: "completed" })
      .populate("experimentId", "title subject difficulty thumbnailColor")
      .select("score totalTime createdAt attemptNumber aiFeedback.summary")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Session.countDocuments({ userId: req.user._id, status: "completed" });

    res.status(200).json({ success: true, data: sessions, pagination: { total, page: parseInt(page) } });
  } catch (error) {
    next(error);
  }
};

// POST /api/sessions/:id/hint
const requestHint = async (req, res, next) => {
  try {
    const { stepId } = req.body;
    const session = await Session.findById(req.params.id).populate("experimentId");
    if (!session) return res.status(404).json({ success: false, message: "Session not found." });

    const step = session.experimentId.steps.find((s) => s.stepId === stepId);
    if (!step) return res.status(404).json({ success: false, message: "Step not found." });

    // Determine hint level (escalate based on previous hints)
    const prevHints = await Action.countDocuments({
      sessionId: session._id,
      stepId,
      actionType: "hint_requested",
    });
    const hintLevel = Math.min(prevHints + 1, 3);
    const hint = step.hints.find((h) => h.level === hintLevel) || step.hints[0];

    // Log hint request
    await Action.create({
      sessionId: session._id,
      userId: req.user._id,
      experimentId: session.experimentId._id,
      stepId,
      actionType: "hint_requested",
      actionDetail: `Hint level ${hintLevel} requested`,
      hintLevel,
      timeTaken: 0,
    });

    session.behaviorFeatures.totalHintsRequested += 1;
    await session.save();

    res.status(200).json({
      success: true,
      data: { hintLevel, hintText: hint?.text || "Think about what you need to do next.", stepId },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  startSession,
  submitEquipmentSelection,
  submitChemicalSelection,
  logAction,
  completeSession,
  getSession,
  getSessionReport,
  getUserSessions,
  requestHint,
};
