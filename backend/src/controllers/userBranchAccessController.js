// src/controllers/userBranchAccessController.js
const database = require("../config/database");
const { cleanSpRows } = require("../utils/spHelpers");

class UserBranchAccessController {
  async save(req, res) {
    try {
      const {
        Id = 0,
        UserId,
        BranchId,
        CanRead = true,
        CanWrite = false,
      } = req.body || {};

      if (!UserId || !BranchId) {
        return res.status(400).json({
          success: false,
          message: "UserId and BranchId are required",
          code: "VALIDATION_ERROR",
          responseCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      const result = await database.executeStoredProcedure(
        "sp_SaveUserBranchAccess",
        {
          Id,
          UserId,
          BranchId,
          CanRead,
          CanWrite,
          CompId: req.user.CompId,
          CreatedBy: req.user.UserId,
        }
      );

      const sp = result.recordsets[0][0];
      return res.status(sp.ResponseCode).json({
        success: sp.ResponseCode < 300,
        message: sp.ResponseMess,
        responseCode: sp.ResponseCode,
        data: sp.ResponseCode < 300 ? { id: sp.Id } : null,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Save user branch access error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to save branch access",
        code: "USER_BRANCH_ACCESS_SAVE_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async fetch(req, res) {
    try {
      const {
        UserId,
        PageNumber = 1,
        PageSize = 25,
        SearchTerm = null,
      } = req.body || {};

      if (!UserId) {
        return res.status(400).json({
          success: false,
          message: "UserId is required",
          code: "VALIDATION_ERROR",
          responseCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      const result = await database.executeStoredProcedure(
        "sp_FetchUserBranchAccess",
        { UserId, CompId: req.user.CompId, PageNumber, PageSize, SearchTerm }
      );

      const header = result.recordsets[0][0] || {};
      const access = cleanSpRows(result.recordsets[0]);

      return res.status(header.ResponseCode || 200).json({
        success: (header.ResponseCode || 200) === 200,
        message: header.ResponseMess,
        responseCode: header.ResponseCode || 200,
        data: {
          branchAccess: access,
          pagination: {
            currentPage: header.CurrentPage ?? PageNumber,
            pageSize: header.PageSize ?? PageSize,
            totalRecords: header.TotalRecords ?? access.length,
            totalPages: header.TotalPages ?? 1,
          },
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Fetch user branch access error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch branch access",
        code: "USER_BRANCH_ACCESS_FETCH_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async delete(req, res) {
    try {
      const { Id } = req.body || {};
      if (!Id) {
        return res.status(400).json({
          success: false,
          message: "Id is required",
          code: "VALIDATION_ERROR",
          responseCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      const result = await database.executeStoredProcedure(
        "sp_DeleteUserBranchAccess",
        { Id }
      );

      const sp = result.recordsets[0][0];
      return res.status(sp.ResponseCode).json({
        success: sp.ResponseCode === 200,
        message: sp.ResponseMess,
        responseCode: sp.ResponseCode,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Delete user branch access error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to delete branch access",
        code: "USER_BRANCH_ACCESS_DELETE_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Convenience: caller's own scope summary (no admin permission needed)
  async myScope(req, res) {
    return res.status(200).json({
      success: true,
      message: "Scope retrieved",
      responseCode: 200,
      data: req.scope || null,
      timestamp: new Date().toISOString(),
    });
  }
}

module.exports = new UserBranchAccessController();
