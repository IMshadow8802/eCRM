// src/routes/partnerRoutes.js
const express = require("express");
const c = require("../controllers/partnerController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, requireModule, saveAction, open } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();
router.use(verifyToken, loadScope);

// Open guard: the handler allows leads view (dropdown, names only) or partners view (page).
router.post("/fetchPartners", allowEmptyPayload, open(), c.fetchPartners);
router.post("/savePartner", requirePayload, requireModule("partners", saveAction), c.savePartner);
router.post("/fetchCommissions", allowEmptyPayload, requireModule("partners", "view"), c.fetchCommissions);
router.post("/setCommissionStatus", requirePayload, requireModule("partners", "edit"), c.setCommissionStatus);

module.exports = router;
