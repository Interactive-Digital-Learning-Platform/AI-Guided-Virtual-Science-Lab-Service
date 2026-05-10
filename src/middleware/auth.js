const jwt = require("jsonwebtoken");
const User = require("../models/User");

const protect = async (req, res, next) => {
  try {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
      token = req.headers.authorization.split(" ")[1];
    }

    // Bypass authentication for development/testing
    if (token === "bypass-token-123") {
      console.log("[AUTH] Bypass token detected");
      let user = await User.findOne({ email: "testuser@example.com" });
      if (!user) {
        console.log("[AUTH] Creating mock user");
        user = await User.create({
          clerkId: "mock_clerk_id_123",
          name: "Test User",
          email: "testuser@example.com",
          grade: 8,
          school: "Mock Science School",
          role: "student",
        });
      }
      console.log("[AUTH] Authenticated as:", user.email);
      req.user = user;
      return next();
    }

    if (!token) {
      return res.status(401).json({ success: false, message: "Access denied. No token provided." });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("-__v");

    if (!user) {
      return res.status(401).json({ success: false, message: "User not found. Token invalid." });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ success: false, message: "Token expired. Please login again." });
    }
    return res.status(401).json({ success: false, message: "Invalid token." });
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Role '${req.user.role}' is not authorized to access this route.`,
      });
    }
    next();
  };
};

module.exports = { protect, authorize };
