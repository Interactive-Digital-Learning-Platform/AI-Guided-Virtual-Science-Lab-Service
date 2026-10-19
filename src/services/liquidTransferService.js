const { generateInterventionHint } = require("./labHintService");

// Deterministic, state-based model of liquid-transfer instruments (Phase 1: dropper). No fluid
// dynamics — just a lifecycle the student must step through:
//   empty → positioned_in_source → filled → positioned_over_target → (dispense ×N) → empty
// The LabRun stays the source of truth (equipmentInstanceSchema.transfer); this module only
// mutates it and reports interventions. Reaction checks after a dispense are run by the caller
// (labRun.controller.js already owns checkAndApplyReaction).

const TRANSFER_INSTRUMENTS = {
  // capacity = how much the instrument holds; fill = drawn per aspirate; drop = delivered per dispense
  dropper: { capacity: 1, fill: 1, drop: 0.05 },
  pipette: { capacity: 10, fill: 10, drop: 10 }, // Phase 2 — fixed-volume transfer
  burette: { capacity: 50, fill: 50, drop: 0.5 }, // Phase 3 — controlled dispensing
};

const isTransferInstrument = (equipmentType) => !!TRANSFER_INSTRUMENTS[equipmentType];

const ensureTransfer = (instrument) => {
  if (!instrument.transfer || !instrument.transfer.status) {
    instrument.transfer = {
      status: "empty",
      contents: [],
      capacity: TRANSFER_INSTRUMENTS[instrument.equipmentType]?.capacity ?? null,
      sourceInstanceId: null,
      lastSourceInstanceId: null,
      targetInstanceId: null,
      contaminated: false,
    };
  }
  return instrument.transfer;
};

const heldChemicalId = (t) => (t.contents[0] ? t.contents[0].chemical.toString() : null);

// --- insert_transfer_tool: place the instrument tip into a container ------------------------------
const insertTransferTool = async ({ instrument, target, experimentTitle }) => {
  if (!target) return { error: "targetInstanceId is required." };
  const t = ensureTransfer(instrument);
  const held = heldChemicalId(t);

  if (!held) {
    // Empty instrument on a container → positioning in a SOURCE to draw from.
    const liquid = target.contents.find((c) => c.volume != null && c.volume > 0);
    if (!liquid) return { error: "There's no liquid in that container to draw up." };
    t.status = "positioned_in_source";
    t.sourceInstanceId = target.instanceId;
    return {};
  }

  // Filled instrument on a container → positioning OVER a target to dispense into. The target
  // legitimately holds a different liquid — that's the point — so this is never contamination.
  // (Contamination is only flagged when the student re-fills a dirty instrument from a new
  // source: see applyAspirate / loadFromReagent.)
  t.status = "positioned_over_target";
  t.targetInstanceId = target.instanceId;
  return {};
};

// --- loadFromReagent: fill the instrument straight from a reagent bottle -------------------------
// Models the fact that indicators / stock reagents come *in* a dropper bottle — the student drags
// the reagent onto the dropper instead of needing a separate stock container to dip into.
const loadFromReagent = async ({ instrument, chemicalId, experimentTitle }) => {
  if (!isTransferInstrument(instrument.equipmentType)) {
    return { error: "That can't be filled like a dropper." };
  }
  const t = ensureTransfer(instrument);
  const spec = TRANSFER_INSTRUMENTS[instrument.equipmentType];
  const prevChem = heldChemicalId(t);

  t.contents = [{ chemical: chemicalId, volume: spec.fill }];
  t.capacity = spec.capacity;
  t.status = "filled";

  if (prevChem && prevChem !== chemicalId.toString()) {
    t.contaminated = true;
    const hint = await generateInterventionHint({
      triggerType: "transfer_contamination",
      experimentTitle,
      context: { instrument: instrument.equipmentType },
    });
    return { intervention: { type: "transfer_contamination", hint } };
  }
  return {};
};

// --- aspirate: draw liquid up from the positioned source ----------------------------------------
const aspirate = async ({ instrument }) => {
  const t = ensureTransfer(instrument);
  if (t.status !== "positioned_in_source" || !t.sourceInstanceId) {
    return { error: "Put the instrument into a liquid before filling it.", needsSource: true };
  }
  return { fill: true }; // caller resolves the source instance and applies the transfer
};

// Applied by the caller once it has resolved the source instance (it owns labRun.equipment).
const applyAspirate = async ({ instrument, source, experimentTitle }) => {
  const t = ensureTransfer(instrument);
  const spec = TRANSFER_INSTRUMENTS[instrument.equipmentType];
  const src = [...source.contents].reverse().find((c) => c.volume != null && c.volume > 0);
  if (!src) return { error: "There's no liquid left to draw from." };

  const taken = Math.min(spec.fill, src.volume);
  src.volume = Math.round((src.volume - taken) * 1000) / 1000;

  const prevChem = heldChemicalId(t);
  t.contents = [{ chemical: src.chemical, volume: taken }];
  t.capacity = spec.capacity;
  t.status = "filled";
  t.lastSourceInstanceId = t.sourceInstanceId;

  if (prevChem && prevChem !== src.chemical.toString()) {
    t.contaminated = true;
    const hint = await generateInterventionHint({
      triggerType: "transfer_contamination",
      experimentTitle,
      context: { instrument: instrument.equipmentType },
    });
    return { intervention: { type: "transfer_contamination", hint } };
  }
  return {};
};

// --- dispense: deliver one measure into the positioned target -----------------------------------
const dispense = async ({ instrument, target, experimentTitle }) => {
  const t = ensureTransfer(instrument);
  const held = t.contents[0];
  if (!held || (held.volume ?? 0) <= 0) {
    return { error: "The instrument is empty — draw up a liquid first." };
  }
  if (!target) return { error: "Position the instrument over a container first." };

  const spec = TRANSFER_INSTRUMENTS[instrument.equipmentType];
  const give = Math.min(spec.drop, held.volume);
  held.volume = Math.round((held.volume - give) * 1000) / 1000;

  const existing = target.contents.find((c) => c.chemical.toString() === held.chemical.toString());
  if (existing) existing.volume = Math.round(((existing.volume ?? 0) + give) * 1000) / 1000;
  else target.contents.push({ chemical: held.chemical, volume: give, mass: null });

  const dispensedChemicalId = held.chemical;
  if (held.volume <= 0.0001) {
    t.contents = [];
    t.status = "empty";
  } else {
    t.status = "positioned_over_target";
  }
  t.targetInstanceId = target.instanceId;

  let intervention = null;
  if (t.contaminated) {
    const hint = await generateInterventionHint({
      triggerType: "transfer_contamination",
      experimentTitle,
      context: { instrument: instrument.equipmentType },
    });
    intervention = { type: "transfer_contamination", hint };
  }
  return { dispensedChemicalId, intervention };
};

// --- grading: was a valid transfer actually performed for this micro-step? ----------------------
// `expectedTransfer` = { method?, instrumentCategory?, sourceChemical?, minDispenses }. Instrument
// acceptance is capability-based when `method` is set (any instrument with that capability),
// exact-type when only `instrumentCategory` is set. `sinceDate` scopes it to the current
// micro-step attempt so a dispense from an earlier task doesn't carry over. Experiment-independent.
const { hasCapability } = require("../data/equipmentCapabilities");

const wasTransferPerformed = (labRun, expectedTransfer, sinceDate) => {
  if (!expectedTransfer || (!expectedTransfer.method && !expectedTransfer.instrumentCategory)) return true;
  const { method, instrumentCategory, sourceChemical, minDispenses = 1 } = expectedTransfer;
  const since = sinceDate ? new Date(sinceDate).getTime() : 0;

  const instrumentOk = (equipmentType) =>
    method ? hasCapability(equipmentType, method) : equipmentType === instrumentCategory;

  const matching = (labRun?.actions || []).filter((a) => {
    if (a.actionType !== "dispense") return false;
    if (!instrumentOk(a.equipment)) return false;
    if (a.targetInstanceId && a.sourceInstanceId && a.targetInstanceId === a.sourceInstanceId) return false;
    if (sourceChemical && !(a.chemicalIds || []).some((id) => id.toString() === sourceChemical.toString())) return false;
    if (since && new Date(a.timestamp).getTime() < since) return false;
    return true;
  });
  return matching.length >= (minDispenses || 1);
};

module.exports = {
  TRANSFER_INSTRUMENTS,
  isTransferInstrument,
  ensureTransfer,
  insertTransferTool,
  loadFromReagent,
  aspirate,
  applyAspirate,
  dispense,
  wasTransferPerformed,
};
