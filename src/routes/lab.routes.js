const express = require("express");
const router = express.Router();
const {
  startLabRun, getLabRun, logLabAction,
  mixChemicals, completeLabRun, askTutor,
} = require("../controllers/labRun.controller");
const { protect } = require("../middleware/auth");

router.use(protect);

router.post("/runs", startLabRun);
router.get("/runs/:id", getLabRun);
router.post("/runs/:id/action", logLabAction);
router.post("/runs/:id/mix", mixChemicals);
router.post("/runs/:id/complete", completeLabRun);
router.post("/runs/:id/tutor", askTutor);

module.exports = router;
