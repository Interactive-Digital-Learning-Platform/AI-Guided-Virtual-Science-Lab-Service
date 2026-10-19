// Regression guard: session.controller.logAction's chemical-mismatch intervention branch reads
// `evalResult` outside the `if (step)` block it was declared in. Block-scoped (`const`), that path
// threw `ReferenceError: evalResult is not defined` → HTTP 500 (after the action was already
// saved) every time a student had the right equipment but a missing chemical on a graded task.
//
// This test drives exactly that path and asserts it returns the chemical hint without throwing.
// Mongoose model statics are mocked — no database.
const test = require("node:test");
const assert = require("node:assert/strict");

const Session = require("../../src/models/Session");
const Action = require("../../src/models/Action");
const LabRun = require("../../src/models/LabRun");
const Chemical = require("../../src/models/Chemical");
const { logAction } = require("../../src/controllers/session.controller");

const HCL = "hcl000000000000000000000";
const fakeQuery = (v) => ({ select() { return this; }, lean: async () => v });

const experiment = {
  _id: "exp1",
  title: "Acid-Base Neutralization",
  subject: "Chemistry",
  reactionId: null,
  steps: [
    {
      stepId: 1,
      title: "Add the acid",
      instruction: "Add the acid to the beaker.",
      actionType: "add",
      requiredEquipment: ["beaker"],
      requiredChemicalsForStep: [HCL],
      misconceptionRisks: [],
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

// A migrated micro-step progress entry, pre-filled to the shape Mongoose sub-schema defaults give
// (plain object fixtures don't get those defaults).
const microStepProgress = () => ({
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
});

test("logAction — right equipment, missing chemical → chemical_hint, no ReferenceError", async (t) => {
  const session = {
    _id: "sess1",
    status: "in_progress",
    experimentId: experiment,
    labRunId: "lr1",
    currentStep: 1,
    currentMicroStep: 1,
    actions: [],
    stepProgress: [
      { stepId: 1, startedAt: new Date("2026-08-30T10:00:00Z"), stepScore: 100, hintPenalty: 0, helpPenalty: 0, microSteps: [microStepProgress()] },
    ],
    behaviorFeatures: { totalActions: 0, totalErrors: 0, totalHintsRequested: 0, totalRetries: 0, totalSkips: 0, fastSteps: 0, struggledSteps: [] },
    save: async () => {},
  };

  // Bench: a beaker is placed, but HCl has not been added → equipmentOk true, chemicalsOk false.
  const labRun = {
    equipment: [{ equipmentType: "beaker", contents: [] }],
    physicsEquipment: [],
    circuitBoardState: null,
    reactionsTriggered: [],
    actions: [],
    materials: [],
  };

  t.mock.method(Session, "findById", () => ({ populate: async () => session }));
  t.mock.method(Action, "countDocuments", async () => 1);
  t.mock.method(Action, "create", async (doc) => ({ ...doc, _id: "act1" }));
  t.mock.method(LabRun, "findById", () => fakeQuery(labRun));
  t.mock.method(Chemical, "find", () => fakeQuery([{ _id: HCL, symbol: "HCl", category: "acid", formula: "HCl" }]));

  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  let threwTo = null;

  await logAction(
    { params: { id: "sess1" }, body: { stepId: 1, actionType: "add_chemical" }, user: { _id: "u1", grade: 10 } },
    res,
    (e) => { threwTo = e; }
  );

  assert.equal(threwTo, null, threwTo && threwTo.stack);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.actionType, "incorrect");
  assert.equal(res.body.meta.intervention.type, "chemical_hint");
  assert.ok(res.body.meta.intervention.hint.length > 0);
});
