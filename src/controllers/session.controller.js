const Session = require("../models/Session");
const Action = require("../models/Action");
const Experiment = require("../models/Experiment");
const User = require("../models/User");
const { analyzeSession } = require("../services/aiService");
const { generateFeedback } = require("../services/feedbackService");

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

// POST /api/sessions/:id/action
const logAction = async (req, res, next) => {
  try {
    const { stepId, actionType, actionDetail, expectedAction, timeTaken, hintLevel, conceptViolated } = req.body;

    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: "Session not found." });
    if (session.status !== "in_progress")
      return res.status(400).json({ success: false, message: "Session is not in progress." });

    // Count attempts for this step in this session
    const stepAttempts = await Action.countDocuments({
      sessionId: session._id,
      stepId,
      actionType: { $in: ["correct", "incorrect"] },
    });

    const action = await Action.create({
      sessionId: session._id,
      userId: req.user._id,
      experimentId: session.experimentId,
      stepId,
      actionType,
      actionDetail: actionDetail || "",
      expectedAction: expectedAction || "",
      timeTaken: timeTaken || 0,
      attemptNumber: stepAttempts + 1,
      hintLevel: hintLevel || null,
      conceptViolated: conceptViolated || null,
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

    res.status(201).json({
      success: true,
      data: action,
      meta: { suggestHint, stepErrors, currentStep: session.currentStep },
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

// GET /api/sessions/:id
const getSession = async (req, res, next) => {
  try {
    const session = await Session.findById(req.params.id)
      .populate("experimentId", "title subject steps")
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

module.exports = { startSession, logAction, completeSession, getSession, getUserSessions, requestHint };
