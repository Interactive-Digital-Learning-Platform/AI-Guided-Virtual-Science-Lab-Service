/*
 * Lab service  <->  curriculum knowledge base (Qdrant).
 *
 * Retrieval is done by CurriculumKnowledgeService (./curriculumKnowledgeService.js), which is a
 * Node port of AI-Learning-Assistant-Service's RetrievalService — same collection, same nomic
 * `search_query:` embeddings, same over-fetch + score-threshold (+ top-1 fallback).
 * This job runs one query per practical / per step, then has Groq name the lesson + tightest page
 * range, and writes the result onto the Mongo `Experiment` documents
 * (Experiment.curriculumRefs / steps[].curriculumRefs) so the RUNNING service reads only Mongo at
 * hint time — see src/services/curriculumReferenceService.js.
 *
 * Isolated package (its own node_modules) so onnxruntime / the embedding model never bloat the
 * main service. Run it whenever the curriculum changes (e.g. a new grade's textbook is ingested).
 *
 *   cd scripts/curriculum
 *   npm install
 *   npm run sync -- --grades 10,11                 # dry run: writes the JSON snapshot only
 *   npm run sync -- --grades 10,11 --apply         # also writes to Mongo
 *
 * Env (read from ../../.env then this dir's .env, local wins) — retrieval vars mirror the
 * assistant service's app/core/config.py:
 *   MONGODB_URI            required   (same as the lab service)
 *   MONGODB_DB             optional   default: db in the URI, else "test"
 *   QDRANT_URL             required   e.g. http://localhost:6333  (must be reachable + populated)
 *   QDRANT_COLLECTION      optional   default pdf_knowledge_base
 *   QDRANT_API_KEY         optional
 *   EMBEDDING_MODEL        optional   default nomic-ai/nomic-embed-text-v1.5 (ONNX weights)
 *   EMBEDDING_DTYPE        optional   default q8  (ONNX quantization: fp32|fp16|q8|q4)
 *   EMBEDDING_BACKEND      optional   "transformers" (default, local) | "nomic-api"
 *   NOMIC_API_KEY          required only when EMBEDDING_BACKEND=nomic-api
 *   TOP_K_CHUNKS           optional   default 8
 *   SCORE_THRESHOLD        optional   default 0.4   (below it → fall back to the best single hit)
 *   RERANK_OVERFETCH       optional   default 4     (Qdrant pulls TOP_K_CHUNKS * this candidates)
 *   GROQ_API_KEY           required
 *   GROQ_MODEL             optional   default openai/gpt-oss-120b
 */
"use strict";

const path = require("path");
const fs = require("fs");

require("dotenv").config({ path: path.join(__dirname, ".env"), override: true });
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });

const { MongoClient } = require("mongodb");
const { CurriculumKnowledgeService } = require("./curriculumKnowledgeService");

const OUTPUT_PATH = path.join(__dirname, "..", "..", "src", "data", "curriculum", "curriculumRefs.generated.json");
const MIN_CONFIDENCE_DEFAULT = 0.35;

// --------------------------------------------------------------------------------------------------
// args / env
// --------------------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const hasFlag = (f) => argv.includes(f);
const optVal = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const OPTS = {
  grades: optVal("--grades", "10,11").split(",").map((s) => parseInt(s.trim(), 10)).filter(Boolean),
  subjects: optVal("--subjects", "Chemistry,Physics").split(",").map((s) => s.trim()).filter(Boolean),
  apply: hasFlag("--apply"),
  topK: parseInt(optVal("--top-k", "8"), 10),
  minConfidence: parseFloat(optVal("--min-confidence", String(MIN_CONFIDENCE_DEFAULT))),
  noSteps: hasFlag("--no-steps"),
  limit: parseInt(optVal("--limit", "0"), 10),
  // Resume-friendly: skip practicals that already have curriculumRefs in Mongo unless --force.
  // Results are persisted after EACH practical, so a crash (e.g. Groq daily-limit) loses nothing.
  force: hasFlag("--force"),
};

const need = (name) => {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
};

need("QDRANT_URL");
const kb = new CurriculumKnowledgeService({ topK: OPTS.topK });

// Retrieve the textbook chunks most relevant to `queryText`, restricted to the discovered books.
// Thin wrapper over the shared KB service (embed → Qdrant → threshold/rerank/fallback).
const retrieve = (queryText, bookFilenames) =>
  kb.search(queryText, { filters: { filename: bookFilenames } });

// --------------------------------------------------------------------------------------------------
// LLM distillation (Groq, OpenAI-compatible) — via fetch, no SDK
// --------------------------------------------------------------------------------------------------
const DISTILL_SYSTEM =
  "You map a school science practical (or one step of it) to the single best-matching lesson in a " +
  "government textbook, using ONLY the supplied excerpts. Reply with strict JSON: " +
  '{"lessonTitle": string, "sectionTitle": string, "pageStart": int, "pageEnd": int, ' +
  '"confidence": number 0..1, "snippet": string <=200 chars, "notes": string}. ' +
  "Pick the TIGHTEST page range that truly covers the topic. If none of the excerpts are genuinely " +
  "about this topic, return confidence 0 with empty strings and 0 pages.";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function groqChat(body, attempt = 1) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${need("GROQ_API_KEY")}` },
    body: JSON.stringify(body),
  });
  if (res.status === 429 && attempt <= 6) {
    const txt = await res.text();
    const m = txt.match(/try again in ([\d.]+)s/i);
    const wait = m ? Math.ceil(parseFloat(m[1]) * 1000) + 500 : Math.min(2 ** attempt * 1000, 30000);
    console.log(`    Groq rate-limited — waiting ${(wait / 1000).toFixed(1)}s (attempt ${attempt})`);
    await sleep(wait);
    return groqChat(body, attempt + 1);
  }
  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
  return res.json();
}

async function distill(topic, chunks, maxPages) {
  if (!chunks.length) return null;
  // Keep the prompt small — Groq's free tier is ~8k tokens/min and this runs ~140 times.
  const excerpts = chunks
    .slice(0, 6)
    .map((c, i) => {
      const lo = c.pages[0] ?? "?";
      const hi = c.pages[c.pages.length - 1] ?? "?";
      return `[${i + 1}] (pages ${lo}-${hi})\n${c.text.slice(0, 700)}`;
    })
    .join("\n\n");

  const json = await groqChat({
    model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: DISTILL_SYSTEM },
      { role: "user", content: `PRACTICAL / STEP:\n${topic}\n\nTEXTBOOK EXCERPTS:\n${excerpts}` },
    ],
  });
  let data;
  try {
    data = JSON.parse(json.choices[0].message.content);
  } catch {
    return null;
  }

  let ps = int(data.pageStart);
  let pe = int(data.pageEnd);
  if (ps && pe && pe < ps) [ps, pe] = [pe, ps];
  const clamp = (n) => (n ? Math.max(1, Math.min(n, maxPages || n)) : n);
  ps = clamp(ps);
  pe = clamp(pe) || ps;

  return {
    lessonTitle: (data.lessonTitle || "").trim(),
    sectionTitle: (data.sectionTitle || "").trim(),
    pageStart: ps,
    pageEnd: pe,
    confidence: Math.round((Number(data.confidence) || 0) * 100) / 100,
    snippet: (data.snippet || "").trim().slice(0, 200),
  };
}

const int = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

// --------------------------------------------------------------------------------------------------
// query building
// --------------------------------------------------------------------------------------------------
const experimentQuery = (exp) =>
  [exp.title, exp.lesson, exp.theory, (exp.keyConcepts || []).length ? `Key concepts: ${exp.keyConcepts.join("; ")}` : ""]
    .filter(Boolean)
    .join(" ")
    .trim();

const stepQuery = (exp, step) =>
  [step.title, step.instruction, step.observationGoal, exp.lesson ? `Topic: ${exp.lesson}` : ""]
    .filter(Boolean)
    .join(" ")
    .trim();

function toRef(distilled, book, chunks) {
  return {
    bookTitle: book.title,
    bookFilename: book.filename,
    grade: book.grade,
    lessonTitle: distilled.lessonTitle,
    sectionTitle: distilled.sectionTitle,
    pageStart: distilled.pageStart,
    pageEnd: distilled.pageEnd,
    confidence: distilled.confidence,
    snippet: distilled.snippet,
    sourceChunkIds: chunks.slice(0, 5).map((c) => c.id),
  };
}

function dominantBook(chunks, books) {
  const counts = {};
  for (const c of chunks) counts[c.filename] = (counts[c.filename] || 0) + 1;
  const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  return books.find((b) => b.filename === top) || books[0];
}

const usable = (d) => d && d.confidence >= OPTS.minConfidence && d.lessonTitle && d.pageStart;

// --------------------------------------------------------------------------------------------------
// main
// --------------------------------------------------------------------------------------------------
async function main() {
  console.log(`grades=${OPTS.grades} subjects=${OPTS.subjects} apply=${OPTS.apply}\n`);

  const books = await kb.discoverBooks(OPTS.grades);
  if (!books.length) {
    console.error(
      `No matching textbooks in the Qdrant collection "${kb.cfg.collection}" for grades ${OPTS.grades}.\n` +
        `Check QDRANT_URL points at the instance the ingestion pipeline populated, and that it has data.`
    );
    process.exit(1);
  }
  console.log("Books in the knowledge base:");
  books.forEach((b) => console.log(`  - ${b.filename}  ->  ${b.title}  (~${b.maxPage} pages)`));
  const maxPageByFile = Object.fromEntries(books.map((b) => [b.filename, b.maxPage]));
  const bookFilenames = books.map((b) => b.filename);

  const mongo = new MongoClient(need("MONGODB_URI"));
  await mongo.connect();
  const dbName = process.env.MONGODB_DB || mongo.db().databaseName || "test";
  const db = mongo.db(dbName);
  const experiments = db.collection("experiments");

  let practicals = await experiments
    .find({ subject: { $in: OPTS.subjects }, isActive: { $ne: false } })
    .sort({ title: 1 })
    .toArray();
  practicals = practicals.filter((p) => !p.grades?.length || p.grades.some((g) => OPTS.grades.includes(g)));
  if (OPTS.limit) practicals = practicals.slice(0, OPTS.limit);

  const skipped = [];
  if (!OPTS.force) {
    const before = practicals.length;
    practicals = practicals.filter((p) => {
      if (p.curriculumRefs && p.curriculumRefs.length) {
        skipped.push(p.title);
        return false;
      }
      return true;
    });
    if (before !== practicals.length) {
      console.log(`Skipping ${before - practicals.length} practical(s) that already have refs (--force to redo).`);
    }
  }
  console.log(`\n${practicals.length} practical(s) to process\n`);

  // Merge into the existing snapshot rather than overwriting — lets partial runs (across subjects
  // or across days, when Groq's daily limit is hit) accumulate.
  const result = readSnapshot();
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  const matched = [];
  const unmatched = [];
  let done = 0;

  try {
    for (const exp of practicals) {
      const entry = { generatedAt: new Date().toISOString(), experimentRefs: [], steps: {} };

      const chunks = await retrieve(experimentQuery(exp), bookFilenames);
      const book = dominantBook(chunks, books);
      const d = await distill(`${exp.title} (whole practical)`, chunks, maxPageByFile[book.filename]);
      if (usable(d)) {
        const ref = toRef(d, book, chunks);
        entry.experimentRefs = [ref];
        matched.push([exp.title, "*", ref.lessonTitle, ref.pageStart, ref.pageEnd, ref.confidence]);
      } else {
        unmatched.push(exp.title);
      }

      if (!OPTS.noSteps) {
        for (const step of exp.steps || []) {
          if (step.stepId == null) continue;
          const sChunks = await retrieve(stepQuery(exp, step), bookFilenames);
          const sBook = dominantBook(sChunks, books);
          const sd = await distill(`${exp.title} — step ${step.stepId}: ${step.title || ""}`, sChunks, maxPageByFile[sBook.filename]);
          if (usable(sd)) {
            const sRef = toRef(sd, sBook, sChunks);
            entry.steps[String(step.stepId)] = [sRef];
            matched.push([exp.title, String(step.stepId), sRef.lessonTitle, sRef.pageStart, sRef.pageEnd, sRef.confidence]);
          }
        }
      }

      // Persist THIS practical immediately (snapshot + Mongo) so a later crash loses nothing.
      result[exp.title] = entry;
      writeSnapshot(result);
      if (OPTS.apply) await applyOne(experiments, exp.title, entry);
      done += 1;
      console.log(
        `  ✓ ${exp.title}  (exp ref: ${entry.experimentRefs.length ? "yes" : "NO"}, ` +
          `steps ${Object.keys(entry.steps).length}/${(exp.steps || []).length})`
      );
    }
  } catch (err) {
    console.error(`\n✗ Stopped after ${done}/${practicals.length} practical(s): ${err.message}`);
    console.error(`  Progress so far IS saved (snapshot${OPTS.apply ? " + Mongo" : ""}). Re-run the same`);
    console.error(`  command to resume — finished practicals are skipped automatically.`);
    await mongo.close();
    process.exit(1);
  }

  console.log(`\nSnapshot: ${path.relative(path.join(__dirname, "..", ".."), OUTPUT_PATH)}`);
  console.log("\n--- matched (practical / step / lesson / pages / confidence) ---");
  for (const [t, s, l, ps, pe, c] of matched) {
    console.log(`  ${t.slice(0, 30).padEnd(30)}  ${String(s).padStart(3)}  ${l.slice(0, 32).padEnd(32)}  p${ps}-${pe}  ${c}`);
  }
  if (unmatched.length) {
    console.log(`\n--- no confident experiment-level match (${unmatched.length}) ---`);
    unmatched.forEach((t) => console.log(`  - ${t}`));
  }
  if (skipped.length) console.log(`\nSkipped (already had refs): ${skipped.join(", ")}`);
  console.log(OPTS.apply ? "\nApplied to Mongo." : "\nDry run — re-run with --apply to write to Mongo.");

  await mongo.close();
}

function readSnapshot() {
  try {
    return JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeSnapshot(obj) {
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

async function applyOne(experiments, title, entry) {
  await experiments.updateOne(
    { title },
    { $set: { curriculumRefs: entry.experimentRefs, curriculumRefsGeneratedAt: new Date() } }
  );
  for (const [sid, refs] of Object.entries(entry.steps)) {
    await experiments.updateOne(
      { title },
      { $set: { "steps.$[s].curriculumRefs": refs } },
      { arrayFilters: [{ "s.stepId": parseInt(sid, 10) }] }
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
