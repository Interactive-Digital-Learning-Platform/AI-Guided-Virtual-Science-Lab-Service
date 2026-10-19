// Impure orchestrator around the pure services/studentModelService.js — loads the inputs it needs
// (bench action log, the signature-bearing Misconception docs, a chemical lookup for the
// category-aware predicates) and returns the posterior snapshot. The controllers call THIS; the
// pure service stays free of mongoose.
//
// Failure is never fatal to the caller: computeForSession returns null (feature off / no lab run /
// nothing to say) and the caller stores null, leaving the legacy path untouched.

const LabRun = require("../models/LabRun");
const Misconception = require("../models/Misconception");
const Chemical = require("../models/Chemical");
const studentModelService = require("./studentModelService");
const flags = require("../config/featureFlags");

// Signatures change only on redeploy / re-seed — cache the KB in-process.
let _signaturesByCode = null;
async function loadSignaturesByCode() {
  if (_signaturesByCode) return _signaturesByCode;
  const docs = await Misconception.find({ "behaviouralSignatures.0": { $exists: true } })
    .select("code title description correctionStrategy relatedConcepts behaviouralSignatures behaviouralPriorLogOdds")
    .lean();
  _signaturesByCode = Object.fromEntries((docs || []).map((d) => [d.code, d]));
  return _signaturesByCode;
}
function __resetCacheForTests() {
  _signaturesByCode = null;
}

/**
 * Build the studentModel snapshot from an already-loaded bench action list (the caller has the
 * LabRun in hand — e.g. logAction, which loaded it for grading — so no extra LabRun query).
 * @param {{ session, experiment, benchActions }} args
 * @returns {Promise<object|null>}
 */
async function computeLive({ session, experiment, benchActions }) {
  if (!flags.isStudentModelEnabled() || !session || !experiment) return null;

  const signaturesByCode = await loadSignaturesByCode();
  if (!Object.keys(signaturesByCode).length) return null;

  // Chemical lookup for the category-aware predicates (reagent-before-indicator, metal displacement).
  const chemIds = new Set();
  for (const a of benchActions || []) for (const c of a.chemicalIds || []) chemIds.add(String(c));
  for (const rc of experiment.requiredChemicals || []) if (rc && rc.chemical) chemIds.add(String(rc.chemical));
  const chemDocs = chemIds.size
    ? await Chemical.find({ _id: { $in: [...chemIds] } }).select("symbol category formula").lean()
    : [];
  const chemicalsById = Object.fromEntries((chemDocs || []).map((c) => [String(c._id), c]));

  return studentModelService.computeStudentModel({
    experiment,
    session,
    benchActions: benchActions || [],
    signaturesByCode,
    chemicalsById,
  });
}

/**
 * Build the studentModel snapshot for a session, loading the bench action log itself.
 * @param {{ session, experiment }} args  session must have .labRunId; experiment must be populated
 * @returns {Promise<object|null>} the snapshot, or null when the feature is off / there's no lab
 *   run / no relevant signatures exist for this practical.
 */
async function computeForSession({ session, experiment }) {
  if (!flags.isStudentModelEnabled() || !session || !session.labRunId || !experiment) return null;
  const labRun = await LabRun.findById(session.labRunId).select("actions").lean();
  if (!labRun) return null;
  return computeLive({ session, experiment, benchActions: labRun.actions || [] });
}

/**
 * diagnose() over a stored snapshot, with the KB text joined back in. Used by the report path in
 * M5; safe to call any time. Returns [] when there's no model or nothing above threshold.
 */
async function diagnoseFromSnapshot(studentModel, threshold) {
  if (!studentModel || !(studentModel.misconceptions || []).length) return [];
  const signaturesByCode = await loadSignaturesByCode();
  return studentModelService.diagnose({ studentModel, signaturesByCode, threshold });
}

module.exports = { computeLive, computeForSession, diagnoseFromSnapshot, loadSignaturesByCode, __resetCacheForTests };
