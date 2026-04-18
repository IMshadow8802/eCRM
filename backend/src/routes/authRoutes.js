// src/routes/authRoutes.js
const express = require("express");
const authController = require("../controllers/authController");
const { verifyToken } = require("../middleware/auth");

const router = express.Router();

// Public routes
router.post("/loginUser", authController.login);
router.post("/logoutUser", authController.logout);

// NEW ENDPOINT: Hash password for database updates
router.post("/hashPassword", authController.hashPassword);

module.exports = router;
