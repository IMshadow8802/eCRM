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
// Older report endpoints were removed (2026-08-04, 2026-09-13; the spec-4a set on
// 2026-11-18, sql/122). Sales reports are /sales + /salesRows below.
router.post("/ticketsByCategory", allowEmptyPayload, requireModule("support_reports", "view"), reportController.ticketsByCategory);
router.post("/resolutionSummary", allowEmptyPayload, requireModule("support_reports", "view"), reportController.resolutionSummary);

// Sales reports rebuild (sql/122): every summary + its drill.
router.post("/sales", allowEmptyPayload, requireModule("sales_reports", "view"), reportController.sales);
router.post("/salesRows", allowEmptyPayload, requireModule("sales_reports", "view"), reportController.salesRows);

// P4 Team Reports — open to every signed-in user; the data is scoped per caller
// (self + ReportsTo subtree + attendance reach), out-of-reach rows are dropped.
router.post("/tat", allowEmptyPayload, open(), reportController.tat);
router.post("/tatClocks", allowEmptyPayload, open(), reportController.tatClocks);
router.post("/attendance", allowEmptyPayload, open(), attendanceReport.attendance);

module.exports = router;
