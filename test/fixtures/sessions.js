// Canned Session / Experiment / Action data for regression + student-model tests. Shapes match
// what session.controller.js persists and getSessionReport reads (lean docs, ObjectIds as strings).
// Not loaded from the DB — deterministic and offline.

// A migrated 2-step practical (each step has micro-steps), acid–base flavoured.
const acidBaseExperiment = {
  _id: "exp_acidbase",
  title: "Acid-Base Neutralization",
  subject: "Chemistry",
  grades: [10],
  estimatedTime: 20,
  commonMisconceptions: ["CHEM_001", "CHEM_002", "CHEM_003"],
  steps: [
    {
      stepId: 1,
      title: "Prepare a Measured Amount of the Acid",
      instruction: "Accurately measure out the acid.",
      actionType: "measure",
      misconceptionRisks: [],
      microSteps: [
        { microStepId: 1, studentPrompt: "Choose the tool that measures volume accurately.", expectedIntent: "SELECT_EQUIPMENT" },
        { microStepId: 2, studentPrompt: "Measure out the acid.", expectedIntent: "MEASURE_RESULT" },
      ],
    },
    {
      stepId: 2,
      title: "Add a Way to Detect the Endpoint",
      instruction: "Introduce something that signals the endpoint.",
      actionType: "add",
      misconceptionRisks: ["CHEM_002"],
      microSteps: [
        { microStepId: 1, studentPrompt: "Choose the equipment for adding a few drops.", expectedIntent: "SELECT_TRANSFER_EQUIPMENT" },
        { microStepId: 2, studentPrompt: "Add the substance that signals the endpoint.", expectedIntent: "ADD_REAGENT" },
      ],
    },
  ],
};

// A clean run: every task first-try, no hints, no help, sensible timing.
const cleanSession = {
  _id: "sess_clean",
  experimentId: "exp_acidbase",
  status: "completed",
  score: 100,
  performanceScore: 100,
  timeScore: 100,
  totalHintPenalty: 0,
  totalHelpPenalty: 0,
  totalTime: 300,
  totalActiveTime: 240,
  behaviorFeatures: { struggledSteps: [] },
  aiFeedback: { misconceptionsDetected: [] },
  stepProgress: [
    {
      stepId: 1,
      timeSpentSeconds: 110,
      stepScore: 100,
      hintPenalty: 0,
      helpPenalty: 0,
      timeScore: 100,
      microSteps: [
        { microStepId: 1, timeSpentSeconds: 40, taskScore: 100, hintsRequested: 0, highestHintLevel: 0, helpUsed: false, equipmentMistakes: 0, chemicalMistakes: 0, hintPenalty: 0, helpPenalty: 0, timeScore: 100, expectedTimeSeconds: 50 },
        { microStepId: 2, timeSpentSeconds: 70, taskScore: 100, hintsRequested: 0, highestHintLevel: 0, helpUsed: false, equipmentMistakes: 0, chemicalMistakes: 0, hintPenalty: 0, helpPenalty: 0, timeScore: 100, expectedTimeSeconds: 50 },
      ],
    },
    {
      stepId: 2,
      timeSpentSeconds: 95,
      stepScore: 100,
      hintPenalty: 0,
      helpPenalty: 0,
      timeScore: 100,
      microSteps: [
        { microStepId: 1, timeSpentSeconds: 30, taskScore: 100, hintsRequested: 0, highestHintLevel: 0, helpUsed: false, equipmentMistakes: 0, chemicalMistakes: 0, hintPenalty: 0, helpPenalty: 0, timeScore: 100, expectedTimeSeconds: 50 },
        { microStepId: 2, timeSpentSeconds: 65, taskScore: 100, hintsRequested: 0, highestHintLevel: 0, helpUsed: false, equipmentMistakes: 0, chemicalMistakes: 0, hintPenalty: 0, helpPenalty: 0, timeScore: 100, expectedTimeSeconds: 50 },
      ],
    },
  ],
};
const cleanActions = [
  { stepId: 1, microStepId: 1, actionType: "correct", timeTaken: 40, hintLevel: null, conceptViolated: null },
  { stepId: 1, microStepId: 2, actionType: "correct", timeTaken: 70, hintLevel: null, conceptViolated: null },
  { stepId: 2, microStepId: 1, actionType: "correct", timeTaken: 30, hintLevel: null, conceptViolated: null },
  { stepId: 2, microStepId: 2, actionType: "correct", timeTaken: 65, hintLevel: null, conceptViolated: null },
];

// A struggled run on step 2: two wrong attempts, climbed the hint ladder, used Help, slow, and a
// CHEM_002 misconception was recorded against step 2.
const struggledSession = {
  _id: "sess_struggled",
  experimentId: "exp_acidbase",
  status: "completed",
  score: 74,
  performanceScore: 76,
  timeScore: 88,
  totalHintPenalty: 6,
  totalHelpPenalty: 5,
  totalTime: 640,
  totalActiveTime: 520,
  behaviorFeatures: { struggledSteps: [2] },
  aiFeedback: {
    misconceptionsDetected: [
      { code: "CHEM_002", description: "Believes indicators change colour with temperature, not pH.", relatedStep: 2, correctionStrategy: "Indicators respond to pH, not temperature." },
    ],
  },
  stepProgress: [
    {
      stepId: 1,
      timeSpentSeconds: 105,
      stepScore: 100,
      hintPenalty: 0,
      helpPenalty: 0,
      timeScore: 100,
      microSteps: [
        { microStepId: 1, timeSpentSeconds: 45, taskScore: 100, hintsRequested: 0, highestHintLevel: 0, helpUsed: false, equipmentMistakes: 0, chemicalMistakes: 0, hintPenalty: 0, helpPenalty: 0, timeScore: 100, expectedTimeSeconds: 50 },
        { microStepId: 2, timeSpentSeconds: 60, taskScore: 100, hintsRequested: 0, highestHintLevel: 0, helpUsed: false, equipmentMistakes: 0, chemicalMistakes: 0, hintPenalty: 0, helpPenalty: 0, timeScore: 100, expectedTimeSeconds: 50 },
      ],
    },
    {
      stepId: 2,
      timeSpentSeconds: 300,
      stepScore: 89,
      hintPenalty: 6,
      helpPenalty: 5,
      timeScore: 80,
      microSteps: [
        { microStepId: 1, timeSpentSeconds: 40, taskScore: 100, hintsRequested: 0, highestHintLevel: 0, helpUsed: false, equipmentMistakes: 0, chemicalMistakes: 0, hintPenalty: 0, helpPenalty: 0, timeScore: 100, expectedTimeSeconds: 50 },
        { microStepId: 2, timeSpentSeconds: 260, taskScore: 89, hintsRequested: 3, highestHintLevel: 3, helpUsed: true, equipmentMistakes: 1, chemicalMistakes: 1, hintPenalty: 6, helpPenalty: 5, timeScore: 80, expectedTimeSeconds: 50 },
      ],
    },
  ],
};
const struggledActions = [
  { stepId: 1, microStepId: 1, actionType: "correct", timeTaken: 45, hintLevel: null, conceptViolated: null },
  { stepId: 1, microStepId: 2, actionType: "correct", timeTaken: 60, hintLevel: null, conceptViolated: null },
  { stepId: 2, microStepId: 1, actionType: "correct", timeTaken: 40, hintLevel: null, conceptViolated: null },
  { stepId: 2, microStepId: 2, actionType: "incorrect", timeTaken: 30, hintLevel: null, conceptViolated: "LAB_MISSING_EQUIPMENT" },
  { stepId: 2, microStepId: 2, actionType: "hint_requested", timeTaken: 0, hintLevel: 1, conceptViolated: null },
  { stepId: 2, microStepId: 2, actionType: "incorrect", timeTaken: 25, hintLevel: null, conceptViolated: "LAB_MISSING_CHEMICAL" },
  { stepId: 2, microStepId: 2, actionType: "hint_requested", timeTaken: 0, hintLevel: 2, conceptViolated: null },
  { stepId: 2, microStepId: 2, actionType: "hint_requested", timeTaken: 0, hintLevel: 3, conceptViolated: null },
  { stepId: 2, microStepId: 2, actionType: "help_used", timeTaken: 0, hintLevel: null, conceptViolated: null },
  { stepId: 2, microStepId: 2, actionType: "correct", timeTaken: 205, hintLevel: null, conceptViolated: null },
];

module.exports = {
  acidBaseExperiment,
  cleanSession,
  cleanActions,
  struggledSession,
  struggledActions,
};
