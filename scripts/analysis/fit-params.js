/*
 * Calibrate the behavioural-signature parameters against labelled data
 * (dev-docs/implementation-plan-student-model.md §5.6, M6).
 *
 * Coordinate-ascent search over per-code prior log-odds and per-predicate log-likelihood ratios,
 * maximising mean cross-validated AUC of the posterior vs. the concept-inventory post-test labels.
 * Prints a before/after comparison and a ready-to-paste block for src/data/misconceptions.js.
 *
 * Needs the RAW action logs, so run export with --full:
 *   node scripts/analysis/export-sessions.js --full -o full.json
 *   node scripts/analysis/fit-params.js full.json --labels labels.csv
 *   node scripts/analysis/fit-params.js full.json --folds 5 --passes 3
 *
 * No database — operates on the --full export. Does NOT write to the KB; you review and apply.
 */
const { readExport, applyLabels } = require("./lib/io");
const { auc, mulberry32 } = require("./lib/metrics");
const { parseArgs } = require("./lib/args");

// Deterministic Fisher–Yates so CV folds don't line up with the data's natural ordering.
function seededShuffle(arr, seed = 1234) {
  const rng = mulberry32(seed);
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

process.env.STUDENT_MODEL_ENABLED = "true";
const studentModelService = require("../../src/services/studentModelService");
const misconceptions = require("../../src/data/misconceptions");

const a = parseArgs(process.argv.slice(2), ["labels", "folds", "passes", "min-n"]);
const exportPath = a._[0];
const labelsPath = a.labels;
const folds = parseInt(a.folds || "5", 10);
const passes = parseInt(a.passes || "3", 10);
const minN = parseInt(a["min-n"] || "12", 10);

if (!exportPath) {
  console.error("usage: node scripts/analysis/fit-params.js <full-export.json> [--labels labels.csv] [--folds 5] [--passes 3]");
  process.exit(1);
}

const records = readExport(exportPath).filter((r) => Array.isArray(r.benchActions) && r.benchActions.length);
if (!records.length) {
  console.error("No records with raw benchActions — re-export with --full.");
  process.exit(1);
}
if (labelsPath) applyLabels(records, labelsPath);

// The authored KB, as the mutable parameter set we search over.
const signaturesByCode = Object.fromEntries(
  misconceptions
    .filter((m) => (m.behaviouralSignatures || []).length)
    .map((m) => [m.code, {
      code: m.code,
      behaviouralSignatures: m.behaviouralSignatures,
      behaviouralPriorLogOdds: m.behaviouralPriorLogOdds ?? null,
    }])
);

// Codes with enough labelled examples + both classes present.
const labelledCounts = {};
for (const r of records) for (const [code, l] of Object.entries(r.labels || {})) {
  if (l == null) continue;
  labelledCounts[code] = labelledCounts[code] || { n: 0, pos: 0 };
  labelledCounts[code].n += 1;
  labelledCounts[code].pos += l ? 1 : 0;
}
const targetCodes = Object.entries(labelledCounts)
  .filter(([, c]) => c.n >= minN && c.pos >= 2 && c.pos <= c.n - 2)
  .map(([code]) => code);

if (!targetCodes.length) {
  console.log(`No code has >= ${minN} labelled sessions with both classes. Counts: ${JSON.stringify(labelledCounts)}`);
  process.exit(0);
}

// Every experiment shape / session shell needed to replay computeStudentModel from a record.
// The export doesn't carry the full experiment; reconstruct the minimum the model reads.
function shellFor(rec) {
  return {
    experiment: {
      subject: rec.subject,
      commonMisconceptions: rec.relevantCodes || [],
      requiredChemicals: [],
      steps: [{ stepId: 1, misconceptionRisks: rec.relevantCodes || [], microSteps: [] }],
    },
    session: { currentStep: 1, currentMicroStep: 1, stepProgress: [] },
    benchActions: rec.benchActions,
  };
}
// NOTE: replays without the task timeline / chemical lookup the live path has, so absolute
// probabilities here differ slightly from production — fine for RELATIVE parameter comparison,
// which is all the fit needs. (For exact reproduction, extend the export to carry experiment.steps
// + a chemicals map.)

function meanCvAuc(paramOverrides) {
  const perCode = {};
  for (const code of targetCodes) {
    const rows = seededShuffle(records.filter((r) => r.labels && r.labels[code] != null), 20260830);
    if (rows.length < folds) continue;
    const aucs = [];
    for (let f = 0; f < folds; f += 1) {
      const test = rows.filter((_, i) => i % folds === f);
      const bothClasses = new Set(test.map((r) => (r.labels[code] ? 1 : 0))).size === 2;
      if (test.length < 3 || !bothClasses) continue;
      const scores = [];
      const labels = [];
      for (const rec of test) {
        const model = studentModelService.computeStudentModel({ ...shellFor(rec), signaturesByCode, paramOverrides });
        const p = (model.misconceptions.find((m) => m.code === code) || {}).probability ?? 0;
        scores.push(p);
        labels.push(rec.labels[code] ? 1 : 0);
      }
      const val = auc(scores, labels);
      if (val != null) aucs.push(val);
    }
    if (aucs.length) perCode[code] = aucs.reduce((x, y) => x + y, 0) / aucs.length;
  }
  const vals = Object.values(perCode);
  return { mean: vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : 0, perCode };
}

const PRIOR_GRID = [-2.0, -1.6, -1.3, -1.0, -0.7, -0.4];
const LLR_GRID = [0.6, 0.9, 1.1, 1.3, 1.5, 1.8, 2.2];

const predicatesFor = (code) => (signaturesByCode[code].behaviouralSignatures || []).map((s) => s.predicate);

const overrides = { priors: {}, llr: {} };
for (const code of targetCodes) {
  overrides.priors[code] = signaturesByCode[code].behaviouralPriorLogOdds ?? -1.0;
  for (const p of predicatesFor(code)) {
    const sig = signaturesByCode[code].behaviouralSignatures.find((s) => s.predicate === p);
    overrides.llr[p] = sig.logLikelihoodRatio ?? 1.0;
  }
}

const before = meanCvAuc(null);
console.log(`baseline (authored params): mean CV AUC = ${before.mean.toFixed(3)}`);
console.log(`  per code: ${Object.entries(before.perCode).map(([k, v]) => `${k} ${v.toFixed(2)}`).join("  ")}\n`);

let best = meanCvAuc(overrides).mean;
for (let pass = 0; pass < passes; pass += 1) {
  for (const code of targetCodes) {
    for (const val of PRIOR_GRID) {
      const trial = { priors: { ...overrides.priors, [code]: val }, llr: { ...overrides.llr } };
      const m = meanCvAuc(trial).mean;
      if (m > best) { best = m; overrides.priors[code] = val; }
    }
    for (const p of predicatesFor(code)) {
      for (const val of LLR_GRID) {
        const trial = { priors: { ...overrides.priors }, llr: { ...overrides.llr, [p]: val } };
        const m = meanCvAuc(trial).mean;
        if (m > best) { best = m; overrides.llr[p] = val; }
      }
    }
  }
  console.log(`pass ${pass + 1}: mean CV AUC = ${best.toFixed(3)}`);
}

const after = meanCvAuc(overrides);
console.log(`\nfitted: mean CV AUC = ${after.mean.toFixed(3)}  (baseline ${before.mean.toFixed(3)}, Δ ${(after.mean - before.mean).toFixed(3)})`);
console.log(`  per code: ${Object.entries(after.perCode).map(([k, v]) => `${k} ${v.toFixed(2)}`).join("  ")}`);

console.log("\n--- proposed parameters (review before editing src/data/misconceptions.js) ---");
for (const code of targetCodes) {
  console.log(`${code}:`);
  console.log(`  behaviouralPriorLogOdds: ${overrides.priors[code]}`);
  for (const p of predicatesFor(code)) console.log(`  ${p}.logLikelihoodRatio: ${overrides.llr[p]}`);
}
