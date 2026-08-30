// M5 — the model-driven pieces: generateMisconceptionHint fallback, the analyzeSession diagnosis
// swap, and studentModelRunner.computeLive. Groq is not configured in tests, so all LLM calls take
// their deterministic fallback path.
const test = require("node:test");
const assert = require("node:assert/strict");

const { generateMisconceptionHint } = require("../../src/services/labHintService");
const { analyzeSession } = require("../../src/services/aiService");
const Misconception = require("../../src/models/Misconception");
const Chemical = require("../../src/models/Chemical");
const runner = require("../../src/services/studentModelRunner");
const misconceptions = require("../../src/data/misconceptions");

// ── generateMisconceptionHint — fallback is one sentence of the correction strategy ──────────
test("generateMisconceptionHint — fallback rephrases the correction strategy", async () => {
  const hint = await generateMisconceptionHint({
    experimentTitle: "Acid-Base Neutralization",
    studentPrompt: "Add a way to detect the endpoint",
    misconceptionDescription: "Believes indicators change colour with temperature.",
    correctionStrategy: "Indicators respond to pH, not temperature. Phenolphthalein turns pink when pH > 8.2.",
    level: 1,
  });
  assert.match(hint, /pH/);
  assert.ok(!/phenolphthalein/i.test(hint), "level 1 fallback stops at the first sentence (no reagent name)");
  assert.ok(hint.length < 160);
});

// ── analyzeSession — diagnosis swap ─────────────────────────────────────────────────────────
const cleanExperiment = {
  _id: "e1",
  title: "Acid-Base Neutralization",
  subject: "Chemistry",
  grades: [10],
  estimatedTime: 20,
  steps: [{ stepId: 1, title: "Step 1", microSteps: [] }],
};
const makeSession = (over = {}) => ({
  _id: "s1",
  score: 88,
  experimentId: cleanExperiment,
  builtCompounds: [],
  stepProgress: [{ stepId: 1, stepScore: 100, microSteps: [], timeSpentSeconds: 60, completedAt: new Date() }],
  behaviorFeatures: {
    errorRate: 0.1,
    totalHintsRequested: 0,
    totalRetries: 0,
    fastSteps: 0,
    struggledSteps: [],
    totalActions: 10,
    totalErrors: 1,
  },
  totalActiveTime: 60,
  totalTime: 90,
  ...over,
});

test("analyzeSession — no modelDiagnosis → rule-based list, _ruleMisconceptions mirrors it", async () => {
  const out = await analyzeSession(makeSession(), []);
  assert.deepEqual(out.misconceptionsDetected, []);
  assert.deepEqual(out._ruleMisconceptions, []);
});

test("analyzeSession — modelDiagnosis replaces the misconception list and drives conceptsToImprove", async () => {
  const modelDiagnosis = [
    {
      code: "CHEM_002",
      description: "Believes indicators respond to temperature, not pH.",
      correctionStrategy: "Indicators respond to pH, not temperature.",
      relatedConcepts: ["pH Scale", "Indicators"],
      relatedStep: 1,
    },
  ];
  const out = await analyzeSession(makeSession(), [], { modelDiagnosis });
  assert.equal(out.misconceptionsDetected.length, 1);
  assert.equal(out.misconceptionsDetected[0].code, "CHEM_002");
  assert.deepEqual(out.conceptsToImprove.sort(), ["Indicators", "pH Scale"]);
  assert.deepEqual(out._ruleMisconceptions, [], "rules found nothing here — captured for the shadow comparison");
});

test("analyzeSession — model wins even when a rule would have fired; the rule code is still recorded", async () => {
  // errorRate 0.6 triggers Rule 1 -> PROC_001. modelDiagnosis should override the returned list,
  // but _ruleMisconceptions must still carry PROC_001 for the research comparison.
  const session = makeSession({ behaviorFeatures: { ...makeSession().behaviorFeatures, errorRate: 0.6 } });
  const out = await analyzeSession(session, [], {
    modelDiagnosis: [{ code: "CHEM_003", description: "d", correctionStrategy: "c", relatedConcepts: [], relatedStep: 1 }],
  });
  assert.deepEqual(out.misconceptionsDetected.map((m) => m.code), ["CHEM_003"]);
  assert.ok(out._ruleMisconceptions.includes("PROC_001"));
});

// ── studentModelRunner.computeLive — no LabRun query, benchActions supplied ───────────────────
test("computeLive — builds a posterior from a supplied action list", async (t) => {
  process.env.STUDENT_MODEL_ENABLED = "true";
  runner.__resetCacheForTests();
  t.after(() => {
    delete process.env.STUDENT_MODEL_ENABLED;
    runner.__resetCacheForTests();
  });

  const CHEM_002 = misconceptions.find((m) => m.code === "CHEM_002");
  const fakeQuery = (v) => ({ select() { return this; }, lean: async () => v });
  t.mock.method(Misconception, "find", () =>
    fakeQuery([
      {
        code: "CHEM_002",
        title: CHEM_002.title,
        description: CHEM_002.description,
        correctionStrategy: CHEM_002.correctionStrategy,
        relatedConcepts: CHEM_002.relatedConcepts,
        behaviouralSignatures: CHEM_002.behaviouralSignatures,
        behaviouralPriorLogOdds: CHEM_002.behaviouralPriorLogOdds,
      },
    ])
  );
  t.mock.method(Chemical, "find", () => fakeQuery([]));

  const model = await runner.computeLive({
    session: { currentStep: 1, currentMicroStep: 1, stepProgress: [] },
    experiment: {
      subject: "Chemistry",
      commonMisconceptions: ["CHEM_002"],
      steps: [{ stepId: 1, misconceptionRisks: ["CHEM_002"], microSteps: [{ microStepId: 1, expectedIntent: "ADD_REAGENT" }] }],
    },
    benchActions: [
      { actionType: "heat", equipment: "beaker", chemicalIds: [] },
      { actionType: "heat", equipment: "beaker", chemicalIds: [] },
    ],
  });
  assert.ok(model);
  assert.ok(model.misconceptions.find((m) => m.code === "CHEM_002").probability >= 0.6);

  // and diagnose from that snapshot carries the KB text
  const dx = await runner.diagnoseFromSnapshot(model);
  assert.equal(dx[0].code, "CHEM_002");
  assert.deepEqual(dx[0].relatedConcepts, CHEM_002.relatedConcepts);
});
