// src/routes/notificationRoutes.js
const express = require("express");
const notificationController = require("../controllers/notificationController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, open } = require("../middleware/permission");

const router = express.Router();

// Open: every user reads their own notifications.
router.use(verifyToken, loadScope);

router.post("/fetchNotifications", open(), notificationController.fetch);
router.post("/markNotificationRead", open(), notificationController.markRead);
router.post("/markAllNotificationsRead", open(), notificationController.markAllRead);

module.exports = router;
