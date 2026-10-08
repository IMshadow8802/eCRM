const express = require("express");
const leadController = require("../controllers/leadController");
const { verifyToken } = require("../middleware/auth");
const { loadScope, requireModule, saveAction } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();

// Governed by the leads module: view / add+edit (saveAction) / edit / delete per
// route. loadScope fills req.access and req.scope for the fetch SPs.
router.use(verifyToken, loadScope);

router.post("/saveLeads", requirePayload, requireModule("leads", saveAction), leadController.save);
router.post("/fetchLeads", allowEmptyPayload, requireModule("leads", "view"), leadController.fetch);
router.post("/fetchLeadDetail", requirePayload, requireModule("leads", "view"), leadController.detail);
router.post("/setLeadStatus", requirePayload, requireModule("leads", "edit"), leadController.setStatus);
router.post("/convertLead", requirePayload, requireModule("leads", "edit"), leadController.convert);
router.post("/transferLead", requirePayload, requireModule("leads", "edit"), leadController.transfer);
router.post("/bulkTransferLeads", requirePayload, requireModule("leads", "edit"), leadController.bulkTransfer);
router.post("/deleteLeads", requirePayload, requireModule("leads", "delete"), leadController.delete);

module.exports = router;
