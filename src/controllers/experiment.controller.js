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
        // Exclude fields that would reveal the equipment/chemical selection answers or step/task
        // answers — steps.microSteps.* mirrors the steps.* exclusions one level down (see
        // getSession in session.controller.js for the matching set).
        .select(
          "-steps.hints -steps.misconceptionRisks -requiredEquipment -requiredChemicals -reactionId -steps.requiredChemicalsForStep -steps.expectedAction -steps.requiredEquipment -steps.exactAnswer -steps.observationGoal -curriculumRefs -curriculumRefsGeneratedAt -steps.curriculumRefs -steps.microSteps.expectedIntent -steps.microSteps.expectedEquipment -steps.microSteps.expectedChemicalsForStep -steps.microSteps.hints -steps.microSteps.exactAnswer -steps.microSteps.expectedMeasurement -steps.microSteps.expectedTransfer"
        )
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

// GET /api/experiments/:id/info — "read before you experiment" pre-lab view. Unlike
// getExperimentById below, this deliberately includes requiredEquipment/requiredChemicals
// (and theory/keyConcepts), since it's shown outside the equipment/chemical-selection UI and
// isn't testing the student — it's meant to prepare them before they start the guided flow.
const getExperimentInfo = async (req, res, next) => {
  try {
    const experiment = await Experiment.findById(req.params.id)
      .select(
        "title subject grades difficulty estimatedTime description objectives lesson theory keyConcepts requiredEquipment requiredChemicals expectedObservations safetyInformation thumbnailColor"
      )
      .populate("requiredChemicals.chemical", "name symbol formula category state safetyClassification hazardInfo")
      .lean();

    if (!experiment) {
      return res.status(404).json({ success: false, message: "Experiment not found." });
    }

    res.status(200).json({ success: true, data: experiment });
  } catch (error) {
    next(error);
  }
};

// GET /api/experiments/:id

const getExperimentById = async (req, res, next) => {
  try {
    const experiment = await Experiment.findById(req.params.id)
      .select(
        "-requiredEquipment -requiredChemicals -reactionId -steps.requiredChemicalsForStep -steps.expectedAction -steps.requiredEquipment -steps.exactAnswer -steps.observationGoal -curriculumRefs -curriculumRefsGeneratedAt -steps.curriculumRefs -steps.microSteps.expectedIntent -steps.microSteps.expectedEquipment -steps.microSteps.expectedChemicalsForStep -steps.microSteps.hints -steps.microSteps.exactAnswer -steps.microSteps.expectedMeasurement -steps.microSteps.expectedTransfer"
      )
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

    // Not grade-filtered — this app targets Grade 10/11 students exclusively, so there's no
    // narrower audience to gate content against.
    const experiments = await Experiment.find({
      subject,
      isActive: true,
      // Excludes legacy/generic experiments (e.g. "Acid-Base Titration", "Separating Mixtures by
      // Filtration" in data/experiments.js) that predate the equipment/chemical-selection guided
      // flow and were never given a requiredEquipment list — without this, a student could open
      // one and find equipment selection impossible to pass, since every item they pick would be
      // flagged "unnecessary" against an empty requirements list.
      "requiredEquipment.0": { $exists: true },
    })
      .select("title difficulty estimatedTime description thumbnailColor totalAttempts averageScore grades")
      .sort({ difficulty: 1 })
      .lean();

    res.status(200).json({ success: true, data: experiments });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DEV ONLY — GET /api/experiments/:id/walkthrough
//
// Returns the FULL solution to a practical: every answer-bearing field the normal
// experiment endpoints deliberately withhold (per-step & per-task expected equipment,
// expected chemicals, exact answers, the hint ladder, transfer specs, expected
// measurements). It exists so a developer testing/debugging a practical can see exactly
// how it is meant to be completed without knowing the underlying science.
//
// Gated behind a dev flag: responds 404 in production (NODE_ENV === "production" and no
// ENABLE_DEV_WALKTHROUGH=true), so the route is invisible there.
//
// REMOVE THIS BLOCK (+ the route + the mobile DevWalkthrough* files) before the app ships.
// ─────────────────────────────────────────────────────────────────────────────
const devWalkthroughEnabled = () =>
  process.env.NODE_ENV !== "production" || process.env.ENABLE_DEV_WALKTHROUGH === "true";

const humanizeEquipmentKey = (key) =>
  String(key || "")
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

const getExperimentWalkthrough = async (req, res, next) => {
  try {
    if (!devWalkthroughEnabled()) {
      return res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` });
    }

    const experiment = await Experiment.findById(req.params.id).lean();
    if (!experiment) {
      return res.status(404).json({ success: false, message: "Experiment not found." });
    }

    // Collect every chemical ObjectId referenced anywhere in the practical, resolve in one query.
    const chemIds = new Set();
    (experiment.requiredChemicals || []).forEach((rc) => rc.chemical && chemIds.add(String(rc.chemical)));
    (experiment.steps || []).forEach((step) => {
      (step.requiredChemicalsForStep || []).forEach((id) => chemIds.add(String(id)));
      (step.microSteps || []).forEach((ms) => {
        (ms.expectedChemicalsForStep || []).forEach((id) => chemIds.add(String(id)));
        if (ms.expectedTransfer && ms.expectedTransfer.sourceChemical) chemIds.add(String(ms.expectedTransfer.sourceChemical));
      });
    });

    const chemicals = await Chemical.find({ _id: { $in: [...chemIds] } })
      .select("name symbol formula state color")
      .lean();
    const chemMap = {};
    chemicals.forEach((c) => {
      chemMap[String(c._id)] = { name: c.name, symbol: c.symbol, formula: c.formula, state: c.state, color: c.color };
    });

    const resolveChem = (id) => chemMap[String(id)] || { name: "Unknown chemical", symbol: String(id), formula: null };
    const resolveEquip = (key) => ({ key, name: humanizeEquipmentKey(key) });

    const walkthrough = {
      _id: experiment._id,
      title: experiment.title,
      subject: experiment.subject,
      difficulty: experiment.difficulty,
      materials: experiment.materials || [],
      requiredEquipment: (experiment.requiredEquipment || []).map(resolveEquip),
      optionalEquipment: (experiment.optionalEquipment || []).map(resolveEquip),
      requiredChemicals: (experiment.requiredChemicals || []).map((rc) => ({
        ...resolveChem(rc.chemical),
        quantity: rc.quantity ?? null,
        unit: rc.unit ?? null,
      })),
      expectedObservations: experiment.expectedObservations || [],
      steps: (experiment.steps || [])
        .slice()
        .sort((a, b) => a.stepId - b.stepId)
        .map((step) => ({
          stepId: step.stepId,
          title: step.title,
          instruction: step.instruction,
          actionType: step.actionType,
          expectedAction: step.expectedAction,
          circuitBoardId: step.circuitBoardId || null,
          requiredEquipment: (step.requiredEquipment || []).map(resolveEquip),
          requiredChemicals: (step.requiredChemicalsForStep || []).map(resolveChem),
          observationGoal: step.observationGoal || "",
          exactAnswer: step.exactAnswer || "",
          hints: (step.hints || []).slice().sort((a, b) => (a.level || 0) - (b.level || 0)),
          microSteps: (step.microSteps || [])
            .slice()
            .sort((a, b) => a.microStepId - b.microStepId)
            .map((ms) => ({
              microStepId: ms.microStepId,
              studentPrompt: ms.studentPrompt,
              expectedIntent: ms.expectedIntent,
              expectedEquipment: (ms.expectedEquipment || []).map(resolveEquip),
              expectedChemicals: (ms.expectedChemicalsForStep || []).map(resolveChem),
              requiresReactionCheck: !!ms.requiresReactionCheck,
              requiresMeasurementCheck: !!ms.requiresMeasurementCheck,
              expectedMeasurement:
                ms.expectedMeasurement && ms.expectedMeasurement.metric ? ms.expectedMeasurement : null,
              expectedTransfer:
                ms.expectedTransfer && (ms.expectedTransfer.method || ms.expectedTransfer.instrumentCategory)
                  ? {
                      method: ms.expectedTransfer.method || null,
                      instrumentCategory: ms.expectedTransfer.instrumentCategory || null,
                      minDispenses: ms.expectedTransfer.minDispenses ?? 1,
                      sourceChemical: ms.expectedTransfer.sourceChemical
                        ? resolveChem(ms.expectedTransfer.sourceChemical)
                        : null,
                    }
                  : null,
              hints: (ms.hints || []).slice().sort((a, b) => (a.level || 0) - (b.level || 0)),
              exactAnswer: ms.exactAnswer || "",
            })),
        })),
    };

    res.status(200).json({ success: true, data: walkthrough });
  } catch (error) {
    next(error);
  }
};

// GET /api/experiments/:experimentId/compounds/:compoundId/build-template

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

module.exports = {
  getExperiments,
  getExperimentById,
  getExperimentInfo,
  getExperimentsBySubject,
  getCompoundBuildTemplate,
  getExperimentWalkthrough, // DEV ONLY — remove before shipping
};
