const database = require("../config/database");
const { scopeJson: serialiseScope } = require("../middleware/permission");

/**
 * Was a local copy that collapsed an empty scope to NULL — which sp_Dashboard
 * and sp_ConvertedSummary both read as "no branch filter", so the user with the
 * narrowest scope got the widest dashboard. Delegates to the shared serialiser
 * now, which keeps `[]` as an empty allow-list.
 */
function scopeJson(req) {
  return serialiseScope(req.scope?.branchIds);
}

class ReportController {
  async getDashboard(req, res) {
    try {
      const result = await database.executeStoredProcedure("sp_Dashboard", {
        CompId: req.user.CompId,
        AccessibleBranchIdsJson: scopeJson(req),
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

  async getConvertedSummary(req, res) {
    try {
      const result = await database.executeStoredProcedure("sp_ConvertedSummary", {
        CompId: req.user.CompId,
        AccessibleBranchIdsJson: scopeJson(req),
      });

      return res.status(200).json({
        success: true,
        message: "Converted summary fetched successfully",
        responseCode: 200,
        data: { summary: result.recordsets[0][0] },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Converted summary error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch converted summary",
        code: "CONVERTED_SUMMARY_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async leadsByStatus(req, res) {
    try {
      const { BranchId = null } = req.body;
      const result = await database.executeStoredProcedure("sp_LeadsByStatus", {
        CompId: req.user.CompId,
        BranchId,
        AccessibleBranchIdsJson: scopeJson(req),
      });
      return res.status(200).json({
        success: true,
        message: "Leads by status fetched successfully",
        responseCode: 200,
        data: { statuses: result.recordsets[0] },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Leads by status error:", err);
      return res.status(500).json({
        success: false, message: "Failed to fetch leads by status",
        code: "LEADS_BY_STATUS_ERROR", responseCode: 500, timestamp: new Date().toISOString(),
      });
    }
  }

  async callsPerUser(req, res) {
    try {
      const { CompId } = req.user;
      const { BranchId = null, FromDate = null, ToDate = null } = req.body;

      const result = await database.executeStoredProcedure("sp_CallsPerUser", {
        CompId,
        BranchId,
        FromDate,
        ToDate,
        AccessibleBranchIdsJson: scopeJson(req),
      });

      return res.status(200).json({
        success: true,
        message: "Calls per user fetched successfully",
        responseCode: 200,
        data: { calls: result.recordsets[0] },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Calls per user error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch calls per user",
        code: "CALLS_PER_USER_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async conversionBySource(req, res) {
    try {
      const { CompId } = req.user;
      const { BranchId = null } = req.body;

      const result = await database.executeStoredProcedure("sp_ConversionBySource", {
        CompId,
        BranchId,
        AccessibleBranchIdsJson: scopeJson(req),
      });

      return res.status(200).json({
        success: true,
        message: "Conversion by source fetched successfully",
        responseCode: 200,
        data: { conversion: result.recordsets[0] },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Conversion by source error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch conversion by source",
        code: "CONVERSION_BY_SOURCE_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // --- Ticket reports (Spec 2) ---

  async ticketsByCategory(req, res) {
    try {
      const { CompId, BranchId } = req.user;
      const result = await database.executeStoredProcedure("sp_TicketsByCategory", {
        CompId,
        BranchId,
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
      const { CompId, BranchId } = req.user;
      const result = await database.executeStoredProcedure("sp_ResolutionSummary", {
        CompId,
        BranchId,
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

module.exports = new ReportController();
