// M2 — studentModelService: one trajectory fixture per authored behavioural signature, asserting
// the posterior moves the right way, plus diagnose / shouldIntervene / clean-run behaviour.
const test = require("node:test");
const assert = require("node:assert/strict");
const svc = require("../../src/services/studentModelService");
const { buildScenario, signaturesByCode, chemicals } = require("../fixtures/trajectories");

const P = (model, code) => (model.misconceptions.find((m) => m.code === code) || {}).probability ?? null;

const compute = (scn, chemicalsById = null) =>
  svc.computeStudentModel({
    experiment: scn.experiment,
    session: scn.session,
    benchActions: scn.benchActions,
    signaturesByCode,
    chemicalsById,
  });

// ── clean run: no signature actions → every posterior stays below 0.5 (its prior) ─────────────
test("clean run — no signatures fire, posteriors stay at prior", () => {
  const scn = buildScenario({
    relevantCodes: ["CHEM_001", "CHEM_002", "CHEM_003", "CHEM_004"],
    phases: [
      { intent: "SELECT_CONTAINER", actions: [{ actionType: "create_equipment", equipment: "beaker" }] },
      { intent: "ADD_REAGENT", actions: [{ actionType: "add_chemical", equipment: "beaker", chemicalIds: ["hcl"] }] },
      { intent: "MIX_SUBSTANCES", actions: [{ actionType: "add_chemical", equipment: "beaker", chemicalIds: ["naoh"], resultType: "reaction_success" }] },
    ],
  });
  const model = compute(scn);
  for (const m of model.misconceptions) {
    assert.ok(m.probability < 0.5, `${m.code} should stay at prior, got ${m.probability}`);
    assert.equal(m.evidence.length, 0);
  }
  assert.equal(model.cluster, "acid_base");
  assert.equal(model.computedFromActionCount, 3);
});

// ── CHEM_002 — heat during an add-indicator task ─────────────────────────────────────────────
test("CHEM_002 — heating during the endpoint/indicator task raises its posterior", () => {
  const scn = buildScenario({
    relevantCodes: ["CHEM_002", "CHEM_004"],
    phases: [
      { intent: "SELECT_CONTAINER", actions: [{ actionType: "create_equipment", equipment: "beaker" }] },
      { intent: "ADD_REAGENT", actions: [
        { actionType: "heat", equipment: "beaker", temperature: 55 },
        { actionType: "heat", equipment: "beaker", temperature: 70 },
      ] },
    ],
  });
  const model = compute(scn);
  assert.ok(P(model, "CHEM_002") >= 0.6, `CHEM_002 got ${P(model, "CHEM_002")}`);
  assert.ok(P(model, "CHEM_002") > P(model, "CHEM_004"));
  assert.equal(model.misconceptions[0].code, "CHEM_002");
  assert.ok(model.misconceptions[0].evidence.every((e) => e.predicate === "heat_during_indicator_or_endpoint_task"));
});

// ── CHEM_002 — thermometer used to judge the endpoint ────────────────────────────────────────
test("CHEM_002 — using a thermometer to read the endpoint raises its posterior", () => {
  const scn = buildScenario({
    relevantCodes: ["CHEM_002"],
    phases: [
      { intent: "MEASURE_RESULT", actions: [
        { actionType: "probe_measure", equipment: "thermometer", quantity: 24, unit: "C" },
        { actionType: "read_measurement", equipment: "thermometer", quantity: 25, unit: "C" },
      ] },
    ],
  });
  const model = compute(scn);
  assert.ok(P(model, "CHEM_002") >= 0.55, `got ${P(model, "CHEM_002")}`);
});

// ── CHEM_003 — pH 7 recorded as the endpoint ─────────────────────────────────────────────────
test("CHEM_003 — recording pH 7 as the endpoint raises its posterior", () => {
  const scn = buildScenario({
    relevantCodes: ["CHEM_003", "CHEM_002"],
    phases: [
      { intent: "MEASURE_RESULT", actions: [{ actionType: "probe_measure", equipment: "ph_meter", quantity: 7.0, unit: "pH" }] },
      { intent: "RECORD_RESULT", actions: [{ actionType: "probe_measure", equipment: "ph_meter", quantity: 6.9, unit: "pH" }] },
    ],
  });
  const model = compute(scn);
  assert.ok(P(model, "CHEM_003") >= 0.6, `got ${P(model, "CHEM_003")}`);
  assert.equal(model.misconceptions[0].code, "CHEM_003");
});

test("CHEM_003 — a pH reading well away from 7 does NOT fire it", () => {
  const scn = buildScenario({
    relevantCodes: ["CHEM_003"],
    phases: [{ intent: "MEASURE_RESULT", actions: [{ actionType: "probe_measure", equipment: "ph_meter", quantity: 9.4, unit: "pH" }] }],
  });
  assert.ok(P(compute(scn), "CHEM_003") < 0.5);
});

// ── CHEM_004 — combining non-reacting substances ─────────────────────────────────────────────
test("CHEM_004 — a no_reaction result on a mix task raises its posterior", () => {
  const scn = buildScenario({
    relevantCodes: ["CHEM_004", "CHEM_002"],
    phases: [
      { intent: "MIX_SUBSTANCES", actions: [
        { actionType: "add_chemical", equipment: "beaker", chemicalIds: ["water"], resultType: "no_reaction" },
        { actionType: "add_chemical", equipment: "beaker", chemicalIds: ["cuso4"], resultType: "no_reaction" },
        { actionType: "add_chemical", equipment: "test_tube", chemicalIds: ["water"], resultType: "no_reaction" },
      ] },
    ],
  });
  const model = compute(scn);
  assert.ok(P(model, "CHEM_004") >= 0.6, `got ${P(model, "CHEM_004")}`);
});

// ── CHEM_001 — reagent added before the indicator ────────────────────────────────────────────
test("CHEM_001 — adding the base before the indicator raises its posterior", () => {
  const scn = buildScenario({
    relevantCodes: ["CHEM_001"],
    requiredChemicals: [{ chemical: "hcl" }, { chemical: "naoh" }, { chemical: "phph" }],
    phases: [
      { intent: "ADD_REAGENT", actions: [{ actionType: "add_chemical", equipment: "beaker", chemicalIds: ["hcl"] }] },
      { intent: "ADD_REAGENT", actions: [{ actionType: "add_chemical", equipment: "beaker", chemicalIds: ["naoh"] }] },
    ],
  });
  const model = compute(scn, chemicals);
  assert.ok(P(model, "CHEM_001") >= 0.55, `got ${P(model, "CHEM_001")}`);
});

test("CHEM_001 — adding the indicator first does NOT fire it", () => {
  const scn = buildScenario({
    relevantCodes: ["CHEM_001"],
    requiredChemicals: [{ chemical: "hcl" }, { chemical: "phph" }],
    phases: [
      { intent: "ADD_REAGENT", actions: [{ actionType: "add_chemical", equipment: "beaker", chemicalIds: ["phph"] }] },
      { intent: "ADD_REAGENT", actions: [{ actionType: "add_chemical", equipment: "beaker", chemicalIds: ["naoh"] }] },
    ],
  });
  assert.ok(P(compute(scn, chemicals), "CHEM_001") < 0.5);
});

// ── CHEM_005 — less reactive metal chosen for a displacement ──────────────────────────────────
test("CHEM_005 — adding silver to a copper-sulfate solution raises its posterior", () => {
  const scn = buildScenario({
    relevantCodes: ["CHEM_005"],
    phases: [
      { intent: "PREPARE_SAMPLE", actions: [{ actionType: "add_chemical", equipment: "beaker", chemicalIds: ["cuso4"] }] },
      { intent: "ADD_REAGENT", actions: [{ actionType: "add_chemical", equipment: "beaker", chemicalIds: ["ag"] }] },
    ],
  });
  assert.ok(P(compute(scn, chemicals), "CHEM_005") >= 0.55);
});

test("CHEM_005 — adding zinc (more reactive than Cu) does NOT fire it", () => {
  const scn = buildScenario({
    relevantCodes: ["CHEM_005"],
    phases: [
      { intent: "PREPARE_SAMPLE", actions: [{ actionType: "add_chemical", equipment: "beaker", chemicalIds: ["cuso4"] }] },
      { intent: "ADD_REAGENT", actions: [{ actionType: "add_chemical", equipment: "beaker", chemicalIds: ["zn"] }] },
    ],
  });
  assert.ok(P(compute(scn, chemicals), "CHEM_005") < 0.5);
});

// ── CHEM_006 — heat on a non-thermal task ────────────────────────────────────────────────────
test("CHEM_006 — heating during non-thermal tasks raises its posterior", () => {
  const scn = buildScenario({
    relevantCodes: ["CHEM_006"],
    phases: [
      { intent: "MIX_SUBSTANCES", actions: [{ actionType: "heat", equipment: "beaker", temperature: 80 }] },
      { intent: "ADD_REAGENT", actions: [{ actionType: "heat", equipment: "beaker", temperature: 85 }] },
    ],
  });
  const model = compute(scn);
  const prob = P(model, "CHEM_006");
  assert.ok(prob >= 0.5, `got ${prob}`);
  assert.ok(prob > svc._internal.sigmoid(model.misconceptions[0].priorLogOdds), "moved above prior");
});

// ── PHY_010 — large release angle ───────────────────────────────────────────────────────────
test("PHY_010 — a pendulum release angle over 15° raises its posterior", () => {
  const scn = buildScenario({
    relevantCodes: ["PHY_010", "PHY_011"],
    phases: [{ intent: "SET_MEASUREMENT_PARAMETER", actions: [{ actionType: "set_release_angle", equipment: "pendulum_bob", quantity: 35, unit: "deg" }] }],
  });
  const model = compute(scn);
  assert.ok(P(model, "PHY_010") >= 0.6, `got ${P(model, "PHY_010")}`);
  assert.ok(P(model, "PHY_010") > P(model, "PHY_011"));
});

test("PHY_010 — a 10° release angle does NOT fire it", () => {
  const scn = buildScenario({
    relevantCodes: ["PHY_010"],
    phases: [{ intent: "SET_MEASUREMENT_PARAMETER", actions: [{ actionType: "set_release_angle", equipment: "pendulum_bob", quantity: 10, unit: "deg" }] }],
  });
  assert.ok(P(compute(scn), "PHY_010") < 0.5);
});

// ── PHY_011 — single oscillation timed ──────────────────────────────────────────────────────
test("PHY_011 — stopping the timer after one oscillation raises its posterior", () => {
  const scn = buildScenario({
    relevantCodes: ["PHY_011"],
    phases: [
      { intent: "START_TIMED_TRIAL", actions: [{ actionType: "start_timer", equipment: "stopwatch" }] },
      { intent: "STOP_TIMED_TRIAL", actions: [
        { actionType: "record_oscillation", equipment: "stopwatch", quantity: 1 },
        { actionType: "stop_timer", equipment: "stopwatch", quantity: 9.6, unit: "m/s^2" },
      ] },
    ],
  });
  assert.ok(P(compute(scn), "PHY_011") >= 0.55);
});

test("PHY_011 — timing 12 oscillations does NOT fire it", () => {
  const osc = Array.from({ length: 12 }, (_, i) => ({ actionType: "record_oscillation", equipment: "stopwatch", quantity: i + 1 }));
  const scn = buildScenario({
    relevantCodes: ["PHY_011"],
    phases: [
      { intent: "START_TIMED_TRIAL", actions: [{ actionType: "start_timer", equipment: "stopwatch" }] },
      { intent: "STOP_TIMED_TRIAL", actions: [...osc, { actionType: "stop_timer", equipment: "stopwatch", quantity: 9.8 }] },
    ],
  });
  assert.ok(P(compute(scn), "PHY_011") < 0.5);
});

// ── PHY_013 — total length reported as extension ─────────────────────────────────────────────
test("PHY_013 — reading back a length ≈ a set length raises its posterior", () => {
  const scn = buildScenario({
    relevantCodes: ["PHY_013"],
    phases: [
      { intent: "SET_MEASUREMENT_PARAMETER", actions: [{ actionType: "set_length", equipment: "spring", quantity: 12, unit: "cm" }] },
      { intent: "MEASURE_RESULT", actions: [{ actionType: "read_measurement", equipment: "spring", quantity: 12.3, unit: "cm" }] },
    ],
  });
  assert.ok(P(compute(scn), "PHY_013") >= 0.55);
});

// ── diagnose ────────────────────────────────────────────────────────────────────────────────
test("diagnose — filters to threshold, joins KB text, orders by probability", () => {
  const scn = buildScenario({
    relevantCodes: ["CHEM_002", "CHEM_004"],
    phases: [
      { intent: "ADD_REAGENT", actions: [
        { actionType: "heat", equipment: "beaker", temperature: 55 },
        { actionType: "heat", equipment: "beaker", temperature: 70 },
      ] },
    ],
  });
  const model = compute(scn);
  const dx = svc.diagnose({ studentModel: model, signaturesByCode });
  assert.ok(dx.length >= 1);
  assert.equal(dx[0].code, "CHEM_002");
  assert.match(dx[0].description, /temperature/i);
  assert.ok(dx[0].correctionStrategy && dx[0].correctionStrategy.length > 0);
  assert.ok(dx[0].evidence.length > 0);
});

// ── shouldIntervene ─────────────────────────────────────────────────────────────────────────
test("shouldIntervene — fires for a probable misconception relevant to the current task", () => {
  const scn = buildScenario({
    relevantCodes: ["CHEM_002"],
    phases: [
      { intent: "ADD_REAGENT", actions: [
        { actionType: "heat", equipment: "beaker", temperature: 55 },
        { actionType: "heat", equipment: "beaker", temperature: 70 },
        { actionType: "heat", equipment: "beaker", temperature: 75 },
      ] },
    ],
  });
  const model = compute(scn);
  const task = { stepId: 1, microStepId: 1, expectedIntent: "ADD_REAGENT" };
  const d = svc.shouldIntervene({ studentModel: model, task, signaturesByCode });
  assert.equal(d.intervene, true);
  assert.equal(d.reason, "misconception");
  assert.equal(d.misconceptionCode, "CHEM_002");
  assert.ok(d.level >= 1 && d.level <= 3);

  // no repeat once it's been surfaced
  const again = svc.shouldIntervene({ studentModel: model, task, signaturesByCode, alreadyIntervenedCodes: ["CHEM_002"] });
  assert.equal(again.intervene, false);
});

// ── timeline fallback: no timestamps → every action judged against session.currentMicroStep ────
test("no task timeline — actions are judged against the session's current task", () => {
  // Mid-session live-call shape: currentMicroStep points at an ADD_REAGENT task, actions carry
  // no timestamp, no stepProgress timing. The heat action should still fire CHEM_002.
  const experiment = {
    _id: "e",
    subject: "Chemistry",
    commonMisconceptions: ["CHEM_002"],
    steps: [
      {
        stepId: 1,
        misconceptionRisks: ["CHEM_002"],
        microSteps: [{ microStepId: 1, expectedIntent: "ADD_REAGENT" }],
      },
    ],
  };
  const session = { currentStep: 1, currentMicroStep: 1, stepProgress: [] };
  const benchActions = [
    { actionType: "heat", equipment: "beaker", chemicalIds: [] },
    { actionType: "heat", equipment: "beaker", chemicalIds: [] },
  ];
  const model = svc.computeStudentModel({ experiment, session, benchActions, signaturesByCode });
  assert.ok(P(model, "CHEM_002") >= 0.6, `got ${P(model, "CHEM_002")}`);
});

test("buildTaskTimeline — ordered windows with expectedIntent from the practical", () => {
  const scn = buildScenario({
    relevantCodes: ["CHEM_002"],
    phases: [
      { intent: "SELECT_CONTAINER", actions: [] },
      { intent: "ADD_REAGENT", actions: [] },
    ],
  });
  const tl = svc.buildTaskTimeline({ experiment: scn.experiment, session: scn.session });
  assert.equal(tl.length, 2);
  assert.deepEqual(tl.map((w) => w.expectedIntent), ["SELECT_CONTAINER", "ADD_REAGENT"]);
  assert.ok(tl[0].startedAt < tl[1].startedAt);
});

// ── M4 — sub-goal / divergence flag ─────────────────────────────────────────────────────────
const divergenceExperiment = {
  _id: "e",
  subject: "Chemistry",
  commonMisconceptions: [],
  steps: [
    {
      stepId: 1,
      requiredEquipment: ["beaker"],
      requiredChemicalsForStep: ["hcl"],
      misconceptionRisks: [],
      microSteps: [{ microStepId: 1, expectedIntent: "ADD_REAGENT", expectedEquipment: ["beaker"], expectedChemicalsForStep: ["hcl"] }],
    },
  ],
};
const atTask1 = { currentStep: 1, currentMicroStep: 1, stepProgress: [] };
const subGoal = (benchActions) =>
  svc.computeStudentModel({ experiment: divergenceExperiment, session: atTask1, benchActions, signaturesByCode }).subGoal;

test("divergence — mostly acting on other steps' equipment raises the flag", () => {
  const sg = subGoal([
    { actionType: "create_equipment", equipment: "pendulum_bob", chemicalIds: [] },
    { actionType: "set_release_angle", equipment: "pendulum_bob", chemicalIds: [] },
    { actionType: "start_timer", equipment: "stopwatch", chemicalIds: [] },
    { actionType: "create_equipment", equipment: "bunsen_burner", chemicalIds: [] },
    { actionType: "add_chemical", equipment: "beaker", chemicalIds: ["hcl"] }, // 1/5 on task
  ]);
  assert.equal(sg.divergenceFlag, true);
  assert.ok(sg.onTaskProbability <= 0.4, `onTaskProbability ${sg.onTaskProbability}`);
});

test("divergence — working on the current task keeps the flag down", () => {
  const sg = subGoal([
    { actionType: "create_equipment", equipment: "beaker", chemicalIds: [] },
    { actionType: "add_chemical", equipment: "beaker", chemicalIds: ["hcl"] },
    { actionType: "heat", equipment: "beaker", chemicalIds: [] },
    { actionType: "add_chemical", equipment: "beaker", chemicalIds: ["hcl"] },
  ]);
  assert.equal(sg.divergenceFlag, false);
  assert.equal(sg.onTaskProbability, 1);
});

test("divergence — fewer than 3 equipment/chemical actions in the window → no flag", () => {
  const sg = subGoal([
    { actionType: "create_equipment", equipment: "pendulum_bob", chemicalIds: [] },
    { actionType: "create_equipment", equipment: "stopwatch", chemicalIds: [] },
  ]);
  assert.equal(sg.divergenceFlag, false);
  assert.equal(sg.onTaskProbability, 1);
});

test("divergence — a task with no bench requirement never diverges", () => {
  const observeExp = {
    _id: "e",
    subject: "Chemistry",
    commonMisconceptions: [],
    steps: [{ stepId: 1, misconceptionRisks: [], microSteps: [{ microStepId: 1, expectedIntent: "OBSERVE_RESULT" }] }],
  };
  const sg = svc.computeStudentModel({
    experiment: observeExp,
    session: atTask1,
    benchActions: [
      { actionType: "create_equipment", equipment: "pendulum_bob", chemicalIds: [] },
      { actionType: "set_release_angle", equipment: "pendulum_bob", chemicalIds: [] },
      { actionType: "start_timer", equipment: "stopwatch", chemicalIds: [] },
    ],
    signaturesByCode,
  }).subGoal;
  assert.equal(sg.divergenceFlag, false);
});

test("shouldIntervene — divergence flag produces a divergence nudge when no misconception is probable", () => {
  const model = {
    misconceptions: [],
    subGoal: { divergenceFlag: true, onTaskProbability: 0.2, nominalMicroStepId: 1 },
  };
  const d = svc.shouldIntervene({ studentModel: model, task: { stepId: 1, microStepId: 1, expectedIntent: "ADD_REAGENT" }, signaturesByCode });
  assert.equal(d.intervene, true);
  assert.equal(d.reason, "divergence");
});

test("shouldIntervene — silent when the probable misconception is irrelevant to the current task", () => {
  const scn = buildScenario({
    relevantCodes: ["PHY_010"],
    phases: [{ intent: "SET_MEASUREMENT_PARAMETER", actions: [{ actionType: "set_release_angle", equipment: "pendulum_bob", quantity: 40 }] }],
  });
  const model = compute(scn);
  const task = { stepId: 1, microStepId: 2, expectedIntent: "RECORD_RESULT" };
  assert.equal(svc.shouldIntervene({ studentModel: model, task, signaturesByCode }).intervene, false);
});
