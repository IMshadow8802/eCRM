const express = require("express");
const leadController = require("../controllers/leadController");
const { verifyToken } = require("../middleware/auth");
const { loadScope } = require("../middleware/permission");
const { requirePayload, allowEmptyPayload } = require("../middleware/payloadValidation");

const router = express.Router();

// All routes require authentication; loadScope populates req.scope
// (hierarchyLevel + dataScope + branchIds + canWriteBranchIds) so
// fetch SPs can filter and write actions can be authorised.
router.use(verifyToken, loadScope);

router.post("/saveLeads", requirePayload, leadController.save);
router.post("/fetchLeads", allowEmptyPayload, leadController.fetch);
router.post("/fetchLeadDetail", requirePayload, leadController.detail);
router.post("/setLeadStatus", requirePayload, leadController.setStatus);
router.post("/convertLead", requirePayload, leadController.convert);
router.post("/transferLead", requirePayload, leadController.transfer);
router.post("/bulkTransferLeads", requirePayload, leadController.bulkTransfer);
router.post("/deleteLeads", requirePayload, leadController.delete);

module.exports = router;
