const mongoose = require("mongoose");

const conceptSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    subject: { type: String, enum: ["Physics", "Chemistry", "Biology"], required: true },
    grades: [{ type: Number, min: 6, max: 11 }],
    description: { type: String, required: true },
    simpleExplanation: { type: String, required: true }, // student-friendly version
    relatedMisconceptions: [{ type: String }], // misconception codes
    prerequisiteConcepts: [{ type: mongoose.Schema.Types.ObjectId, ref: "Concept" }],
    visualizationAvailable: { type: Boolean, default: false },
    visualizationType: {
      type: String,
      enum: ["photosynthesis", "water_cycle", "acid_base", "density", "ohms_law", "osmosis", null],
      default: null,
    },
    keywords: [{ type: String }],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Concept", conceptSchema);
