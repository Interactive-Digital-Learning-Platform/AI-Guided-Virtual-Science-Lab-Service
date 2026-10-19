require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const connectDB = require("./config/db");
const errorHandler = require("./middleware/errorHandler");

// Import routes
const authRoutes = require("./routes/auth.routes");
const experimentRoutes = require("./routes/experiment.routes");
const sessionRoutes = require("./routes/session.routes");
const feedbackRoutes = require("./routes/feedback.routes");
const analyticsRoutes = require("./routes/analytics.routes");
const chemicalRoutes = require("./routes/chemical.routes");
const mediaRoutes = require("./routes/media.routes");
const labRoutes = require("./routes/lab.routes");
const biologyRoutes = require("./routes/biology.routes");

const app = express();
const PORT = process.env.PORT || 5000;

// Requests arrive through reverse proxies that append to X-Forwarded-For. Trusting exactly that
// many hops lets express-rate-limit key on the real client IP instead of a proxy's. Locally it's
// just the nginx API gateway (1); on Azure Container Apps the platform ingress adds hops, so set
// TRUST_PROXY per deployment — a hop count ("2") or Express's address form ("uniquelocal").
const trustProxy = process.env.TRUST_PROXY || "1";
app.set("trust proxy", /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);

// Connect to MongoDB
connectDB();

// Register Models
require("./models");

// Security middleware
app.use(helmet());

// CORS
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS?.split(",") || "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "bypass-tunnel-reminder"],
  })
);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: { success: false, message: "Too many requests, please try again later." },
});
app.use("/api/", limiter);

// Body parsing
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Logging
if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

// Health check
app.get("/health", (req, res) => {
  res.json({ success: true, message: "AI Science Lab API is running", timestamp: new Date() });
});

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/experiments", experimentRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/feedback", feedbackRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/chemicals", chemicalRoutes);
app.use("/api/media", mediaRoutes);
app.use("/api/lab", labRoutes);
app.use("/api/biology", biologyRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` });
});

// Global error handler
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
});

module.exports = app;
