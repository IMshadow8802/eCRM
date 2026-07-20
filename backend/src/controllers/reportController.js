const database = require("../config/database");

function scopeJson(req) {
  return req.scope?.branchIds?.length ? JSON.stringify(req.scope.branchIds) : null;
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

  async getFollowupsUserWise(req, res) {
    try {
      const { StartDate, EndDate } = req.body;

      const result = await database.executeStoredProcedure("sp_FollowupsListUserWise", {
        StartDate,
        EndDate,
      });

      return res.status(200).json({
        success: true,
        message: "User-wise followups fetched successfully",
        responseCode: 200,
        data: { followups: result.recordsets[0] },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Followups user-wise error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch user-wise followups",
        code: "FOLLOWUPS_USERWISE_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async getLeadSummaryBranchWise(req, res) {
    try {
      const { StartDate, EndDate } = req.body;

      const result = await database.executeStoredProcedure("sp_LeadSummaryBranchWise", {
        StartDate,
        EndDate,
      });

      return res.status(200).json({
        success: true,
        message: "Branch-wise lead summary fetched successfully",
        responseCode: 200,
        data: { summary: result.recordsets[0] },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Lead summary branch-wise error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch branch-wise lead summary",
        code: "LEAD_SUMMARY_BRANCHWISE_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async pipelineFunnel(req, res) {
    try {
      const { CompId, BranchId } = req.user;
      const { PipelineId = null } = req.body;

      const result = await database.executeStoredProcedure("sp_PipelineFunnel", {
        CompId,
        BranchId,
        PipelineId,
      });

      return res.status(200).json({
        success: true,
        message: "Pipeline funnel fetched successfully",
        responseCode: 200,
        data: { funnel: result.recordsets[0] },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Pipeline funnel error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch pipeline funnel",
        code: "PIPELINE_FUNNEL_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async callsPerUser(req, res) {
    try {
      const { CompId, BranchId } = req.user;
      const { FromDate = null, ToDate = null } = req.body;

      const result = await database.executeStoredProcedure("sp_CallsPerUser", {
        CompId,
        BranchId,
        FromDate,
        ToDate,
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
      const { CompId, BranchId } = req.user;

      const result = await database.executeStoredProcedure("sp_ConversionBySource", {
        CompId,
        BranchId,
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
