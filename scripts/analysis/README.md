# Student-model analysis scripts

Offline research tooling for the Bayesian misconception model
(see `dev-docs/implementation-plan-student-model.md` §7). **Not part of the running service** — no
route imports anything here. All scripts are read-only against the database.

| Script | Purpose |
|---|---|
| `inspect-student-model.js` | Eyeball one / recent completed sessions: the posterior vs. the rule engine's output, with the evidence trail. Use during the shadow-mode phase before flipping `STUDENT_MODEL_DRIVES_*`. |
| `export-sessions.js` | Dump completed sessions to JSON/CSV for analysis — anonymised identity, performance summary, rule misconceptions, the model posterior (final + first-half of the action log), and an empty `label_<CODE>` slot per misconception. |
| `score-inventory.js` | Score filled-in concept-inventory response sheets (CSV of A–D / i–iv answers) into the `labels.csv` the two scripts below consume. `--item-stats` prints difficulty, item-rest discrimination, Cronbach's alpha, timing, and paired Form A/B checks for the §8 validity checklist. |
| `prepare-pilot-data.js` | Generate coded participant slots, working CSVs, an authorization record, and participant-only Form A/B files without answer-key/control labels. Refuses to overwrite existing collection data unless deliberately forced. |
| `pilot-status.js` | Validate collection authorization, per-participant consent confirmation, both forms, durations, session mapping, duplicates, and answer formats while reporting live progress. |
| `training-readiness.js` | Preflight a `--full` export and labels: checks exact replay context, anonymised user grouping, unique sessions, sample size, and positive/negative counts per misconception. Exits 2 when more data are needed. |
| `predictive-validity.js` | **Study 1.** AUC of the posterior (and baselines: rules, error rate, 1−score) vs. the concept-inventory post-test labels, per misconception. |
| `fit-params.js` | Regularised-log-loss calibration of signature priors / LLRs. Keeps all attempts from one student in one fold, reports out-of-fold AUC/log-loss/Brier, and can write a versioned JSON artifact. You review parameters before applying them to `src/data/misconceptions.js`. |
| `lib/` | `metrics.js` (auc, bootstrap CI, logloss, brier, calibration — unit-tested), `io.js` (JSON/CSV + labels join), `args.js`, `sessionData.js` (Mongo → analysis record). |

## Typical flow

```bash
# 1. During shadow mode — is the posterior moving sensibly?
node scripts/analysis/inspect-student-model.js --recent 20

# 2. After the pilot/study — export (with raw action logs for fitting)
node scripts/analysis/export-sessions.js --practical "Acid-Base Neutralization" --full -o out/acidbase.json

# 3. Score the concept-inventory response sheets into labels.csv
#    responses.csv columns: participantCode,form,item1_answer,item1_reason,...,item15_answer,item15_reason
#    map.csv columns:        participantCode,sessionId
node scripts/analysis/score-inventory.js out/responses.csv --form A --sessions out/map.csv -o out/labels.csv

# 4. Study 1 — predictive validity
node scripts/analysis/training-readiness.js out/acidbase.json --labels out/labels.csv
node scripts/analysis/predictive-validity.js out/acidbase.json --labels out/labels.csv

# 5. Calibrate the parameters, then hand-apply the proposed block
node scripts/analysis/fit-params.js out/acidbase.json --labels out/labels.csv --folds 5 --passes 3 --out out/params.json
```

## Notes

- Blank collection templates are in `scripts/analysis/templates/`. Copy them into the ignored
  `pilot-data/` directory; do not put participant names or consent records in this repository.
- `export-sessions.js` and `sessionData.js` force `STUDENT_MODEL_ENABLED=true` for their own run,
  so they work regardless of the deployed env flag.
- `--full` exports task-annotated raw action logs plus a minimal `modelContext` (experiment task
  definitions and chemical facts), so `fit-params.js` can reproduce live predicate evaluation.
- Prefer pre-test labels for parameter fitting. Preserve post-test labels for the persistence /
  learning-gain questions, and use either out-of-fold predictions or a separately held-out cohort
  when reporting predictive performance.
- The label schema: one `label_<CODE>` per misconception the practical puts at risk, `1` = the
  post-test shows the student holds it, `0` = they don't, blank = not assessed.
