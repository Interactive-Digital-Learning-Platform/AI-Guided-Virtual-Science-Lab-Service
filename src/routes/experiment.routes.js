const express = require("express");
const router = express.Router();
const { getExperiments, getExperimentById, getExperimentsBySubject, getCompoundBuildTemplate } = require("../controllers/experiment.controller");
const { protect } = require("../middleware/auth");

router.use(protect);

router.get("/", getExperiments);
router.get("/subject/:subject", getExperimentsBySubject);
router.get("/:experimentId/compounds/:compoundId/build-template", getCompoundBuildTemplate);
router.get("/:id", getExperimentById);

module.exports = router;
