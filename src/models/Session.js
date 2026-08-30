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
    // Final score = round(performanceScore * 0.90 + timeScore * 0.10), or performanceScore alone
    // when there's no timing data. Computed ONCE at completion (see labScoringService).
    score: { type: Number, default: 0, min: 0, max: 100 },
    // Score components, persisted so the report can explain the final number without recomputing.
    performanceScore: { type: Number, default: 0, min: 0, max: 100 }, // avg of stepProgress[].stepScore
    timeScore: { type: Number, default: null, min: 0, max: 100 }, // null → time was neutral (no expected durations)
    totalHintPenalty: { type: Number, default: 0 }, // sum of per-task hint penalties (cumulative)
    totalHelpPenalty: { type: Number, default: 0 }, // sum of per-task help penalties (-5 each)
    totalTime: { type: Number, default: 0 }, // seconds — wall-clock session duration (reporting only)
    // Sum of every completed Current Task's timeSpentSeconds — the "active" time used for scoring,
    // distinct from totalTime (which includes idle / app-backgrounded time).
    totalActiveTime: { type: Number, default: 0 },
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
      // Phase 3 — LLM turns the deterministic performance analytics into student-facing prose.
      // The model never computes scores/rankings/durations (see feedbackService).
      strengths: [{ type: String }], // specific things done well
      struggleAnalysis: [{ type: String }], // one per most-struggled step: what was hard + why
      recommendations: [{ type: String }], // actionable next steps before a retry
      suggestions: [{ type: String }], // legacy rule-based tips, kept for back-compat
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
        // highestHintLevel has already reached 3, see session.controller.js. Adds a -5 penalty
        // ON TOP of the cumulative hint penalty (see labScoringService).
        helpUsed: { type: Boolean, default: false },
        solvedIndependently: { type: Boolean, default: true }, // flipped false on the first mistake or hint
        startedAt: { type: Date, default: null },
        completedAt: { type: Date, default: null },
        timeSpentSeconds: { type: Number, default: 0 },
        // Performance score for this step: for a migrated step, the average of its tasks'
        // taskScore; for an unmigrated step, 100 minus this step's own cumulative guidance
        // penalties (see labScoringService.calculateTaskPerformanceScore). Averaged across steps
        // into Session.performanceScore at completion.
        stepScore: { type: Number, default: 100 },
        // Score-breakdown: cumulative guidance penalties (sum of the step's tasks, or the step's
        // own for an unmigrated step) + the gentle time score (null → time was neutral here).
        hintPenalty: { type: Number, default: 0 },
        helpPenalty: { type: Number, default: 0 },
        timeScore: { type: Number, default: null },
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
            // Performance score for this Current Task: 100 minus its cumulative guidance penalties
            // (see labScoringService.calculateTaskPerformanceScore).
            taskScore: { type: Number, default: 100 },
            // Score-breakdown so the report can show "-1 hint 1, -2 hint 2, -5 Help = 89".
            hintPenalty: { type: Number, default: 0 },
            helpPenalty: { type: Number, default: 0 },
            // Gentle time score for this task (0-100), or null when there was no expected duration
            // to compare against (→ time neutral, not penalised).
            timeScore: { type: Number, default: null },
            // The expected duration this task's timeScore was computed against, in seconds (for
            // the report's "you took 2m 51s, expected ~1m 00s" line). null when time was neutral.
            expectedTimeSeconds: { type: Number, default: null },
          },
        ],
      },
    ],

    // ── Bayesian misconception student model (dev-docs/implementation-plan-student-model.md) ──
    // Snapshot of the posterior over curriculum-specific misconceptions, recomputed by
    // services/studentModelService.js from the bench action log and cached here for the report and
    // for research export. Always recomputable — never the sole source of truth. Populated only
    // when STUDENT_MODEL_ENABLED; empty/absent otherwise (the legacy rule path in
    // aiService.analyzeSession is unchanged).
    studentModel: {
      cluster: { type: String, default: null }, // e.g. "acid_base"
      misconceptions: [
        {
          code: { type: String },
          priorLogOdds: { type: Number, default: 0 },
          logOdds: { type: Number, default: 0 },
          probability: { type: Number, default: 0.5 }, // sigmoid(logOdds), denormalised
          evidence: [
            {
              actionIndex: { type: Number },
              stepId: { type: Number, default: null },
              microStepId: { type: Number, default: null },
              predicate: { type: String },
              deltaLogOdds: { type: Number },
              at: { type: Date, default: null },
            },
          ],
        },
      ],
      subGoal: {
        nominalMicroStepId: { type: Number, default: null },
        onTaskProbability: { type: Number, default: 1 },
        divergenceFlag: { type: Boolean, default: false }, // M4
      },
      // Shadow-mode comparison: the codes aiService.analyzeSession's rules concluded, stored
      // alongside the model's posterior so the analysis scripts can compare without re-running.
      shadowRuleMisconceptions: [{ type: String }],
      computedFromActionCount: { type: Number, default: 0 },
      updatedAt: { type: Date, default: null },
    },

    // RCT arm — assigned once at startSession, stable per user (see config/featureFlags.js).
    // "off" ⇒ the feature is disabled and the STUDENT_MODEL_DRIVES_* flags ignore this session.
    experimentArm: { type: String, enum: ["treatment", "control", "off"], default: "off" },
  },
  { timestamps: true }
);

sessionSchema.index({ userId: 1, experimentId: 1, status: 1 });

module.exports = mongoose.model("Session", sessionSchema);
