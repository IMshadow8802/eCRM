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

      return res.status(200).json({
        success: true,
        message: "Dashboard data fetched successfully",
        responseCode: 200,
        data: { dashboard: result.recordsets[0] },
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
}

module.exports = new ReportController();
