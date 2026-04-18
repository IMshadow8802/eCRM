const database = require("../config/database");
const { cleanSpRows } = require("../utils/spHelpers");

class LeadSourceController {
  async save(req, res) {
    try {
      const { SourceId = 0, SourceName } = req.body;

      const result = await database.executeStoredProcedure("sp_SaveLeadSource", {
        SourceId,
        SourceName,
      });

      const spResponse = result.recordsets[0][0];

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode < 300,
        message: spResponse.ResponseMessage || spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        data: spResponse.ResponseCode < 300 ? { sourceId: spResponse.SourceId } : null,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Save lead source error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to save lead source",
        code: "LEAD_SOURCE_SAVE_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async fetch(req, res) {
    try {
      const {
        SourceId = 0,
        PageNumber = 1,
        PageSize = 25,
        SearchTerm = null,
      } = req.body || {};

      const result = await database.executeStoredProcedure("sp_FetchLeadSource", {
        SourceId,
        PageNumber,
        PageSize,
        SearchTerm,
      });

      const header = result.recordsets[0][0] || {};
      const sources = cleanSpRows(result.recordsets[0], "SourceId");

      return res.status(200).json({
        success: true,
        message: "Lead sources fetched successfully",
        responseCode: 200,
        data: {
          sources,
          pagination: {
            currentPage: header.CurrentPage ?? PageNumber,
            pageSize: header.PageSize ?? PageSize,
            totalRecords: header.TotalRecords ?? sources.length,
            totalPages: header.TotalPages ?? 1,
          },
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Fetch lead source error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch lead sources",
        code: "LEAD_SOURCE_FETCH_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async delete(req, res) {
    try {
      const { SourceId } = req.body;

      const result = await database.executeStoredProcedure("sp_DeleteLeadSource", {
        SourceId,
      });

      const spResponse = result.recordsets[0][0];

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode === 200,
        message: spResponse.ResponseMessage || spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Delete lead source error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to delete lead source",
        code: "LEAD_SOURCE_DELETE_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }
}

module.exports = new LeadSourceController();
