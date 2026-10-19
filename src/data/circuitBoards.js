// Fixed slot-based circuit board layouts for the Electricity (Phase B) practicals — authored
// content, not bench state (mirrors equipment.constants.ts's catalog pattern on the mobile side).
// Each board is a closed loop with a FIXED battery (drawn, never a slot — a real circuit always
// needs one, so there's nothing pedagogically useful in making students place it) and a small set
// of fixed slots the student fills by dragging resistor/ammeter/voltmeter components onto them.
// `anchor` coordinates are positions within a shared 300x220 viewBox that both the backend (for
// reference) and the mobile CircuitBoard.tsx / circuitBoards.constants.ts agree on.
const circuitBoards = {
  single_resistor: {
    boardId: "single_resistor",
    title: "Single Resistor Circuit",
    topology: "single",
    batteryVoltage: 12,
    slots: [
      { slotId: "R1", acceptsRole: "resistor", required: true, anchor: { x: 150, y: 40 } },
      { slotId: "A1", acceptsRole: "ammeter", required: true, anchor: { x: 260, y: 110 } },
      { slotId: "V1", acceptsRole: "voltmeter", required: true, anchor: { x: 150, y: 180 } },
    ],
  },
  series_two_resistor: {
    boardId: "series_two_resistor",
    title: "Series Resistor Circuit",
    topology: "series",
    batteryVoltage: 12,
    slots: [
      { slotId: "R1", acceptsRole: "resistor", required: true, anchor: { x: 90, y: 40 } },
      { slotId: "R2", acceptsRole: "resistor", required: true, anchor: { x: 210, y: 40 } },
      { slotId: "A1", acceptsRole: "ammeter", required: true, anchor: { x: 260, y: 110 } },
    ],
  },
  parallel_two_resistor: {
    boardId: "parallel_two_resistor",
    title: "Parallel Resistor Circuit",
    topology: "parallel",
    batteryVoltage: 12,
    slots: [
      { slotId: "R1", acceptsRole: "resistor", required: true, anchor: { x: 100, y: 40 } },
      { slotId: "R2", acceptsRole: "resistor", required: true, anchor: { x: 100, y: 130 } },
      { slotId: "A1", acceptsRole: "ammeter", required: true, anchor: { x: 260, y: 85 } },
    ],
  },
};

// Maps a placeable equipmentType to the circuit role it fills — used to set physicsInstance.role
// at creation time (labRun.controller.js) and to validate a slot placement (evaluateBoard).
const CIRCUIT_EQUIPMENT_ROLES = {
  resistor: "resistor",
  ammeter: "ammeter",
  voltmeter: "voltmeter",
};

module.exports = { circuitBoards, CIRCUIT_EQUIPMENT_ROLES };
