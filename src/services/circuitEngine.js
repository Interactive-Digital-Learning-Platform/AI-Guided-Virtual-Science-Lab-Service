// Deterministic circuit formulas for the Electricity practicals — same "curated, deterministic
// state, not a real circuit solver" principle as reactionEngine.js/mechanicsEngine.js. This is
// deliberately a fixed-topology slot-fill check plus Ohm's Law arithmetic, not a general
// circuit/graph solver — see circuitBoards.js for why a full wire-drawing model was scoped out.
//
// Placement itself is never rejected for role mismatch (see place_component in
// labRun.controller.js) — a student is free to drop any component into any slot. Correctness is
// evaluated afterward, here, so a wrong choice is a data point (feeds the hint/misconception
// system) rather than a blocked action that gives the answer away via trial and error.
const { circuitBoards } = require("../data/circuitBoards");

// I = V/R (single), R_total = R1+R2 (series), R_total = (R1*R2)/(R1+R2) (parallel).
const computeOhmsLaw = ({ topology, resistorValues, batteryVoltage }) => {
  const values = (resistorValues || []).filter((v) => v != null && v > 0);
  if (values.length === 0) return { measurable: false, current: null, resistance: null, voltage: null, reason: "no_resistor_values" };

  let resistance;
  if (topology === "single") {
    resistance = values[0];
  } else if (topology === "series") {
    resistance = values.reduce((sum, r) => sum + r, 0);
  } else if (topology === "parallel") {
    resistance = 1 / values.reduce((sum, r) => sum + 1 / r, 0);
  } else {
    return { measurable: false, current: null, resistance: null, voltage: null, reason: "unknown_topology" };
  }

  const current = batteryVoltage / resistance;
  return {
    measurable: true,
    current: Math.round(current * 1000) / 1000,
    resistance: Math.round(resistance * 100) / 100,
    voltage: batteryVoltage,
    reason: null,
  };
};

// Checks every required slot on the given board — a slot filled with the WRONG-role component is
// reported as "misplaced", distinct from "missing" (nothing there at all), so the hint system can
// eventually distinguish "you haven't tried anything here yet" from "what you tried doesn't
// belong here" without ever naming which component actually does.
const evaluateBoard = ({ boardId, filledSlots = [], physicsEquipment = [] }) => {
  const board = circuitBoards[boardId];
  if (!board) return { correct: false, missingSlots: [], misplacedSlots: [], board: null };

  const bySlotId = Object.fromEntries(filledSlots.map((f) => [f.slotId, f]));
  const instanceById = Object.fromEntries(physicsEquipment.map((e) => [e.instanceId, e]));
  const missingSlots = [];
  const misplacedSlots = [];

  board.slots
    .filter((s) => s.required)
    .forEach((s) => {
      const filled = bySlotId[s.slotId];
      if (!filled) return missingSlots.push(s.slotId);
      const inst = instanceById[filled.instanceId];
      if (!inst || inst.role !== s.acceptsRole) misplacedSlots.push(s.slotId);
    });

  return { correct: missingSlots.length === 0 && misplacedSlots.length === 0, missingSlots, misplacedSlots, board };
};

// Only a component sitting in a slot whose acceptsRole matches its own role actually contributes
// electrically — a resistor dropped into an ammeter's slot doesn't add resistance any more than a
// real ammeter wired into that position would; the circuit is simply incomplete there.
const getCorrectlyPlacedResistorValues = (board, physicsEquipment) =>
  physicsEquipment
    .filter((e) => e.role === "resistor" && e.slotId)
    .filter((e) => board.slots.find((s) => s.slotId === e.slotId)?.acceptsRole === "resistor")
    .map((e) => e.resistanceValue)
    .filter((v) => v != null);

// What a given meter instance would actually read right now, given the live board state.
// Not-measurable (no reading at all — never a wrong-but-plausible number) if the meter itself
// isn't correctly placed: a real ammeter wired in parallel or a voltmeter wired in series doesn't
// give a sensible reading either, so this mirrors that rather than exposing "you're wrong."
const computeMeterReading = ({ boardId, instance, physicsEquipment = [] }) => {
  const board = circuitBoards[boardId];
  if (!board) return { measurable: false, metric: null, value: null, unit: null, reason: "no_board" };

  const slot = board.slots.find((s) => s.slotId === instance.slotId);
  if (!slot || slot.acceptsRole !== instance.role) {
    return { measurable: false, metric: null, value: null, unit: null, reason: "instrument_misplaced" };
  }

  const resistorValues = getCorrectlyPlacedResistorValues(board, physicsEquipment);
  const ohms = computeOhmsLaw({ topology: board.topology, resistorValues, batteryVoltage: board.batteryVoltage });
  if (!ohms.measurable) return { measurable: false, metric: null, value: null, unit: null, reason: ohms.reason };

  const metric = instance.role === "ammeter" ? "current" : "voltage";
  const value = metric === "current" ? ohms.current : ohms.voltage;
  return { measurable: true, metric, value, unit: metric === "current" ? "A" : "V", reason: null };
};

// Resolves "what the bench actually says the answer is" for resistance/current/voltage metrics —
// the circuit-domain counterpart to mechanicsEngine.js's resolvePhysicsMeasurement, read by
// session.controller.js's logAction the same way. current/voltage come from a meter the student
// has already read (read_meter, see labRun.controller.js); resistance has no "resistance meter"
// to read from — a student derives it themselves (R = V/I) — so it's computed directly from
// whatever's correctly slotted on the active board, the same way computeMeterReading does.
const resolvePhysicsMeasurement = ({ metric, physicsEquipment = [], circuitBoardState = null }) => {
  if (metric === "current" || metric === "voltage") {
    const meterRole = metric === "current" ? "ammeter" : "voltmeter";
    const meter = physicsEquipment.find((e) => e.role === meterRole && e.lastMeasurement?.measurementType === metric);
    if (!meter) return { measurable: false, value: null, unit: null, reason: "no_meter_reading_recorded" };
    return { measurable: true, value: meter.lastMeasurement.value, unit: metric === "current" ? "A" : "V", reason: null };
  }

  if (metric === "resistance") {
    const board = circuitBoards[circuitBoardState?.boardId];
    if (!board) return { measurable: false, value: null, unit: null, reason: "no_circuit_board_active" };
    const resistorValues = getCorrectlyPlacedResistorValues(board, physicsEquipment);
    const ohms = computeOhmsLaw({ topology: board.topology, resistorValues, batteryVoltage: board.batteryVoltage });
    if (!ohms.measurable) return { measurable: false, value: null, unit: null, reason: ohms.reason };
    return { measurable: true, value: ohms.resistance, unit: "Ω", reason: null };
  }

  return { measurable: false, value: null, unit: null, reason: "unsupported_metric" };
};

module.exports = { computeOhmsLaw, evaluateBoard, resolvePhysicsMeasurement, computeMeterReading };
