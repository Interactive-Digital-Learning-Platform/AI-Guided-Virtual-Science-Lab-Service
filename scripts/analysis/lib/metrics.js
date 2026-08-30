// Pure evaluation metrics for the student-model analysis scripts. No I/O, no deps — unit-tested in
// test/unit/analysis-metrics.test.js.

// Rank-based ROC AUC = P(score for a positive > score for a negative), ties counted as 0.5.
// O(n²) — fine for pilot-scale n (< a few hundred). null when one class is empty.
function auc(scores, labels) {
  const pos = [];
  const neg = [];
  for (let i = 0; i < labels.length; i += 1) (labels[i] ? pos : neg).push(scores[i]);
  if (!pos.length || !neg.length) return null;
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

// Deterministic seeded RNG (mulberry32) so bootstrap CIs are reproducible.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bootstrapAucCI(scores, labels, { iters = 2000, alpha = 0.05, seed = 42 } = {}) {
  const n = labels.length;
  if (n < 4) return { lo: null, hi: null };
  const rng = mulberry32(seed);
  const draws = [];
  for (let b = 0; b < iters; b += 1) {
    const s = new Array(n);
    const l = new Array(n);
    for (let i = 0; i < n; i += 1) {
      const j = Math.floor(rng() * n);
      s[i] = scores[j];
      l[i] = labels[j];
    }
    const a = auc(s, l);
    if (a != null) draws.push(a);
  }
  if (!draws.length) return { lo: null, hi: null };
  draws.sort((x, y) => x - y);
  const at = (q) => draws[Math.min(draws.length - 1, Math.max(0, Math.floor(q * draws.length)))];
  return { lo: at(alpha / 2), hi: at(1 - alpha / 2) };
}

// Precision / recall / F1 at a probability threshold.
function confusionAtThreshold(scores, labels, threshold = 0.5) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (let i = 0; i < labels.length; i += 1) {
    const pred = scores[i] >= threshold ? 1 : 0;
    if (pred && labels[i]) tp += 1;
    else if (pred && !labels[i]) fp += 1;
    else if (!pred && labels[i]) fn += 1;
    else tn += 1;
  }
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  const f1 = precision != null && recall != null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null;
  return { tp, fp, fn, tn, precision, recall, f1 };
}

// Mean binary cross-entropy (a proper scoring rule — lower is better). Clamps to avoid log(0).
function logLoss(scores, labels) {
  if (!labels.length) return null;
  const eps = 1e-9;
  let sum = 0;
  for (let i = 0; i < labels.length; i += 1) {
    const p = Math.min(1 - eps, Math.max(eps, scores[i]));
    sum += labels[i] ? -Math.log(p) : -Math.log(1 - p);
  }
  return sum / labels.length;
}

// Brier score = mean squared error of the probability.
function brier(scores, labels) {
  if (!labels.length) return null;
  let sum = 0;
  for (let i = 0; i < labels.length; i += 1) sum += (scores[i] - labels[i]) ** 2;
  return sum / labels.length;
}

// Reliability-diagram bins: for each probability band, the mean predicted prob vs. the observed rate.
function calibrationBins(scores, labels, nBins = 5) {
  const bins = Array.from({ length: nBins }, () => ({ n: 0, sumP: 0, sumY: 0 }));
  for (let i = 0; i < labels.length; i += 1) {
    const b = Math.min(nBins - 1, Math.floor(scores[i] * nBins));
    bins[b].n += 1;
    bins[b].sumP += scores[i];
    bins[b].sumY += labels[i];
  }
  return bins.map((bin, i) => ({
    band: [i / nBins, (i + 1) / nBins],
    n: bin.n,
    meanPredicted: bin.n ? bin.sumP / bin.n : null,
    observedRate: bin.n ? bin.sumY / bin.n : null,
  }));
}

module.exports = { auc, bootstrapAucCI, confusionAtThreshold, logLoss, brier, calibrationBins, mulberry32 };
