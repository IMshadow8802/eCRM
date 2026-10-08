const express = require("express");
const callController = require("../controllers/callController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, open } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();

// Open: each call's parent lead goes through assertRecordAccess (logCall needs write).
router.use(verifyToken, loadScope);

router.post("/logCall", requirePayload, open(), callController.logCall);
router.post("/fetchCalls", allowEmptyPayload, open(), callController.fetchCalls);

module.exports = router;
