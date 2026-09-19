const express = require("express");
const quotationController = require("../controllers/quotationController");
const { verifyToken } = require("../middleware/auth");
const { loadScope } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();

// loadScope populates req.scope: the list is filtered by it, and every other
// endpoint is gated on the parent lead through assertRecordAccess. There is no
// requireAdmin here on purpose — a quotation is a salesperson's tool. The one
// admin rule (changing a branch's saved letterhead) is enforced where the
// IsSet flag lives: in sp_SaveQuoteProfile, fed req.scope.isAdmin.
router.use(verifyToken, loadScope);

router.post("/saveQuotation", requirePayload, quotationController.save);
router.post("/fetchQuotations", allowEmptyPayload, quotationController.fetch);
router.post("/fetchQuotationDetail", requirePayload, quotationController.detail);
router.post("/finaliseQuotation", requirePayload, quotationController.finalise);
router.post("/reviseQuotation", requirePayload, quotationController.revise);
router.post("/rejectQuotation", requirePayload, quotationController.reject);
router.post("/deleteQuotation", requirePayload, quotationController.remove);
router.post("/ensureQuoteProfile", requirePayload, quotationController.ensureProfile);
router.post("/saveQuoteProfile", requirePayload, quotationController.saveProfile);

module.exports = router;
