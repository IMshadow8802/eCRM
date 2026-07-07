const express = require("express");
const userGroupController = require("../controllers/userGroupController");
const { verifyToken } = require("../middleware/auth");
const { loadScope } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();

router.use(verifyToken, loadScope);

router.post("/saveUserGroup", requirePayload, userGroupController.save);
router.post("/fetchUserGroups", allowEmptyPayload, userGroupController.fetch);
router.post("/deleteUserGroup", requirePayload, userGroupController.delete);
router.post("/fetchGroupAccess", requirePayload, userGroupController.fetchAccess);
router.post("/saveGroupAccess", requirePayload, userGroupController.saveAccess);

module.exports = router;