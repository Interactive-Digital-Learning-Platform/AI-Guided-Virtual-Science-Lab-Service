const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { verifyClerkToken } = require("../middleware/clerkAuth");
const clerk = require("../services/clerkService");

const generateToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || "7d" });

const EMAIL_TAKEN = { status: 409, message: "This email is already linked to another account." };
const CLERK_UNAVAILABLE = { status: 503, message: "Could not verify your account right now. Please try again." };
// Each lost race (another sync for the same person wrote first) restarts the lookup; one restart
// always settles it, the extra one is headroom.
const MAX_SYNC_ATTEMPTS = 3;

const normalizeEmail = (email) => (typeof email === "string" ? email.trim().toLowerCase() : "");
const isDuplicateKey = (error) => error?.code === 11000;

// Applies the profile fields the app sends on every sync to an existing record.
async function applyProfile(user, { name, email, grade, school }) {
  user.name = name;
  // The body email is only a profile update; never move it onto an address another record holds.
  const newEmail = normalizeEmail(email);
  if (newEmail && newEmail !== user.email && !(await User.exists({ email: newEmail, _id: { $ne: user._id } }))) {
    user.email = newEmail;
  }
  if (grade) user.grade = grade;
  else if (!user.grade) user.grade = 8;
  if (school) user.school = school;
  if (!["student", "teacher", "admin"].includes(user.role)) user.role = "student";
  await user.save();
  return user;
}

// The signing-in user's verified primary email according to Clerk itself — the body email is
// typed by the client and proves nothing. `unavailable` means Clerk could not be asked, which is
// different from Clerk answering "not verified".
async function verifiedEmailFor(clerkId) {
  if (!clerk.isConfigured()) return { email: null, unavailable: false };
  try {
    return { email: clerk.verifiedPrimaryEmail(await clerk.getClerkUser(clerkId)), unavailable: false };
  } catch (error) {
    console.warn("[AUTH] Clerk user lookup failed:", error.message);
    return { email: null, unavailable: true };
  }
}

// Find-or-link: resolves to { user } or to a refusal { status, message }.
//   1. a record with this clerkId            -> refresh its profile
//   2. no record with this email             -> create one
//   3. a record with this email, other clerkId -> re-link it to this clerkId (keeping all its data),
//      only if Clerk has verified this email for this user AND the record's old Clerk user no longer
//      exists in this instance (deleted / recreated, or created under another instance). If the old
//      Clerk user still exists the record's email is stale and belongs to someone else's account.
// Safe when the app fires two syncs at once: every write is one atomic operation guarded by the
// unique indexes on clerkId/email, and losing a race just means re-reading what the winner wrote.
async function findOrLinkUser(clerkId, profile) {
  let verified; // asked of Clerk at most once, and only when there's no record for this clerkId
  for (let attempt = 0; attempt < MAX_SYNC_ATTEMPTS; attempt++) {
    const user = await User.findOne({ clerkId });
    if (user) return { user: await applyProfile(user, profile) };

    if (!verified) verified = await verifiedEmailFor(clerkId);
    const email = verified.email || normalizeEmail(profile.email);
    if (!email) return { status: 400, message: "name and email are required." };

    const owner = await User.findOne({ email });
    if (!owner) {
      try {
        const created = await User.create({
          clerkId,
          name: profile.name,
          email,
          grade: profile.grade || 8,
          school: profile.school || "",
        });
        return { user: created };
      } catch (error) {
        if (isDuplicateKey(error)) continue;
        throw error;
      }
    }

    if (!verified.email) return verified.unavailable ? CLERK_UNAVAILABLE : EMAIL_TAKEN;

    let previousClerkUser;
    try {
      previousClerkUser = await clerk.getClerkUser(owner.clerkId);
    } catch (error) {
      console.warn("[AUTH] Clerk user lookup failed:", error.message);
      return CLERK_UNAVAILABLE;
    }
    if (previousClerkUser) {
      console.warn(`[AUTH] Not re-linking user ${owner._id}: its Clerk user ${owner.clerkId} still exists (requested by ${clerkId})`);
      return EMAIL_TAKEN;
    }

    let relinked;
    try {
      // Conditional on the old clerkId, so two concurrent re-links can't both win.
      relinked = await User.findOneAndUpdate(
        { _id: owner._id, clerkId: owner.clerkId },
        { $set: { clerkId } },
        { new: true }
      );
    } catch (error) {
      if (isDuplicateKey(error)) continue;
      throw error;
    }
    if (!relinked) continue;
    console.info(`[AUTH] Re-linked user ${owner._id}: clerkId ${owner.clerkId} -> ${clerkId}`);
    return { user: await applyProfile(relinked, profile) };
  }
  throw new Error("User sync did not settle after repeated concurrent updates.");
}

// POST /api/auth/sync
// Called by mobile app after Clerk sign-in to sync user to MongoDB & get backend JWT.
// Requires the Clerk session token as the Bearer token; the clerkId is taken from it, not the body.
const syncUser = async (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, message: "Access denied. No Clerk session token provided." });
    }
    let clerkId;
    try {
      clerkId = (await verifyClerkToken(header.slice(7))).sub;
    } catch (error) {
      console.warn("[AUTH] Clerk token rejected:", error.message);
      return res.status(401).json({ success: false, message: "Clerk session could not be verified. Please sign in again." });
    }

    const { name, email, grade, school } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: "name and email are required." });
    }
    // body.clerkId is ignored; only the verified token decides whose record this is.
    if (req.body.clerkId && req.body.clerkId !== clerkId) {
      console.warn(`[AUTH] Ignoring body clerkId ${req.body.clerkId}; token is for ${clerkId}`);
    }

    const result = await findOrLinkUser(clerkId, { name, email, grade, school });
    if (result.status) {
      return res.status(result.status).json({ success: false, message: result.message });
    }
    const { user } = result;

    const token = generateToken(user._id);

    res.status(200).json({
      success: true,
      message: user ? "User synced successfully." : "User created successfully.",
      data: {
        token,
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          grade: user.grade,
          school: user.school,
          role: user.role,
          learningProfile: user.learningProfile,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/auth/me
const getMe = async (req, res) => {
  res.status(200).json({ success: true, data: req.user });
};

// PATCH /api/auth/grade
// Update student's grade
const updateGrade = async (req, res, next) => {
  try {
    const { grade } = req.body;
    if (!grade || grade < 6 || grade > 11) {
      return res.status(400).json({ success: false, message: "Grade must be between 6 and 11." });
    }
    req.user.grade = grade;
    await req.user.save();
    res.status(200).json({ success: true, message: "Grade updated.", data: { grade: req.user.grade } });
  } catch (error) {
    next(error);
  }
};

module.exports = { syncUser, getMe, updateGrade };
