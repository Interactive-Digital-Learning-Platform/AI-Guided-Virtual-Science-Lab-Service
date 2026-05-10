const express = require("express");
const router = express.Router();
const {
  startSession, logAction, completeSession,
  getSession, getUserSessions, requestHint,
} = require("../controllers/session.controller");
const { protect } = require("../middleware/auth");

router.use(protect);

router.post("/start", startSession);
router.get("/history", getUserSessions);
router.get("/:id", getSession);
router.post("/:id/action", logAction);
router.post("/:id/complete", completeSession);
router.post("/:id/hint", requestHint);

module.exports = router;
