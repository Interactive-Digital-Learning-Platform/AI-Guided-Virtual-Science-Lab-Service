# Research Direction — Establishing a Defensible Novel Contribution

Status: research framing + implementation plan (proposal)
Scope: `AI-Guided-Virtual-Science-Lab-Service` (backend method + evaluation). Mobile changes noted, not detailed.
Audience: thesis committee / advisor / paper reviewers, and whoever implements the model.

---

## 1. The problem with the current contribution claim

`PROJECT_STATUS.md` §8 states the research contribution is *"the combination of AI-guided tutoring +
student behaviour analysis + misconception detection + adaptive feedback generation."*

**A combination of known techniques is not a novel contribution.** Every component is recognizable
prior art:

| Component (as built) | Prior art it maps to |
|---|---|
| Curated reaction DB + constrained virtual bench | School-level virtual labs — ChemCollective, PhET, Labster |
| Progressive non-revealing hint ladder + gated answer reveal | Cognitive Tutor hint model (Anderson et al., 1995); VanLehn (2006) |
| Server-authoritative grading against simulation state | Sound engineering, not a research result |
| Behaviour flags: `errorRate > 0.4`, `≥3 hints`, `< 10 s ⇒ rushed`, `≥2 retries ⇒ struggled` | Hand-tuned heuristics — the weakest link; a committee attacks this first |
| "LLM rephrases verified analytics, never computes numbers" | Grounded/constrained generation — a good pattern, now common |
| RAG over the national textbook for hint/report citations | Retrieval-augmented generation — currently framed as integration, not method |

The `aiService.analyzeSession` engine ([src/services/aiService.js](../src/services/aiService.js)) is
six `if` statements over aggregate counters. That is the single biggest obstacle to a research-level
claim, and also the biggest opportunity: **turn it into a model.**

---

## 2. Who this is for, and the novel claim

### 2.1 The user: a student learning alone

This is a **student-only** application. There is no teacher account, no class dashboard, no
live supervision — by design. The target user is a Grade 10/11 student in the Sri Lankan O/L
system who is doing a practical **without a teacher present and often without ever having seen
a real school laboratory**. Lab access and expert practical-work support are both scarce in
this context; the app is meant to stand in for the part of a teacher a self-studying student
most lacks.

A good teacher circulating a real lab does three things the current app cannot:

1. **Notices *why* a student is stuck** — reads their hands, not just their answer, and infers
   the misconception behind the mistake.
2. **Intervenes at the right moment with the right thing** — leaves a merely-slow student
   alone; leans in for a student whose actions reveal a specific wrong belief.
3. **Explains in the student's own terms** — using the words, examples and page references of
   the class they actually sit in.

The novelty is making a self-contained app deliver all three to an unsupervised learner.

### 2.2 Thesis statement

> For a student performing science practicals **alone, with no teacher in the loop**, conceptual
> misconceptions can be **diagnosed from the procedural trajectory** the student produces at a
> virtual laboratory bench — the sequence of tool and reagent choices, transfer methods, action
> ordering, measurement decisions and error-recovery patterns — using a **probabilistic
> plan-recognition student model** over an authored library of misconception-specific error
> signatures. The resulting mid-session diagnosis has **predictive validity** for that student's
> later conceptual errors, and using it to time and target guidance produces **higher normalized
> learning gains** than the same app with heuristic, answer-level feedback — with every piece of
> tutor language **grounded in the student's own prescribed textbook** so it is safe to trust
> unsupervised. Demonstrated with Grade 10/11 students on the Sri Lankan O/L syllabus.

Three things make this defensible that the current system lacks:

1. A **model of the learner**, not a rule list — latent misconception variables with Bayesian
   inference over action sequences (revives the classic "buggy models" idea, Brown & Burton 1978
   / VanLehn 1990, with modern probabilistic inference and a new task domain: freeform
   virtual-lab manipulation).
2. **Everything measured as a student outcome** — predictive validity of the diagnosis + a
   controlled learning-gains study, not "we combined X and Y." No metric depends on a teacher.
3. A **trust mechanism for the unsupervised setting** — the tutor is constrained to rephrase a
   verified diagnosis and cite real syllabus pages, so a student with nobody to fact-check the
   AI is not exposed to hallucinated science.

---

## 3. Contributions

Each contribution is framed by what it gives the **unsupervised student** — the teacher-facing
value that automated log assessment usually claims (class dashboards, alerting a teacher) is
explicitly out of scope.

- **C1 (primary, technical) — "the app notices *why* you're stuck."**
  A dynamic Bayesian plan-recognition student model that infers a posterior over
  curriculum-specific misconceptions from the student's own bench manipulation telemetry, plus
  an authoring formalism ("misconception error signatures") for defining what each misconception
  looks like *as behaviour*. The output is consumed **only** by the student's own experience —
  hint timing, hint content, and the end-of-session diagnosis they read. Replaces
  `analyzeSession`'s rules and the ad-hoc intervention triggers in `logAction`.

- **C2 (secondary, systems + equity) — "you can trust what it tells you."**
  A curriculum-grounded feedback architecture: an offline RAG sync against the exact prescribed
  textbook (already built — `scripts/curriculum/`), feeding a constrained-generation layer where
  the LLM only rephrases the C1 diagnosis and cites syllabus pages — never free-generates
  science. Contribution = the architecture + an evaluation of curriculum fidelity / hallucination
  rate vs. an ungrounded tutor. Matters *because* the user has no teacher to catch an AI error.

- **C3 (secondary, design finding) — "a wrong guess is never a dead end."**
  Evidence on **non-blocking guided inquiry**: the Current-Task model lets the student act freely
  and never blocks a planning mistake, using the *hint request + recovery pattern* as diagnostic
  signal instead of gatekeeping — important when there is no teacher to unstick a student who
  hits a locked step. Reported as a design principle with A/B evidence on gaming-the-system
  behaviour and transfer.

A thesis can lead with C1, situate it in C2's context, and report C3 from the same study logs.

---

## 4. Related work — positioning

Pointers for the literature review (pin exact citations during writing):

| Area | Representative work | How C1 differs |
|---|---|---|
| Knowledge tracing | BKT (Corbett & Anderson 1995); DKT (Piech et al. 2015); PFA (Pavlik et al. 2009) | KT tracks *skill mastery* from *right/wrong*. C1 tracks latent *misconceptions* from *rich action sequences*, not correctness alone. |
| Buggy / bug-library models | DEBUGGY (Brown & Burton 1978); *Mind Bugs* (VanLehn 1990) | Same core idea — misconceptions as enumerable procedural bugs — revived with probabilistic inference and applied to hands-on lab manipulation instead of symbolic arithmetic. |
| Constraint-based modelling | Ohlsson (1994); Mitrovic — SQL-Tutor, EER-Tutor | CBM diagnoses violated constraints on *state*. C1 is a *generative* model over *action trajectories* with explicit misconception latents and calibrated posteriors. |
| Bayesian student modelling / plan recognition in ITS | Conati et al. (2002) — Andes physics; Mayo & Mitrovic (2001) | Closest prior art. C1 applies it to a manipulation-rich virtual bench with curriculum-specific misconception latents and an authoring formalism. |
| Automated assessment from virtual-lab logs | **Inq-ITS** (Gobert, Sao Pedro, Baker et al.); ChemVLab (Davenport et al.) | **The key competitor.** Inq-ITS assesses *inquiry practice skills* (hypothesizing, controlling variables) from logs and reports much of its value to a *teacher dashboard*. C1 assesses *domain conceptual misconceptions*, feeds only the *student's own* guidance loop (no teacher in the design), is curriculum-grounded, and targets a low-resource, unsupervised-learner context. |
| Virtual labs & inquiry learning | PhET (Wieman, Adams, Perkins); Rutten et al. (2012) review | These are simulations without a student model. C1 adds the diagnostic layer. |
| LLM tutors | Khanmigo; Tutor CoPilot (Wang et al. 2024); LearnLM | Generation, not diagnosis. C2 constrains the LLM to a verified diagnosis + syllabus grounding. |
| Diagnostic instruments (for the eval) | Two-tier tests (Treagust 1988); acid–base two-tier diagnostics (e.g. Chandrasegaran et al. 2007; Demircioğlu et al.) | Source of the post-test items that provide C1's ground-truth labels. |
| Learning-gain methodology | Hake (1998) normalized gain ⟨g⟩; gaming-the-system (Baker et al. 2004) | Method for Study 2. |

---

## 5. The method — Bayesian plan-recognition student model

### 5.1 Setup and notation

A practical is an ordered list of Main Steps, each a list of Current Tasks (micro-steps) with an
`expectedIntent` ∈ {`SELECT_CONTAINER`, `SELECT_EQUIPMENT`, `SELECT_TRANSFER_EQUIPMENT`,
`TRANSFER_LIQUID`, `ADD_REAGENT`, `HEAT_SAMPLE`, `MIX_SUBSTANCES`, `MEASURE_RESULT`,
`RECORD_RESULT`, …} and an expected equipment/chemical set (`models/Experiment.js`).

The student emits a stream of bench actions `a_1, a_2, …, a_T` — each already logged in
`LabRun.actions[]` and the graded `Action` collection, with fields
`{ actionType, equipment, chemicalIds, targetInstanceId, sourceInstanceId, quantity, unit,
temperature, resultType, timestamp }` plus the server's correctness verdict from `evaluateOnBench`.

### 5.2 Latent variables

- **`M = (M_1, …, M_K)`** — binary misconception variables, `M_k ∈ {held, ¬held}`, one per code in
  the practical's relevant set (union of `steps[].misconceptionRisks` + a small global set). Typically
  **K = 3–6 per practical.** Static within a session (a misconception does not flip mid-lab); the
  *posterior* updates as evidence accrues.
- **`G_t`** — the sub-goal the student is actually pursuing at action `t` (which Current Task /
  intent). The server tracks a *nominal* position (`Session.currentMicroStep`), but the student can
  diverge — so `G_t` is latent with a strong prior on the current task and small mass on
  "working ahead / stuck on a previous task / off-task".

### 5.3 Observation model and misconception error signatures

`P(a_t | G_t, M, bench_state)` is a mixture:

- **Competent component** — given intent `G_t` and no relevant misconception, a distribution
  concentrated on the intent's correct action(s), with a slip rate `ε` on everything else
  (mirrors BKT's slip parameter).
- **Misconception components** — for each `M_k = held` that is *relevant to `G_t`*, the distribution
  shifts toward that misconception's **characteristic error(s)**. This is the authored content — an
  **error signature** per code, analogous to the existing per-step `misconceptionRisks` and to
  `classifyCompoundBuildMistake` (`labHintService.js`), which already infers a misconception code
  from a wrong coefficient pattern. Examples grounded in the seeded practicals:

| Misconception (KB code) | Error signature — the behaviour it produces |
|---|---|
| Indicators change colour with **temperature** not pH (`CHEM_002`) | In an `ADD_REAGENT(indicator)` task: heats the vessel instead, or adds indicator then immediately reaches for a thermometer to "read the endpoint" |
| **Order of mixing doesn't matter** (`CHEM_001`) | Adds base before indicator; adds reagents in an order the procedure explicitly sequences |
| **Neutralization always gives pH 7** | On `MEASURE_RESULT`, declares/records the endpoint at a pH-7 reading rather than at the indicator colour change |
| **Any metal displaces any other** (`CHEM_005`) | In metal displacement, selects a *less* reactive metal for the reaction without consulting the reactivity series; retries with arbitrary metals |
| **Heating always enables/speeds a reaction** | Turns on the burner in a task with no `HEAT_SAMPLE` intent; heats before every mix |
| **All liquids mixed together react** | Adds unrelated reagents together expecting a reaction; surprised by `no_reaction` |
| Pendulum: **large release angle is fine** (`PHY_010`) | `set_release_angle` > ~15° |
| Pendulum: **time a single oscillation** (`PHY_011`) | `record_oscillation` count = 1, then `stop_timer` |
| Hooke: **total length, not extension** (`PHY_013`) | Reports the extended length as the extension in `read_measurement` |
| Density: **confuses mass and weight** | Uses/records force units where mass is asked, or vice versa |

Signatures are authored **at design time** from published diagnostic-test literature and one
curriculum expert's input (design input ≠ evaluation — no teacher coding of student sessions is
needed). Store them alongside the KB (`models/Misconception.js` gets a `behaviouralSignatures[]`
field: `{ whenIntent, actionPattern, weight }`).

### 5.4 Inference

Start **simple and exact** — the latent space is tiny:

1. **`G_t`** — HMM forward filtering. Transition prior favours `Session.currentMicroStep` and its
   immediate neighbours; emission = does `a_t` match `G_t`'s expected equipment/chemical/intent
   (reuse `evaluateOnBench`'s logic, refactored to return a match score rather than a boolean).
2. **`M`** — per action, a **log-odds update per misconception** (independent / naive-Bayes form):
   `logit P(M_k) += log [ P(a_t | G_t, M_k=held) / P(a_t | G_t, M_k=¬held) ]`, summing over the
   `G_t` posterior. Interpretable, O(K) per action, no sampling, and the running log-odds *is* the
   evidence trail for the report.
3. Upgrade to **joint inference over `M`** (enumerate ≤ 2^6 = 64 configurations) only if the
   independent form conflates correlated misconceptions in practice — decide from data.

### 5.5 Driving the tutor from the posterior

| Current mechanism (ad hoc) | Replaced by |
|---|---|
| `logAction`: fire intervention on "equipment mismatch" / "≥2 errors" / "≥3 errors" | Fire when `max_k P(M_k \| a_{1:t})` crosses a calibrated threshold, or when `P(G_t = off-task)` is high |
| Equipment/chemical/circuit hint branch selection | Condition the hint prompt on the **most-probable misconception** — target the concept, not just "wrong tool" |
| `analyzeSession`: 6 rules → `misconceptionsDetected[]` | The **posterior over `M`** *is* the diagnosis: report `P(M_k)` above threshold, each with its evidence trail (which actions moved the log-odds) |
| `nextRecommendedExperiment` (currently unused/null) | Select remediation by highest-posterior misconception |
| Constrained LLM feedback (`feedbackService.js`) | Unchanged contract — it now rephrases a *calibrated* diagnosis instead of rule output |

### 5.6 Parameter learning

- **Cold start:** hand-set `ε` (slip), signature weights, `G_t` transition prior — BKT-style
  informed priors.
- **With session data:** EM over observed action sequences with `M`, `G_t` latent — maximize
  sequence likelihood. Because you have student post-tests, use post-test misconception labels as
  **partial supervision on `M`** (semi-supervised EM) — this is exactly the data a student-only
  study produces.
- Report held-out action-sequence log-likelihood and posterior calibration (reliability diagram vs.
  post-test labels).

---

## 6. Mapping onto the existing codebase

Additive where possible; the one real rewrite is the diagnosis engine, which is the point.

| File | Change | Kind |
|---|---|---|
| `models/Misconception.js` | + `behaviouralSignatures[]` (`{ whenIntent, actionPattern, weight }`) | Additive |
| `data/misconceptions.js` | Author signatures for the codes in the 4 chem + 5 physics practicals | Content |
| `models/Session.js` | + `studentModel` sub-doc: `{ misconceptionPosterior: [{code, logOdds, prob, evidence[]}], subGoalPosterior, updatedAt }` | Additive |
| `services/studentModelService.js` | **New.** `updateOnAction(session, labRun, action) → posterior`; `diagnose(session) → misconceptions[]`. Pure, unit-testable. | New |
| `services/evaluateOnBench` (in `session.controller.js`) | Refactor to also return a graded **match score** per intent (not just boolean) — feeds `G_t` emission | Refactor, behaviour-neutral |
| `controllers/session.controller.js#logAction` | After grading, call `studentModelService.updateOnAction`; intervention timing/content read the posterior | Rewrite of the trigger block |
| `services/aiService.js#analyzeSession` | Replace rules 1–4 with `studentModelService.diagnose`; keep strengths/rule-6 seeds | Rewrite |
| `services/labHintService.js` | Intervention/hint builders take `probableMisconception` as context | Additive arg |
| `controllers/labRun.controller.js#logLabAction` | Emit each bench action to the student model too (freeform runs get diagnosis as well) | Additive call |
| `scripts/analysis/` | **New.** Offline: export sessions, fit params (EM), compute predictive-validity metrics, run ablations | New (research code, not shipped) |

Telemetry is already sufficient — `LabRun.actions[]` + `Action` capture instrument, source/target
instance, quantity, ordering, timing, and correctness. No new logging required for the chem/physics
practicals.

---

## 7. Evaluation design (student-only)

### 7.1 Instruments

- **Concept inventory** — a two-tier diagnostic test targeting the specific misconceptions in the
  study practicals (adapt published acid–base / reactivity / mechanics two-tier items; Treagust
  methodology). Each item's distractors map to a KB misconception code. This is the label source —
  **no teacher coding of sessions needed.**
- Pre-test and an isomorphic post-test; a delayed post-test (2–3 weeks) if scheduling allows.
- Log export: full `Session` + `Action` + `LabRun.actions[]` per participant.

### 7.2 Study 1 — Predictive validity of the diagnosis (correlational)

- All participants use the **full system**.
- **Question:** does the misconception posterior computed from the **first half** of a session
  predict (a) the student's specific errors in the **second half**, and (b) their **post-test**
  performance on items targeting that misconception?
- **Baselines to beat (AUC / F1 for "student holds misconception k"):** current threshold rules;
  BKT on step correctness; final-score-only; total-errors-only; a DKT-style sequence model if time.
- Needs only telemetry + post-test. This establishes that the *diagnosis* is real.

### 7.3 Study 2 — Learning-gains RCT (the headline result)

- Two arms, same practicals, same content, same LLM, same curriculum grounding:
  - **Treatment:** interventions timed and phrased from the misconception posterior; end report =
    calibrated diagnosis.
  - **Control:** interventions on the existing heuristics; end report = score + rule-based feedback.
- **Primary outcome:** normalized gain ⟨g⟩ (Hake) on the concept inventory, treatment vs. control.
- **Secondary:** gaming-the-system rate (rapid wrong attempts, hint-before-thinking — Baker
  detectors over the logs); hint efficiency (posts-hint success rate); time-on-task; delayed
  retention.
- Powers the C1 claim *and*, from the same logs, the C3 non-blocking design finding (compare
  recovery trajectories after planning mistakes; gaming rates).

### 7.4 Ablations & model quality (offline, on Study 1+2 logs)

- Independent vs. joint `M` inference.
- With / without `G_t` divergence modelling.
- Signature richness: full library vs. correctness-only observation model.
- Held-out action-sequence log-likelihood; posterior calibration curve vs. post-test labels.

### 7.5 C2 evaluation — curriculum fidelity

- Sample N generated hints/reports; check each claim against the cited textbook page (rubric:
  supported / unsupported / contradicted). Compare grounded vs. an ungrounded-LLM ablation.
- Report as a fidelity/hallucination rate — cheap, no student time.

---

## 8. Scope decisions — narrow before building

- **Pick one concept cluster to go deep on.** Acid–base neutralization + indicators is the best
  candidate: richest existing practical (`Acid-Base Neutralization`, 5 steps, micro-stepped), a
  well-populated misconception set (`CHEM_001/002/003` + "always pH 7"), mature diagnostic-test
  literature. Metal reactivity is a strong second.
- **4 chem + 5 physics practicals and 13 reactions is thin for a broad claim** but *enough* for one
  concept cluster studied properly. Do not widen content instead of deepening the model — the model
  is the contribution.
- **Physics** can be a generalization section (show the same model, different `expectedIntent` set
  and signatures, works for pendulum/Hooke misconceptions) rather than a second full study.
- **Ethics:** minors — school and parental consent, data anonymization, an opt-out that still lets
  them use the app. Sort the IRB/school approval early; it gates Study 2.

---

## 9. Phased plan

1. **P0 — Framing & instrument (weeks 1–3).** Finalize the claim, lit review, adapt/assemble the
   two-tier concept inventory, get one curriculum expert to review draft error signatures, secure
   school approval.
2. **P1 — Model core (weeks 3–7).** `behaviouralSignatures` schema + authoring for the acid–base
   cluster; `studentModelService` with `G_t` HMM + independent-`M` log-odds; unit tests over
   hand-built trajectories; `Session.studentModel` persistence. No UI change yet — run it in shadow
   mode alongside the existing rules and log both.
3. **P2 — Tutor integration (weeks 7–9).** Posterior-driven intervention timing + misconception-
   conditioned hints + diagnosis in the report. Feature-flag treatment vs. control.
4. **P3 — Pilot (weeks 9–10).** 5–10 students, full pipeline, fix instrument/logging/model issues,
   sanity-check that the posterior moves sensibly.
5. **P4 — Study 1 + Study 2 (weeks 10–14).** Run both (can share a cohort: everyone does pre-test →
   labs → post-test; RCT arm assigned at random; Study 1 uses all logs).
6. **P5 — Analysis & write-up (weeks 14–18).** Param fitting (EM), predictive-validity metrics,
   ablations, ⟨g⟩ comparison, C2 fidelity check, C3 design analysis.

---

## 10. Risks & open questions

- **Signatures too sparse to fire.** Some misconceptions may rarely produce a distinctive action in
  a short practical. Mitigation: design 1–2 tasks per study practical specifically to *elicit* the
  target misconceptions (a "diagnostic task" — legitimate, common in ITS design).
- **Underpowered RCT.** One school cohort may be ~40–80 students. Pre-register; if underpowered for
  ⟨g⟩, Study 1's predictive-validity result still stands as the primary contribution and the RCT
  becomes "promising, needs scale."
- **Inq-ITS overlap.** Be explicit and fair: they do inquiry *skills*, C1 does conceptual
  *misconceptions* + curriculum grounding + low-resource context. Reviewers will check this.
- **Signature authoring is subjective.** Document the derivation of each from published instruments;
  report a sensitivity analysis (§7.4).
- **Independent-`M` inference conflating correlated misconceptions** (e.g. `CHEM_001` and "order
  doesn't matter" overlap). Decide independent vs. joint empirically in P1.
- **LLM cost/quota** during the study (Groq free-tier limits already bite the curriculum sync). Cache
  aggressively; the rule-based fallbacks make a quota outage non-fatal.
- **Does the model beat plain "count the errors"?** If not, that is itself a (negative) finding
  worth reporting — but §5.3's signatures should give it real discriminative power over raw counts.
