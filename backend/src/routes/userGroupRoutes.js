const express = require("express");
const userGroupController = require("../controllers/userGroupController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, open, requireAdmin } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();

router.use(verifyToken, loadScope);

// Governed by IsAdmin (requireAdmin): editing a group's module grants is a
// privilege-escalation path for anyone else. fetchUserGroups stays open: it
// fills the group dropdown on the user form.
router.post("/saveUserGroup", requirePayload, requireAdmin, userGroupController.save);
router.post("/fetchUserGroups", allowEmptyPayload, open(), userGroupController.fetch);
router.post("/deleteUserGroup", requirePayload, requireAdmin, userGroupController.delete);
// Module grants per group (spec 2026-10-07). Admin-only, as the old access matrix was.
router.post("/fetchGroupModules", requirePayload, requireAdmin, userGroupController.fetchModules);
router.post("/saveGroupModules", requirePayload, requireAdmin, userGroupController.saveModules);

module.exports = router;
