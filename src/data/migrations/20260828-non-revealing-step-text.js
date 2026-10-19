/*
 * Reconciles the STUDENT-FACING instructional text of every practical in the DB with the seed
 * data, so Main Step titles / instructions and Current Task prompts state the scientific GOAL and
 * never hand the student the answer (exact equipment, chemical, transfer tool, circuit placement,
 * or result-before-observation). Expected-observation bullets are softened the same way.
 *
 *   node src/data/migrations/20260828-non-revealing-step-text.js            # dry run (shows every diff)
 *   node src/data/migrations/20260828-non-revealing-step-text.js --apply
 *
 * This run is scoped by the SPEC to Chemistry: only the Chemistry entries in chemistryPracticals.js
 * and experiments.js carry rewritten text. Physics and Biology seed text is unchanged — so if the
 * DB has drifted from it (e.g. an earlier over-broad run), this migration also RESTORES those
 * practicals to their original seed text. It is a pure reconcile (seed -> DB), direction-agnostic
 * and idempotent.
 *
 * ONLY these fields are ever written:
 *   Experiment.description
 *   Experiment.expectedObservations
 *   Experiment.steps[].title
 *   Experiment.steps[].instruction
 *   Experiment.steps[].microSteps[].studentPrompt
 *
 * NOTHING else is touched — grading stays byte-for-byte identical:
 *   steps[].requiredEquipment / requiredChemicalsForStep / expectedAction / exactAnswer /
 *   observationGoal, microSteps[].expectedEquipment / expectedChemicalsForStep / expectedIntent /
 *   expectedTransfer / expectedMeasurement / exactAnswer / hints — untouched. The mobile
 *   field-exclusion selects (experiment.controller.js / session.controller.js) are unchanged, so
 *   the client still receives no hidden-answer fields.
 *
 * Steps/microSteps are matched by stepId / microStepId; a practical whose structure has drifted
 * from the seed has its missing units reported and skipped, never guessed.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Experiment = require("../../models/Experiment");
const chemistryPracticals = require("../chemistryPracticals");
const physicsPracticals = require("../physicsPracticals");
const experiments = require("../experiments");

const APPLY = process.argv.includes("--apply");
const line = () => console.log("-".repeat(72));

const SEED = [...chemistryPracticals, ...physicsPracticals, ...experiments];

const norm = (v) => (v == null ? "" : String(v));
const arrEq = (a = [], b = []) => a.length === b.length && a.every((x, i) => norm(x) === norm(b[i]));

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB || undefined });
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY RUN"}\n`);

  let practicalsChanged = 0;
  let fieldChanges = 0;
  const notFound = [];
  const structureSkips = [];

  for (const seed of SEED) {
    const doc = await Experiment.findOne({ title: seed.title });
    if (!doc) {
      notFound.push(seed.title);
      continue;
    }

    const changes = [];

    if (seed.description && norm(doc.description) !== norm(seed.description)) {
      changes.push(["description", doc.description, seed.description]);
      doc.description = seed.description;
    }

    if (Array.isArray(seed.expectedObservations) && !arrEq(doc.expectedObservations, seed.expectedObservations)) {
      changes.push(["expectedObservations", JSON.stringify(doc.expectedObservations), JSON.stringify(seed.expectedObservations)]);
      doc.expectedObservations = seed.expectedObservations;
    }

    for (const sStep of seed.steps || []) {
      const dStep = (doc.steps || []).find((s) => s.stepId === sStep.stepId);
      if (!dStep) {
        structureSkips.push(`${seed.title} · step ${sStep.stepId} (no matching stepId in DB)`);
        continue;
      }
      if (sStep.title && norm(dStep.title) !== norm(sStep.title)) {
        changes.push([`step ${sStep.stepId} · title`, dStep.title, sStep.title]);
        dStep.title = sStep.title;
      }
      if (sStep.instruction && norm(dStep.instruction) !== norm(sStep.instruction)) {
        changes.push([`step ${sStep.stepId} · instruction`, dStep.instruction, sStep.instruction]);
        dStep.instruction = sStep.instruction;
      }
      for (const sMs of sStep.microSteps || []) {
        const dMs = (dStep.microSteps || []).find((m) => m.microStepId === sMs.microStepId);
        if (!dMs) {
          structureSkips.push(`${seed.title} · step ${sStep.stepId} · task ${sMs.microStepId} (no matching microStepId in DB)`);
          continue;
        }
        if (sMs.studentPrompt && norm(dMs.studentPrompt) !== norm(sMs.studentPrompt)) {
          changes.push([`step ${sStep.stepId} · task ${sMs.microStepId} · studentPrompt`, dMs.studentPrompt, sMs.studentPrompt]);
          dMs.studentPrompt = sMs.studentPrompt;
        }
      }
    }

    if (changes.length === 0) continue;

    practicalsChanged += 1;
    fieldChanges += changes.length;
    line();
    console.log(`${seed.title}  (${seed.subject})`);
    line();
    for (const [field, before, after] of changes) {
      console.log(`  ${field}`);
      console.log(`    -  ${before}`);
      console.log(`    +  ${after}`);
    }
    console.log();

    if (APPLY) {
      doc.markModified("steps");
      doc.markModified("expectedObservations");
      await doc.save();
    }
  }

  line();
  console.log(`${APPLY ? "Applied" : "Would change"}: ${fieldChanges} field(s) across ${practicalsChanged} practical(s).`);
  if (notFound.length) console.log(`Not found in DB (skipped): ${notFound.join(", ")}`);
  if (structureSkips.length) {
    console.log(`Structure mismatches (skipped, not guessed):`);
    structureSkips.forEach((s) => console.log(`  - ${s}`));
  }
  if (!APPLY) console.log(`\nRe-run with --apply to write these changes.`);

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
