const express = require("express");
const userBranchAccessController = require("../controllers/userBranchAccessController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, requireAdmin, requireMinLevel, HIERARCHY } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();

router.use(verifyToken, loadScope);

// Self-service: anyone can read their own scope
router.post("/myScope", allowEmptyPayload, userBranchAccessController.myScope);

// Admin-only: assign branches to other users
// requireAdmin (IsAdmin on the group), not requireMinLevel(ADMIN) — that is
// HierarchyLevel <= 2, which admits the level-2 department heads. Branch
// access is what sp_FetchAccessibleBranchIds turns into req.scope.branchIds,
// so a non-admin head could have widened a user's data scope — or their own.
// CLAUDE.md §3: IsAdmin is a role property, never derived from a level.
router.post("/saveUserBranchAccess", requirePayload, requireAdmin, userBranchAccessController.save);
router.post("/fetchUserBranchAccess", requirePayload, requireMinLevel(HIERARCHY.MANAGER), userBranchAccessController.fetch);
router.post("/deleteUserBranchAccess", requirePayload, requireAdmin, userBranchAccessController.delete);

module.exports = router;
