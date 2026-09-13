const express = require("express");
const reportController = require("../controllers/reportController");
const { verifyToken } = require("../middleware/auth");
const { loadScope } = require("../middleware/permission");
const { allowEmptyPayload, requirePayload } = require("../middleware/payloadValidation");

const router = express.Router();

router.use(verifyToken, loadScope);

router.post("/getDashboard", allowEmptyPayload, reportController.getDashboard);
// /getFollowupsUserWise and /getLeadSummaryBranchWise went on 2026-08-04, and
// /getConvertedSummary, /leadsByStatus, /callsPerUser and /conversionBySource
// followed on 2026-09-13. The last three scoped by BRANCH only — no owner axis
// — so a Self-scope rep could read the whole branch through them, and
// sp_CallsPerUser handed back every colleague's call volume by name. They were
// meant to survive one release for the /reports/* redirects, but those are
// client-side routes that never reach the API and nothing in web or mobile
// called them. sp_ConvertedSummary also referenced tblLeads.LeadStatus and
// .InvoiceDate, columns that no longer exist, so it threw on every call.
// The spec-4a procs below carry branch AND owner scope.
router.post("/ticketsByCategory", allowEmptyPayload, reportController.ticketsByCategory);
router.post("/resolutionSummary", allowEmptyPayload, reportController.resolutionSummary);

// Spec 4a — the report system.
router.post("/funnel", allowEmptyPayload, reportController.funnel);
router.post("/followUpCompliance", allowEmptyPayload, reportController.followUpCompliance);
router.post("/activity", allowEmptyPayload, reportController.activity);
router.post("/lost", allowEmptyPayload, reportController.lost);
router.post("/aging", allowEmptyPayload, reportController.aging);
router.post("/transfers", allowEmptyPayload, reportController.transfers);
router.post("/pipelineValue", allowEmptyPayload, reportController.pipelineValue);
router.post("/leaderboard", allowEmptyPayload, reportController.leaderboard);

module.exports = router;
