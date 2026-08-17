const mongoose = require("mongoose");
const Session = require("../models/Session");
const Action = require("../models/Action");
const Experiment = require("../models/Experiment");
const User = require("../models/User");
const Chemical = require("../models/Chemical");
const Reaction = require("../models/Reaction");
const LabRun = require("../models/LabRun");
const { analyzeSession } = require("../services/aiService");
const { generateFeedback } = require("../services/feedbackService");
const {
  generateSelectionHint,
  generateCompoundBuildHint,
  classifyCompoundBuildMistake,
  generateEquipmentHint,
  generateChemicalHint,
} = require("../services/labHintService");

// Reads the live bench (LabRun.equipment) once and evaluates a step's requiredEquipment /
// requiredChemicalsForStep against it — the single source of truth both logAction (does this
// attempt complete the step) and requestHint (which kind of hint is actually relevant right now)
// build on, so the two never disagree about what's missing. Chemical presence is checked
// bench-wide (any equipment instance's contents), not per-container, since the workspace's
// drag-drop model doesn't simulate transferring a chemical between containers — dropping it onto
// any instance counts as "introduced." Equipment presence is likewise bench-wide: any instance
// whose type is in requiredEquipment satisfies that requirement, regardless of which instance the
// chemicals ended up in.
const evaluateStepOnBench = async (step, labRunId) => {
  const labRun = labRunId ? await LabRun.findById(labRunId).select("equipment reactionsTriggered").lean() : null;
  const benchEquipmentTypes = [...new Set((labRun?.equipment || []).map((e) => e.equipmentType))];
  const benchChemicalIds = [
    ...new Set((labRun?.equipment || []).flatMap((e) => e.contents.map((c) => c.chemical.toString()))),
  ];

  const requiredEquipment = step?.requiredEquipment || [];
  const requiredChemicals = (step?.requiredChemicalsForStep || []).map((id) => id.toString());

  const equipmentOk = requiredEquipment.every((e) => benchEquipmentTypes.includes(e));
  const chemicalsOk = requiredChemicals.every((id) => benchChemicalIds.includes(id));

  return { labRun, benchEquipmentTypes, benchChemicalIds, equipmentOk, chemicalsOk };
};

// 100 minus deductions for equipment/chemical mistakes and hints used on this step, floored at 0.
// Weights are deliberately simple/tunable: a student who solves a step first try with no help
// scores 100; repeated wrong attempts and higher hint levels pull the step score down, so the
// session-level score (average of these, see completeSession) reflects HOW a student got to the
// right answer, not just whether they eventually did.
const computeStepScore = (stepEntry) => {
  const mistakePenalty = 15 * (stepEntry.equipmentMistakes + stepEntry.chemicalMistakes);
  const hintPenalty = 10 * stepEntry.highestHintLevel;
  return Math.max(0, 100 - mistakePenalty - hintPenalty);
};

// Finds this step's stepProgress entry, creating it (with startedAt) on first touch.
const getOrCreateStepProgress = (session, stepId) => {
  let entry = session.stepProgress.find((sp) => sp.stepId === stepId);
  if (!entry) {
    session.stepProgress.push({ stepId, startedAt: new Date() });
    entry = session.stepProgress[session.stepProgress.length - 1];
  }
  return entry;
};

// POST /api/sessions/start
const startSession = async (req, res, next) => {
  try {
    const { experimentId } = req.body;
    if (!experimentId) return res.status(400).json({ success: false, message: "experimentId is required." });

    const experiment = await Experiment.findById(experimentId);
    if (!experiment) return res.status(404).json({ success: false, message: "Experiment not found." });

    // Each "start" is a brand-new attempt, never a resume — abandon any prior in-progress
    // attempt at this same practical (and its live bench) rather than reusing it. The abandoned
    // Session/LabRun and their Actions are left in place, not deleted, so per-attempt behavioral
    // data (errors, hints, misconceptions, AI feedback) stays available for analytics.
    const staleSessions = await Session.find({
      userId: req.user._id,
      experimentId,
      status: "in_progress",
    });
    for (const stale of staleSessions) {
      stale.status = "abandoned";
      stale.endTime = new Date();
      await stale.save();

      if (stale.labRunId) {
        await LabRun.updateOne(
          { _id: stale.labRunId, status: "active" },
          { $set: { status: "abandoned", endedAt: new Date() } }
        );
      }
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
    if (selectedEquipment.length === 0) {
      return res.status(400).json({ success: false, message: "Please select at least one laboratory equipment to continue." });
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

    // Equipment selection is a learning/preparation step, not a gate — any non-empty selection
    // advances the student to chemical selection. The correct/missing/unnecessary comparison
    // above is still recorded on the session for analytics, misconception detection, and
    // feedback, exactly as before; it just no longer blocks entry. The full equipment set stays
    // reachable from the workspace's equipment drawer at any time, so an imperfect pick here is
    // never a dead end.
    const fullyCorrect = missing.length === 0 && unnecessary.length === 0;
    session.phase = "chemical_selection";
    await session.save();

    if (fullyCorrect) {
      return res.status(200).json({
        success: true,
        data: { fullyCorrect: true, correct, missingCount: 0, unnecessaryItems: [], hint: null, nextPhase: session.phase },
      });
    }

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
        fullyCorrect: false,
        correct,
        unnecessaryItems: unnecessary, // safe to reveal — these are the student's own choices
        missingCount: missing.length, // count only — names are withheld, per the guidance design
        hint,
        nextPhase: session.phase,
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

    // Compounds flagged isBuildableFromElements are satisfied by a completed build (see
    // submitCompoundBuild below), not by tapping a select chip — split the required set so
    // they're excluded from the ordinary "did you select the right chips" grading below.
    const requiredChemicalDocs = requiredIds.length
      ? await Chemical.find({ _id: { $in: requiredIds } }).select("isBuildableFromElements").lean()
      : [];
    const buildableRequiredIds = requiredChemicalDocs
      .filter((c) => c.isBuildableFromElements)
      .map((c) => c._id.toString());
    const selectableRequiredIds = requiredIds.filter((id) => !buildableRequiredIds.includes(id));

    const correct = selectedChemicalIds.filter((id) => selectableRequiredIds.includes(id));
    const missing = selectableRequiredIds.filter((id) => !selectedChemicalIds.includes(id));
    const unnecessary = selectedChemicalIds.filter(
      (id) => !selectableRequiredIds.includes(id) && !buildableRequiredIds.includes(id)
    );

    const builtIds = (session.builtCompounds || [])
      .filter((b) => b.completedAt)
      .map((b) => b.chemical.toString());
    const missingBuilds = buildableRequiredIds.filter((id) => !builtIds.includes(id));

    session.chemicalSelection.selected = selectedChemicalIds;
    session.chemicalSelection.correct = correct;
    session.chemicalSelection.missing = missing;
    session.chemicalSelection.unnecessary = unnecessary;
    session.chemicalSelection.attempts += 1;

    const isComplete = missing.length === 0 && unnecessary.length === 0 && missingBuilds.length === 0;
    if (isComplete) {
      session.phase = "procedure";
      await session.save();
      return res.status(200).json({
        success: true,
        data: { complete: true, correct, unnecessaryCount: 0, missingCount: 0, missingBuildsCount: 0, nextPhase: session.phase },
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
      missingCount: missing.length + missingBuilds.length,
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
        // Count only — which compound(s) still need building is withheld, same "no names
        // revealed" principle as missingCount above; the student discovers it by attempting
        // builds via the Compound Builder.
        missingBuildsCount: missingBuilds.length,
        hint,
      },
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/sessions/:id/compound-builds
// Body: { compoundId, reactantCoefficients: [{ chemicalId, coefficient }], productCoefficient }
// Grades a Compound Builder attempt against the compound's linked synthesis Reaction — the
// backend remains the source of truth on whether the equation balances, same principle as
// reactionEngine.js/logAction's server-side mix grading.
const submitCompoundBuild = async (req, res, next) => {
  try {
    const { compoundId, reactantCoefficients, productCoefficient } = req.body;
    if (!compoundId || !Array.isArray(reactantCoefficients) || typeof productCoefficient !== "number") {
      return res
        .status(400)
        .json({ success: false, message: "compoundId, reactantCoefficients, and productCoefficient are required." });
    }

    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: "Session not found." });

    const compound = await Chemical.findById(compoundId).lean();
    if (!compound) return res.status(404).json({ success: false, message: "Compound not found." });
    if (!compound.isBuildableFromElements || !compound.buildReactionId) {
      return res.status(400).json({ success: false, message: "This compound isn't buildable from elements." });
    }

    const reaction = await Reaction.findById(compound.buildReactionId).lean();
    if (!reaction) return res.status(404).json({ success: false, message: "Build reaction not found." });

    let entry = session.builtCompounds.find((b) => b.chemical.toString() === compoundId);
    if (!entry) {
      session.builtCompounds.push({ chemical: compoundId, attempts: 0, completedAt: null });
      entry = session.builtCompounds[session.builtCompounds.length - 1];
    }
    entry.attempts += 1;

    const correctReactants = reaction.reactants
      .map((r) => `${r.chemical.toString()}:${r.coefficient}`)
      .sort();
    const submittedReactants = reactantCoefficients
      .map((r) => `${r.chemicalId}:${r.coefficient}`)
      .sort();
    const reactantsMatch =
      correctReactants.length === submittedReactants.length &&
      correctReactants.every((val, i) => val === submittedReactants[i]);

    const productEntry = reaction.products.find((p) => p.chemical.toString() === compoundId);
    const productMatches = !!productEntry && productCoefficient === productEntry.coefficient;

    const isCorrect = reactantsMatch && productMatches;

    if (isCorrect) {
      entry.completedAt = new Date();
      await session.save();

      return res.status(200).json({
        success: true,
        data: {
          correct: true,
          attempts: entry.attempts,
          compound: { name: compound.name, symbol: compound.symbol },
          balancedEquation: reaction.balancedEquation,
          educationalInfo: reaction.educationalInfo,
        },
      });
    }

    const misconceptionCode = classifyCompoundBuildMistake({ reactantCoefficients, productCoefficient });
    entry.lastMisconceptionCode = misconceptionCode;

    await session.save();

    const hint = await generateCompoundBuildHint({ compoundName: compound.name, attempts: entry.attempts, misconceptionCode });

    res.status(200).json({
      success: true,
      data: { correct: false, attempts: entry.attempts, hint },
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/sessions/:id/action
const logAction = async (req, res, next) => {
  try {
    let { stepId, actionType, actionDetail, expectedAction, timeTaken, hintLevel, conceptViolated } = req.body;
    const { equipmentType, chemicalIds, quantity, unit } = req.body;

    const session = await Session.findById(req.params.id).populate("experimentId");
    if (!session) return res.status(404).json({ success: false, message: "Session not found." });
    if (session.status !== "in_progress")
      return res.status(400).json({ success: false, message: "Session is not in progress." });

    const experiment = session.experimentId;
    const step = experiment.steps.find((s) => s.stepId === stepId);

    // The server determines correctness for every step type from the live bench — it never trusts
    // a client-submitted "correct" claim (see evaluateStepOnBench). mismatchKind drives which
    // non-revealing hint (if any) comes back below: an equipment gap takes priority over a chemical
    // one, since a student can't have added the right chemical to equipment they haven't placed yet.
    let reactionResult = null;
    let mismatchKind = null;
    let benchEquipmentTypes = [];

    if (step) {
      const evalResult = await evaluateStepOnBench(step, session.labRunId);
      benchEquipmentTypes = evalResult.benchEquipmentTypes;

      if (!evalResult.equipmentOk) {
        actionType = "incorrect";
        mismatchKind = "equipment";
        conceptViolated = conceptViolated || "LAB_MISSING_EQUIPMENT";
      } else if (step.actionType === "mix" && step.requiredChemicalsForStep?.length > 0) {
        // Equipment (and, per evalResult, ingredient presence) checks out — "mix" steps additionally
        // require the actual reaction to have fired on the bench (reactionEngine.js), which is
        // stricter chemistry grading than presence alone.
        const { buildReactantKey, serializeReactionMatch } = require("../services/reactionEngine");
        const requiredKey = buildReactantKey(step.requiredChemicalsForStep.map((id) => id.toString()));
        const matchedReaction = evalResult.labRun?.reactionsTriggered?.length
          ? await Reaction.findOne({ _id: { $in: evalResult.labRun.reactionsTriggered }, reactantKey: requiredKey })
              .populate("reactants.chemical")
              .populate("products.chemical")
          : null;

        actionType = matchedReaction ? "correct" : "incorrect";
        if (!matchedReaction) {
          conceptViolated = conceptViolated || "CHEM_WRONG_REACTANTS";
          // If the ingredients aren't even present yet, that's the more useful/specific hint;
          // once they are but the reaction still hasn't fired, fall through to the existing
          // unknown_combination intervention below instead of a generic chemical hint.
          if (!evalResult.chemicalsOk) mismatchKind = "chemical";
        }

        reactionResult = matchedReaction
          ? serializeReactionMatch(matchedReaction)
          : {
              found: false,
              reason: "not_yet_triggered_on_bench",
              explanation: "This combination hasn't happened on your bench yet — try it there first.",
              hint: null,
            };
      } else if (!evalResult.chemicalsOk) {
        actionType = "incorrect";
        mismatchKind = "chemical";
        conceptViolated = conceptViolated || "LAB_MISSING_CHEMICAL";
      } else {
        actionType = "correct";
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

    // Per-step behavioral tracking (Session.stepProgress) — mistakes/hints/timing feed both the
    // automatic hint below and completeSession's scoring (computeStepScore). autoHintLevel is
    // computed here (mistakes so far, capped at 3) so the intervention block below and the score
    // deduction always agree on what level was actually shown.
    const stepEntry = step ? getOrCreateStepProgress(session, stepId) : null;
    let autoHintLevel = null;
    if (stepEntry && actionType === "incorrect" && mismatchKind) {
      if (mismatchKind === "equipment") stepEntry.equipmentMistakes += 1;
      else if (mismatchKind === "chemical") stepEntry.chemicalMistakes += 1;
      stepEntry.solvedIndependently = false;
      autoHintLevel = Math.min(stepEntry.equipmentMistakes + stepEntry.chemicalMistakes, 3);
      stepEntry.highestHintLevel = Math.max(stepEntry.highestHintLevel, autoHintLevel);
    }

    // Advance step if correct — incorrect attempts (wrong equipment, wrong chemical, or an
    // unfired reaction) never advance currentStep, so the next step stays locked until this one is
    // genuinely satisfied.
    if (actionType === "correct" && stepId === session.currentStep) {
      session.currentStep = stepId + 1;
    }
    if (stepEntry && actionType === "correct" && !stepEntry.completedAt) {
      stepEntry.completedAt = new Date();
      stepEntry.timeSpentSeconds = stepEntry.startedAt
        ? Math.round((stepEntry.completedAt.getTime() - stepEntry.startedAt.getTime()) / 1000)
        : timeTaken || 0;
      stepEntry.stepScore = computeStepScore(stepEntry);
    }

    await session.save();

    // Real-time hint trigger: if 2+ errors on same step, suggest hint
    const stepErrors = await Action.countDocuments({ sessionId: session._id, stepId, actionType: "incorrect" });
    const suggestHint = stepErrors >= 2;

    // Event-driven proactive intervention — at most one per action, checked in priority order. A
    // step-level equipment/chemical mismatch (detected above) always takes priority: it's the most
    // specific, directly-actionable signal, and fires on the very first wrong attempt rather than
    // waiting for repeated mistakes, escalating level with each subsequent one (Stage 4/5).
    let intervention = null;
    const { generateInterventionHint } = require("../services/labHintService");

    if (mismatchKind === "equipment") {
      intervention = {
        type: "equipment_hint",
        hint: await generateEquipmentHint({
          experimentTitle: experiment.title,
          stepTitle: step.title,
          stepInstruction: step.instruction,
          stepActionType: step.actionType,
          requiredEquipment: step.requiredEquipment,
          benchEquipmentTypes,
          level: autoHintLevel,
        }),
      };
    } else if (mismatchKind === "chemical") {
      const requiredChemicalDocs = step.requiredChemicalsForStep?.length
        ? await Chemical.find({ _id: { $in: step.requiredChemicalsForStep } }).select("category").lean()
        : [];
      intervention = {
        type: "chemical_hint",
        hint: await generateChemicalHint({
          experimentTitle: experiment.title,
          stepTitle: step.title,
          stepInstruction: step.instruction,
          stepActionType: step.actionType,
          requiredChemicalCategories: [...new Set(requiredChemicalDocs.map((c) => c.category))],
          level: autoHintLevel,
        }),
      };
    } else if (step?.actionType === "mix" && reactionResult && !reactionResult.found && reactionResult.reason === "no_known_reaction") {
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

    // Score is the average of each step's stepScore (100 minus mistake/hint deductions, see
    // computeStepScore) — a student who solves every step first-try with no hints scores 100; one
    // who needed several wrong attempts and hints on the way to the same correct end state scores
    // lower, per the "hints/mistakes affect performance score, but never block completion" design.
    // Falls back to the old binary correct/totalSteps formula only if stepProgress is somehow empty
    // (e.g. an experiment without step-level data) so this never divides by zero or breaks scoring.
    const totalSteps = session.experimentId.steps.length;
    const score = session.stepProgress.length
      ? Math.round(session.stepProgress.reduce((sum, sp) => sum + sp.stepScore, 0) / session.stepProgress.length)
      : Math.round((allActions.filter((a) => a.actionType === "correct").length / totalSteps) * 100);

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
      .populate(
        "experimentId",
        "-requiredEquipment -requiredChemicals -reactionId -steps.expectedAction -steps.requiredChemicalsForStep -steps.requiredEquipment"
      )
      .lean();
    if (!session) return res.status(404).json({ success: false, message: "Session not found." });
    res.status(200).json({ success: true, data: session });
  } catch (error) {
    next(error);
  }
};

// GET /api/sessions/user/history
// GET /api/sessions/history
// Query params: subject, grade, status (default "completed"), dateFrom, dateTo, scoreMin, scoreMax, page, limit
// Uses an aggregation (rather than find+populate) because subject/grade filters live on the
// populated Experiment, not the Session itself — a $lookup is required to filter on them.
const getUserSessions = async (req, res, next) => {
  try {
    const { subject, grade, status = "completed", dateFrom, dateTo, scoreMin, scoreMax, page = 1, limit = 20 } = req.query;
    const parsedLimit = Math.min(parseInt(limit) || 20, 50);
    const parsedPage = parseInt(page) || 1;
    const skip = (parsedPage - 1) * parsedLimit;

    const sessionMatch = { userId: new mongoose.Types.ObjectId(req.user._id) };
    if (status) sessionMatch.status = status;
    if (dateFrom || dateTo) {
      sessionMatch.createdAt = {};
      if (dateFrom) sessionMatch.createdAt.$gte = new Date(dateFrom);
      if (dateTo) sessionMatch.createdAt.$lte = new Date(dateTo);
    }
    if (scoreMin !== undefined || scoreMax !== undefined) {
      sessionMatch.score = {};
      if (scoreMin !== undefined) sessionMatch.score.$gte = parseInt(scoreMin);
      if (scoreMax !== undefined) sessionMatch.score.$lte = parseInt(scoreMax);
    }

    const experimentMatch = {};
    if (subject) experimentMatch["experiment.subject"] = subject;
    if (grade) experimentMatch["experiment.grades"] = parseInt(grade);

    const pipeline = [
      { $match: sessionMatch },
      { $lookup: { from: "experiments", localField: "experimentId", foreignField: "_id", as: "experiment" } },
      { $unwind: "$experiment" },
      ...(Object.keys(experimentMatch).length ? [{ $match: experimentMatch }] : []),
      { $sort: { createdAt: -1 } },
      {
        $facet: {
          data: [
            { $skip: skip },
            { $limit: parsedLimit },
            {
              $project: {
                score: 1,
                totalTime: 1,
                createdAt: 1,
                attemptNumber: 1,
                "aiFeedback.summary": 1,
                experimentId: {
                  _id: "$experiment._id",
                  title: "$experiment.title",
                  subject: "$experiment.subject",
                  difficulty: "$experiment.difficulty",
                  thumbnailColor: "$experiment.thumbnailColor",
                },
              },
            },
          ],
          total: [{ $count: "count" }],
        },
      },
    ];

    const [result] = await Session.aggregate(pipeline);
    const sessions = result?.data || [];
    const total = result?.total?.[0]?.count || 0;

    res.status(200).json({ success: true, data: sessions, pagination: { total, page: parsedPage } });
  } catch (error) {
    next(error);
  }
};

// GET /api/sessions/stats — dashboard summary: best score, total completed sessions, and the
// most recently completed practical. "Completed" counts sessions, not distinct experiments —
// a student can complete the same practical more than once.
const getSessionStats = async (req, res, next) => {
  try {
    const completed = await Session.find({ userId: req.user._id, status: "completed" })
      .populate("experimentId", "title subject difficulty thumbnailColor")
      .select("score totalTime createdAt attemptNumber experimentId")
      .sort({ createdAt: -1 })
      .lean();

    const bestScore = completed.length ? Math.max(...completed.map((s) => s.score)) : null;

    res.status(200).json({
      success: true,
      data: {
        bestScore,
        completedCount: completed.length,
        lastCompletedPractical: completed[0] || null,
      },
    });
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

    // Steps with requiredEquipment/requiredChemicalsForStep get a dynamic, context-aware hint
    // (bench state + step purpose, via Gemini) instead of static authored text — see
    // labHintService.js. Which of equipment/chemical is actually missing right now (same check
    // logAction uses) decides which hint fires; if both are already satisfied, fall back to the
    // equipment-flavored hint anyway (still useful — "how to use what you have"). Any step with
    // neither field (none currently, but defensive for future data) falls back to the original
    // static per-step hints.
    let hintText;
    if (step.requiredEquipment?.length > 0 || step.requiredChemicalsForStep?.length > 0) {
      const { equipmentOk, chemicalsOk, benchEquipmentTypes } = await evaluateStepOnBench(step, session.labRunId);

      if (!equipmentOk || chemicalsOk) {
        hintText = await generateEquipmentHint({
          experimentTitle: session.experimentId.title,
          stepTitle: step.title,
          stepInstruction: step.instruction,
          stepActionType: step.actionType,
          requiredEquipment: step.requiredEquipment || [],
          benchEquipmentTypes,
          level: hintLevel,
        });
      } else {
        const requiredChemicalDocs = await Chemical.find({ _id: { $in: step.requiredChemicalsForStep } })
          .select("category")
          .lean();
        hintText = await generateChemicalHint({
          experimentTitle: session.experimentId.title,
          stepTitle: step.title,
          stepInstruction: step.instruction,
          stepActionType: step.actionType,
          requiredChemicalCategories: [...new Set(requiredChemicalDocs.map((c) => c.category))],
          level: hintLevel,
        });
      }
    } else {
      const hint = step.hints.find((h) => h.level === hintLevel) || step.hints[0];
      hintText = hint?.text || "Think about what you need to do next.";
    }

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
    const stepEntry = getOrCreateStepProgress(session, stepId);
    stepEntry.hintsRequested += 1;
    stepEntry.highestHintLevel = Math.max(stepEntry.highestHintLevel, hintLevel);
    stepEntry.solvedIndependently = false;
    await session.save();

    res.status(200).json({
      success: true,
      data: { hintLevel, hintText, stepId },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  startSession,
  submitEquipmentSelection,
  submitChemicalSelection,
  submitCompoundBuild,
  logAction,
  completeSession,
  getSession,
  getSessionReport,
  getUserSessions,
  getSessionStats,
  requestHint,
};
