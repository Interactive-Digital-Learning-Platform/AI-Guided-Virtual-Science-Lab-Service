const mongoose = require("mongoose");

const actionSchema = new mongoose.Schema(
  {
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: "Session", required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    experimentId: { type: mongoose.Schema.Types.ObjectId, ref: "Experiment", required: true },
    stepId: { type: Number, required: true },
    // Which Current Task (microStep) within stepId this action targeted — null for steps with no
    // microSteps defined (unmigrated practicals) or for session-level actions that aren't
    // step-scoped. See Session.currentMicroStep / logAction in session.controller.js.
    microStepId: { type: Number, default: null },
    actionType: {
      type: String,
      enum: ["correct", "incorrect", "skipped", "repeated", "hint_requested", "help_used", "step_started", "step_completed"],
      required: true,
    },
    actionDetail: { type: String, default: "" }, // what the student did
    expectedAction: { type: String, default: "" }, // what was expected
    timeTaken: { type: Number, default: 0 }, // seconds since step started
    attemptNumber: { type: Number, default: 1 },
    hintLevel: { type: Number, default: null }, // 1, 2, or 3 if hint requested
    conceptViolated: { type: String, default: null }, // misconception code if incorrect
    timestamp: { type: Date, default: Date.now },

    // Structured event fields for the "Perform Experiment" phase (drag/pour/measure/mix/heat/observe).
    // Optional — unused by the existing Physics/Biology step-grading flow.
    equipmentType: { type: String, default: null }, // e.g. "beaker"
    chemicalIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Chemical" }],
    quantity: { type: Number, default: null },
    unit: { type: String, default: null },
  },
  { timestamps: false }
);

actionSchema.index({ sessionId: 1, stepId: 1, microStepId: 1 });

module.exports = mongoose.model("Action", actionSchema);
