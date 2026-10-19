/*
 * Reshape a raw Google Forms response export (CSV downloaded from the linked Sheet) into the
 * responses.csv format score-inventory.js expects (dev-docs/pilot-collection-google-forms.md):
 *
 *   participantCode, form, item1_answer, item1_reason, ..., item15_answer, item15_reason
 *
 * Matches source columns named like "P4 answer" / "P4 reason" (Form A) or "Q4 answer" /
 * "Q4 reason" (Form B), and a participant-code column containing "participant" and "code"
 * (case-insensitive) in its header. Everything else (Timestamp, consent/assent questions, names)
 * is dropped — this script only ever touches the quiz item columns and the code, never consent
 * data.
 *
 *   node scripts/analysis/convert-google-form-export.js form1-export.csv --form A -o responses-A.csv
 *   node scripts/analysis/convert-google-form-export.js form2-export.csv --form B -o responses-B.csv
 */
const fs = require("fs");
const { parseArgs } = require("./lib/args");

const a = parseArgs(process.argv.slice(2), ["o", "out", "form"]);
const inPath = a._[0];
if (!inPath || !a.form) {
  console.error(
    "usage: node scripts/analysis/convert-google-form-export.js <export.csv> --form A|B [-o responses.csv]"
  );
  process.exit(1);
}
const form = String(a.form).toUpperCase();
if (form !== "A" && form !== "B") {
  console.error("--form must be A or B");
  process.exit(1);
}
const outPath = a.o || a.out || `responses-${form}.csv`;
const prefix = form === "A" ? "P" : "Q";

function readCsv(path) {
  const text = fs.readFileSync(path, "utf8").trim();
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
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

const { header, rows } = readCsv(inPath);

// Find the participant-code column.
const codeIdx = header.findIndex((h) => /participant/i.test(h) && /code/i.test(h));
if (codeIdx === -1) {
  console.error('Could not find a participant-code column (header must contain "participant" and "code").');
  process.exit(1);
}

// Find item1..15 answer/reason columns by matching "<prefix><n> answer" / "<prefix><n> reason".
const itemCols = {};
header.forEach((h, idx) => {
  const m = h.trim().match(new RegExp(`^${prefix}(\\d{1,2})\\s*(answer|reason)$`, "i"));
  if (!m) return;
  const n = Number(m[1]);
  if (n < 1 || n > 15) return;
  const kind = m[2].toLowerCase();
  itemCols[n] = itemCols[n] || {};
  itemCols[n][kind] = idx;
});

const missing = [];
for (let n = 1; n <= 15; n += 1) {
  if (!itemCols[n] || itemCols[n].answer == null || itemCols[n].reason == null) missing.push(n);
}
if (missing.length) {
  console.error(
    `Missing answer/reason columns for item(s): ${missing.join(", ")} ` +
      `(expected headers like "${prefix}${missing[0]} answer" / "${prefix}${missing[0]} reason").`
  );
  process.exit(1);
}

const outHeader = ["participantCode", "form"];
for (let n = 1; n <= 15; n += 1) outHeader.push(`item${n}_answer`, `item${n}_reason`);

const outRows = rows.map((row) => {
  const out = [row[codeIdx], form];
  for (let n = 1; n <= 15; n += 1) {
    out.push(row[itemCols[n].answer] || "", row[itemCols[n].reason] || "");
  }
  return out;
});

const lines = [outHeader, ...outRows].map((r) => r.map(csvCell).join(","));
fs.writeFileSync(outPath, lines.join("\n") + "\n");
console.log(`Wrote ${outRows.length} row(s) to ${outPath}`);
