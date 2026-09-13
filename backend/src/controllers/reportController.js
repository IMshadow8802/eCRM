const database = require("../config/database");
const { scopeParams } = require("../middleware/permission");
const { asyncRoute, positiveInt } = require("../utils/controllerKit");
const { runReport, REPORTS } = require("../utils/reportKit");

class ReportController {
  async getDashboard(req, res) {
    try {
      // sp_Dashboard used to get the branch axis only (sql/081 adds @UserId +
      // @OwnerIdsJson), so a Self-scope rep was handed their whole branch:
      // 222 leads where the funnel report showed the correct 133.
      const result = await database.executeStoredProcedure("sp_Dashboard", {
        CompId: req.user.CompId,
        ...scopeParams(req),
      });

      // ponytail: extra recordsets ship in sql/055 — guard so the old SP (KPIs only) doesn't 500
      const rs = result.recordsets ?? [];
      return res.status(200).json({
        success: true,
        message: "Dashboard data fetched successfully",
        responseCode: 200,
        data: {
          dashboard: rs[0] ?? [],
          leadsTrend: rs[1] ?? [],
          leadsBySource: rs[2] ?? [],
          funnel: rs[3] ?? [],
          teamLoad: rs[4] ?? [],
          quarterlyActivity: rs[5] ?? [],
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Dashboard error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch dashboard data",
        code: "DASHBOARD_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // --- Ticket reports (Spec 2) ---

  async ticketsByCategory(req, res) {
    try {
      const result = await database.executeStoredProcedure("sp_TicketsByCategory", {
        CompId: req.user.CompId,
        // The caller's own branch is NOT a visibility gate — req.scope is.
        // Passing req.user.BranchId showed a Self-scope agent the whole
        // branch, showed a Company-scope user only their own, and went
        // company-wide for anyone whose tblUser.BranchId is NULL.
        BranchId: positiveInt(req.body.BranchId),
        ...scopeParams(req),
      });
      return res.status(200).json({
        success: true,
        message: "Tickets by category fetched successfully",
        responseCode: 200,
        data: { categories: result.recordsets[0] },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Tickets by category error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch tickets by category",
        code: "TICKETS_BY_CATEGORY_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async resolutionSummary(req, res) {
    try {
      const result = await database.executeStoredProcedure("sp_ResolutionSummary", {
        CompId: req.user.CompId,
        BranchId: positiveInt(req.body.BranchId),
        ...scopeParams(req),
      });
      return res.status(200).json({
        success: true,
        message: "Resolution summary fetched successfully",
        responseCode: 200,
        data: { resolutions: result.recordsets[0] },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Resolution summary error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch resolution summary",
        code: "RESOLUTION_SUMMARY_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }
}

const controller = new ReportController();

// Spec 4a: one method per report, every one the same line. Assigned on the
// instance rather than declared on the class so asyncRoute wraps each once —
// a thrown SP error becomes one consistent 500, validation stays a 400 inside
// runReport. REPORTS is the single list; adding a report = one row there.
for (const [key, { sp }] of Object.entries(REPORTS)) {
  controller[key] = asyncRoute(
    (req, res) => runReport(sp, req, res, key),
    "Failed to fetch report",
    "REPORT_ERROR",
  );
}

module.exports = controller;
