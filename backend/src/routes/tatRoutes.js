const express = require("express");
const c = require("../controllers/tatController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, requireModule, open } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();

router.use(verifyToken, loadScope);

router.post("/fetchTatPolicy", allowEmptyPayload, open(), c.fetchTatPolicy);
router.post("/saveTatPolicy", requirePayload, requireModule("settings", "edit"), c.saveTatPolicy);
// Task-bound: each controller also needs view_task on the TaskId (404).
router.post("/fetchTaskTat", requirePayload, requireModule("tasks", "view"), c.fetchTaskTat);
router.post("/acknowledge", requirePayload, requireModule("tasks", "view"), c.acknowledge);
router.post("/hold", requirePayload, requireModule("tasks", "view"), c.hold);
router.post("/release", requirePayload, requireModule("tasks", "view"), c.release);
router.post("/myPartDone", requirePayload, requireModule("tasks", "view"), c.myPartDone);
router.post("/saveReason", requirePayload, requireModule("tasks", "view"), c.saveReason);
router.post("/saveVerdict", requirePayload, requireModule("tasks", "view"), c.saveVerdict);
// Today: the caller's own day, and the people their attendance reach covers.
router.post("/fetchToday", allowEmptyPayload, open(), c.fetchToday);
router.post("/fetchTeamToday", allowEmptyPayload, open(), c.fetchTeamToday);

module.exports = router;
