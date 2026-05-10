require("dotenv").config();
const mongoose = require("mongoose");
const Misconception = require("../models/Misconception");
const Experiment = require("../models/Experiment");
const Concept = require("../models/Concept");
const misconceptionsData = require("./misconceptions");
const experimentsData = require("./experiments");

const seed = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB");

    // Clear existing data
    await Promise.all([
      Misconception.deleteMany({}),
      Experiment.deleteMany({}),
      Concept.deleteMany({}),
    ]);
    console.log("🗑️  Cleared existing seed data");

    // Seed Misconceptions
    const misconceptions = await Misconception.insertMany(misconceptionsData);
    console.log(`✅ Seeded ${misconceptions.length} misconceptions`);

    // Seed Concepts
    const concepts = await Concept.insertMany([
      { name: "Density", subject: "Physics", grades: [7, 8, 9], description: "Mass per unit volume of a substance.", simpleExplanation: "How heavy something is for its size. Dense = heavy and small.", relatedMisconceptions: ["PHY_001", "PHY_002"], visualizationAvailable: false, keywords: ["mass", "volume", "density"] },
      { name: "Ohm's Law", subject: "Physics", grades: [9, 10, 11], description: "V = IR — voltage equals current times resistance.", simpleExplanation: "More resistance = less current for the same voltage.", relatedMisconceptions: ["PHY_003", "PHY_004"], visualizationAvailable: false, keywords: ["voltage", "current", "resistance"] },
      { name: "Acid-Base Reactions", subject: "Chemistry", grades: [9, 10, 11], description: "Reactions between acids and bases producing salt and water.", simpleExplanation: "Acids and bases cancel each other out — neutralization.", relatedMisconceptions: ["CHEM_001", "CHEM_002", "CHEM_003"], visualizationAvailable: true, visualizationType: "acid_base", keywords: ["acid", "base", "pH", "neutralization"] },
      { name: "Photosynthesis", subject: "Biology", grades: [6, 7, 8], description: "Process by which plants use light energy to make food (glucose) from CO2 and water.", simpleExplanation: "Plants eat sunlight! They use it to make sugar from air and water.", relatedMisconceptions: ["BIO_001", "BIO_003"], visualizationAvailable: true, visualizationType: "photosynthesis", keywords: ["light", "chlorophyll", "glucose", "starch"] },
      { name: "Osmosis", subject: "Biology", grades: [8, 9, 10], description: "Passive movement of water through a semi-permeable membrane from low to high solute concentration.", simpleExplanation: "Water moves on its own from dilute areas to concentrated areas through special membranes.", relatedMisconceptions: ["BIO_002"], visualizationAvailable: false, keywords: ["water", "membrane", "concentration", "passive"] },
    ]);
    console.log(`✅ Seeded ${concepts.length} concepts`);

    // Map concept names to IDs
    const conceptMap = {};
    concepts.forEach((c) => { conceptMap[c.name] = c._id; });

    // Attach concept IDs to experiments
    const experimentConceptMap = {
      "Measuring Density": ["Density"],
      "Ohm's Law Verification": ["Ohm's Law"],
      "Acid-Base Titration": ["Acid-Base Reactions"],
      "Separating Mixtures by Filtration": ["Acid-Base Reactions"],
      "Testing a Leaf for Starch": ["Photosynthesis"],
      "Osmosis in Plant Cells": ["Osmosis"],
    };

    const experimentsToInsert = experimentsData.map((exp) => ({
      ...exp,
      relatedConcepts: (experimentConceptMap[exp.title] || [])
        .map((name) => conceptMap[name])
        .filter(Boolean),
    }));

    const experiments = await Experiment.insertMany(experimentsToInsert);
    console.log(`✅ Seeded ${experiments.length} experiments`);

    console.log("\n🎉 Database seeded successfully!");
    console.log(`   Misconceptions: ${misconceptions.length}`);
    console.log(`   Concepts: ${concepts.length}`);
    console.log(`   Experiments: ${experiments.length}`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error("❌ Seed error:", error.message);
    await mongoose.disconnect();
    process.exit(1);
  }
};

seed();
