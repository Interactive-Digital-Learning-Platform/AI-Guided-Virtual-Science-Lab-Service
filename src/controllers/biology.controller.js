const BiologyVisualization = require("../models/BiologyVisualization");

// GET /api/biology
// Grade-matched to the logged-in student, summary fields only — mirrors
// getExperimentsBySubject in experiment.controller.js.
const getBiologyVisualizations = async (req, res, next) => {
  try {
    const userGrade = req.user.grade;
    const filter = { isActive: true };
    if (userGrade) filter.grades = userGrade;

    const visualizations = await BiologyVisualization.find(filter)
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

module.exports = { getBiologyVisualizations, getBiologyVisualizationById };
