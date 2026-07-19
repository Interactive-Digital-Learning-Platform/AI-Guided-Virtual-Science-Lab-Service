const express = require("express");
const router = express.Router();
const { getChemicals, getChemicalById } = require("../controllers/chemical.controller");
const { protect } = require("../middleware/auth");

router.use(protect);

router.get("/", getChemicals);
router.get("/:id", getChemicalById);

module.exports = router;
