const database = require("../config/database");
const { cleanSpRows } = require("../utils/spHelpers");

class StatusController {
  async save(req, res) {
    try {
      const { StatusId = 0, StatusName } = req.body;

      const result = await database.executeStoredProcedure("sp_SaveStatus", {
        StatusId,
        StatusName,
      });

      const spResponse = result.recordsets[0][0];

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode < 300,
        message: spResponse.ResponseMessage || spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        data: spResponse.ResponseCode < 300 ? { statusId: spResponse.StatusId } : null,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Save status error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to save status",
        code: "STATUS_SAVE_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async fetch(req, res) {
    try {
      const {
        StatusId = 0,
        PageNumber = 1,
        PageSize = 25,
        SearchTerm = null,
      } = req.body || {};

      const result = await database.executeStoredProcedure("sp_FetchStatus", {
        StatusId,
        PageNumber,
        PageSize,
        SearchTerm,
      });

      const header = result.recordsets[0][0] || {};
      const statuses = cleanSpRows(result.recordsets[0], "StatusId");

      return res.status(200).json({
        success: true,
        message: "Statuses fetched successfully",
        responseCode: 200,
        data: {
          statuses,
          pagination: {
            currentPage: header.CurrentPage ?? PageNumber,
            pageSize: header.PageSize ?? PageSize,
            totalRecords: header.TotalRecords ?? statuses.length,
            totalPages: header.TotalPages ?? 1,
          },
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Fetch status error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch statuses",
        code: "STATUS_FETCH_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async delete(req, res) {
    try {
      const { StatusId } = req.body;

      const result = await database.executeStoredProcedure("sp_DeleteStatus", {
        StatusId,
      });

      const spResponse = result.recordsets[0][0];

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode === 200,
        message: spResponse.ResponseMessage || spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Delete status error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to delete status",
        code: "STATUS_DELETE_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }
}

module.exports = new StatusController();
