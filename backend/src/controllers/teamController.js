const database = require("../config/database");
const { logActivity, ACTIONS } = require("../utils/activityLogger");
const { cleanSpRows } = require("../utils/spHelpers");

class TeamController {
  async save(req, res) {
    try {
      const {
        Id = 0,
        Name,
        Description,
        LeadUserId,
        Color,
        Members = [], // Array of user IDs
        IsActive = true,
      } = req.body;

      // Convert Members array to JSON string for stored procedure
      const membersJson = Array.isArray(Members) && Members.length > 0
        ? JSON.stringify(Members)
        : null;

      const result = await database.executeStoredProcedure("sp_SaveTeam", {
        Id,
        Name,
        Description,
        LeadUserId,
        Color,
        Members: membersJson,
        IsActive,
        CompId: req.user.CompId,
        BranchId: req.user.BranchId,
      });

      const spResponse = result.recordsets[0][0];

      if (spResponse.ResponseCode < 300 && spResponse.TeamId) {
        await logActivity({
          entityType: "Team",
          entityId: spResponse.TeamId,
          action: Id === 0 ? ACTIONS.CREATED : ACTIONS.UPDATED,
          description: `Team ${Name || ""} ${Id === 0 ? "created" : "updated"} (${spResponse.MemberCount || 0} members)`,
          req,
        });
      }

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode < 300,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        data:
          spResponse.ResponseCode < 300
            ? {
                teamId: spResponse.TeamId,
                memberCount: spResponse.MemberCount || 0
              }
            : null,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Save team error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to save team",
        code: "TEAM_SAVE_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async fetch(req, res) {
    try {
      const {
        Id = 0,
        PageNumber = 1,
        PageSize = 10,
        SearchTerm = null,
      } = req.body;

      const accessibleBranchIdsJson = req.scope?.branchIds?.length
        ? JSON.stringify(req.scope.branchIds)
        : null;

      const result = await database.executeStoredProcedure("sp_FetchTeam", {
        Id,
        CompId: req.user.CompId,
        BranchId: req.user.BranchId,
        IsAdmin: req.user.IsAdmin,
        AccessibleBranchIdsJson: accessibleBranchIdsJson,
        PageNumber,
        PageSize,
        SearchTerm,
      });

      const spResponse = result.recordsets[0][0];

      // Strip envelope + placeholder rows, then parse the Members JSON column.
      const teams = cleanSpRows(result.recordsets[0]).map((team) => {
        const { Members, ...rest } = team;
        let parsedMembers = [];
        if (Members) {
          try {
            parsedMembers = JSON.parse(Members);
          } catch (err) {
            console.warn("Failed to parse Members JSON:", err);
          }
        }
        return { ...rest, Members: parsedMembers };
      });

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode === 200,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        data: {
          teams: teams,
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
      console.error("Fetch team error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch teams",
        code: "TEAM_FETCH_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }


  async delete(req, res) {
    try {
      const { Id } = req.body;

      if (!Id || Id <= 0) {
        return res.status(400).json({
          success: false,
          message: "Team ID is required",
          code: "VALIDATION_ERROR",
          responseCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      const result = await database.executeStoredProcedure("sp_DeleteTeam", {
        Id,
        CompId: req.user.CompId,
        BranchId: req.user.BranchId,
        IsAdmin: req.user.IsAdmin,
      });

      const spResponse = result.recordsets[0][0];

      if (spResponse.ResponseCode === 200) {
        await logActivity({
          entityType: "Team",
          entityId: Id,
          action: ACTIONS.DELETED,
          description: "Team deleted",
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
      console.error("Delete team error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to delete team",
        code: "TEAM_DELETE_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

}

module.exports = new TeamController();
