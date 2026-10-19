// Classical test statistics for the concept-inventory validity pilot
// (dev-docs/concept-inventory-acid-base.md §8). Pure — unit-tested.
//
// `matrix` is participants × items of 0/1 (1 = both tiers correct). Every function returns null when
// the statistic is not estimable (too few rows/columns or zero variance) rather than a misleading number.

// Round away floating-point noise so "perfectly consistent" data yields exactly 1, not 0.9999999999999999.
const clean = (x) => Math.round(x * 1e12) / 1e12;

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
// Sample variance (n-1). null if n < 2.
const variance = (xs) => {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
};
const pearson = (xs, ys) => {
  const n = xs.length;
  if (n < 3) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return clean(sxy / Math.sqrt(sxx * syy));
};

/** Cronbach's alpha over the item columns. Needs >= 2 items, >= 2 participants, non-zero total variance. */
function cronbachAlpha(matrix) {
  const n = matrix.length;
  const k = n ? matrix[0].length : 0;
  if (n < 2 || k < 2) return null;
  const itemVarSum = Array.from({ length: k }, (_, j) => variance(matrix.map((row) => row[j]))).reduce((a, b) => a + b, 0);
  const totalVar = variance(matrix.map((row) => row.reduce((a, b) => a + b, 0)));
  if (!totalVar) return null;
  return clean((k / (k - 1)) * (1 - itemVarSum / totalVar));
}

/** Corrected item-total (item–rest) correlation: item j vs. the sum of all the OTHER items. */
function itemRestCorrelation(matrix, j) {
  if (matrix.length < 3) return null;
  const item = matrix.map((row) => row[j]);
  const rest = matrix.map((row) => row.reduce((a, b) => a + b, 0) - row[j]);
  return pearson(item, rest);
}

/**
 * Pair participants who have both a Form A and a Form B row (by participantCode).
 * @param scored [{ participantCode, form: "A"|"B", conceptualScore, perItem: [{ bothCorrect }] }]
 * @returns { n } when nobody is paired, else { n, meanA, meanB, meanDifference (B−A), itemDifficultyDelta[] (B−A per item) }
 */
function parallelFormSummary(scored) {
  const byCode = {};
  for (const s of scored) {
    byCode[s.participantCode] = byCode[s.participantCode] || {};
    if (!byCode[s.participantCode][s.form]) byCode[s.participantCode][s.form] = s;
  }
  const pairs = Object.values(byCode).filter((p) => p.A && p.B);
  if (!pairs.length) return { n: 0 };

  const meanA = mean(pairs.map((p) => p.A.conceptualScore));
  const meanB = mean(pairs.map((p) => p.B.conceptualScore));
  const items = pairs[0].A.perItem.length;
  const itemDifficultyDelta = Array.from({ length: items }, (_, i) => {
    const pA = mean(pairs.map((p) => (p.A.perItem[i].bothCorrect ? 1 : 0)));
    const pB = mean(pairs.map((p) => (p.B.perItem[i].bothCorrect ? 1 : 0)));
    return clean(pB - pA);
  });
  return { n: pairs.length, meanA: clean(meanA), meanB: clean(meanB), meanDifference: clean(meanB - meanA), itemDifficultyDelta };
}

module.exports = { cronbachAlpha, itemRestCorrelation, parallelFormSummary };
