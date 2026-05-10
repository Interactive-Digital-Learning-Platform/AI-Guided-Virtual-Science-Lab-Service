const Session = require("../models/Session");
const Action = require("../models/Action");
const User = require("../models/User");

// GET /api/analytics/student/me
const getMyAnalytics = async (req, res, next) => {
  try {
    const userId = req.user._id;

    // All completed sessions
    const sessions = await Session.find({ userId, status: "completed" })
      .populate("experimentId", "title subject difficulty")
      .lean();

    if (sessions.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          totalSessions: 0,
          averageScore: 0,
          subjectBreakdown: {},
          recentSessions: [],
          misconceptionFrequency: [],
          progressOverTime: [],
        },
      });
    }

    // Average score
    const averageScore = Math.round(sessions.reduce((sum, s) => sum + s.score, 0) / sessions.length);

    // Subject breakdown
    const subjectBreakdown = {};
    sessions.forEach((s) => {
      const subj = s.experimentId?.subject || "Unknown";
      if (!subjectBreakdown[subj]) subjectBreakdown[subj] = { count: 0, totalScore: 0, avgScore: 0 };
      subjectBreakdown[subj].count += 1;
      subjectBreakdown[subj].totalScore += s.score;
    });
    Object.keys(subjectBreakdown).forEach((k) => {
      subjectBreakdown[k].avgScore = Math.round(subjectBreakdown[k].totalScore / subjectBreakdown[k].count);
    });

    // Misconception frequency
    const misconceptionMap = {};
    sessions.forEach((s) => {
      s.aiFeedback?.misconceptionsDetected?.forEach((m) => {
        misconceptionMap[m.code] = (misconceptionMap[m.code] || 0) + 1;
      });
    });
    const misconceptionFrequency = Object.entries(misconceptionMap)
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Progress over time (last 10 sessions, score trend)
    const progressOverTime = sessions
      .slice(-10)
      .map((s) => ({ date: s.createdAt, score: s.score, experiment: s.experimentId?.title }));

    // Recent sessions (last 5)
    const recentSessions = sessions.slice(-5).reverse().map((s) => ({
      sessionId: s._id,
      experimentTitle: s.experimentId?.title,
      subject: s.experimentId?.subject,
      score: s.score,
      totalTime: s.totalTime,
      date: s.createdAt,
      misconceptionsDetected: s.aiFeedback?.misconceptionsDetected?.length || 0,
    }));

    res.status(200).json({
      success: true,
      data: {
        totalSessions: sessions.length,
        averageScore,
        subjectBreakdown,
        misconceptionFrequency,
        progressOverTime,
        recentSessions,
        learningProfile: req.user.learningProfile,
      },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/analytics/session/:id
const getSessionAnalytics = async (req, res, next) => {
  try {
    const session = await Session.findById(req.params.id)
      .populate("experimentId", "title subject steps")
      .lean();
    if (!session) return res.status(404).json({ success: false, message: "Session not found." });

    const actions = await Action.find({ sessionId: session._id }).sort({ timestamp: 1 }).lean();

    // Per-step breakdown
    const stepBreakdown = {};
    actions.forEach((a) => {
      if (!stepBreakdown[a.stepId]) {
        stepBreakdown[a.stepId] = { stepId: a.stepId, attempts: 0, errors: 0, hints: 0, totalTime: 0 };
      }
      if (["correct", "incorrect"].includes(a.actionType)) stepBreakdown[a.stepId].attempts += 1;
      if (a.actionType === "incorrect") stepBreakdown[a.stepId].errors += 1;
      if (a.actionType === "hint_requested") stepBreakdown[a.stepId].hints += 1;
      stepBreakdown[a.stepId].totalTime += a.timeTaken || 0;
    });

    res.status(200).json({
      success: true,
      data: {
        session: {
          score: session.score,
          totalTime: session.totalTime,
          behaviorFeatures: session.behaviorFeatures,
          aiFeedback: session.aiFeedback,
        },
        stepBreakdown: Object.values(stepBreakdown),
        totalActions: actions.length,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getMyAnalytics, getSessionAnalytics };
