const express = require("express");
const router = express.Router();
const {
  startSession, submitEquipmentSelection, submitChemicalSelection, submitCompoundBuild,
  logAction, completeSession,
  getSession, getSessionReport, getUserSessions, getSessionStats, requestHint,
} = require("../controllers/session.controller");
const { protect } = require("../middleware/auth");

router.use(protect);

router.post("/start", startSession);
router.get("/stats", getSessionStats);
router.get("/history", getUserSessions);
router.get("/:id", getSession);
router.get("/:id/report", getSessionReport);
router.post("/:id/equipment-selection", submitEquipmentSelection);
router.post("/:id/chemical-selection", submitChemicalSelection);
router.post("/:id/compound-builds", submitCompoundBuild);
router.post("/:id/action", logAction);
router.post("/:id/complete", completeSession);
router.post("/:id/hint", requestHint);

module.exports = router;
