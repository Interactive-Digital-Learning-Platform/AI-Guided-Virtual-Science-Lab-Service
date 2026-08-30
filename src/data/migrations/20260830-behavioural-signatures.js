/*
 * Reconciles Misconception.behaviouralSignatures[] and Misconception.behaviouralPriorLogOdds in the
 * DB with the seed data (src/data/misconceptions.js). These feed the Bayesian misconception model
 * (services/studentModelService.js — see dev-docs/implementation-plan-student-model.md). Pure
 * reconcile (seed -> DB), keyed by `code`, idempotent.
 *
 *   node src/data/migrations/20260830-behavioural-signatures.js            # dry run (shows diffs)
 *   node src/data/migrations/20260830-behavioural-signatures.js --apply
 *
 * ONLY these two fields are ever written:
 *   Misconception.behaviouralSignatures
 *   Misconception.behaviouralPriorLogOdds
 *
 * Nothing else on the Misconception doc is touched, and no other collection is read or written.
 * Codes present in the DB but not in the seed are left alone; codes in the seed but not the DB are
 * reported and skipped (never inserted — that's seed.js's job).
 *
 * Not needed right after `npm run seed` (the seed already carries these fields). Run it against a
 * live DB whose misconceptions predate this feature.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Misconception = require("../../models/Misconception");
const seedMisconceptions = require("../misconceptions");

const APPLY = process.argv.includes("--apply");
const line = () => console.log("-".repeat(72));

// Compare only the authored fields, order-independent-safe (arrays are authored in a fixed order).
const sigKey = (s) =>
  JSON.stringify({
    whenIntent: [...(s.whenIntent || [])].sort(),
    predicate: s.predicate,
    evidenceType: s.evidenceType || "commission",
    logLikelihoodRatio: s.logLikelihoodRatio ?? 1.0,
    source: s.source || "",
  });
const sigsEqual = (a = [], b = []) =>
  a.length === b.length && a.map(sigKey).sort().join("|") === b.map(sigKey).sort().join("|");

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB || undefined });
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY RUN"}\n`);

  let changed = 0;
  const missing = [];

  for (const seed of seedMisconceptions) {
    const seedSigs = seed.behaviouralSignatures || [];
    const seedPrior = seed.behaviouralPriorLogOdds ?? null;
    // Nothing authored for this code — skip (don't clear anything).
    if (seedSigs.length === 0 && seedPrior === null) continue;

    const doc = await Misconception.findOne({ code: seed.code });
    if (!doc) {
      missing.push(seed.code);
      continue;
    }

    const diffs = [];
    if (!sigsEqual(doc.behaviouralSignatures, seedSigs)) {
      diffs.push([
        "behaviouralSignatures",
        `${(doc.behaviouralSignatures || []).length} sig(s)`,
        `${seedSigs.length} sig(s): ${seedSigs.map((s) => s.predicate).join(", ")}`,
      ]);
      doc.behaviouralSignatures = seedSigs;
    }
    if ((doc.behaviouralPriorLogOdds ?? null) !== seedPrior) {
      diffs.push(["behaviouralPriorLogOdds", String(doc.behaviouralPriorLogOdds ?? null), String(seedPrior)]);
      doc.behaviouralPriorLogOdds = seedPrior;
    }

    if (diffs.length === 0) continue;

    changed += 1;
    line();
    console.log(`${seed.code}  ${seed.title}`);
    line();
    for (const [field, before, after] of diffs) {
      console.log(`  ${field}`);
      console.log(`    -  ${before}`);
      console.log(`    +  ${after}`);
    }
    console.log();

    if (APPLY) {
      doc.markModified("behaviouralSignatures");
      await doc.save();
    }
  }

  line();
  console.log(`${APPLY ? "Applied" : "Would change"}: ${changed} misconception(s).`);
  if (missing.length) console.log(`In seed but not in DB (skipped — run npm run seed): ${missing.join(", ")}`);
  if (!APPLY) console.log(`\nRe-run with --apply to write these changes.`);

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
