// Shared: pull completed sessions from Mongo and turn each into a self-contained analysis record
// (identity hashed, bench action log included, the student-model posterior recomputed fresh — plus
// a "first half" posterior from replaying only the first half of the action log, for the
// predictive-validity study). No file I/O here — the callers (export-sessions / fit-params) own that.

const crypto = require("crypto");
process.env.STUDENT_MODEL_ENABLED = "true"; // force the feature on for offline analysis

const Session = require("../../../src/models/Session");
require("../../../src/models/Experiment");
require("../../../src/models/LabRun");
require("../../../src/models/Chemical");
require("../../../src/models/Misconception");
const LabRun = require("../../../src/models/LabRun");
const Chemical = require("../../../src/models/Chemical");
const runner = require("../../../src/services/studentModelRunner");
const studentModelService = require("../../../src/services/studentModelService");

const anonId = (id) => crypto.createHash("sha256").update(String(id)).digest("hex").slice(0, 12);

async function loadChemicalsById(labRunActions, experiment) {
  const ids = new Set();
  for (const a of labRunActions || []) for (const c of a.chemicalIds || []) ids.add(String(c));
  for (const rc of experiment.requiredChemicals || []) if (rc && rc.chemical) ids.add(String(rc.chemical));
  const docs = ids.size
    ? await Chemical.find({ _id: { $in: [...ids] } }).select("symbol category formula").lean()
    : [];
  return Object.fromEntries(docs.map((c) => [String(c._id), c]));
}

// Recompute the posterior from a PREFIX of the action log (fraction 0..1 of the actions), so Study 1
// can ask "does the mid-session diagnosis predict later errors / the post-test".
function posteriorFromPrefix({ experiment, session, benchActions, signaturesByCode, chemicalsById, fraction, paramOverrides }) {
  const cut = Math.max(1, Math.floor(benchActions.length * fraction));
  const model = studentModelService.computeStudentModel({
    experiment,
    session,
    benchActions: benchActions.slice(0, cut),
    signaturesByCode,
    chemicalsById,
    paramOverrides,
  });
  return Object.fromEntries((model.misconceptions || []).map((m) => [m.code, m.probability]));
}

/**
 * @param {object} opts  { arm, since, practical, limit, minActions } — all optional filters
 * @param {object} [paramOverrides]  passed through to computeStudentModel (fit-params only)
 * @returns {Promise<Array>} one analysis record per completed session
 */
async function collectSessions(opts = {}, paramOverrides = null) {
  const q = { status: "completed" };
  if (opts.arm) q.experimentArm = opts.arm;
  if (opts.since) q.updatedAt = { $gte: new Date(opts.since) };

  let query = Session.find(q).sort({ updatedAt: -1 }).populate("experimentId");
  if (opts.limit) query = query.limit(opts.limit);
  const sessions = await query.lean();

  const signaturesByCode = await runner.loadSignaturesByCode();
  const out = [];

  for (const session of sessions) {
    const experiment = session.experimentId;
    if (!experiment) continue;
    if (opts.practical && experiment.title !== opts.practical) continue;
    if (!session.labRunId) continue;

    const labRun = await LabRun.findById(session.labRunId).select("actions").lean();
    const benchActions = (labRun && labRun.actions) || [];
    if (opts.minActions && benchActions.length < opts.minActions) continue;

    const chemicalsById = await loadChemicalsById(benchActions, experiment);
    // Annotate each action with the task it was performed under, so a later offline replay
    // (fit-params) reproduces this attribution without the full experiment/session.
    const annotatedActions = studentModelService.annotateActionsWithTask({ experiment, session, benchActions });
    const full = studentModelService.computeStudentModel({
      experiment,
      session,
      benchActions: annotatedActions,
      signaturesByCode,
      chemicalsById,
      paramOverrides,
    });

    const posteriorFull = Object.fromEntries((full.misconceptions || []).map((m) => [m.code, m.probability]));
    const posteriorHalf = annotatedActions.length >= 4
      ? posteriorFromPrefix({ experiment, session, benchActions: annotatedActions, signaturesByCode, chemicalsById, fraction: 0.5, paramOverrides })
      : posteriorFull;

    const bf = session.behaviorFeatures || {};
    out.push({
      sessionId: String(session._id),
      user: anonId(session.userId),
      practical: experiment.title,
      subject: experiment.subject,
      cluster: full.cluster,
      arm: session.experimentArm || "off",
      attemptNumber: session.attemptNumber || 1,
      completedAt: session.endTime || session.updatedAt || null,

      score: session.score,
      performanceScore: session.performanceScore ?? session.score,
      timeScore: session.timeScore ?? null,
      totalActiveTime: session.totalActiveTime ?? 0,
      errorRate: bf.errorRate ?? 0,
      totalErrors: bf.totalErrors ?? 0,
      totalHints: bf.totalHintsRequested ?? 0,
      struggledSteps: (bf.struggledSteps || []).length,
      actionCount: benchActions.length,

      // The comparison targets.
      ruleMisconceptions:
        session.studentModel?.shadowRuleMisconceptions ||
        (session.aiFeedback?.misconceptionsDetected || []).map((m) => m.code).filter(Boolean),
      relevantCodes: (full.misconceptions || []).map((m) => m.code),
      posterior: posteriorFull,
      posteriorFirstHalf: posteriorHalf,
      modelDiagnosis: (full.misconceptions || []).filter((m) => m.probability >= 0.55).map((m) => m.code),
      divergenceFlag: !!full.subGoal?.divergenceFlag,

      // Task-annotated raw log — only kept when --full is passed (fit-params needs it; export omits
      // it by default). The _task* fields let the offline replay reproduce task attribution.
      benchActions: annotatedActions,

      // Post-test labels: left null. Fill from the concept inventory (see --labels join / §7.1).
      // One key per relevant misconception: label_<CODE> ∈ {0,1}.
      labels: Object.fromEntries((full.misconceptions || []).map((m) => [m.code, null])),
    });
  }
  return out;
}

module.exports = { collectSessions, anonId };
