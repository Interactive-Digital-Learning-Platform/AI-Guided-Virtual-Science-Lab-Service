/*
 * One-off processor for the first real collection batch (dev-docs/google-forms/Form A, Form B).
 * The deployed forms only included a subset of the 15 items (not all), in form-specific order, and
 * some option text was retyped rather than copied verbatim from concept-inventory-acid-base.md — so
 * this does NOT just reshape columns positionally like convert-google-form-export.js. It:
 *
 *   1. Matches each raw question header to its real item number (1-15) by content, per form.
 *   2. Matches each free-text answer/reason cell to A-D / i-iv by best word-overlap against the
 *      canonical option text (handles retyped/paraphrased wording).
 *   3. Assigns a participantCode per unique student (normalized name+school) and writes:
 *        - pilot-data/participant-key-PRIVATE.csv   (name, school, grade, code) — gitignored, never commit
 *        - pilot-data/responses-A.csv / responses-B.csv  (code, form, item{1..15}_answer/_reason;
 *          items not administered in this batch are left blank, same "blank = wrong" convention
 *          score-inventory.js already uses)
 *   4. Prints every low-confidence match for manual review — never silently guesses on an
 *      ambiguous cell without flagging it.
 *
 * node scripts/analysis/process-collected-pilot-data.js
 */
const fs = require("fs");
const path = require("path");

function readCsv(p) {
  const text = fs.readFileSync(p, "utf8").trim();
  const lines = text.split(/\r?\n/);
  const split = (line) => {
    const out = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i += 1) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out;
  };
  const header = split(lines[0]);
  const rows = lines.slice(1).map(split);
  return { header, rows };
}
function csvCell(v) {
  const s = String(v == null ? "" : v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function writeCsv(p, header, rows) {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(","));
  fs.writeFileSync(p, lines.join("\n") + "\n");
}
const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
function wordOverlapScore(a, b) {
  const wa = new Set(norm(a).split(" ").filter((w) => w.length > 2));
  const wb = new Set(norm(b).split(" ").filter((w) => w.length > 2));
  if (wa.size === 0 || wb.size === 0) return 0;
  let hits = 0;
  wa.forEach((w) => { if (wb.has(w)) hits += 1; });
  return hits / Math.max(wa.size, wb.size);
}
function bestMatch(text, candidates) {
  // candidates: [{ key, text }]
  let best = null;
  let bestScore = -1;
  candidates.forEach((c) => {
    const score = wordOverlapScore(text, c.text);
    if (score > bestScore) { bestScore = score; best = c; }
  });
  return { key: best && best.key, score: bestScore };
}

// --- Item bank: only the items actually present in either collected form, per form letter ----
// Text copied verbatim from dev-docs/concept-inventory-acid-base.md §4/§5.
const BANK = {
  A: {
    1: {
      stem: "Phenolphthalein is added to a colourless solution of sodium hydroxide",
      answers: {
        A: "basic (high pH)", B: "warm", C: "cold", D: "concentrated",
      },
      reasons: {
        i: "phenolphthalein is pink when the pH is above about 8",
        ii: "phenolphthalein turns pink when a solution warms up",
        iii: "phenolphthalein turns pink when a solution cools down",
        iv: "phenolphthalein turns pink when a solution is strong",
      },
    },
    2: {
      stem: "Dilute hydrochloric acid (a strong acid) is neutralised by exactly the right amount of sodium hydroxide",
      answers: { A: "about 7", B: "a little above 7", C: "a little below 7", D: "about 1" },
      reasons: {
        i: "the salt formed (sodium chloride) does not make the solution acidic or basic",
        ii: "every neutralisation reaction produces a solution of exactly pH 7",
        iii: "there is always a little unreacted acid left over",
        iv: "sodium chloride is a basic salt",
      },
    },
    3: {
      stem: "A student pours some sodium chloride solution into some potassium nitrate solution",
      answers: {
        A: "nothing the ions just mix together", B: "a solid forms and sinks",
        C: "bubbles of gas appear", D: "the mixture gets noticeably hot",
      },
      reasons: {
        i: "all of the ions stay dissolved, so no solid, gas, or new substance can form",
        ii: "whenever two solutions are mixed, a chemical reaction takes place",
        iii: "sodium chloride and potassium nitrate always react to make a precipitate",
        iv: "mixing solutions always releases heat",
      },
    },
    8: {
      stem: "In a titration, a student adds the base to the flask before adding the indicator to the acid",
      answers: {
        A: "harder to see the exact end-point", B: "easier to see the exact end-point",
        C: "exactly the same", D: "impossible for any reaction to happen",
      },
      reasons: {
        i: "without the indicator present from the start, the colour change that marks the end-point can be missed or overshot",
        ii: "the order of adding substances has no effect on a titration",
        iii: "adding the base first makes the reaction go faster",
        iv: "the indicator only works if it is added first to the base",
      },
    },
    9: {
      stem: "Copper(II) sulfate solution (blue) is added to sodium chloride solution",
      answers: {
        A: "no reaction occurs the mixture is just pale blue",
        B: "a coloured solid always forms when a coloured solution is added to a colourless one",
        C: "a gas is always released", D: "the blue colour always disappears",
      },
      reasons: {
        i: "none of the ions present form an insoluble solid or a gas, so there is no reaction",
        ii: "adding any solution to another always produces a new substance",
        iii: "coloured solutions always react with colourless ones",
        iv: "copper compounds react with everything",
      },
    },
    10: {
      stem: "Universal indicator is added to a beaker of pure water. The colour is green",
      answers: { A: "orange or red", B: "blue or purple", C: "stays green", D: "colourless" },
      reasons: {
        i: "adding acid increases the concentration of hydrogen ions, lowering the pH",
        ii: "adding any liquid to water turns the indicator red",
        iii: "the indicator reacts with water over time",
        iv: "acids remove the colour from indicators",
      },
    },
  },
  B: {
    1: {
      stem: "Methyl orange is added to a colourless solution of dilute hydrochloric acid",
      answers: { A: "acidic (low pH)", B: "cold", C: "warm", D: "dilute" },
      reasons: {
        i: "methyl orange is red when the pH is below about 3.5",
        ii: "methyl orange turns red when a solution cools down",
        iii: "methyl orange turns red when a solution warms up",
        iv: "methyl orange turns red when a solution is dilute",
      },
    },
    2: {
      stem: "Dilute nitric acid (a strong acid) is neutralised by exactly the right amount of potassium hydroxide",
      answers: { A: "about 7", B: "a little above 7", C: "a little below 7", D: "about 13" },
      reasons: {
        i: "the salt formed (potassium nitrate) does not make the solution acidic or basic",
        ii: "every neutralisation gives a solution of exactly pH 7",
        iii: "there is always some unreacted base left",
        iv: "potassium nitrate is an acidic salt",
      },
    },
    3: {
      stem: "A student pours some potassium chloride solution into some sodium sulfate solution",
      answers: { A: "nothing the ions just mix", B: "a solid forms", C: "a gas is given off", D: "the mixture gets hot" },
      reasons: {
        i: "all the ions stay dissolved, so nothing new can form",
        ii: "mixing any two solutions causes a reaction",
        iii: "chlorides and sulfates always react",
        iv: "mixing solutions always releases heat",
      },
    },
    4: {
      stem: "A student wants to find the exact point at which a base has been neutralised by an acid, using methyl orange",
      answers: {
        A: "base, then the indicator, then slowly add the acid", B: "base, then the acid, then the indicator",
        C: "acid, then the indicator, then the base", D: "it makes no difference add all three at once",
      },
      reasons: {
        i: "the indicator must already be in the base so it can show the moment the acid is in slight excess",
        ii: "the order chemicals are added in never changes the result",
        iii: "the indicator must be added last so it is not used up",
        iv: "the acid must be added first because it is more dangerous",
      },
    },
    5: {
      stem: "During the neutralisation of nitric acid by potassium hydroxide the mixture warms up slightly",
      answers: { A: "the reaction is exothermic", B: "stirring warms the mixture", C: "the indicator gives off heat", D: "bases are always warm" },
      reasons: {
        i: "forming the product bonds releases more energy than is used breaking the reactant bonds",
        ii: "mixing always causes friction heating",
        iii: "a colour change means heat is being produced",
        iv: "bases store heat and release it when used",
      },
    },
    6: {
      stem: "A solution of a base has phenolphthalein added (pink) and is gently warmed on a hotplate",
      answers: { A: "stay pink", B: "turn colourless", C: "turn blue", D: "turn orange" },
      reasons: {
        i: "warming alone does not change the pH, so the indicator colour stays the same",
        ii: "phenolphthalein loses its colour when heated",
        iii: "heating makes any base weaker",
        iv: "phenolphthalein turns orange when hot",
      },
    },
  },
};

const ROOT = path.join(__dirname, "..", "..");
const RAW_A = path.join(ROOT, "dev-docs", "google-forms", "Form A", "Pre -Test -Response - Form responses 1.csv");
const RAW_B = path.join(ROOT, "dev-docs", "google-forms", "Form B", "post-test-responses - Form responses 1.csv");
const OUT_DIR = path.join(ROOT, "pilot-data");
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function matchHeaderItems(header, bank) {
  // header: [Timestamp, Name, School, Grade, q1, r1, q2, r2, ...]
  const pairs = [];
  for (let i = 4; i + 1 < header.length; i += 2) pairs.push([i, i + 1]);
  const itemNums = Object.keys(bank).map(Number).sort((a, b) => a - b);
  const assignment = []; // { itemNum, qCol, rCol, score }
  pairs.forEach(([qCol, rCol]) => {
    let best = null;
    let bestScore = -1;
    itemNums.forEach((n) => {
      const score = wordOverlapScore(header[qCol], bank[n].stem);
      if (score > bestScore) { bestScore = score; best = n; }
    });
    assignment.push({ itemNum: best, qCol, rCol, score: bestScore });
  });
  return assignment;
}

function processForm(formLetter, rawPath, bank) {
  const { header, rows } = readCsv(rawPath);
  const assignment = matchHeaderItems(header, bank);
  console.log(`\n=== Form ${formLetter}: header -> item mapping ===`);
  assignment.forEach((a) => {
    console.log(
      `  col ${a.qCol} ("${header[a.qCol].slice(0, 55)}...") -> item ${a.itemNum}  (match score ${a.score.toFixed(2)})`
    );
    if (a.score < 0.5) console.log(`    *** LOW CONFIDENCE — verify this mapping manually ***`);
  });

  const lowConfidenceCells = [];
  const deid = rows.map((row, rowIdx) => {
    const rec = { name: row[1], school: row[2], grade: row[3] };
    const items = {};
    assignment.forEach((a) => {
      const item = bank[a.itemNum];
      const ansText = row[a.qCol];
      const reasonText = row[a.rCol];
      const ansCandidates = Object.entries(item.answers).map(([k, t]) => ({ key: k, text: t }));
      const reasonCandidates = Object.entries(item.reasons).map(([k, t]) => ({ key: k, text: t }));
      const CELL_MIN_SCORE = 0.5;
      const ansMatch = bestMatch(ansText, ansCandidates);
      const reasonMatch = bestMatch(reasonText, reasonCandidates);
      const ansOk = ansMatch.score >= CELL_MIN_SCORE;
      const reasonOk = reasonMatch.score >= CELL_MIN_SCORE;
      if (!ansOk) {
        lowConfidenceCells.push({ row: rowIdx + 1, name: rec.name, item: a.itemNum, field: "answer", raw: ansText, guessed: ansMatch.key, score: ansMatch.score });
      }
      if (!reasonOk) {
        lowConfidenceCells.push({ row: rowIdx + 1, name: rec.name, item: a.itemNum, field: "reason", raw: reasonText, guessed: reasonMatch.key, score: reasonMatch.score });
      }
      // Below-threshold cells are left BLANK (honest "unscorable"), never the weak guess -
      // writing a low-confidence guess as if it were the real answer would silently corrupt
      // the scored dataset. Blank is scored as "wrong" by score-inventory.js, same as any
      // other unanswered item.
      items[a.itemNum] = { answer: ansOk ? ansMatch.key : "", reason: reasonOk ? reasonMatch.key : "" };
    });
    return { ...rec, items };
  });

  if (lowConfidenceCells.length) {
    console.log(`\n  !! ${lowConfidenceCells.length} low-confidence cell(s) in Form ${formLetter} — left BLANK (scored as wrong), not guessed:`);
    lowConfidenceCells.forEach((c) =>
      console.log(`     row ${c.row} (${c.name}) item ${c.item} ${c.field}: raw="${c.raw}" (best guess would've been ${c.guessed}, score ${c.score.toFixed(2)})`)
    );
  } else {
    console.log(`  All cells matched with score >= 0.5.`);
  }

  return deid;
}

const deidA = processForm("A", RAW_A, BANK.A);
const deidB = processForm("B", RAW_B, BANK.B);

// --- Participant code assignment: normalize name+school, match across forms where possible ----
// Manual overrides confirmed by the researcher (2026-10-19) for pairs the automatic exact
// name+school match couldn't resolve on its own (typo'd school, or typo'd first name):
//   - "S.D surith akalanka" @ Lumbini college/collge colombo 5 -> same student
//   - "N nuwani edirisighe" @ Pannipitiya Daramapala/Darmapala vidyalaya/widyalaya -> same student
//   - "Sarath" / "Saman" @ Beliatta maha vidyalaya -> same student (name typo)
//   - "Dinuka" / "Nipun" @ Hungama vijayabha / Vijayabha National School Hungama -> same student (name typo)
const MANUAL_ALIASES = [
  [norm("S.D surith akalanka") + "|" + norm("Lumbini collge colombo 5"), norm("S.D surith akalanka") + "|" + norm("Lumbini college colombo 5")],
  [norm("N nuwani edirisighe") + "|" + norm("Pannipitiya Darmapala widyalaya"), norm("N nuwani edirisighe") + "|" + norm("Pannipitiya Daramapala vidyalaya")],
  [norm("Saman") + "|" + norm("Beliatta maha vidyalaya"), norm("Sarath") + "|" + norm("Beliatta maha vidyalaya")],
  [norm("Nipun") + "|" + norm("Vijayabha National School Hungama"), norm("Dinuka") + "|" + norm("Hungama vijayabha national school")],
];
function resolveAlias(key) {
  const hit = MANUAL_ALIASES.find(([from]) => from === key);
  return hit ? hit[1] : key;
}
const keyMap = new Map(); // normKey -> { code, name, school, grade, inA, inB }
let nextCode = 1;
function codeFor(rec) {
  const key = resolveAlias(norm(rec.name) + "|" + norm(rec.school));
  if (!keyMap.has(key)) {
    const code = `P${String(nextCode).padStart(2, "0")}`;
    nextCode += 1;
    keyMap.set(key, { code, name: rec.name, school: rec.school, grade: rec.grade, inA: false, inB: false });
  }
  return keyMap.get(key);
}
deidA.forEach((r) => { codeFor(r).inA = true; });
deidB.forEach((r) => { codeFor(r).inB = true; });

console.log("\n=== Participant code assignment (exact name+school match only) ===");
console.log("code  inA  inB  name  |  school");
keyMap.forEach((v) => {
  console.log(`${v.code}  ${v.inA ? " A " : " . "}  ${v.inB ? " B " : " . "}  ${v.name}  |  ${v.school}`);
});
const onlyA = [...keyMap.values()].filter((v) => v.inA && !v.inB);
const onlyB = [...keyMap.values()].filter((v) => !v.inA && v.inB);
console.log(`\n${onlyA.length} respondent(s) have a pre-test only (no exact-name post-test match):`);
onlyA.forEach((v) => console.log(`  ${v.code} ${v.name} | ${v.school}`));
console.log(`\n${onlyB.length} respondent(s) have a post-test only (no exact-name pre-test match):`);
onlyB.forEach((v) => console.log(`  ${v.code} ${v.name} | ${v.school}`));
console.log(
  "\nNOTE: matching is EXACT normalized name+school only — it does not guess at likely typos " +
    "(e.g. a name spelled differently between forms). Anyone who should be matched but isn't listed " +
    "as inA+inB above needs a human decision, not an automated guess."
);

// --- Write outputs -------------------------------------------------------------------------
const keyRows = [...keyMap.values()].map((v) => [v.code, v.name, v.school, v.grade, v.inA ? "A" : "", v.inB ? "B" : ""]);
writeCsv(path.join(OUT_DIR, "participant-key-PRIVATE.csv"), ["participantCode", "name", "school", "grade", "inFormA", "inFormB"], keyRows);

function writeResponses(formLetter, deid, outName) {
  const header = ["participantCode", "form"];
  for (let n = 1; n <= 15; n += 1) header.push(`item${n}_answer`, `item${n}_reason`);
  const rows = deid.map((r) => {
    const rec = codeFor(r);
    const row = [rec.code, formLetter];
    for (let n = 1; n <= 15; n += 1) {
      const it = r.items[n];
      row.push(it ? it.answer || "" : "", it ? it.reason || "" : "");
    }
    return row;
  });
  writeCsv(path.join(OUT_DIR, outName), header, rows);
  console.log(`\nWrote ${rows.length} row(s) to pilot-data/${outName}`);
}
writeResponses("A", deidA, "responses-A.csv");
writeResponses("B", deidB, "responses-B.csv");

console.log(
  "\npilot-data/participant-key-PRIVATE.csv holds real names — it is gitignored. Never commit it, " +
    "never paste its contents anywhere outside this machine."
);
