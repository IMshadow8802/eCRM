const express = require("express");
const userBranchAccessController = require("../controllers/userBranchAccessController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, requireModule, open, requireAdmin } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();

router.use(verifyToken, loadScope);

// Governed by the people module (read) and IsAdmin (writes).
// Self-service: anyone can read their own scope
router.post("/myScope", allowEmptyPayload, open(), userBranchAccessController.myScope);

// Admin-only: assign branches to other users
// requireAdmin (IsAdmin on the group): branch access widens a user's data scope,
// so a non-admin must not be able to grant it — to anyone, or to themselves.
router.post("/saveUserBranchAccess", requirePayload, requireAdmin, userBranchAccessController.save);
router.post("/fetchUserBranchAccess", requirePayload, requireModule("people", "view"), userBranchAccessController.fetch);
router.post("/deleteUserBranchAccess", requirePayload, requireAdmin, userBranchAccessController.delete);

module.exports = router;
