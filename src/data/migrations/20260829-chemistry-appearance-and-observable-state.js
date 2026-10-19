/*
 * Additive migration — Chemistry liquid/appearance system (spec: "Critical Fix — Chemistry Liquid
 * Colours and Reaction Colour Changes").
 *
 *   1. Backfills `Chemical.appearance` (solutionColor / opacity / phase / texture) on every
 *      chemical that doesn't have it yet, from src/data/chemicalAppearance.js (explicit table +
 *      category/state fallback). Never changes `Chemical.color` (card artwork tint) or `symbol`.
 *   2. Recomputes `LabRun.equipment[].observableState` for every ACTIVE lab run, so an in-flight
 *      session immediately renders correct liquid colours (indicator results included) without
 *      the student having to re-do an action.
 *
 * Nothing is deleted. Idempotent — re-running only fills gaps / refreshes derived state.
 *
 *   node src/data/migrations/20260829-chemistry-appearance-and-observable-state.js            # dry run
 *   node src/data/migrations/20260829-chemistry-appearance-and-observable-state.js --apply
 *   node src/data/migrations/20260829-chemistry-appearance-and-observable-state.js --apply --runs-only
 *   node src/data/migrations/20260829-chemistry-appearance-and-observable-state.js --apply --chemicals-only
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Chemical = require("../../models/Chemical");
const LabRun = require("../../models/LabRun");
const { appearanceFor } = require("../chemicalAppearance");
const { computeObservableState, observableStateChanged } = require("../../services/appearanceService");

const APPLY = process.argv.includes("--apply");
const RUNS_ONLY = process.argv.includes("--runs-only");
const CHEMS_ONLY = process.argv.includes("--chemicals-only");
const line = () => console.log("-".repeat(64));

async function backfillChemicals() {
  const chemicals = await Chemical.find({}).lean();
  let planned = 0;
  const ops = [];
  for (const c of chemicals) {
    if (c.appearance && c.appearance.solutionColor) continue;
    const appearance = appearanceFor(c);
    planned++;
    console.log(`  ${c.symbol.padEnd(10)} → ${appearance.solutionColor}  op:${appearance.opacity}  ${appearance.phase}`);
    ops.push({ updateOne: { filter: { _id: c._id }, update: { $set: { appearance } } } });
  }
  console.log(`\n  ${planned} chemical(s) need appearance backfilled.`);
  if (APPLY && ops.length) {
    await Chemical.bulkWrite(ops);
    console.log(`  ✅ wrote ${ops.length}.`);
  }
}

async function recomputeActiveRuns() {
  const runs = await LabRun.find({ status: "active" });
  const chemicals = await Chemical.find({}).lean();
  const chemicalsById = Object.fromEntries(chemicals.map((c) => [c._id.toString(), c]));

  let changedInstances = 0;
  let touchedRuns = 0;
  for (const run of runs) {
    let runTouched = false;
    for (const inst of run.equipment || []) {
      if (!Array.isArray(inst.contents)) continue;
      const previous = inst.observableState?.toObject?.() ?? inst.observableState ?? null;
      // No reaction context available retroactively — the colour is derived from current contents
      // (indicator + pH, dominant chemical). Precipitate products already sit in contents as solids.
      const next = computeObservableState({ contents: inst.contents, chemicalsById, reaction: null, previous });
      next.lastChangedAt = observableStateChanged(previous, next) ? new Date() : previous?.lastChangedAt ?? null;
      if (observableStateChanged(previous, next) || !previous) {
        inst.observableState = next;
        changedInstances++;
        runTouched = true;
      }
    }
    if (runTouched) {
      touchedRuns++;
      if (APPLY) await run.save();
    }
  }
  console.log(`\n  ${changedInstances} container instance(s) across ${touchedRuns} active run(s) ${APPLY ? "updated" : "would update"}.`);
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  line();
  console.log(`Chemistry appearance + observable-state migration · ${APPLY ? "APPLY (writing)" : "DRY RUN"}`);
  line();

  if (!RUNS_ONLY) {
    console.log("\n[1] Chemical.appearance backfill");
    await backfillChemicals();
  }
  if (!CHEMS_ONLY) {
    console.log("\n[2] Active LabRun observableState recompute");
    await recomputeActiveRuns();
  }

  line();
  console.log("  • Chemical.color / symbol: UNTOUCHED. Reactions / practicals / sessions: UNTOUCHED.");
  console.log("  • No deletes.");
  line();
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("\n❌ Migration failed:", err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
