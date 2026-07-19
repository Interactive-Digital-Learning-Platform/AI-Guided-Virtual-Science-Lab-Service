const mongoose = require("mongoose");

const stepSchema = new mongoose.Schema({
  stepId: { type: Number, required: true },
  title: { type: String, required: true },
  instruction: { type: String, required: true },
  expectedAction: { type: String, required: true },
  actionType: {
    type: String,
    enum: ["measure", "add", "observe", "record", "calculate", "setup", "mix", "heat", "filter", "pour", "stir"],
    required: true,
  },
  // For "mix" steps in Chemistry practicals tied to a curated reaction — lets the server
  // authoritatively verify the student's chemical selection against reactionEngine.js
  // instead of trusting the client's self-reported correctness (matches spec's
  // "backend must remain the source of truth" principle).
  requiredChemicalsForStep: [{ type: mongoose.Schema.Types.ObjectId, ref: "Chemical" }],
  conceptTags: [{ type: mongoose.Schema.Types.ObjectId, ref: "Concept" }],
  misconceptionRisks: [{ type: String }], // misconception codes e.g. "PHY_001"
  timeLimit: { type: Number, default: 120 }, // seconds
  hints: [
    {
      level: { type: Number, min: 1, max: 3 },
      text: { type: String },
    },
  ],
  imageUrl: { type: String, default: null },
  isOptional: { type: Boolean, default: false },
});

const experimentSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    subject: { type: String, enum: ["Physics", "Chemistry", "Biology"], required: true },
    grades: [{ type: Number, min: 6, max: 11 }], // applicable grades
    difficulty: { type: String, enum: ["easy", "medium", "hard"], required: true },
    estimatedTime: { type: Number, required: true }, // minutes
    description: { type: String, required: true },
    objectives: [{ type: String }],
    materials: [{ type: String }],
    steps: [stepSchema],
    relatedConcepts: [{ type: mongoose.Schema.Types.ObjectId, ref: "Concept" }],
    commonMisconceptions: [{ type: String }], // misconception codes
    thumbnailColor: { type: String, default: "#4F8EF7" },
    totalAttempts: { type: Number, default: 0 },
    averageScore: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },

    // Pre-procedure selection phases (Chemistry practicals; optional for Physics/Biology).
    // Evaluated before `steps` begin — see equipment/chemical selection endpoints.
    requiredEquipment: [{ type: String }], // equipment type keys, e.g. "beaker", "ph_meter"
    optionalEquipment: [{ type: String }], // valid but non-essential — not flagged as "unnecessary"
    requiredChemicals: [
      {
        chemical: { type: mongoose.Schema.Types.ObjectId, ref: "Chemical", required: true },
        quantity: { type: Number, default: null },
        unit: { type: String, default: null },
      },
    ],
    expectedObservations: [{ type: String }],
    safetyInformation: [{ type: String }],
    // For Chemistry practicals whose "Perform Experiment" phase resolves to a known reaction
    // in the curated reaction database (see Reaction model / reactionEngine.js).
    reactionId: { type: mongoose.Schema.Types.ObjectId, ref: "Reaction", default: null },
  },
  { timestamps: true }
);

experimentSchema.index({ subject: 1, grades: 1, difficulty: 1 });

module.exports = mongoose.model("Experiment", experimentSchema);
