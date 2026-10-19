# Curriculum knowledge base access

The lab service reaches the shared curriculum knowledge base — the Qdrant collection the
PDF-ingestion pipeline populates — **directly**, the same way `AI-Learning-Assistant-Service`
does. Nothing here touches the ingestion service or the assistant service.

| File | Role | Mirrors (in AI-Learning-Assistant-Service) |
|---|---|---|
| `curriculumKnowledgeService.js` | the retrieval client: embed query → Qdrant `query` → over-fetch → score threshold (with top-1 fallback) | `app/services/retrieval_service.py` + `embedding_service.py` |
| `syncCurriculumRefs.js` | offline job: run one query per practical / step, have Groq name the lesson + page range, write `Experiment.curriculumRefs` / `steps[].curriculumRefs` in Mongo | — |

The **running** lab service reads only Mongo at hint time (`src/services/curriculumReferenceService.js`) —
no Qdrant/embedding dependency in the request path. Re-run this job whenever the curriculum or the
practicals change.

Kept as an isolated package (its own `node_modules`) so the embedding runtime (`onnxruntime`,
the model) never bloats the main service.

## What it connects to

| Target | Why | Env |
|---|---|---|
| Qdrant | the knowledge base — chunk text + page numbers | `QDRANT_URL`, `QDRANT_COLLECTION` |
| MongoDB | the practicals; where refs are written | `MONGODB_URI` (from `../../.env`) |
| Groq | names the lesson / picks the page range | `GROQ_API_KEY` (from `../../.env`) |

The book list is discovered from Qdrant's own `filename` payloads — no ingestion Postgres.

## Setup

```bash
cd scripts/curriculum
npm install                 # ~150MB (onnxruntime + transformers); one time
cp .env.example .env        # set QDRANT_URL; the rest inherits from ../../.env
```

`QDRANT_URL` must point at the Qdrant instance the ingestion pipeline actually wrote to, and it
must be reachable from wherever you run this. (Qdrant defaults to `localhost:6333` and is
per-machine — if a teammate ran the ingestion, either run this on their machine, point at a shared
Qdrant, or re-ingest locally.)

## Run

```bash
# from the repo root:
npm run curriculum:sync -- --grades 10,11              # dry run — writes the JSON snapshot only
npm run curriculum:sync -- --grades 10,11 --apply      # also writes to Mongo

# or from this dir: npm run sync -- --grades 10,11 --apply
```

Covers **Chemistry + Physics** by default (`--subjects Chemistry,Physics`). Other flags:
`--subjects Chemistry`, `--top-k 8`, `--min-confidence 0.35`, `--no-steps`, `--limit N` (debug),
`--force` (re-do practicals that already have refs).

**Resume-friendly.** Results are persisted to the snapshot **and Mongo after each practical**, and
practicals that already have `curriculumRefs` are skipped unless `--force`. So if it dies partway
(commonly Groq's ~200k-tokens/day free limit), just re-run the same command — it picks up where it
left off. Switch `GROQ_MODEL` (`openai/gpt-oss-20b`, `qwen/qwen3.8-27b`, …) to continue on a
different model's quota.

The run prints a `practical → lesson → pages → confidence` table and lists practicals with no
confident match. `src/data/curriculum/curriculumRefs.generated.json` is merged (not overwritten)
and re-merged by `npm run seed`, so a re-seed keeps the refs without re-querying Qdrant.

## Retrieval config (mirrors the assistant service's `app/core/config.py`)

| Env | Default | |
|---|---|---|
| `EMBEDDING_MODEL` | `nomic-ai/nomic-embed-text-v1.5` | ONNX weights; same model + 768-dim as ingestion |
| `EMBEDDING_DTYPE` | `q8` | ONNX quantization (`fp32`/`fp16`/`q8`/`q4`) |
| `EMBEDDING_BACKEND` | `transformers` | `transformers` (local) or `nomic-api` (+ `NOMIC_API_KEY`) |
| `TOP_K_CHUNKS` | `8` | chunks passed to the LLM |
| `SCORE_THRESHOLD` | `0.4` | cosine cutoff; below it, falls back to the single best hit |
| `RERANK_OVERFETCH` | `4` | Qdrant pulls `TOP_K_CHUNKS * this` candidates before thresholding |

The assistant service's cross-encoder rerank step is **not** ported — transformers.js can't do
sentence-pair classification cleanly, and here the Groq distillation pass already reads the whole
candidate set and reasons jointly over (query, chunk), which is what a reranker would provide.

## Live retrieval (not wired)

`CurriculumKnowledgeService` is a plain module — `new CurriculumKnowledgeService().search(query)`
returns ranked `SearchResult`s. If per-request live retrieval is ever wanted in the running
service, this is the piece to call from `requestHint` (with a timeout + graceful fallback, like
the assistant service's `_safe_search`). Left out of the default path so hint responses never wait
on Qdrant/an embedding model — the offline job keeps the Mongo cache warm instead.
