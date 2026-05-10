const express = require("express");
const router = express.Router();
const Session = require("../models/Session");
const { protect } = require("../middleware/auth");

router.use(protect);

// GET /api/feedback/:sessionId
router.get("/:sessionId", async (req, res, next) => {
  try {
    const session = await Session.findById(req.params.sessionId)
      .populate("experimentId", "title subject difficulty")
      .select("aiFeedback score totalTime behaviorFeatures status experimentId createdAt")
      .lean();

    if (!session) return res.status(404).json({ success: false, message: "Session not found." });
    if (session.status !== "completed")
      return res.status(400).json({ success: false, message: "Feedback only available for completed sessions." });

    res.status(200).json({ success: true, data: session });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
