// src/routes/workspaceRoutes.js
const express = require("express");
const workspaceController = require("../controllers/workspaceController");
const { verifyToken } = require("../middleware/auth");
const { loadScope } = require("../middleware/permission");

const router = express.Router();

router.use(verifyToken, loadScope);

router.post("/saveWorkspace", workspaceController.save);
router.post("/fetchWorkspaces", workspaceController.fetch);
router.post("/fetchWorkspaceMembers", workspaceController.fetchMembers);
router.post("/addWorkspaceMember", workspaceController.addMember);
router.post("/removeWorkspaceMember", workspaceController.removeMember);
router.post("/archiveWorkspace", workspaceController.archive);
router.post("/convertWorkspaceToShared", workspaceController.convertToShared);
router.post("/deleteWorkspace", workspaceController.delete);
router.post("/transferWorkspaceOwnership", workspaceController.transferOwnership);
router.post("/syncProjectWorkspaceMembers", workspaceController.syncProjectMembers);
router.post("/ensurePersonalWorkspace", workspaceController.ensurePersonal);
router.post("/applyKanbanTemplate", workspaceController.applyTemplate);
router.post("/respondInvite", workspaceController.respondInvite);

module.exports = router;
