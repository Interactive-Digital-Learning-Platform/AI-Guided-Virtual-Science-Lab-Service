/*
 * curriculumKnowledgeService — the lab service's client for the shared curriculum knowledge base
 * (the Qdrant collection the PDF-ingestion pipeline populates).
 *
 * Deliberately mirrors AI-Learning-Assistant-Service/app/services/retrieval_service.py +
 * embedding_service.py so both services hit the KB the same way:
 *   - query embedded with nomic-embed-text-v1.5, "search_query: " prefix, L2-normalised, 768-dim
 *   - Qdrant `query` (bi-encoder cosine), over-fetch `topK * rerankOverfetch`
 *   - score threshold, with a fallback to the single best hit so a query is never left with
 *     zero context (their retrieval-service-evaluation.md, issue 5)
 *
 * NOT ported: the assistant service's cross-encoder rerank step. transformers.js's
 * text-classification pipeline doesn't plumb sentence-pair (`text_pair`) inputs through, and in
 * this job the Groq distillation pass already does joint query↔chunk reasoning over the whole
 * candidate set, which is what a reranker would buy us. `RERANK_OVERFETCH` (wider candidate pull
 * before thresholding) is kept.
 *
 * Node port lives here (not in the main service) so the embedding runtime never bloats the
 * Express process — see this folder's package.json / README.
 */
"use strict";

const { QdrantClient } = require("@qdrant/js-client-rest");

// Matches app/core/config.py defaults in the assistant service.
const DEFAULTS = {
  collection: process.env.QDRANT_COLLECTION || "pdf_knowledge_base",
  embeddingModel: process.env.EMBEDDING_MODEL || "nomic-ai/nomic-embed-text-v1.5",
  embeddingDtype: process.env.EMBEDDING_DTYPE || "q8",
  embeddingBackend: process.env.EMBEDDING_BACKEND || "transformers", // transformers | nomic-api
  queryPrefix: process.env.EMBEDDING_QUERY_PREFIX ?? "search_query: ",
  topK: parseInt(process.env.TOP_K_CHUNKS || "8", 10),
  scoreThreshold: parseFloat(process.env.SCORE_THRESHOLD || "0.4"),
  rerankOverfetch: parseInt(process.env.RERANK_OVERFETCH || "4", 10),
};

// A retrieved chunk. `metadata` carries the full Qdrant payload minus `text` (same shape as the
// assistant service's SearchResult); `pageStart` / `pages` are surfaced for convenience.
class SearchResult {
  constructor({ id, text, score, metadata }) {
    this.id = id;
    this.text = text;
    this.score = score;
    this.metadata = metadata;
    this.filename = metadata.filename || "";
    this.pages = (metadata.pages || (metadata.page_start ? [metadata.page_start] : []))
      .map(Number)
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort((x, y) => x - y);
    this.pageStart = this.pages[0] ?? metadata.page_start ?? null;
  }
}

class CurriculumKnowledgeService {
  constructor(opts = {}) {
    this.cfg = { ...DEFAULTS, ...opts };
    this.client = new QdrantClient({
      url: this.cfg.qdrantUrl || process.env.QDRANT_URL,
      apiKey: process.env.QDRANT_API_KEY || undefined,
    });
    this._extractor = null;
  }

  // ---- embeddings (mirrors embedding_service.EmbeddingGenerator.embed_single) -------------------
  async embedQuery(text) {
    const prefixed = `${this.cfg.queryPrefix}${text}`;
    if (this.cfg.embeddingBackend === "nomic-api") {
      const res = await fetch("https://api-atlas.nomic.ai/v1/embedding/text", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${reqEnv("NOMIC_API_KEY")}`,
        },
        body: JSON.stringify({ model: "nomic-embed-text-v1.5", task_type: "search_query", texts: [text] }),
      });
      if (!res.ok) throw new Error(`Nomic API ${res.status}: ${await res.text()}`);
      return (await res.json()).embeddings[0];
    }
    if (!this._extractor) {
      const { pipeline } = await import("@huggingface/transformers");
      console.log(`Loading embedding model ${this.cfg.embeddingModel} (dtype=${this.cfg.embeddingDtype}) ...`);
      this._extractor = await pipeline("feature-extraction", this.cfg.embeddingModel, {
        dtype: this.cfg.embeddingDtype,
      });
    }
    const out = await this._extractor(prefixed, { pooling: "mean", normalize: true });
    return Array.from(out.data);
  }

  // ---- retrieval (mirrors retrieval_service.RetrievalService.search) ---------------------------
  async search(query, { topK, filters, threshold } = {}) {
    const k = topK || this.cfg.topK;
    const th = threshold ?? this.cfg.scoreThreshold;

    const vector = await this.embedQuery(query);
    const must = Object.entries(filters || {}).map(([key, value]) =>
      Array.isArray(value) ? { key, match: { any: value } } : { key, match: { value } }
    );

    const res = await this.client.query(this.cfg.collection, {
      query: vector,
      filter: must.length ? { must } : undefined,
      limit: k * this.cfg.rerankOverfetch,
      with_payload: true,
    });

    const candidates = (res.points || []).map((h) => {
      const payload = h.payload || {};
      const { text, ...metadata } = payload;
      return new SearchResult({
        id: String(h.id),
        text: (text || "").trim(),
        score: Math.round((h.score || 0) * 10000) / 10000,
        metadata,
      });
    });

    const above = candidates.filter((c) => c.score >= th).slice(0, k);
    if (above.length) return above;

    // Nothing cleared the bar — return the single best hit rather than empty context.
    return candidates.slice(0, 1);
  }

  // ---- book discovery (KB-only; no ingestion Postgres) ----------------------------------------
  async discoverBooks(grades) {
    const byFile = new Map();
    let offset;
    do {
      const page = await this.client.scroll(this.cfg.collection, {
        limit: 250,
        offset,
        with_payload: ["filename", "pages", "page_start"],
        with_vector: false,
      });
      for (const pt of page.points) {
        const f = pt.payload?.filename;
        if (!f) continue;
        const pages = pt.payload.pages || (pt.payload.page_start ? [pt.payload.page_start] : []);
        const maxPage = pages.length ? Math.max(...pages.map(Number).filter(Boolean)) : 0;
        byFile.set(f, Math.max(byFile.get(f) || 0, maxPage));
      }
      offset = page.next_page_offset;
    } while (offset);

    const books = [];
    for (const [filename, maxPage] of byFile) {
      const low = filename.toLowerCase();
      if (!/(science|chemistry|physics|biology)/.test(low)) continue;
      const grade = grades.find((g) => new RegExp(`grade[-_ ]?${g}\\b`).test(low));
      if (!grade) continue;
      books.push({ filename, grade, maxPage, title: prettyBookTitle(filename, grade) });
    }
    return books;
  }
}

function prettyBookTitle(filename, grade) {
  const stem = filename.replace(/\.pdf$/i, "").replace(/-?v\d+$/i, "").replace(/-[0-9a-f]{8,}$/i, "");
  const subj = (stem.match(/chemistry|physics|biology|science/i) || ["Science"])[0];
  return `Grade ${grade} ${subj[0].toUpperCase()}${subj.slice(1).toLowerCase()} Textbook`;
}

function reqEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

module.exports = { CurriculumKnowledgeService, SearchResult, prettyBookTitle, DEFAULTS };
