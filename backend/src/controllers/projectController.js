const database = require("../config/database");
const { logActivity, ACTIONS } = require("../utils/activityLogger");
const { cleanSpRows } = require("../utils/spHelpers");

class ProjectController {
  async save(req, res) {
    try {
      const {
        Id = 0,
        Name,
        Description,
        ManagerUserId,
        TeamId,
        Members,
        Status = "active",
        Priority = "medium",
        StartDate,
        EndDate,
        Budget = 0,
        Progress = 0,
      } = req.body;

      const result = await database.executeStoredProcedure("sp_SaveProject", {
        Id,
        Name,
        Description,
        ManagerUserId,
        TeamId,
        Members:
          typeof Members === "object" ? JSON.stringify(Members) : Members,
        Status,
        Priority,
        StartDate,
        EndDate,
        Budget,
        Progress,
        CompId: req.user.CompId,
        BranchId: req.user.BranchId,
      });

      const spResponse = result.recordsets[0][0];

      if (spResponse.ResponseCode < 300 && spResponse.ProjectId) {
        await logActivity({
          entityType: "Project",
          entityId: spResponse.ProjectId,
          action: Id === 0 ? ACTIONS.CREATED : ACTIONS.UPDATED,
          description: `Project ${Name || ""} ${Id === 0 ? "created" : "updated"}`,
          req,
        });
      }

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode < 300,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        data:
          spResponse.ResponseCode < 300
            ? { projectId: spResponse.ProjectId }
            : null,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Save project error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to save project",
        code: "PROJECT_SAVE_ERROR",
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

      const result = await database.executeStoredProcedure("sp_FetchProject", {
        Id,
        UserId: req.user.UserId,
        CompId: req.user.CompId,
        BranchId: req.user.BranchId,
        IsAdmin: req.user.IsAdmin,
        AccessibleBranchIdsJson: accessibleBranchIdsJson,
        PageNumber,
        PageSize,
        SearchTerm,
      });

      const spResponse = result.recordsets[0][0];

      // Drop envelope fields and the empty-result placeholder row.
      const projects = cleanSpRows(result.recordsets[0]);

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode === 200,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        data: {
          projects: projects,
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
      console.error("Fetch project error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch projects",
        code: "PROJECT_FETCH_ERROR",
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
          message: "Project ID is required",
          code: "VALIDATION_ERROR",
          responseCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      const result = await database.executeStoredProcedure("sp_DeleteProject", {
        Id,
        UserId: req.user.UserId,
        CompId: req.user.CompId,
        BranchId: req.user.BranchId,
        IsAdmin: req.user.IsAdmin,
      });

      const spResponse = result.recordsets[0][0];

      if (spResponse.ResponseCode === 200) {
        await logActivity({
          entityType: "Project",
          entityId: Id,
          action: ACTIONS.DELETED,
          description: "Project deleted",
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
      console.error("Delete project error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to delete project",
        code: "PROJECT_DELETE_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }
}

module.exports = new ProjectController();
