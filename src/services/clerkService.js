// Clerk Backend API lookups for POST /api/auth/sync. Only needed when a Clerk user has no record
// under its own clerkId yet (first sign-in, or an existing record that has to be re-linked), so a
// normal sign-in never calls Clerk. Plain fetch, like the JWKS fetch in middleware/clerkAuth.js.
//
// CLERK_SECRET_KEY must belong to the same Clerk instance as CLERK_ISSUER.
const CLERK_API_URL = "https://api.clerk.com/v1";

const secretKey = () => (process.env.CLERK_SECRET_KEY || "").trim();

const isConfigured = () => Boolean(secretKey());

// Resolves to the Clerk user (GET /v1/users/{id}, i.e. users.getUser), or null if this instance has
// no such user. Throws on anything else (not configured, network, 5xx) — "could not check".
async function getClerkUser(userId) {
  if (!isConfigured()) throw new Error("CLERK_SECRET_KEY is not configured");
  // Real Clerk ids look like user_…; anything else (e.g. the dev bypass user) can't exist in Clerk.
  if (typeof userId !== "string" || !userId.startsWith("user_")) return null;

  const res = await fetch(`${CLERK_API_URL}/users/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${secretKey()}` },
    signal: AbortSignal.timeout(5000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Clerk user lookup failed with status ${res.status}`);
  return res.json();
}

// The user's primary email address, lowercased, only if Clerk has verified it; otherwise null.
function verifiedPrimaryEmail(clerkUser) {
  if (!clerkUser) return null;
  const primary = (clerkUser.email_addresses || []).find((e) => e.id === clerkUser.primary_email_address_id);
  if (!primary || primary.verification?.status !== "verified" || typeof primary.email_address !== "string") {
    return null;
  }
  return primary.email_address.trim().toLowerCase();
}

module.exports = { isConfigured, getClerkUser, verifiedPrimaryEmail };
