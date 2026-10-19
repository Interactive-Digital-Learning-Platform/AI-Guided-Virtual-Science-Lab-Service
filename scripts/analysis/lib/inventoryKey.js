// Answer key + scoring for the acid-base two-tier concept inventory
// (dev-docs/concept-inventory-acid-base.md §6–§7). Pure — unit-tested.
//
// Item numbers 1..15 are the same construct on both forms (P_k / Q_k are parallel), so responses
// are scored form-agnostically as item{1..15}_answer / item{1..15}_reason.

const norm = (v) => String(v == null ? "" : v).trim().toLowerCase();
const ROMAN = { 1: "i", 2: "ii", 3: "iii", 4: "iv", i: "i", ii: "ii", iii: "iii", iv: "iv" };
const normReason = (v) => ROMAN[norm(v)] || norm(v);
const normAns = (v) => norm(v).toUpperCase();

// code -> its three item numbers
const CODE_ITEMS = {
  CHEM_001: [4, 8, 12],
  CHEM_002: [1, 6, 11],
  CHEM_003: [2, 7, 13],
  CHEM_004: [3, 9, 14],
};
const CONTROL_ITEMS = [5, 10, 15];
const CODES = Object.keys(CODE_ITEMS);

// item -> { correct: [answer, reason], code, flags(ans, reason) => bool }
// `flags` follows the §6 table exactly. Everything correct is (A, i) except item 7 which is (B, i).
const KEY = {
  1: { correct: ["A", "i"], code: "CHEM_002", flags: (a, r) => (a === "B" && r === "ii") || (a === "C" && r === "iii") },
  2: { correct: ["A", "i"], code: "CHEM_003", flags: (a, r) => r === "ii" },
  3: { correct: ["A", "i"], code: "CHEM_004", flags: (a, r) => r === "ii" },
  4: { correct: ["A", "i"], code: "CHEM_001", flags: (a, r) => a === "D" || r === "ii" },
  5: { correct: ["A", "i"], code: null, flags: () => false },
  6: { correct: ["A", "i"], code: "CHEM_002", flags: (a, r) => ["B", "D"].includes(a) && ["ii", "iv"].includes(r) },
  7: { correct: ["B", "i"], code: "CHEM_003", flags: (a, r) => a === "C" && r === "ii" },
  8: { correct: ["A", "i"], code: "CHEM_001", flags: (a, r) => a === "C" || r === "ii" },
  9: { correct: ["A", "i"], code: "CHEM_004", flags: (a, r) => r === "ii" },
  10: { correct: ["A", "i"], code: null, flags: () => false },
  11: { correct: ["A", "i"], code: "CHEM_002", flags: (a, r) => ["C", "D"].includes(a) && ["ii", "iii"].includes(r) },
  12: { correct: ["A", "i"], code: "CHEM_001", flags: (a, r) => ["B", "C"].includes(a) && r === "ii" },
  13: { correct: ["A", "i"], code: "CHEM_003", flags: (a, r) => a === "B" && r === "ii" },
  14: { correct: ["A", "i"], code: "CHEM_004", flags: (a, r) => a === "B" && r === "ii" },
  15: { correct: ["A", "i"], code: null, flags: () => false },
};

/**
 * Score one participant's response sheet.
 * @param {object} row  keys item1_answer / item1_reason ... item15_answer / item15_reason
 *                      (missing / blank -> treated as wrong, never as flagging a misconception)
 * @returns {{ conceptualScore, labels, perItem, answered }}
 */
function scoreResponses(row) {
  const perItem = [];
  for (let i = 1; i <= 15; i += 1) {
    const a = normAns(row[`item${i}_answer`]);
    const r = normReason(row[`item${i}_reason`]);
    const k = KEY[i];
    const answered = !!a && !!r;
    const bothCorrect = a === k.correct[0] && r === k.correct[1];
    const flagsCode = answered && !bothCorrect && k.flags(a, r);
    perItem.push({ item: i, code: k.code, answered, bothCorrect, flagsCode });
  }

  const conceptualScore = perItem.filter((p) => p.bothCorrect).length;

  const labels = {};
  for (const code of CODES) {
    const items = perItem.filter((p) => CODE_ITEMS[code].includes(p.item));
    const signal = items.filter((p) => p.flagsCode).length;
    const fullyCorrect = items.filter((p) => p.bothCorrect).length;
    if (signal >= 2) labels[code] = 1;
    else if (signal === 0) labels[code] = 0;
    else labels[code] = fullyCorrect < 2 ? 1 : 0; // the "1 of 3" tie-break (§7.2)
  }

  return { conceptualScore, labels, perItem, answered: perItem.filter((p) => p.answered).length };
}

module.exports = { KEY, CODE_ITEMS, CONTROL_ITEMS, CODES, scoreResponses };
