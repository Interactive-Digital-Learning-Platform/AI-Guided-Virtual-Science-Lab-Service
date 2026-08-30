// services/studentModelRunner.js — the impure orchestrator. Model .find/.findById calls are mocked
// (no DB); the assertion is that it assembles inputs and hands them to the pure service correctly.
const test = require("node:test");
const assert = require("node:assert/strict");

const LabRun = require("../../src/models/LabRun");
const Misconception = require("../../src/models/Misconception");
const Chemical = require("../../src/models/Chemical");
const runner = require("../../src/services/studentModelRunner");
const misconceptions = require("../../src/data/misconceptions");

// Fake a mongoose query: .select(...).lean() -> resolves to `value`.
const fakeQuery = (value) => ({ select() { return this; }, lean: async () => value });

const CHEM_002 = misconceptions.find((m) => m.code === "CHEM_002");

const baseSession = {
  _id: "s1",
  labRunId: "lr1",
  currentStep: 1,
  currentMicroStep: 1,
  stepProgress: [
    {
      stepId: 1,
      startedAt: new Date("2026-08-30T10:00:00Z"),
      completedAt: new Date("2026-08-30T10:05:00Z"),
      microSteps: [
        { microStepId: 1, startedAt: new Date("2026-08-30T10:00:00Z"), completedAt: new Date("2026-08-30T10:05:00Z") },
      ],
    },
  ],
};
const baseExperiment = {
  _id: "e1",
  subject: "Chemistry",
  commonMisconceptions: ["CHEM_002"],
  requiredChemicals: [],
  steps: [{ stepId: 1, misconceptionRisks: ["CHEM_002"], microSteps: [{ microStepId: 1, expectedIntent: "ADD_REAGENT" }] }],
};

test("computeForSession — returns null when the feature is disabled", async (t) => {
  delete process.env.STUDENT_MODEL_ENABLED;
  runner.__resetCacheForTests();
  const out = await runner.computeForSession({ session: baseSession, experiment: baseExperiment });
  assert.equal(out, null);
});

test("computeForSession — assembles inputs and returns a posterior in shadow mode", async (t) => {
  process.env.STUDENT_MODEL_ENABLED = "true";
  runner.__resetCacheForTests();
  t.after(() => {
    delete process.env.STUDENT_MODEL_ENABLED;
    runner.__resetCacheForTests();
  });

  t.mock.method(LabRun, "findById", () =>
    fakeQuery({
      actions: [
        { actionType: "heat", equipment: "beaker", chemicalIds: [], timestamp: new Date("2026-08-30T10:01:00Z") },
        { actionType: "heat", equipment: "beaker", chemicalIds: [], timestamp: new Date("2026-08-30T10:02:00Z") },
      ],
    })
  );
  t.mock.method(Misconception, "find", () =>
    fakeQuery([
      {
        code: "CHEM_002",
        description: CHEM_002.description,
        correctionStrategy: CHEM_002.correctionStrategy,
        behaviouralSignatures: CHEM_002.behaviouralSignatures,
        behaviouralPriorLogOdds: CHEM_002.behaviouralPriorLogOdds,
      },
    ])
  );
  t.mock.method(Chemical, "find", () => fakeQuery([]));

  const model = await runner.computeForSession({ session: baseSession, experiment: baseExperiment });
  assert.ok(model, "a model was produced");
  assert.equal(model.cluster, "acid_base");
  assert.equal(model.computedFromActionCount, 2);
  const chem002 = model.misconceptions.find((m) => m.code === "CHEM_002");
  assert.ok(chem002.probability >= 0.6, `CHEM_002 elevated, got ${chem002.probability}`);
  assert.ok(chem002.evidence.length >= 1);

  const dx = await runner.diagnoseFromSnapshot(model);
  assert.equal(dx[0].code, "CHEM_002");
  assert.match(dx[0].description, /temperature/i);
});

test("computeForSession — returns null when the session has no lab run", async (t) => {
  process.env.STUDENT_MODEL_ENABLED = "true";
  runner.__resetCacheForTests();
  t.after(() => {
    delete process.env.STUDENT_MODEL_ENABLED;
    runner.__resetCacheForTests();
  });
  const out = await runner.computeForSession({ session: { ...baseSession, labRunId: null }, experiment: baseExperiment });
  assert.equal(out, null);
});
