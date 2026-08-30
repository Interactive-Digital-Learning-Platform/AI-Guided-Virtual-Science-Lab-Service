// scripts/analysis/lib/inventoryKey — scoring the acid-base two-tier concept inventory against the
// §6 key / §7 rules from dev-docs/concept-inventory-acid-base.md.
const test = require("node:test");
const assert = require("node:assert/strict");
const { scoreResponses, CODE_ITEMS } = require("../../scripts/analysis/lib/inventoryKey");

// Build a response row: allCorrect, then apply overrides { [item]: [answer, reason] }.
function sheet(overrides = {}) {
  const row = {};
  for (let i = 1; i <= 15; i += 1) {
    const [a, r] = overrides[i] || (i === 7 ? ["B", "i"] : ["A", "i"]); // item 7 correct is (B,i)
    row[`item${i}_answer`] = a;
    row[`item${i}_reason`] = r;
  }
  return row;
}

test("all correct → score 15, every label 0", () => {
  const res = scoreResponses(sheet());
  assert.equal(res.conceptualScore, 15);
  assert.deepEqual(res.labels, { CHEM_001: 0, CHEM_002: 0, CHEM_003: 0, CHEM_004: 0 });
  assert.equal(res.answered, 15);
});

test("blank sheet → score 0, labels 0 (missing answers never flag a misconception)", () => {
  const res = scoreResponses({});
  assert.equal(res.conceptualScore, 0);
  assert.deepEqual(res.labels, { CHEM_001: 0, CHEM_002: 0, CHEM_003: 0, CHEM_004: 0 });
  assert.equal(res.answered, 0);
});

test("CHEM_002 held — temperature reason on all 3 of its items → label 1", () => {
  const res = scoreResponses(
    sheet({
      1: ["B", "ii"], // §6: B+ii flags CHEM_002
      6: ["B", "ii"], // B/D + ii/iv
      11: ["C", "iii"], // C/D + ii/iii
    })
  );
  assert.equal(res.labels.CHEM_002, 1);
  assert.equal(res.labels.CHEM_003, 0);
  assert.equal(res.conceptualScore, 12, "the other 12 items still correct");
});

test("CHEM_003 held — 'always pH 7' reason on 2 of 3 items → label 1 (>=2 rule)", () => {
  const res = scoreResponses(sheet({ 2: ["A", "ii"], 13: ["B", "ii"] }));
  assert.equal(res.labels.CHEM_003, 1);
});

test("the 1-of-3 tie-break — one flag + fully-correct on the other two → label 0", () => {
  // only item 3 flags CHEM_004; items 9 and 14 answered fully correct.
  const res = scoreResponses(sheet({ 3: ["A", "ii"] }));
  assert.equal(res.labels.CHEM_004, 0, "1 signal but 2/3 fully correct -> not held");
});

test("the 1-of-3 tie-break — one flag + NOT fully correct on the others → label 1", () => {
  // item 3 flags CHEM_004; items 9 & 14 wrong but not flagging (control-style wrong).
  const res = scoreResponses(sheet({ 3: ["A", "ii"], 9: ["C", "iii"], 14: ["D", "iv"] }));
  assert.equal(res.labels.CHEM_004, 1, "1 signal and <2 fully correct -> held");
});

test("CHEM_001 — 'order never matters' answer D or reason ii", () => {
  assert.equal(scoreResponses(sheet({ 4: ["D", "i"], 8: ["A", "ii"], 12: ["B", "ii"] })).labels.CHEM_001, 1);
  // a wrong answer that is NOT the misconception (e.g. item 4 answer B with reason iv) should not flag
  const notMc = scoreResponses(sheet({ 4: ["B", "iv"] }));
  assert.equal(notMc.perItem[3].flagsCode, false);
});

test("a plausible-but-wrong reason that isn't the misconception distractor doesn't flag", () => {
  // item 2 answer C (wrong) with reason iii ("unreacted acid left") — wrong, but not CHEM_003.
  const res = scoreResponses(sheet({ 2: ["C", "iii"] }));
  assert.equal(res.perItem[1].bothCorrect, false);
  assert.equal(res.perItem[1].flagsCode, false);
  assert.equal(res.labels.CHEM_003, 0);
});

test("reason accepts roman or numeric input", () => {
  const roman = scoreResponses(sheet({ 1: ["B", "ii"] }));
  const numeric = scoreResponses(sheet({ 1: ["B", "2"] }));
  assert.equal(roman.perItem[0].flagsCode, numeric.perItem[0].flagsCode);
});

test("every misconception maps to exactly 3 items, none shared", () => {
  const all = Object.values(CODE_ITEMS).flat();
  assert.equal(all.length, 12);
  assert.equal(new Set(all).size, 12);
});
