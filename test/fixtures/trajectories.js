// Scenario builder + `signaturesByCode` for studentModelService tests. A scenario is a list of
// task "phases" (an expectedIntent + the bench actions taken during it); the builder lays them out
// on a synthetic timeline so buildTaskTimeline can attribute each action to its task.

const misconceptions = require("../../src/data/misconceptions");

// The KB shape studentModelService expects: { [code]: MisconceptionDoc }. Built from the real
// authored data so the tests exercise the actual signatures.
const signaturesByCode = Object.fromEntries(
  misconceptions
    .filter((m) => (m.behaviouralSignatures || []).length > 0)
    .map((m) => [
      m.code,
      {
        code: m.code,
        description: m.description,
        correctionStrategy: m.correctionStrategy,
        behaviouralSignatures: m.behaviouralSignatures,
        behaviouralPriorLogOdds: m.behaviouralPriorLogOdds ?? null,
      },
    ])
);

const BASE = Date.parse("2026-08-30T10:00:00.000Z");
const PHASE_MS = 100000;

/**
 * @param {object}   opts
 * @param {string[]} opts.relevantCodes   codes to put on the practical (commonMisconceptions + step risks)
 * @param {Array}    opts.phases          [{ intent, prompt?, actions: [partial bench action] }]
 * @param {Array}    [opts.requiredChemicals]  [{ chemical: id }] — for indicator-expected predicates
 * @returns {{ experiment, session, benchActions }}
 */
function buildScenario({ relevantCodes, phases, requiredChemicals = [] }) {
  const microSteps = [];
  const spMicro = [];
  const benchActions = [];

  phases.forEach((ph, i) => {
    const startedAt = new Date(BASE + i * PHASE_MS);
    const completedAt = new Date(BASE + i * PHASE_MS + PHASE_MS - 1000);
    microSteps.push({
      microStepId: i + 1,
      studentPrompt: ph.prompt || `task ${i + 1}`,
      expectedIntent: ph.intent,
      // chemicals this task itself asks the student to use (adding one is expected, never a misconception)
      expectedChemicalsForStep: ph.expectedChemicals || [],
    });
    spMicro.push({
      microStepId: i + 1,
      startedAt,
      completedAt,
      timeSpentSeconds: 60,
      taskScore: 100,
      highestHintLevel: 0,
      helpUsed: false,
      hintsRequested: 0,
      equipmentMistakes: 0,
      chemicalMistakes: 0,
    });
    (ph.actions || []).forEach((a, k) => {
      benchActions.push({
        timestamp: new Date(BASE + i * PHASE_MS + k * 1000 + 500),
        chemicalIds: [],
        equipment: null,
        resultType: null,
        ...a,
      });
    });
  });

  const experiment = {
    _id: "exp_fx",
    title: "Fixture Practical",
    subject: "Chemistry",
    grades: [10],
    estimatedTime: 20,
    commonMisconceptions: relevantCodes,
    requiredChemicals,
    steps: [
      {
        stepId: 1,
        title: "Fixture Step",
        instruction: "",
        actionType: "add",
        misconceptionRisks: relevantCodes,
        microSteps,
      },
    ],
  };

  const session = {
    _id: "sess_fx",
    experimentId: "exp_fx",
    status: "completed",
    currentStep: 1,
    currentMicroStep: phases.length,
    stepProgress: [
      {
        stepId: 1,
        startedAt: new Date(BASE),
        completedAt: new Date(BASE + phases.length * PHASE_MS),
        microSteps: spMicro,
      },
    ],
    behaviorFeatures: { struggledSteps: [] },
    aiFeedback: { misconceptionsDetected: [] },
  };

  return { experiment, session, benchActions };
}

// Small chemical lookups for the category-aware predicates.
const chemicals = {
  hcl: { _id: "hcl", symbol: "HCl", formula: "HCl", category: "acid" },
  naoh: { _id: "naoh", symbol: "NaOH", formula: "NaOH", category: "base" },
  phph: { _id: "phph", symbol: "Phph", formula: null, category: "indicator" },
  cuso4: { _id: "cuso4", symbol: "CuSO4", formula: "CuSO4", category: "salt" },
  zn: { _id: "zn", symbol: "Zn", formula: "Zn", category: "metal" },
  ag: { _id: "ag", symbol: "Ag", formula: "Ag", category: "metal" },
  water: { _id: "water", symbol: "H2O", formula: "H2O", category: "oxide" },
};

module.exports = { buildScenario, signaturesByCode, chemicals };
