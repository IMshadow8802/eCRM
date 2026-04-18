const database = require("../config/database");
const { cleanSpRows } = require("../utils/spHelpers");

class UserGroupController {
  async save(req, res) {
    try {
      // Validate request body exists
      if (!req.body || Object.keys(req.body).length === 0) {
        return res.status(400).json({
          success: false,
          message: "No payload found",
          code: "VALIDATION_ERROR",
          responseCode: 400,
          data: null,
          timestamp: new Date().toISOString(),
        });
      }

      // Accept both new (Name/Description) and legacy (GroupName/GroupDescription)
      // payloads to keep the frontend transition smooth.
      const {
        Id = 0,
        Name,
        Description,
        GroupName,
        GroupDescription,
        IsActive = true,
      } = req.body;

      const result = await database.executeStoredProcedure("sp_SaveUserGroup", {
        Id,
        Name: Name ?? GroupName,
        Description: Description ?? GroupDescription,
        IsActive,
        CompId: req.user.CompId,
        BranchId: req.user.BranchId,
      });

      const spResponse = result.recordsets[0][0];

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode < 300,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        data:
          spResponse.ResponseCode < 300 
            ? { groupId: spResponse.GroupId } 
            : null,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Save user group error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to save user group",
        code: "USER_GROUP_SAVE_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async fetch(req, res) {
    try {
      // Handle empty request body
      const requestBody = req.body || {};
      
      const {
        Id = 0,
        PageNumber = 1,
        PageSize = 10,
        SearchTerm = null,
      } = requestBody;

      const result = await database.executeStoredProcedure("sp_FetchUserGroup", {
        Id,
        CompId: req.user.CompId,
        BranchId: req.user.BranchId,
        IsAdmin: req.user.IsAdmin,
        PageNumber,
        PageSize,
        SearchTerm,
      });

      const spResponse = result.recordsets[0][0];
      const userGroups = cleanSpRows(result.recordsets[0]);

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode === 200,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        data: {
          userGroups: userGroups,
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
      console.error("Fetch user group error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch user groups",
        code: "USER_GROUP_FETCH_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async delete(req, res) {
    try {
      // Validate request body exists
      if (!req.body || Object.keys(req.body).length === 0) {
        return res.status(400).json({
          success: false,
          message: "No payload found",
          code: "VALIDATION_ERROR",
          responseCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      const { Id } = req.body;

      if (!Id || Id <= 0) {
        return res.status(400).json({
          success: false,
          message: "Group ID is required",
          code: "VALIDATION_ERROR",
          responseCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      const result = await database.executeStoredProcedure("sp_DeleteUserGroup", {
        Id,
        CompId: req.user.CompId,
        BranchId: req.user.BranchId,
      });

      const spResponse = result.recordsets[0][0];

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode === 200,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Delete user group error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to delete user group",
        code: "USER_GROUP_DELETE_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

}

module.exports = new UserGroupController();