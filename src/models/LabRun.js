const mongoose = require("mongoose");

const actionSchema = new mongoose.Schema(
  {
    actionType: {
      type: String,
      enum: [
        "create_equipment",
        "move_equipment",
        "remove_equipment",
        "add_chemical",
        "remove_chemical",
        "mix",
        "heat",
        "cool",
        "stir",
        "measure",
        "pour",
        "reset",
        "probe_measure",
        "probe_detach",
        // Liquid-transfer instruments (dropper first — see liquidTransferService.js).
        "insert_transfer_tool",
        "load_transfer_tool",
        "aspirate",
        "dispense",
        // Non-blocking material selection (see labMaterialSchema below): the student pulls an
        // extra chemical into the live lab from the in-workspace Material Library, mid-session.
        "add_material_to_lab",
        // Mechanics (Phase A physics) — see mechanicsEngine.js.
        "attach_mass",
        "set_pendulum_length",
        "set_length", // generic alias of set_pendulum_length — e.g. a spring's natural length
        "set_release_angle",
        "start_timer",
        "stop_timer",
        "record_oscillation",
        "read_measurement",
        // Electricity (Phase B) — see circuitEngine.js.
        "place_component",
        "remove_component",
        "set_component_value",
        "read_meter",
      ],
      required: true,
    },
    equipment: { type: String, default: null },
    chemicalIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Chemical" }],
    quantity: { type: Number, default: null },
    unit: { type: String, default: null },
    temperature: { type: Number, default: null },
    // Liquid-transfer actions (insert_transfer_tool / aspirate / dispense): which instance the
    // instrument drew from / delivered to, so telemetry can reconstruct the procedure.
    sourceInstanceId: { type: String, default: null },
    targetInstanceId: { type: String, default: null },
    reactionId: { type: mongoose.Schema.Types.ObjectId, ref: "Reaction", default: null },
    resultType: { type: String, enum: ["reaction_success", "no_reaction", null], default: null },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false }
);

const tutorTurnSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["user", "assistant"], required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false }
);

// One physical container/tool placed on the bench. Keyed by instanceId (client-generated, e.g.
// "beaker-<timestamp>") rather than equipmentType, so a student can have multiple beakers at once.
const equipmentInstanceSchema = new mongoose.Schema(
  {
    instanceId: { type: String, required: true },
    equipmentType: { type: String, required: true },
    position: {
      x: { type: Number, default: 0 },
      y: { type: Number, default: 0 },
    },
    contents: [
      {
        chemical: { type: mongoose.Schema.Types.ObjectId, ref: "Chemical", required: true },
        volume: { type: Number, default: null }, // mL — liquids/aqueous/gas
        mass: { type: Number, default: null }, // g — solids
      },
    ],
    temperature: { type: Number, default: 25 }, // °C, room temperature by default
    isHeated: { type: Boolean, default: false },
    // Student-chosen vessel capacity in mL (e.g. a 5 / 10 / 20 mL test tube) — set at
    // create_equipment time. null falls back to the catalog default (equipment.constants.ts).
    // Drives the fill-level normalisation and the inspect panel; not a hard overflow gate.
    capacity: { type: Number, default: null },
    // Liquid-transfer instruments only (dropper/pipette/burette). Empty {} for every other
    // instance — added as an optional sub-doc so no existing LabRun needs migrating. See
    // liquidTransferService.js for the lifecycle (empty → positioned_in_source → filled →
    // positioned_over_target → dispensing → empty).
    transfer: {
      status: {
        type: String,
        enum: ["empty", "positioned_in_source", "filled", "positioned_over_target", "dispensing", null],
        default: null,
      },
      contents: [
        {
          chemical: { type: mongoose.Schema.Types.ObjectId, ref: "Chemical" },
          volume: { type: Number, default: null }, // mL
        },
      ],
      capacity: { type: Number, default: null }, // mL — nominal max the instrument holds
      sourceInstanceId: { type: String, default: null },
      lastSourceInstanceId: { type: String, default: null },
      targetInstanceId: { type: String, default: null },
      // Set when the instrument still held one chemical and was inserted into a source holding a
      // different one — a procedural-misconception signal, not a chemistry effect.
      contaminated: { type: Boolean, default: false },
    },
    // Probe-role equipment only (e.g. pH meter): the container instanceId its probe currently
    // overlaps, and the last reading taken from that target. See phService.js / probe_measure.
    probeTargetId: { type: String, default: null },
    // Authoritative observable appearance of this container's current contents — computed by
    // services/appearanceService.js after any contents change (add_chemical / pour / dispense /
    // heat / reset / mix) and rendered as-is by the mobile client (spec §11/§12). Optional
    // sub-doc so no existing LabRun needs migrating; an unset one falls back to per-chemical
    // appearance on the client.
    observableState: {
      liquidColor: { type: String, default: null }, // hex
      opacity: { type: Number, default: null }, // 0..1 fill opacity
      phase: { type: String, default: null },
      hasPrecipitate: { type: Boolean, default: false },
      precipitateColor: { type: String, default: null },
      gasProduced: { type: Boolean, default: false },
      cloudiness: { type: Number, default: 0 }, // 0..1
      // "exothermic" | "endothermic" | null — set from the reaction that just fired, so the bench
      // can flag "the flask feels warm/cold" right after the action (spec §9/§22).
      temperatureChange: { type: String, default: null },
      description: { type: String, default: null }, // matches the generated observation text (spec §23)
      source: { type: String, default: null }, // reaction | indicator | chemical | solid | default
      lastChangedAt: { type: Date, default: null }, // bumped only on a real visible change
    },
    lastMeasurement: {
      // Not named "type" — a nested field literally called "type" alongside sibling fields makes
      // Mongoose misread the whole lastMeasurement object as SchemaType shorthand.
      measurementType: { type: String, default: null }, // "ph"
      value: { type: Number, default: null },
      targetId: { type: String, default: null },
      measuredAt: { type: Date, default: null },
    },
  },
  { _id: false }
);

// Physics-only sibling of equipmentInstanceSchema. A chemistry-shaped container instance
// (contents/temperature/isHeated) has no meaningful equivalent for a pendulum, spring, or circuit
// component, so physics bench state gets its own array (labRunSchema.physicsEquipment) rather than
// overloading equipmentInstanceSchema — every existing consumer of labRun.equipment (mobile
// EquipmentInstanceType, LabWorkspace.tsx, checkAndApplyReaction, evaluateOnBench) is left
// completely untouched; a chemistry LabRun simply never populates physicsEquipment.
const physicsInstanceSchema = new mongoose.Schema(
  {
    instanceId: { type: String, required: true },
    equipmentType: { type: String, required: true },
    position: {
      x: { type: Number, default: 0 },
      y: { type: Number, default: 0 },
    },
    // Mechanics (Phase A)
    attachedMass: { value: { type: Number, default: null }, unit: { type: String, default: "g" } },
    length: { value: { type: Number, default: null }, unit: { type: String, default: "cm" } },
    angle: { value: { type: Number, default: null }, unit: { type: String, default: "deg" } },
    extension: { value: { type: Number, default: null }, unit: { type: String, default: "cm" } },
    timerState: {
      running: { type: Boolean, default: false },
      startedAt: { type: Date, default: null },
      elapsedSeconds: { type: Number, default: 0 },
      oscillationCount: { type: Number, default: 0 },
    },
    measuredVolumeDisplacement: {
      initial: { type: Number, default: null },
      final: { type: Number, default: null },
    },
    // Electricity (Phase B) — unused by mechanics instances.
    slotId: { type: String, default: null },
    resistanceValue: { type: Number, default: null },
    role: { type: String, enum: ["resistor", "ammeter", "voltmeter", "battery", "wire_link", null], default: null },
    lastMeasurement: {
      // "period" | "spring_constant" | "density" | "resistance" | "current" | "voltage"
      measurementType: { type: String, default: null },
      value: { type: Number, default: null },
      targetId: { type: String, default: null },
      measuredAt: { type: Date, default: null },
    },
  },
  { _id: false }
);

// One chemical that is physically available in this live lab — the LabRun's "material inventory"
// (LabRun = physical lab state; Session.chemicalSelection stays the untouched pedagogical record
// of the student's *initial* plan). Seeded from the Session's confirmed selection + built
// compounds when the run is created (each wasInitiallySelected: true), then grown by
// add_material_to_lab as the student realises mid-experiment that they need something else. This
// is the source list the workspace's "On Hand" materials come from — never the initial selection.
const labMaterialSchema = new mongoose.Schema(
  {
    chemical: { type: mongoose.Schema.Types.ObjectId, ref: "Chemical", required: true },
    // false → the student added it from the in-lab Material Library after entering the workspace.
    // The recover-from-a-planning-mistake signal the report/analytics side cares about.
    wasInitiallySelected: { type: Boolean, default: false },
    addedAt: { type: Date, default: Date.now },
    // Session position when a mid-lab material was added (null for the seeded initial set) — lets
    // analytics line up "opened the library" with the task that prompted it.
    addedDuringStep: { type: Number, default: null },
    addedDuringMicroStep: { type: Number, default: null },
    // true → a missing-material hint had already been shown for the current task before this
    // material was added (the "missed a material → asked for guidance → recovered" pattern the
    // research report cares about — spec §16/§18).
    hintPrecededAddition: { type: Boolean, default: false },
  },
  { _id: false }
);

const labRunSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    // Set when this LabRun is the live bench backing a specific guided-practical Session
    // (see session.controller.js) rather than a standalone freeform run.
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: "Session", default: null, index: true },
    status: { type: String, enum: ["active", "completed", "abandoned"], default: "active" },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
    equipment: [equipmentInstanceSchema],
    // Chemical material inventory — what's physically available in this lab right now. Optional /
    // defaultable so no existing LabRun needs migrating: an empty array means "not seeded yet",
    // and consumers fall back to the Session's chemicalSelection (see workspace.tsx).
    materials: [labMaterialSchema],
    // Physics bench state, parallel to `equipment` — see physicsInstanceSchema above. A given
    // LabRun populates one or the other depending on the practical's subject, never both.
    physicsEquipment: [physicsInstanceSchema],
    // Electricity (Phase B) only: which slot board is currently active and what's placed where —
    // set/reset by the first place_component call for a given boardId (see labRun.controller.js).
    // A practical whose steps use different boards (e.g. series then parallel) resets filledSlots
    // when the boardId changes, since the previous board's placements don't carry over.
    circuitBoardState: {
      boardId: { type: String, default: null },
      filledSlots: [{ slotId: { type: String }, instanceId: { type: String } }],
    },
    actions: [actionSchema],
    reactionsTriggered: [{ type: mongoose.Schema.Types.ObjectId, ref: "Reaction" }],
    tutorConversation: [tutorTurnSchema],
  },
  { timestamps: true }
);

labRunSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.model("LabRun", labRunSchema);
