const database = require("../config/database");
const { logActivity, ACTIONS } = require("../utils/activityLogger");
const { cleanSpRows } = require("../utils/spHelpers");
const { hashPassword, comparePassword } = require("../utils/encryption");

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
        Mobile = null,
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
        Mobile,
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

  // --------------------------------------------------------------------------
  // Self-service ( /me ) — always operates on req.user.UserId, never a body id.
  // --------------------------------------------------------------------------

  // Edit own display name (FullName) + avatar preset. Username stays admin-only.
  async updateMyProfile(req, res) {
    try {
      const { FullName, Avatar = null, Email = null, Mobile = null } = req.body;

      const result = await database.executeStoredProcedure(
        "sp_UpdateOwnProfile",
        {
          UserId: req.user.UserId, // self only
          FullName,
          Avatar,
          Email,
          Mobile,
          NewPasswordHash: null, // profile edit never touches the password
        }
      );
      const spResponse = result.recordsets[0][0];

      if (spResponse.ResponseCode === 200) {
        await logActivity({
          entityType: "User",
          entityId: req.user.UserId,
          action: ACTIONS.UPDATED,
          description: "Updated own profile",
          req,
        });
      }

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode === 200,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        data:
          spResponse.ResponseCode === 200
            ? { FullName, Avatar, Email, Mobile }
            : null,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Update own profile error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to update profile",
        code: "PROFILE_UPDATE_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Change own password: bcrypt-verify the current one, then write the new hash
  // through the same profile SP (keeping the current name + avatar).
  async changeMyPassword(req, res) {
    try {
      const { CurrentPassword, NewPassword } = req.body;

      if (!CurrentPassword || !NewPassword) {
        return res.status(400).json({
          success: false,
          message: "Current and new password are required",
          code: "VALIDATION_ERROR",
          responseCode: 400,
          timestamp: new Date().toISOString(),
        });
      }
      if (String(NewPassword).length < 6) {
        return res.status(400).json({
          success: false,
          message: "New password must be at least 6 characters",
          code: "VALIDATION_ERROR",
          responseCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      // Read the current hash + profile (sp_ValidateUser returns all three).
      const current = await database.executeStoredProcedure("sp_ValidateUser", {
        identifier: req.user.UserName,
      });
      const me = current.recordsets[0][0];
      if (!me || me.ResponseCode !== 200) {
        return res.status(401).json({
          success: false,
          message: "Could not verify current user",
          code: "AUTH_ERROR",
          responseCode: 401,
          timestamp: new Date().toISOString(),
        });
      }

      const ok = await comparePassword(CurrentPassword, me.Password);
      if (!ok) {
        return res.status(401).json({
          success: false,
          message: "Current password is incorrect",
          code: "WRONG_PASSWORD",
          responseCode: 401,
          timestamp: new Date().toISOString(),
        });
      }

      const newHash = await hashPassword(NewPassword);
      const result = await database.executeStoredProcedure(
        "sp_UpdateOwnProfile",
        {
          UserId: req.user.UserId,
          // keep the current profile unchanged — only the password moves
          FullName: me.FullName,
          Avatar: me.Avatar ?? null,
          Email: me.Email ?? null,
          Mobile: me.Mobile ?? null,
          NewPasswordHash: newHash,
        }
      );
      const spResponse = result.recordsets[0][0];

      if (spResponse.ResponseCode === 200) {
        await logActivity({
          entityType: "User",
          entityId: req.user.UserId,
          action: ACTIONS.UPDATED,
          description: "Changed own password",
          req,
        });
      }

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode === 200,
        message:
          spResponse.ResponseCode === 200
            ? "Password changed"
            : spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Change password error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to change password",
        code: "PASSWORD_CHANGE_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Light company roster {Id, FullName, Avatar} for client-side avatar lookup
  // in feeds. Any authenticated user; company-scoped.
  async directory(req, res) {
    try {
      const result = await database.executeStoredProcedure(
        "sp_FetchUserDirectory",
        { CompId: req.user.CompId }
      );
      const users = cleanSpRows(result.recordsets[0] || []);

      return res.status(200).json({
        success: true,
        message: "Directory retrieved",
        responseCode: 200,
        data: { users },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("User directory error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch directory",
        code: "DIRECTORY_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }
}

module.exports = new UserController();
