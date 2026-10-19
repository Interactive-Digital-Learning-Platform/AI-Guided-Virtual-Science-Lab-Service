const Chemical = require("../models/Chemical");
const mediaService = require("../services/mediaService");

// GET /api/media/chemicals/:id  — PUBLIC (an <Image> request carries no auth header).
// Serves the element/compound artwork: streamed from object storage for minio/S3-backed refs,
// or a redirect to the CDN URL for cloudinary/public-S3-backed ones. The bucket itself stays
// private — this endpoint is the only way in.
const getChemicalArtwork = async (req, res, next) => {
  try {
    const chemical = await Chemical.findById(req.params.id).select("artwork").lean();
    const artwork = chemical && chemical.artwork;
    if (!artwork || !artwork.provider) {
      return res.status(404).json({ success: false, message: "No artwork for this material." });
    }

    if (artwork.url) {
      return res.redirect(302, artwork.url);
    }

    const { stream, contentType, contentLength } = await mediaService.getObject(artwork.key);
    res.set("Content-Type", contentType);
    if (contentLength != null) res.set("Content-Length", String(contentLength));
    res.set("Cache-Control", "public, max-age=604800, immutable");
    stream.on("error", next);
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
};

module.exports = { getChemicalArtwork };
