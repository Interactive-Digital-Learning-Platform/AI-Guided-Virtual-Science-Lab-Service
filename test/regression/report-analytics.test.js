// Regression guard for services/reportAnalyticsService.js — the deterministic report analytics the
// mobile Report screen renders AND the block the feedback LLM is handed. The student-model work
// must not change this output with its flags off.
//
// To refresh these snapshots after an INTENTIONAL change: run with SNAPSHOT=1 to print the current
// output, eyeball the diff, paste it back in.
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildReportAnalytics } = require("../../src/services/reportAnalyticsService");
const fx = require("../fixtures/sessions");

const run = (session, actions) =>
  buildReportAnalytics({
    session,
    experiment: fx.acidBaseExperiment,
    actions,
    misconceptions: session.aiFeedback.misconceptionsDetected,
  });

if (process.env.SNAPSHOT) {
  console.log("CLEAN\n", JSON.stringify(run(fx.cleanSession, fx.cleanActions), null, 2));
  console.log("STRUGGLED\n", JSON.stringify(run(fx.struggledSession, fx.struggledActions), null, 2));
}

test("clean run — no struggle surfaced, all steps Strong, zero guidance", () => {
  const out = run(fx.cleanSession, fx.cleanActions);

  assert.equal(out.stepBreakdown.length, 2);
  assert.deepEqual(
    out.stepBreakdown.map((b) => ({ stepId: b.stepId, score: b.score, status: b.status, struggleIndex: b.struggleIndex, reasons: b.reasons })),
    [
      { stepId: 1, score: 100, status: "Strong", struggleIndex: 0, reasons: [] },
      { stepId: 2, score: 100, status: "Strong", struggleIndex: 0, reasons: [] },
    ]
  );
  assert.deepEqual(out.mostStruggledSteps, []);
  assert.deepEqual(out.guidanceSummary, { hint1Count: 0, hint2Count: 0, hint3Count: 0, helpCount: 0, totalDeduction: 0 });
  assert.deepEqual(out.proceduralErrors, []);
  assert.equal(out.stepBreakdown[0].tasks.length, 2);
});

test("struggled run — step 2 surfaced as most-struggled with plain reasons", () => {
  const out = run(fx.struggledSession, fx.struggledActions);

  const step2 = out.stepBreakdown.find((b) => b.stepId === 2);
  assert.equal(step2.score, 89);
  assert.equal(step2.status, "Challenging");
  assert.equal(step2.hintsRequested, 3);
  assert.equal(step2.highestHintLevel, 3);
  assert.equal(step2.helpUsed, true);
  assert.equal(step2.retries, 2);
  assert.equal(step2.equipmentMistakes, 1);
  assert.equal(step2.chemicalMistakes, 1);
  assert.equal(step2.conceptualErrorCount, 1);

  // 3×perHint + hintLadderTopped(2) + helpUsed(5) + 2×perRetry(4) + 2×perMistake(2) + perConceptual(3)
  // + timeOverrun(0, since 300s vs the 600s derived expectation is under the 1.5× gate) = 19
  assert.equal(step2.struggleIndex, 19);
  assert.deepEqual(step2.reasons, [
    "Used all three hints",
    "Used Help to reveal the answer",
    "2 incorrect attempts",
    "1 equipment mistake",
    "1 material mistake",
    "A misconception was detected on this step",
  ]);

  assert.deepEqual(out.mostStruggledSteps, [
    {
      stepId: 2,
      title: "Add a Way to Detect the Endpoint",
      struggleIndex: 19,
      reasons: step2.reasons,
    },
  ]);

  assert.deepEqual(out.guidanceSummary, { hint1Count: 1, hint2Count: 1, hint3Count: 1, helpCount: 1, totalDeduction: 11 });

  assert.deepEqual(out.proceduralErrors, [
    {
      stepId: 2,
      stepTitle: "Add a Way to Detect the Endpoint",
      message: "Tried to work with a piece of equipment before it was on the bench.",
      count: 1,
    },
    {
      stepId: 2,
      stepTitle: "Add a Way to Detect the Endpoint",
      message: "Tried to carry out the step before the material it needs was added.",
      count: 1,
    },
  ]);
});

test("formatDuration — matches the mobile report style", () => {
  const { formatDuration } = require("../../src/services/reportAnalyticsService");
  assert.equal(formatDuration(0), "0s");
  assert.equal(formatDuration(45), "45s");
  assert.equal(formatDuration(60), "1m 00s");
  assert.equal(formatDuration(305), "5m 05s");
  assert.equal(formatDuration(-3), "0s");
});
