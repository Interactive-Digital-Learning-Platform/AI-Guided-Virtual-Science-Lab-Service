const Experiment = require("../models/Experiment");
const Chemical = require("../models/Chemical");
const Reaction = require("../models/Reaction");

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
        // Exclude fields that would reveal the equipment/chemical selection answers or step
        // hints up front — those are only surfaced through the selection/hint endpoints.
        .select("-steps.hints -steps.misconceptionRisks -requiredEquipment -requiredChemicals -reactionId -steps.requiredChemicalsForStep -steps.expectedAction")
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
// Excludes requiredEquipment/requiredChemicals/reactionId and steps[].requiredChemicalsForStep/
// expectedAction — those are the "answers" the equipment/chemical-selection and mix-grading
// endpoints evaluate against, and must never be visible to the client ahead of submission.
const getExperimentById = async (req, res, next) => {
  try {
    const experiment = await Experiment.findById(req.params.id)
      .select("-requiredEquipment -requiredChemicals -reactionId -steps.requiredChemicalsForStep -steps.expectedAction")
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

// GET /api/experiments/:experimentId/compounds/:compoundId/build-template
// Returns the blank-coefficient equation skeleton for the Compound Builder — reactant/product
// formulas only, never the correct coefficients themselves (those are graded server-side by
// POST /api/sessions/:id/compound-builds, same "backend stays source of truth" principle as
// reactionEngine.js). coefficientOptions is a fixed 1-4 tray regardless of the compound, so its
// size never hints at how many blanks need a repeated or higher value.
const getCompoundBuildTemplate = async (req, res, next) => {
  try {
    const { experimentId, compoundId } = req.params;

    const experiment = await Experiment.findById(experimentId).select("_id").lean();
    if (!experiment) return res.status(404).json({ success: false, message: "Experiment not found." });

    const compound = await Chemical.findById(compoundId).lean();
    if (!compound) return res.status(404).json({ success: false, message: "Compound not found." });
    if (!compound.isBuildableFromElements || !compound.buildReactionId) {
      return res.status(400).json({ success: false, message: "This compound isn't buildable from elements." });
    }

    const reaction = await Reaction.findById(compound.buildReactionId)
      .populate("reactants.chemical", "name symbol color")
      .populate("products.chemical", "name symbol color")
      .lean();
    if (!reaction) return res.status(404).json({ success: false, message: "Build reaction not found." });

    res.status(200).json({
      success: true,
      data: {
        compound: { _id: compound._id, name: compound.name, symbol: compound.symbol, formula: compound.formula, color: compound.color },
        reactants: reaction.reactants.map((r) => ({
          chemicalId: r.chemical._id,
          name: r.chemical.name,
          symbol: r.chemical.symbol,
          color: r.chemical.color,
        })),
        products: reaction.products.map((p) => ({
          chemicalId: p.chemical._id,
          name: p.chemical.name,
          symbol: p.chemical.symbol,
          color: p.chemical.color,
        })),
        coefficientOptions: [1, 2, 3, 4],
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getExperiments, getExperimentById, getExperimentsBySubject, getCompoundBuildTemplate };
