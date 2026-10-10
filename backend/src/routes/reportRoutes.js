const express = require("express");
const reportController = require("../controllers/reportController");
const attendanceReport = require("../controllers/attendanceReport");
const { verifyToken } = require("../middleware/auth");
const { loadScope, requireModule, open } = require("../middleware/permission");
const { allowEmptyPayload, requirePayload } = require("../middleware/payloadValidation");

const router = express.Router();

// Governed by the dashboard, support_reports and sales_reports modules (view).
router.use(verifyToken, loadScope);

router.post("/getDashboard", allowEmptyPayload, requireModule("dashboard", "view"), reportController.getDashboard);
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
router.post("/ticketsByCategory", allowEmptyPayload, requireModule("support_reports", "view"), reportController.ticketsByCategory);
router.post("/resolutionSummary", allowEmptyPayload, requireModule("support_reports", "view"), reportController.resolutionSummary);

// Spec 4a — the report system.
router.post("/funnel", allowEmptyPayload, requireModule("sales_reports", "view"), reportController.funnel);
router.post("/followUpCompliance", allowEmptyPayload, requireModule("sales_reports", "view"), reportController.followUpCompliance);
router.post("/activity", allowEmptyPayload, requireModule("sales_reports", "view"), reportController.activity);
router.post("/lost", allowEmptyPayload, requireModule("sales_reports", "view"), reportController.lost);
router.post("/aging", allowEmptyPayload, requireModule("sales_reports", "view"), reportController.aging);
router.post("/transfers", allowEmptyPayload, requireModule("sales_reports", "view"), reportController.transfers);
router.post("/pipelineValue", allowEmptyPayload, requireModule("sales_reports", "view"), reportController.pipelineValue);
router.post("/leaderboard", allowEmptyPayload, requireModule("sales_reports", "view"), reportController.leaderboard);
router.post("/partners", allowEmptyPayload, requireModule("sales_reports", "view"), reportController.partners);

// P4 Team Reports — open to every signed-in user; the data is scoped per caller
// (self + ReportsTo subtree + attendance reach), out-of-reach rows are dropped.
router.post("/tat", allowEmptyPayload, open(), reportController.tat);
router.post("/attendance", allowEmptyPayload, open(), attendanceReport.attendance);

module.exports = router;
