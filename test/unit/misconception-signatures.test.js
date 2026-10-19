// Validates the authored behavioural signatures in src/data/misconceptions.js: every signature is
// well-formed, references a real expectedIntent, and its predicate name is unique enough to wire
// up in studentModelService.PREDICATES (M2). This is authoring-time lint, not model behaviour.
const test = require("node:test");
const assert = require("node:assert/strict");
const misconceptions = require("../../src/data/misconceptions");

// expectedIntent enum from models/Experiment.js microStepSchema.
const VALID_INTENTS = new Set([
  "SELECT_CONTAINER", "SELECT_EQUIPMENT", "SELECT_TRANSFER_EQUIPMENT", "TRANSFER_LIQUID",
  "ADD_REAGENT", "PREPARE_SAMPLE", "HEAT_SAMPLE", "MIX_SUBSTANCES", "OBSERVE_RESULT",
  "MEASURE_RESULT", "RECORD_RESULT", "SET_MEASUREMENT_PARAMETER", "START_TIMED_TRIAL",
  "STOP_TIMED_TRIAL", "PLACE_COMPONENT", "READ_METER",
]);
const VALID_EVIDENCE = new Set(["commission", "omission", "sequence"]);

const withSignatures = misconceptions.filter((m) => (m.behaviouralSignatures || []).length > 0);

test("at least the acid–base study cluster is authored", () => {
  const authored = new Set(withSignatures.map((m) => m.code));
  for (const code of ["CHEM_001", "CHEM_002", "CHEM_003", "CHEM_004"]) {
    assert.ok(authored.has(code), `${code} should have behavioural signatures`);
  }
});

test("every signature is well-formed", () => {
  for (const m of withSignatures) {
    for (const sig of m.behaviouralSignatures) {
      assert.ok(typeof sig.predicate === "string" && sig.predicate.length > 3, `${m.code}: predicate name`);
      assert.ok(Array.isArray(sig.whenIntent), `${m.code}: whenIntent is an array`);
      for (const intent of sig.whenIntent) {
        assert.ok(VALID_INTENTS.has(intent), `${m.code}: "${intent}" is not a valid expectedIntent`);
      }
      assert.ok(VALID_EVIDENCE.has(sig.evidenceType || "commission"), `${m.code}: evidenceType`);
      assert.ok(
        typeof sig.logLikelihoodRatio === "number" && sig.logLikelihoodRatio > 0 && sig.logLikelihoodRatio < 5,
        `${m.code}: logLikelihoodRatio in a sane range`
      );
      assert.ok(typeof sig.source === "string" && sig.source.length > 10, `${m.code}: source citation present`);
    }
  }
});

test("behaviouralPriorLogOdds, when set, is a sane negative-ish log-odds", () => {
  for (const m of misconceptions) {
    if (m.behaviouralPriorLogOdds == null) continue;
    assert.ok(
      typeof m.behaviouralPriorLogOdds === "number" && m.behaviouralPriorLogOdds > -4 && m.behaviouralPriorLogOdds <= 0,
      `${m.code}: prior log-odds ${m.behaviouralPriorLogOdds} out of range`
    );
  }
});

test("predicate names are unique per misconception (no accidental dupes)", () => {
  for (const m of withSignatures) {
    const names = m.behaviouralSignatures.map((s) => s.predicate);
    assert.equal(new Set(names).size, names.length, `${m.code}: duplicate predicate`);
  }
});
