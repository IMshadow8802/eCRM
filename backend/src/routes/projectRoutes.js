// src/routes/projectRoutes.js
const express = require("express");
const projectController = require("../controllers/projectController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, requireMenuRight } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();

router.use(verifyToken, loadScope);

// Writes need the /projects menu grant (Owner, Admin, HR Manager); reads stay
// open because task forms list projects for everyone. Audit 2026-10-07 S2.
router.post("/saveProject", requirePayload, requireMenuRight("/projects", "save"), projectController.save);
router.post("/fetchProjects", allowEmptyPayload, projectController.fetch);
/**
 * deleteProject was never registered, though the controller method and
 * sp_DeleteProject both exist and match. The web Projects page has had a delete
 * button POSTing to this path the whole time, getting a 404 from the SPA's
 * catch-all instead of deleting anything.
 *
 * Found by diffing every endpoint the web calls against the routes the backend
 * actually mounts — no test could have caught it, since both halves were
 * individually fine.
 */
router.post("/deleteProject", requirePayload, requireMenuRight("/projects", "delete"), projectController.delete);

module.exports = router;
