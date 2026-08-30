/*
 * Score filled-in concept-inventory response sheets into the label file the analysis pipeline needs
 * (dev-docs/concept-inventory-acid-base.md §7). Deterministic — key lookup, no judgement calls.
 *
 * Input CSV (one row per participant per form):
 *   participantCode, form, item1_answer, item1_reason, ..., item15_answer, item15_reason
 *   answers: A-D   reasons: i/ii/iii/iv or 1-4   blank = wrong
 *
 *   node scripts/analysis/score-inventory.js responses.csv
 *   node scripts/analysis/score-inventory.js responses.csv --form A --sessions map.csv -o labels.csv
 *   node scripts/analysis/score-inventory.js responses.csv --item-stats
 *
 * --sessions map.csv : participantCode,sessionId  -> output keyed by sessionId (predictive-validity
 *                      / fit-params format). Without it, output is keyed by participantCode.
 * --form A|B|both    : which form's rows to score (default both, emitted as separate rows).
 * No database.
 */
const fs = require("fs");
const { parseArgs } = require("./lib/args");
const { scoreResponses, CODES, CODE_ITEMS, CONTROL_ITEMS } = require("./lib/inventoryKey");

const a = parseArgs(process.argv.slice(2), ["o", "out", "form", "sessions"]);
const inPath = a._[0];
if (!inPath) {
  console.error("usage: node scripts/analysis/score-inventory.js <responses.csv> [--form A|B|both] [--sessions map.csv] [-o labels.csv] [--item-stats]");
  process.exit(1);
}
const formFilter = (a.form || "both").toUpperCase();
const outPath = a.o || a.out || "labels.csv";

// Minimal CSV reader (handles quotes).
function readCsv(path) {
  const text = fs.readFileSync(path, "utf8").trim();
  const lines = text.split(/\r?\n/).filter(Boolean);
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
  const cols = split(lines[0]).map((c) => c.trim());
  return lines.slice(1).map((l) => {
    const v = split(l);
    return Object.fromEntries(cols.map((c, i) => [c, (v[i] ?? "").trim()]));
  });
}

const rows = readCsv(inPath);
const sessionMap = a.sessions
  ? Object.fromEntries(readCsv(a.sessions).map((r) => [r.participantCode, r.sessionId]))
  : null;

const scored = [];
for (const row of rows) {
  const form = (row.form || "").toUpperCase();
  if (formFilter !== "BOTH" && form !== formFilter) continue;
  const res = scoreResponses(row);
  scored.push({
    participantCode: row.participantCode,
    sessionId: sessionMap ? sessionMap[row.participantCode] || "" : "",
    form,
    conceptualScore: res.conceptualScore,
    answered: res.answered,
    labels: res.labels,
    perItem: res.perItem,
  });
}

if (!scored.length) {
  console.error(`No rows matched form=${formFilter}.`);
  process.exit(1);
}

// ── labels file ──────────────────────────────────────────────────────────────
const keyCol = sessionMap ? "sessionId" : "participantCode";
const header = [keyCol, "form", "conceptualScore", ...CODES.map((c) => `label_${c}`)];
const body = scored.map((s) =>
  [sessionMap ? s.sessionId : s.participantCode, s.form, s.conceptualScore, ...CODES.map((c) => s.labels[c])].join(",")
);
fs.writeFileSync(outPath, [header.join(","), ...body].join("\n"));

const unmatched = sessionMap ? scored.filter((s) => !s.sessionId).map((s) => s.participantCode) : [];
console.log(`scored ${scored.length} response sheet(s) -> ${outPath}`);
console.log(`  mean conceptual score: ${(scored.reduce((n, s) => n + s.conceptualScore, 0) / scored.length).toFixed(1)} / 15`);
for (const code of CODES) {
  const held = scored.filter((s) => s.labels[code] === 1).length;
  console.log(`  ${code}: flagged in ${held}/${scored.length} (${((100 * held) / scored.length).toFixed(0)}%)`);
}
if (unmatched.length) console.log(`  ⚠ no sessionId for: ${unmatched.join(", ")}`);
const lowAnswered = scored.filter((s) => s.answered < 13);
if (lowAnswered.length) console.log(`  ⚠ ${lowAnswered.length} sheet(s) with <13 items answered (check for skipped questions)`);

// ── optional item stats (for the §8 validity checklist) ──────────────────────
if (a["item-stats"]) {
  console.log("\nitem | n | %correct | %flag-code");
  for (let i = 1; i <= 15; i += 1) {
    const its = scored.map((s) => s.perItem[i - 1]);
    const n = its.filter((x) => x.answered).length || 1;
    const pc = ((100 * its.filter((x) => x.bothCorrect).length) / n).toFixed(0);
    const pf = ((100 * its.filter((x) => x.flagsCode).length) / n).toFixed(0);
    const tag = CONTROL_ITEMS.includes(i) ? "control" : Object.keys(CODE_ITEMS).find((c) => CODE_ITEMS[c].includes(i));
    console.log(`  ${String(i).padStart(2)} (${tag.padEnd(8)}) | ${String(n).padStart(3)} | ${pc.padStart(3)}% | ${pf.padStart(3)}%`);
  }
  // crude discrimination: point-biserial of each item's correctness with the total
  const totals = scored.map((s) => s.conceptualScore);
  const mean = totals.reduce((x, y) => x + y, 0) / totals.length;
  const sd = Math.sqrt(totals.reduce((x, y) => x + (y - mean) ** 2, 0) / totals.length) || 1;
  console.log("\nitem discrimination (point-biserial with total score; want > 0.2):");
  for (let i = 1; i <= 15; i += 1) {
    const x = scored.map((s) => (s.perItem[i - 1].bothCorrect ? 1 : 0));
    const p = x.reduce((a2, b) => a2 + b, 0) / x.length;
    if (p === 0 || p === 1) { console.log(`  ${String(i).padStart(2)}:  (no variance)`); continue; }
    const meanCorrect = scored.filter((s) => s.perItem[i - 1].bothCorrect).reduce((n2, s) => n2 + s.conceptualScore, 0) / (p * x.length);
    const rpb = ((meanCorrect - mean) / sd) * Math.sqrt(p / (1 - p));
    console.log(`  ${String(i).padStart(2)}: ${rpb.toFixed(2)}`);
  }
}
