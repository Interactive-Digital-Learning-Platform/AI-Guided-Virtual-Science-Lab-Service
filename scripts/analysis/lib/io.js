// Tiny JSON/CSV helpers for the analysis scripts. Pure-ish (fs only).
const fs = require("fs");

// Flatten one analysis record into a flat row for CSV: posterior.<CODE> / half.<CODE> / label_<CODE>
// become columns; nested objects/arrays that don't flatten cleanly are dropped from the CSV.
function flattenRecord(r) {
  const flat = {
    sessionId: r.sessionId,
    user: r.user,
    practical: r.practical,
    subject: r.subject,
    cluster: r.cluster,
    arm: r.arm,
    attemptNumber: r.attemptNumber,
    completedAt: r.completedAt ? new Date(r.completedAt).toISOString() : "",
    score: r.score,
    performanceScore: r.performanceScore,
    timeScore: r.timeScore ?? "",
    totalActiveTime: r.totalActiveTime,
    errorRate: r.errorRate,
    totalErrors: r.totalErrors,
    totalHints: r.totalHints,
    struggledSteps: r.struggledSteps,
    actionCount: r.actionCount,
    divergenceFlag: r.divergenceFlag ? 1 : 0,
    ruleMisconceptions: (r.ruleMisconceptions || []).join("|"),
    modelDiagnosis: (r.modelDiagnosis || []).join("|"),
  };
  for (const [code, p] of Object.entries(r.posterior || {})) flat[`posterior.${code}`] = p;
  for (const [code, p] of Object.entries(r.posteriorFirstHalf || {})) flat[`half.${code}`] = p;
  for (const [code, l] of Object.entries(r.labels || {})) flat[`label_${code}`] = l == null ? "" : l;
  return flat;
}

function toCsv(records) {
  const rows = records.map(flattenRecord);
  const cols = [...rows.reduce((s, row) => { Object.keys(row).forEach((k) => s.add(k)); return s; }, new Set())];
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((row) => cols.map((c) => esc(row[c])).join(","))].join("\n");
}

function writeOut(path, records, { csv = false } = {}) {
  if (csv) fs.writeFileSync(path, toCsv(records));
  else fs.writeFileSync(path, JSON.stringify(records, null, 2));
}

function readExport(path) {
  const raw = fs.readFileSync(path, "utf8").trim();
  if (path.endsWith(".csv") || (raw[0] !== "[" && raw[0] !== "{")) return parseCsv(raw);
  return JSON.parse(raw);
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const cols = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const vals = splitCsvLine(line);
    const rec = { posterior: {}, posteriorFirstHalf: {}, labels: {} };
    cols.forEach((c, i) => {
      const v = vals[i];
      if (c.startsWith("posterior.")) rec.posterior[c.slice(10)] = v === "" ? null : Number(v);
      else if (c.startsWith("half.")) rec.posteriorFirstHalf[c.slice(5)] = v === "" ? null : Number(v);
      else if (c.startsWith("label_")) rec.labels[c.slice(6)] = v === "" ? null : Number(v);
      else if (["score", "performanceScore", "errorRate", "totalErrors", "totalHints", "actionCount", "struggledSteps", "attemptNumber"].includes(c))
        rec[c] = v === "" ? null : Number(v);
      else if (["ruleMisconceptions", "modelDiagnosis"].includes(c)) rec[c] = v ? v.split("|") : [];
      else rec[c] = v;
    });
    return rec;
  });
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// Merge a labels CSV (columns: sessionId, label_<CODE>...) into the records by sessionId.
function applyLabels(records, labelsPath) {
  const rows = readExport(labelsPath);
  const bySession = Object.fromEntries(rows.map((r) => [r.sessionId, r]));
  let matched = 0;
  for (const rec of records) {
    const lr = bySession[rec.sessionId];
    if (!lr) continue;
    matched += 1;
    rec.labels = rec.labels || {};
    for (const [k, v] of Object.entries(lr.labels || {})) if (v != null) rec.labels[k] = v;
  }
  return { matched };
}

module.exports = { flattenRecord, toCsv, writeOut, readExport, applyLabels };
