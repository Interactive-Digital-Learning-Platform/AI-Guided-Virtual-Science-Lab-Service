/**
 * Additive migration — first-20 elements + remote artwork.
 *
 * DOES NOT delete or reseed anything. Safe to run against a live database with existing
 * sessions / reactions / experiments. Idempotent: re-running only fills gaps.
 *
 *   node src/data/migrations/20260827-first20-elements-and-artwork.js                 # dry run
 *   node src/data/migrations/20260827-first20-elements-and-artwork.js --apply         # insert missing elements
 *   node src/data/migrations/20260827-first20-elements-and-artwork.js --apply --rename # + tidy "… Gas" display names
 *   node src/data/migrations/20260827-first20-elements-and-artwork.js --apply --rename --images "C:\path\to\elements_images"
 *
 * What it can do (each step prints a plan first; nothing is written without --apply):
 *   1. Insert any of the first 20 elements missing from the Chemical collection (matched by
 *      atomicNumber — the elements the original seed already created are left untouched).
 *   2. --rename : change the DISPLAY NAME only of "Hydrogen Gas"/"Oxygen Gas"/"Chlorine Gas"
 *      to "Hydrogen"/"Oxygen"/"Chlorine". The `symbol` field ("H2"/"O2"/"Cl2") is NEVER changed,
 *      so reactions / practicals / grading are unaffected.
 *   3. --images <dir> : upload each element PNG to object storage (MinIO by default) and set the
 *      `artwork` reference on the matching Chemical. Files are matched by the symbol in the
 *      filename, e.g. "Sodium__Na_-removebg-preview.png" -> the element whose symbol reduces to "Na".
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const Chemical = require("../../models/Chemical");
const mediaService = require("../../services/mediaService");
const ELEMENTS_FIRST_20 = require("../elements-first20");

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const DO_RENAME = argv.includes("--rename");
const imagesInline = argv.find((a) => a.startsWith("--images="));
const imagesIdx = argv.indexOf("--images");
const IMAGES_DIR = imagesInline ? imagesInline.split("=")[1] : imagesIdx !== -1 ? argv[imagesIdx + 1] : null;

// "H2" -> "H", "Cl2" -> "Cl", "Na" -> "Na"  (element display symbol)
const cleanSymbol = (s) => String(s || "").replace(/[0-9]+$/, "");

// Loose identifier for matching an image filename to a chemical: lowercase, alphanumerics only.
// "Ca(OH)2" -> "caoh2", "Hydrochloric Acid" -> "hydrochloricacid", "HCl" -> "hcl".
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Pull the name/symbol candidates out of a "<Name>__<Symbol>_-removebg-preview.png" style filename
// (falls back to the whole basename when there's no "__").
const filenameCandidates = (file) => {
  const base = path.basename(file, path.extname(file));
  const parts = base.split("__");
  if (parts.length >= 2) return [parts[0], parts[1].split(/[-_. ]/)[0]];
  return [parts[0].split(/[-_. ]/)[0], base];
};

const RENAMES = [
  { symbol: "H2", name: "Hydrogen" },
  { symbol: "O2", name: "Oxygen" },
  { symbol: "Cl2", name: "Chlorine" },
];

const line = () => console.log("-".repeat(64));

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set (.env).");
  await mongoose.connect(process.env.MONGODB_URI);

  line();
  console.log("First-20 elements + artwork migration");
  console.log(APPLY ? "MODE: APPLY — changes WILL be written" : "MODE: DRY RUN — no changes (pass --apply to write)");
  line();

  const elements = await Chemical.find({ chemicalType: "element" }).lean();
  const presentAtomic = new Set(elements.filter((e) => e.atomicNumber != null).map((e) => e.atomicNumber));
  console.log(`Existing element records: ${elements.length}`);
  console.log(`  ${elements.map((e) => `${e.symbol}${e.atomicNumber != null ? `(${e.atomicNumber})` : ""}`).join(", ")}`);

  // 1. Insert missing first-20 elements ----------------------------------------------------------
  line();
  const missing = ELEMENTS_FIRST_20.filter((e) => !presentAtomic.has(e.atomicNumber));
  console.log(`STEP 1 — first-20 elements present: ${20 - missing.length}/20`);
  if (missing.length === 0) {
    console.log("  nothing to insert.");
  } else {
    console.log(`  will insert ${missing.length}: ${missing.map((e) => `${e.symbol}(${e.atomicNumber})`).join(", ")}`);
    if (APPLY) {
      const docs = missing.map((e) => ({ ...e, chemicalType: "element", isActive: true }));
      const inserted = await Chemical.insertMany(docs, { ordered: false }).catch((err) => {
        console.warn(`  ⚠ some inserts failed: ${err.message}`);
        return err.insertedDocs || [];
      });
      console.log(`  ✅ inserted ${inserted.length}`);
    }
  }

  // 2. Tidy display names (never touches `symbol`) ----------------------------------------------
  line();
  console.log(`STEP 2 — display-name tidy  (${DO_RENAME ? "enabled" : "skipped — pass --rename"})`);
  for (const r of RENAMES) {
    const doc = await Chemical.findOne({ symbol: r.symbol }).lean();
    if (!doc) {
      console.log(`  ${r.symbol}: not found — skip`);
      continue;
    }
    if (doc.name === r.name) {
      console.log(`  ${r.symbol}: already "${r.name}"`);
      continue;
    }
    console.log(`  ${r.symbol}: "${doc.name}" -> "${r.name}"`);
    if (APPLY && DO_RENAME) {
      await Chemical.updateOne({ _id: doc._id }, { $set: { name: r.name } });
      console.log("    ✅ renamed");
    }
  }

  // 3. Upload artwork -------------------------------------------------------------------------------
  line();
  if (!IMAGES_DIR) {
    console.log("STEP 3 — artwork upload: skipped (no --images <dir>)");
  } else if (!fs.existsSync(IMAGES_DIR)) {
    console.log(`STEP 3 — artwork upload: directory not found: ${IMAGES_DIR}`);
  } else if (!["minio", "s3"].includes(mediaService.PROVIDER)) {
    console.log(`STEP 3 — artwork upload: MEDIA_PROVIDER="${mediaService.PROVIDER}" not supported by this script (use minio/s3, or upload to Cloudinary separately and set artwork.url).`);
  } else {
    console.log(`STEP 3 — artwork upload from: ${IMAGES_DIR}  (provider: ${mediaService.PROVIDER}, bucket: ${mediaService.BUCKET})`);
    console.log(`  matches element AND compound images — file named "<Name>__<Symbol>_...", e.g.`);
    console.log(`  "Sodium__Na_-removebg-preview.png", "Hydrochloric Acid__HCl_.png", "Water__H2O_.png"\n`);
    const files = fs.readdirSync(IMAGES_DIR).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));

    // Match a filename to any chemical (element or compound) by normalised name / symbol / formula.
    const all = await Chemical.find({}).lean();
    const lookup = new Map();
    const register = (raw, chem) => {
      const k = norm(raw);
      if (k && !lookup.has(k)) lookup.set(k, chem);
    };
    for (const c of all) {
      register(c.symbol, c);
      register(c.name, c);
      if (c.formula) register(c.formula, c);
      if (c.chemicalType === "element") register(cleanSymbol(c.symbol), c); // "H2" -> "h"
    }

    const keyFor = (chem, ext) => {
      const folder = chem.chemicalType === "element" ? "elements" : "compounds";
      const slug = chem.chemicalType === "element" ? norm(cleanSymbol(chem.symbol)) : norm(chem.symbol);
      return `chemicals/${folder}/${slug}${ext}`;
    };

    let planned = 0;
    let uploaded = 0;
    let skipped = 0;

    for (const file of files) {
      const chem = filenameCandidates(file).map((c) => lookup.get(norm(c))).find(Boolean) || null;
      if (!chem) {
        console.log(`  ${file}: no matching chemical — skip`);
        skipped++;
        continue;
      }
      const ext = path.extname(file).toLowerCase() || ".png";
      const key = keyFor(chem, ext);
      const already = chem.artwork && chem.artwork.key === key;
      console.log(`  ${file}  ->  ${chem.name} (${chem.symbol}) [${chem.chemicalType}]   key=${key}${already ? "   [already set]" : ""}`);
      planned++;
      if (APPLY) {
        const buffer = fs.readFileSync(path.join(IMAGES_DIR, file));
        await mediaService.putObject(key, buffer, "image/png");
        await Chemical.updateOne(
          { _id: chem._id },
          {
            $set: {
              artwork: {
                provider: mediaService.PROVIDER,
                key,
                url: null,
                altText: `${chem.name} (${chem.symbol}) illustration`,
                width: null,
                height: null,
              },
            },
          }
        );
        uploaded++;
      }
    }
    console.log(APPLY ? `\n  ✅ uploaded ${uploaded}, skipped ${skipped}` : `\n  (dry run) would upload ${planned}, skip ${skipped}`);
  }

  // Summary --------------------------------------------------------------------------------------
  line();
  console.log("SUMMARY");
  console.log("  • No documents deleted. No collection dropped. No reseed.");
  console.log("  • Reactions, experiments, practicals, sessions and history: UNTOUCHED.");
  console.log("  • Every chemical's `symbol` field: UNCHANGED (only display `name` may change with --rename).");
  console.log(APPLY ? "  • Changes were written." : "  • Dry run — nothing was written.");
  line();

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("\n❌ Migration failed:", err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
