const mongoose = require("mongoose");

const reactionSchema = new mongoose.Schema(
  {
    reactionId: { type: String, required: true, unique: true, trim: true }, // slug, e.g. "hcl-naoh-neutralization"
    name: { type: String, required: true, trim: true },
    reactants: [
      {
        chemical: { type: mongoose.Schema.Types.ObjectId, ref: "Chemical", required: true },
        coefficient: { type: Number, default: 1 },
      },
    ],
    products: [
      {
        chemical: { type: mongoose.Schema.Types.ObjectId, ref: "Chemical", required: true },
        coefficient: { type: Number, default: 1 },
      },
    ],
    // Precomputed sorted-reactant-id key, e.g. "<id1>+<id2>", used for O(1) lookup by the reaction engine.
    reactantKey: { type: String, required: true, unique: true, index: true },
    balancedEquation: { type: String, required: true },
    reactionType: {
      type: String,
      enum: ["neutralization", "precipitation", "combustion", "redox", "synthesis", "decomposition", "displacement"],
      required: true,
    },
    conditions: {
      requiresHeat: { type: Boolean, default: false },
      minTemperature: { type: Number, default: null },
      maxTemperature: { type: Number, default: null },
      requiresCatalyst: { type: Boolean, default: false },
      catalyst: { type: String, default: null },
    },
    observableChanges: {
      colorChange: {
        from: { type: String, default: null },
        to: { type: String, default: null },
      },
      gasProduced: { type: Boolean, default: false },
      gasName: { type: String, default: null },
      precipitateFormed: { type: Boolean, default: false },
      precipitateColor: { type: String, default: null },
      heatProduced: { type: Boolean, default: false },
      energyChange: { type: String, enum: ["exothermic", "endothermic", "none"], default: "none" },
    },
    educationalInfo: {
      electronConfiguration: { type: String, default: null },
      lewisStructureDescription: { type: String, default: null },
      molecularGeometry: { type: String, default: null },
      bondType: { type: String, enum: ["ionic", "covalent", "polar covalent", "metallic", null], default: null },
      explanation: { type: String, default: "" },
    },
    safetyNotes: [{ type: String }],
    difficulty: { type: String, enum: ["easy", "medium", "hard"], default: "easy" },
    grades: [{ type: Number, min: 6, max: 11 }],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Reaction", reactionSchema);
