// Single source of truth for guided-practical scoring. logAction, completeSession and the report
// endpoint all go through here so the numbers can never be derived two different ways.
//
// Two components, combined at Session completion:
//   performanceScore — did the student perform the task correctly and independently
//   timeScore        — did they spend a sane amount of time on it (gentle; only flags real struggle)
//
// finalScore = round(performanceScore * 0.90 + timeScore * 0.10)   (time-neutral → performance only)

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

// ── Guidance penalties (CUMULATIVE / stacking) ────────────────────────────────────────────────
// Hints are a strictly-sequential ladder, so highestHintLevel = N means hints 1..N were all shown.
// The penalty is the SUM of the per-level costs, not just the last level's cost.
//   level 1 → -1        (total -1)
//   level 2 → -2 more   (total -3)
//   level 3 → -3 more   (total -6)
// Help (the answer reveal) is -5 ON TOP of whatever hints preceded it — it does NOT replace them.
const HINT_LEVEL_COST = { 1: 1, 2: 2, 3: 3 };
const HELP_PENALTY = 5;

const calculateHintPenalty = (highestHintLevel = 0) => {
  const lvl = clamp(Math.round(highestHintLevel || 0), 0, 3);
  let penalty = 0;
  for (let i = 1; i <= lvl; i += 1) penalty += HINT_LEVEL_COST[i];
  return penalty; // 0 / 1 / 3 / 6
};

const calculateHelpPenalty = (helpUsed) => (helpUsed ? HELP_PENALTY : 0);

/**
 * Per-task (or per-step, for unmigrated practicals) performance score.
 * @param {{highestHintLevel?: number, helpUsed?: boolean}} entry — a stepProgress / microStep progress entry
 * @returns {{ base: 100, hintPenalty: number, helpPenalty: number, score: number }}
 *   Equipment/chemical mistakes aren't deducted directly — they're what push highestHintLevel up
 *   (see logAction's autoHintLevel), so they're already priced in here.
 */
const calculateTaskPerformanceScore = (entry = {}) => {
  const hintPenalty = calculateHintPenalty(entry.highestHintLevel);
  const helpPenalty = calculateHelpPenalty(entry.helpUsed);
  return { base: 100, hintPenalty, helpPenalty, score: clamp(100 - hintPenalty - helpPenalty) };
};

// ── Time scoring (gentle; never rewards rushing) ──────────────────────────────────────────────
// Only ever LOWERS a score, floors at 70, and is a small slice of the final number. Its purpose
// is to surface excessive struggle, not to make speed a goal.
const TIME_BANDS = [
  { maxRatio: 1.25, score: 100 },
  { maxRatio: 1.5, score: 95 },
  { maxRatio: 2.0, score: 90 },
  { maxRatio: 3.0, score: 80 },
];
const TIME_FLOOR = 70;

/**
 * @returns {number|null} the band score, or null when there's nothing to compare against — the
 *   caller MUST then treat time as NEUTRAL (leave it out of the weighting), never guess a duration.
 */
const calculateTimeScore = (actualSeconds, expectedSeconds) => {
  if (!expectedSeconds || expectedSeconds <= 0) return null;
  if (actualSeconds == null || actualSeconds <= 0) return null;
  const ratio = actualSeconds / expectedSeconds;
  const band = TIME_BANDS.find((b) => ratio <= b.maxRatio);
  return band ? band.score : TIME_FLOOR;
};

/**
 * Expected seconds for one Current Task (or Main Step). Resolution order:
 *   1. explicit micro-step `expectedTimeSeconds` (author config)
 *   2. explicit Main Step `expectedTimeSeconds`
 *   3. for MIGRATED practicals only: derive from the author's own experiment.estimatedTime
 *      (minutes), split evenly — Main Step gets estimatedTime/stepCount, each of its N tasks
 *      gets that / N. Not a "silent guess": it's the author's number distributed.
 *   4. otherwise null → time-neutral (legacy whole-step practicals, per spec §9).
 */
const expectedTaskSeconds = ({ microStep, step, experiment, stepCount, stepMicroStepCount }) => {
  if (microStep && microStep.expectedTimeSeconds > 0) return microStep.expectedTimeSeconds;
  if (step && step.expectedTimeSeconds > 0) return step.expectedTimeSeconds;
  if (!microStep) return null; // unmigrated step with no explicit config → neutral
  const totalSeconds = (experiment && experiment.estimatedTime ? experiment.estimatedTime : 0) * 60;
  if (!totalSeconds || !stepCount) return null;
  const perStep = totalSeconds / stepCount;
  return Math.round(stepMicroStepCount > 0 ? perStep / stepMicroStepCount : perStep);
};

// Expected seconds for an UNMIGRATED Main Step (no micro-steps). Only ever returns a value when
// the author has explicitly set `expectedTimeSeconds` — legacy whole-step practicals stay
// time-NEUTRAL until timings are configured (spec §9: don't guess a duration for them). The
// estimatedTime-derived fallback is reserved for migrated practicals (expectedTaskSeconds), whose
// finer micro-step structure makes the even split defensible.
const expectedStepSeconds = ({ step }) => (step && step.expectedTimeSeconds > 0 ? step.expectedTimeSeconds : null);

// ── Final roll-up ────────────────────────────────────────────────────────────────────────────
const PERFORMANCE_WEIGHT = 0.9;
const TIME_WEIGHT = 0.1;

const average = (nums) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null);

const combineFinalScore = (performanceScore, timeScore) => {
  if (timeScore == null) return Math.round(clamp(performanceScore)); // no timing data → performance only
  return Math.round(clamp(performanceScore * PERFORMANCE_WEIGHT + timeScore * TIME_WEIGHT));
};

module.exports = {
  HINT_LEVEL_COST,
  HELP_PENALTY,
  PERFORMANCE_WEIGHT,
  TIME_WEIGHT,
  clamp,
  average,
  calculateHintPenalty,
  calculateHelpPenalty,
  calculateTaskPerformanceScore,
  calculateTimeScore,
  expectedTaskSeconds,
  expectedStepSeconds,
  combineFinalScore,
};
