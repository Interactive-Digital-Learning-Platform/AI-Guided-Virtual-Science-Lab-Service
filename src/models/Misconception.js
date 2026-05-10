const mongoose = require("mongoose");

const misconceptionSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, index: true }, // e.g. "PHY_001"
    subject: { type: String, enum: ["Physics", "Chemistry", "Biology", "General"], required: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    detailedExplanation: { type: String, required: true },
    relatedConcepts: [{ type: String }],
    correctionStrategy: { type: String, required: true },
    feedbackTemplate: { type: String, required: true }, // with {step} placeholder
    prevalenceGrades: [{ type: Number }], // grades where this is common
    detectionTriggers: [{ type: String }], // action patterns that suggest this misconception
    severity: { type: String, enum: ["low", "medium", "high"], default: "medium" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Misconception", misconceptionSchema);
