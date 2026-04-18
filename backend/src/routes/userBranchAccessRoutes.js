const express = require("express");
const userBranchAccessController = require("../controllers/userBranchAccessController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, requireMinLevel, HIERARCHY } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();

router.use(verifyToken, loadScope);

// Self-service: anyone can read their own scope
router.post("/myScope", allowEmptyPayload, userBranchAccessController.myScope);

// Admin-only: assign branches to other users
router.post("/saveUserBranchAccess", requirePayload, requireMinLevel(HIERARCHY.ADMIN), userBranchAccessController.save);
router.post("/fetchUserBranchAccess", requirePayload, requireMinLevel(HIERARCHY.MANAGER), userBranchAccessController.fetch);
router.post("/deleteUserBranchAccess", requirePayload, requireMinLevel(HIERARCHY.ADMIN), userBranchAccessController.delete);

module.exports = router;
