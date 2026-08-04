const express = require("express");
const reportController = require("../controllers/reportController");
const { verifyToken } = require("../middleware/auth");
const { loadScope } = require("../middleware/permission");
const { allowEmptyPayload, requirePayload } = require("../middleware/payloadValidation");

const router = express.Router();

router.use(verifyToken, loadScope);

router.post("/getDashboard", allowEmptyPayload, reportController.getDashboard);
router.post("/getConvertedSummary", allowEmptyPayload, reportController.getConvertedSummary);
// /getFollowupsUserWise and /getLeadSummaryBranchWise were removed on
// 2026-08-04. Their SPs referenced tblLeads.AssignTo / .FollowupDate /
// .LeadDate / .LeadStatus — columns dropped when leads moved to the config
// engine — so both threw on every call and had done for months. Nothing in web
// or mobile called either. See backend/sql/069_tenancy_guards.sql.
router.post("/pipelineFunnel", allowEmptyPayload, reportController.pipelineFunnel);
router.post("/callsPerUser", allowEmptyPayload, reportController.callsPerUser);
router.post("/conversionBySource", allowEmptyPayload, reportController.conversionBySource);
router.post("/ticketsByCategory", allowEmptyPayload, reportController.ticketsByCategory);
router.post("/resolutionSummary", allowEmptyPayload, reportController.resolutionSummary);

module.exports = router;
