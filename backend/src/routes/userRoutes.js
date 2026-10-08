const express = require("express");
const userController = require("../controllers/userController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, requireModule, open, saveAction, requireAdmin } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();

router.use(verifyToken, loadScope);

// Governed by the people module (saveUser) and IsAdmin (handover/delete).
// Self-service and pick-list routes are open (they act on the caller / scope themselves).
router.post("/saveUser", requirePayload, requireModule("people", saveAction), userController.save);
router.post("/fetchUserHandover", requirePayload, requireAdmin, userController.handover);
router.post("/fetchUsers", allowEmptyPayload, open(), userController.fetch);
router.post("/deleteUser", requirePayload, requireAdmin, userController.delete);

// Self-service — operate on the caller only (req.user.UserId).
router.post("/me/updateProfile", requirePayload, open(), userController.updateMyProfile);
router.post("/me/changePassword", requirePayload, open(), userController.changeMyPassword);
// Company roster for client-side avatar lookup in feeds.
router.post("/directory", allowEmptyPayload, open(), userController.directory);

// Transfer pick-lists — any authenticated user; the roster SP scopes itself.
router.post("/fetchAssignableUsers", allowEmptyPayload, open(), userController.assignableUsers);
router.post("/fetchBranches", allowEmptyPayload, open(), userController.branches);

module.exports = router;
