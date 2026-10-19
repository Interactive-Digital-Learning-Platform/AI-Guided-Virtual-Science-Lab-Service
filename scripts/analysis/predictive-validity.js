/*
 * Study 1 (dev-docs/implementation-plan-student-model.md §7.2): does the model's misconception
 * posterior have predictive validity for the concept-inventory post-test?
 *
 * For every misconception code with enough labelled examples, compares the AUC of:
 *   model       — the final posterior probability for that code
 *   model½      — the posterior from the FIRST HALF of the session's action log
 *   rules       — 1 if the legacy rule engine flagged that code, else 0
 *   errorRate   — the session's overall error rate (a "generic struggle" baseline)
 *   1−score     — inverse of the final score (another generic baseline)
 * against the post-test label (student holds misconception k: 1/0).
 *
 *   node scripts/analysis/predictive-validity.js sessions.json
 *   node scripts/analysis/predictive-validity.js sessions.csv --labels labels.csv
 *   node scripts/analysis/predictive-validity.js sessions.json --min-n 12 --threshold 0.55
 *
 * No database — operates purely on the export from export-sessions.js.
 */
const { readExport, applyLabels } = require("./lib/io");
const { auc, bootstrapAucCI, confusionAtThreshold, logLoss, brier } = require("./lib/metrics");

const { parseArgs } = require("./lib/args");
const { _: positionals, labels: labelsPath, "min-n": minNRaw, threshold: thrRaw } = parseArgs(process.argv.slice(2), ["labels", "min-n", "threshold"]);
const exportPath = positionals[0];
const minN = parseInt(minNRaw || "10", 10);
const threshold = parseFloat(thrRaw || "0.55");

if (!exportPath) {
  console.error("usage: node scripts/analysis/predictive-validity.js <sessions.json|csv> [--labels labels.csv] [--min-n N] [--threshold P]");
  process.exit(1);
}

const records = readExport(exportPath);
if (labelsPath) {
  const { matched } = applyLabels(records, labelsPath);
  console.log(`joined labels for ${matched}/${records.length} sessions from ${labelsPath}\n`);
}

// Which codes have enough labelled sessions?
const codeCounts = {};
for (const r of records) {
  for (const [code, label] of Object.entries(r.labels || {})) {
    if (label == null) continue;
    codeCounts[code] = codeCounts[code] || { n: 0, pos: 0 };
    codeCounts[code].n += 1;
    codeCounts[code].pos += label ? 1 : 0;
  }
}
const codes = Object.entries(codeCounts)
  .filter(([, c]) => c.n >= minN && c.pos >= 2 && c.pos <= c.n - 2)
  .map(([code]) => code)
  .sort();

if (!codes.length) {
  console.log(`No misconception has >= ${minN} labelled sessions with both classes present.`);
  console.log(`Label counts: ${JSON.stringify(codeCounts)}`);
  console.log(`\nFill label_<CODE> in the export (or supply --labels) from the concept-inventory post-test, then re-run.`);
  process.exit(0);
}

const fmt = (x) => (x == null ? "  -  " : x.toFixed(3));
const pad = (s, n) => String(s).padEnd(n);

console.log(pad("code", 16) + ["n", "pos", "AUC model", "[95% CI]", "AUC model½", "AUC rules", "AUC errRate", "AUC 1-score", "F1@thr", "logloss", "brier"].map((h) => pad(h, 12)).join(""));
console.log("-".repeat(16 + 12 * 11));

const summary = [];
for (const code of codes) {
  const rows = records.filter((r) => r.labels && r.labels[code] != null);
  const labels = rows.map((r) => (r.labels[code] ? 1 : 0));

  const pModel = rows.map((r) => r.posterior?.[code] ?? 0);
  const pHalf = rows.map((r) => r.posteriorFirstHalf?.[code] ?? r.posterior?.[code] ?? 0);
  const pRules = rows.map((r) => ((r.ruleMisconceptions || []).includes(code) ? 1 : 0));
  const pErr = rows.map((r) => r.errorRate ?? 0);
  const pScore = rows.map((r) => 1 - (r.score ?? 100) / 100);

  const aucModel = auc(pModel, labels);
  const ci = bootstrapAucCI(pModel, labels);
  const conf = confusionAtThreshold(pModel, labels, threshold);

  const c = codeCounts[code];
  console.log(
    pad(code, 16) +
      [
        c.n,
        c.pos,
        fmt(aucModel),
        ci.lo == null ? "  -  " : `${ci.lo.toFixed(2)}–${ci.hi.toFixed(2)}`,
        fmt(auc(pHalf, labels)),
        fmt(auc(pRules, labels)),
        fmt(auc(pErr, labels)),
        fmt(auc(pScore, labels)),
        fmt(conf.f1),
        fmt(logLoss(pModel, labels)),
        fmt(brier(pModel, labels)),
      ].map((v) => pad(v, 12)).join("")
  );
  summary.push({ code, n: c.n, aucModel, aucRules: auc(pRules, labels) });
}

console.log("-".repeat(16 + 12 * 11));
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const wins = summary.filter((s) => s.aucModel != null && s.aucRules != null && s.aucModel > s.aucRules).length;
console.log(
  `mean AUC — model ${fmt(mean(summary.map((s) => s.aucModel).filter((x) => x != null)))}  ` +
    `vs rules ${fmt(mean(summary.map((s) => s.aucRules).filter((x) => x != null)))}   ` +
    `(model beats rules on ${wins}/${summary.length} codes)`
);
console.log(`threshold for F1 = ${threshold}; min labelled n = ${minN}`);
