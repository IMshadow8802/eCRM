const express = require("express");
const userGroupController = require("../controllers/userGroupController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, requireAdmin } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();

router.use(verifyToken, loadScope);

/**
 * Writes are admin-only. They were not, and `saveGroupAccess` in particular was
 * a straight privilege-escalation path: the controller writes sp_SaveGroupAccess
 * with no check that the caller may administer that group, so any authenticated
 * employee could POST their own GroupId with every CanView/CanAdd/CanEdit/
 * CanDelete set and grant themselves the whole application.
 *
 * requireAdmin reads req.scope.isAdmin, which loadScope refreshes from the
 * database each request — so revoking someone's admin takes effect immediately
 * rather than when their token expires.
 *
 * Reads stay open: fetchUserGroups populates the group dropdown on the user
 * form, which is not itself an admin screen.
 */
router.post("/saveUserGroup", requireAdmin, requirePayload, userGroupController.save);
router.post("/fetchUserGroups", allowEmptyPayload, userGroupController.fetch);
router.post("/deleteUserGroup", requireAdmin, requirePayload, userGroupController.delete);
router.post("/fetchGroupAccess", requirePayload, userGroupController.fetchAccess);
router.post("/saveGroupAccess", requireAdmin, requirePayload, userGroupController.saveAccess);

module.exports = router;