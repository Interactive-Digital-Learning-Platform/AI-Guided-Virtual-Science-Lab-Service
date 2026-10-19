// Regression guard for services/labScoringService.js — the single source of truth for guided-
// practical scoring. The student-model work must not change any of these numbers with its flags
// off. All expected values here are hand-derived from the documented formulas in the service.
const test = require("node:test");
const assert = require("node:assert/strict");
const s = require("../../src/services/labScoringService");

test("calculateHintPenalty — cumulative ladder 0/1/3/6", () => {
  assert.equal(s.calculateHintPenalty(0), 0);
  assert.equal(s.calculateHintPenalty(1), 1);
  assert.equal(s.calculateHintPenalty(2), 3);
  assert.equal(s.calculateHintPenalty(3), 6);
  assert.equal(s.calculateHintPenalty(5), 6, "clamps above level 3");
  assert.equal(s.calculateHintPenalty(undefined), 0);
});

test("calculateHelpPenalty — flat -5 when used", () => {
  assert.equal(s.calculateHelpPenalty(true), 5);
  assert.equal(s.calculateHelpPenalty(false), 0);
  assert.equal(s.calculateHelpPenalty(undefined), 0);
});

test("calculateTaskPerformanceScore — 100 minus cumulative penalties", () => {
  assert.deepEqual(s.calculateTaskPerformanceScore({ highestHintLevel: 0, helpUsed: false }), {
    base: 100,
    hintPenalty: 0,
    helpPenalty: 0,
    score: 100,
  });
  assert.deepEqual(s.calculateTaskPerformanceScore({ highestHintLevel: 2, helpUsed: false }), {
    base: 100,
    hintPenalty: 3,
    helpPenalty: 0,
    score: 97,
  });
  assert.deepEqual(s.calculateTaskPerformanceScore({ highestHintLevel: 3, helpUsed: true }), {
    base: 100,
    hintPenalty: 6,
    helpPenalty: 5,
    score: 89,
  });
  assert.deepEqual(s.calculateTaskPerformanceScore({}), { base: 100, hintPenalty: 0, helpPenalty: 0, score: 100 });
});

test("calculateTimeScore — gentle bands, floor 70, null when incomparable", () => {
  assert.equal(s.calculateTimeScore(60, 60), 100); // ratio 1.0
  assert.equal(s.calculateTimeScore(75, 60), 100); // ratio 1.25 -> still within first band (<= 1.25)
  assert.equal(s.calculateTimeScore(90, 60), 95); // ratio 1.5
  assert.equal(s.calculateTimeScore(120, 60), 90); // ratio 2.0
  assert.equal(s.calculateTimeScore(180, 60), 80); // ratio 3.0
  assert.equal(s.calculateTimeScore(600, 60), 70); // ratio 10 -> floor
  assert.equal(s.calculateTimeScore(60, 0), null);
  assert.equal(s.calculateTimeScore(0, 60), null);
  assert.equal(s.calculateTimeScore(null, 60), null);
});

test("combineFinalScore — 90/10 blend, performance-only when time neutral", () => {
  assert.equal(s.combineFinalScore(100, null), 100);
  assert.equal(s.combineFinalScore(80, null), 80);
  assert.equal(s.combineFinalScore(90, 70), Math.round(90 * 0.9 + 70 * 0.1)); // 88
  assert.equal(s.combineFinalScore(100, 80), 98);
  assert.equal(s.combineFinalScore(0, 0), 0);
});

test("expectedTaskSeconds — resolution order", () => {
  // 1. explicit micro-step value wins
  assert.equal(
    s.expectedTaskSeconds({ microStep: { expectedTimeSeconds: 45 }, step: { expectedTimeSeconds: 120 }, experiment: { estimatedTime: 25 }, stepCount: 5, stepMicroStepCount: 3 }),
    45
  );
  // 2. explicit Main Step value
  assert.equal(
    s.expectedTaskSeconds({ microStep: { expectedTimeSeconds: 0 }, step: { expectedTimeSeconds: 90 }, experiment: { estimatedTime: 25 }, stepCount: 5, stepMicroStepCount: 3 }),
    90
  );
  // 3. derived from experiment.estimatedTime (migrated practical): 25min*60 / 5 steps / 3 tasks
  assert.equal(
    s.expectedTaskSeconds({ microStep: {}, step: {}, experiment: { estimatedTime: 25 }, stepCount: 5, stepMicroStepCount: 3 }),
    Math.round((25 * 60) / 5 / 3) // 100
  );
  // 4. unmigrated step (no microStep) with no config -> null (time-neutral)
  assert.equal(s.expectedTaskSeconds({ microStep: null, step: {}, experiment: { estimatedTime: 25 }, stepCount: 5 }), null);
});

test("expectedStepSeconds — only when explicitly authored", () => {
  assert.equal(s.expectedStepSeconds({ step: { expectedTimeSeconds: 120 } }), 120);
  assert.equal(s.expectedStepSeconds({ step: {} }), null);
  assert.equal(s.expectedStepSeconds({ step: null }), null);
});

test("average / clamp helpers", () => {
  assert.equal(s.average([90, 100, 80]), 90);
  assert.equal(s.average([]), null);
  assert.equal(s.clamp(120), 100);
  assert.equal(s.clamp(-5), 0);
  assert.equal(s.clamp(55), 55);
});
