// Feature flags for the Bayesian misconception student model (dev-docs/implementation-plan-student-model.md §3.4).
//
//   STUDENT_MODEL_ENABLED=true          -> compute + persist Session.studentModel (SHADOW MODE:
//                                          the model runs but the old rule engine still drives
//                                          every hint and every report the student sees).
//   STUDENT_MODEL_DRIVES_HINTS=true     -> (M5) posterior-driven intervention timing + hint content,
//                                          for `treatment`-arm sessions only.
//   STUDENT_MODEL_DRIVES_DIAGNOSIS=true -> (M5) posterior becomes the report's misconception section,
//                                          for `treatment`-arm sessions only.
//
// Read as functions (not module-load constants) so a test / a runtime toggle takes effect without
// re-requiring. Flags are OFF unless explicitly "true"/"1".
const crypto = require("crypto");

const truthy = (v) => v === "true" || v === "1";

const isStudentModelEnabled = () => truthy(process.env.STUDENT_MODEL_ENABLED);

// Stable per-USER 50/50 assignment (a student stays in one arm across all their attempts, so the
// two arms never contaminate each other). "off" whenever the feature is disabled.
const experimentArmForUser = (userId) => {
  if (!isStudentModelEnabled()) return "off";
  const firstByte = crypto.createHash("md5").update(String(userId)).digest()[0];
  return firstByte < 128 ? "control" : "treatment";
};

const studentModelDrivesHints = (session) =>
  isStudentModelEnabled() && truthy(process.env.STUDENT_MODEL_DRIVES_HINTS) && session?.experimentArm === "treatment";

const studentModelDrivesDiagnosis = (session) =>
  isStudentModelEnabled() && truthy(process.env.STUDENT_MODEL_DRIVES_DIAGNOSIS) && session?.experimentArm === "treatment";

module.exports = {
  isStudentModelEnabled,
  experimentArmForUser,
  studentModelDrivesHints,
  studentModelDrivesDiagnosis,
};
