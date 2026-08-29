const LabRun = require("../models/LabRun");
const Chemical = require("../models/Chemical");
const Session = require("../models/Session");
const Action = require("../models/Action");
const { findReaction, serializeReactionMatch } = require("../services/reactionEngine");
const { generateTutorResponse } = require("../services/labTutorService");
const { generateInterventionHint } = require("../services/labHintService");
const { computeContainerPh } = require("../services/phService");
const { computeObservableState, observableStateChanged } = require("../services/appearanceService");
const { computePendulumPeriod, computeSpringConstant } = require("../services/mechanicsEngine");
const { computeMeterReading } = require("../services/circuitEngine");
const transferService = require("../services/liquidTransferService");
const { circuitBoards, CIRCUIT_EQUIPMENT_ROLES } = require("../data/circuitBoards");
const FREEFORM_EXPERIMENT_TITLE = "this virtual lab"; // no Experiment/Session title to reference outside a guided practical

const MAX_TUTOR_HISTORY = 6; // turns kept in the doc; only the last few are sent as prompt context
const RECENT_ACTIONS_FOR_TUTOR = 5;

/**
 * Builds the initial LabRun.materials inventory from a Session's confirmed chemical selection plus
 * any compounds it has finished building — every entry flagged wasInitiallySelected: true. This
 * is the ONLY place the initial selection feeds the physical inventory; add_material_to_lab grows
 * it afterwards without ever writing back to the Session (see labMaterialSchema in LabRun.js).
 * Returns [] for a session with no selection yet — the run just starts with an empty inventory
 * and the student pulls everything from the in-lab Material Library.
 */
const seedMaterialsFromSession = async (sessionId) => {
  const session = await Session.findById(sessionId).select("chemicalSelection.selected builtCompounds").lean();
  if (!session) return [];
  const ids = new Set((session.chemicalSelection?.selected || []).map((id) => id.toString()));
  (session.builtCompounds || [])
    .filter((b) => b.completedAt)
    .forEach((b) => ids.add(b.chemical.toString()));
  return [...ids].map((chemical) => ({ chemical, wasInitiallySelected: true, addedAt: new Date() }));
};

/**
 * Checks an equipment instance's current contents against the reaction engine every time they
 * change (called from add_chemical/heat below) — no separate "Mix" action needed, per the
 * "reactions should happen continuously" design goal. Mutates `instance.contents` to the
 * reaction's products on a match (quantities carried over with simple, non-stoichiometric
 * summation — precise scaling is out of scope) and records it on reactionsTriggered.
 * Returns a ReactionResultType, or null if there weren't at least 2 chemicals present to check.
 */
const checkAndApplyReaction = async (labRun, instance) => {
  const chemicalIds = instance.contents.map((c) => c.chemical.toString());
  if (chemicalIds.length < 2) return null;

  const conditions = { heated: instance.isHeated, temperature: instance.temperature };
  const result = await findReaction(chemicalIds, conditions);

  if (!result.found) {
    return { found: false, reason: result.reason, explanation: result.explanation || null, hint: result.hint || null };
  }

  labRun.reactionsTriggered.push(result.reaction._id);

  const totalVolume = instance.contents.reduce((sum, c) => sum + (c.volume || 0), 0) || null;
  const totalMass = instance.contents.reduce((sum, c) => sum + (c.mass || 0), 0) || null;
  instance.contents = result.reaction.products.map((p, i) => ({
    chemical: p.chemical._id,
    volume: i === 0 ? totalVolume : null,
    mass: i === 0 ? totalMass : null,
  }));

  // Energy change is an observable too (spec §9/§22) — nudge the container's temperature so the
  // pH-meter/thermometer reads it and the bench can flag "the flask feels warm". Capped so an
  // exothermic reaction reads as "warm", never "boiling", and never cools below room temp.
  const energy = result.reaction.observableChanges?.energyChange;
  if (!instance.isHeated) {
    if (energy === "exothermic" || result.reaction.observableChanges?.heatProduced) {
      instance.temperature = Math.min(55, Math.max(instance.temperature ?? 25, 25) + 12);
    } else if (energy === "endothermic") {
      instance.temperature = Math.max(6, Math.min(instance.temperature ?? 25, 25) - 8);
    }
  }

  return serializeReactionMatch(result.reaction);
};

/**
 * Recomputes and persists a container instance's observable appearance whenever its contents
 * change (add_chemical / pour / dispense / heat / reset / mix). The backend stays authoritative
 * for what the liquid looks like (spec §6/§12) — the mobile client renders
 * instance.observableState as-is, and animates the transition when lastChangedAt moves.
 * `reaction` is the serialized reaction that just fired on this instance, or null.
 */
const refreshObservableState = async (instance, reaction = null) => {
  if (!instance || !Array.isArray(instance.contents)) return;
  const ids = instance.contents.map((c) => c.chemical).filter(Boolean);
  const docs = ids.length ? await Chemical.find({ _id: { $in: ids } }).lean() : [];
  const chemicalsById = Object.fromEntries(docs.map((d) => [d._id.toString(), d]));
  const previous = instance.observableState?.toObject?.() ?? instance.observableState ?? null;
  const next = computeObservableState({ contents: instance.contents, chemicalsById, reaction, previous });
  next.lastChangedAt = observableStateChanged(previous, next) ? new Date() : previous?.lastChangedAt ?? null;
  instance.observableState = next;
};

/**
 * Proactive AI Tutor safety check, run after add_chemical/heat alongside checkAndApplyReaction —
 * the student never has to ask; the tutor flags it immediately, same as the guided-Session flow's
 * repeated_mistake/unnecessary_heat interventions (generateInterventionHint, labHintService.js).
 * Returns { type, hint } or null. Only one check fires per action — heating empty glassware is the
 * more specific/actionable signal, so it takes priority when both could apply.
 */
const checkSafetyIntervention = async ({ actionType, instance, reactionResult, experimentTitle }) => {
  if (actionType === "heat" && instance.isHeated && instance.contents.length === 0) {
    const hint = await generateInterventionHint({
      triggerType: "heating_empty_container",
      experimentTitle,
      context: { equipmentType: instance.equipmentType },
    });
    return { type: "heating_empty_container", hint };
  }

  if (
    (actionType === "add_chemical" || actionType === "pour" || actionType === "dispense") &&
    reactionResult &&
    !reactionResult.found &&
    reactionResult.reason === "no_known_reaction"
  ) {
    const hint = await generateInterventionHint({
      triggerType: "unknown_combination",
      experimentTitle,
      context: { equipmentType: instance.equipmentType },
    });
    return { type: "unknown_combination", hint };
  }

  return null;
};

// POST /api/lab/runs
// Body: { sessionId? } — when present, this LabRun is the live bench backing a specific guided
// practical Session (see session.controller.js) instead of a standalone freeform run. Scoped
// separately from the student's freeform "one active run" so the two never collide.
const startLabRun = async (req, res, next) => {
  try {
    const { sessionId } = req.body;
    const filter = sessionId
      ? { userId: req.user._id, sessionId, status: "active" }
      : { userId: req.user._id, status: "active", sessionId: null };

    const existing = await LabRun.findOne(filter);
    if (existing) {
      if (sessionId) await Session.findByIdAndUpdate(sessionId, { labRunId: existing._id });
      // Backfill the material inventory for a run created before this feature existed (or before
      // the student had confirmed a selection) — additive, never clears anything already there.
      if (sessionId && (existing.materials || []).length === 0) {
        const seeded = await seedMaterialsFromSession(sessionId);
        if (seeded.length) {
          existing.materials = seeded;
          await existing.save();
        }
      }
      return res.status(200).json({ success: true, message: "Resuming active lab run.", data: existing });
    }

    const labRun = await LabRun.create({
      userId: req.user._id,
      sessionId: sessionId || null,
      // Seed the physical lab inventory from the student's confirmed initial plan (Session stays
      // the untouched record of that plan). Empty for a freeform run with no session.
      materials: sessionId ? await seedMaterialsFromSession(sessionId) : [],
    });
    // Link back from the Session so session.controller.js's mix-step grading (Phase 4) can find
    // this run's live bench state without the client having to pass it separately.
    if (sessionId) await Session.findByIdAndUpdate(sessionId, { labRunId: labRun._id });
    res.status(201).json({ success: true, message: "Lab run started.", data: labRun });
  } catch (error) {
    next(error);
  }
};

// GET /api/lab/runs/:id
const getLabRun = async (req, res, next) => {
  try {
    const labRun = await LabRun.findOne({ _id: req.params.id, userId: req.user._id }).lean();
    if (!labRun) return res.status(404).json({ success: false, message: "Lab run not found." });
    res.status(200).json({ success: true, data: labRun });
  } catch (error) {
    next(error);
  }
};

// POST /api/lab/runs/:id/action
// Body varies by actionType:
//   create_equipment: { instanceId, equipmentType, position? }
//   move_equipment:   { instanceId, position }
//   remove_equipment: { instanceId }
//   add_chemical:     { instanceId, chemicalId, quantity?, unit? }  — unit "g" -> mass, else volume
//   pour:             { instanceId, targetInstanceId }  — moves all of instanceId's contents into
//                        targetInstanceId and empties instanceId; re-checks the target for a reaction
//   reset:            { instanceId }
//   heat:             { instanceId, heated?, temperature? }
//   probe_measure:    { instanceId, targetInstanceId }  — instanceId is the probe (e.g. pH meter)
//   probe_detach:     { instanceId }
//   attach_mass:      { instanceId, quantity }  — mass in grams (spring/pendulum overload, or a
//                        balance reading — physics-only, see mechanicsEngine.js)
//   set_pendulum_length / set_length: { instanceId, quantity }  — string/natural length in cm
//   set_release_angle:   { instanceId, quantity }  — release angle in degrees
//   start_timer / stop_timer / record_oscillation: { instanceId }  — instanceId is the stopwatch;
//     stop_timer looks up any pendulum_bob instance on the bench for its length and computes g
//   read_measurement: { instanceId, quantity, unit?, phase? }  — generic apparatus reading
//     (measuring_cylinder needs phase: "initial"|"final"; spring computes spring constant)
// Equipment instances are keyed by a client-generated instanceId (e.g. "beaker-<timestamp>"), not
// equipmentType, so a student can place multiple beakers on the bench at once. Physics-only
// action types (above) operate on labRun.physicsEquipment, a parallel array to labRun.equipment —
// see physicsInstanceSchema in LabRun.js for why they don't share a bench-state shape.
const logLabAction = async (req, res, next) => {
  try {
    const {
      actionType,
      instanceId,
      equipmentType,
      position,
      capacity, // create_equipment (containers) — student-chosen vessel size in mL
      chemicalId,
      quantity,
      unit,
      temperature,
      heated,
      targetInstanceId,
      category, // "physics" routes create_equipment into labRun.physicsEquipment; omitted/"chemistry" is unchanged default behavior
      phase, // "initial" | "final" — measuring_cylinder read_measurement only
      slotId, // place_component only
      boardId, // place_component only — which circuitBoards.js layout is active for this bench right now
    } = req.body;
    if (!actionType) return res.status(400).json({ success: false, message: "actionType is required." });

    const labRun = await LabRun.findOne({ _id: req.params.id, userId: req.user._id });
    if (!labRun) return res.status(404).json({ success: false, message: "Lab run not found." });
    if (labRun.status !== "active")
      return res.status(400).json({ success: false, message: "Lab run is not active." });

    const instance = instanceId ? labRun.equipment.find((e) => e.instanceId === instanceId) : null;
    const physicsInstance = instanceId ? labRun.physicsEquipment.find((e) => e.instanceId === instanceId) : null;
    let actionEquipmentLabel = instance?.equipmentType || physicsInstance?.equipmentType || equipmentType || null;
    let reactionResult = null;
    let intervention = null;
    // probe_measure can't know its result (the measured value) until the switch below runs, unlike
    // add_chemical where quantity/unit are already known from the request — so the history entry
    // pushed at the end of this function reads these instead of the raw request fields.
    let resultQuantity = quantity;
    let resultUnit = unit;
    // Liquid-transfer actions fill these in; every other action leaves them null.
    let actionSourceInstanceId = null;
    let actionTargetInstanceId = null;
    let actionChemicalIds = null;

    switch (actionType) {
      case "create_equipment": {
        if (!instanceId || !equipmentType) {
          return res.status(400).json({ success: false, message: "instanceId and equipmentType are required." });
        }
        if (instance || physicsInstance) {
          return res.status(400).json({ success: false, message: "An equipment instance with this id already exists." });
        }
        if (category === "physics") {
          labRun.physicsEquipment.push({
            instanceId,
            equipmentType,
            position: position || { x: 0, y: 0 },
            // Circuit components (resistor/ammeter/voltmeter) get their role set immediately so
            // place_component can validate slot compatibility — mechanics equipment (pendulum,
            // stopwatch, etc.) has no entry in CIRCUIT_EQUIPMENT_ROLES and stays role: null.
            role: CIRCUIT_EQUIPMENT_ROLES[equipmentType] || null,
          });
        } else {
          labRun.equipment.push({
            instanceId,
            equipmentType,
            position: position || { x: 0, y: 0 },
            contents: [],
            temperature: 25,
            isHeated: false,
            capacity: typeof capacity === "number" && capacity > 0 ? capacity : null,
          });
        }
        actionEquipmentLabel = equipmentType;
        break;
      }

      case "move_equipment": {
        const moveTarget = instance || physicsInstance;
        if (!moveTarget) return res.status(404).json({ success: false, message: "Equipment instance not found." });
        if (!position) return res.status(400).json({ success: false, message: "position is required." });
        moveTarget.position = position;
        break;
      }

      case "remove_equipment": {
        if (!instance && !physicsInstance) return res.status(404).json({ success: false, message: "Equipment instance not found." });
        if (instance) labRun.equipment = labRun.equipment.filter((e) => e.instanceId !== instanceId);
        if (physicsInstance) labRun.physicsEquipment = labRun.physicsEquipment.filter((e) => e.instanceId !== instanceId);
        break;
      }

      case "add_chemical": {
        if (!instance) return res.status(404).json({ success: false, message: "Equipment instance not found." });
        if (!chemicalId) return res.status(400).json({ success: false, message: "chemicalId is required." });
        instance.contents.push({
          chemical: chemicalId,
          volume: unit === "g" ? null : quantity ?? null,
          mass: unit === "g" ? quantity ?? null : null,
        });
        // Keep the material inventory a true superset of everything that's touched the bench —
        // if this chemical reached a container without going through the Material Library
        // (freeform run, legacy flow), register it now so telemetry/"On Hand" stay accurate.
        labRun.materials = labRun.materials || [];
        if (labRun.sessionId && !labRun.materials.some((m) => m.chemical.toString() === chemicalId.toString())) {
          labRun.materials.push({ chemical: chemicalId, wasInitiallySelected: false, addedAt: new Date() });
        }
        reactionResult = await checkAndApplyReaction(labRun, instance);
        intervention = await checkSafetyIntervention({
          actionType,
          instance,
          reactionResult,
          experimentTitle: FREEFORM_EXPERIMENT_TITLE,
        });
        await refreshObservableState(instance, reactionResult?.found ? reactionResult : null);
        break;
      }

      case "pour": {
        if (!instance) return res.status(404).json({ success: false, message: "Equipment instance not found." });
        if (!targetInstanceId) return res.status(400).json({ success: false, message: "targetInstanceId is required." });
        if (targetInstanceId === instanceId) {
          return res.status(400).json({ success: false, message: "Cannot pour a container into itself." });
        }
        const pourTarget = labRun.equipment.find((e) => e.instanceId === targetInstanceId);
        if (!pourTarget) return res.status(404).json({ success: false, message: "Target equipment not found." });
        if (instance.contents.length === 0) {
          return res.status(400).json({ success: false, message: "Nothing to pour — this container is empty." });
        }

        pourTarget.contents.push(...instance.contents);
        instance.contents = [];

        reactionResult = await checkAndApplyReaction(labRun, pourTarget);
        intervention = await checkSafetyIntervention({
          actionType,
          instance: pourTarget,
          reactionResult,
          experimentTitle: FREEFORM_EXPERIMENT_TITLE,
        });
        await refreshObservableState(pourTarget, reactionResult?.found ? reactionResult : null);
        await refreshObservableState(instance); // source is now empty
        break;
      }

      case "reset": {
        if (!instance) return res.status(404).json({ success: false, message: "Equipment instance not found." });
        instance.contents = [];
        await refreshObservableState(instance);
        break;
      }

      case "heat": {
        if (!instance) return res.status(404).json({ success: false, message: "Equipment instance not found." });
        instance.isHeated = heated ?? !instance.isHeated;
        instance.temperature = temperature ?? (instance.isHeated ? Math.max(instance.temperature, 80) : 25);
        // Heating can be what a reaction was waiting on (conditions.requiresHeat) — re-check.
        reactionResult = await checkAndApplyReaction(labRun, instance);
        intervention = await checkSafetyIntervention({
          actionType,
          instance,
          reactionResult,
          experimentTitle: FREEFORM_EXPERIMENT_TITLE,
        });
        await refreshObservableState(instance, reactionResult?.found ? reactionResult : null);
        break;
      }

      case "probe_measure": {
        if (!instance) return res.status(404).json({ success: false, message: "Equipment instance not found." });
        if (!targetInstanceId) return res.status(400).json({ success: false, message: "targetInstanceId is required." });
        const target = labRun.equipment.find((e) => e.instanceId === targetInstanceId);
        if (!target) return res.status(404).json({ success: false, message: "Target equipment not found." });

        const chemicalIds = target.contents.map((c) => c.chemical);
        const chemicalDocs = chemicalIds.length ? await Chemical.find({ _id: { $in: chemicalIds } }).lean() : [];
        const chemicalsById = Object.fromEntries(chemicalDocs.map((c) => [c._id.toString(), c]));
        const phResult = computeContainerPh(target, chemicalsById);

        instance.probeTargetId = targetInstanceId;
        instance.lastMeasurement = phResult.measurable
          ? { measurementType: "ph", value: phResult.value, targetId: targetInstanceId, measuredAt: new Date() }
          : { measurementType: null, value: null, targetId: targetInstanceId, measuredAt: new Date() };

        resultQuantity = phResult.measurable ? phResult.value : null;
        resultUnit = "pH";
        break;
      }

      case "probe_detach": {
        if (!instance) return res.status(404).json({ success: false, message: "Equipment instance not found." });
        instance.probeTargetId = null;
        instance.lastMeasurement = null;
        break;
      }

      // --- Liquid-transfer instruments (dropper first) — see liquidTransferService.js ------------
      case "insert_transfer_tool": {
        if (!instance) return res.status(404).json({ success: false, message: "Equipment instance not found." });
        if (!transferService.isTransferInstrument(instance.equipmentType)) {
          return res.status(400).json({ success: false, message: "This equipment isn't a transfer instrument." });
        }
        if (!targetInstanceId) return res.status(400).json({ success: false, message: "targetInstanceId is required." });
        const container = labRun.equipment.find((e) => e.instanceId === targetInstanceId);
        if (!container) return res.status(404).json({ success: false, message: "Target equipment not found." });

        const r = await transferService.insertTransferTool({
          instrument: instance,
          target: container,
          experimentTitle: FREEFORM_EXPERIMENT_TITLE,
        });
        if (r.error) return res.status(400).json({ success: false, message: r.error });
        intervention = r.intervention || null;
        actionSourceInstanceId = instance.transfer.status === "positioned_in_source" ? targetInstanceId : null;
        actionTargetInstanceId = instance.transfer.status === "positioned_over_target" ? targetInstanceId : null;
        break;
      }

      case "load_transfer_tool": {
        if (!instance) return res.status(404).json({ success: false, message: "Equipment instance not found." });
        if (!chemicalId) return res.status(400).json({ success: false, message: "chemicalId is required." });
        const lr = await transferService.loadFromReagent({
          instrument: instance,
          chemicalId,
          experimentTitle: FREEFORM_EXPERIMENT_TITLE,
        });
        if (lr.error) return res.status(400).json({ success: false, message: lr.error });
        intervention = lr.intervention || null;
        actionChemicalIds = [chemicalId];
        resultQuantity = instance.transfer.contents[0]?.volume ?? null;
        resultUnit = "mL";
        break;
      }

      case "aspirate": {
        if (!instance) return res.status(404).json({ success: false, message: "Equipment instance not found." });
        const pre = await transferService.aspirate({ instrument: instance });
        if (pre.error) return res.status(400).json({ success: false, message: pre.error });
        const source = labRun.equipment.find((e) => e.instanceId === instance.transfer.sourceInstanceId);
        if (!source) return res.status(404).json({ success: false, message: "Source container not found." });
        const r = await transferService.applyAspirate({
          instrument: instance,
          source,
          experimentTitle: FREEFORM_EXPERIMENT_TITLE,
        });
        if (r.error) return res.status(400).json({ success: false, message: r.error });
        intervention = r.intervention || null;
        actionSourceInstanceId = source.instanceId;
        actionChemicalIds = instance.transfer.contents.map((c) => c.chemical);
        resultQuantity = instance.transfer.contents[0]?.volume ?? null;
        resultUnit = "mL";
        break;
      }

      case "dispense": {
        if (!instance) return res.status(404).json({ success: false, message: "Equipment instance not found." });
        const targetId = targetInstanceId || instance.transfer?.targetInstanceId;
        const container = targetId ? labRun.equipment.find((e) => e.instanceId === targetId) : null;
        if (!container) return res.status(404).json({ success: false, message: "Target equipment not found." });

        const r = await transferService.dispense({
          instrument: instance,
          target: container,
          experimentTitle: FREEFORM_EXPERIMENT_TITLE,
        });
        if (r.error) return res.status(400).json({ success: false, message: r.error });

        reactionResult = await checkAndApplyReaction(labRun, container);
        intervention =
          r.intervention ||
          (await checkSafetyIntervention({
            actionType,
            instance: container,
            reactionResult,
            experimentTitle: FREEFORM_EXPERIMENT_TITLE,
          }));
        await refreshObservableState(container, reactionResult?.found ? reactionResult : null);
        actionSourceInstanceId = instance.transfer?.lastSourceInstanceId || null;
        actionTargetInstanceId = container.instanceId;
        actionChemicalIds = r.dispensedChemicalId ? [r.dispensedChemicalId] : [];
        resultQuantity = transferService.TRANSFER_INSTRUMENTS[instance.equipmentType]?.drop ?? null;
        resultUnit = "mL";
        break;
      }

      case "add_material_to_lab": {
        // Non-blocking selection: the student realised mid-experiment they need another chemical
        // and pulled it from the in-lab Material Library. Adds to the physical inventory only —
        // never writes back to Session.chemicalSelection (that stays the record of the initial
        // plan). Grading always reads the live bench, so this is what lets an initial planning
        // mistake stop being a permanent task failure.
        if (!chemicalId) return res.status(400).json({ success: false, message: "chemicalId is required." });
        const material = await Chemical.findById(chemicalId).select("_id name").lean();
        if (!material) return res.status(404).json({ success: false, message: "That material isn't in the chemistry catalog." });

        labRun.materials = labRun.materials || [];
        if (!labRun.materials.some((m) => m.chemical.toString() === chemicalId.toString())) {
          const session = labRun.sessionId
            ? await Session.findById(labRun.sessionId).select("chemicalSelection.selected currentStep currentMicroStep").lean()
            : null;
          const wasInitiallySelected = !!session?.chemicalSelection?.selected?.some(
            (id) => id.toString() === chemicalId.toString()
          );
          // Did a missing-material hint already fire for the current task? (see requestHint's
          // actionDetail). Behavioural telemetry only — never gates or reveals anything.
          const hintPrecededAddition = session
            ? !!(await Action.exists({
                sessionId: session._id,
                stepId: session.currentStep,
                actionType: "hint_requested",
                actionDetail: { $regex: "missing_material" },
              }))
            : false;
          labRun.materials.push({
            chemical: chemicalId,
            wasInitiallySelected,
            addedAt: new Date(),
            addedDuringStep: session?.currentStep ?? null,
            addedDuringMicroStep: session?.currentMicroStep ?? null,
            hintPrecededAddition,
          });
        }
        actionChemicalIds = [chemicalId];
        break;
      }

      case "attach_mass": {
        if (!physicsInstance) return res.status(404).json({ success: false, message: "Equipment instance not found." });
        if (quantity == null) return res.status(400).json({ success: false, message: "quantity (mass in grams) is required." });
        physicsInstance.attachedMass = { value: quantity, unit: "g" };
        resultQuantity = quantity;
        resultUnit = "g";
        break;
      }

      case "set_pendulum_length":
      case "set_length": {
        if (!physicsInstance) return res.status(404).json({ success: false, message: "Equipment instance not found." });
        if (quantity == null) return res.status(400).json({ success: false, message: "quantity (length in cm) is required." });
        physicsInstance.length = { value: quantity, unit: "cm" };
        resultQuantity = quantity;
        resultUnit = "cm";
        break;
      }

      case "set_release_angle": {
        if (!physicsInstance) return res.status(404).json({ success: false, message: "Equipment instance not found." });
        if (quantity == null) return res.status(400).json({ success: false, message: "quantity (angle in degrees) is required." });
        physicsInstance.angle = { value: quantity, unit: "deg" };
        resultQuantity = quantity;
        resultUnit = "deg";
        break;
      }

      case "start_timer": {
        if (!physicsInstance) return res.status(404).json({ success: false, message: "Equipment instance not found." });
        physicsInstance.timerState = { running: true, startedAt: new Date(), elapsedSeconds: 0, oscillationCount: 0 };
        break;
      }

      case "record_oscillation": {
        if (!physicsInstance) return res.status(404).json({ success: false, message: "Equipment instance not found." });
        if (!physicsInstance.timerState?.running) {
          return res.status(400).json({ success: false, message: "Timer is not running." });
        }
        physicsInstance.timerState.oscillationCount += 1;
        resultQuantity = physicsInstance.timerState.oscillationCount;
        resultUnit = "oscillations";
        break;
      }

      case "stop_timer": {
        if (!physicsInstance) return res.status(404).json({ success: false, message: "Equipment instance not found." });
        if (!physicsInstance.timerState?.running) {
          return res.status(400).json({ success: false, message: "Timer is not running." });
        }
        const elapsedSeconds = (Date.now() - new Date(physicsInstance.timerState.startedAt).getTime()) / 1000;
        physicsInstance.timerState.running = false;
        physicsInstance.timerState.elapsedSeconds = elapsedSeconds;

        // Find the pendulum on the bench for its string length — a guided practical only ever
        // has one apparatus active at a time, so this doesn't need a client-supplied link.
        const pendulum = labRun.physicsEquipment.find((e) => e.equipmentType === "pendulum_bob");
        if (pendulum?.length?.value) {
          const periodResult = computePendulumPeriod({
            length_cm: pendulum.length.value,
            oscillationCount: physicsInstance.timerState.oscillationCount,
            elapsedSeconds,
          });
          if (periodResult.measurable) {
            physicsInstance.lastMeasurement = {
              measurementType: "g",
              value: periodResult.value,
              targetId: pendulum.instanceId,
              measuredAt: new Date(),
            };
            resultQuantity = periodResult.value;
            resultUnit = "m/s^2";
          }
        }
        break;
      }

      case "read_measurement": {
        if (!physicsInstance) return res.status(404).json({ success: false, message: "Equipment instance not found." });
        if (quantity == null) return res.status(400).json({ success: false, message: "quantity is required." });

        if (physicsInstance.equipmentType === "measuring_cylinder") {
          if (phase !== "initial" && phase !== "final") {
            return res
              .status(400)
              .json({ success: false, message: "phase ('initial' or 'final') is required for a measuring cylinder reading." });
          }
          if (phase === "initial") physicsInstance.measuredVolumeDisplacement.initial = quantity;
          else physicsInstance.measuredVolumeDisplacement.final = quantity;
          resultQuantity = quantity;
          resultUnit = "mL";
        } else if (physicsInstance.equipmentType === "spring") {
          const naturalLength = physicsInstance.length?.value;
          if (naturalLength == null) {
            return res.status(400).json({ success: false, message: "Spring's natural length hasn't been set yet." });
          }
          physicsInstance.extension = { value: quantity - naturalLength, unit: "cm" };
          const springResult = computeSpringConstant({
            naturalLength_cm: naturalLength,
            extendedLength_cm: quantity,
            mass_g: physicsInstance.attachedMass?.value,
          });
          if (springResult.measurable) {
            physicsInstance.lastMeasurement = {
              measurementType: "spring_constant",
              value: springResult.value,
              targetId: physicsInstance.instanceId,
              measuredAt: new Date(),
            };
          }
          resultQuantity = quantity;
          resultUnit = "cm";
        } else {
          // Generic reading (e.g. a balance recording an object's mass) — stored as attachedMass
          // so mechanicsEngine.resolvePhysicsMeasurement picks it up the same way an explicitly
          // attached mass would be (see the density practical's mass step).
          physicsInstance.attachedMass = { value: quantity, unit: unit || "g" };
          resultQuantity = quantity;
          resultUnit = unit || "g";
        }
        break;
      }

      case "place_component": {
        if (!physicsInstance) return res.status(404).json({ success: false, message: "Equipment instance not found." });
        if (!slotId || !boardId) return res.status(400).json({ success: false, message: "slotId and boardId are required." });
        const board = circuitBoards[boardId];
        if (!board) return res.status(400).json({ success: false, message: `Unknown circuit board: ${boardId}` });
        const slot = board.slots.find((s) => s.slotId === slotId);
        if (!slot) return res.status(400).json({ success: false, message: `Unknown slot "${slotId}" on board "${boardId}".` });

        // Deliberately NOT rejected for role mismatch — a student can drop any component into any
        // slot. Whether it belongs there is evaluated afterward (see evaluateBoard/
        // computeMeterReading), not gatekept here; blocking the drop would just hand the student
        // the answer via trial and error instead of letting them reason about the circuit.

        // A step-scoped board change (e.g. moving from the series board to the parallel board in
        // the same practical) starts filledSlots over — the previous board's placements don't
        // carry across to a different layout.
        if (!labRun.circuitBoardState || labRun.circuitBoardState.boardId !== boardId) {
          labRun.circuitBoardState = { boardId, filledSlots: [] };
        }
        labRun.circuitBoardState.filledSlots = labRun.circuitBoardState.filledSlots.filter(
          (f) => f.slotId !== slotId && f.instanceId !== instanceId
        );
        labRun.circuitBoardState.filledSlots.push({ slotId, instanceId });
        physicsInstance.slotId = slotId;
        break;
      }

      case "remove_component": {
        if (!physicsInstance) return res.status(404).json({ success: false, message: "Equipment instance not found." });
        if (labRun.circuitBoardState) {
          labRun.circuitBoardState.filledSlots = labRun.circuitBoardState.filledSlots.filter((f) => f.instanceId !== instanceId);
        }
        physicsInstance.slotId = null;
        break;
      }

      case "set_component_value": {
        if (!physicsInstance) return res.status(404).json({ success: false, message: "Equipment instance not found." });
        if (quantity == null) return res.status(400).json({ success: false, message: "quantity (resistance in ohms) is required." });
        physicsInstance.resistanceValue = quantity;
        resultQuantity = quantity;
        resultUnit = "Ω";
        break;
      }

      case "read_meter": {
        if (!physicsInstance) return res.status(404).json({ success: false, message: "Equipment instance not found." });
        if (!labRun.circuitBoardState?.boardId) {
          return res.status(400).json({ success: false, message: "No circuit board is active on this bench yet." });
        }

        // Not-measurable (no reading, never a wrong-but-plausible number) if this instrument
        // isn't correctly placed for what it is — see computeMeterReading's reasoning.
        const reading = computeMeterReading({
          boardId: labRun.circuitBoardState.boardId,
          instance: physicsInstance,
          physicsEquipment: labRun.physicsEquipment,
        });
        physicsInstance.lastMeasurement = reading.measurable
          ? { measurementType: reading.metric, value: reading.value, targetId: null, measuredAt: new Date() }
          : { measurementType: null, value: null, targetId: null, measuredAt: new Date() };
        resultQuantity = reading.measurable ? reading.value : null;
        resultUnit = reading.measurable ? reading.unit : null;
        break;
      }

      default:
        return res.status(400).json({ success: false, message: `Unsupported actionType: ${actionType}` });
    }

    labRun.actions.push({
      actionType,
      equipment: actionEquipmentLabel,
      chemicalIds: actionChemicalIds ?? (chemicalId ? [chemicalId] : []),
      quantity: resultQuantity ?? null,
      unit: resultUnit || null,
      temperature: temperature ?? null,
      sourceInstanceId: actionSourceInstanceId,
      targetInstanceId: actionTargetInstanceId,
      reactionId: reactionResult?.found ? reactionResult.reaction.id : null,
      resultType: reactionResult ? (reactionResult.found ? "reaction_success" : "no_reaction") : null,
    });

    await labRun.save();

    res.status(201).json({ success: true, data: labRun, meta: { reactionResult, intervention } });
  } catch (error) {
    next(error);
  }
};

// POST /api/lab/runs/:id/mix
// Superseded by the continuous check in logLabAction (add_chemical/heat) — kept for backward
// compatibility in case anything still calls it explicitly.
// Body: { instanceId, chemicalIds, conditions? }
const mixChemicals = async (req, res, next) => {
  try {
    const { instanceId, chemicalIds, conditions = {} } = req.body;
    if (!instanceId || !Array.isArray(chemicalIds) || chemicalIds.length < 2) {
      return res
        .status(400)
        .json({ success: false, message: "instanceId and at least 2 chemicalIds are required." });
    }

    const labRun = await LabRun.findOne({ _id: req.params.id, userId: req.user._id });
    if (!labRun) return res.status(404).json({ success: false, message: "Lab run not found." });
    if (labRun.status !== "active")
      return res.status(400).json({ success: false, message: "Lab run is not active." });

    const instance = labRun.equipment.find((e) => e.instanceId === instanceId);
    if (!instance) return res.status(404).json({ success: false, message: "Equipment instance not found." });

    const result = await findReaction(chemicalIds, conditions);

    labRun.actions.push({
      actionType: "mix",
      equipment: instance.equipmentType,
      chemicalIds,
      temperature: conditions.temperature ?? null,
      reactionId: result.found ? result.reaction._id : null,
      resultType: result.found ? "reaction_success" : "no_reaction",
    });

    if (result.found) {
      labRun.reactionsTriggered.push(result.reaction._id);
      instance.contents = result.reaction.products.map((p) => ({ chemical: p.chemical._id, volume: null, mass: null }));
      if (conditions.temperature != null) instance.temperature = conditions.temperature;
    }

    await refreshObservableState(instance, result.found ? serializeReactionMatch(result.reaction) : null);

    await labRun.save();

    if (result.found) {
      return res.status(200).json({ success: true, data: serializeReactionMatch(result.reaction) });
    }

    return res.status(200).json({
      success: true,
      data: {
        found: false,
        reason: result.reason,
        explanation: result.explanation || null,
        hint: result.hint || null,
      },
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/lab/runs/:id/complete
const completeLabRun = async (req, res, next) => {
  try {
    const labRun = await LabRun.findOne({ _id: req.params.id, userId: req.user._id });
    if (!labRun) return res.status(404).json({ success: false, message: "Lab run not found." });

    labRun.status = "completed";
    labRun.endedAt = new Date();
    await labRun.save();

    res.status(200).json({ success: true, message: "Lab run completed.", data: labRun });
  } catch (error) {
    next(error);
  }
};

// POST /api/lab/runs/:id/tutor
const askTutor = async (req, res, next) => {
  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ success: false, message: "question is required." });

    const labRun = await LabRun.findOne({ _id: req.params.id, userId: req.user._id });
    if (!labRun) return res.status(404).json({ success: false, message: "Lab run not found." });

    const chemicalIdsPresent = labRun.equipment.flatMap((e) => e.contents.map((c) => c.chemical)).filter(Boolean);
    const chemicalsPresent = chemicalIdsPresent.length
      ? await Chemical.find({ _id: { $in: chemicalIdsPresent } }).lean()
      : [];

    const recentActions = labRun.actions.slice(-RECENT_ACTIONS_FOR_TUTOR);
    const conversationHistory = labRun.tutorConversation.slice(-MAX_TUTOR_HISTORY);

    const answer = await generateTutorResponse({
      chemicalsPresent,
      recentActions,
      conversationHistory,
      question,
      grade: req.user.grade,
    });

    labRun.tutorConversation.push({ role: "user", content: question });
    labRun.tutorConversation.push({ role: "assistant", content: answer });
    await labRun.save();

    res.status(200).json({ success: true, data: { answer } });
  } catch (error) {
    next(error);
  }
};

module.exports = { startLabRun, getLabRun, logLabAction, mixChemicals, completeLabRun, askTutor };
