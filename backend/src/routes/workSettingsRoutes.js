const express = require("express");
const c = require("../controllers/workSettingsController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, requireModule, open, saveAction } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();

router.use(verifyToken, loadScope);

router.post("/fetchWorkSettings", allowEmptyPayload, open(), c.fetchWorkSettings);
router.post("/saveCompanySetting", requirePayload, requireModule("settings", "edit"), c.saveCompanySetting);
router.post("/saveWorkCalendar", requirePayload, requireModule("settings", saveAction), c.saveWorkCalendar);
router.post("/deleteWorkCalendar", requirePayload, requireModule("settings", "delete"), c.deleteWorkCalendar);
router.post("/saveHoliday", requirePayload, requireModule("settings", saveAction), c.saveHoliday);
router.post("/deleteHoliday", requirePayload, requireModule("settings", "delete"), c.deleteHoliday);
// The SP enforces the ReportsTo chain / admin rule.
router.post("/saveDayMark", requirePayload, open(), c.saveDayMark);
router.post("/deleteDayMark", requirePayload, open(), c.deleteDayMark);
router.post("/fetchDayMarks", requirePayload, open(), c.fetchDayMarks);

module.exports = router;
