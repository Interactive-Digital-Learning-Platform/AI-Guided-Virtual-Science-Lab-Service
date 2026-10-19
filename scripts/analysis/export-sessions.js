/*
 * Export completed sessions for offline analysis of the Bayesian misconception model
 * (dev-docs/implementation-plan-student-model.md §7, M6). READ ONLY.
 *
 * Each record: anonymised identity, session performance summary, the RULE misconception list, the
 * MODEL posterior (final + from the first half of the action log), the divergence flag, and an
 * empty `label_<CODE>` slot per relevant misconception to be filled from the concept-inventory
 * post-test (§7.1) — either edit the file, or keep a separate labels CSV and join it in
 * predictive-validity.js / fit-params.js with --labels.
 *
 *   node scripts/analysis/export-sessions.js                         -> sessions.json (cwd)
 *   node scripts/analysis/export-sessions.js --csv -o out/x.csv
 *   node scripts/analysis/export-sessions.js --practical "Acid-Base Neutralization" --arm treatment
 *   node scripts/analysis/export-sessions.js --since 2026-09-01 --min-actions 5
 *   node scripts/analysis/export-sessions.js --full                  -> also embeds raw benchActions
 */
require("dotenv").config();
const mongoose = require("mongoose");
const { collectSessions } = require("./lib/sessionData");
const { writeOut } = require("./lib/io");
const { parseArgs } = require("./lib/args");

const a = parseArgs(process.argv.slice(2), ["o", "out", "arm", "since", "practical", "limit", "min-actions"]);
const csv = !!a.csv;
const full = !!a.full;
const outPath = a.o || a.out || (csv ? "sessions.csv" : "sessions.json");
const filters = {
  arm: a.arm,
  since: a.since,
  practical: a.practical,
  limit: a.limit ? parseInt(a.limit, 10) : undefined,
  minActions: a["min-actions"] ? parseInt(a["min-actions"], 10) : undefined,
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB || undefined });

  const records = await collectSessions(filters);
  if (!full) records.forEach((r) => delete r.benchActions);

  writeOut(outPath, records, { csv });

  const labelled = records.filter((r) => Object.values(r.labels || {}).some((v) => v != null)).length;
  console.log(`exported ${records.length} session(s) -> ${outPath}${csv ? " (csv)" : ""}${full ? " (with raw action logs)" : ""}`);
  console.log(`  ${labelled} already carry post-test labels; the rest need label_<CODE> filled from the concept inventory`);
  const byArm = records.reduce((m, r) => ((m[r.arm] = (m[r.arm] || 0) + 1), m), {});
  console.log(`  by arm: ${Object.entries(byArm).map(([k, v]) => `${k}=${v}`).join("  ")}`);

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
