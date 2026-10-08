// src/routes/workspaceRoutes.js
const express = require("express");
const workspaceController = require("../controllers/workspaceController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, requireModule } = require("../middleware/permission");

const router = express.Router();

// Governed by the tasks module (view); workspace membership decides the rest.
router.use(verifyToken, loadScope);

router.post("/saveWorkspace", requireModule("tasks", "view"), workspaceController.save);
router.post("/fetchWorkspaces", requireModule("tasks", "view"), workspaceController.fetch);
router.post("/fetchWorkspaceMembers", requireModule("tasks", "view"), workspaceController.fetchMembers);
router.post("/addWorkspaceMember", requireModule("tasks", "view"), workspaceController.addMember);
// Role changes have their own proc — reusing addWorkspaceMember would re-invite
// the member and lock them out until they re-accepted (065).
router.post("/setWorkspaceMemberRole", requireModule("tasks", "view"), workspaceController.setMemberRole);
router.post("/removeWorkspaceMember", requireModule("tasks", "view"), workspaceController.removeMember);
router.post("/archiveWorkspace", requireModule("tasks", "view"), workspaceController.archive);
router.post("/convertWorkspaceToShared", requireModule("tasks", "view"), workspaceController.convertToShared);
router.post("/deleteWorkspace", requireModule("tasks", "view"), workspaceController.delete);
router.post("/transferWorkspaceOwnership", requireModule("tasks", "view"), workspaceController.transferOwnership);
router.post("/syncProjectWorkspaceMembers", requireModule("tasks", "view"), workspaceController.syncProjectMembers);
router.post("/ensurePersonalWorkspace", requireModule("tasks", "view"), workspaceController.ensurePersonal);
router.post("/applyKanbanTemplate", requireModule("tasks", "view"), workspaceController.applyTemplate);
router.post("/respondInvite", requireModule("tasks", "view"), workspaceController.respondInvite);

module.exports = router;
