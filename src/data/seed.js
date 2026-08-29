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
const { withAppearance } = require("./chemicalAppearance");
const chemistryPracticalsData = require("./chemistryPracticals");
const physicsPracticalsData = require("./physicsPracticals");
const biologyVisualizationsData = require("./biologyVisualizations");
const BiologyVisualization = require("../models/BiologyVisualization");
const { buildReactantKey } = require("../services/reactionEngine");

// Precomputed textbook lesson/page map (npm run curriculum:sync — see scripts/curriculum/). Optional
// — absent until the sync job has run. Re-seeding wipes Experiment.curriculumRefs, so this file is
// the durable copy that survives a re-seed; the sync job can also be re-run against a fresh DB.
let curriculumRefsMap = {};
try {
  curriculumRefsMap = require("./curriculum/curriculumRefs.generated.json");
  console.log(`📖 Loaded curriculum refs for ${Object.keys(curriculumRefsMap).length} practical(s)`);
} catch {
  console.log("📖 No curriculum refs file (npm run curriculum:sync not run yet) — skipping");
}

// Attaches curriculumRefs (experiment- and step-level) to a resolved practical, by title.
const withCurriculumRefs = (practical) => {
  const entry = curriculumRefsMap[practical.title];
  if (!entry) return practical;
  return {
    ...practical,
    curriculumRefs: entry.experimentRefs || [],
    curriculumRefsGeneratedAt: entry.generatedAt ? new Date(entry.generatedAt) : new Date(),
    steps: (practical.steps || []).map((step) => ({
      ...step,
      curriculumRefs: (entry.steps && entry.steps[String(step.stepId)]) || [],
    })),
  };
};

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
      BiologyVisualization.deleteMany({}),
    ]);
    console.log("🗑️  Cleared existing seed data");

    // Seed Misconceptions
    const misconceptions = await Misconception.insertMany(misconceptionsData);
    console.log(`✅ Seeded ${misconceptions.length} misconceptions`);

    // Seed Concepts
    const concepts = await Concept.insertMany([
      { name: "Density", subject: "Physics", grades: [7, 8, 9, 10, 11], description: "Mass per unit volume of a substance.", simpleExplanation: "How heavy something is for its size. Dense = heavy and small.", relatedMisconceptions: ["PHY_001", "PHY_002", "PHY_015", "PHY_016"], visualizationAvailable: false, keywords: ["mass", "volume", "density"] },
      { name: "Ohm's Law", subject: "Physics", grades: [9, 10, 11], description: "V = IR — voltage equals current times resistance.", simpleExplanation: "More resistance = less current for the same voltage.", relatedMisconceptions: ["PHY_003", "PHY_004", "PHY_017", "PHY_018"], visualizationAvailable: false, visualizationType: "ohms_law", keywords: ["voltage", "current", "resistance"] },
      { name: "Simple Harmonic Motion", subject: "Physics", grades: [10, 11], description: "Periodic motion, such as a pendulum's swing, where the restoring force is proportional to displacement.", simpleExplanation: "A pendulum swings back and forth at a steady rate that depends only on its string length (for small swings) — not on how heavy the bob is or how far you release it.", relatedMisconceptions: ["PHY_010", "PHY_011", "PHY_012"], visualizationAvailable: false, keywords: ["pendulum", "period", "oscillation", "gravity"] },
      { name: "Hooke's Law", subject: "Physics", grades: [10, 11], description: "The extension of a spring is proportional to the force applied to it, within its elastic limit.", simpleExplanation: "The more you pull a spring, the more it stretches — but only up to a point, and in a straight-line proportion.", relatedMisconceptions: ["PHY_013", "PHY_014"], visualizationAvailable: false, keywords: ["spring", "elasticity", "extension", "force"] },
      { name: "Series and Parallel Circuits", subject: "Physics", grades: [10, 11], description: "How current, voltage, and resistance behave differently depending on whether components share one loop (series) or separate branches (parallel).", simpleExplanation: "In series, current is the same everywhere and voltage splits up. In parallel, voltage is the same across each branch and current splits up.", relatedMisconceptions: ["PHY_017", "PHY_018", "PHY_019", "PHY_020"], visualizationAvailable: false, keywords: ["series", "parallel", "resistance", "circuit"] },
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
    // Materialise each chemical's lab appearance (chemicalAppearance.js) onto the doc, so
    // GET /api/chemicals ships it and the observable-state engine can read it server-side.
    const chemicals = await Chemical.insertMany(withAppearance(chemicalsData));
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

    // Attach concept IDs to the original generic (Biology + 2 shallow Chemistry) experiments.
    // The legacy generic Physics entries ("Measuring Density", "Ohm's Law Verification") were
    // removed from experiments.js now that physicsPracticals.js has proper guided replacements.
    const experimentConceptMap = {
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
          const { requiredChemicalsForStepSymbols, microSteps, ...stepRest } = step;
          return {
            ...stepRest,
            requiredChemicalsForStep: (requiredChemicalsForStepSymbols || []).map((symbol) =>
              resolveChemicalSymbol(symbol, practical.title)
            ),
            // Resolve each Current Task's own chemical symbols the same way, one level down.
            microSteps: (microSteps || []).map((microStep) => {
              const { expectedChemicalsForStepSymbols, ...microStepRest } = microStep;
              return {
                ...microStepRest,
                expectedChemicalsForStep: (expectedChemicalsForStepSymbols || []).map((symbol) =>
                  resolveChemicalSymbol(symbol, practical.title)
                ),
              };
            }),
          };
        }),
      };
    });

    // Resolve the curated Physics practicals — same shape as the chemistry resolution above,
    // minus chemical-symbol resolution (physics practicals never populate requiredChemicals).
    const physicsPracticalsToInsert = physicsPracticalsData.map((practical) => {
      const { conceptNames, steps, ...rest } = practical;
      return {
        ...rest,
        requiredChemicals: [],
        reactionId: null,
        relatedConcepts: conceptNames.map((name) => conceptMap[name]).filter(Boolean),
        steps: steps.map((step) => {
          const { microSteps, ...stepRest } = step;
          return {
            ...stepRest,
            requiredChemicalsForStep: [],
            microSteps: (microSteps || []).map((microStep) => ({
              ...microStep,
              expectedChemicalsForStep: [],
            })),
          };
        }),
      };
    });

    const experiments = await Experiment.insertMany(
      [
        ...genericExperimentsToInsert,
        ...chemistryPracticalsToInsert,
        ...physicsPracticalsToInsert,
      ].map(withCurriculumRefs)
    );
    console.log(
      `✅ Seeded ${experiments.length} experiments (${chemistryPracticalsToInsert.length} Chemistry practicals, ${physicsPracticalsToInsert.length} Physics practicals)`
    );

    // Seed Biology Concept Visualizations — a separate collection from Experiment (no bench/
    // equipment/chemical grading involved), so no symbol/ObjectId resolution is needed here.
    const biologyVisualizations = await BiologyVisualization.insertMany(biologyVisualizationsData);
    console.log(`✅ Seeded ${biologyVisualizations.length} Biology concept visualizations`);

    console.log("\n🎉 Database seeded successfully!");
    console.log(`   Misconceptions: ${misconceptions.length}`);
    console.log(`   Concepts: ${concepts.length}`);
    console.log(`   Chemicals: ${chemicals.length}`);
    console.log(`   Reactions: ${reactions.length}`);
    console.log(`   Experiments: ${experiments.length}`);
    console.log(`   Biology visualizations: ${biologyVisualizations.length}`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error("❌ Seed error:", error.message);
    await mongoose.disconnect();
    process.exit(1);
  }
};

seed();
