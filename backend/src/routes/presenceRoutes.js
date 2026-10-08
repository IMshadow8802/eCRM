const express = require("express");
const c = require("../controllers/presenceController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, open, requireAdmin } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();

router.use(verifyToken, loadScope);

router.post("/heartbeat", allowEmptyPayload, open(), c.heartbeat);
router.post("/ackNotice", allowEmptyPayload, open(), c.ackNotice);
// Rows are narrowed to the people the caller may see (visibleUserIds).
router.post("/fetchPresence", allowEmptyPayload, open(), c.fetchPresence);
router.post("/fetchSessions", requirePayload, requireAdmin, c.fetchSessions);
router.post("/endSession", requirePayload, requireAdmin, c.endSession);

module.exports = router;
