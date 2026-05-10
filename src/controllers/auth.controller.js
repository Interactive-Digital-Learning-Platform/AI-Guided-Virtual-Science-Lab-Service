const jwt = require("jsonwebtoken");
const User = require("../models/User");

const generateToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || "7d" });

// POST /api/auth/sync
// Called by mobile app after Clerk sign-in to sync user to MongoDB & get backend JWT
const syncUser = async (req, res, next) => {
  try {
    const { clerkId, name, email, grade, school } = req.body;

    if (!clerkId || !email || !name) {
      return res.status(400).json({ success: false, message: "clerkId, name, and email are required." });
    }

    let user = await User.findOne({ clerkId });

    if (user) {
      // Update fields if changed
      user.name = name;
      user.email = email;
      if (grade) user.grade = grade;
      if (school) user.school = school;
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
