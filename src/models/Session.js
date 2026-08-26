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
    // Which Current Task (microStep) within currentStep the student is on right now — 1-based,
    // resets to 1 whenever currentStep advances. Authoritative the same way currentStep is: the
    // client submits an action against a stepId/microStepId, but only a match against these two
    // fields is ever graded as "the current task" (see logAction in session.controller.js). For
    // a step with no microSteps defined (unmigrated practicals), this stays irrelevant/unused.
    currentMicroStep: { type: Number, default: 1 },
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
      conceptsToImprove: [{ type: String }],
      finalUnderstandingAssessment: { type: String, default: null },
      nextRecommendedExperiment: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Experiment",
        default: null,
      },
      feedbackGeneratedAt: { type: Date, default: null },
    },

    attemptNumber: { type: Number, default: 1 },

    // Live drag-and-drop bench backing the "procedure" phase — see labRun.controller.js. Created
    // lazily (scoped to this session) when the student first enters the workspace.
    labRunId: { type: mongoose.Schema.Types.ObjectId, ref: "LabRun", default: null },

    // Chemistry practical flow: equipment/chemical selection happen before `steps` begin.
    phase: {
      type: String,
      enum: ["equipment_selection", "chemical_selection", "procedure", "completed"],
      default: "equipment_selection",
    },
    equipmentSelection: {
      selected: [{ type: String }],
      correct: [{ type: String }],
      missing: [{ type: String }],
      unnecessary: [{ type: String }],
      attempts: { type: Number, default: 0 },
    },
    chemicalSelection: {
      selected: [{ type: mongoose.Schema.Types.ObjectId, ref: "Chemical" }],
      correct: [{ type: mongoose.Schema.Types.ObjectId, ref: "Chemical" }],
      missing: [{ type: mongoose.Schema.Types.ObjectId, ref: "Chemical" }],
      unnecessary: [{ type: mongoose.Schema.Types.ObjectId, ref: "Chemical" }],
      attempts: { type: Number, default: 0 },
    },
    // Tracks successful equation-balancing builds for required compounds flagged
    // isBuildableFromElements — see compound-builds endpoint in session.controller.js.
    builtCompounds: [
      {
        chemical: { type: mongoose.Schema.Types.ObjectId, ref: "Chemical" },
        attempts: { type: Number, default: 0 },
        completedAt: { type: Date, default: null },
        // Misconception code guessed from the most recent wrong attempt's coefficient pattern
        // (see submitCompoundBuild) — surfaced in the session report by aiService.js if the
        // student struggled (2+ attempts) on this compound.
        lastMisconceptionCode: { type: String, default: null },
      },
    ],

    // Per-step behavioral record for the procedure phase — one entry per stepId, created lazily
    // the first time the student attempts that step (see evaluateOnBench / logAction in
    // session.controller.js). Distinct from behaviorFeatures above (a session-wide aggregate):
    // this is what lets completeSession score "solved it first try" higher than "needed 3 hints",
    // and what the research/analytics side needs to see mistakes at the individual-step level.
    stepProgress: [
      {
        stepId: { type: Number, required: true },
        equipmentMistakes: { type: Number, default: 0 },
        chemicalMistakes: { type: Number, default: 0 },
        hintsRequested: { type: Number, default: 0 },
        highestHintLevel: { type: Number, default: 0 },
        // Whether the Help reveal (requestHelp) was used on this step — only reachable once
        // highestHintLevel has already reached 3, see session.controller.js. Drives the -25%
        // score deduction in computeStepScore, taking priority over the hint-level deductions.
        helpUsed: { type: Boolean, default: false },
        solvedIndependently: { type: Boolean, default: true }, // flipped false on the first mistake or hint
        startedAt: { type: Date, default: null },
        completedAt: { type: Date, default: null },
        timeSpentSeconds: { type: Number, default: 0 },
        // 100 minus mistake/hint deductions, floored at 0 — see computeStepScore in
        // session.controller.js. Averaged across steps into Session.score at completion.
        stepScore: { type: Number, default: 100 },
        // Per-Current-Task behavioral record, one entry per microStepId under this step — created
        // lazily on first touch (getOrCreateMicroStepProgress), same pattern as stepProgress
        // itself. This is the analytics home for microStepAttempts/microStepErrors/hintsRequested/
        // hintLevelReached/timePerMicroStep/retriesPerMicroStep (research metrics, see
        // getSessionReport's microStepBreakdown). Empty for steps with no microSteps defined.
        microSteps: [
          {
            microStepId: { type: Number, required: true },
            equipmentMistakes: { type: Number, default: 0 },
            chemicalMistakes: { type: Number, default: 0 },
            hintsRequested: { type: Number, default: 0 },
            highestHintLevel: { type: Number, default: 0 },
            helpUsed: { type: Boolean, default: false },
            solvedIndependently: { type: Boolean, default: true },
            startedAt: { type: Date, default: null },
            completedAt: { type: Date, default: null },
            timeSpentSeconds: { type: Number, default: 0 },
            taskScore: { type: Number, default: 100 },
          },
        ],
      },
    ],
  },
  { timestamps: true }
);

sessionSchema.index({ userId: 1, experimentId: 1, status: 1 });

module.exports = mongoose.model("Session", sessionSchema);
