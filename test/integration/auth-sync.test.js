// Integration test for auth.controller.syncUser (POST /api/auth/sync) — the User model's statics are
// replaced by an in-memory store that enforces the unique clerkId/email indexes, and fetch is stubbed
// to serve Clerk's JWKS and Backend API. Clerk tokens are real RS256 JWTs checked by the real
// verifyClerkToken, so token verification is exercised, not mocked.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");

const ISSUER = "https://test-instance.clerk.accounts.dev";
process.env.CLERK_ISSUER = ISSUER;
process.env.CLERK_SECRET_KEY = "sk_test_dummy";
process.env.JWT_SECRET = "test-jwt-secret";

const User = require("../../src/models/User");
const { syncUser } = require("../../src/controllers/auth.controller");

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const KID = "test-kid";
const JWKS = { keys: [{ ...publicKey.export({ format: "jwk" }), kid: KID, alg: "RS256", use: "sig" }] };

const clerkToken = (sub, key = privateKey) =>
  jwt.sign({ sub }, key, { algorithm: "RS256", keyid: KID, issuer: ISSUER, expiresIn: "5m" });

// Yield to the event loop so concurrent syncs interleave between every DB / Clerk call.
const tick = () => new Promise((resolve) => setImmediate(resolve));

const duplicateKey = (field, value) => Object.assign(new Error(`E11000 duplicate key: ${field}`), { code: 11000, keyValue: { [field]: value } });

const matches = (rec, filter) =>
  Object.entries(filter).every(([k, v]) => (v && typeof v === "object" && "$ne" in v ? rec[k] !== v.$ne : rec[k] === v));

// In-memory stand-in for the users collection.
function userStore(t, initial = []) {
  const rows = new Map(initial.map((r) => [r._id, structuredClone(r)]));
  let nextId = 1;

  const assertUnique = (rec) => {
    for (const other of rows.values()) {
      if (other._id === rec._id) continue;
      if (other.clerkId === rec.clerkId) throw duplicateKey("clerkId", rec.clerkId);
      if (other.email === rec.email) throw duplicateKey("email", rec.email);
    }
  };
  const doc = (rec) =>
    Object.assign(structuredClone(rec), {
      async save() {
        await tick();
        const { save, ...data } = this;
        assertUnique(data);
        rows.set(data._id, structuredClone(data));
        return this;
      },
    });
  const find = (filter) => [...rows.values()].find((r) => matches(r, filter));

  t.mock.method(User, "findOne", async (filter) => {
    await tick();
    const rec = find(filter);
    return rec ? doc(rec) : null;
  });
  t.mock.method(User, "exists", async (filter) => {
    await tick();
    const rec = find(filter);
    return rec ? { _id: rec._id } : null;
  });
  t.mock.method(User, "create", async (data) => {
    await tick();
    const rec = { _id: `new${nextId++}`, role: "student", learningProfile: { totalSessions: 0 }, ...data };
    assertUnique(rec);
    rows.set(rec._id, structuredClone(rec));
    return doc(rec);
  });
  t.mock.method(User, "findOneAndUpdate", async (filter, update) => {
    await tick();
    const rec = find(filter);
    if (!rec) return null;
    const next = { ...rec, ...update.$set };
    assertUnique(next);
    rows.set(rec._id, next);
    return doc(next);
  });

  return { rows };
}

// Stubbed Clerk: JWKS plus GET /v1/users/{id} answered from `users` (missing id -> 404).
function clerkApi(t, users = {}, { down = false } = {}) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    await tick();
    url = String(url);
    if (url === `${ISSUER}/.well-known/jwks.json`) return Response.json(JWKS);
    const m = url.match(/^https:\/\/api\.clerk\.com\/v1\/users\/(.+)$/);
    if (!m) throw new Error(`unexpected fetch ${url}`);
    calls.push(decodeURIComponent(m[1]));
    assert.equal(init.headers.Authorization, "Bearer sk_test_dummy");
    if (down) return new Response("upstream error", { status: 502 });
    const user = users[decodeURIComponent(m[1])];
    return user ? Response.json(user) : new Response("not found", { status: 404 });
  });
  return { calls };
}

const clerkUser = (id, email, status = "verified") => ({
  id,
  primary_email_address_id: "idn_1",
  email_addresses: [{ id: "idn_1", email_address: email, verification: { status } }],
});

async function sync(sub, body, { token = clerkToken(sub) } = {}) {
  const req = { headers: { authorization: `Bearer ${token}` }, body: { clerkId: sub, ...body } };
  const res = {
    statusCode: undefined,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  let error;
  await syncUser(req, res, (err) => (error = err));
  if (error) throw error;
  return res;
}

const tokenUserId = (res) => jwt.verify(res.body.data.token, process.env.JWT_SECRET).id;

function quietLogs(t) {
  const info = t.mock.method(console, "info", () => {});
  const warn = t.mock.method(console, "warn", () => {});
  return { info, warn, lines: () => [...info.mock.calls, ...warn.mock.calls].map((c) => c.arguments.join(" ")) };
}

const ALICE = {
  _id: "u1",
  clerkId: "user_old",
  name: "Alice",
  email: "alice@example.com",
  grade: 9,
  school: "North High",
  role: "student",
  learningProfile: { totalSessions: 12, averageScore: 81 },
};

test("existing user by clerkId: profile refreshed, token issued, Clerk API not called", async (t) => {
  quietLogs(t);
  const { rows } = userStore(t, [ALICE]);
  const { calls } = clerkApi(t);

  const res = await sync("user_old", { name: "Alice Smith", email: "alice@example.com" });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(tokenUserId(res), "u1");
  assert.equal(rows.get("u1").name, "Alice Smith");
  assert.deepEqual(calls, []);
});

test("new user: created with the Clerk-verified email", async (t) => {
  quietLogs(t);
  const { rows } = userStore(t);
  clerkApi(t, { user_new: clerkUser("user_new", "Bob@Example.com") });

  const res = await sync("user_new", { name: "Bob", email: "bob@example.com" });

  assert.equal(res.statusCode, 200);
  assert.equal(rows.size, 1);
  const [bob] = rows.values();
  assert.equal(tokenUserId(res), bob._id);
  assert.equal(bob.clerkId, "user_new");
  assert.equal(bob.email, "bob@example.com");
  assert.equal(bob.grade, 8);
});

test("same verified email, new clerkId, old Clerk user gone: re-links and keeps the Lab data", async (t) => {
  const logs = quietLogs(t);
  const { rows } = userStore(t, [ALICE]);
  const { calls } = clerkApi(t, { user_recreated: clerkUser("user_recreated", "alice@example.com") });

  const res = await sync("user_recreated", { name: "Alice", email: "alice@example.com" });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(Object.keys(res.body.data).sort(), ["token", "user"]);
  assert.equal(tokenUserId(res), "u1");
  assert.equal(rows.size, 1);
  const alice = rows.get("u1");
  assert.equal(alice.clerkId, "user_recreated");
  assert.deepEqual(alice.learningProfile, ALICE.learningProfile);
  assert.equal(alice.school, "North High");
  assert.deepEqual(calls, ["user_recreated", "user_old"]);
  const relinkLog = logs.lines().find((l) => l.includes("Re-linked"));
  assert.match(relinkLog, /u1: clerkId user_old -> user_recreated/);
  assert.doesNotMatch(relinkLog, /alice@example\.com/);
});

test("same email but not verified in Clerk: 409, record untouched", async (t) => {
  quietLogs(t);
  const { rows } = userStore(t, [ALICE]);
  clerkApi(t, { user_attacker: clerkUser("user_attacker", "alice@example.com", "unverified") });

  const res = await sync("user_attacker", { name: "Mallory", email: "alice@example.com" });

  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, { success: false, message: "This email is already linked to another account." });
  assert.equal(rows.get("u1").clerkId, "user_old");
  assert.equal(rows.size, 1);
});

test("body email names an existing user but Clerk verifies a different email: own record, no re-link", async (t) => {
  quietLogs(t);
  const { rows } = userStore(t, [ALICE]);
  clerkApi(t, { user_attacker: clerkUser("user_attacker", "mallory@example.com") });

  const res = await sync("user_attacker", { name: "Mallory", email: "alice@example.com" });

  // Mallory gets her own record under her real email; Alice's is not touched.
  assert.equal(res.statusCode, 200);
  assert.notEqual(tokenUserId(res), "u1");
  assert.equal(rows.get("u1").clerkId, "user_old");
});

test("same verified email but the record's old Clerk user still exists: 409, no re-link", async (t) => {
  quietLogs(t);
  const { rows } = userStore(t, [ALICE]);
  clerkApi(t, {
    user_old: clerkUser("user_old", "alice.new@example.com"),
    user_other: clerkUser("user_other", "alice@example.com"),
  });

  const res = await sync("user_other", { name: "Someone", email: "alice@example.com" });

  assert.equal(res.statusCode, 409);
  assert.equal(rows.get("u1").clerkId, "user_old");
});

test("Clerk API unreachable when a re-link is needed: 503 (app retries), record untouched", async (t) => {
  quietLogs(t);
  const { rows } = userStore(t, [ALICE]);
  clerkApi(t, {}, { down: true });

  const res = await sync("user_recreated", { name: "Alice", email: "alice@example.com" });

  assert.equal(res.statusCode, 503);
  assert.equal(rows.get("u1").clerkId, "user_old");
});

test("body clerkId that differs from the token's sub is ignored", async (t) => {
  quietLogs(t);
  const { rows } = userStore(t, [ALICE]);
  clerkApi(t, { user_mallory: clerkUser("user_mallory", "mallory@example.com") });

  const res = await sync("user_mallory", { clerkId: "user_old", name: "Mallory", email: "mallory@example.com" });

  assert.equal(res.statusCode, 200);
  assert.notEqual(tokenUserId(res), "u1");
  assert.equal(rows.get(tokenUserId(res)).clerkId, "user_mallory");
  assert.equal(rows.get("u1").name, "Alice");
});

test("token signed by an unknown key is rejected with 401", async (t) => {
  quietLogs(t);
  const { rows } = userStore(t, [ALICE]);
  clerkApi(t);
  const { privateKey: otherKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });

  const res = await sync("user_old", { name: "Alice" }, { token: clerkToken("user_old", otherKey) });

  assert.equal(res.statusCode, 401);
  assert.equal(rows.get("u1").name, "Alice");
});

test("concurrent first syncs for a new user: both succeed with the same single record", async (t) => {
  quietLogs(t);
  const { rows } = userStore(t);
  clerkApi(t, { user_new: clerkUser("user_new", "bob@example.com") });

  const [a, b] = await Promise.all([
    sync("user_new", { name: "Bob", email: "bob@example.com" }),
    sync("user_new", { name: "Bob", email: "bob@example.com" }),
  ]);

  assert.equal(a.statusCode, 200);
  assert.equal(b.statusCode, 200);
  assert.equal(rows.size, 1);
  assert.equal(tokenUserId(a), tokenUserId(b));
  assert.equal(User.create.mock.callCount(), 2); // both raced to insert; the loser re-read
});

test("concurrent re-link syncs: both succeed, one re-link, data kept", async (t) => {
  const logs = quietLogs(t);
  const { rows } = userStore(t, [ALICE]);
  clerkApi(t, { user_recreated: clerkUser("user_recreated", "alice@example.com") });

  const [a, b] = await Promise.all([
    sync("user_recreated", { name: "Alice", email: "alice@example.com" }),
    sync("user_recreated", { name: "Alice", email: "alice@example.com" }),
  ]);

  assert.equal(a.statusCode, 200);
  assert.equal(b.statusCode, 200);
  assert.equal(tokenUserId(a), "u1");
  assert.equal(tokenUserId(b), "u1");
  assert.equal(rows.size, 1);
  assert.equal(rows.get("u1").clerkId, "user_recreated");
  assert.deepEqual(rows.get("u1").learningProfile, ALICE.learningProfile);
  assert.equal(User.findOneAndUpdate.mock.callCount(), 2); // both raced to re-link; the loser re-read
  assert.equal(logs.lines().filter((l) => l.includes("Re-linked")).length, 1);
});
