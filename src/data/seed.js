require("dotenv").config();
const mongoose = require("mongoose");
const Misconception = require("../models/Misconception");
const Experiment = require("../models/Experiment");
const Concept = require("../models/Concept");
const Chemical = require("../models/Chemical");
const Reaction = require("../models/Reaction");
const misconceptionsData = require("./misconceptions");
const experimentsData = require("./experiments");
const chemicalsData = require("./chemicals");
const reactionsData = require("./reactions");
const chemistryPracticalsData = require("./chemistryPracticals");
const { buildReactantKey } = require("../services/reactionEngine");

const seed = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB");

    // Clear existing data
    await Promise.all([
      Misconception.deleteMany({}),
      Experiment.deleteMany({}),
      Concept.deleteMany({}),
      Chemical.deleteMany({}),
      Reaction.deleteMany({}),
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
      { name: "Reactivity Series of Metals", subject: "Chemistry", grades: [9, 10, 11], description: "The order in which metals react, determining which metal can displace another from a compound.", simpleExplanation: "More reactive metals push less reactive metals out of their compounds.", relatedMisconceptions: ["CHEM_005"], visualizationAvailable: false, keywords: ["metal", "reactivity", "displacement"] },
      { name: "Tests for Gases", subject: "Chemistry", grades: [9, 10, 11], description: "Standard laboratory tests used to identify common gases produced in reactions.", simpleExplanation: "Each gas has a specific test that confirms what it is.", relatedMisconceptions: ["CHEM_004"], visualizationAvailable: false, keywords: ["gas", "carbon dioxide", "limewater", "test"] },
      { name: "Photosynthesis", subject: "Biology", grades: [6, 7, 8], description: "Process by which plants use light energy to make food (glucose) from CO2 and water.", simpleExplanation: "Plants eat sunlight! They use it to make sugar from air and water.", relatedMisconceptions: ["BIO_001", "BIO_003"], visualizationAvailable: true, visualizationType: "photosynthesis", keywords: ["light", "chlorophyll", "glucose", "starch"] },
      { name: "Osmosis", subject: "Biology", grades: [8, 9, 10], description: "Passive movement of water through a semi-permeable membrane from low to high solute concentration.", simpleExplanation: "Water moves on its own from dilute areas to concentrated areas through special membranes.", relatedMisconceptions: ["BIO_002"], visualizationAvailable: false, keywords: ["water", "membrane", "concentration", "passive"] },
    ]);
    console.log(`✅ Seeded ${concepts.length} concepts`);

    // Map concept names to IDs
    const conceptMap = {};
    concepts.forEach((c) => { conceptMap[c.name] = c._id; });

    // Seed Chemicals (needed before experiments/reactions, which reference them)
    const chemicals = await Chemical.insertMany(chemicalsData);
    console.log(`✅ Seeded ${chemicals.length} chemicals`);

    const chemicalMap = {};
    chemicals.forEach((c) => { chemicalMap[c.symbol] = c._id; });

    // Resolve reaction reactant/product symbols to Chemical ObjectIds and compute reactantKey
    const reactionsToInsert = reactionsData.map((rxn) => {
      const reactants = rxn.reactants.map((r) => ({ chemical: chemicalMap[r.symbol], coefficient: r.coefficient }));
      const products = rxn.products.map((p) => ({ chemical: chemicalMap[p.symbol], coefficient: p.coefficient }));

      const missing = [...rxn.reactants, ...rxn.products]
        .map((r) => r.symbol)
        .filter((symbol) => !chemicalMap[symbol]);
      if (missing.length > 0) {
        throw new Error(`Reaction "${rxn.reactionId}" references unknown chemical symbol(s): ${missing.join(", ")}`);
      }

      return { ...rxn, reactants, products, reactantKey: buildReactantKey(reactants.map((r) => r.chemical)) };
    });

    const reactions = await Reaction.insertMany(reactionsToInsert);
    console.log(`✅ Seeded ${reactions.length} reactions`);

    const reactionMap = {};
    reactions.forEach((r) => { reactionMap[r.reactionId] = r._id; });

    // Link buildable compounds (Chemical.isBuildableFromElements: true) to the synthesis
    // reaction the Compound Builder validates attempts against — can't be known until reactions
    // are inserted and have real ObjectIds, so this is a post-insert update pass.
    const buildableCompoundReactions = {
      H2O: "h2o-synthesis",
      MgO: "mg-o2-combustion",
      NaCl: "na-cl2-synthesis",
      CO2: "c-o2-synthesis",
    };
    await Promise.all(
      Object.entries(buildableCompoundReactions).map(([symbol, slug]) =>
        Chemical.updateOne({ symbol }, { buildReactionId: reactionMap[slug] })
      )
    );
    console.log(`✅ Linked ${Object.keys(buildableCompoundReactions).length} buildable compounds to their synthesis reactions`);

    // Attach concept IDs to the original generic (Physics/Biology + 2 shallow Chemistry) experiments
    const experimentConceptMap = {
      "Measuring Density": ["Density"],
      "Ohm's Law Verification": ["Ohm's Law"],
      "Acid-Base Titration": ["Acid-Base Reactions"],
      "Separating Mixtures by Filtration": ["Acid-Base Reactions"],
      "Testing a Leaf for Starch": ["Photosynthesis"],
      "Osmosis in Plant Cells": ["Osmosis"],
    };

    const genericExperimentsToInsert = experimentsData.map((exp) => ({
      ...exp,
      relatedConcepts: (experimentConceptMap[exp.title] || []).map((name) => conceptMap[name]).filter(Boolean),
    }));

    // Resolve the curated Chemistry practicals: chemical symbols -> ObjectIds,
    // reaction slug -> Reaction ObjectId, concept names -> Concept ObjectIds.
    const resolveChemicalSymbol = (symbol, practicalTitle) => {
      const id = chemicalMap[symbol];
      if (!id) throw new Error(`Practical "${practicalTitle}" references unknown chemical symbol: ${symbol}`);
      return id;
    };

    const chemistryPracticalsToInsert = chemistryPracticalsData.map((practical) => {
      const { requiredChemicalSymbols, reactionSlug, conceptNames, steps, ...rest } = practical;

      return {
        ...rest,
        requiredChemicals: requiredChemicalSymbols.map((symbol) => ({
          chemical: resolveChemicalSymbol(symbol, practical.title),
        })),
        reactionId: reactionSlug ? reactionMap[reactionSlug] || null : null,
        relatedConcepts: conceptNames.map((name) => conceptMap[name]).filter(Boolean),
        steps: steps.map((step) => {
          const { requiredChemicalsForStepSymbols, ...stepRest } = step;
          return {
            ...stepRest,
            requiredChemicalsForStep: (requiredChemicalsForStepSymbols || []).map((symbol) =>
              resolveChemicalSymbol(symbol, practical.title)
            ),
          };
        }),
      };
    });

    const experiments = await Experiment.insertMany([...genericExperimentsToInsert, ...chemistryPracticalsToInsert]);
    console.log(`✅ Seeded ${experiments.length} experiments (${chemistryPracticalsToInsert.length} Chemistry practicals)`);

    console.log("\n🎉 Database seeded successfully!");
    console.log(`   Misconceptions: ${misconceptions.length}`);
    console.log(`   Concepts: ${concepts.length}`);
    console.log(`   Chemicals: ${chemicals.length}`);
    console.log(`   Reactions: ${reactions.length}`);
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
