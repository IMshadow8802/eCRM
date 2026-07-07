const database = require("../config/database");
const { logActivity, ACTIONS } = require("../utils/activityLogger");
const { cleanSpRows } = require("../utils/spHelpers");

class FollowupController {
  async save(req, res) {
    try {
      // Accept both new (LeadId) and legacy (LeadID) field names.
      const {
        Id = 0,
        LeadId,
        LeadID,
        NextFollowupDate = null,
        FollowupType = null,
        Remarks = null,
        Status = null,
        SourceCallId = null,
      } = req.body;

      const result = await database.executeStoredProcedure("sp_SaveFollowUp", {
        Id,
        LeadId: LeadId ?? LeadID,
        NextFollowupDate,
        FollowupType,
        Remarks,
        Status,
        SourceCallId,
        BranchId: req.user.BranchId,
        CompId: req.user.CompId,
        CreatedBy: req.user.UserId,
        EditBy: req.user.UserId,
      });

      const spResponse = result.recordsets[0][0];

      if (spResponse.ResponseCode < 300) {
        const entityId = spResponse.FollowUpId ?? Id;
        await logActivity({
          entityType: "FollowUp",
          entityId,
          action: Id === 0 ? ACTIONS.CREATED : ACTIONS.UPDATED,
          description: `Follow-up ${
            Id === 0 ? "created" : "updated"
          } for lead ${LeadId ?? LeadID}`,
          req,
        });
      }

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode < 300,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        data:
          spResponse.ResponseCode < 300
            ? { followUpId: spResponse.FollowUpId }
            : null,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Save followup error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to save follow-up",
        code: "FOLLOWUP_SAVE_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async fetch(req, res) {
    try {
      const {
        Id = 0,
        LeadId,
        LeadID,
        PageNumber = 1,
        PageSize = 10,
        SearchTerm = null,
      } = req.body;

      const accessibleBranchIdsJson = req.scope?.branchIds?.length
        ? JSON.stringify(req.scope.branchIds)
        : null;

      const result = await database.executeStoredProcedure("sp_FetchFollowUp", {
        Id,
        LeadId: LeadId ?? LeadID ?? 0,
        AccessibleBranchIdsJson: accessibleBranchIdsJson,
        PageNumber,
        PageSize,
        SearchTerm,
      });

      const spResponse = result.recordsets[0][0];
      const followups = cleanSpRows(result.recordsets[0]);

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode === 200,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        data: {
          followups,
          pagination: {
            currentPage: spResponse.CurrentPage,
            pageSize: spResponse.PageSize,
            totalRecords: spResponse.TotalRecords,
            totalPages: spResponse.TotalPages,
          },
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Fetch followup error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch follow-ups",
        code: "FOLLOWUP_FETCH_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async delete(req, res) {
    try {
      const { Id } = req.body;

      const result = await database.executeStoredProcedure("sp_DeleteFollowUp", {
        Id,
      });

      const spResponse = result.recordsets[0][0];

      if (spResponse.ResponseCode === 200) {
        await logActivity({
          entityType: "FollowUp",
          entityId: Id,
          action: ACTIONS.DELETED,
          description: "Follow-up deleted",
          req,
        });
      }

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode === 200,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Delete followup error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to delete follow-up",
        code: "FOLLOWUP_DELETE_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }
}

module.exports = new FollowupController();
