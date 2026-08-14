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
      ],
      required: true,
    },
    equipment: { type: String, default: null },
    chemicalIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Chemical" }],
    quantity: { type: Number, default: null },
    unit: { type: String, default: null },
    temperature: { type: Number, default: null },
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
    // Probe-role equipment only (e.g. pH meter): the container instanceId its probe currently
    // overlaps, and the last reading taken from that target. See phService.js / probe_measure.
    probeTargetId: { type: String, default: null },
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
    actions: [actionSchema],
    reactionsTriggered: [{ type: mongoose.Schema.Types.ObjectId, ref: "Reaction" }],
    tutorConversation: [tutorTurnSchema],
  },
  { timestamps: true }
);

labRunSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.model("LabRun", labRunSchema);
