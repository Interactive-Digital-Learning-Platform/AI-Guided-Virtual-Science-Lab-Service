// Verifies Clerk session tokens for POST /api/auth/sync, so a backend JWT is only ever issued to
// the Clerk user who actually signed in (the clerkId comes from the verified token, never the body).
//
// Trust comes from server config only: CLERK_ISSUER (e.g. https://<instance>.clerk.accounts.dev)
// fixes both the expected `iss` and the JWKS endpoint. CLERK_AUTHORIZED_PARTIES (optional,
// comma-separated origins) restricts a token's `azp` when present — native sessions omit it.
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const JWKS_TTL_MS = 60 * 60 * 1000;
// An unknown `kid` (Clerk key rotation) triggers a refetch, but at most this often.
const JWKS_MIN_REFETCH_MS = 60 * 1000;

let keys = new Map();
let fetchedAt = 0;
let inflight;

const issuer = () => (process.env.CLERK_ISSUER || "").trim().replace(/\/+$/, "");

const authorizedParties = () =>
  (process.env.CLERK_AUTHORIZED_PARTIES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

function refreshKeys() {
  if (!inflight) {
    inflight = (async () => {
      const res = await fetch(`${issuer()}/.well-known/jwks.json`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`Clerk JWKS fetch failed with status ${res.status}`);
      const body = await res.json();
      keys = new Map(
        (body.keys || [])
          .filter((k) => k.kty === "RSA" && k.kid)
          .map((k) => [k.kid, crypto.createPublicKey({ key: k, format: "jwk" })])
      );
      fetchedAt = Date.now();
    })().finally(() => {
      inflight = undefined;
    });
  }
  return inflight;
}

async function keyFor(kid) {
  const age = Date.now() - fetchedAt;
  if (age > JWKS_TTL_MS || (!keys.has(kid) && age > JWKS_MIN_REFETCH_MS)) await refreshKeys();
  return keys.get(kid);
}

// Resolves to the verified token claims, or throws.
async function verifyClerkToken(token) {
  if (!issuer()) throw new Error("CLERK_ISSUER is not configured");
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || decoded.header.alg !== "RS256" || !decoded.header.kid) throw new Error("Malformed Clerk token");

  const key = await keyFor(decoded.header.kid);
  if (!key) throw new Error("Unknown Clerk signing key");

  const claims = jwt.verify(token, key, { algorithms: ["RS256"], issuer: issuer(), clockTolerance: 5 });
  if (typeof claims.sub !== "string" || !claims.sub.startsWith("user_")) throw new Error("Invalid Clerk subject");
  const parties = authorizedParties();
  if (claims.azp !== undefined && parties.length && !parties.includes(claims.azp)) {
    throw new Error("Untrusted Clerk authorized party");
  }
  return claims;
}

module.exports = { verifyClerkToken };
