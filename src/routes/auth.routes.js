const express = require("express");
const router = express.Router();
const { syncUser, getMe, updateGrade } = require("../controllers/auth.controller");
const { protect } = require("../middleware/auth");

router.post("/sync", syncUser);
router.get("/me", protect, getMe);
router.patch("/grade", protect, updateGrade);

module.exports = router;
