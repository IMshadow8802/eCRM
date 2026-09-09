const express = require("express");
const userController = require("../controllers/userController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, requireAdmin } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();

router.use(verifyToken, loadScope);

// Creating/editing a user can set IsAdmin, so these are admin-only. Without the
// guard any authenticated employee could POST { Id: 0, IsAdmin: true } and mint
// themselves an owner-level account.
router.post("/saveUser", requireAdmin, requirePayload, userController.save);
router.post("/fetchUsers", allowEmptyPayload, userController.fetch);
router.post("/deleteUser", requireAdmin, requirePayload, userController.delete);

// Self-service — operate on the caller only (req.user.UserId).
router.post("/me/updateProfile", requirePayload, userController.updateMyProfile);
router.post("/me/changePassword", requirePayload, userController.changeMyPassword);
// Company roster for client-side avatar lookup in feeds.
router.post("/directory", allowEmptyPayload, userController.directory);

// Transfer pick-lists — any authenticated user; the roster SP scopes itself.
router.post("/fetchAssignableUsers", allowEmptyPayload, userController.assignableUsers);
router.post("/fetchBranches", allowEmptyPayload, userController.branches);

module.exports = router;
