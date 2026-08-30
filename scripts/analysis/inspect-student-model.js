/*
 * Shadow-mode inspection tool (dev-docs/implementation-plan-student-model.md §5). Recomputes the
 * Bayesian misconception posterior for completed session(s) straight from the bench action log and
 * prints it next to what the legacy rule engine concluded — so you can eyeball whether the model
 * moves sensibly before flipping STUDENT_MODEL_DRIVES_* on for the pilot.
 *
 *   node scripts/analysis/inspect-student-model.js <sessionId>
 *   node scripts/analysis/inspect-student-model.js --recent 15          # last 15 completed sessions
 *   node scripts/analysis/inspect-student-model.js --recent 15 --json   # machine-readable dump
 *
 * READ ONLY — never writes to the database. Forces the feature on for its own run regardless of
 * the STUDENT_MODEL_ENABLED env flag.
 */
require("dotenv").config();
process.env.STUDENT_MODEL_ENABLED = "true";

const mongoose = require("mongoose");
const Session = require("../../src/models/Session");
require("../../src/models/Experiment");
require("../../src/models/LabRun");
require("../../src/models/Chemical");
require("../../src/models/Misconception");
const runner = require("../../src/services/studentModelRunner");

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const recentIdx = args.indexOf("--recent");
const recentN = recentIdx !== -1 ? parseInt(args[recentIdx + 1], 10) || 10 : null;
const sessionId = args.find((a) => !a.startsWith("--") && a !== String(recentN));

const pct = (p) => `${(p * 100).toFixed(1)}%`;
const line = () => console.log("-".repeat(78));

async function inspectOne(session) {
  const experiment = session.experimentId;
  const fresh = await runner.computeForSession({ session, experiment });
  const stored = session.studentModel || null;
  const dx = fresh ? await runner.diagnoseFromSnapshot(fresh) : [];

  if (asJson) {
    return {
      sessionId: String(session._id),
      practical: experiment?.title || null,
      arm: session.experimentArm,
      score: session.score,
      ruleMisconceptions: (session.aiFeedback?.misconceptionsDetected || []).map((m) => m.code),
      storedShadowRuleMisconceptions: stored?.shadowRuleMisconceptions || [],
      modelDiagnosis: dx.map((d) => ({ code: d.code, probability: d.probability })),
      modelPosterior: (fresh?.misconceptions || []).map((m) => ({ code: m.code, probability: m.probability, evidence: m.evidence.length })),
      storedMatchesFresh: JSON.stringify(stored?.misconceptions || []) === JSON.stringify(fresh?.misconceptions || []),
    };
  }

  line();
  console.log(`session ${session._id}   ${experiment?.title || "?"}   arm=${session.experimentArm}   score=${session.score}`);
  line();
  if (!fresh) {
    console.log("  (no model — feature off / no lab run / no relevant signatures)");
    return null;
  }
  console.log(`  cluster: ${fresh.cluster}   actions replayed: ${fresh.computedFromActionCount}`);
  console.log(
    `  sub-goal: onTask=${pct(fresh.subGoal.onTaskProbability)}${fresh.subGoal.divergenceFlag ? "  ⚠ DIVERGENCE" : ""}`
  );
  console.log(`  RULE engine said:  ${(session.aiFeedback?.misconceptionsDetected || []).map((m) => m.code).join(", ") || "(none)"}`);
  console.log(`  MODEL diagnosis:   ${dx.map((d) => `${d.code} ${pct(d.probability)}`).join(", ") || "(none above threshold)"}`);
  console.log("  full posterior:");
  for (const m of fresh.misconceptions) {
    const bar = "#".repeat(Math.round(m.probability * 20)).padEnd(20, ".");
    console.log(`    ${m.code.padEnd(14)} ${bar} ${pct(m.probability)}   (${m.evidence.length} evidence)`);
    for (const e of m.evidence.slice(0, 3)) {
      console.log(`        · action#${e.actionIndex} step ${e.stepId}/${e.microStepId ?? "-"}  ${e.predicate}  Δ${e.deltaLogOdds}`);
    }
  }
  if (stored) {
    const same = JSON.stringify(stored.misconceptions) === JSON.stringify(fresh.misconceptions);
    console.log(`  stored snapshot ${same ? "matches" : "DIFFERS FROM"} fresh recompute`);
  } else {
    console.log("  (no stored snapshot on this session — completed before shadow mode was on)");
  }
  return null;
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB || undefined });

  let sessions;
  if (sessionId) {
    const s = await Session.findById(sessionId).populate("experimentId").lean();
    if (!s) {
      console.error(`session ${sessionId} not found`);
      await mongoose.disconnect();
      process.exit(1);
    }
    sessions = [s];
  } else {
    sessions = await Session.find({ status: "completed" })
      .sort({ updatedAt: -1 })
      .limit(recentN || 10)
      .populate("experimentId")
      .lean();
  }

  const out = [];
  for (const s of sessions) {
    const row = await inspectOne(s);
    if (row) out.push(row);
  }
  if (asJson) console.log(JSON.stringify(out, null, 2));
  else {
    line();
    console.log(`${sessions.length} session(s) inspected. (read-only — nothing written)`);
  }

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
