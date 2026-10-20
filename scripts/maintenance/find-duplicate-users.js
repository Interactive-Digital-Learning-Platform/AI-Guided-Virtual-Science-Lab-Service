/*
 * One-off audit for the user records behind 409s from POST /api/auth/sync. Lists:
 *   1. emails held by more than one user (case/whitespace-insensitive) — should be impossible while
 *      the unique index on `email` exists, so this also reports whether the clerkId/email unique
 *      indexes are actually present in the database (sync's concurrency safety relies on them);
 *   2. users whose clerkId does not exist in the Clerk instance of CLERK_SECRET_KEY (account
 *      deleted/recreated, or created under another instance). These re-link automatically on their
 *      owner's next sync if Clerk has verified the email; listed so you can review them.
 *
 *   node scripts/maintenance/find-duplicate-users.js            # both checks
 *   node scripts/maintenance/find-duplicate-users.js --no-clerk # skip the Clerk lookups
 *   node scripts/maintenance/find-duplicate-users.js --json
 *
 * READ ONLY — never writes to the database or to Clerk. Prints emails, so keep the output private.
 */
require("dotenv").config();

const mongoose = require("mongoose");
const User = require("../../src/models/User");

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const skipClerk = args.includes("--no-clerk");

const CLERK_API_URL = "https://api.clerk.com/v1";
const CLERK_BATCH = 100;

async function duplicateEmails() {
  return User.aggregate([
    { $group: { _id: { $toLower: { $trim: { input: "$email" } } }, users: { $push: { _id: "$_id", clerkId: "$clerkId", createdAt: "$createdAt" } }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
    { $sort: { n: -1 } },
  ]);
}

async function uniqueIndexes() {
  const indexes = await User.collection.indexes();
  const isUnique = (field) => indexes.some((ix) => ix.unique && Object.keys(ix.key).join() === field);
  return { clerkId: isUnique("clerkId"), email: isUnique("email") };
}

// Which of `ids` exist in Clerk — GET /v1/users?user_id=…&user_id=… (the list form of users.getUser).
async function existingClerkIds(ids) {
  const key = (process.env.CLERK_SECRET_KEY || "").trim();
  if (!key) throw new Error("CLERK_SECRET_KEY is not set (or pass --no-clerk)");
  const found = new Set();
  for (let i = 0; i < ids.length; i += CLERK_BATCH) {
    const batch = ids.slice(i, i + CLERK_BATCH);
    const qs = new URLSearchParams([["limit", String(CLERK_BATCH)], ...batch.map((id) => ["user_id", id])]);
    const res = await fetch(`${CLERK_API_URL}/users?${qs}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error(`Clerk list users failed with status ${res.status}`);
    for (const u of await res.json()) found.add(u.id);
  }
  return found;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });

  const report = { uniqueIndexes: await uniqueIndexes(), duplicateEmails: await duplicateEmails(), missingInClerk: null };

  if (!skipClerk) {
    const users = await User.find({}, { clerkId: 1, email: 1, name: 1, createdAt: 1 }).lean();
    const clerkShaped = users.filter((u) => typeof u.clerkId === "string" && u.clerkId.startsWith("user_"));
    const found = await existingClerkIds(clerkShaped.map((u) => u.clerkId));
    report.missingInClerk = users
      .filter((u) => !found.has(u.clerkId))
      .map((u) => ({ _id: String(u._id), clerkId: u.clerkId, email: u.email, name: u.name, createdAt: u.createdAt }));
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`unique index on clerkId: ${report.uniqueIndexes.clerkId ? "yes" : "MISSING"}`);
  console.log(`unique index on email:   ${report.uniqueIndexes.email ? "yes" : "MISSING"}`);
  console.log(`\nemails held by more than one user: ${report.duplicateEmails.length}`);
  for (const d of report.duplicateEmails) {
    console.log(`  ${d._id}`);
    for (const u of d.users) console.log(`    user ${u._id}  clerkId ${u.clerkId}  created ${u.createdAt?.toISOString?.() ?? "?"}`);
  }
  if (report.missingInClerk) {
    console.log(`\nusers whose clerkId is not in this Clerk instance: ${report.missingInClerk.length}`);
    for (const u of report.missingInClerk) {
      console.log(`  user ${u._id}  clerkId ${u.clerkId}  ${u.email}  created ${u.createdAt?.toISOString?.() ?? "?"}`);
    }
  }
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
