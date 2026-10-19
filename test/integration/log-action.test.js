// Integration test for session.controller.logAction — mongoose model statics are mocked, no DB.
// Covers the M5 student-model wiring across all four flag states: flags-off, shadow (enabled but
// not driving), and treatment + STUDENT_MODEL_DRIVES_HINTS. The plain "chemical mismatch → 500"
// regression is guarded separately in test/regression/logaction-evalresult-scope.test.js.
const test = require("node:test");
const assert = require("node:assert/strict");

const Session = require("../../src/models/Session");
const Action = require("../../src/models/Action");
const LabRun = require("../../src/models/LabRun");
const Chemical = require("../../src/models/Chemical");
const Misconception = require("../../src/models/Misconception");
const runner = require("../../src/services/studentModelRunner");
const misconceptions = require("../../src/data/misconceptions");
const { logAction } = require("../../src/controllers/session.controller");

const HCL = "hcl000000000000000000000";
const fakeQuery = (v) => ({ select() { return this; }, lean: async () => v });

// A migrated step whose current task expects a beaker + HCl.
const experiment = {
  _id: "exp1",
  title: "Acid-Base Neutralization",
  subject: "Chemistry",
  reactionId: null,
  commonMisconceptions: ["CHEM_002"],
  requiredChemicals: [{ chemical: HCL }],
  steps: [
    {
      stepId: 1,
      title: "Add the acid",
      instruction: "Add the acid to the beaker.",
      actionType: "add",
      requiredEquipment: ["beaker"],
      requiredChemicalsForStep: [HCL],
      misconceptionRisks: ["CHEM_002"],
      microSteps: [
        {
          microStepId: 1,
          studentPrompt: "Add the acid.",
          expectedIntent: "ADD_REAGENT",
          expectedEquipment: ["beaker"],
          expectedChemicalsForStep: [HCL],
        },
      ],
    },
  ],
};

function makeSession(over = {}) {
  const s = {
    _id: "sess1",
    status: "in_progress",
    experimentId: experiment,
    labRunId: "lr1",
    currentStep: 1,
    currentMicroStep: 1,
    experimentArm: "off",
    actions: [],
    // Pre-seeded to the shape Mongoose's sub-schema defaults would give (plain fixtures don't get
    // those defaults). One open micro-step progress entry for the current task.
    stepProgress: [
      {
        stepId: 1,
        startedAt: new Date("2026-08-30T10:00:00Z"),
        timeSpentSeconds: 0,
        stepScore: 100,
        hintPenalty: 0,
        helpPenalty: 0,
        microSteps: [
          {
            microStepId: 1,
            startedAt: new Date("2026-08-30T10:00:00Z"),
            completedAt: null,
            equipmentMistakes: 0,
            chemicalMistakes: 0,
            hintsRequested: 0,
            highestHintLevel: 0,
            helpUsed: false,
            solvedIndependently: true,
            timeSpentSeconds: 0,
            taskScore: 100,
            hintPenalty: 0,
            helpPenalty: 0,
          },
        ],
      },
    ],
    behaviorFeatures: { totalActions: 0, totalErrors: 0, totalHintsRequested: 0, totalRetries: 0, totalSkips: 0, fastSteps: 0, struggledSteps: [] },
    save: async () => {},
    ...over,
  };
  return s;
}

// bench: a beaker is on the bench, but HCl has NOT been added → equipmentOk true, chemicalsOk false.
const benchNoChem = { equipment: [{ equipmentType: "beaker", contents: [] }], physicsEquipment: [], circuitBoardState: null, reactionsTriggered: [], actions: [], materials: [] };
// bench with two heat actions logged during the add-reagent task (CHEM_002 signature).
const benchHeated = {
  ...benchNoChem,
  actions: [
    { actionType: "heat", equipment: "beaker", chemicalIds: [], timestamp: new Date("2026-08-30T10:01:00Z") },
    { actionType: "heat", equipment: "beaker", chemicalIds: [], timestamp: new Date("2026-08-30T10:02:00Z") },
  ],
};

function wire(t, { session, labRun }) {
  t.mock.method(Session, "findById", () => ({ populate: async () => session }));
  t.mock.method(Action, "countDocuments", async () => 1);
  t.mock.method(Action, "create", async (doc) => ({ ...doc, _id: "act1" }));
  t.mock.method(LabRun, "findById", () => fakeQuery(labRun));
  t.mock.method(Chemical, "find", () => fakeQuery([{ _id: HCL, symbol: "HCl", category: "acid", formula: "HCl" }]));
  const CHEM_002 = misconceptions.find((m) => m.code === "CHEM_002");
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
  runner.__resetCacheForTests();
}

function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
const reqFor = () => ({ params: { id: "sess1" }, body: { stepId: 1, actionType: "add_chemical" }, user: { _id: "u1", grade: 10 } });

test("logAction — flags off: no misconception hint even with the CHEM_002 trajectory", async (t) => {
  delete process.env.STUDENT_MODEL_ENABLED;
  const session = makeSession();
  wire(t, { session, labRun: benchHeated });
  const res = fakeRes();
  await logAction(reqFor(), res, (e) => { throw e; });
  assert.equal(res.body.meta.intervention.type, "chemical_hint", "legacy path, unchanged");
  assert.equal(session.studentModel, undefined, "no snapshot persisted when disabled");
});

test("logAction — treatment arm + DRIVES_HINTS: the CHEM_002 trajectory yields a misconception_hint", async (t) => {
  process.env.STUDENT_MODEL_ENABLED = "true";
  process.env.STUDENT_MODEL_DRIVES_HINTS = "true";
  t.after(() => {
    delete process.env.STUDENT_MODEL_ENABLED;
    delete process.env.STUDENT_MODEL_DRIVES_HINTS;
    runner.__resetCacheForTests();
  });
  const session = makeSession({ experimentArm: "treatment" });
  wire(t, { session, labRun: benchHeated });
  const res = fakeRes();
  await logAction(reqFor(), res, (e) => { throw e; });

  assert.equal(res.body.meta.intervention.type, "misconception_hint");
  assert.equal(res.body.meta.intervention.misconceptionCode, "CHEM_002");
  assert.ok(res.body.meta.intervention.hint.length > 0);
  assert.ok(session.studentModel, "snapshot persisted");
  assert.ok(session.studentModel.misconceptions.find((m) => m.code === "CHEM_002").probability >= 0.6);
});

test("logAction — shadow mode (enabled, DRIVES_HINTS off): snapshot persisted, legacy hint shown", async (t) => {
  process.env.STUDENT_MODEL_ENABLED = "true";
  delete process.env.STUDENT_MODEL_DRIVES_HINTS;
  t.after(() => {
    delete process.env.STUDENT_MODEL_ENABLED;
    runner.__resetCacheForTests();
  });
  const session = makeSession({ experimentArm: "treatment" });
  wire(t, { session, labRun: benchHeated });
  const res = fakeRes();
  await logAction(reqFor(), res, (e) => { throw e; });

  assert.equal(res.body.meta.intervention.type, "chemical_hint", "student still sees the legacy hint");
  assert.ok(session.studentModel, "but the snapshot is persisted for research");
});
