# Tests

```bash
npm test          # runs node --test over test/**/*.test.js  (Node's built-in runner, no deps)
node --test "test/regression/lab-scoring.test.js"   # a single file
```

No database and no network are required — every test here runs against **pure modules** or
in-memory fixtures. Anything that would need Mongo/Groq is stubbed or out of scope.

## Layout

| Path | What |
|---|---|
| `smoke.test.js` | harness sanity + "pure services load without opening a DB connection" |
| `fixtures/` | canned Session / Experiment / Action objects (shapes match what the controllers persist) |
| `regression/` | **golden-output guards** for the deterministic services the student-model work touches — `labScoringService`, `reportAnalyticsService`, `curriculumReferenceService`. These must not change while the `STUDENT_MODEL_*` flags are off. |
| `unit/` | `student-model.test.js` (one trajectory fixture per behavioural signature), `misconception-signatures.test.js` (authoring lint), `feature-flags.test.js`, `student-model-runner.test.js` (mongoose models mocked — no DB) |

## Seeing the student model on real data (shadow mode)

```bash
# 1. enable it (compute + persist only — nothing the student sees changes)
echo "STUDENT_MODEL_ENABLED=true" >> .env
# 2. complete a practical in the app
# 3. inspect what the model concluded vs. the old rules
node scripts/analysis/inspect-student-model.js --recent 5
```

## Refreshing a regression snapshot

`regression/report-analytics.test.js` can print its current output:

```bash
SNAPSHOT=1 node --test "test/regression/report-analytics.test.js"
```

Only paste new expected values back in after an **intentional** change, and note why in the commit.

## Convention

- `node:test` + `node:assert/strict`, CommonJS (`require`) to match `src/`.
- One behaviour per `test(...)`; name states the expected outcome, not the input.
- Fixtures are data, not logic — keep computation in the service under test.
