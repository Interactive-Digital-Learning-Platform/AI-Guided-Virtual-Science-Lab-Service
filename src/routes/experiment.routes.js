const express = require("express");
const router = express.Router();
const {
  getExperiments,
  getExperimentById,
  getExperimentInfo,
  getExperimentsBySubject,
  getCompoundBuildTemplate,
  getExperimentWalkthrough, // DEV ONLY — remove before shipping
} = require("../controllers/experiment.controller");
const { protect } = require("../middleware/auth");

router.use(protect);

router.get("/", getExperiments);
router.get("/subject/:subject", getExperimentsBySubject);
router.get("/:experimentId/compounds/:compoundId/build-template", getCompoundBuildTemplate);
router.get("/:id/info", getExperimentInfo);
// DEV ONLY — full practical solution for developer testing; responds 404 in production. Remove before shipping.
router.get("/:id/walkthrough", getExperimentWalkthrough);
router.get("/:id", getExperimentById);

module.exports = router;
