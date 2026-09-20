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
const { cronbachAlpha, itemRestCorrelation, parallelFormSummary } = require("./lib/inventoryStats");
const { THRESHOLDS, reviewItems, prevalenceReview } = require("./lib/itemReview");

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
    durationMinutes: row.durationMinutes === "" || row.durationMinutes == null ? null : Number(row.durationMinutes),
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
  const matrix = scored.map((s) => s.perItem.map((item) => (item.bothCorrect ? 1 : 0)));
  const alpha = cronbachAlpha(matrix);
  console.log(`\nCronbach's alpha (15 binary item scores): ${alpha == null ? "not estimable" : alpha.toFixed(3)}  (target >= ~0.6)`);
  console.log("\nitem | n | %correct | %flag-code");
  for (let i = 1; i <= 15; i += 1) {
    const its = scored.map((s) => s.perItem[i - 1]);
    const n = its.filter((x) => x.answered).length || 1;
    const pc = ((100 * its.filter((x) => x.bothCorrect).length) / n).toFixed(0);
    const pf = ((100 * its.filter((x) => x.flagsCode).length) / n).toFixed(0);
    const tag = CONTROL_ITEMS.includes(i) ? "control" : Object.keys(CODE_ITEMS).find((c) => CODE_ITEMS[c].includes(i));
    console.log(`  ${String(i).padStart(2)} (${tag.padEnd(8)}) | ${String(n).padStart(3)} | ${pc.padStart(3)}% | ${pf.padStart(3)}%`);
  }
  console.log("\nitem discrimination (item-rest correlation; want > 0.2):");
  for (let i = 1; i <= 15; i += 1) {
    const correlation = itemRestCorrelation(matrix, i - 1);
    console.log(`  ${String(i).padStart(2)}: ${correlation == null ? "(no variance)" : correlation.toFixed(2)}`);
  }

  const durations = scored.map((s) => s.durationMinutes).filter((value) => Number.isFinite(value) && value >= 0);
  if (durations.length) {
    const within25 = durations.filter((value) => value <= 25).length;
    console.log(`\ntiming: ${within25}/${durations.length} (${((100 * within25) / durations.length).toFixed(0)}%) completed within 25 minutes (target >=90%)`);
  } else console.log("\ntiming: not available (fill durationMinutes in responses.csv)");

  const parallel = parallelFormSummary(scored);
  if (parallel.n) {
    console.log(
      `parallel forms: paired n=${parallel.n}, mean A=${parallel.meanA.toFixed(2)}, mean B=${parallel.meanB.toFixed(2)}, ` +
        `mean B-A=${parallel.meanDifference.toFixed(2)}`
    );
    console.log(`  largest item difficulty shift |B-A|=${Math.max(...parallel.itemDifficultyDelta.map(Math.abs)).toFixed(2)}`);
  } else console.log("parallel forms: no participants with both A and B rows");

  // ── fix / keep decision table (rules from concept-inventory §8) ──────────────
  const reviewed = reviewItems(
    Array.from({ length: 15 }, (_, idx) => {
      const its = scored.map((s) => s.perItem[idx]);
      const code = CONTROL_ITEMS.includes(idx + 1) ? null : Object.keys(CODE_ITEMS).find((c) => CODE_ITEMS[c].includes(idx + 1));
      return {
        item: idx + 1,
        code,
        n: its.length,
        answered: its.filter((x) => x.answered).length,
        correct: its.filter((x) => x.bothCorrect).length,
        flagged: its.filter((x) => x.flagsCode).length,
        discrimination: itemRestCorrelation(matrix, idx),
      };
    })
  );
  console.log(`\n=== REVIEW TABLE (difficulty ${THRESHOLDS.minDifficulty}–${THRESHOLDS.maxDifficulty}, discrimination >= ${THRESHOLDS.minDiscrimination}, omissions <= ${THRESHOLDS.maxOmissionRate * 100}%) ===`);
  for (const r of reviewed) {
    console.log(`  item ${String(r.item).padStart(2)} ${(r.code || "control").padEnd(8)} ${r.verdict.padEnd(6)} ${r.reasons.join("; ")}`);
  }
  const toReview = reviewed.filter((r) => r.verdict === "REVIEW").map((r) => r.item);
  console.log(`  -> ${toReview.length ? `review items: ${toReview.join(", ")}` : "no item flagged"}`);

  const perCode = {};
  for (const code of CODES) {
    perCode[code] = { flagged: scored.filter((s) => s.labels[code] === 1).length, n: scored.length };
  }
  console.log("\n=== MISCONCEPTION PREVALENCE (need >= 25% flagged, else the study can't speak to that code) ===");
  for (const p of prevalenceReview(perCode)) {
    console.log(`  ${p.code}: ${p.flagged}/${p.n} (${p.rate == null ? "n/a" : (p.rate * 100).toFixed(0) + "%"}) ${p.verdict}${p.note ? " — " + p.note : ""}`);
  }
  console.log(
    `\nstatistics guide a human review — with n=${scored.length} they are noisy and never justify dropping an item without the teacher's judgement.`
  );
}
