# Model "Training" Checklist — 2026-09-21 → 2026-10-04

Written 2026-09-20.

> **⚠ Correction, same evening.** When this was written the tree also contained an "M7" pilot/training
> track: `student-model-two-week-completion-plan.md`, `student-model-pilot-runbook.md`,
> `student-model-expert-review-checklist.md`, `student-model-pilot-ethics-brief.md`, `pilot-data/`,
> `pilot-status.js`, `prepare-pilot-data.js`, `training-readiness.js`, and libs `training / readiness /
> pilotData / replayContext / modelComparison`. **Those files are no longer in the working tree** (they
> were never committed, so git can't restore them). References to them below are stale until they are
> restored or rebuilt.
> **Resolved:** `score-inventory.js` works (rebuilt `lib/inventoryStats.js`, new `lib/itemReview.js`
> fix/keep table). `fit-params.js`, `inspect-student-model.js`, `export-sessions.js` and
> `lib/sessionData.js` were reverted to their committed versions and run against the DB again;
> **97/97 tests**. The reverted scripts are the pre-M7 versions: `fit-params.js` uses plain k-fold CV
> (not grouped by student) — fine for the pilot as long as each participant contributes **one** session —
> and there is no `training-readiness` / `pilot-status` tool, so check the ≥12-labels-per-code /
> ≥2-per-class gate by hand from `score-inventory` output. Backup of the discarded edits (451 lines):
> the session scratchpad `m7-script-edits-backup.patch`.

## What "training" means here

There is no neural net to train. The model is a Bayesian misconception model; **"training" = calibrating
its priors and log-likelihood ratios against real labelled sessions** (`fit-params.js`, grouped CV,
out-of-fold metrics). For the acid–base cluster that is **9 numbers**: 4 priors (CHEM_001–004) + 5 LLRs
(CHEM_001 ×1, CHEM_002 ×2, CHEM_003 ×1, CHEM_004 ×1). The gate to fit a code is
`training-readiness.js`: **≥12 labelled sessions with ≥2 positive and ≥2 negative**, students never
split across folds.

## Status snapshot (measured 2026-09-20)

| Area | State |
|---|---|
| Tooling | *(superseded — see the correction above.)* Scoring + item review works (97/97 tests); export / inspect / fit scripts are broken pending restore or revert; the M7 pilot files are gone |
| Flags | shadow-safe: `ENABLED=true`, `DRIVES_DIAGNOSIS=false`, `FORCE_ARM` empty ✔ |
| Real data | **1** qualifying Acid-Base session (your own), 1 user, **0 labels** → readiness **NOT READY** for all 4 codes |
| Gates | teacher review **no** · ethics/internal-pilot approval **NO** · `authorizedToCollect=NO` · consent 0/15 · Form A 0 · sessions 0 · Form B 0 |
| Model validity | **CHEM_001 and CHEM_004 fire on correct procedure** (see Phase 2) |
| DB hygiene | 32 of 36 completed sessions point at experiments deleted by a re-seed |

## Decision checkpoints (be strict — this is what keeps the work honest)

- **Sep 25:** have consent/approval + teacher sign-off + ≥10 recruited? **No →** switch to fallback
  (below). Do not slip silently.
- **Oct 1:** ≥10 fully complete participants (`pilot-status.js`)? **No →** analyse what exists
  descriptively; do not fit.
- **Oct 2:** per code, `training-readiness.js` says eligible? **Yes →** fit. **No →** keep authored
  parameters, report "not estimable". Never fit a code that fails the gate.

**Fallback (no participants in time):** the deliverable becomes (a) signature audit + fixes,
(b) researcher-enacted scenario validation (Phase 2), (c) an instrument-development pilot of ≤6
think-aloud students for item wording. Calibration is deferred and reported as pending. No synthetic
student data, ever.

---

## Phase 0 — Housekeeping (Sep 20–21)

- [x] Commit the working tree in logical chunks — done throughout (separate commits per concern).
      Tagged **`model-v1-partial-pilot`** 2026-10-19 (local only, not pushed) at the current state.
- [ ] **Freeze the seed.** Do **not** run `npm run seed` again — it deletes experiments and orphans
      sessions (already 32/36). Content changes go through additive migrations only.
- [x] Study environment — re-verified 2026-10-19: `STUDENT_MODEL_ENABLED=true`, both `DRIVES_*`
      false, `FORCE_ARM` empty. Still the same shared dev DB (no separate participant DB) — low
      risk so far since no participant has a real session yet (see Phase 4 note).
- [x] Mobile repo — checked 2026-10-19: `Updated-Report-section` branch is in sync with
      `origin/Updated-Report-section` (not ahead). It does have unrelated uncommitted local changes
      (equipment-panel / auth-sync files) — untouched, not part of this work.

## Phase 1 — External gates (start Sep 21; these are the long poles)

- [x] **Chemistry teacher review — done 2026-10-19.** Signed PDF (`teacher-review-Signed
      -PDF.pdf`): real handwritten signature, name/school/subject filled in. Verdict: "Approved as
      written." Scope question: **Yes — CHEM_003 stays in** (confirms Grade 10/11 syllabus scope).
- [ ] Ethics / internal-pilot approval reference recorded in `pilot-data/collection-authorization.csv`
      — still not obtained. **Note:** a first real response batch was already collected (below)
      before this gate cleared — flag this timing to your supervisor when you discuss ethics sign-off.
- [ ] Parent consent + student assent: drafted 2026-10-18 as `pilot-consent-pack-draft.md`, never
      finalised/supervisor-reviewed. The Google Form that was actually used did **not** include the
      consent/assent sections from the design (see below) — unclear whether consent was collected
      by some other means (paper, verbal) before administering it. Confirm and record how.
- [x] Recruit — **first batch collected 2026-10-18/19**, 17 pre-test + 18 post-test responses (see
      Phase 4 below). Within the 15-20 target by headcount; coverage caveats below.
- [ ] `pilot-status.js` doesn't exist (pre-M7 revert) — readiness checked by hand instead (below).

### First collection batch — results (2026-10-19)

Collected via the Google Forms built from `pilot-collection-google-forms.md`, but **not built
to that exact spec**: no participant-code field (joined by name+school instead — messy, see
`pilot-data/participant-key-PRIVATE.csv`, gitignored), and **only a subset of items**, different
per form:
- Form A (pre) asked items **1, 2, 3, 8, 9, 10**.
- Form B (post) asked items **1, 2, 3, 4, 5, 6**.
- Only **items 1–3 are common to both forms** — the other 9 items (P5-7,P11-15 / Q7-15) were
  never administered. Processed with `scripts/analysis/process-collected-pilot-data.js` (content-
  matches free-text answers to A-D/i-iv, de-identifies into `pilot-data/responses-{A,B}.csv` +
  a private name-key). Low-confidence cells are left blank, never guessed.

**What's usable:**
- 13 students have a matched pre+post pair. Paired (same-student) comparison on items 1-3:
  - item 1 (CHEM_002): 5/13 → 13/13 correct, 8 gained, 0 lost.
  - item 2 (CHEM_003): 0/13 → 12/13 correct, 12 gained, 0 lost — strong signal, and directly
    matches what the teacher just confirmed is in-scope.
  - item 3 (CHEM_004): 5/13 → 11/13 correct, 7 gained, 1 lost.
- Single-form item-level stats (difficulty/discrimination/Cronbach's α) for items 4,5,6 (Form B
  only) and 8,9,10 (Form A only) — real, usable diagnostics, just not paired.

**What's NOT usable, and why:** the §7.2 "≥2-of-3 items flag the code" misconception-label rule
needs real signal from all 3 of a code's items. Every code here has at most 1-2 of its 3 items
administered (CHEM_001 worst: item 8 pre, item 4 post — not even the same item, so the two forms
can't even agree on which single item to trust). **Decision (2026-10-19, with the researcher):
treat this as a partial pilot** — items 1-3's paired gain and the single-form item diagnostics
are real, reportable findings; full CHEM_001-004 calibration is **not estimable** from this
batch, consistent with the checklist's own fallback plan. If/when more data is collected, build
the form(s) to the full 15-item spec with a real participant-code field so this gap doesn't repeat.

## Phase 2 — Code work that needs no student data (Sep 21–25, parallel with Phase 1)

The model is a read-time recompute of the action log, so predicate fixes never invalidate collected
data — you can fix these any time before fitting. **Fix predicate meaning before tuning any number**
(fitting an LLR to a wrong trigger just drives it toward zero).

Evidence from your only real Acid-Base run (session `6a94dfad…`):

| Code | Model said | What actually triggered it |
|---|---|---|
| CHEM_001 (order matters) | 97% | **20/20 hits = HCl (the acid) dispensed before the indicator** — that is the *correct* order (acid → indicator → base) |
| CHEM_004 (all mixtures react) | 73% | 3/4 hits = **phenolphthalein** added (`no_reaction`, a correct step) |

- [x] `reagent_added_before_indicator` (CHEM_001) — **done 2026-09-21.** Fires only when the acid AND base
      meet with no indicator present; the acid alone (the correct order) never counts.
- [x] `combined_non_reacting_substances` (CHEM_004) — **done.** Indicator additions and chemicals the current
      task expects are excluded; stays silent without the chemical lookup.
- [x] `ph7_recorded_as_endpoint` (CHEM_003) — **done.** Now RECORD_RESULT only, LLR 1.4 → 0.5; provably cannot
      reach the diagnosis threshold on its own (test). *Still needs the teacher's scope decision; drop
      CHEM_003 from the behavioural model if out of syllabus.*
- [x] Repeat accumulation capped — **done.** One signature adds at most 2×LLR (`MAX_SIGNATURE_MULTIPLE`);
      late repeats still count as evidence but add nothing.
- [x] **Negative regression tests** — **done** (105/105): a full correct acid→indicator→base run raises no
      diagnosis; acid-only-before-indicator, indicator-adds and task-expected additions never fire.
- [x] **Apply the DB update** — done and re-verified 2026-10-18: dry run against the live DB now
      shows **0 pending changes**, confirming `CHEM_003`'s params are live. Backend restart needed
      whenever predicate *code* changes (DB migration alone doesn't reload `studentModelService.js`).
- Verified on the only real Acid-Base run (`6a94dfad…`): CHEM_001 97% → 23%, CHEM_004 73% → 21%, 0
  evidence each, no diagnosis.
- [x] `inspect-student-model.js --recent 20` — re-run 2026-10-18 against live data (5 real
      "Acid-Base Neutralization" sessions now in the DB, up from 1):
      - **CHEM_001, CHEM_004 — keep.** Across all 5 sessions, including the two where the RULE
        engine still fires, the MODEL now stays silent (0 evidence each). Fix generalises past the
        one session it was built from.
      - **CHEM_002 — keep, no change needed.** Fired at 85.8% (7 evidence) on session `6ad470b6…`
        and 59.9% (1 evidence) on `6a93b49a…` via `heat_during_indicator_or_endpoint_task`.
        Traced `6ad470b6…` to the live LabRun: 17 "heat" actions, several bursts of 5-6 within
        2 seconds, all with null chemicalIds/quantity/temperature, logged 2026-10-18 — and the
        session's `userId` resolves to the researcher's own account
        (`manushiliyanage14@gmail.com`). This is dev UI exploration (rapid test-clicking a heat
        control), not a real student's reasoning, so the high score is correct behaviour, not a
        predicate bug — it's just evidence from a session that was never a real participant.
        **Worth noting for Phase 4:** the per-signature cap (`MAX_SIGNATURE_MULTIPLE`) kept 17
        repeated clicks from pushing the posterior past what 2×LLR allows, which is exactly the
        damping it was built for.
      - **CHEM_003 — keep, pending the teacher's scope decision** (unchanged; see Phase 1).
- [x] Signature `source` notes already updated (commit `f54fccb`); `npm test` green — **105/105**,
      re-run 2026-10-18.
- [ ] **Researcher-enacted scenarios** in the real app: 1 fully-correct run + 1 run enacting each of
      CHEM_001–004. Label them "researcher-enacted test scenarios" — they validate signature
      sensitivity/specificity only, are **not** participant data, and have no labels so they never
      enter the fit. Gate: correct run → no code > 0.55; each enacted run → its code > 0.55.
      **Still open — needs someone to actually operate the app** (mobile UI or a scripted API
      client); nothing here to do without that.

## Phase 3 — Deploy & shadow smoke test (Sep 25–27)

- [ ] **Backend hosted and reachable from participants' phones (not your LAN IP).** Still LAN-only
      (`Mobile-Application/.env` points at `192.168.1.177:8080`) — **this is why the first batch
      has zero session telemetry** (see Phase 4 below): students could reach the Google Form from
      anywhere, but could only reach the actual practical from your WiFi. Blocking, needs real
      infra (hosting/domain/gateway), not something fixable from here.
- [x] Scripted end-to-end check — done 2026-10-19 against a real treatment-arm session
      (`6ad470b6…`, `experimentArm: "treatment"`): `studentModel` has real stored evidence
      (CHEM_002, 7 evidence entries), and `flags.studentModelDrivesDiagnosis(session)` correctly
      evaluates `false` (DRIVES_DIAGNOSIS is off) — so `getSessionReport`'s `misconceptionInsight`
      stays `null` for this session per `session.controller.js:1256`, confirming the legacy report
      path is unaffected even though the model has real evidence behind the scenes.
- [x] Rollback drill — verified by direct code reading rather than a live flag flip (didn't want to
      restart your running dev server speculatively): `experimentArmForUser` only returns `"off"`
      when `STUDENT_MODEL_ENABLED` is false, and the shadow-computation call
      (`session.controller.js:1115`) is gated by that exact same flag — so turning it off
      guarantees both `experimentArm: "off"` and no snapshot for new sessions. If you want this
      exercised live instead of read, say so and I'll flip it and run a real session through.

## Phase 4 — Collection (Sep 28 – Oct 1, or as soon as Phase 1 clears)

Per participant: consent → **Form A** → practical → **Form B**.

- [ ] Record `participantCode ↔ sessionId` in `pilot-data/session-map.csv` **immediately** after each
      session (not at the end — you will forget which session was whose).
- [ ] Enter response sheets twice and diff.
- [ ] Run `node scripts/analysis/pilot-status.js` daily.
- [ ] Stop rule: ≥10 fully complete (target 15).

**Checked 2026-10-19 — the first batch has no telemetry to map.** Queried every acid-base
experiment's sessions: all of them still belong to the researcher's own account (plus one
informal tester) — none of the 17-18 students who filled the Google Form have a `Session`
document at all. They answered the paper/digital quiz but never ran the practical through the
app. Root cause: almost certainly Phase 3's LAN-only backend (above) — they had no way to reach
it. **Consequence:** this batch is concept-inventory-only data (useful for item/instrument
validity, §8), but has nothing to join against for Study 1 (does the mid-session posterior
predict the label?) until students can actually reach and run the practical with their own
accounts, with `session-map.csv` recorded at the time. That's the real next step if more data
collection is wanted — not just getting more quiz responses.

## Phase 5 — Analysis & calibration (Oct 1–3)

```bash
node scripts/analysis/score-inventory.js pilot-data/responses.csv --form A --sessions pilot-data/session-map.csv -o out/labels-pre.csv --item-stats
node scripts/analysis/score-inventory.js pilot-data/responses.csv --form B --sessions pilot-data/session-map.csv -o out/labels-post.csv
node scripts/analysis/export-sessions.js --full --practical "Acid-Base Neutralization" -o out/acidbase.json
node scripts/analysis/training-readiness.js out/acidbase.json --labels out/labels-pre.csv
```

- [ ] Item stats read against the inventory checklist (difficulty, discrimination, α, timing,
      parallel forms); revise weak items.
- [ ] Readiness verdict per code recorded.
- [ ] **Eligible codes only:** `node scripts/analysis/fit-params.js out/acidbase.json --labels out/labels-pre.csv`
      → review the parameter artifact (out-of-fold AUC / log-loss / Brier) → **hand-apply** approved
      values to `src/data/misconceptions.js` + a migration. Never auto-apply.
- [ ] Non-eligible codes: authored parameters unchanged, reported "not estimable".
- [ ] `node scripts/analysis/predictive-validity.js out/acidbase.json --labels out/labels-pre.csv` —
      report per-code AUC **with CIs** and the baselines (rules, error rate). At n≈15 the CIs will be
      wide; write it as descriptive, not confirmatory.
- [ ] Re-run the full suite + a shadow replay; before/after table for any parameter change.

## Phase 6 — Wrap (Oct 4)

- [ ] Tag `model-v1-calibrated` (or `model-v1-audit-only` if no fit happened).
- [ ] Limitations note: n, which codes were/weren't estimable, enacted-scenario results, syllabus decision.
- [ ] `DRIVES_*` stays **off** unless teacher review is signed **and** shadow inspection passed.

## What two weeks cannot deliver (say so in the thesis)

- Study 2 (learning-gains RCT) at adequate power.
- Calibrating any code that fails the readiness gate.
- Any result derived from synthetic or generated participants.
