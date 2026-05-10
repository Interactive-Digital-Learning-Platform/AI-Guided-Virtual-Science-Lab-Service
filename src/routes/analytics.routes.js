const express = require("express");
const router = express.Router();
const { getMyAnalytics, getSessionAnalytics } = require("../controllers/analytics.controller");
const { protect } = require("../middleware/auth");

router.use(protect);

router.get("/me", getMyAnalytics);
router.get("/session/:id", getSessionAnalytics);

module.exports = router;
