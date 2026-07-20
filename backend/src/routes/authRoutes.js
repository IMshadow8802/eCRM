// src/routes/authRoutes.js
const express = require("express");
const rateLimit = require("express-rate-limit");
const authController = require("../controllers/authController");
const responseHelper = require("../utils/responseHelper");

const router = express.Router();

// Brute-force guard on login only: 10 attempts / 15 min / IP.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) =>
    responseHelper.error(
      res,
      "Too many login attempts. Try again in 15 minutes.",
      "RATE_LIMITED",
      429,
    ),
});

// Public routes
router.post("/loginUser", loginLimiter, authController.login);
router.post("/logoutUser", authController.logout);

module.exports = router;
