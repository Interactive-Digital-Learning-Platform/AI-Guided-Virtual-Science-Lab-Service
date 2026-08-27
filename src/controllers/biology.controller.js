const BiologyVisualization = require("../models/BiologyVisualization");
const User = require("../models/User");
const { generateVisualization } = require("../services/aiVisualizationService");

const DAILY_GENERATION_LIMIT = 15;

const todayString = () => new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

// GET /api/biology
// Not grade-filtered — this app targets Grade 10/11 students exclusively, so there's no
// narrower audience to gate content against. Summary fields only, mirrors
// getExperimentsBySubject in experiment.controller.js.
const getBiologyVisualizations = async (req, res, next) => {
  try {
    const visualizations = await BiologyVisualization.find({ isActive: true })
      .select("title description animationKey syllabusTopic difficulty durationSec thumbnailColor grades")
      .sort({ difficulty: 1 })
      .lean();

    res.status(200).json({ success: true, data: visualizations });
  } catch (error) {
    next(error);
  }
};

// GET /api/biology/:id
// Full detail including stages/components/learningQuestions — unlike the guided Experiment
// flow, none of this is answer-bearing, so nothing needs to be withheld from the client.
const getBiologyVisualizationById = async (req, res, next) => {
  try {
    const visualization = await BiologyVisualization.findById(req.params.id).lean();
    if (!visualization) {
      return res.status(404).json({ success: false, message: "Visualization not found." });
    }

    res.status(200).json({ success: true, data: visualization });
  } catch (error) {
    next(error);
  }
};

// POST /api/biology/generate
// Body: { question: string }. Not persisted — the generated visualization lives only in the
// response; regenerating it later costs another Groq call (see plan's phase-1 non-goals: no
// saved library yet). Rate-limited per user since there is no other cost guard on Groq calls
// anywhere in this backend.
const generateBiologyVisualization = async (req, res, next) => {
  try {
    const { question } = req.body;
    if (typeof question !== "string" || !question.trim()) {
      return res.status(400).json({ success: false, message: "A question is required." });
    }

    const user = await User.findById(req.user._id).select("dailyGenerationCount dailyGenerationDate");
    const today = todayString();
    if (user.dailyGenerationDate !== today) {
      user.dailyGenerationDate = today;
      user.dailyGenerationCount = 0;
    }
    if (user.dailyGenerationCount >= DAILY_GENERATION_LIMIT) {
      return res.status(429).json({
        success: false,
        message: `You've reached today's limit of ${DAILY_GENERATION_LIMIT} generated visualizations. Try again tomorrow.`,
      });
    }
    user.dailyGenerationCount += 1;
    await user.save();

    const result = await generateVisualization(question.trim());

    if (result.status === "generation_unavailable" || result.status === "generation_failed") {
      return res.status(503).json({
        success: false,
        message: "Sorry, I couldn't generate that visualization right now. Please try rephrasing your question or try again in a moment.",
      });
    }

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

module.exports = { getBiologyVisualizations, getBiologyVisualizationById, generateBiologyVisualization };
