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
router.post("/leadsByStatus", allowEmptyPayload, reportController.leadsByStatus);
router.post("/callsPerUser", allowEmptyPayload, reportController.callsPerUser);
router.post("/conversionBySource", allowEmptyPayload, reportController.conversionBySource);
router.post("/ticketsByCategory", allowEmptyPayload, reportController.ticketsByCategory);
router.post("/resolutionSummary", allowEmptyPayload, reportController.resolutionSummary);

// Spec 4a — the report system. Old lead reports above stay one release for
// the web redirects, then go.
router.post("/funnel", allowEmptyPayload, reportController.funnel);
router.post("/followUpCompliance", allowEmptyPayload, reportController.followUpCompliance);
router.post("/activity", allowEmptyPayload, reportController.activity);
router.post("/lost", allowEmptyPayload, reportController.lost);
router.post("/aging", allowEmptyPayload, reportController.aging);
router.post("/transfers", allowEmptyPayload, reportController.transfers);
router.post("/pipelineValue", allowEmptyPayload, reportController.pipelineValue);
router.post("/leaderboard", allowEmptyPayload, reportController.leaderboard);

module.exports = router;
