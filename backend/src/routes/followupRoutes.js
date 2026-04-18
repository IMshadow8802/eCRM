const express = require("express");
const followupController = require("../controllers/followupController");
const { verifyToken } = require("../middleware/auth");
const { loadScope } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();

router.use(verifyToken, loadScope);

router.post("/saveFollowup", requirePayload, followupController.save);
router.post("/fetchFollowups", allowEmptyPayload, followupController.fetch);
router.post("/deleteFollowup", requirePayload, followupController.delete);

module.exports = router;
