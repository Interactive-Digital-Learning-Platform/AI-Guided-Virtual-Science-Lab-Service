// scripts/analysis/lib/itemReview + inventoryStats edge cases — the fix/keep decision rules for the
// concept-inventory validity pilot (dev-docs/concept-inventory-acid-base.md §8).
// Fixtures are constructed test inputs for the LOGIC, not participant data.
const test = require("node:test");
const assert = require("node:assert/strict");
const { reviewItems, prevalenceReview, THRESHOLDS } = require("../../scripts/analysis/lib/itemReview");
const { cronbachAlpha, itemRestCorrelation, parallelFormSummary } = require("../../scripts/analysis/lib/inventoryStats");

const item = (over = {}) => ({ item: 1, code: "CHEM_002", n: 10, answered: 10, correct: 5, flagged: 2, discrimination: 0.4, ...over });

test("reviewItems — a healthy item is KEEP", () => {
  const [r] = reviewItems([item()]);
  assert.equal(r.verdict, "KEEP");
  assert.deepEqual(r.reasons, []);
  assert.equal(r.difficulty, 0.5);
});

test("reviewItems — too hard, too easy, weak discrimination, omissions each flag REVIEW", () => {
  const [hard, easy, weak, omit] = reviewItems([
    item({ correct: 1 }), // 10% correct
    item({ correct: 10 }), // 100% correct
    item({ discrimination: 0.05 }),
    item({ answered: 8 }), // 20% omitted
  ]);
  assert.equal(hard.verdict, "REVIEW");
  assert.match(hard.reasons[0], /too hard/);
  assert.match(easy.reasons[0], /too easy/);
  assert.match(weak.reasons[0], /weak discrimination/);
  assert.match(omit.reasons[0], /omitted/);
});

test("reviewItems — boundary values are inclusive (0.20 and 0.90 difficulty are OK)", () => {
  const rows = reviewItems([item({ correct: 2 }), item({ correct: 9 }), item({ discrimination: THRESHOLDS.minDiscrimination })]);
  assert.deepEqual(rows.map((r) => r.verdict), ["KEEP", "KEEP", "KEEP"]);
});

test("reviewItems — no variance is reported, not silently passed", () => {
  const [r] = reviewItems([item({ discrimination: null })]);
  assert.equal(r.verdict, "REVIEW");
  assert.match(r.reasons.join(" "), /no variance/);
});

test("prevalenceReview — a code flagged in <25% of students is LOW", () => {
  const rows = prevalenceReview({ CHEM_001: { flagged: 1, n: 12 }, CHEM_002: { flagged: 5, n: 12 }, CHEM_003: { flagged: 3, n: 12 } });
  const by = Object.fromEntries(rows.map((r) => [r.code, r.verdict]));
  assert.equal(by.CHEM_001, "LOW");
  assert.equal(by.CHEM_002, "OK");
  assert.equal(by.CHEM_003, "OK", "exactly 25% counts as OK");
  assert.match(rows.find((r) => r.code === "CHEM_001").note, /too few students/);
});

test("cronbachAlpha — not estimable with too few rows/items or zero variance", () => {
  assert.equal(cronbachAlpha([[1, 1, 1]]), null, "one participant");
  assert.equal(cronbachAlpha([[1], [0], [1]]), null, "one item");
  assert.equal(cronbachAlpha([[1, 1], [1, 1], [1, 1]]), null, "everyone scored identically");
});

test("cronbachAlpha — unrelated items give a low alpha", () => {
  const matrix = [
    [1, 0, 1, 0],
    [0, 1, 0, 1],
    [1, 1, 0, 0],
    [0, 0, 1, 1],
    [1, 0, 0, 1],
    [0, 1, 1, 0],
  ];
  assert.ok(cronbachAlpha(matrix) < 0.3, `got ${cronbachAlpha(matrix)}`);
});

test("itemRestCorrelation — negative when an item runs against the rest", () => {
  const matrix = [
    [1, 0, 0],
    [1, 0, 0],
    [0, 1, 1],
    [0, 1, 1],
    [0, 1, 1],
  ];
  assert.ok(itemRestCorrelation(matrix, 0) < 0);
  assert.equal(itemRestCorrelation([[1, 0], [0, 1]], 0), null, "needs >= 3 participants");
});

test("parallelFormSummary — reports item-level difficulty shift B−A", () => {
  const perItem = (flags) => flags.map((bothCorrect) => ({ bothCorrect }));
  const s = parallelFormSummary([
    { participantCode: "P1", form: "A", conceptualScore: 1, perItem: perItem([true, false]) },
    { participantCode: "P1", form: "B", conceptualScore: 2, perItem: perItem([true, true]) },
    { participantCode: "P2", form: "A", conceptualScore: 1, perItem: perItem([true, false]) },
    { participantCode: "P2", form: "B", conceptualScore: 1, perItem: perItem([true, false]) },
  ]);
  assert.equal(s.n, 2);
  assert.deepEqual(s.itemDifficultyDelta, [0, 0.5]);
  assert.equal(parallelFormSummary([]).n, 0);
});
