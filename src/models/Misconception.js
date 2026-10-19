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
    detectionTriggers: [{ type: String }], // legacy free-text hint at action patterns (unused by code)

    // What this misconception looks like AS BEHAVIOUR on the virtual bench — the structured,
    // machine-evaluated successor to detectionTriggers above. Consumed only by
    // services/studentModelService.js (the Bayesian misconception model — see
    // dev-docs/implementation-plan-student-model.md). Empty ⇒ this code is never inferred
    // behaviourally and the diagnosis falls back to the legacy conceptViolated-tag path in
    // aiService.analyzeSession. Authored at design time from published diagnostic-test literature
    // (see behaviouralSignatures[].source); NOT derived from student data.
    behaviouralSignatures: [
      {
        // expectedIntent values (microStepSchema) this signature is evaluated under; [] = any task.
        whenIntent: [{ type: String }],
        // Named predicate in studentModelService.PREDICATES, evaluated against
        // { action, recentActions, benchState, task, stepProgress }. The declarative "what does the
        // wrong action look like" — the actual matching logic lives in tested code.
        predicate: { type: String, required: true },
        // commission = did a characteristic wrong thing; omission = skipped a characteristic right
        // thing; sequence = right things in the wrong order.
        evidenceType: { type: String, enum: ["commission", "omission", "sequence"], default: "commission" },
        // How strongly one match shifts the running log-odds toward "held". Positive; ~0.8–1.6 to
        // start. The n-th match of the SAME signature is damped (LLR / n) in the service so one
        // mistake repeated many times can't peg the posterior. Tuned via EM once data exists.
        logLikelihoodRatio: { type: Number, default: 1.0 },
        source: { type: String, default: "" }, // citation / rationale, for the authoring audit
      },
    ],
    // Starting log-odds for this misconception before any evidence (P = sigmoid(x); x = 0 ⇒ 0.5).
    // Usually negative — most students don't hold any given bug. null ⇒ studentModelService uses
    // its default (DEFAULT_PRIOR_LOG_ODDS).
    behaviouralPriorLogOdds: { type: Number, default: null },

    severity: { type: String, enum: ["low", "medium", "high"], default: "medium" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Misconception", misconceptionSchema);
