// Phase 1 Biology Concept Visualizations — Grade 10/11 Science.
// Each entry is inserted as-is (no symbol/ObjectId resolution needed, unlike chemistry/physics
// practicals) — see seed.js. animationKey selects the matching canvas component in the mobile
// app (components/lab/biology/canvases/*).

module.exports = [
  {
    title: "Photosynthesis",
    animationKey: "photosynthesis",
    description: "Watch how a leaf turns sunlight, water and carbon dioxide into glucose and oxygen.",
    grades: [10, 11],
    syllabusTopic: "Nutrition in Plants — Photosynthesis",
    learningObjective: "Explain how a leaf uses light energy, water and carbon dioxide to produce glucose and oxygen.",
    keyConcept: "Photosynthesis",
    difficulty: "medium",
    durationSec: 24,
    thumbnailColor: "#7CB342",
    stages: [
      {
        stageId: 1,
        title: "Sunlight reaches the leaf",
        durationMs: 4000,
        explanation: "Sunlight strikes the leaf's surface and is absorbed by chlorophyll inside the chloroplasts.",
        componentIds: ["chloroplast"],
      },
      {
        stageId: 2,
        title: "Water reaches the leaf",
        durationMs: 4000,
        explanation: "Water absorbed by the roots travels up through the xylem into the leaf.",
        componentIds: ["xylem"],
      },
      {
        stageId: 3,
        title: "Carbon dioxide enters through stomata",
        durationMs: 4000,
        explanation: "Tiny pores on the leaf's surface, called stomata, let carbon dioxide diffuse in from the air.",
        componentIds: ["stomata"],
      },
      {
        stageId: 4,
        title: "Photosynthesis occurs",
        durationMs: 4000,
        explanation: "Inside the chloroplast, light energy converts water and carbon dioxide into glucose.",
        componentIds: ["chloroplast"],
      },
      {
        stageId: 5,
        title: "Glucose is produced",
        durationMs: 4000,
        explanation: "Glucose is used by the plant for energy or stored as starch.",
        componentIds: ["chloroplast"],
      },
      {
        stageId: 6,
        title: "Oxygen is released",
        durationMs: 4000,
        explanation: "Oxygen, a by-product of the reaction, diffuses back out through the stomata into the air.",
        componentIds: ["stomata"],
      },
    ],
    components: [
      {
        componentId: "chloroplast",
        label: "Chloroplast",
        shortInfo: "The tiny structure inside leaf cells that contains chlorophyll and is where photosynthesis actually happens.",
      },
      {
        componentId: "stomata",
        label: "Stomata",
        shortInfo: "Small openings, mainly on the underside of leaves, that let carbon dioxide in and oxygen and water vapour out.",
      },
      {
        componentId: "xylem",
        label: "Xylem",
        shortInfo: "A tube-like tissue that carries water and dissolved minerals from the roots up to the leaves.",
      },
    ],
    learningQuestions: [
      {
        question: "Which gas enters the leaf during photosynthesis?",
        options: ["Oxygen", "Carbon dioxide", "Nitrogen"],
        correctIndex: 1,
        replayStageId: 3,
      },
    ],
  },
  {
    title: "The Water Cycle",
    animationKey: "water_cycle",
    description: "See how water continuously moves between the ocean, the atmosphere and the land.",
    grades: [10, 11],
    syllabusTopic: "Environmental Science — The Water Cycle",
    learningObjective: "Describe how evaporation, condensation and precipitation keep water moving in a continuous cycle.",
    keyConcept: "Water Cycle",
    difficulty: "easy",
    durationSec: 24,
    thumbnailColor: "#4FA8F7",
    stages: [
      {
        stageId: 1,
        title: "The sun heats the ocean",
        durationMs: 4000,
        explanation: "Energy from the sun heats the surface of the ocean and other water bodies.",
        componentIds: ["ocean"],
      },
      {
        stageId: 2,
        title: "Evaporation",
        durationMs: 4000,
        explanation: "Water turns into water vapour and rises into the atmosphere.",
        componentIds: ["ocean"],
      },
      {
        stageId: 3,
        title: "Condensation",
        durationMs: 4000,
        explanation: "As it rises, water vapour cools and condenses into tiny droplets, forming clouds.",
        componentIds: ["cloud"],
      },
      {
        stageId: 4,
        title: "Precipitation",
        durationMs: 4000,
        explanation: "When the droplets in a cloud become too heavy, they fall as rain.",
        componentIds: ["cloud"],
      },
      {
        stageId: 5,
        title: "Collection",
        durationMs: 4000,
        explanation: "Rainwater collects in rivers, lakes and oceans, and also soaks into the ground.",
        componentIds: ["ocean"],
      },
      {
        stageId: 6,
        title: "The cycle repeats",
        durationMs: 4000,
        explanation: "The sun heats this collected water again, and evaporation begins once more.",
        componentIds: ["ocean"],
      },
    ],
    components: [
      {
        componentId: "ocean",
        label: "Ocean / Lake",
        shortInfo: "The main store of liquid water on Earth's surface — where most evaporation begins.",
      },
      {
        componentId: "cloud",
        label: "Cloud",
        shortInfo: "A visible mass of condensed water droplets floating in the atmosphere.",
      },
    ],
    learningQuestions: [
      {
        question: "What is it called when water vapour cools and forms clouds?",
        options: ["Evaporation", "Condensation", "Precipitation"],
        correctIndex: 1,
        replayStageId: 3,
      },
    ],
  },
  {
    title: "Gas Exchange in the Lungs",
    animationKey: "gas_exchange",
    description: "Follow oxygen and carbon dioxide as they swap between the air in your lungs and your blood.",
    grades: [10, 11],
    syllabusTopic: "Human Biology — Respiratory System and Gas Exchange",
    learningObjective: "Explain how oxygen and carbon dioxide are exchanged between the alveoli and the blood.",
    keyConcept: "Gas Exchange",
    difficulty: "medium",
    durationSec: 20,
    thumbnailColor: "#F76E6E",
    stages: [
      {
        stageId: 1,
        title: "Air enters the airway",
        durationMs: 4000,
        explanation: "Air travels through the nose, trachea and bronchi down into the lungs.",
        componentIds: ["trachea"],
      },
      {
        stageId: 2,
        title: "Air reaches the alveoli",
        durationMs: 4000,
        explanation: "Air arrives at the alveoli, tiny air sacs surrounded by blood capillaries.",
        componentIds: ["alveolus"],
      },
      {
        stageId: 3,
        title: "Oxygen moves into the blood",
        durationMs: 4000,
        explanation: "Oxygen diffuses from the alveolus, where it is highly concentrated, into the blood in the capillary.",
        componentIds: ["alveolus", "capillary"],
      },
      {
        stageId: 4,
        title: "Carbon dioxide moves into the alveolus",
        durationMs: 4000,
        explanation: "At the same time, carbon dioxide diffuses out of the blood and into the alveolus.",
        componentIds: ["alveolus", "capillary"],
      },
      {
        stageId: 5,
        title: "Carbon dioxide is exhaled",
        durationMs: 4000,
        explanation: "The carbon dioxide-rich air travels back up the airway and is breathed out.",
        componentIds: ["trachea"],
      },
    ],
    components: [
      {
        componentId: "trachea",
        label: "Trachea",
        shortInfo: "The windpipe — a tube that carries air between the throat and the lungs.",
      },
      {
        componentId: "alveolus",
        label: "Alveolus",
        shortInfo: "A tiny, thin-walled air sac in the lungs where gas exchange with the blood takes place.",
      },
      {
        componentId: "capillary",
        label: "Capillary",
        shortInfo: "A very thin blood vessel wrapped around each alveolus, allowing gases to diffuse in and out of the blood.",
      },
    ],
    learningQuestions: [
      {
        question: "Which gas moves from the alveoli into the blood?",
        options: ["Oxygen", "Carbon dioxide", "Nitrogen"],
        correctIndex: 0,
        replayStageId: 3,
      },
    ],
  },
];
