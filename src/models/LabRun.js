const mongoose = require("mongoose");

const actionSchema = new mongoose.Schema(
  {
    actionType: {
      type: String,
      enum: ["add_chemical", "remove_chemical", "mix", "heat", "cool", "stir", "measure", "pour", "reset"],
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

const labRunSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    status: { type: String, enum: ["active", "completed", "abandoned"], default: "active" },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
    // Freeform snapshot: { [equipmentInstanceId]: { equipmentType, position, chemicalIds, temperature, volume } }
    equipmentState: { type: mongoose.Schema.Types.Mixed, default: {} },
    actions: [actionSchema],
    reactionsTriggered: [{ type: mongoose.Schema.Types.ObjectId, ref: "Reaction" }],
    tutorConversation: [tutorTurnSchema],
  },
  { timestamps: true }
);

labRunSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.model("LabRun", labRunSchema);
