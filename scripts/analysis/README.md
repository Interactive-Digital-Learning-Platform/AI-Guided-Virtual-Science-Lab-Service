# Student-model analysis scripts

Offline research tooling for the Bayesian misconception model
(see `dev-docs/implementation-plan-student-model.md` §7). **Not part of the running service** — no
route imports anything here. All scripts are read-only against the database.

| Script | Purpose |
|---|---|
| `inspect-student-model.js` | Eyeball one / recent completed sessions: the posterior vs. the rule engine's output, with the evidence trail. Use during the shadow-mode phase before flipping `STUDENT_MODEL_DRIVES_*`. |
| `export-sessions.js` | Dump completed sessions to JSON/CSV for analysis — anonymised identity, performance summary, rule misconceptions, the model posterior (final + first-half of the action log), and an empty `label_<CODE>` slot per misconception. |
| `score-inventory.js` | Score filled-in concept-inventory response sheets (CSV of A–D / i–iv answers) into the `labels.csv` the two scripts below consume. Key + rules in `dev-docs/concept-inventory-acid-base.md`; deterministic, no judgement calls. `--item-stats` prints difficulty / discrimination for the §8 validity checklist. |
| `predictive-validity.js` | **Study 1.** AUC of the posterior (and baselines: rules, error rate, 1−score) vs. the concept-inventory post-test labels, per misconception. |
| `fit-params.js` | Coordinate-ascent calibration of the signature priors / LLRs against labelled data (cross-validated AUC). Prints proposed params — you review and apply to `src/data/misconceptions.js`. |
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
node scripts/analysis/predictive-validity.js out/acidbase.json --labels out/labels.csv

# 5. Calibrate the parameters, then hand-apply the proposed block
node scripts/analysis/fit-params.js out/acidbase.json --labels out/labels.csv --folds 5 --passes 3
```

## Notes

- `export-sessions.js` and `sessionData.js` force `STUDENT_MODEL_ENABLED=true` for their own run,
  so they work regardless of the deployed env flag.
- `--full` exports task-annotated raw action logs (`_taskIntent` etc.) so `fit-params.js` reproduces
  the live path's task attribution without needing the full experiment definitions.
- The label schema: one `label_<CODE>` per misconception the practical puts at risk, `1` = the
  post-test shows the student holds it, `0` = they don't, blank = not assessed.
