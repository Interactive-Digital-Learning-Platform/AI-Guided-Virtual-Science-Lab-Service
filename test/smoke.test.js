// Confirms the test harness itself works. `npm test` runs `node --test test/`.
const test = require("node:test");
const assert = require("node:assert/strict");

test("test harness is wired up", () => {
  assert.equal(1 + 1, 2);
});

test("services load without a database connection", () => {
  // These are the pure modules the student-model work builds on / must not regress.
  // Requiring them must not open a mongoose connection or throw.
  const scoring = require("../src/services/labScoringService");
  const analytics = require("../src/services/reportAnalyticsService");
  const curriculum = require("../src/services/curriculumReferenceService");
  assert.equal(typeof scoring.combineFinalScore, "function");
  assert.equal(typeof analytics.buildReportAnalytics, "function");
  assert.equal(typeof curriculum.practicalCurriculumReference, "function");
});
