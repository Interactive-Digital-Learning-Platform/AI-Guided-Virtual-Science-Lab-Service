// Legacy generic experiments (Biology and two early Chemistry practicals) predating the guided
// equipment/chemical-selection flow — none of these steps carry requiredEquipment/
// requiredChemicalsForStep, so there isn't enough structure here to safely derive Current Task
// (microStep) decompositions without guessing at a procedure that isn't actually encoded in this
// data. They intentionally have no `microSteps` and run on the micro-step engine's whole-step
// fallback path (see resolveGradingTarget in session.controller.js) — functionally identical to
// how they behaved before this feature existed. They're also already excluded from the guided
// catalog (see getExperimentsBySubject's "requiredEquipment.0": {$exists:true} filter). Migrating
// these to real Current Tasks would require authoring the missing requiredEquipment/
// requiredChemicalsForStep data first — out of scope here, flagged rather than guessed.
//
// The two legacy generic Physics entries that used to live here ("Measuring Density", "Ohm's Law
// Verification") were removed once physicsPracticals.js added proper guided replacements covering
// the same subject matter (see seed.js) — keeping both would leave two differently-shaped
// experiments with the same real-world topic in the database.
const experiments = [
  {
    title: "Acid-Base Titration",
    subject: "Chemistry",
    grades: [10, 11],
    difficulty: "hard",
    estimatedTime: 40,
    description: "Determine the concentration of an acid by titrating it against a base of known concentration.",
    objectives: ["Set up apparatus for controlled delivery", "Add a way to detect the endpoint", "Titrate to the endpoint", "Calculate concentration"],
    materials: ["Burette", "Conical flask", "Pipette", "HCl solution", "NaOH solution", "Phenolphthalein indicator", "Retort stand"],
    thumbnailColor: "#E74C3C",
    commonMisconceptions: ["CHEM_001", "CHEM_002", "CHEM_003"],
    steps: [
      { stepId: 1, title: "Prepare the Delivery Apparatus", instruction: "Prepare the apparatus for controlled, gradual delivery of the reacting solution, and set it to its starting reading.", expectedAction: "fill_burette", actionType: "setup", timeLimit: 120, misconceptionRisks: ["CHEM_001"], hints: [{ level: 1, text: "Always rinse glassware with the solution you'll fill it with." }, { level: 2, text: "Fill the burette above 0, then drain to the 0 ml mark." }, { level: 3, text: "Remove any air bubble at the burette tip before recording." }] },
      { stepId: 2, title: "Measure the Acid Sample", instruction: "Accurately transfer a fixed 25 mL volume of the acid into a suitable reaction flask.", expectedAction: "pipette_acid", actionType: "measure", timeLimit: 90, misconceptionRisks: ["CHEM_001"], hints: [{ level: 1, text: "Use a pipette filler — never mouth pipette acids." }, { level: 2, text: "Fill to exactly the 25 ml mark, reading at eye level." }, { level: 3, text: "Touch the tip of the pipette to the flask wall to release the last drop." }] },
      { stepId: 3, title: "Add a Way to Detect the Endpoint", instruction: "Add a few drops of a substance that will signal when the reaction reaches its endpoint.", expectedAction: "add_indicator", actionType: "add", timeLimit: 60, misconceptionRisks: ["CHEM_002"], hints: [{ level: 1, text: "Add indicator after the acid, not before." }, { level: 2, text: "Phenolphthalein is colorless in acid — this is correct!" }, { level: 3, text: "The solution should be colorless at this stage." }] },
      { stepId: 4, title: "Record the Starting Reading", instruction: "Record the starting reading of your delivery apparatus before you begin adding anything.", expectedAction: "record_initial", actionType: "record", timeLimit: 30, misconceptionRisks: [], hints: [{ level: 1, text: "Read the burette at eye level, from the bottom of the meniscus." }, { level: 2, text: "Record to 2 decimal places (e.g., 0.00 ml)." }, { level: 3, text: "This is your starting point to calculate volume used." }] },
      { stepId: 5, title: "Carry Out the Titration", instruction: "Add the base gradually while mixing constantly, slowing right down as you approach the endpoint.", expectedAction: "titrate", actionType: "add", timeLimit: 300, misconceptionRisks: ["CHEM_001", "CHEM_003"], hints: [{ level: 1, text: "Add slowly — especially near the endpoint!" }, { level: 2, text: "Swirl the flask after each addition to mix properly." }, { level: 3, text: "Add half-drops near the end by touching the tip to the flask wall." }] },
      { stepId: 6, title: "Detect the Endpoint", instruction: "Stop as soon as the indicator shows a permanent colour change, and record the final reading.", expectedAction: "detect_endpoint", actionType: "observe", timeLimit: 60, misconceptionRisks: ["CHEM_002", "CHEM_003"], hints: [{ level: 1, text: "The endpoint is a pale pink color that persists for 30 seconds." }, { level: 2, text: "If the color fades, add one more drop of NaOH." }, { level: 3, text: "Deep pink means you've overshot — try again more carefully." }] },
      { stepId: 7, title: "Calculate the Volume Delivered", instruction: "Calculate the volume of base delivered = final reading − starting reading.", expectedAction: "calculate_volume", actionType: "calculate", timeLimit: 60, misconceptionRisks: [], hints: [{ level: 1, text: "Volume used = final burette reading - initial burette reading." }, { level: 2, text: "This is called the titre volume." }, { level: 3, text: "Repeat the titration to get consistent results (concordant titres)." }] },
    ],
  },
  {
    title: "Separating Mixtures by Filtration",
    subject: "Chemistry",
    grades: [6, 7],
    difficulty: "easy",
    estimatedTime: 20,
    description: "Separate an insoluble solid from a liquid by choosing and setting up a suitable separation method.",
    objectives: ["Choose a suitable separation method", "Set up the apparatus correctly", "Pass the mixture through", "Identify what is collected and what is retained"],
    materials: ["Filter funnel", "Filter paper", "Beaker", "Retort stand", "Sand-water mixture", "Glass rod"],
    thumbnailColor: "#2ECC71",
    commonMisconceptions: ["CHEM_001"],
    steps: [
      { stepId: 1, title: "Prepare the Separating Medium", instruction: "Prepare the material that will trap the solid while letting the liquid pass through.", expectedAction: "fold_filter_paper", actionType: "setup", timeLimit: 60, hints: [{ level: 1, text: "Fold the circle in half, then fold in half again." }, { level: 2, text: "Open one layer to form a cone shape." }, { level: 3, text: "The cone should fit snugly inside the funnel." }], misconceptionRisks: [] },
      { stepId: 2, title: "Set Up the Apparatus", instruction: "Assemble your separation apparatus so the filtered liquid will be collected in a container below.", expectedAction: "setup_funnel", actionType: "setup", timeLimit: 60, hints: [{ level: 1, text: "The funnel tip should point into the beaker." }, { level: 2, text: "Make sure the beaker is directly below the funnel tip." }, { level: 3, text: "The funnel should be stable and not wobble." }], misconceptionRisks: [] },
      { stepId: 3, title: "Fit the Separating Medium", instruction: "Fit the separating medium into the apparatus so there are no gaps around the edges.", expectedAction: "insert_filter_paper", actionType: "setup", timeLimit: 60, hints: [{ level: 1, text: "Wet the paper slightly to make it stick to the funnel." }, { level: 2, text: "Press the paper against the funnel walls — no gaps." }, { level: 3, text: "The paper should fit tightly with no air spaces at the sides." }], misconceptionRisks: [] },
      { stepId: 4, title: "Pass the Mixture Through", instruction: "Slowly transfer the mixture into the apparatus, guiding the flow so it doesn't overflow.", expectedAction: "pour_mixture", actionType: "add", timeLimit: 90, hints: [{ level: 1, text: "Pour slowly to avoid overflowing the filter paper." }, { level: 2, text: "Use a glass rod to guide the liquid." }, { level: 3, text: "Fill the funnel only 2/3 full at a time." }], misconceptionRisks: [] },
      { stepId: 5, title: "Collect and Observe", instruction: "Let the separation finish, then examine what passed through and what was retained.", expectedAction: "collect_filtrate", actionType: "observe", timeLimit: 120, hints: [{ level: 1, text: "The clear liquid that drips through is called the filtrate." }, { level: 2, text: "The solid left in the filter paper is called the residue." }, { level: 3, text: "Filtration separates insoluble solids from liquids." }], misconceptionRisks: [] },
    ],
  },
  {
    title: "Testing a Leaf for Starch",
    subject: "Biology",
    grades: [6, 7],
    difficulty: "easy",
    estimatedTime: 25,
    description: "Test a leaf for the presence of starch to demonstrate that photosynthesis has occurred.",
    objectives: ["Remove chlorophyll from a leaf", "Test for starch using iodine", "Link starch to photosynthesis"],
    materials: ["Leaf", "Beaker", "Water", "Alcohol (ethanol)", "Iodine solution", "White tile", "Forceps", "Hotplate"],
    thumbnailColor: "#27AE60",
    commonMisconceptions: ["BIO_001", "BIO_003"],
    steps: [
      { stepId: 1, title: "Collect Leaf", instruction: "Collect a fresh leaf from a plant that has been in sunlight.", expectedAction: "collect_leaf", actionType: "setup", timeLimit: 30, misconceptionRisks: ["BIO_001"], hints: [{ level: 1, text: "Choose a green, healthy leaf from a well-lit plant." }, { level: 2, text: "The leaf must have been in sunlight for photosynthesis to occur." }, { level: 3, text: "A leaf kept in the dark would test negative for starch." }] },
      { stepId: 2, title: "Boil in Water", instruction: "Place the leaf in boiling water for 2 minutes using forceps.", expectedAction: "boil_in_water", actionType: "heat", timeLimit: 120, misconceptionRisks: ["BIO_003"], hints: [{ level: 1, text: "Boiling in water softens the leaf and breaks down cell walls." }, { level: 2, text: "This step does NOT remove starch or chlorophyll." }, { level: 3, text: "Keep the leaf submerged for the full 2 minutes." }] },
      { stepId: 3, title: "Boil in Alcohol", instruction: "Transfer the leaf to boiling alcohol (ethanol) to remove chlorophyll.", expectedAction: "boil_in_alcohol", actionType: "heat", timeLimit: 120, misconceptionRisks: ["BIO_003"], hints: [{ level: 1, text: "Alcohol removes the green chlorophyll pigment." }, { level: 2, text: "The leaf will turn pale/white when chlorophyll is fully removed." }, { level: 3, text: "This allows the iodine color change to be seen clearly." }] },
      { stepId: 4, title: "Rinse with Water", instruction: "Remove the leaf and rinse with cold water to soften it.", expectedAction: "rinse_leaf", actionType: "add", timeLimit: 30, misconceptionRisks: [], hints: [{ level: 1, text: "Rinsing removes alcohol and softens the brittle leaf." }, { level: 2, text: "The leaf should be pale yellow or white at this stage." }, { level: 3, text: "Spread the leaf flat for the iodine test." }] },
      { stepId: 5, title: "Place on White Tile", instruction: "Lay the leaf flat on a white tile.", expectedAction: "place_on_tile", actionType: "setup", timeLimit: 30, misconceptionRisks: [], hints: [{ level: 1, text: "Flatten the leaf to ensure even iodine coverage." }, { level: 2, text: "White tile helps you see the color change clearly." }, { level: 3, text: "Use a glass rod to flatten stubborn areas." }] },
      { stepId: 6, title: "Add Iodine Solution", instruction: "Add drops of iodine solution evenly across the leaf surface.", expectedAction: "add_iodine", actionType: "add", timeLimit: 60, misconceptionRisks: ["BIO_001"], hints: [{ level: 1, text: "Use a dropper to add 4-5 drops spread across the leaf." }, { level: 2, text: "Iodine is orange-brown in color." }, { level: 3, text: "Wait 30 seconds for the color to develop." }] },
      { stepId: 7, title: "Record Observation", instruction: "Observe and record the color change. Blue-black = starch present.", expectedAction: "record_observation", actionType: "observe", timeLimit: 60, misconceptionRisks: ["BIO_001"], hints: [{ level: 1, text: "Blue-black color confirms starch is present." }, { level: 2, text: "Orange-brown (no color change) means no starch detected." }, { level: 3, text: "Starch is present because photosynthesis occurred in sunlight." }] },
    ],
  },
  {
    title: "Osmosis in Plant Cells",
    subject: "Biology",
    grades: [8, 9],
    difficulty: "medium",
    estimatedTime: 45,
    description: "Investigate osmosis by observing mass changes in potato pieces placed in different concentrations.",
    objectives: ["Understand osmosis as passive transport", "Measure mass change in potato", "Relate concentration to water movement"],
    materials: ["Potato", "Scalpel", "Ruler", "Balance", "3 Beakers", "Pure water", "10% salt solution", "20% salt solution", "Paper towel"],
    thumbnailColor: "#8E44AD",
    commonMisconceptions: ["BIO_002"],
    steps: [
      { stepId: 1, title: "Cut Potato Pieces", instruction: "Cut 3 equal pieces of potato (same size and shape).", expectedAction: "cut_potato", actionType: "setup", timeLimit: 120, misconceptionRisks: [], hints: [{ level: 1, text: "Use a ruler to ensure equal size (e.g., 3cm x 1cm x 1cm)." }, { level: 2, text: "Equal size ensures a fair test." }, { level: 3, text: "Remove any skin for consistent results." }] },
      { stepId: 2, title: "Weigh Each Piece", instruction: "Record the initial mass of each potato piece in grams.", expectedAction: "record_initial_mass", actionType: "measure", timeLimit: 90, misconceptionRisks: ["BIO_002"], hints: [{ level: 1, text: "Dry each piece with paper towel before weighing." }, { level: 2, text: "Record each mass separately — label them A, B, C." }, { level: 3, text: "You need this to calculate the mass change after osmosis." }] },
      { stepId: 3, title: "Prepare Solutions", instruction: "Set up 3 beakers: pure water, 10% salt, 20% salt solution.", expectedAction: "setup_solutions", actionType: "setup", timeLimit: 90, misconceptionRisks: [], hints: [{ level: 1, text: "Label each beaker clearly: Water, 10% Salt, 20% Salt." }, { level: 2, text: "Use equal volumes of solution in each beaker." }, { level: 3, text: "The concentration difference drives osmosis." }] },
      { stepId: 4, title: "Submerge Potato Pieces", instruction: "Place one potato piece in each beaker. Start timer for 30 minutes.", expectedAction: "submerge_potato", actionType: "add", timeLimit: 60, misconceptionRisks: ["BIO_002"], hints: [{ level: 1, text: "Place piece A in water, B in 10% salt, C in 20% salt." }, { level: 2, text: "Make sure each piece is fully submerged." }, { level: 3, text: "Osmosis will occur passively — no energy needed." }] },
      { stepId: 5, title: "Remove and Dry", instruction: "After 30 minutes, remove each piece and pat dry with paper towel.", expectedAction: "remove_dry", actionType: "setup", timeLimit: 60, misconceptionRisks: [], hints: [{ level: 1, text: "Pat dry gently — don't squeeze the potato." }, { level: 2, text: "Surface water must be removed for accurate weighing." }, { level: 3, text: "Work quickly so water doesn't evaporate from the potato." }] },
      { stepId: 6, title: "Weigh Again", instruction: "Record the final mass of each piece.", expectedAction: "record_final_mass", actionType: "measure", timeLimit: 90, misconceptionRisks: [], hints: [{ level: 1, text: "Weigh each piece in the same order as before." }, { level: 2, text: "Compare to the initial mass — has it increased or decreased?" }, { level: 3, text: "Mass increases = water entered. Mass decreases = water left." }] },
      { stepId: 7, title: "Calculate % Change", instruction: "Calculate percentage mass change = (Final-Initial)/Initial × 100.", expectedAction: "calculate_change", actionType: "calculate", timeLimit: 120, misconceptionRisks: ["BIO_002"], hints: [{ level: 1, text: "% change = ((Final mass - Initial mass) / Initial mass) × 100." }, { level: 2, text: "Positive % = gained mass (water entered by osmosis)." }, { level: 3, text: "Negative % = lost mass (water left by osmosis to salt solution)." }] },
    ],
  },
];

module.exports = experiments;
