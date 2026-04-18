// src/routes/teamRoutes.js
const express = require("express");
const teamController = require("../controllers/teamController");
const { verifyToken } = require("../middleware/auth");
const { loadScope } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();

router.use(verifyToken, loadScope);

router.post("/saveTeam", requirePayload, teamController.save);
router.post("/fetchTeams", allowEmptyPayload, teamController.fetch);
router.post("/deleteTeam", requirePayload, teamController.delete);

module.exports = router;
