const mongoose = require("mongoose");

const chemicalSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    symbol: { type: String, required: true, trim: true, unique: true, index: true },
    formula: { type: String, default: null, trim: true }, // null for mixtures without a single formula (e.g. indicators)
    atomicNumber: { type: Number, default: null },
    atomicMass: { type: Number, default: null },
    group: { type: Number, default: null },
    period: { type: Number, default: null },
    electronConfiguration: { type: String, default: null }, // e.g. "2,8,1" — elements only, for the inspect panel
    valency: { type: Number, default: null }, // combining power — elements only, for the inspect panel
    category: {
      type: String,
      enum: ["acid", "base", "salt", "metal", "non-metal", "metalloid", "indicator", "gas", "organic", "oxide"],
      required: true,
      index: true,
    },
    // Distinguishes a raw element (buildable directly onto the bench, first-20-syllabus or not)
    // from a compound (either handed to the student ready-made, or constructible via
    // isBuildableFromElements — see reactionEngine.js / compound-builder endpoints).
    chemicalType: { type: String, enum: ["element", "compound"], required: true, index: true },
    // Compound-only: true iff `buildReactionId` points to a synthesis Reaction whose reactants
    // are all elements within the O/L syllabus's first 20 (atomicNumber <= 20).
    isBuildableFromElements: { type: Boolean, default: false },
    buildReactionId: { type: mongoose.Schema.Types.ObjectId, ref: "Reaction", default: null },
    state: { type: String, enum: ["solid", "liquid", "gas", "aqueous"], required: true },
    color: { type: String, default: "#FFFFFF" }, // hex, used for bottle/liquid tint in UI
    concentration: { type: String, default: null }, // e.g. "1M", "dilute", "concentrated"
    // Curated only for liquid/aqueous chemicals where pH is meaningful — see phService.js, which
    // falls back to a category-based estimate when this is unset. Null for solids/gases/elements.
    phValue: { type: Number, default: null },
    safetyClassification: {
      type: String,
      enum: ["safe", "caution", "hazardous", "corrosive", "flammable", "toxic"],
      default: "safe",
    },
    hazardInfo: [{ type: String }],
    commonUses: [{ type: String }],
    iconKey: { type: String, default: null }, // maps to a mobile-side sprite/asset key
    // Remote illustration for this element/compound. Storage-agnostic reference only — never the
    // binary itself. `provider` decides how mediaService turns it into a public URL:
    //   "minio"     -> streamed through GET /api/media/chemicals/:id (object lives in `key`)
    //   "s3"/"cloudinary" -> `url` is a ready public/CDN URL, served to the client as-is
    // The mobile app only ever receives the resolved `imageUrl` string (see chemical.controller),
    // so moving the binary to S3/Cloudinary later is a backend-only change.
    artwork: {
      provider: { type: String, enum: ["minio", "s3", "cloudinary", null], default: null },
      key: { type: String, default: null }, // object key within the media bucket (minio/s3)
      url: { type: String, default: null }, // absolute CDN/public URL (s3 public / cloudinary)
      altText: { type: String, default: null },
      width: { type: Number, default: null },
      height: { type: Number, default: null },
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

chemicalSchema.index({ name: "text", symbol: "text" });

module.exports = mongoose.model("Chemical", chemicalSchema);
