const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { verifyClerkToken } = require("../middleware/clerkAuth");

const generateToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || "7d" });

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

    if (!email || !name) {
      return res.status(400).json({ success: false, message: "name and email are required." });
    }

    let user = await User.findOne({ clerkId });

    // The email in the body is unverified, so it must never re-link a record owned by another
    // Clerk user (that would hand over their account).
    if (!user && (await User.exists({ email: email.toLowerCase() }))) {
      return res.status(409).json({ success: false, message: "This email is already linked to another account." });
    }

    if (user) {
      // Update fields if changed
      user.clerkId = clerkId;
      user.name = name;
      user.email = email;
      if (grade) user.grade = grade;
      else if (!user.grade) user.grade = 8;
      if (school) user.school = school;
      if (!["student", "teacher", "admin"].includes(user.role)) user.role = "student";
      await user.save();
    } else {
      // Create new user
      user = await User.create({
        clerkId,
        name,
        email,
        grade: grade || 8,
        school: school || "",
      });
    }

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
