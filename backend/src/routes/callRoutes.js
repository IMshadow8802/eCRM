const express = require("express");
const callController = require("../controllers/callController");
const { verifyToken } = require("../middleware/auth");
const { loadScope } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();

router.use(verifyToken, loadScope);

router.post("/logCall", requirePayload, callController.logCall);
router.post("/fetchCalls", allowEmptyPayload, callController.fetchCalls);

module.exports = router;
