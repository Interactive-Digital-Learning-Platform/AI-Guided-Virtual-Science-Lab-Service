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
const scoring = require("../services/labScoringService");
const flags = require("../config/featureFlags");
const studentModelRunner = require("../services/studentModelRunner");
const { resolvePhysicsMeasurement: resolveMechanicsMeasurement, checkMeasurementTolerance } = require("../services/mechanicsEngine");
const { resolvePhysicsMeasurement: resolveCircuitMeasurement, evaluateBoard } = require("../services/circuitEngine");

// Each engine only knows how to resolve its own metrics — dispatch by metric name rather than by
// subject/evaluationEngine, so a microStep's expectedMeasurement.metric alone determines which
// engine's bench-reading logic applies (mirrors mechanicsEngine.js/circuitEngine.js each owning a
// disjoint metric set).
const CIRCUIT_METRICS = new Set(["current", "voltage", "resistance"]);
const resolvePhysicsMeasurement = (args) =>
  CIRCUIT_METRICS.has(args.metric) ? resolveCircuitMeasurement(args) : resolveMechanicsMeasurement(args);
const {
  generateSelectionHint,
  generateCompoundBuildHint,
  classifyCompoundBuildMistake,
  generateEquipmentHint,
  generateChemicalHint,
  generateTaskHint,
  generateCircuitHint,
  generateMisconceptionHint,
} = require("../services/labHintService");
const studentModelService = require("../services/studentModelService");
const {
  curriculumReferenceForStep,
  practicalCurriculumReference,
  buildFollowUpReading,
} = require("../services/curriculumReferenceService");

// Reads the live bench (LabRun.equipment) once and evaluates a *set of requirements* against it —
// the single source of truth both logAction (does this attempt complete the current unit) and
// requestHint (which kind of hint is actually relevant right now) build on, so the two never
// disagree about what's missing. Chemical presence is checked bench-wide (any equipment instance's
// contents), not per-container, since the workspace's drag-drop model doesn't simulate transferring
// a chemical between containers — dropping it onto any instance counts as "introduced." Equipment
// presence is likewise bench-wide: any instance whose type is in requiredEquipment satisfies that
// requirement, regardless of which instance the chemicals ended up in.
//
// Deliberately parameterized on a plain { equipment, chemicals } pair rather than a step/microStep
// doc directly — resolveGradingTarget below decides which requirement set applies (a microStep's
// own expectedEquipment/expectedChemicalsForStep when the step has been migrated, or the whole
// step's requiredEquipment/requiredChemicalsForStep otherwise), so this stays agnostic to that.
const evaluateOnBench = async ({ equipment: requiredEquipment = [], chemicals: requiredChemicalIds = [] }, labRunId) => {
  const labRun = labRunId
    ? await LabRun.findById(labRunId)
        .select("equipment physicsEquipment circuitBoardState reactionsTriggered actions materials")
        .lean()
    : null;
  // Equipment presence is checked across both bench-state arrays — a physics LabRun only ever
  // populates physicsEquipment, a chemistry one only ever populates equipment, so unioning them
  // is safe for both subjects (see physicsInstanceSchema in LabRun.js for why they're separate).
  const benchEquipmentTypes = [
    ...new Set([
      ...(labRun?.equipment || []).map((e) => e.equipmentType),
      ...(labRun?.physicsEquipment || []).map((e) => e.equipmentType),
    ]),
  ];
  const benchChemicalIds = [
    ...new Set((labRun?.equipment || []).flatMap((e) => e.contents.map((c) => c.chemical.toString()))),
  ];

  const requiredChemicals = requiredChemicalIds.map((id) => id.toString());

  const equipmentOk = requiredEquipment.every((e) => benchEquipmentTypes.includes(e));
  const chemicalsOk = requiredChemicals.every((id) => benchChemicalIds.includes(id));

  // The LabRun material inventory (non-blocking selection): a required chemical the student never
  // brought into the lab at all is a *different* situation from one they have but haven't added
  // to a container yet — the hint layer uses this to nudge toward the Material Library vs. toward
  // the bench, without ever naming the material. An empty inventory (legacy run not seeded) means
  // "can't tell" → treat as available so hints stay unchanged for old sessions.
  const inventoryIds = new Set((labRun?.materials || []).map((m) => m.chemical.toString()));
  const materialsInInventoryOk =
    inventoryIds.size === 0 || requiredChemicals.every((id) => inventoryIds.has(id));

  return { labRun, benchEquipmentTypes, benchChemicalIds, equipmentOk, chemicalsOk, materialsInInventoryOk };
};

// Resolves what "the current unit of work" actually requires for a given step, given the
// session's authoritative currentMicroStep — the one place that decides between the new
// micro-step-scoped grading and the legacy whole-step grading (steps with no microSteps defined,
// i.e. practicals not yet migrated — see chemistryPracticals.js vs data/experiments.js). Returns
// null microStep when the step has no microSteps, in which case callers grade the step itself
// exactly as before microSteps existed.
const resolveGradingTarget = (step, session) => {
  const microSteps = step?.microSteps || [];
  if (microSteps.length === 0) {
    return {
      usingMicroSteps: false,
      microStep: null,
      equipment: step?.requiredEquipment || [],
      chemicals: step?.requiredChemicalsForStep || [],
      requiresReactionCheck: step?.actionType === "mix" && (step?.requiredChemicalsForStep?.length || 0) > 0,
      // Unmigrated (whole-step) practicals are chemistry-only today — no step-level measurement
      // check exists yet, so this branch always reports false/null, same as before this field existed.
      requiresMeasurementCheck: false,
      expectedMeasurement: null,
      requiresCircuitPlacementCheck: false,
      requiresTransferCheck: false,
      expectedTransfer: null,
    };
  }

  // The server, never the client, decides which micro-step is "current" — this is what makes
  // Current Tasks un-skippable even though the request body may carry its own microStepId.
  const microStep = microSteps.find((ms) => ms.microStepId === session.currentMicroStep) || microSteps[0];
  return {
    usingMicroSteps: true,
    microStep,
    equipment: microStep?.expectedEquipment || [],
    chemicals: microStep?.expectedChemicalsForStep || [],
    requiresReactionCheck: !!microStep?.requiresReactionCheck,
    // Physics sibling of requiresReactionCheck — see mechanicsEngine.js's resolvePhysicsMeasurement
    // and its call site below in logAction.
    requiresMeasurementCheck: !!microStep?.requiresMeasurementCheck,
    expectedMeasurement: microStep?.expectedMeasurement || null,
    // Electricity (Phase B): a PLACE_COMPONENT task is graded by actual slot correctness (see
    // evaluateBoard), not just "is a resistor/ammeter/voltmeter present somewhere on the bench" —
    // presence alone can't tell a correctly-wired circuit from a pile of components dropped
    // anywhere, now that placement itself is never blocked (see place_component in
    // labRun.controller.js).
    requiresCircuitPlacementCheck: microStep?.expectedIntent === "PLACE_COMPONENT",
    // A liquid-transfer task set up to require an instrument — by capability (`method`) or exact
    // type (`instrumentCategory`). See microStepSchema.expectedTransfer / liquidTransferService.
    // Absent → presence-only grading, unchanged; a direct add still satisfies the task.
    requiresTransferCheck: !!(microStep?.expectedTransfer?.method || microStep?.expectedTransfer?.instrumentCategory),
    expectedTransfer: microStep?.expectedTransfer || null,
  };
};

// Per-task / per-step performance score — CUMULATIVE guidance penalties: reaching hint level 3
// means hints 1+2+3 were all shown (-1, -2, -3 = -6), and Help stacks a further -5 ON TOP (never
// replaces the hint penalties). All the maths lives in labScoringService so logAction,
// completeSession and getSessionReport can never derive it three different ways.
// Returns { base, hintPenalty, helpPenalty, score }.
const computeTaskPerformance = (entry) => scoring.calculateTaskPerformanceScore(entry);

// Called ONCE at completion. Walks Session.stepProgress against the (populated) Experiment,
// recomputing every performance score from its recorded highestHintLevel/helpUsed (self-healing),
// and computing the gentle time score from timeSpentSeconds vs the expected duration. Mutates the
// stepProgress sub-docs in place and returns the session-level roll-up. Read endpoints never
// re-run this — they just read the persisted numbers.
const finalizeScoring = (session) => {
  const experiment = session.experimentId;
  const steps = experiment?.steps || [];
  const stepCount = steps.length || session.stepProgress.length || 1;

  const stepScores = [];
  const stepTimeScores = [];
  let totalHintPenalty = 0;
  let totalHelpPenalty = 0;
  let totalActiveTime = 0;

  for (const sp of session.stepProgress) {
    const expStep = steps.find((s) => s.stepId === sp.stepId) || null;
    const migrated = (sp.microSteps || []).length > 0;

    if (migrated) {
      const expMicroSteps = expStep?.microSteps || [];
      const taskScores = [];
      const taskTimeScores = [];
      let spHintPenalty = 0;
      let spHelpPenalty = 0;

      for (const mp of sp.microSteps) {
        const perf = scoring.calculateTaskPerformanceScore(mp);
        mp.taskScore = perf.score;
        mp.hintPenalty = perf.hintPenalty;
        mp.helpPenalty = perf.helpPenalty;
        spHintPenalty += perf.hintPenalty;
        spHelpPenalty += perf.helpPenalty;
        taskScores.push(perf.score);

        const expMs = expMicroSteps.find((m) => m.microStepId === mp.microStepId) || null;
        const expectedSeconds = scoring.expectedTaskSeconds({
          microStep: expMs,
          step: expStep,
          experiment,
          stepCount,
          stepMicroStepCount: expMicroSteps.length,
        });
        const done = !!mp.completedAt && mp.timeSpentSeconds > 0;
        mp.expectedTimeSeconds = expectedSeconds;
        mp.timeScore = done ? scoring.calculateTimeScore(mp.timeSpentSeconds, expectedSeconds) : null;
        if (mp.timeScore != null) taskTimeScores.push(mp.timeScore);
        if (done) totalActiveTime += mp.timeSpentSeconds;
      }

      sp.stepScore = taskScores.length ? Math.round(scoring.average(taskScores)) : 100;
      sp.hintPenalty = spHintPenalty;
      sp.helpPenalty = spHelpPenalty;
      sp.timeScore = taskTimeScores.length ? Math.round(scoring.average(taskTimeScores)) : null;
    } else {
      const perf = scoring.calculateTaskPerformanceScore(sp);
      sp.stepScore = perf.score;
      sp.hintPenalty = perf.hintPenalty;
      sp.helpPenalty = perf.helpPenalty;
      const expectedSeconds = scoring.expectedStepSeconds({ step: expStep, experiment, stepCount });
      const done = !!sp.completedAt && sp.timeSpentSeconds > 0;
      sp.timeScore = done ? scoring.calculateTimeScore(sp.timeSpentSeconds, expectedSeconds) : null;
      if (done) totalActiveTime += sp.timeSpentSeconds;
    }

    stepScores.push(sp.stepScore);
    if (sp.timeScore != null) stepTimeScores.push(sp.timeScore);
    totalHintPenalty += sp.hintPenalty || 0;
    totalHelpPenalty += sp.helpPenalty || 0;
  }

  const performanceScore = stepScores.length ? Math.round(scoring.average(stepScores)) : 0;
  const timeScore = stepTimeScores.length ? Math.round(scoring.average(stepTimeScores)) : null;

  return {
    performanceScore,
    timeScore,
    score: scoring.combineFinalScore(performanceScore, timeScore),
    totalHintPenalty,
    totalHelpPenalty,
    totalActiveTime,
  };
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

// Sibling to getOrCreateStepProgress, one level deeper — finds this Current Task's nested
// progress entry within its parent step's stepProgress, creating it on first touch. This is what
// makes hint level / mistake counts naturally scoped (and therefore naturally reset) per
// micro-step: a brand new microStepId always starts its own entry at highestHintLevel 0.
const getOrCreateMicroStepProgress = (session, stepId, microStepId) => {
  const stepEntry = getOrCreateStepProgress(session, stepId);
  let entry = stepEntry.microSteps.find((mp) => mp.microStepId === microStepId);
  if (!entry) {
    stepEntry.microSteps.push({ microStepId, startedAt: new Date() });
    entry = stepEntry.microSteps[stepEntry.microSteps.length - 1];
  }
  return { stepEntry, microStepEntry: entry };
};

// Resolves the single progress entry that mistakes/hints/completion should be recorded against
// for "the current unit of work" — the nested microStep entry when the step is migrated, the
// step's own entry otherwise (unmigrated practicals) — plus the parent stepEntry either way
// (needed to roll step-level completion up once every Current Task under it is done). Shared by
// logAction/requestHint/requestHelp so all three always agree on what "current" means.
const resolveActiveProgress = (session, stepId, target, gradedMicroStepId) => {
  if (target.usingMicroSteps) {
    const { stepEntry, microStepEntry } = getOrCreateMicroStepProgress(session, stepId, gradedMicroStepId);
    return { stepEntry, activeEntry: microStepEntry };
  }
  const stepEntry = getOrCreateStepProgress(session, stepId);
  return { stepEntry, activeEntry: stepEntry };
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
      // RCT arm — stable per user, "off" unless STUDENT_MODEL_ENABLED (see config/featureFlags.js).
      experimentArm: flags.experimentArmForUser(req.user._id),
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
// NON-BLOCKING (like equipment selection): this records what the student *initially thinks* they
// need and always advances them into the workspace — an incomplete or over-full selection is a
// learning signal, not a locked door. Missing materials are recovered mid-experiment from the
// in-lab Material Library (add_material_to_lab), and Current-Task grading always reads the live
// bench, never this list — so an initial planning mistake is never a permanent task failure.
const submitChemicalSelection = async (req, res, next) => {
  try {
    const { selectedChemicalIds } = req.body;
    if (!Array.isArray(selectedChemicalIds)) {
      return res.status(400).json({ success: false, message: "selectedChemicalIds array is required." });
    }

    const session = await Session.findById(req.params.id).populate("experimentId");
    if (!session) return res.status(404).json({ success: false, message: "Session not found." });
    // Already past selection (e.g. the student navigated back to this screen) — never re-grade or
    // overwrite the initial selection, and never regress the phase or touch Session/LabRun
    // progress. Just report where they are so the client can send them back to the workspace.
    if (session.phase !== "chemical_selection") {
      const already = session.chemicalSelection || {};
      return res.status(200).json({
        success: true,
        data: {
          complete: (already.missing || []).length === 0 && (already.unnecessary || []).length === 0,
          alreadyEntered: true,
          correct: already.correct || [],
          unnecessaryItems: already.unnecessary || [],
          missingCount: (already.missing || []).length,
          missingBuildsCount: 0,
          hint: null,
          nextPhase: session.phase,
        },
      });
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

    // Always advance — the selection is a preparation step, not a gate. The correct/missing/
    // unnecessary/missingBuilds comparison above is still recorded on the session for analytics,
    // misconception detection and the report, exactly as before; it just no longer blocks entry.
    session.phase = "procedure";
    await session.save();

    if (isComplete) {
      return res.status(200).json({
        success: true,
        data: { complete: true, correct, unnecessaryCount: 0, missingCount: 0, missingBuildsCount: 0, nextPhase: session.phase },
      });
    }

    const relatedConcepts = await require("../models/Concept")
      .find({ _id: { $in: experiment.relatedConcepts } })
      .select("name")
      .lean();

    // A gentle, non-revealing "you may want to double-check your materials" note — the student
    // still proceeds. Names are never revealed here (same principle as the equipment screen);
    // the in-lab Material Library and the progressive Hint Center handle recovery from here.
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
        missingBuildsCount: missingBuilds.length,
        hint,
        nextPhase: session.phase,
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
// Body: { stepId, microStepId? (server-authoritative — see resolveGradingTarget; a client value
// is only ever used to log what was attempted, never to pick which Current Task gets graded),
// actionType, actionDetail, expectedAction, timeTaken, hintLevel, conceptViolated, equipmentType,
// chemicalIds, quantity, unit }
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
    // Which Current Task is "current" is decided by the server (session.currentMicroStep), never
    // by whatever microStepId the client happened to send — see resolveGradingTarget. For a step
    // with no microSteps (unmigrated practicals), target grades the whole step, exactly as before.
    const target = step ? resolveGradingTarget(step, session) : null;
    const gradedMicroStepId = target?.usingMicroSteps ? target.microStep.microStepId : null;

    // When did the current unit of work start? — used to scope the transfer-method check so a
    // dispense logged during an earlier micro-step can't satisfy this one. May be undefined on the
    // very first attempt (progress entry not created yet), which is fine: no prior action matches.
    const currentUnitStartedAt = (() => {
      const sp = session.stepProgress?.find((s) => s.stepId === stepId);
      if (!sp) return undefined;
      return target?.usingMicroSteps
        ? sp.microSteps?.find((mp) => mp.microStepId === gradedMicroStepId)?.startedAt
        : sp.startedAt;
    })();

    // The server determines correctness for every step/task type from the live bench — it never
    // trusts a client-submitted "correct" claim (see evaluateOnBench). mismatchKind drives which
    // non-revealing hint (if any) comes back below: an equipment gap takes priority over a chemical
    // one, since a student can't have added the right chemical to equipment they haven't placed yet.
    let reactionResult = null;
    let measurementResult = null;
    let mismatchKind = null;
    let benchEquipmentTypes = [];
    // Hoisted to the function scope: the intervention block below (outside this `if (step)`) reads
    // evalResult.materialsInInventoryOk, and the student-model compute reads evalResult.labRun.actions.
    let evalResult = null;

    if (step) {
      evalResult = await evaluateOnBench({ equipment: target.equipment, chemicals: target.chemicals }, session.labRunId);
      benchEquipmentTypes = evalResult.benchEquipmentTypes;

      if (!evalResult.equipmentOk) {
        actionType = "incorrect";
        mismatchKind = "equipment";
        conceptViolated = conceptViolated || "LAB_MISSING_EQUIPMENT";
      } else if (target.requiresReactionCheck) {
        // Equipment (and, per evalResult, ingredient presence) checks out — a MIX_SUBSTANCES task
        // additionally requires the actual reaction to have fired on the bench (reactionEngine.js),
        // which is stricter chemistry grading than presence alone.
        const { buildReactantKey, serializeReactionMatch } = require("../services/reactionEngine");
        const requiredKey = buildReactantKey(target.chemicals.map((id) => id.toString()));
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
      } else if (target.requiresMeasurementCheck) {
        // Physics sibling of the requiresReactionCheck branch above: instead of "did the right
        // reaction fire," this checks "does the student's submitted value (quantity) match what
        // the bench's own instruments actually measured/imply" — see mechanicsEngine.js.
        const metric = target.expectedMeasurement?.metric;
        const benchResult = resolvePhysicsMeasurement({
          metric,
          physicsEquipment: evalResult.labRun?.physicsEquipment || [],
          circuitBoardState: evalResult.labRun?.circuitBoardState || null,
        });
        const expectedValue = benchResult.measurable ? benchResult.value : target.expectedMeasurement?.expectedValue;
        const toleranceResult = checkMeasurementTolerance({
          expectedValue,
          studentValue: quantity,
          tolerancePct: target.expectedMeasurement?.tolerancePct,
        });

        actionType = toleranceResult.correct ? "correct" : "incorrect";
        if (!toleranceResult.correct) {
          conceptViolated = conceptViolated || "PHY_MEASUREMENT_OUT_OF_TOLERANCE";
        }
        measurementResult = {
          metric,
          expectedValue,
          studentValue: quantity ?? null,
          correct: toleranceResult.correct,
          reason: benchResult.measurable ? toleranceResult.reason : benchResult.reason,
        };
      } else if (target.requiresCircuitPlacementCheck) {
        // Equipment presence alone ("is a resistor/ammeter/voltmeter on the bench somewhere")
        // can't tell a correctly-wired circuit from components dropped in arbitrary slots — check
        // the live board state instead. A slot filled with the wrong-role component counts the
        // same as an unfilled one here (both mean "not correctly built yet"); the distinction
        // between "missing" and "misplaced" is only used by the hint text below, never revealed
        // as a pass/fail signal itself.
        const boardResult = evaluateBoard({
          boardId: step.circuitBoardId,
          filledSlots: evalResult.labRun?.circuitBoardState?.filledSlots || [],
          physicsEquipment: evalResult.labRun?.physicsEquipment || [],
        });
        actionType = boardResult.correct ? "correct" : "incorrect";
        if (!boardResult.correct) {
          conceptViolated = conceptViolated || "PHY_CIRCUIT_MISCONFIGURED";
          mismatchKind = "circuit_placement";
        }
      } else if (!evalResult.chemicalsOk) {
        actionType = "incorrect";
        mismatchKind = "chemical";
        conceptViolated = conceptViolated || "LAB_MISSING_CHEMICAL";
      } else if (target.requiresTransferCheck) {
        // Equipment + ingredient presence check out, but this task must be done *with the transfer
        // instrument* — a real `dispense` of the expected source chemical, via the expected
        // instrument category, into a container other than the source, since this micro-step
        // started. Dragging the chemical bottle straight in does not satisfy it. Non-revealing:
        // the expected method never leaves the server.
        const { wasTransferPerformed } = require("../services/liquidTransferService");
        const transferOk = wasTransferPerformed(evalResult.labRun, target.expectedTransfer, currentUnitStartedAt);
        actionType = transferOk ? "correct" : "incorrect";
        if (!transferOk) {
          conceptViolated = conceptViolated || "LAB_TRANSFER_METHOD";
          mismatchKind = "transfer";
        }
      } else {
        actionType = "correct";
      }
    }

    // Count attempts for this Current Task (or, for unmigrated steps, this step) in this session.
    const stepAttempts = await Action.countDocuments({
      sessionId: session._id,
      stepId,
      microStepId: gradedMicroStepId,
      actionType: { $in: ["correct", "incorrect"] },
    });

    const action = await Action.create({
      sessionId: session._id,
      userId: req.user._id,
      experimentId: experiment._id,
      stepId,
      microStepId: gradedMicroStepId,
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

    // Behavioral tracking (Session.stepProgress) — mistakes/hints/timing feed both the automatic
    // hint below and the scoring (labScoringService, finalised in completeSession). For a migrated step, this
    // tracks the *current Current Task* specifically (activeEntry = the nested microStep entry),
    // which is what makes hint level / mistake counts naturally reset the moment the task changes
    // — a brand new microStepId always starts its own entry at highestHintLevel 0. For an
    // unmigrated step, activeEntry is the step's own entry, exactly as before microSteps existed.
    let stepEntry = null;
    let activeEntry = null;
    if (step) {
      ({ stepEntry, activeEntry } = resolveActiveProgress(session, stepId, target, gradedMicroStepId));
    }

    let autoHintLevel = null;
    if (activeEntry && actionType === "incorrect" && mismatchKind) {
      // circuit_placement reuses the equipment counter — it's still fundamentally a "wrong
      // equipment configuration" mistake, and adding a dedicated counter would need a Session
      // schema change for no behavioral difference in the escalation math below.
      if (mismatchKind === "equipment" || mismatchKind === "circuit_placement" || mismatchKind === "transfer")
        activeEntry.equipmentMistakes += 1;
      else if (mismatchKind === "chemical") activeEntry.chemicalMistakes += 1;
      activeEntry.solvedIndependently = false;
      autoHintLevel = Math.min(activeEntry.equipmentMistakes + activeEntry.chemicalMistakes, 3);
      activeEntry.highestHintLevel = Math.max(activeEntry.highestHintLevel, autoHintLevel);
    }

    // Mark this Current Task (or, for unmigrated steps, the step itself) complete the moment it's
    // solved — mirrors the original unconditional-on-correctness completion marking, independent
    // of whether this happened to be the session's current position.
    let isLastMicroStep = false;
    let sortedMicroSteps = [];
    if (target?.usingMicroSteps) {
      sortedMicroSteps = [...step.microSteps].sort((a, b) => a.microStepId - b.microStepId);
      isLastMicroStep = sortedMicroSteps[sortedMicroSteps.length - 1]?.microStepId === gradedMicroStepId;
    }

    if (activeEntry && actionType === "correct" && !activeEntry.completedAt) {
      activeEntry.completedAt = new Date();
      activeEntry.timeSpentSeconds = activeEntry.startedAt
        ? Math.round((activeEntry.completedAt.getTime() - activeEntry.startedAt.getTime()) / 1000)
        : timeTaken || 0;
      // Live performance score + its breakdown (cumulative hint penalty + Help penalty). Time is
      // NOT scored here — it's finalised once at completion (completeSession), so re-opening the
      // report can never change it.
      const perf = computeTaskPerformance(activeEntry);
      activeEntry.hintPenalty = perf.hintPenalty;
      activeEntry.helpPenalty = perf.helpPenalty;
      if (target.usingMicroSteps) activeEntry.taskScore = perf.score;
      else activeEntry.stepScore = perf.score;
    }

    // Roll the parent step's own completion/score up once its last Current Task is solved — the
    // step's stepScore is the average of its tasks' performance scores; the step's penalty
    // breakdown is the sum of its tasks'.
    if (target?.usingMicroSteps && isLastMicroStep && actionType === "correct" && stepEntry && !stepEntry.completedAt) {
      stepEntry.completedAt = new Date();
      stepEntry.timeSpentSeconds = stepEntry.startedAt
        ? Math.round((stepEntry.completedAt.getTime() - stepEntry.startedAt.getTime()) / 1000)
        : timeTaken || 0;
      stepEntry.stepScore = stepEntry.microSteps.length
        ? Math.round(stepEntry.microSteps.reduce((sum, m) => sum + (m.taskScore ?? 100), 0) / stepEntry.microSteps.length)
        : 100;
      stepEntry.hintPenalty = stepEntry.microSteps.reduce((sum, m) => sum + (m.hintPenalty || 0), 0);
      stepEntry.helpPenalty = stepEntry.microSteps.reduce((sum, m) => sum + (m.helpPenalty || 0), 0);
    }

    // Advance session position — incorrect attempts (wrong equipment, wrong chemical, or an
    // unfired reaction) never advance anything, and correct attempts only advance when they're for
    // the session's actual current position (server-authoritative, same guard as before microSteps
    // existed) — this is what makes skipping ahead to a future Current Task or Main Step impossible
    // even though the request body carries its own stepId/microStepId.
    if (actionType === "correct" && stepId === session.currentStep) {
      if (target.usingMicroSteps) {
        if (isLastMicroStep) {
          session.currentStep = stepId + 1;
          session.currentMicroStep = 1;
        } else {
          const currentIndex = sortedMicroSteps.findIndex((ms) => ms.microStepId === gradedMicroStepId);
          session.currentMicroStep = sortedMicroSteps[currentIndex + 1].microStepId;
        }
      } else {
        session.currentStep = stepId + 1;
      }
    }

    // Bayesian misconception model — recompute from the live bench and persist per-attempt. Drives
    // the intervention below ONLY for a treatment-arm session with STUDENT_MODEL_DRIVES_HINTS;
    // otherwise it's pure shadow telemetry for the report / research export. Non-fatal.
    let liveModel = null;
    if (flags.isStudentModelEnabled() && step && evalResult && evalResult.labRun) {
      try {
        liveModel = await studentModelRunner.computeLive({
          session,
          experiment,
          benchActions: evalResult.labRun.actions || [],
        });
        if (liveModel) session.studentModel = liveModel;
      } catch (err) {
        console.error("[studentModel] live compute failed (non-fatal):", err.message);
      }
    }

    await session.save();

    // Real-time hint trigger: if 2+ errors on the same Current Task, suggest hint
    const stepErrors = await Action.countDocuments({
      sessionId: session._id,
      stepId,
      microStepId: gradedMicroStepId,
      actionType: "incorrect",
    });
    const suggestHint = stepErrors >= 2;

    // Event-driven proactive intervention — at most one per action, checked in priority order. A
    // task-level equipment/chemical mismatch (detected above) always takes priority: it's the most
    // specific, directly-actionable signal, and fires on the very first wrong attempt rather than
    // waiting for repeated mistakes, escalating level with each subsequent one (Stage 4/5).
    let intervention = null;
    const { generateInterventionHint } = require("../services/labHintService");
    // Hints reference the Main Step's title for context but the actual prompt the student is
    // solving right now — the Current Task's studentPrompt when migrated, the step's own
    // instruction otherwise — so the hint stays scoped to what's actually being asked.
    const activePrompt = target?.usingMicroSteps ? target.microStep.studentPrompt : step?.instruction;

    // M5 — posterior-driven intervention (treatment arm + STUDENT_MODEL_DRIVES_HINTS only). Takes
    // priority over the mismatchKind hints below: it targets the *misconception* behind the
    // mistake, not just "wrong tool". Falls straight through to the existing logic when the model
    // has nothing confident to say, so control / shadow / flags-off behaviour is unchanged.
    let modelIntervention = null;
    if (step && liveModel && flags.studentModelDrivesHints(session)) {
      try {
        const currentTaskCtx = {
          stepId: session.currentStep,
          microStepId: session.currentMicroStep,
          expectedIntent: target?.usingMicroSteps ? target.microStep.expectedIntent : null,
        };
        const signaturesByCode = await studentModelRunner.loadSignaturesByCode();
        const decision = studentModelService.shouldIntervene({
          studentModel: liveModel,
          task: currentTaskCtx,
          signaturesByCode,
        });
        if (decision.intervene && decision.reason === "misconception") {
          const kb = signaturesByCode[decision.misconceptionCode] || {};
          const hintLevel = Math.max(decision.level || 1, autoHintLevel || 1);
          modelIntervention = {
            type: "misconception_hint",
            level: hintLevel,
            misconceptionCode: decision.misconceptionCode,
            hint: await generateMisconceptionHint({
              experimentTitle: experiment.title,
              studentPrompt: activePrompt,
              misconceptionDescription: kb.description,
              correctionStrategy: kb.correctionStrategy,
              level: hintLevel,
              grade: req.user.grade,
            }),
          };
          if (activeEntry) activeEntry.highestHintLevel = Math.max(activeEntry.highestHintLevel || 0, hintLevel);
        } else if (decision.intervene && decision.reason === "divergence") {
          modelIntervention = {
            type: "divergence_nudge",
            hint: await generateInterventionHint({
              triggerType: "off_task",
              experimentTitle: experiment.title,
              context: { stepId, microStepId: gradedMicroStepId },
            }),
          };
        }
      } catch (err) {
        console.error("[studentModel] intervention failed (non-fatal):", err.message);
      }
    }

    if (modelIntervention) {
      intervention = modelIntervention;
    } else if (mismatchKind === "equipment") {
      intervention = {
        type: "equipment_hint",
        level: autoHintLevel,
        hint: await generateEquipmentHint({
          experimentTitle: experiment.title,
          stepTitle: step.title,
          stepInstruction: activePrompt,
          stepActionType: step.actionType,
          requiredEquipment: target.equipment,
          benchEquipmentTypes,
          level: autoHintLevel,
        }),
      };
    } else if (mismatchKind === "chemical") {
      const requiredChemicalDocs = target.chemicals?.length
        ? await Chemical.find({ _id: { $in: target.chemicals } }).select("category").lean()
        : [];
      intervention = {
        type: "chemical_hint",
        level: autoHintLevel,
        hint: await generateChemicalHint({
          experimentTitle: experiment.title,
          stepTitle: step.title,
          stepInstruction: activePrompt,
          stepActionType: step.actionType,
          requiredChemicalCategories: [...new Set(requiredChemicalDocs.map((c) => c.category))],
          // false → the required material isn't even in the student's lab: nudge toward the
          // Material Library, still without naming it (see generateChemicalHint).
          materialAvailable: evalResult.materialsInInventoryOk,
          level: autoHintLevel,
        }),
        // Non-answer recovery hint — lets the client offer an "Open Material Library" affordance
        // on the proactive banner / in the Hint Center. Never names the material.
        suggestedAction: evalResult.materialsInInventoryOk ? null : "open_material_library",
      };
    } else if (mismatchKind === "circuit_placement") {
      // Deliberately doesn't say WHICH slot is wrong or WHAT belongs there — that's the whole
      // point of removing the answer-revealing slot labels. Progressively less abstract as level
      // rises, same escalation shape as equipment/chemical hints, gated the same way.
      intervention = {
        type: "circuit_hint",
        level: autoHintLevel,
        hint: await generateCircuitHint({
          experimentTitle: experiment.title,
          stepTitle: step.title,
          stepInstruction: activePrompt,
          level: autoHintLevel,
        }),
      };
    } else if (target?.requiresReactionCheck && reactionResult && !reactionResult.found && reactionResult.reason === "no_known_reaction") {
      intervention = {
        type: "unknown_combination",
        hint: await generateInterventionHint({
          triggerType: "unknown_combination",
          experimentTitle: experiment.title,
          context: { stepId, microStepId: gradedMicroStepId },
        }),
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
        hint: await generateInterventionHint({
          triggerType: "repeated_mistake",
          experimentTitle: experiment.title,
          context: { stepId, microStepId: gradedMicroStepId, attempts: stepErrors },
        }),
      };
    }

    // A student who keeps missing a step gets the textbook lesson/page pointer on the proactive
    // banner too — same precomputed ref the on-demand hint ladder uses (curriculumReferenceService),
    // gated to a genuine struggle signal (2+ errors on this task) so it isn't shown on a first slip.
    if (intervention && stepErrors >= 2 && step) {
      const curriculumReference = curriculumReferenceForStep(step, experiment);
      if (curriculumReference) intervention.curriculumReference = curriculumReference;
    }

    res.status(201).json({
      success: true,
      data: action,
      meta: {
        suggestHint,
        stepErrors,
        currentStep: session.currentStep,
        currentMicroStep: session.currentMicroStep,
        reactionResult,
        measurementResult,
        intervention,
        helpAvailable: (activeEntry?.highestHintLevel || 0) >= 3,
      },
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

    // FINAL SCORE — computed once, here. performanceScore (cumulative guidance penalties, dominant
    // 90%) + a gentle timeScore (10%, or neutral when no expected durations exist). All maths in
    // labScoringService; getSessionReport only reads the persisted result, never recomputes.
    const totalSteps = session.experimentId.steps.length;
    let finalScoring;
    if (session.stepProgress.length) {
      finalScoring = finalizeScoring(session);
    } else {
      // No step-level data at all (shouldn't happen for a real completed practical) — fall back to
      // the old binary correct/totalSteps formula so this never divides by zero.
      const perf = Math.round((allActions.filter((a) => a.actionType === "correct").length / totalSteps) * 100);
      finalScoring = { performanceScore: perf, timeScore: null, score: perf, totalHintPenalty: 0, totalHelpPenalty: 0, totalActiveTime: 0 };
    }

    // Wall-clock session duration (reporting only — includes idle / app-backgrounded time).
    const totalTime = Math.round((Date.now() - session.startTime.getTime()) / 1000);

    // Calculate average step time
    const stepTimes = allActions.filter((a) => a.timeTaken > 0).map((a) => a.timeTaken);
    const avgStepTime = stepTimes.length > 0 ? stepTimes.reduce((a, b) => a + b, 0) / stepTimes.length : 0;

    session.status = "completed";
    session.endTime = new Date();
    session.score = finalScoring.score;
    session.performanceScore = finalScoring.performanceScore;
    session.timeScore = finalScoring.timeScore;
    session.totalHintPenalty = finalScoring.totalHintPenalty;
    session.totalHelpPenalty = finalScoring.totalHelpPenalty;
    session.totalActiveTime = finalScoring.totalActiveTime;
    session.totalTime = totalTime;
    session.behaviorFeatures.averageStepTime = Math.round(avgStepTime);
    session.behaviorFeatures.errorRate =
      session.behaviorFeatures.totalActions > 0
        ? parseFloat((session.behaviorFeatures.totalErrors / session.behaviorFeatures.totalActions).toFixed(2))
        : 0;

    // Bayesian misconception model — computed BEFORE the AI analysis so a treatment-arm session
    // (STUDENT_MODEL_DRIVES_DIAGNOSIS) can hand its posterior to analyzeSession, where it replaces
    // the rule-derived misconception list. SHADOW / control / flags-off: still computed + persisted
    // for the report and research export, but drives nothing. Non-fatal — a model bug must never
    // break session completion.
    let modelDiagnosis = null;
    if (flags.isStudentModelEnabled()) {
      try {
        const model = await studentModelRunner.computeForSession({ session, experiment: session.experimentId });
        if (model) {
          session.studentModel = model;
          if (flags.studentModelDrivesDiagnosis(session)) {
            modelDiagnosis = await studentModelRunner.diagnoseFromSnapshot(model);
          }
        }
      } catch (err) {
        console.error("[studentModel] compute failed (non-fatal):", err.message);
      }
    }

    // Run AI analysis. modelDiagnosis (when non-null) replaces the rule-derived misconceptions.
    const analysisResult = await analyzeSession(session, allActions, { modelDiagnosis });
    session.aiFeedback = analysisResult;

    // Store what the RULES concluded alongside the model's posterior, for the shadow comparison.
    if (session.studentModel) {
      session.studentModel.shadowRuleMisconceptions = analysisResult._ruleMisconceptions || [];
    }

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
      data: {
        score: finalScoring.score,
        performanceScore: finalScoring.performanceScore,
        timeScore: finalScoring.timeScore,
        totalTime,
        totalActiveTime: finalScoring.totalActiveTime,
        feedback: session.aiFeedback,
      },
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
    if (session.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "This isn't your session." });
    }
    if (session.status !== "completed") {
      return res.status(400).json({ success: false, message: "Report is available once the session is completed." });
    }
    // The practical was deleted / re-seeded since this session ran — the report can't be
    // reconstructed without it. Return a clean 404 rather than throwing (the score itself is
    // already frozen on the Session doc and stays intact).
    if (!session.experimentId) {
      return res.status(404).json({ success: false, message: "The practical for this session is no longer available." });
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

    const conceptualErrors = session.aiFeedback.misconceptionsDetected || [];

    // Deterministic per-step performance breakdown + struggle ranking + guidance summary +
    // student-readable procedural errors (reportAnalyticsService). No LLM — this is what the
    // Report screen renders and what Phase 3's feedback model will be handed.
    const { buildReportAnalytics } = require("../services/reportAnalyticsService");
    const analytics = buildReportAnalytics({
      session,
      experiment,
      actions,
      misconceptions: conceptualErrors,
    });

    // Research-facing per-Current-Task metrics (spec: microStepAttempts/microStepErrors/
    // hintsRequested/hintLevelReached/timePerMicroStep/retriesPerMicroStep) — sourced straight
    // from Session.stepProgress[].microSteps[], no separate analytics collection needed. Empty
    // for practicals not yet migrated to microSteps.
    const microStepBreakdown = (session.stepProgress || []).flatMap((sp) =>
      (sp.microSteps || []).map((mp) => ({
        stepId: sp.stepId,
        microStepId: mp.microStepId,
        equipmentMistakes: mp.equipmentMistakes,
        chemicalMistakes: mp.chemicalMistakes,
        hintsRequested: mp.hintsRequested,
        highestHintLevel: mp.highestHintLevel,
        helpUsed: mp.helpUsed,
        solvedIndependently: mp.solvedIndependently,
        timeSpentSeconds: mp.timeSpentSeconds,
        taskScore: mp.taskScore,
        // Score-breakdown for this task (see labScoringService): 100 − hintPenalty − helpPenalty
        // = taskScore. timeScore/expectedTimeSeconds are null when time was neutral for this task.
        hintPenalty: mp.hintPenalty ?? 0,
        helpPenalty: mp.helpPenalty ?? 0,
        timeScore: mp.timeScore ?? null,
        expectedTimeSeconds: mp.expectedTimeSeconds ?? null,
      }))
    );

    // Curriculum placement of the whole practical — "this practical is covered by <lesson>,
    // pages A–B of the <textbook>" — shown in the report regardless of performance. Plus
    // "follow-up reading": extra textbook pages for the specific steps the student struggled on
    // (Session.behaviorFeatures.struggledSteps). Both come from the precomputed curriculum map
    // and are null/empty until the sync job has run (npm run curriculum:sync -- --apply).
    const practicalReference = practicalCurriculumReference(experiment);
    const followUpReading = buildFollowUpReading(
      experiment,
      session.behaviorFeatures?.struggledSteps || []
    );

    // M5 — model-inferred misconception insight for the mobile "What We Noticed" card, enriched
    // with the KB text (title / plain description / correction strategy). Treatment-arm sessions
    // only; null for control / shadow / flags-off so those reports are unchanged.
    let misconceptionInsight = null;
    if (flags.studentModelDrivesDiagnosis(session) && session.studentModel) {
      try {
        const dx = await studentModelRunner.diagnoseFromSnapshot(session.studentModel);
        if (dx.length) {
          misconceptionInsight = {
            cluster: session.studentModel.cluster || null,
            items: dx.map((d) => ({
              code: d.code,
              title: d.title || null,
              description: d.description || null,
              correctionStrategy: d.correctionStrategy || null,
              probability: d.probability,
              signalCount: (d.evidence || []).length,
              firstSeenStep: d.relatedStep ?? null,
            })),
          };
        }
      } catch (err) {
        console.error("[studentModel] report insight failed (non-fatal):", err.message);
      }
    }

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
        microStepBreakdown,
        // Phase-2 deterministic analytics (see reportAnalyticsService).
        stepBreakdown: analytics.stepBreakdown,
        mostStruggledSteps: analytics.mostStruggledSteps,
        guidanceSummary: analytics.guidanceSummary,
        observations: experiment.expectedObservations || [],
        errorsDetected: {
          procedural: analytics.proceduralErrors, // now { stepId, stepTitle, message, count } — student-readable
          conceptual: conceptualErrors,
        },
        aiFeedback: session.aiFeedback,
        conceptsToImprove: session.aiFeedback.conceptsToImprove || [],
        // M5 — model-inferred misconception insight ("what we noticed" + why). Treatment-arm only;
        // null for control / shadow / flags-off, so those reports are byte-identical to before.
        misconceptionInsight,
        practicalReference,
        followUpReading,
        finalUnderstandingAssessment: session.aiFeedback.finalUnderstandingAssessment || null,
        // Final score + its components (all persisted at completion; never recomputed here).
        //   score = round(performanceScore * 0.90 + timeScore * 0.10), or performanceScore alone
        //   when timeScore is null (no expected durations configured for this practical).
        score: session.score,
        performanceScore: session.performanceScore ?? session.score,
        timeScore: session.timeScore ?? null,
        totalHintPenalty: session.totalHintPenalty ?? 0,
        totalHelpPenalty: session.totalHelpPenalty ?? 0,
        totalTime: session.totalTime, // wall-clock (includes idle)
        totalActiveTime: session.totalActiveTime ?? 0, // summed active task time
        timestamp: session.updatedAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/sessions/:id/note-context
// The Lab → Notes handoff (spec Phase 4). Returns a normalized, self-contained student-
// performance context (no raw Action docs) that the Notes feature fetches by sessionId and turns
// into a personalized revision note. The Lab does NOT generate the note — its job ends here.
const getSessionNoteContext = async (req, res, next) => {
  try {
    const session = await Session.findById(req.params.id).populate("experimentId").lean();
    if (!session) return res.status(404).json({ success: false, message: "Session not found." });
    if (session.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "This isn't your session." });
    }
    if (session.status !== "completed") {
      return res.status(400).json({ success: false, message: "Available once the practical is completed." });
    }

    const experiment = session.experimentId || null;
    const actions = await Action.find({ sessionId: session._id }).sort({ timestamp: 1 }).lean();
    const { buildLabNoteContext } = require("../services/reportAnalyticsService");
    const noteContext = buildLabNoteContext({
      session,
      experiment,
      actions,
      curriculumReference: practicalCurriculumReference(experiment),
    });

    res.status(200).json({ success: true, data: noteContext });
  } catch (error) {
    next(error);
  }
};

// GET /api/sessions/:id
const getSession = async (req, res, next) => {
  try {
    const session = await Session.findById(req.params.id)
      // Pure-exclusion select (Mongo disallows mixing inclusion/exclusion outside sub-paths of
      // the same field) — excludes the step/microStep "answer" fields, same reasoning as
      // getExperimentById. Everything else on Experiment is included, which is fine here —
      // microSteps.studentPrompt/microStepId in particular are safe to include, same as
      // steps.title/instruction above them.
      .populate(
        "experimentId",
        "-requiredEquipment -requiredChemicals -reactionId -steps.expectedAction -steps.requiredChemicalsForStep -steps.requiredEquipment -steps.exactAnswer -steps.observationGoal -curriculumRefs -curriculumRefsGeneratedAt -steps.curriculumRefs -steps.microSteps.expectedIntent -steps.microSteps.expectedEquipment -steps.microSteps.expectedChemicalsForStep -steps.microSteps.hints -steps.microSteps.exactAnswer -steps.microSteps.expectedMeasurement -steps.microSteps.expectedTransfer"
      )
      .lean();
    if (!session) return res.status(404).json({ success: false, message: "Session not found." });

    // Computed, already-safe "what to show right now" block — spares the frontend from having to
    // locate the current Main Step/Current Task inside experimentId.steps itself, and from ever
    // needing the excluded answer fields to know what to render (see workspace.tsx). `task` is
    // null for a Main Step with no microSteps defined — the frontend then just shows the Main
    // Step, exactly as it did before this feature existed.
    const steps = session.experimentId?.steps || [];
    const mainStep = steps.find((s) => s.stepId === session.currentStep) || null;
    const sortedMicroSteps = mainStep?.microSteps?.length
      ? [...mainStep.microSteps].sort((a, b) => a.microStepId - b.microStepId)
      : [];
    const microStep = sortedMicroSteps.find((ms) => ms.microStepId === session.currentMicroStep) || null;

    const currentTask = mainStep
      ? {
          mainStep: {
            stepId: mainStep.stepId,
            title: mainStep.title,
            instruction: mainStep.instruction,
            order: steps.findIndex((s) => s.stepId === mainStep.stepId) + 1,
            totalMainSteps: steps.length,
          },
          task: microStep
            ? {
                microStepId: microStep.microStepId,
                prompt: microStep.studentPrompt,
                order: sortedMicroSteps.findIndex((ms) => ms.microStepId === microStep.microStepId) + 1,
                totalMicroSteps: sortedMicroSteps.length,
              }
            : null,
        }
      : null;

    res.status(200).json({ success: true, data: { ...session, currentTask } });
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
// Body: { stepId } — the Current Task being hinted is always session.currentMicroStep for that
// step (server-authoritative, same as logAction), not anything the client could pass.
const requestHint = async (req, res, next) => {
  try {
    const { stepId } = req.body;
    const session = await Session.findById(req.params.id).populate("experimentId");
    if (!session) return res.status(404).json({ success: false, message: "Session not found." });

    const step = session.experimentId.steps.find((s) => s.stepId === stepId);
    if (!step) return res.status(404).json({ success: false, message: "Step not found." });

    const target = resolveGradingTarget(step, session);
    const gradedMicroStepId = target.usingMicroSteps ? target.microStep.microStepId : null;
    const activePrompt = target.usingMicroSteps ? target.microStep.studentPrompt : step.instruction;

    // Determine hint level (escalate based on previous hints on THIS Current Task specifically —
    // scoping the count to (stepId, microStepId) is what makes the ladder start back at 0 the
    // instant the task changes, satisfying the "hints reset per Current Task" requirement without
    // any separate reset logic).
    const prevHints = await Action.countDocuments({
      sessionId: session._id,
      stepId,
      microStepId: gradedMicroStepId,
      actionType: "hint_requested",
    });
    const hintLevel = Math.min(prevHints + 1, 3);

    // A task with an equipment/chemical gap gets a dynamic, context-aware hint (bench state +
    // task purpose, via Gemini) instead of static authored text — see labHintService.js. Which of
    // equipment/chemical is actually missing right now (same check logAction uses) decides which
    // hint fires; if both are already satisfied, fall back to the equipment-flavored hint anyway
    // (still useful — "how to use what you have"). A task with neither (e.g. OBSERVE_RESULT/
    // MEASURE_RESULT/RECORD_RESULT — nothing to place on the bench) falls back to its own authored
    // hints, then the shared generic task-hint generator.
    let hintText;
    // Non-answer metadata the client may use to offer a recovery action (currently just the
    // Material Library). Never carries the required material's name/id — that stays server-side
    // until the Help reveal (see requestHelp).
    let suggestedAction = null;
    // M5 — on a treatment-arm session with STUDENT_MODEL_DRIVES_HINTS, if the Bayesian model has a
    // confident misconception relevant to the current task, the on-demand hint targets that belief.
    // Otherwise (control / shadow / flags-off / nothing confident) the existing branches run unchanged.
    let modelHintCode = null;
    if (flags.studentModelDrivesHints(session)) {
      try {
        const model = await studentModelRunner.computeForSession({ session, experiment: session.experimentId });
        if (model) {
          const signaturesByCode = await studentModelRunner.loadSignaturesByCode();
          const decision = studentModelService.shouldIntervene({
            studentModel: model,
            task: {
              stepId: session.currentStep,
              microStepId: session.currentMicroStep,
              expectedIntent: target.usingMicroSteps ? target.microStep.expectedIntent : null,
            },
            signaturesByCode,
          });
          if (decision.intervene && decision.reason === "misconception") {
            const kb = signaturesByCode[decision.misconceptionCode] || {};
            hintText = await generateMisconceptionHint({
              experimentTitle: session.experimentId.title,
              studentPrompt: activePrompt,
              misconceptionDescription: kb.description,
              correctionStrategy: kb.correctionStrategy,
              level: hintLevel,
              grade: req.user.grade,
            });
            modelHintCode = decision.misconceptionCode;
          }
        }
      } catch (err) {
        console.error("[studentModel] hint failed (non-fatal):", err.message);
      }
    }

    if (modelHintCode) {
      // hintText was set by the model-driven branch above.
    } else if (target.requiresCircuitPlacementCheck) {
      // Electricity (Phase B): a PLACE_COMPONENT task's real gap is slot correctness, not
      // equipment presence (the equipment usually already exists on the bench) — route straight
      // to the circuit-aware hint rather than falling into the generic equipment-hint branch
      // below, which would just say "you've got the right equipment" and stop there.
      hintText = await generateCircuitHint({
        experimentTitle: session.experimentId.title,
        stepTitle: step.title,
        stepInstruction: activePrompt,
        level: hintLevel,
      });
    } else if (target.equipment.length > 0 || target.chemicals.length > 0) {
      const { equipmentOk, chemicalsOk, benchEquipmentTypes, materialsInInventoryOk } = await evaluateOnBench(
        { equipment: target.equipment, chemicals: target.chemicals },
        session.labRunId
      );

      // Priority: a required material that isn't even in the student's lab inventory is the most
      // fundamental blocker for this task AND the one with a concrete recovery path — surface it
      // before an equipment gap. The hint never names the material; it points at where to act.
      const materialMissingFromLab = target.chemicals.length > 0 && !materialsInInventoryOk;

      if (materialMissingFromLab) {
        const requiredChemicalDocs = await Chemical.find({ _id: { $in: target.chemicals } })
          .select("category")
          .lean();
        hintText = await generateChemicalHint({
          experimentTitle: session.experimentId.title,
          stepTitle: step.title,
          stepInstruction: activePrompt,
          stepActionType: step.actionType,
          requiredChemicalCategories: [...new Set(requiredChemicalDocs.map((c) => c.category))],
          materialAvailable: false,
          level: hintLevel,
        });
        suggestedAction = "open_material_library";
      } else if (!equipmentOk || chemicalsOk) {
        hintText = await generateEquipmentHint({
          experimentTitle: session.experimentId.title,
          stepTitle: step.title,
          stepInstruction: activePrompt,
          stepActionType: step.actionType,
          requiredEquipment: target.equipment,
          benchEquipmentTypes,
          level: hintLevel,
        });
      } else {
        // The material IS in the lab, just not on the bench yet — nudge toward the bench, not the Library.
        const requiredChemicalDocs = await Chemical.find({ _id: { $in: target.chemicals } })
          .select("category")
          .lean();
        hintText = await generateChemicalHint({
          experimentTitle: session.experimentId.title,
          stepTitle: step.title,
          stepInstruction: activePrompt,
          stepActionType: step.actionType,
          requiredChemicalCategories: [...new Set(requiredChemicalDocs.map((c) => c.category))],
          materialAvailable: true,
          level: hintLevel,
        });
      }
    } else {
      const hints = target.usingMicroSteps ? target.microStep.hints : step.hints;
      const authored = (hints || []).find((h) => h.level === hintLevel);
      if (authored) {
        hintText = authored.text;
      } else {
        hintText = await generateTaskHint({
          experimentTitle: session.experimentId.title,
          stepTitle: step.title,
          studentPrompt: activePrompt,
          expectedIntent: target.usingMicroSteps ? target.microStep.expectedIntent : null,
          level: hintLevel,
        });
      }
    }

    // From hint level 2 onward, also point the student at the textbook lesson/pages that cover
    // this step (precomputed by npm run curriculum:sync, see curriculumReferenceService).
    // This is a separate structured field — never folded into hintText — so the hint itself stays
    // non-revealing; a "go read this" pointer is not an answer. null when no confident ref exists
    // (e.g. a Grade 11 practical before the Grade 11 textbook is ingested).
    const curriculumReference =
      hintLevel >= 2 ? curriculumReferenceForStep(step, session.experimentId) : null;

    // Log hint request — the actionDetail records a missing-material hint so the report/analytics
    // can reconstruct the "missed a material → asked for help → recovered" pattern (spec §16/§18).
    await Action.create({
      sessionId: session._id,
      userId: req.user._id,
      experimentId: session.experimentId._id,
      stepId,
      microStepId: gradedMicroStepId,
      actionType: "hint_requested",
      actionDetail:
        (suggestedAction === "open_material_library"
          ? `Hint level ${hintLevel} requested (missing_material)`
          : `Hint level ${hintLevel} requested`) + (curriculumReference ? " (curriculum ref shown)" : ""),
      hintLevel,
      timeTaken: 0,
    });

    session.behaviorFeatures.totalHintsRequested += 1;
    const { activeEntry } = resolveActiveProgress(session, stepId, target, gradedMicroStepId);
    activeEntry.hintsRequested += 1;
    activeEntry.highestHintLevel = Math.max(activeEntry.highestHintLevel, hintLevel);
    activeEntry.solvedIndependently = false;
    await session.save();

    res.status(200).json({
      success: true,
      data: {
        hintLevel,
        hintText,
        stepId,
        microStepId: gradedMicroStepId,
        helpAvailable: hintLevel >= 3,
        // Non-answer recovery hint for the client (e.g. show an "Open Material Library" button in
        // the Hint Center). null unless a required material is genuinely absent from the lab.
        suggestedAction,
        // Textbook lesson/page pointer for this step (hint level >= 2 only). null when there's no
        // confident curriculum match. See curriculumReferenceService.formatCurriculumReference.
        curriculumReference,
        // M5 — set when this hint targeted a model-inferred misconception (treatment arm). null
        // otherwise. Purely informational for the client / analytics.
        misconceptionCode: modelHintCode,
      },
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/sessions/:id/help
// Body: { stepId }
// The one place the correct answer is ever sent to the client — gated server-side (not just in
// the UI) on the student already having been shown hint level 3 for the current Current Task
// (or, for an unmigrated step, the step itself), same "backend is the source of truth" principle
// as evaluateOnBench. Marks the active progress entry's helpUsed so the scoring
// (labScoringService) applies the -5 Help penalty ON TOP of the hint penalties, and logs a
// help_used Action for analytics.
const requestHelp = async (req, res, next) => {
  try {
    const { stepId } = req.body;
    const session = await Session.findById(req.params.id).populate("experimentId");
    if (!session) return res.status(404).json({ success: false, message: "Session not found." });

    const step = session.experimentId.steps.find((s) => s.stepId === stepId);
    if (!step) return res.status(404).json({ success: false, message: "Step not found." });

    const target = resolveGradingTarget(step, session);
    const gradedMicroStepId = target.usingMicroSteps ? target.microStep.microStepId : null;
    const { activeEntry } = resolveActiveProgress(session, stepId, target, gradedMicroStepId);
    if (activeEntry.highestHintLevel < 3) {
      return res.status(400).json({
        success: false,
        message: "Help is only available after reaching hint level 3 on this task.",
      });
    }

    // Live bench state — Help turns the hidden requirements into a concrete action against THIS
    // (see helpActionService.buildHelpAction): which container instance, what it already holds,
    // which transfer tool, what quantity.
    const labRun = session.labRunId
      ? await LabRun.findById(session.labRunId).select("equipment").lean()
      : null;

    // Names for every chemical the instruction might mention: the task's expected chemicals plus
    // whatever is already sitting in the bench containers.
    const chemicalIdSet = new Set((target.chemicals || []).map((id) => id.toString()));
    (labRun?.equipment || []).forEach((e) =>
      (e.contents || []).forEach((c) => c.chemical && chemicalIdSet.add(c.chemical.toString()))
    );
    const chemicalDocs = chemicalIdSet.size
      ? await Chemical.find({ _id: { $in: [...chemicalIdSet] } }).select("name symbol").lean()
      : [];
    const requiredChemicalDocs = chemicalDocs.filter((c) =>
      (target.chemicals || []).some((id) => id.toString() === c._id.toString())
    );

    activeEntry.helpUsed = true;
    activeEntry.solvedIndependently = false;
    await session.save();

    await Action.create({
      sessionId: session._id,
      userId: req.user._id,
      experimentId: session.experimentId._id,
      stepId,
      microStepId: gradedMicroStepId,
      actionType: "help_used",
      actionDetail: "Help reveal requested",
      timeTaken: 0,
    });

    const explanation = target.usingMicroSteps
      ? target.microStep.exactAnswer || step.exactAnswer || step.observationGoal || step.expectedAction
      : step.exactAnswer || step.observationGoal || step.expectedAction;

    // The improved Help payload: an explicit procedural action derived from the hidden
    // requirements + the live bench (correct container instance, its current contents, the
    // transfer tool, the quantity). Falls back to `explanation` when nothing more specific can
    // be synthesised (e.g. an OBSERVE_RESULT task with no bench gap).
    const { buildHelpAction } = require("../services/helpActionService");
    const { actionInstruction, actionSteps } = buildHelpAction({
      target,
      step,
      experiment: session.experimentId,
      labRun,
      chemicalDocs,
    });

    res.status(200).json({
      success: true,
      data: {
        stepId,
        microStepId: gradedMicroStepId,
        equipment: target.equipment,
        chemicals: requiredChemicalDocs.map((c) => ({ name: c.name, symbol: c.symbol })),
        // The exact action to perform, and (for multi-step tasks) the ordered sequence.
        actionInstruction: actionInstruction || explanation || null,
        actionSteps: actionSteps || [],
        explanation,
      },
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
  getSessionNoteContext,
  getUserSessions,
  getSessionStats,
  requestHint,
  requestHelp,
};
