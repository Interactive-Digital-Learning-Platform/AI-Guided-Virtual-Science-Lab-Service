const mongoose = require("mongoose");

// One "Current Task" — the atomic unit of student action within a Main Step (stepSchema below).
// Where a Main Step describes the overall learning objective ("Mix the acid with the indicator
// and observe the change"), a microStep is the single meaningful action the student must figure
// out right now ("Choose the appropriate container"). Graded the same "bench is the source of
// truth" way as the parent step (see evaluateOnBench in session.controller.js), just scoped to
// this task's own expectedEquipment/expectedChemicalsForStep instead of the whole step's.
const microStepSchema = new mongoose.Schema(
  {
    microStepId: { type: Number, required: true }, // order within the parent step, 1-based
    // Student-facing task prompt — must describe the ACTION CATEGORY only, never the specific
    // equipment/chemical/answer (e.g. "Choose the appropriate container", not "Select the test
    // tube"). Shown to the student as "CURRENT TASK" — see workspace.tsx.
    studentPrompt: { type: String, required: true },
    // Internal semantic intent — never exposed to the client. Lets the engine and hint services
    // reason about what kind of action is expected without hard-coding per-practical UI logic.
    expectedIntent: {
      type: String,
      enum: [
        "SELECT_CONTAINER",
        "SELECT_EQUIPMENT",
        "SELECT_TRANSFER_EQUIPMENT",
        "TRANSFER_LIQUID",
        "ADD_REAGENT",
        "PREPARE_SAMPLE",
        "HEAT_SAMPLE",
        "MIX_SUBSTANCES",
        "OBSERVE_RESULT",
        "MEASURE_RESULT",
        "RECORD_RESULT",
        // Physics (mechanics/electricity) intents — see mechanicsEngine.js/circuitEngine.js.
        "SET_MEASUREMENT_PARAMETER",
        "START_TIMED_TRIAL",
        "STOP_TIMED_TRIAL",
        "PLACE_COMPONENT",
        "READ_METER",
      ],
      required: true,
    },
    // This task's own slice of the parent step's requiredEquipment/requiredChemicalsForStep —
    // same withholding principle (never sent to the client unfiltered, see the exclusion selects
    // in experiment.controller.js / session.controller.js).
    expectedEquipment: [{ type: String }],
    expectedChemicalsForStep: [{ type: mongoose.Schema.Types.ObjectId, ref: "Chemical" }],
    // MIX_SUBSTANCES tasks additionally require the reaction to have actually fired on the bench
    // (reactionEngine.js) — presence of the ingredients alone isn't enough, mirrors the parent
    // step's actionType === "mix" grading.
    requiresReactionCheck: { type: Boolean, default: false },
    // Physics sibling of requiresReactionCheck: this task additionally requires a measured/
    // calculated value (period, spring constant, density, resistance, current...) to fall within
    // tolerance of the expected value — see mechanicsEngine.js/circuitEngine.js's
    // checkMeterReading and its call site in session.controller.js's logAction.
    requiresMeasurementCheck: { type: Boolean, default: false },
    expectedMeasurement: {
      metric: { type: String, default: null }, // "period" | "spring_constant" | "density" | "resistance" | "current" | "voltage" | "g"
      expectedValue: { type: Number, default: null },
      tolerancePct: { type: Number, default: 10 },
    },
    // TRANSFER_LIQUID / ADD_REAGENT tasks that must be done *with a transfer instrument*, not by
    // dragging the chemical bottle straight into the target. Satisfied only by a real `dispense`
    // of `sourceChemical` into a container other than the source, on/after this micro-step started
    // (see liquidTransferService + session.controller.js's transfer grading branch). Absent →
    // grading is unchanged (presence-only). Answer-bearing → withheld from the client.
    //   - `method`: a CAPABILITY (equipmentCapabilities.js) — any instrument carrying it is
    //     accepted (curriculum-flexible). Preferred.
    //   - `instrumentCategory`: an EXACT equipment type — only when the science requires that
    //     specific instrument. If both are set, `method` wins.
    expectedTransfer: {
      method: { type: String, default: null }, // e.g. "small_quantity_transfer" / "accurate_volume_transfer"
      instrumentCategory: { type: String, enum: ["dropper", "pipette", "burette", null], default: null },
      sourceChemical: { type: mongoose.Schema.Types.ObjectId, ref: "Chemical", default: null },
      minDispenses: { type: Number, default: 1 },
    },
    // Per-task 3-level hint ladder, same shape/withholding as the parent step's hints — only
    // used as a fallback when Gemini-backed generation (labHintService.js) is unavailable.
    hints: [
      {
        level: { type: Number, min: 1, max: 3 },
        text: { type: String },
      },
    ],
    // This task's own "no more hints, here's the answer" explanation — only ever sent to the
    // client from requestHelp, and only once hint level 3 has been shown for this task.
    exactAnswer: { type: String, default: "" },
  },
  { _id: false }
);

// A pointer into the ingested Sri Lankan curriculum knowledge base (grade 10/11 textbooks) —
// "to review this, read <lesson>, pp. X–Y of the <book>". Precomputed by the sync job
// (npm run curriculum:sync — scripts/curriculum/, which vector-searches the Qdrant collection
// `pdf_knowledge_base` directly + an LLM distillation pass) and stored here so the running service
// has NO runtime dependency on Qdrant. Attached at both experiment and step level; the
// step-level ref (when present) is preferred over the experiment-level one. These are
// "go read the book" pointers, not answers — but they are still withheld from the pre-start
// experiment payload (see the exclusion selects in experiment.controller.js /
// session.controller.js) and surfaced only through the hint ladder and the session report.
const curriculumRefSchema = new mongoose.Schema(
  {
    bookTitle: { type: String, default: "" }, // e.g. "Grade 10 Science Textbook"
    bookFilename: { type: String, default: "" }, // Qdrant/`jobs` key, e.g. "grade-10-science-text-book-v1.pdf"
    grade: { type: Number, default: null }, // 10 | 11
    lessonTitle: { type: String, default: "" }, // e.g. "Acids, Bases and Salts"
    sectionTitle: { type: String, default: "" }, // optional sub-heading within the lesson
    pageStart: { type: Number, default: null },
    pageEnd: { type: Number, default: null },
    confidence: { type: Number, default: 0 }, // 0..1, from the generator's LLM pass
    snippet: { type: String, default: "" }, // short grounding excerpt (not shown raw to the student)
    sourceChunkIds: [{ type: String }], // Qdrant point ids used — for regeneration/audit
  },
  { _id: false }
);

const stepSchema = new mongoose.Schema({
  stepId: { type: Number, required: true },
  title: { type: String, required: true },
  instruction: { type: String, required: true },
  expectedAction: { type: String, required: true },
  actionType: {
    type: String,
    enum: ["measure", "add", "observe", "record", "calculate", "setup", "mix", "heat", "filter", "pour", "stir"],
    required: true,
  },
  // What this step actually requires to be marked correct — checked against the live bench
  // (LabRun.equipment, see session.controller.js's evaluateOnBench) rather than trusted from
  // the client, same "backend remains the source of truth" principle as the reaction engine.
  // requiredChemicalsForStep was originally mix-step-only (graded via reactionEngine.js); it's now
  // populated and validated for any step that genuinely involves a chemical. requiredEquipment is
  // step-scoped and distinct from the experiment-level requiredEquipment above (that one gates the
  // non-blocking pre-procedure equipment-selection screen; this one hard-validates a specific step
  // once the student is inside the workspace). Both fields also feed the AI equipment/chemical hint
  // system (labHintService.js) — never sent to the client directly (see the field-exclusion selects
  // in experiment.controller.js / session.controller.js).
  requiredChemicalsForStep: [{ type: mongoose.Schema.Types.ObjectId, ref: "Chemical" }],
  requiredEquipment: [{ type: String }],
  // Electricity (Phase B) only: when set, the workspace mounts CircuitBoard.tsx (a fixed
  // slot-based board layout, see circuitBoards.js) instead of the free-bench LabWorkspace for
  // this step. A single practical can use different boards across its steps (e.g. Series and
  // Parallel Resistors builds a series board in one step, a parallel board in the next) — this is
  // deliberately step-scoped, not experiment-scoped, for that reason.
  circuitBoardId: { type: String, default: null },
  // What the student should notice/discover in this step — fed into the AI hint prompts
  // (labHintService.js) as extra grounding context, but never shown to the student directly
  // until the Help reveal (see requestHelp in session.controller.js), same withholding
  // principle as requiredEquipment/requiredChemicalsForStep above.
  observationGoal: { type: String, default: "" },
  // Full "no more hints, here's the answer" explanation — only ever sent to the client from
  // requestHelp, and only once the student has already been shown hint level 3 for this step.
  exactAnswer: { type: String, default: "" },
  // Textbook lesson/page pointer(s) for THIS step (see curriculumRefSchema). Preferred over the
  // experiment-level curriculumRefs when non-empty. Populated by the offline generator; withheld
  // from the pre-start experiment payload, surfaced only via the hint ladder / session report.
  curriculumRefs: [curriculumRefSchema],
  conceptTags: [{ type: mongoose.Schema.Types.ObjectId, ref: "Concept" }],
  misconceptionRisks: [{ type: String }], // misconception codes e.g. "PHY_001"
  timeLimit: { type: Number, default: 120 }, // seconds
  hints: [
    {
      level: { type: Number, min: 1, max: 3 },
      text: { type: String },
    },
  ],
  imageUrl: { type: String, default: null },
  isOptional: { type: Boolean, default: false },
  // Ordered "Current Tasks" this Main Step decomposes into (see microStepSchema above). Empty/
  // absent for practicals not yet migrated to the micro-step workflow — the engine falls back to
  // grading this step as a single atomic action against requiredEquipment/requiredChemicalsForStep
  // directly, exactly as before microSteps existed (see evaluateOnBench in session.controller.js).
  microSteps: [microStepSchema],
});

const experimentSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    subject: { type: String, enum: ["Physics", "Chemistry", "Biology"], required: true },
    grades: [{ type: Number, min: 6, max: 11 }], // applicable grades
    difficulty: { type: String, enum: ["easy", "medium", "hard"], required: true },
    estimatedTime: { type: Number, required: true }, // minutes
    description: { type: String, required: true },
    objectives: [{ type: String }],
    materials: [{ type: String }],
    lesson: { type: String, default: "" },
    theory: { type: String, default: "" },
    keyConcepts: [{ type: String }],
    steps: [stepSchema],
    relatedConcepts: [{ type: mongoose.Schema.Types.ObjectId, ref: "Concept" }],
    commonMisconceptions: [{ type: String }], // misconception codes
    thumbnailColor: { type: String, default: "#4F8EF7" },
    totalAttempts: { type: Number, default: 0 },
    averageScore: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },

    // Pre-procedure selection phases (Chemistry practicals; optional for Physics/Biology).
    // Evaluated before `steps` begin — see equipment/chemical selection endpoints.
    requiredEquipment: [{ type: String }], // equipment type keys, e.g. "beaker", "ph_meter"
    optionalEquipment: [{ type: String }], // valid but non-essential — not flagged as "unnecessary"
    requiredChemicals: [
      {
        chemical: { type: mongoose.Schema.Types.ObjectId, ref: "Chemical", required: true },
        quantity: { type: Number, default: null },
        unit: { type: String, default: null },
      },
    ],
    expectedObservations: [{ type: String }],
    safetyInformation: [{ type: String }],
    // For Chemistry practicals whose "Perform Experiment" phase resolves to a known reaction
    // in the curated reaction database (see Reaction model / reactionEngine.js).
    reactionId: { type: mongoose.Schema.Types.ObjectId, ref: "Reaction", default: null },
    // Documents which grading engine this practical's measurement-check microSteps rely on —
    // informational/authoring-time only; actual dispatch in session.controller.js/
    // labRun.controller.js keys off requiresReactionCheck vs requiresMeasurementCheck and the
    // physics-only action types, not this field, so it can never desync grading behavior.
    evaluationEngine: { type: String, enum: ["chemistry_reaction", "mechanics", "circuit", null], default: null },

    // Experiment-wide textbook lesson/page pointer(s) (see curriculumRefSchema) — the fallback
    // when a step has no curriculumRefs of its own. Precomputed by
    // npm run curriculum:sync; curriculumRefsGeneratedAt records the last sync run.
    curriculumRefs: [curriculumRefSchema],
    curriculumRefsGeneratedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

experimentSchema.index({ subject: 1, grades: 1, difficulty: 1 });

module.exports = mongoose.model("Experiment", experimentSchema);
