// scripts/analysis/lib — the pure evaluation metrics + the CSV round-trip. These carry the
// predictive-validity study's numbers, so they get real tests even though the scripts don't ship.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const { auc, confusionAtThreshold, logLoss, brier, calibrationBins, bootstrapAucCI } = require("../../scripts/analysis/lib/metrics");
const { parseArgs } = require("../../scripts/analysis/lib/args");
const { toCsv, readExport } = require("../../scripts/analysis/lib/io");

test("auc — perfect, inverse, tie, chance", () => {
  assert.equal(auc([0.9, 0.8, 0.2, 0.1], [1, 1, 0, 0]), 1);
  assert.equal(auc([0.1, 0.2, 0.8, 0.9], [1, 1, 0, 0]), 0);
  assert.equal(auc([0.5, 0.5], [1, 0]), 0.5, "ties score 0.5");
  assert.equal(auc([0.6, 0.4, 0.6, 0.4], [1, 1, 0, 0]), 0.5);
});

test("auc — one class empty → null", () => {
  assert.equal(auc([0.9, 0.8], [1, 1]), null);
  assert.equal(auc([], []), null);
});

test("auc — known partial-order case", () => {
  // pos {0.7, 0.4}, neg {0.5, 0.3}: pairs (0.7>0.5,0.7>0.3,0.4<0.5,0.4>0.3) = 3/4
  assert.equal(auc([0.7, 0.4, 0.5, 0.3], [1, 1, 0, 0]), 0.75);
});

test("confusionAtThreshold — precision / recall / f1", () => {
  const c = confusionAtThreshold([0.9, 0.6, 0.4, 0.1], [1, 0, 1, 0], 0.5);
  assert.equal(c.tp, 1);
  assert.equal(c.fp, 1);
  assert.equal(c.fn, 1);
  assert.equal(c.tn, 1);
  assert.equal(c.precision, 0.5);
  assert.equal(c.recall, 0.5);
  assert.equal(c.f1, 0.5);
});

test("logLoss / brier — perfect vs. worst", () => {
  assert.ok(logLoss([0.999, 0.001], [1, 0]) < 0.01);
  assert.ok(logLoss([0.001, 0.999], [1, 0]) > 5);
  assert.equal(brier([1, 0], [1, 0]), 0);
  assert.equal(brier([0, 1], [1, 0]), 1);
});

test("calibrationBins — mean predicted vs observed rate per band", () => {
  const bins = calibrationBins([0.1, 0.15, 0.85, 0.9], [0, 0, 1, 1], 2);
  assert.equal(bins[0].n, 2);
  assert.equal(bins[0].observedRate, 0);
  assert.equal(bins[1].n, 2);
  assert.equal(bins[1].observedRate, 1);
});

test("bootstrapAucCI — deterministic, brackets the point estimate", () => {
  const scores = [0.9, 0.85, 0.8, 0.7, 0.3, 0.25, 0.2, 0.1];
  const labels = [1, 1, 1, 1, 0, 0, 0, 0];
  const ci1 = bootstrapAucCI(scores, labels, { seed: 7, iters: 500 });
  const ci2 = bootstrapAucCI(scores, labels, { seed: 7, iters: 500 });
  assert.deepEqual(ci1, ci2, "same seed -> same CI");
  assert.ok(ci1.lo <= 1 && ci1.hi <= 1 && ci1.lo <= ci1.hi);
});

test("parseArgs — value flags, bare flags, positionals", () => {
  const a = parseArgs(["sessions.json", "--labels", "l.csv", "--csv", "--min-n", "12", "-o", "out.json"], ["labels", "min-n", "o"]);
  assert.deepEqual(a._, ["sessions.json"]);
  assert.equal(a.labels, "l.csv");
  assert.equal(a.csv, true);
  assert.equal(a["min-n"], "12");
  assert.equal(a.o, "out.json");
});

test("io — CSV round-trips posterior / half / label columns", () => {
  const records = [
    {
      sessionId: "s1", user: "u", practical: "P", subject: "Chemistry", cluster: "acid_base", arm: "treatment",
      attemptNumber: 1, completedAt: new Date().toISOString(), score: 80, performanceScore: 82, timeScore: null,
      totalActiveTime: 200, errorRate: 0.2, totalErrors: 3, totalHints: 1, struggledSteps: 1, actionCount: 20,
      divergenceFlag: false, ruleMisconceptions: ["CHEM_002"], modelDiagnosis: ["CHEM_002"],
      posterior: { CHEM_002: 0.71, CHEM_004: 0.3 }, posteriorFirstHalf: { CHEM_002: 0.55, CHEM_004: 0.28 },
      labels: { CHEM_002: 1, CHEM_004: null },
    },
  ];
  const file = path.join(os.tmpdir(), `mtest-${Date.now()}.csv`);
  fs.writeFileSync(file, toCsv(records));
  const back = readExport(file);
  fs.unlinkSync(file);

  assert.equal(back.length, 1);
  assert.equal(back[0].sessionId, "s1");
  assert.equal(back[0].posterior.CHEM_002, 0.71);
  assert.equal(back[0].posteriorFirstHalf.CHEM_004, 0.28);
  assert.equal(back[0].labels.CHEM_002, 1);
  assert.equal(back[0].labels.CHEM_004, null);
  assert.deepEqual(back[0].ruleMisconceptions, ["CHEM_002"]);
});
