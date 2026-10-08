// src/routes/teamRoutes.js
const express = require("express");
const teamController = require("../controllers/teamController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, requireModule, open, saveAction } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();

router.use(verifyToken, loadScope);

// Writes need the teams module; reads stay open because task forms list teams for
// everyone (spec 2026-10-07 §3).
router.post("/saveTeam", requirePayload, requireModule("teams", saveAction), teamController.save);
router.post("/fetchTeams", allowEmptyPayload, open(), teamController.fetch);
router.post("/deleteTeam", requirePayload, requireModule("teams", "delete"), teamController.delete);

module.exports = router;
