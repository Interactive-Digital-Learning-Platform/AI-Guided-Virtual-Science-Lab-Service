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
  // What this step actually requires to be marked correct — checked against the live bench
  // (LabRun.equipment, see session.controller.js's evaluateStepOnBench) rather than trusted from
  // the client, same "backend remains the source of truth" principle as the reaction engine.
  // requiredChemicalsForStep was originally mix-step-only (graded via reactionEngine.js); it's now
  // populated and validated for any step that genuinely involves a chemical. requiredEquipment is
  // step-scoped and distinct from the experiment-level requiredEquipment above (that one gates the
  // non-blocking pre-procedure equipment-selection screen; this one hard-validates a specific step
  // once the student is inside the workspace). Both fields also feed the AI equipment/chemical hint
  // system (labHintService.js) — never sent to the client directly (see the field-exclusion selects
  // in experiment.controller.js / session.controller.js).
  requiredChemicalsForStep: [{ type: mongoose.Schema.Types.ObjectId, ref: "Chemical" }],
  requiredEquipment: [{ type: String }],
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
    lesson: { type: String, default: "" },
    theory: { type: String, default: "" },
    keyConcepts: [{ type: String }],
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
