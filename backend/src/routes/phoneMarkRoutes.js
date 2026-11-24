// src/routes/phoneMarkRoutes.js — do-not-call / caution marks (149).
const express = require("express");
const c = require("../controllers/phoneMarkController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, requireModule, requireAdmin } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();
router.use(verifyToken, loadScope);

router.post("/fetch", allowEmptyPayload, requireModule("calling", "edit"), c.fetch);
// List managers only: a dnc closes the number's contacts in every list. Callers mark dnc
// through a call result on a contact they hold (sp_SaveCallResult).
router.post("/set", requirePayload, requireModule("calling", "edit"), c.set);
router.post("/clear", requirePayload, requireAdmin, c.clear);

module.exports = router;
