// src/routes/authRoutes.js
const express = require("express");
const { rateLimit } = require("express-rate-limit");
const authController = require("../controllers/authController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, open } = require("../middleware/permission");

const router = express.Router();

// Brute-force guard (audit 2026-10-12). Only FAILED sign-ins count
// (skipSuccessfulRequests), so a person who signs in is never slowed down.
// Keyed on the ACCOUNT, not the IP: the earlier IP-keyed limiter put a whole
// office behind one NAT address in one bucket, and one typo locked everyone out.
// The IP limit is a loose second net for password spraying (one password
// across many accounts), set far above what an office's typos can reach.
// ponytail: in-memory store, one per process; a Redis store when the API runs
// as more than one process.
const WINDOW_MS = 15 * 60 * 1000;
const tooMany = (req, res) => res.status(429).json({
  success: false,
  message: "Too many failed sign-ins. Try again in 15 minutes.",
  code: "TOO_MANY_ATTEMPTS",
  responseCode: 429,
  timestamp: new Date().toISOString(),
});
const accountKey = (req) =>
  String(req.body?.identifier ?? req.body?.username ?? "").trim().toLowerCase();
const failedLogins = (options) => rateLimit({
  windowMs: WINDOW_MS,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: tooMany,
  ...options,
});
const perAccount = failedLogins({ limit: 10, keyGenerator: accountKey });
const perAddress = failedLogins({ limit: 100 });

// Public routes
router.post("/loginUser", open(), perAddress, perAccount, authController.login);
// Logout ends the server-side session, so it needs to know which one.
router.post("/logoutUser", verifyToken, loadScope, open(), authController.logout);
// Signed-in caller's modules, reach and flags (controller: Task 6).
router.post("/fetchMyAccess", verifyToken, loadScope, open(), authController.fetchMyAccess);

module.exports = router;
