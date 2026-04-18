const database = require("../config/database");
const { cleanSpRows } = require("../utils/spHelpers");

class KanbanController {
  async fetch(req, res) {
    try {
      const {
        Id = 0,
        ProjectId = null,
        PageNumber = 1,
        PageSize = 25,
        SearchTerm = null,
      } = req.body || {};

      const accessibleBranchIdsJson = req.scope?.branchIds?.length
        ? JSON.stringify(req.scope.branchIds)
        : null;

      const result = await database.executeStoredProcedure("sp_FetchKanbanColumn", {
        Id,
        ProjectId,
        CompId: req.user.CompId,
        BranchId: req.user.BranchId,
        IsAdmin: req.user.IsAdmin,
        AccessibleBranchIdsJson: accessibleBranchIdsJson,
        PageNumber,
        PageSize,
        SearchTerm,
      });

      const header = result.recordsets[0][0] || {};
      const columns = cleanSpRows(result.recordsets[0]);

      return res.status(header.ResponseCode || 200).json({
        success: (header.ResponseCode || 200) === 200,
        message: header.ResponseMess,
        responseCode: header.ResponseCode || 200,
        data: {
          columns,
          pagination: {
            currentPage: header.CurrentPage ?? PageNumber,
            pageSize: header.PageSize ?? PageSize,
            totalRecords: header.TotalRecords ?? columns.length,
            totalPages: header.TotalPages ?? 1,
          },
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Fetch kanban columns error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch kanban columns",
        code: "KANBAN_FETCH_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async getColumns(req, res) {
    try {
      const { ProjectId = null } = req.body;

      const result = await database.executeStoredProcedure(
        "sp_FetchKanbanColumn",
        {
          Id: 0,
          ProjectId,
          CompId: req.user.CompId,
          BranchId: req.user.BranchId,
          IsAdmin: req.user.IsAdmin,
        }
      );

      const spResponse = result.recordsets[0][0];
      const columns = cleanSpRows(result.recordsets[0]);

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode === 200,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        data: { columns },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Get kanban columns error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to get kanban columns",
        code: "KANBAN_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async save(req, res) {
    try {
      const {
        Id = 0,
        ProjectId,
        Title,
        Color,
        SortOrder = 0,
        MaxTasks,
        IsActive = true,
      } = req.body;

      if (!ProjectId || ProjectId <= 0) {
        return res.status(400).json({
          success: false,
          message: "Project ID is required",
          code: "VALIDATION_ERROR",
          responseCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      const result = await database.executeStoredProcedure(
        "sp_SaveKanbanColumn",
        {
          Id,
          ProjectId,
          Title,
          Color,
          SortOrder,
          MaxTasks,
          IsActive,
          CompId: req.user.CompId,
          BranchId: req.user.BranchId,
        }
      );

      const spResponse = result.recordsets[0][0];

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode < 300,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        data:
          spResponse.ResponseCode < 300
            ? { columnId: spResponse.ColumnId }
            : null,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Save kanban column error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to save kanban column",
        code: "KANBAN_SAVE_ERROR",
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
          message: "Column ID is required",
          code: "VALIDATION_ERROR",
          responseCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      const result = await database.executeStoredProcedure(
        "sp_DeleteKanbanColumn",
        {
          Id,
          CompId: req.user.CompId,
          BranchId: req.user.BranchId,
        }
      );

      const spResponse = result.recordsets[0][0];

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode === 200,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Delete kanban column error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to delete kanban column",
        code: "KANBAN_DELETE_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

}

module.exports = new KanbanController();
