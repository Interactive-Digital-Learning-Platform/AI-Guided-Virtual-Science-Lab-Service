const express = require("express");
const router = express.Router();
const { getBiologyVisualizations, getBiologyVisualizationById } = require("../controllers/biology.controller");
const { protect } = require("../middleware/auth");

router.use(protect);

router.get("/", getBiologyVisualizations);
router.get("/:id", getBiologyVisualizationById);

module.exports = router;
