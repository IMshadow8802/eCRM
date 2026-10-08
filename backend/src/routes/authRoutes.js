// src/routes/authRoutes.js
const express = require("express");
const authController = require("../controllers/authController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, open } = require("../middleware/permission");

const router = express.Router();

// Login rate limiting removed deliberately. The previous guard was keyed on IP
// (10 attempts / 15 min), so a whole office behind one NAT address shared a
// single bucket — one person mistyping their password locked everyone out. It
// also counted its own 429 responses toward the quota, so the retries it
// provoked re-exhausted each fresh window the moment it opened: an effectively
// permanent lockout rather than a 15-minute one.
//
// If brute-force protection is wanted again, key it on the submitted identifier
// (the account under attack) rather than the IP, and set skipSuccessfulRequests
// so a legitimate login clears the counter.

// Public routes
router.post("/loginUser", open(), authController.login);
// Logout ends the server-side session, so it needs to know which one.
router.post("/logoutUser", verifyToken, loadScope, open(), authController.logout);
// Signed-in caller's modules, reach and flags (controller: Task 6).
router.post("/fetchMyAccess", verifyToken, loadScope, open(), authController.fetchMyAccess);

module.exports = router;
