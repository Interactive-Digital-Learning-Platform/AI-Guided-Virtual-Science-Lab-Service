const mongoose = require("mongoose");

// A tappable "hotspot" the student can inspect on the canvas (e.g. stomata, chloroplast).
// shortInfo is short by design — the mobile info sheet, not a textbook page (see spec section 9).
const componentSchema = new mongoose.Schema(
  {
    componentId: { type: String, required: true }, // matches an id the mobile canvas renders, e.g. "stomata"
    label: { type: String, required: true },
    shortInfo: { type: String, required: true },
  },
  { _id: false }
);

// One scientific stage in the process (spec section 7). durationMs drives the player's
// auto-advance timing; componentIds lists which tappable components are relevant/visible while
// this stage plays, so the canvas doesn't have to hard-code that per concept.
const stageSchema = new mongoose.Schema(
  {
    stageId: { type: Number, required: true }, // order within the visualization, 1-based
    title: { type: String, required: true },
    durationMs: { type: Number, required: true },
    explanation: { type: String, required: true },
    componentIds: [{ type: String }],
  },
  { _id: false }
);

// Optional in-player knowledge check that reinforces the stage the student just watched
// (spec section 11) — replayStageId lets the client jump back and replay that stage on a wrong
// answer. Graded/tracked client-side only in this phase (see phase-1 non-goals).
const learningQuestionSchema = new mongoose.Schema(
  {
    question: { type: String, required: true },
    options: [{ type: String, required: true }],
    correctIndex: { type: Number, required: true },
    replayStageId: { type: Number, default: null },
  },
  { _id: false }
);

const biologyVisualizationSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    // Selects which per-concept canvas component the mobile app mounts (see
    // components/lab/biology/VisualizationCanvas.tsx) — e.g. "photosynthesis", "water_cycle".
    animationKey: { type: String, required: true, unique: true },
    description: { type: String, required: true },
    grades: [{ type: Number, min: 6, max: 11 }],
    syllabusTopic: { type: String, required: true },
    learningObjective: { type: String, required: true },
    keyConcept: { type: String, required: true },
    difficulty: { type: String, enum: ["easy", "medium", "hard"], required: true },
    durationSec: { type: Number, required: true },
    thumbnailColor: { type: String, default: "#7CB342" },
    stages: [stageSchema],
    components: [componentSchema],
    learningQuestions: [learningQuestionSchema],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

biologyVisualizationSchema.index({ grades: 1 });

module.exports = mongoose.model("BiologyVisualization", biologyVisualizationSchema);
