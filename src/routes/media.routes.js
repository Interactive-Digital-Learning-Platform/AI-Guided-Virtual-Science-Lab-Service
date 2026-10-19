const express = require("express");
const router = express.Router();
const { getChemicalArtwork } = require("../controllers/media.controller");

// Intentionally NOT behind `protect` — image requests from the mobile <Image> component can't
// attach the lab JWT, and artwork is non-sensitive curriculum content.
router.get("/chemicals/:id", getChemicalArtwork);

module.exports = router;
