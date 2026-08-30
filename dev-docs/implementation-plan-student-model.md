# Implementation Plan — Bayesian Misconception Student Model

Status: engineering plan (ready to execute)
Companion to: [research-direction.md](./research-direction.md) — read §2 (claim), §5 (method), §6 (codebase map) first.
Scope: `AI-Guided-Virtual-Science-Lab-Service`. Mobile: one optional report-screen addition, noted at the end.

---

## 0. Guiding principles (why this is safe)

1. **Read-time computation, not scattered writes.** The posterior is recomputed from scratch by
   replaying `LabRun.actions[]` whenever it is needed (graded attempt, hint request, completion).
   It is never incrementally mutated across request handlers, so there is no ordering hazard, no
   save race, and no way to corrupt `Session`/`LabRun` state. A cached snapshot is stored on
   `Session.studentModel` purely for the report and for analysis export.
2. **Additive schema only.** Two new optional fields. Every existing query, `.select()`, controller,
   and the mobile app keep working unchanged with old and new documents.
3. **New logic lives in a new pure module** (`services/studentModelService.js`) — plain functions
   over plain objects, fully unit-testable, no DB access of its own.
4. **Flag-gated, shadow-first.** Ships computing-but-not-driving. The old rule engine stays wired
   until an explicit flag flip. The flip is also the RCT manipulation.
5. **Fallback preserved.** If the posterior is inconclusive, or a flag is off, behaviour is exactly
   today's (`mismatchKind` hints, 6-rule `analyzeSession`).

---

## 1. Workstreams (run in parallel)

| # | Workstream | Owner surface | Depends on |
|---|---|---|---|
| **A** | Model engine — `studentModelService` + tests + test infra | new files | — |
| **B** | Content — misconception error signatures for the acid–base cluster | `data/misconceptions.js`, `models/Misconception.js` | A's signature format |
| **C** | Tutor integration — hooks in `logAction` / `requestHint` / `analyzeSession`, new hint generator, flags, RCT arm | existing controllers/services | A + B |
| **D** | Research ops — two-tier concept inventory, consent/ethics, analysis scripts | `scripts/analysis/`, non-code | independent |

Critical path: **A → B → C**. D is independent and should start immediately (ethics approval is the
long pole — see research-direction.md §8).

---

## 2. Milestones

| Milestone | Deliverable | Acceptance criteria |
|---|---|---|
| **M0 — Test bootstrap** | `node:test` wired; `npm test` runs; one trivial passing test | `npm test` green in CI-less local run; documented in README |
| **M1 — Signature schema + authoring** | `Misconception.behaviouralSignatures[]`; signatures authored for acid–base codes; seed updated | `npm run seed` loads signatures; a script prints each code's signatures; peer/expert review sign-off |
| **M2 — Model engine (v1)** | `studentModelService.computeStudentModel` / `diagnose` / `shouldIntervene`; predicate registry; fixture tests | ≥1 trajectory fixture per signature, each asserting posterior moves the right way; ≥90 % line coverage of the service |
| **M3 — Persistence + shadow mode** | `Session.studentModel` snapshot written on graded attempt + completion; both new posterior and old rule output stored side by side | A real end-to-end session (manual/scripted) shows a populated `studentModel` with an evidence trail; old hints/report unchanged |
| **M4 — Sub-goal / divergence (v1.5)** | lightweight divergence flag (acting on another step's equipment/chemicals); optional HMM refinement | divergence flag fixture tests; no behaviour change while flag off |
| **M5 — Tutor integration behind flags** | posterior-driven intervention timing + `generateMisconceptionHint` + diagnosis in report; `STUDENT_MODEL_DRIVES_*` flags; `Session.experimentArm` | with flags on, a fixture session produces a misconception-targeted hint and a posterior-based report section; with flags off, byte-identical to today |
| **M6 — Analysis tooling** | `scripts/analysis/export-sessions.js`, `fit-params.js`, `predictive-validity.js` | exports a clean per-session CSV/JSON; computes AUC of posterior vs. a labelled column |

---

## 3. Component specs

### 3.1 Schema changes

**`models/Misconception.js`** — add:

```js
// What this misconception looks like AS BEHAVIOUR on the virtual bench. Authored at design time
// from published diagnostic-test literature (see behaviouralSignatures[].source). Consumed only by
// services/studentModelService.js. Absent/empty → this code is never inferred behaviourally
// (falls back to the legacy conceptViolated-tag path in aiService.analyzeSession).
behaviouralSignatures: [
  {
    // expectedIntent values this signature is evaluated under; [] = any task.
    whenIntent: [{ type: String }],
    // Named predicate in studentModelService.PREDICATES, evaluated against
    // { action, recentActions, benchState, task, stepProgress }. The declarative "what does the
    // wrong action look like" — the tricky logic stays in tested code, the DB only references it.
    predicate: { type: String, required: true },
    // commission = did a characteristic wrong thing; omission = skipped a characteristic right
    // thing; sequence = right things in the wrong order.
    evidenceType: { type: String, enum: ["commission", "omission", "sequence"], default: "commission" },
    // How strongly one match shifts the log-odds toward "held". Positive. Start 0.8–1.6;
    // tune via EM (research-direction.md §5.6). A repeated match compounds (capped, see service).
    logLikelihoodRatio: { type: Number, default: 1.0 },
    source: { type: String, default: "" }, // citation / rationale for authoring audit
  },
],
```

**`models/Session.js`** — add:

```js
// Snapshot of the Bayesian misconception posterior (services/studentModelService.js), recomputed
// from the bench action log on each graded attempt / hint / completion and cached here for the
// report and for research export. Always recomputable — never the source of truth on its own.
studentModel: {
  cluster: { type: String, default: null }, // signature set in play, e.g. "acid_base"
  misconceptions: [
    {
      code: { type: String },
      priorLogOdds: { type: Number, default: 0 },
      logOdds: { type: Number, default: 0 },
      probability: { type: Number, default: 0.5 }, // sigmoid(logOdds), denormalised
      evidence: [
        {
          actionIndex: { type: Number },
          stepId: { type: Number },
          microStepId: { type: Number, default: null },
          predicate: { type: String },
          deltaLogOdds: { type: Number },
          at: { type: Date },
        },
      ],
    },
  ],
  subGoal: {
    nominalMicroStepId: { type: Number, default: null }, // what the server thinks
    onTaskProbability: { type: Number, default: 1 },
    divergenceFlag: { type: Boolean, default: false },
  },
  // Shadow-mode comparison: what aiService.analyzeSession's rules concluded, kept alongside so the
  // analysis scripts can compare without re-running the rules.
  shadowRuleMisconceptions: [{ type: String }],
  computedFromActionCount: { type: Number, default: 0 },
  updatedAt: { type: Date, default: null },
},

// RCT arm — assigned once at startSession, read by the STUDENT_MODEL_DRIVES_* flag checks.
// "off" = feature globally disabled; the flags ignore the arm.
experimentArm: { type: String, enum: ["treatment", "control", "off"], default: "off" },
```

Both are optional sub-docs → **no migration required** for the schema itself. Backfill (§6) is only
about populating `studentModel` for already-completed sessions if you want them in the analysis.

### 3.2 `services/studentModelService.js` — public API

```js
// PURE. No mongoose, no I/O. Caller loads inputs and persists outputs.

/**
 * Full recompute of the misconception + sub-goal posterior by replaying the bench action log.
 * Stateless and idempotent — safe on every read.
 *
 * @param experiment        populated Experiment (needs steps[].misconceptionRisks,
 *                           steps[].microSteps[].expectedIntent/expectedEquipment/…, commonMisconceptions)
 * @param session           lean Session (needs currentStep, currentMicroStep, stepProgress)
 * @param benchActions       labRun.actions[] as a plain array, in order
 * @param signaturesByCode   { [code]: { description, correctionStrategy, behaviouralSignatures[] } }
 *                           — the relevant Misconception docs, loaded by the caller
 * @returns studentModel     the sub-doc shape from §3.1 (not yet persisted)
 */
function computeStudentModel({ experiment, session, benchActions, signaturesByCode }) { /* … */ }

/**
 * Report form. Filters to codes above threshold, attaches KB text.
 * @returns [{ code, description, correctionStrategy, probability, evidence[] }]
 */
function diagnose({ studentModel, signaturesByCode, threshold = 0.55 }) { /* … */ }

/**
 * Intervention decision for the CURRENT task.
 * @param alreadyIntervenedCodes  codes already surfaced for this task this session (no repeats)
 * @returns { intervene: boolean, reason: "misconception"|"divergence"|null,
 *            misconceptionCode: string|null, probability: number, level: 1|2|3 }
 */
function shouldIntervene({ studentModel, session, task, alreadyIntervenedCodes = [] }) { /* … */ }

// --- internals (exported for tests) ---
const PREDICATES = { /* name -> ({ action, recentActions, benchState, task, stepProgress }) => boolean */ };
function evaluateSignature(sig, ctx) { /* … */ }
function sigmoid(x) { /* … */ }
```

**Algorithm inside `computeStudentModel`:**

1. Resolve `relevantCodes` = unique union of `experiment.commonMisconceptions` and every
   `step.misconceptionRisks` / `microStep`-level risk for this practical, intersected with codes
   that actually have `behaviouralSignatures`. Seed each with `logOdds = priorLogOdds` (default 0 →
   P = 0.5; can be authored lower, e.g. −1.4 → P ≈ 0.2, since most students don't hold most bugs).
2. Walk `benchActions` in order, keeping a rolling window `recentActions` (last 5) and a running
   `benchState` reconstruction (which instances hold what — reuse the reduction already implied by
   `labRun.equipment`; for v1 a coarse "chemicals seen / heated / measured" set is enough).
3. Derive the `task` context for each action from `session.currentStep/currentMicroStep` **as of
   that action** — v1 approximation: use the *final* `currentStep/currentMicroStep` is wrong for
   history, so instead map each action to a task by matching its `actionType`/targets to the
   step whose `expectedIntent`/`expectedEquipment` it fits, falling back to "unknown". (M4 upgrades
   this to the HMM sub-goal posterior.)
4. For each `relevantCode`, for each of its `behaviouralSignatures` whose `whenIntent` matches the
   action's task intent: `evaluateSignature(sig, ctx)`. On a match, `logOdds += sig.logLikelihoodRatio`
   (dampened: the *n*-th match of the same signature contributes `LLR / n` so one mistake repeated
   10× doesn't peg the posterior); append an `evidence` entry.
5. `probability = sigmoid(logOdds)`. Clamp `logOdds` to ±6 (P ∈ [0.0025, 0.9975]) so nothing is
   ever "certain".
6. Sub-goal: v1 sets `divergenceFlag` if ≥3 of the last 5 actions map to a step other than
   `session.currentStep`. `onTaskProbability` = fraction of last 5 on the nominal step.

**Complexity:** O(actions × codes × signatures) ≈ 60 × 5 × 3 = 900 predicate calls per recompute.
Sub-millisecond. Memoise `signaturesByCode` in-process (changes only on redeploy).

### 3.3 Predicate registry (starter set — acid–base + a physics sample)

| Predicate name | Fires when | For code |
|---|---|---|
| `heat_when_not_expected` | `action.actionType === "heat"` and current task intent ∉ {`HEAT_SAMPLE`} | "heating always enables/speeds a reaction" |
| `thermometer_for_endpoint` | `probe_measure`/`read_measurement` with a thermometer during an `ADD_REAGENT(indicator)` or endpoint task | `CHEM_002` (indicator ↔ temperature) |
| `indicator_after_base` | `add_chemical(indicator-category)` appears in `recentActions` *after* a base was already added | `CHEM_001` (order doesn't matter) |
| `ph7_endpoint_claim` | `probe_measure` reading ∈ [6.8, 7.2] on a RECORD/MEASURE endpoint task, with no prior indicator colour-change observation | "neutralization always gives pH 7" |
| `mix_unrelated_reagents` | `add_chemical` producing `resultType === "no_reaction"` on two non-reacting substances, on a MIX task | "all liquids react" |
| `less_reactive_metal_chosen` | metal-displacement MIX task, chosen metal is below the salt's metal in the reactivity order | `CHEM_005` |
| `release_angle_gt_15` | `set_release_angle` with `quantity > 15` | `PHY_010` |
| `single_oscillation_timing` | `stop_timer` with bench `oscillationCount <= 1` | `PHY_011` |
| `reports_total_length_as_extension` | Hooke `read_measurement` where the recorded value ≈ extended length, not (extended − natural) | `PHY_013` |

Predicates that need bench context (`ph7_endpoint_claim`, `single_oscillation_timing`) read the
reconstructed `benchState` / the action's own `quantity`/`resultType` fields — all already present
on `labRun.actions[]` sub-docs (see `models/LabRun.js` `actionSchema`).

### 3.4 Integration points (all flag-gated)

| File / function | Change | Flag |
|---|---|---|
| `controllers/session.controller.js#startSession` | assign `session.experimentArm` (random treatment/control, or `"off"` when `STUDENT_MODEL_ENABLED` is false) | `STUDENT_MODEL_ENABLED` |
| `controllers/session.controller.js#logAction` | after grading, before the intervention block (~L874): load `labRun.actions` + relevant Misconception docs → `computeStudentModel` → assign `session.studentModel`. **If** `drivesHints(session)` and `shouldIntervene(...)` → build a `generateMisconceptionHint` intervention **instead of** the `mismatchKind` branch; else unchanged. | `STUDENT_MODEL_DRIVES_HINTS` |
| `controllers/session.controller.js#requestHint` | consult `session.studentModel` (recompute) for `probableMisconception`; when present and `drivesHints`, route to `generateMisconceptionHint`; else today's equipment/chemical branch, now passed `probableMisconception` as optional context | `STUDENT_MODEL_DRIVES_HINTS` |
| `controllers/session.controller.js#completeSession` | before `analyzeSession`: final `computeStudentModel` → persist snapshot + `shadowRuleMisconceptions` | `STUDENT_MODEL_ENABLED` |
| `services/aiService.js#analyzeSession` | when `drivesDiagnosis(session)`: `misconceptionsDetected = studentModelService.diagnose(session.studentModel, …)` merged with any legacy tag-based hits; rules 5–6 (strengths) unchanged. When flag off: today's 6 rules, but also store what `diagnose` *would* say into `studentModel.shadowRuleMisconceptions` inverse — actually store the rule output there. | `STUDENT_MODEL_DRIVES_DIAGNOSIS` |
| `services/labHintService.js` | **new** `generateMisconceptionHint({ experimentTitle, studentPrompt, misconceptionCode, misconceptionDescription, correctionStrategy, level })` + deterministic fallback templated from `correctionStrategy`. Existing `generateEquipmentHint`/`generateChemicalHint` gain optional `probableMisconception` context arg (purely additive to the prompt). | — |
| `controllers/labRun.controller.js#logLabAction` | **no change in v1.** Bench actions are already persisted to `labRun.actions[]`; the model reads them at the session endpoints. (Freeform-run diagnosis is future work — needs a `LabRun.studentModel` mirror.) | — |

**Flag helpers** (new `config/featureFlags.js`):

```js
const STUDENT_MODEL_ENABLED = process.env.STUDENT_MODEL_ENABLED === "true";
const drivesHints = (session) =>
  STUDENT_MODEL_ENABLED &&
  process.env.STUDENT_MODEL_DRIVES_HINTS === "true" &&
  session.experimentArm === "treatment";
const drivesDiagnosis = (session) =>
  STUDENT_MODEL_ENABLED &&
  process.env.STUDENT_MODEL_DRIVES_DIAGNOSIS === "true" &&
  session.experimentArm === "treatment";
```

Shadow mode = `STUDENT_MODEL_ENABLED=true` + both `DRIVES_*` unset. Pilot/RCT = set `DRIVES_*=true`
and the arm split does the rest.

### 3.5 New hint generator prompt (`generateMisconceptionHint`)

```
You are a Sri Lankan O/L science teacher helping a Grade {grade} student working ALONE in a
virtual lab on "{experimentTitle}". Their current task: "{studentPrompt}".

From how they have been using the equipment, they appear to hold this misconception:
"{misconceptionDescription}"

Write ONE short hint (max 30 words, hint level {level} of 3) that gently makes them question that
specific belief — WITHOUT naming the correct equipment/chemical or giving the step away.
- Level 1: a reflective question about the underlying idea
- Level 2: contrast the belief with what actually drives the result
- Level 3: near-explicit about the principle, still not the exact action
No quotation marks. No markdown.
```

Fallback (LLM down): `Level {level}: {correctionStrategy}` trimmed to one sentence.

---

## 4. Testing strategy

**Test infra (M0):** use built-in `node:test` + `node:assert` — zero new dependencies.
`package.json` → `"test": "node --test test/"`. Add `test/` dir. Document in README.

| Layer | Tests |
|---|---|
| Predicates | table-driven: `(predicate, ctx) → expected boolean`, one row per predicate incl. near-miss cases |
| `computeStudentModel` | **fixture per signature** — `test/fixtures/traj-CHEM_002-heats-for-endpoint.json` = an ordered action array; assert `P(CHEM_002) > 0.6` and `P(other) < 0.4` after replay. Plus a "clean run" fixture asserting all posteriors stay near prior. |
| `diagnose` | threshold filtering; KB join; empty-model → `[]` |
| `shouldIntervene` | fires above threshold; no-repeat per task; divergence path |
| Integration | scripted session: `startSession` → POST bench actions → POST attempts → `completeSession`; assert `studentModel` populated + (flag on) report contains the seeded misconception + (flag off) response byte-identical to a recorded baseline |
| Regression | snapshot the current `analyzeSession` output + `logAction` intervention payloads for 3 canned sessions **before** touching anything; assert unchanged with flags off after every milestone |

Build the **regression snapshots first** (part of M0). They are the safety net.

---

## 5. Shadow-mode rollout

1. Deploy M3 with `STUDENT_MODEL_ENABLED=true`, `DRIVES_*` unset. Real sessions now carry a
   `studentModel` snapshot; nothing user-visible changes.
2. Run for a week of internal/pilot use. Export with `scripts/analysis/export-sessions.js`.
3. Manually inspect ~20 sessions: does the posterior move sensibly? Any signature that never fires,
   or fires on everyone? Tune `logLikelihoodRatio` / `priorLogOdds`, re-seed, no redeploy of logic.
4. Only then M5 flag flip, and only for the pilot cohort (`experimentArm` gating).

## 6. Migration & backfill

- **Schema:** none required (additive optional fields).
- **Signatures:** `npm run seed` picks them up (they live in `data/misconceptions.js`). For a live
  DB without a reseed, add `data/migrations/2026xxxx-behavioural-signatures.js` (additive, mirrors
  the existing migration pattern — see `data/migrations/README.md`): sets `behaviouralSignatures`
  on the affected codes, touches nothing else.
- **Historical sessions:** optional `scripts/analysis/backfill-student-model.js` — for each completed
  Session with a `labRunId`, load `labRun.actions`, `computeStudentModel`, write the snapshot. Read
  + one write per session; safe to re-run.

## 7. Sequencing & rough effort (one developer)

| Milestone | Effort | Can start |
|---|---|---|
| M0 test bootstrap + regression snapshots | 1–2 d | now |
| M1 signature schema + acid–base authoring | 2–3 d (+ expert review) | after M0 |
| M2 model engine v1 + fixtures | 4–6 d | after M1 |
| M3 persistence + shadow mode | 2–3 d | after M2 |
| M4 divergence flag | 1–2 d | after M3 (optional before pilot) |
| M5 tutor integration + flags + arm | 3–4 d | after M3 |
| M6 analysis scripts | 2–3 d | parallel with M4/M5 |
| **Total to pilot-ready** | **~3–4 weeks** | |

Workstream D (concept inventory, ethics) runs alongside and gates the *study*, not the code.

## 8. Definition of done (feature)

- [ ] `npm test` green; regression snapshots unchanged with flags off
- [ ] `studentModel` populated on every new completed session in shadow mode, with a non-empty
      evidence trail on sessions where a misconception was exhibited
- [ ] With `DRIVES_*` on for a `treatment` session: at least one misconception-targeted hint and a
      posterior-based report section; `control` sessions identical to today
- [ ] Every signature has ≥1 fixture test and a `source` citation
- [ ] `scripts/analysis/predictive-validity.js` produces AUC of first-half posterior vs. a labelled
      outcome column
- [ ] README documents the flags, the arm field, and how to run the analysis scripts

## 8b. Progress log

| Date | Milestone | Notes |
|---|---|---|
| 2026-08-30 | **M0 — done** | `npm test` wired (`node --test`, zero deps, Node 24). `test/` created: `smoke`, `fixtures/sessions.js`, and regression golden-output guards for `labScoringService` / `reportAnalyticsService` / `curriculumReferenceService` (19 tests, green). `test/README.md` documents the setup + snapshot-refresh flow. Found: `Misconception.detectionTriggers[]` already exists in schema + data but is **read by no code** — it is the dormant hook `behaviouralSignatures[]` (M1) formalises. |
| 2026-08-30 | **M1 — done** | `models/Misconception.js` + `behaviouralSignatures[]` (`whenIntent`/`predicate`/`evidenceType`/`logLikelihoodRatio`/`source`) and `behaviouralPriorLogOdds` — both additive/optional, no behaviour change. Signatures authored in `data/misconceptions.js` for the **acid–base cluster** (CHEM_001/002/003/004) + CHEM_005/006 + 3 physics samples (PHY_010/011/013), each with a literature `source`. 11 predicate names defined (impl in M2). `data/migrations/20260830-behavioural-signatures.js` (additive reconcile, mirrors existing migration pattern). `test/unit/misconception-signatures.test.js` lints every signature (valid intents, sane LLR, citation present) — 23 tests green. `npm run seed` needs no change (raw `insertMany` passes the new fields through). |
| 2026-08-30 | **M2 — done** | `services/studentModelService.js` (**new, pure, ~360 lines**): `computeStudentModel` (naive-Bayes log-odds per misconception, damped repeats, clamp ±6, task attribution via `buildTaskTimeline` from `stepProgress` timing with a `currentTask` fallback for the live call), `diagnose`, `shouldIntervene`, plus the 10 wired predicates. `test/fixtures/trajectories.js` (scenario builder + `signaturesByCode` from the real authored data). `test/unit/student-model.test.js` — one trajectory per signature + positive/negative pairs + `diagnose`/`shouldIntervene`/clean-run/timeline-fallback (25 tests). **Full suite 44 green; `studentModelService` line coverage 96%.** No `src/` behaviour change yet — service is not called from anywhere (M3 wires it). CHEM_005 predicate is best-effort (needs `chemicalsById` + formula cation parse); degrades to `false` without it. |
| 2026-08-30 | **M5 — done** | Behind `STUDENT_MODEL_DRIVES_HINTS` / `STUDENT_MODEL_DRIVES_DIAGNOSIS` + `treatment` arm: **`logAction`** computes the model per-attempt (from `evalResult.labRun.actions` — no extra query), persists the snapshot, and — when driving — a `misconception_hint` / `divergence_nudge` takes priority over the `mismatchKind` chain (falls straight through otherwise). **`requestHint`** routes to a misconception-targeted hint when the model is confident. **`completeSession`** computes the model *before* `analyzeSession` and passes `{ modelDiagnosis }`. **`aiService.analyzeSession(session, actions, opts)`** — `opts.modelDiagnosis` replaces the rule-derived `misconceptionsDetected` (+ drives `conceptsToImprove`); the rule codes are returned on `_ruleMisconceptions` and stored as `studentModel.shadowRuleMisconceptions`. **`labHintService.generateMisconceptionHint`** (new, §3.5 prompt + `correctionStrategy`-based fallback) + an `off_task` intervention string. **`getSessionReport`** adds `misconceptionInsight` (probability + signal count) for treatment sessions, `null` otherwise. `studentModelRunner.computeLive` (no LabRun query variant). Tests: `m5-diagnosis-swap.test.js` + `integration/log-action.test.js` (mongoose mocked — exercises all four flag states end-to-end). **Full suite 65 green.** ⚠ **Latent bug fixed as a side effect:** `logAction`'s `evalResult` was `const`-scoped inside `if (step)` but read by the chemical-mismatch intervention branch *outside* it — that branch has been throwing `ReferenceError` (→ 500, after the action was already saved) whenever a student had the right equipment but a missing chemical on a graded task. Hoisted to `let` at function scope; `integration/log-action.test.js` guards it. |
| 2026-08-30 | **M4 — done** | `studentModelService.computeSubGoal` replaces the stub: of the last 5 equipment/chemical-bearing bench actions, what fraction fit the current step's expected equipment/chemical sets → `subGoal.onTaskProbability`; a sustained mismatch (≤40% on-task over ≥3 samples) sets `divergenceFlag`. Neutral actions (no equipment, no chemical) and tasks with no bench requirement never trigger it. Flows into the shadow-mode snapshot automatically; `shouldIntervene`'s divergence branch (from M2) now has a real signal. `inspect-student-model.js` prints it. `test/unit/student-model.test.js` +6 divergence tests. **Full suite 56 green; service line coverage 97%.** Full HMM sub-goal inference still deferred (implementation-plan §9). |
| 2026-08-30 | **M3 — done** | `models/Session.js` + `studentModel` sub-doc and `experimentArm` (both additive/optional). `config/featureFlags.js` (new): `isStudentModelEnabled()`, `experimentArmForUser()` (stable per-user 50/50, md5-based), `studentModelDrivesHints/Diagnosis(session)` (all gated on feature + drive-flag + `treatment` arm). `services/studentModelRunner.js` (new): impure loader — pulls `labRun.actions`, the signature-bearing Misconception docs (in-process cached), a Chemical lookup; calls the pure service; `diagnoseFromSnapshot`. Wired into `session.controller.js`: `startSession` assigns the arm; `completeSession` computes + persists the snapshot **in a non-fatal try/catch, gated on `isStudentModelEnabled()`** and stores `shadowRuleMisconceptions` (the rule codes) alongside — **shadow mode: nothing the student sees changes.** `scripts/analysis/inspect-student-model.js` (new, read-only): recomputes + prints the posterior vs. the rule output for recent/one completed session(s). Tests: `feature-flags.test.js`, `student-model-runner.test.js` (models mocked, no DB). **Full suite 51 green.** Deviation from §3.4: per-graded-attempt persistence deferred to M5 (no consumer in shadow mode; M6 analysis scripts replay action-log prefixes for the "first-half posterior" instead of needing stored per-attempt snapshots). |

---

## 9. Out of scope (explicitly)

- Freeform-run diagnosis (`LabRun.studentModel`) — future.
- Full HMM sub-goal inference — M4 ships the lightweight divergence flag; HMM is a research
  refinement (research-direction.md §5.4).
- Joint (non-independent) misconception inference — decide from shadow-mode data (research-direction.md §5.4 step 3).
- Any teacher-facing surface — out of scope by product design (research-direction.md §3).
- Mobile: the report screen can render the new `diagnosis[]` (probability bar + "why we think this"
  evidence list + textbook link). One screen, additive. Not required for the studies — the backend
  report payload is the measured artefact.
