// src/routes/notificationRoutes.js
const express = require("express");
const notificationController = require("../controllers/notificationController");
const { verifyToken } = require("../middleware/auth");
const { loadScope } = require("../middleware/permission");

const router = express.Router();

router.use(verifyToken, loadScope);

router.post("/fetchNotifications", notificationController.fetch);
router.post("/markNotificationRead", notificationController.markRead);
router.post("/markAllNotificationsRead", notificationController.markAllRead);

module.exports = router;
