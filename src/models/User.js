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
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
