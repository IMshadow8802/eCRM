const express = require("express");
const followupController = require("../controllers/followupController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, requireModule } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();

// Governed by the leads module: view to read, edit to schedule/complete/skip/delete.
router.use(verifyToken, loadScope);

// A follow-up is an activity now (071): it is scheduled, then completed or
// skipped. There is no "save" — sp_SaveFollowUp is dropped.
router.post("/scheduleFollowUp", requirePayload, requireModule("leads", "edit"), followupController.schedule);
router.post("/completeFollowUp", requirePayload, requireModule("leads", "edit"), followupController.complete);
router.post("/skipFollowUp", requirePayload, requireModule("leads", "edit"), followupController.skip);
// Empty body = the whole queue for the caller's scope.
router.post("/fetchFollowups", allowEmptyPayload, requireModule("leads", "view"), followupController.fetch);
router.post("/deleteFollowup", requirePayload, requireModule("leads", "edit"), followupController.delete);

module.exports = router;
