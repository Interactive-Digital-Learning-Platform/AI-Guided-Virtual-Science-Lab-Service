/*
 * Additive migration — turns the "add universal indicator" micro-steps of "Testing Acids and Bases"
 * into instrument-required transfer tasks (expectedTransfer). After this, those tasks are satisfied
 * only by a real dropper `dispense` of Universal Indicator into a container (see
 * liquidTransferService.js + session.controller.js's transfer grading branch) — dragging the
 * indicator bottle straight in no longer completes them.
 *
 *   node src/data/migrations/20260828-transfer-testing-acids-bases.js            # dry run
 *   node src/data/migrations/20260828-transfer-testing-acids-bases.js --apply
 *   node src/data/migrations/20260828-transfer-testing-acids-bases.js --apply --revert
 *
 * ⚠  Do NOT --apply on a live/demo DB until the mobile Dropper interaction (Phase-1 mobile) ships —
 *    until then students would have no way to perform the required dispense and the practical would
 *    be unfinishable. This only edits Experiment.steps[].microSteps[].expectedTransfer; nothing is
 *    deleted, no other practical/reaction/session/LabRun data is touched.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Experiment = require("../../models/Experiment");
const Chemical = require("../../models/Chemical");

const APPLY = process.argv.includes("--apply");
const REVERT = process.argv.includes("--revert");
const line = () => console.log("-".repeat(64));

// (stepId, microStepId) pairs that add universal indicator with a dropper.
const TARGETS = [
  { stepId: 1, microStepId: 4 },
  { stepId: 2, microStepId: 2 },
  { stepId: 3, microStepId: 2 },
];

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  line();
  console.log(`Transfer migration — "Testing Acids and Bases"`);
  console.log(`MODE: ${REVERT ? "REVERT" : "SET"} · ${APPLY ? "APPLY (writing)" : "DRY RUN"}`);
  line();

  const ui = await Chemical.findOne({ symbol: "UI" }).select("_id name").lean();
  if (!ui) throw new Error('Chemical with symbol "UI" (Universal Indicator) not found — seed chemicals first.');
  console.log(`source chemical: ${ui.name} (${ui._id})`);

  const exp = await Experiment.findOne({ title: "Testing Acids and Bases", subject: "Chemistry" });
  if (!exp) throw new Error('Experiment "Testing Acids and Bases" not found.');

  let changed = 0;
  for (const { stepId, microStepId } of TARGETS) {
    const step = exp.steps.find((s) => s.stepId === stepId);
    const ms = step?.microSteps?.find((m) => m.microStepId === microStepId);
    if (!ms) {
      console.log(`  step ${stepId} / task ${microStepId}: NOT FOUND — skip`);
      continue;
    }
    if (REVERT) {
      ms.expectedTransfer = { method: null, instrumentCategory: null, sourceChemical: null, minDispenses: 1 };
      console.log(`  step ${stepId} / task ${microStepId}: cleared expectedTransfer`);
    } else {
      // Capability, not a hard-coded instrument type — any "small_quantity_transfer" tool works.
      ms.expectedTransfer = { method: "small_quantity_transfer", instrumentCategory: null, sourceChemical: ui._id, minDispenses: 2 };
      console.log(`  step ${stepId} / task ${microStepId}: "${ms.studentPrompt}"  →  small_quantity_transfer · ${ui.name} · ≥2 drops`);
    }
    changed++;
  }

  if (APPLY && changed) {
    exp.markModified("steps");
    await exp.save();
    console.log(`\n  ✅ wrote ${changed} micro-step(s).`);
  } else {
    console.log(`\n  ${APPLY ? "nothing to write." : `dry run — would change ${changed} micro-step(s).`}`);
  }

  line();
  console.log("  • Only Experiment.steps[].microSteps[].expectedTransfer touched.");
  console.log("  • No deletes. Reactions / other practicals / sessions / LabRuns: UNTOUCHED.");
  line();
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("\n❌ Migration failed:", err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
