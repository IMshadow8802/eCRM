// src/routes/teamRoutes.js
const express = require("express");
const teamController = require("../controllers/teamController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, requireMenuRight } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();

router.use(verifyToken, loadScope);

// Writes need the /teams menu grant (Owner, Admin, HR Manager); reads stay
// open because task forms list teams for everyone. Audit 2026-10-07 S2.
router.post("/saveTeam", requirePayload, requireMenuRight("/teams", "save"), teamController.save);
router.post("/fetchTeams", allowEmptyPayload, teamController.fetch);
router.post("/deleteTeam", requirePayload, requireMenuRight("/teams", "delete"), teamController.delete);

module.exports = router;
