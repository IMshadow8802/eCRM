const database = require("../config/database");
const { logActivity, ACTIONS } = require("../utils/activityLogger");
const { cleanSpRows } = require("../utils/spHelpers");

class UserController {
  async save(req, res) {
    try {
      // Accept both new (UserIp) and legacy (User_IP) field names.
      const {
        Id = 0,
        Username,
        Password,
        UserActive = true,
        IsAdmin = false,
        UserIp,
        User_IP,
        AllowDay = 0,
        FullName,
        Email,
        JobTitle,
        HourlyRate = 0,
        GroupId = 8, // Default to General Users
      } = req.body;

      const result = await database.executeStoredProcedure("sp_SaveUser", {
        Id,
        Username,
        Password,
        UserActive,
        IsAdmin,
        UserIp: UserIp ?? User_IP ?? "",
        AllowDay,
        FullName,
        Email,
        JobTitle,
        HourlyRate,
        GroupId,
        CompId: req.user.CompId,
        BranchId: req.user.BranchId,
      });

      const spResponse = result.recordsets[0][0];

      if (spResponse.ResponseCode < 300 && spResponse.UserId) {
        await logActivity({
          entityType: "User",
          entityId: spResponse.UserId,
          action: Id === 0 ? ACTIONS.CREATED : ACTIONS.UPDATED,
          description:
            Id === 0
              ? `User ${Username} created`
              : `User ${Username} updated`,
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
                userId: spResponse.UserId,
                assignedGroupId: spResponse.AssignedGroupId
              }
            : null,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Save user error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to save user",
        code: "USER_SAVE_ERROR",
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

      const result = await database.executeStoredProcedure("sp_FetchUser", {
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
      const users = cleanSpRows(result.recordsets[0]);

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode === 200,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        data: {
          users: users,
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
      console.error("Fetch user error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch users",
        code: "USER_FETCH_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async delete(req, res) {
    try {
      const { Id } = req.body;

      const result = await database.executeStoredProcedure("sp_DeleteUser", {
        Id,
        CompId: req.user.CompId,
        BranchId: req.user.BranchId,
        IsAdmin: req.user.IsAdmin,
        RequestingUserId: req.user.UserId,
      });

      const spResponse = result.recordsets[0][0];

      if (spResponse.ResponseCode === 200) {
        await logActivity({
          entityType: "User",
          entityId: Id,
          action: ACTIONS.DELETED,
          description: "User deleted",
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
      console.error("Delete user error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to delete user",
        code: "USER_DELETE_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }
}

module.exports = new UserController();
