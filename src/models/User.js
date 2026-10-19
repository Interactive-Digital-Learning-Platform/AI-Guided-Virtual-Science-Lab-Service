const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    clerkId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    grade: { type: Number, required: true, min: 6, max: 11 },
    school: { type: String, trim: true, default: "" },
    role: { type: String, enum: ["student", "teacher", "admin"], default: "student" },
    learningProfile: {
      weakConcepts: [{ type: mongoose.Schema.Types.ObjectId, ref: "Concept" }],
      strongConcepts: [{ type: mongoose.Schema.Types.ObjectId, ref: "Concept" }],
      totalExperiments: { type: Number, default: 0 },
      totalSessions: { type: Number, default: 0 },
      averageScore: { type: Number, default: 0 },
      averageSessionTime: { type: Number, default: 0 },
      streakDays: { type: Number, default: 0 },
      lastActiveDate: { type: Date },
    },
    preferredSubjects: [{ type: String, enum: ["Physics", "Chemistry", "Biology"] }],
    // Lightweight per-user cost guard on AI visualization generation (POST /api/biology/generate)
    // — there's no other rate limiting on Groq calls anywhere in this backend. Stored as a plain
    // "YYYY-MM-DD" string rather than a Date so "is it still today" is a simple string compare,
    // no timezone-aware date-math needed.
    dailyGenerationCount: { type: Number, default: 0 },
    dailyGenerationDate: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
