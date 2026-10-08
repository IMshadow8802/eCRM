const express = require("express");
const quotationController = require("../controllers/quotationController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, requireModule, saveAction } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();

// Governed by the leads module (a quotation has no permission model of its own);
// each endpoint is also gated on the parent lead through assertRecordAccess. The
// one admin rule (changing a branch's saved letterhead) lives in
// sp_SaveQuoteProfile, fed req.scope.isAdmin.
router.use(verifyToken, loadScope);

router.post("/saveQuotation", requirePayload, requireModule("leads", saveAction), quotationController.save);
router.post("/fetchQuotations", allowEmptyPayload, requireModule("leads", "view"), quotationController.fetch);
router.post("/fetchQuotationDetail", requirePayload, requireModule("leads", "view"), quotationController.detail);
router.post("/finaliseQuotation", requirePayload, requireModule("leads", "edit"), quotationController.finalise);
router.post("/reviseQuotation", requirePayload, requireModule("leads", "edit"), quotationController.revise);
router.post("/rejectQuotation", requirePayload, requireModule("leads", "edit"), quotationController.reject);
router.post("/deleteQuotation", requirePayload, requireModule("leads", "edit"), quotationController.remove);
router.post("/ensureQuoteProfile", requirePayload, requireModule("leads", "view"), quotationController.ensureProfile);
router.post("/saveQuoteProfile", requirePayload, requireModule("leads", "edit"), quotationController.saveProfile);

module.exports = router;
