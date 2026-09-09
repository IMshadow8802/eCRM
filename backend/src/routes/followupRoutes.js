const express = require("express");
const followupController = require("../controllers/followupController");
const { verifyToken } = require("../middleware/auth");
const { loadScope } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();

router.use(verifyToken, loadScope);

// A follow-up is an activity now (071): it is scheduled, then completed or
// skipped. There is no "save" — sp_SaveFollowUp is dropped.
router.post("/scheduleFollowUp", requirePayload, followupController.schedule);
router.post("/completeFollowUp", requirePayload, followupController.complete);
router.post("/skipFollowUp", requirePayload, followupController.skip);
// Empty body = the whole queue for the caller's scope.
router.post("/fetchFollowups", allowEmptyPayload, followupController.fetch);
router.post("/deleteFollowup", requirePayload, followupController.delete);

module.exports = router;
