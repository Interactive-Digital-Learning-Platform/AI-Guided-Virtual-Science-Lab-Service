const mongoose = require("mongoose");

const sessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    experimentId: { type: mongoose.Schema.Types.ObjectId, ref: "Experiment", required: true },
    startTime: { type: Date, default: Date.now },
    endTime: { type: Date, default: null },
    status: {
      type: String,
      enum: ["in_progress", "completed", "abandoned"],
      default: "in_progress",
    },
    currentStep: { type: Number, default: 1 },
    score: { type: Number, default: 0, min: 0, max: 100 },
    totalTime: { type: Number, default: 0 }, // seconds
    actions: [{ type: mongoose.Schema.Types.ObjectId, ref: "Action" }],

    // AI Analysis Results
    behaviorFeatures: {
      totalActions: { type: Number, default: 0 },
      totalErrors: { type: Number, default: 0 },
      totalHintsRequested: { type: Number, default: 0 },
      totalRetries: { type: Number, default: 0 },
      totalSkips: { type: Number, default: 0 },
      errorRate: { type: Number, default: 0 },
      averageStepTime: { type: Number, default: 0 },
      fastSteps: { type: Number, default: 0 }, // steps completed in < 10s
      struggledSteps: [{ type: Number }], // step IDs with 2+ retries
    },

    // AI Feedback
    aiFeedback: {
      summary: { type: String, default: null },
      misconceptionsDetected: [
        {
          code: { type: String },
          description: { type: String },
          relatedStep: { type: Number },
          correctionStrategy: { type: String },
        },
      ],
      strengths: [{ type: String }],
      suggestions: [{ type: String }],
      nextRecommendedExperiment: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Experiment",
        default: null,
      },
      feedbackGeneratedAt: { type: Date, default: null },
    },

    attemptNumber: { type: Number, default: 1 },
  },
  { timestamps: true }
);

sessionSchema.index({ userId: 1, experimentId: 1, status: 1 });

module.exports = mongoose.model("Session", sessionSchema);
