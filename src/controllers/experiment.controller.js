const Experiment = require("../models/Experiment");

// GET /api/experiments
// Query params: subject, grade, difficulty, page, limit
const getExperiments = async (req, res, next) => {
  try {
    const { subject, grade, difficulty, page = 1, limit = 20 } = req.query;
    console.log(`[GET /experiments] Query:`, req.query);
    const filter = { isActive: true };

    if (subject) filter.subject = subject;
    if (grade) filter.grades = parseInt(grade);
    if (difficulty) filter.difficulty = difficulty;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [experiments, total] = await Promise.all([
      Experiment.find(filter)
        .select("-steps.hints -steps.misconceptionRisks")
        .sort({ subject: 1, difficulty: 1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Experiment.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: experiments,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/experiments/:id
const getExperimentById = async (req, res, next) => {
  try {
    const experiment = await Experiment.findById(req.params.id)
      .populate("relatedConcepts", "name description simpleExplanation visualizationAvailable")
      .lean();

    if (!experiment) {
      return res.status(404).json({ success: false, message: "Experiment not found." });
    }

    // Count how many times this user attempted this experiment
    const Session = require("../models/Session");
    const attemptCount = await Session.countDocuments({ userId: req.user._id, experimentId: experiment._id });

    res.status(200).json({ success: true, data: { ...experiment, userAttempts: attemptCount } });
  } catch (error) {
    next(error);
  }
};

// GET /api/experiments/subject/:subject
const getExperimentsBySubject = async (req, res, next) => {
  try {
    const { subject } = req.params;
    const userGrade = req.user.grade;

    const experiments = await Experiment.find({
      subject,
      isActive: true,
      grades: userGrade,
    })
      .select("title difficulty estimatedTime description thumbnailColor totalAttempts averageScore grades")
      .sort({ difficulty: 1 })
      .lean();

    res.status(200).json({ success: true, data: experiments });
  } catch (error) {
    next(error);
  }
};

module.exports = { getExperiments, getExperimentById, getExperimentsBySubject };
