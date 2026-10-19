// Media layer for element/compound artwork.
//
// The rest of the codebase (and the mobile app) only ever sees a resolved `imageUrl` string —
// storage internals (provider, bucket, object key) never leave this module. That makes moving the
// binaries from the local MinIO to real S3 or Cloudinary a backend-only change:
//   provider "minio" / "s3"  -> object lives in the bucket; served by GET /api/media/chemicals/:id
//   provider "cloudinary"    -> `artwork.url` is already a public CDN URL; used as-is / redirected
//
// MinIO speaks the S3 API, so the same client works for a future real-S3 deployment (swap the
// endpoint + credentials in .env). See PDF-Ingestion-Backend-Service for the sibling pattern.
const Minio = require("minio");
const mime = require("mime-types");

const PROVIDER = (process.env.MEDIA_PROVIDER || "minio").toLowerCase();
const BUCKET = process.env.MINIO_BUCKET || "lab-media";

// Accepts "localhost:9000", "http://localhost:9000", or "minio.example.com".
function parseEndpoint(raw) {
  const value = (raw || "localhost:9000").trim();
  const useSSL = /^https:\/\//i.test(value) || String(process.env.MINIO_USE_SSL).toLowerCase() === "true";
  const hostPort = value.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  const [host, portStr] = hostPort.split(":");
  return { endPoint: host, port: portStr ? parseInt(portStr, 10) : useSSL ? 443 : 9000, useSSL };
}

let _client;
function client() {
  if (_client) return _client;
  const { endPoint, port, useSSL } = parseEndpoint(process.env.MINIO_ENDPOINT);
  _client = new Minio.Client({
    endPoint,
    port,
    useSSL,
    accessKey: process.env.MINIO_ACCESS_KEY || "minioadmin",
    secretKey: process.env.MINIO_SECRET_KEY || "minioadmin",
    // Hosted S3-compatible stores: AWS S3 needs the bucket's region ("ap-south-1"), Cloudflare R2
    // uses "auto". Unset (local MinIO) lets the client discover it, which bucket-scoped keys can't.
    ...(process.env.MINIO_REGION ? { region: process.env.MINIO_REGION } : {}),
  });
  return _client;
}

async function ensureBucket() {
  const c = client();
  const exists = await c.bucketExists(BUCKET).catch(() => false);
  if (!exists) await c.makeBucket(BUCKET);
}

async function putObject(key, buffer, contentType) {
  await ensureBucket();
  const type = contentType || mime.lookup(key) || "application/octet-stream";
  await client().putObject(BUCKET, key, buffer, buffer.length, { "Content-Type": type });
  return key;
}

async function getObject(key) {
  const c = client();
  const stat = await c.statObject(BUCKET, key).catch(() => null);
  const stream = await c.getObject(BUCKET, key);
  return {
    stream,
    contentType: (stat && stat.metaData && stat.metaData["content-type"]) || mime.lookup(key) || "image/png",
    contentLength: stat ? stat.size : null,
  };
}

// chemical doc -> the URL string the mobile app should load, or null.
//   direct-URL providers (cloudinary / public S3): the CDN URL, as-is
//   object providers (minio / private S3): a gateway-relative path the client resolves against
//     its own lab-service base (keeps storage details entirely off the client — see
//     Mobile-Application/api/apiClients.ts getLabResourceUrl)
function resolveImageUrl(chemical) {
  const a = chemical && chemical.artwork;
  if (!a || !a.provider) return null;
  if (a.url) return a.url;
  if (a.key) return `api/media/chemicals/${chemical._id}`;
  return null;
}

module.exports = { PROVIDER, BUCKET, client, ensureBucket, putObject, getObject, resolveImageUrl };
