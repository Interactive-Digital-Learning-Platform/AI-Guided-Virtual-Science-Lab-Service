// ─────────────────────────────────────────────────────────────────────────────────────────────
// BAYESIAN MISCONCEPTION STUDENT MODEL  (see dev-docs/implementation-plan-student-model.md §3.2)
//
// PURE. No mongoose, no I/O. The caller loads inputs (bench action log, the relevant Misconception
// docs, optionally a chemical lookup) and persists the returned snapshot onto Session.studentModel.
//
// What it does: replays a session's bench action log and, for each misconception relevant to the
// practical, maintains a running log-odds of "the student holds this misconception", shifted by
// authored behavioural signatures (Misconception.behaviouralSignatures — M1). The posterior drives
// intervention timing/content (shouldIntervene) and the end-of-session diagnosis (diagnose).
//
// Design choices (v1 / M2):
//   • Independent (naive-Bayes) log-odds per misconception — O(codes × signatures) per action, no
//     sampling. Joint inference is a later refinement (implementation-plan §9).
//   • The n-th match of the SAME signature is damped (LLR / n) so one repeated slip can't peg it.
//   • Task context per historical action comes from the stepProgress micro-step timeline
//     (buildTaskTimeline); if that's unavailable every action is judged against the session's
//     current task instead (fine for the live mid-session call, lossy for a full replay).
//   • Sub-goal / divergence modelling is stubbed here (subGoal.divergenceFlag = false) — M4.
// ─────────────────────────────────────────────────────────────────────────────────────────────

"use strict";

const DEFAULT_PRIOR_LOG_ODDS = -1.0; // P ≈ 0.27 before any evidence — most students hold no given bug
const LOG_ODDS_CLAMP = 6; // P ∈ [~0.0025, ~0.9975] — nothing is ever "certain"
const DIAGNOSE_THRESHOLD = 0.55; // report a misconception at/above this probability
const INTERVENE_THRESHOLD = 0.65; // proactively hint about it at/above this
const MAX_EVIDENCE_PER_CODE = 25; // bound the persisted evidence trail

const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const clampN = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const round = (x, dp = 2) => {
  const f = 10 ** dp;
  return Math.round((Number(x) + Number.EPSILON) * f) / f;
};
const asId = (v) => (v == null ? null : String(v && v._id ? v._id : v));

// Reactivity series (most → least reactive) for the crude metal-displacement check.
const REACTIVITY_ORDER = ["K", "Na", "Li", "Ca", "Mg", "Al", "C", "Zn", "Fe", "Pb", "H", "Cu", "Ag", "Au", "Pt"];

// ── Predicate registry ───────────────────────────────────────────────────────────────────────
// Each predicate: (ctx) => boolean, where ctx = { action, actionIndex, priorActions, recentActions,
// benchState, task, chemicalsById, experiment }. A signature's `whenIntent` has already gated the
// call, so predicates that are purely "did action X during a task of intent in whenIntent" only
// need to check the action itself.
const PREDICATES = {
  // CHEM_002 — heating the vessel during an add-indicator / read-endpoint task.
  heat_during_indicator_or_endpoint_task: (ctx) => ctx.action.actionType === "heat",

  // CHEM_006 — applying heat on a task whose intent is not thermal at all.
  heat_applied_when_task_not_thermal: (ctx) =>
    ctx.action.actionType === "heat" && !!ctx.task.expectedIntent && ctx.task.expectedIntent !== "HEAT_SAMPLE",

  // CHEM_002 — using a thermometer to decide the endpoint.
  thermometer_used_to_judge_endpoint: (ctx) =>
    ["probe_measure", "read_measurement"].includes(ctx.action.actionType) &&
    /thermomet/i.test(ctx.action.equipment || ""),

  // CHEM_003 — recording a pH-7 reading as "the endpoint".
  ph7_recorded_as_endpoint: (ctx) =>
    ctx.action.actionType === "probe_measure" &&
    /ph/i.test(String(ctx.action.unit || "")) &&
    ctx.action.quantity != null &&
    Number(ctx.action.quantity) >= 6.8 &&
    Number(ctx.action.quantity) <= 7.2,

  // CHEM_004 — combining substances that produce no reaction, on a mix/add task.
  combined_non_reacting_substances: (ctx) => ctx.action.resultType === "no_reaction",

  // CHEM_001 — adding the titrant/reagent before the indicator, when an indicator is expected.
  reagent_added_before_indicator: (ctx) => {
    if (!ctx.chemicalsById) return false;
    const cat = (id) => (ctx.chemicalsById[asId(id)] || {}).category;
    const ids = ctx.action.chemicalIds || [];
    const addsIndicatorNow = ids.some((id) => cat(id) === "indicator");
    if (addsIndicatorNow) return false;
    const addsReagentNow = ["add_chemical", "dispense", "pour"].includes(ctx.action.actionType) && ids.length > 0;
    if (!addsReagentNow) return false;
    const indicatorExpected = (ctx.experiment.requiredChemicals || []).some((rc) => {
      const c = ctx.chemicalsById[asId(rc.chemical || rc)];
      return c && c.category === "indicator";
    });
    if (!indicatorExpected) return false;
    const indicatorAlreadyAdded = ctx.priorActions.some((a) => (a.chemicalIds || []).some((id) => cat(id) === "indicator"));
    return !indicatorAlreadyAdded;
  },

  // CHEM_005 — choosing a metal that is NOT more reactive than the salt's metal for a displacement.
  less_reactive_metal_chosen_for_displacement: (ctx) => {
    if (!ctx.chemicalsById) return false;
    const doc = (id) => ctx.chemicalsById[asId(id)] || {};
    const rank = (sym) => {
      const i = REACTIVITY_ORDER.indexOf(sym);
      return i === -1 ? 99 : i;
    };
    const addedMetals = (ctx.action.chemicalIds || []).map(doc).filter((c) => c.category === "metal");
    if (!addedMetals.length) return false;
    const priorDocs = ctx.priorActions.flatMap((a) => a.chemicalIds || []).map(doc);
    const salts = priorDocs.filter((c) => c.category === "salt");
    if (!salts.length) return false;
    // Leading element symbol of the salt formula is its cation, e.g. "CuSO4" -> "Cu", "NaCl" -> "Na".
    const cationOf = (formula) => (String(formula || "").match(/^([A-Z][a-z]?)/) || [])[1] || null;
    for (const metal of addedMetals) {
      for (const salt of salts) {
        const saltMetal = cationOf(salt.formula);
        if (saltMetal && REACTIVITY_ORDER.includes(saltMetal) && rank(metal.symbol) >= rank(saltMetal)) return true;
      }
    }
    return false;
  },

  // PHY_010 — pendulum released from beyond the small-angle range.
  pendulum_release_angle_over_15deg: (ctx) =>
    ctx.action.actionType === "set_release_angle" && Number(ctx.action.quantity) > 15,

  // PHY_011 — stopping the timer after a single oscillation.
  timed_single_oscillation: (ctx) => ctx.action.actionType === "stop_timer" && ctx.benchState.timedOscillations <= 1,

  // PHY_013 — recording a full length where the extension was asked for.
  reported_total_length_as_extension: (ctx) =>
    ctx.action.actionType === "read_measurement" &&
    /spring/i.test(ctx.action.equipment || "") &&
    ctx.action.quantity != null &&
    ctx.benchState.lengthsSet.some((L) => L > 0 && Math.abs(Number(ctx.action.quantity) - L) / L < 0.1),
};

// ── Task timeline ────────────────────────────────────────────────────────────────────────────
// From Session.stepProgress[].microSteps[].{startedAt,completedAt} + the practical's expectedIntent,
// build ordered [startedAt, completedAt] windows so each bench action can be attributed to the task
// that was active when it happened.
function buildTaskTimeline({ experiment, session }) {
  const out = [];
  for (const sp of session.stepProgress || []) {
    const expStep = (experiment.steps || []).find((s) => s.stepId === sp.stepId) || null;
    const micro = sp.microSteps || [];
    for (const mp of micro) {
      if (!mp.startedAt) continue;
      const expMs = (expStep?.microSteps || []).find((m) => m.microStepId === mp.microStepId) || null;
      out.push({
        stepId: sp.stepId,
        microStepId: mp.microStepId,
        expectedIntent: expMs?.expectedIntent || null,
        startedAt: new Date(mp.startedAt).getTime(),
        completedAt: mp.completedAt ? new Date(mp.completedAt).getTime() : Infinity,
      });
    }
    if (micro.length === 0 && sp.startedAt) {
      out.push({
        stepId: sp.stepId,
        microStepId: null,
        expectedIntent: null,
        startedAt: new Date(sp.startedAt).getTime(),
        completedAt: sp.completedAt ? new Date(sp.completedAt).getTime() : Infinity,
      });
    }
  }
  return out.sort((a, b) => a.startedAt - b.startedAt);
}

// Attach the task each action was performed under (from the stepProgress timeline) as
// _taskIntent / _taskStepId / _taskMicroStepId. Used by scripts/analysis/export-sessions so an
// offline replay (fit-params) reproduces the live task attribution without the full experiment.
function annotateActionsWithTask({ experiment, session, benchActions }) {
  const timeline = buildTaskTimeline({ experiment: experiment || {}, session: session || {} });
  const currentTask = {
    stepId: session?.currentStep ?? null,
    microStepId: session?.currentMicroStep ?? null,
    expectedIntent: expectedIntentFor(experiment || {}, session?.currentStep, session?.currentMicroStep),
  };
  return (benchActions || []).map((a) => {
    const t = taskForAction(a, { taskTimeline: timeline, currentTask });
    return { ...a, _taskIntent: t.expectedIntent ?? null, _taskStepId: t.stepId ?? null, _taskMicroStepId: t.microStepId ?? null };
  });
}

function expectedIntentFor(experiment, stepId, microStepId) {
  const step = (experiment.steps || []).find((s) => s.stepId === stepId) || null;
  if (!step) return null;
  const ms = (step.microSteps || []).find((m) => m.microStepId === microStepId) || null;
  return ms?.expectedIntent || null;
}

function taskForAction(action, { taskTimeline, currentTask }) {
  // Pre-attributed action (see annotateActionsWithTask) — used by the offline analysis replay so it
  // gets the same task attribution as the live path without the full experiment/session.
  if (Object.prototype.hasOwnProperty.call(action, "_taskIntent")) {
    return { stepId: action._taskStepId ?? null, microStepId: action._taskMicroStepId ?? null, expectedIntent: action._taskIntent };
  }
  if (!taskTimeline || !taskTimeline.length || !action.timestamp) return currentTask;
  const t = new Date(action.timestamp).getTime();
  const containing = taskTimeline.find((w) => t >= w.startedAt && t <= w.completedAt);
  if (containing) return containing;
  const before = [...taskTimeline].reverse().find((w) => w.startedAt <= t);
  return before || currentTask;
}

// ── Bench state (lean — only what the predicates read) ───────────────────────────────────────
function newBenchState() {
  return { chemicalsIntroduced: new Set(), anyReactionFired: false, timedOscillations: 0, lengthsSet: [] };
}
function updateBenchState(bench, action) {
  const type = action.actionType;
  if (type === "start_timer") bench.timedOscillations = 0;
  else if (type === "record_oscillation") bench.timedOscillations += 1;
  else if ((type === "set_length" || type === "set_pendulum_length") && action.quantity != null) {
    bench.lengthsSet.push(Number(action.quantity));
  }
  if (action.resultType === "reaction_success") bench.anyReactionFired = true;
  for (const id of action.chemicalIds || []) bench.chemicalsIntroduced.add(asId(id));
}

// ── Relevant codes / cluster ─────────────────────────────────────────────────────────────────
function resolveRelevantCodes(experiment, signaturesByCode) {
  const codes = new Set(experiment.commonMisconceptions || []);
  for (const s of experiment.steps || []) for (const c of s.misconceptionRisks || []) codes.add(c);
  return [...codes].filter((c) => ((signaturesByCode[c] || {}).behaviouralSignatures || []).length > 0);
}

const CLUSTER_HINTS = [
  { codes: ["CHEM_001", "CHEM_002", "CHEM_003"], label: "acid_base" },
  { codes: ["CHEM_005"], label: "metal_reactivity" },
  { codes: ["PHY_010", "PHY_011", "PHY_012"], label: "pendulum" },
  { codes: ["PHY_013", "PHY_014"], label: "hookes_law" },
];
function inferCluster(relevantCodes, experiment) {
  const set = new Set(relevantCodes);
  for (const h of CLUSTER_HINTS) if (h.codes.some((c) => set.has(c))) return h.label;
  return experiment.subject ? String(experiment.subject).toLowerCase() : null;
}

// ── Sub-goal / divergence (v1.5 — M4) ────────────────────────────────────────────────────────
// Lightweight "is the student working on the task the server thinks they're on?" signal. No HMM
// yet — just: of the last few equipment/chemical-bearing bench actions, how many fit the current
// step's expected equipment/chemical sets. A sustained mismatch (mostly acting on things that
// belong to a different step) raises divergenceFlag, which shouldIntervene turns into a gentle
// "are you still on this task?" nudge (M5). Neutral actions (no equipment, no chemical — a move, a
// timer tick) don't count either way.
const DIVERGENCE_WINDOW = 5;
const DIVERGENCE_MIN_SAMPLES = 3;
const DIVERGENCE_OFFTASK_RATIO = 0.6;

function currentStepExpectedSets(experiment, stepId, microStepId) {
  const step = (experiment.steps || []).find((s) => s.stepId === stepId) || null;
  if (!step) return { equipment: new Set(), chemicals: new Set() };
  const ms = (step.microSteps || []).find((m) => m.microStepId === microStepId) || null;
  const equipment = new Set([...(step.requiredEquipment || []), ...((ms && ms.expectedEquipment) || [])]);
  const chemicals = new Set(
    [...(step.requiredChemicalsForStep || []), ...((ms && ms.expectedChemicalsForStep) || [])].map(asId)
  );
  return { equipment, chemicals };
}

// "on" | "off" | "neutral" for one action against the current task's expected sets.
function actionTaskFit(action, expected) {
  const chemIds = (action.chemicalIds || []).map(asId);
  const hasChem = chemIds.length > 0;
  const hasEquip = !!action.equipment;
  if (!hasChem && !hasEquip) return "neutral";
  if (hasChem && chemIds.some((id) => expected.chemicals.has(id))) return "on";
  if (hasEquip && expected.equipment.has(action.equipment)) return "on";
  return "off";
}

function computeSubGoal({ experiment, session, benchActions }) {
  const stepId = session?.currentStep ?? null;
  const microStepId = session?.currentMicroStep ?? null;
  const base = { nominalMicroStepId: microStepId, onTaskProbability: 1, divergenceFlag: false };
  if (stepId == null || !(experiment.steps || []).length) return base;

  const expected = currentStepExpectedSets(experiment, stepId, microStepId);
  // Nothing to compare against for this task (e.g. OBSERVE/RECORD with no bench requirement).
  if (expected.equipment.size === 0 && expected.chemicals.size === 0) return base;

  const window = benchActions.slice(-DIVERGENCE_WINDOW);
  const fits = window.map((a) => actionTaskFit(a, expected)).filter((f) => f !== "neutral");
  if (fits.length < DIVERGENCE_MIN_SAMPLES) return base;

  const onCount = fits.filter((f) => f === "on").length;
  const onTaskProbability = round(onCount / fits.length, 2);
  return {
    nominalMicroStepId: microStepId,
    onTaskProbability,
    divergenceFlag: onCount / fits.length <= 1 - DIVERGENCE_OFFTASK_RATIO,
  };
}

// ── computeStudentModel ──────────────────────────────────────────────────────────────────────
/**
 * @param experiment       populated Experiment (steps[].misconceptionRisks / microSteps[].expectedIntent,
 *                          commonMisconceptions, requiredChemicals)
 * @param session          lean Session (currentStep, currentMicroStep, stepProgress)
 * @param benchActions      labRun.actions[] as a plain ordered array
 * @param signaturesByCode  { [code]: MisconceptionDoc } — the relevant KB docs, loaded by the caller
 * @param chemicalsById     optional { [id]: { symbol, category, formula, ... } } — enables the
 *                          category-aware predicates; without it they simply never fire
 * @param taskTimeline      optional precomputed timeline (else derived from session.stepProgress)
 * @param paramOverrides    optional { priors: {[code]: logOdds}, llr: {[predicate]: number} } —
 *                          used only by scripts/analysis/fit-params.js to try alternative
 *                          parameters against labelled data without editing the KB
 * @returns the Session.studentModel sub-doc shape (not persisted)
 */
function computeStudentModel({
  experiment,
  session,
  benchActions = [],
  signaturesByCode = {},
  chemicalsById = null,
  taskTimeline = null,
  paramOverrides = null,
}) {
  const relevantCodes = resolveRelevantCodes(experiment || {}, signaturesByCode);
  const timeline = taskTimeline || buildTaskTimeline({ experiment: experiment || {}, session: session || {} });
  const currentTask = {
    stepId: session?.currentStep ?? null,
    microStepId: session?.currentMicroStep ?? null,
    expectedIntent: expectedIntentFor(experiment || {}, session?.currentStep, session?.currentMicroStep),
  };
  const priorOverride = paramOverrides?.priors || {};
  const llrOverride = paramOverrides?.llr || {};

  const state = {};
  for (const code of relevantCodes) {
    const authoredPrior = (signaturesByCode[code] || {}).behaviouralPriorLogOdds;
    const prior = priorOverride[code] ?? (authoredPrior == null ? DEFAULT_PRIOR_LOG_ODDS : authoredPrior);
    state[code] = { logOdds: prior, evidence: [], matchCounts: {} };
  }

  const bench = newBenchState();

  benchActions.forEach((action, actionIndex) => {
    updateBenchState(bench, action);
    const task = taskForAction(action, { taskTimeline: timeline, currentTask });
    const ctx = {
      action,
      actionIndex,
      priorActions: benchActions.slice(0, actionIndex),
      recentActions: benchActions.slice(Math.max(0, actionIndex - 5), actionIndex),
      benchState: bench,
      task,
      chemicalsById,
      experiment: experiment || {},
    };

    for (const code of relevantCodes) {
      const sigs = (signaturesByCode[code] || {}).behaviouralSignatures || [];
      for (const sig of sigs) {
        if (sig.whenIntent && sig.whenIntent.length && !sig.whenIntent.includes(task.expectedIntent)) continue;
        const fn = PREDICATES[sig.predicate];
        if (!fn) continue;
        let matched = false;
        try {
          matched = !!fn(ctx);
        } catch {
          matched = false;
        }
        if (!matched) continue;

        const n = (state[code].matchCounts[sig.predicate] = (state[code].matchCounts[sig.predicate] || 0) + 1);
        const baseLlr = llrOverride[sig.predicate] ?? (sig.logLikelihoodRatio || 1.0);
        const delta = baseLlr / n; // damped repeat
        state[code].logOdds = clampN(state[code].logOdds + delta, -LOG_ODDS_CLAMP, LOG_ODDS_CLAMP);
        if (state[code].evidence.length < MAX_EVIDENCE_PER_CODE) {
          state[code].evidence.push({
            actionIndex,
            stepId: task.stepId ?? null,
            microStepId: task.microStepId ?? null,
            predicate: sig.predicate,
            deltaLogOdds: round(delta, 3),
            at: action.timestamp || null,
          });
        }
      }
    }
  });

  const misconceptions = relevantCodes
    .map((code) => ({
      code,
      priorLogOdds: round((signaturesByCode[code] || {}).behaviouralPriorLogOdds ?? DEFAULT_PRIOR_LOG_ODDS),
      logOdds: round(state[code].logOdds),
      probability: round(sigmoid(state[code].logOdds), 4),
      evidence: state[code].evidence,
    }))
    .sort((a, b) => b.probability - a.probability);

  return {
    cluster: inferCluster(relevantCodes, experiment || {}),
    misconceptions,
    subGoal: computeSubGoal({ experiment: experiment || {}, session: session || {}, benchActions }),
    shadowRuleMisconceptions: [], // filled by aiService.analyzeSession in shadow mode
    computedFromActionCount: benchActions.length,
    updatedAt: new Date(),
  };
}

// ── diagnose ─────────────────────────────────────────────────────────────────────────────────
function firstEvidenceStep(evidence = []) {
  const e = evidence.find((x) => x.stepId != null);
  return e ? e.stepId : null;
}
function diagnose({ studentModel, signaturesByCode = {}, threshold = DIAGNOSE_THRESHOLD } = {}) {
  return (studentModel?.misconceptions || [])
    .filter((m) => m.probability >= threshold)
    .map((m) => {
      const kb = signaturesByCode[m.code] || {};
      return {
        code: m.code,
        title: kb.title || null,
        description: kb.description || null,
        correctionStrategy: kb.correctionStrategy || null,
        relatedConcepts: kb.relatedConcepts || [],
        relatedStep: firstEvidenceStep(m.evidence),
        probability: m.probability,
        evidence: m.evidence,
      };
    })
    .sort((a, b) => b.probability - a.probability);
}

// ── shouldIntervene ──────────────────────────────────────────────────────────────────────────
/**
 * @param task                  { stepId, microStepId, expectedIntent } — the CURRENT task
 * @param alreadyIntervenedCodes codes already surfaced for this task this session (no repeats)
 */
function shouldIntervene({ studentModel, task, signaturesByCode = {}, alreadyIntervenedCodes = [] } = {}) {
  const intent = task?.expectedIntent || null;
  const candidates = (studentModel?.misconceptions || []).filter((m) => {
    if (alreadyIntervenedCodes.includes(m.code)) return false;
    const sigs = (signaturesByCode[m.code] || {}).behaviouralSignatures || [];
    return sigs.some((sg) => !sg.whenIntent || !sg.whenIntent.length || (intent && sg.whenIntent.includes(intent)));
  });
  const top = candidates.sort((a, b) => b.probability - a.probability)[0];

  if (top && top.probability >= INTERVENE_THRESHOLD) {
    const level = top.probability >= 0.85 ? 3 : top.probability >= 0.75 ? 2 : 1;
    return { intervene: true, reason: "misconception", misconceptionCode: top.code, probability: top.probability, level };
  }
  if (studentModel?.subGoal?.divergenceFlag) {
    return { intervene: true, reason: "divergence", misconceptionCode: null, probability: 0, level: 1 };
  }
  return { intervene: false, reason: null, misconceptionCode: null, probability: top?.probability ?? 0, level: 0 };
}

module.exports = {
  computeStudentModel,
  diagnose,
  shouldIntervene,
  buildTaskTimeline,
  annotateActionsWithTask,
  PREDICATES,
  DEFAULT_PRIOR_LOG_ODDS,
  DIAGNOSE_THRESHOLD,
  INTERVENE_THRESHOLD,
  _internal: { sigmoid, expectedIntentFor, resolveRelevantCodes, inferCluster, taskForAction, computeSubGoal, currentStepExpectedSets },
};
