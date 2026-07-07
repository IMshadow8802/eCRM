const database = require("../config/database");
const { cleanSpRows } = require("../utils/spHelpers");
const { logActivity, ACTIONS } = require("../utils/activityLogger");

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

      if (spResponse.ResponseCode < 300) {
        await logActivity({
          entityType: "UserGroup",
          entityId: spResponse.GroupId ?? Id,
          action: Id === 0 ? ACTIONS.CREATED : ACTIONS.UPDATED,
          description: `Group "${Name ?? GroupName}" ${Id === 0 ? "created" : "updated"}`,
          req,
        });
      }

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

      if (spResponse.ResponseCode === 200) {
        await logActivity({
          entityType: "UserGroup",
          entityId: Id,
          action: ACTIONS.DELETED,
          description: "User group deleted",
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

  // Fetch the full menu list with a group's grant flags (the permissions
  // matrix). sp_FetchGroupAccess returns every menu + CanView/Add/Edit/Delete
  // (0 where the group has no grant).
  async fetchAccess(req, res) {
    try {
      const { GroupId } = req.body || {};
      if (!GroupId || GroupId <= 0) {
        return res.status(400).json({
          success: false,
          message: "GroupId is required",
          code: "VALIDATION_ERROR",
          responseCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      const result = await database.executeStoredProcedure("sp_FetchGroupAccess", {
        GroupId,
        CompId: req.user.CompId,
      });

      return res.status(200).json({
        success: true,
        message: "Group access fetched",
        responseCode: 200,
        data: { access: cleanSpRows(result.recordsets[0], "MenuId") },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Fetch group access error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch group access",
        code: "GROUP_ACCESS_FETCH_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Bulk-replace a group's menu grants. Body: { GroupId, Access: [{ MenuId,
  // CanView, CanAdd, CanEdit, CanDelete }] }.
  async saveAccess(req, res) {
    try {
      const { GroupId, Access = [] } = req.body || {};
      if (!GroupId || GroupId <= 0) {
        return res.status(400).json({
          success: false,
          message: "GroupId is required",
          code: "VALIDATION_ERROR",
          responseCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      const accessList = Array.isArray(Access) ? Access : [];
      const accessJson = JSON.stringify(accessList);

      const result = await database.executeStoredProcedure("sp_SaveGroupAccess", {
        GroupId,
        AccessJson: accessJson,
        CompId: req.user.CompId,
      });

      const spResponse = result.recordsets[0][0];

      if (spResponse.ResponseCode < 300) {
        // Accountability: record WHO changed a group's menu permissions, WHEN,
        // and the resulting granted-menu set. PERMISSION_CHANGED is the audit
        // action; NewValue holds the menu ids the group can now access.
        const grantedMenuIds = accessList
          .filter((a) => a.CanView || a.CanAdd || a.CanEdit || a.CanDelete)
          .map((a) => a.MenuId);
        await logActivity({
          entityType: "UserGroup",
          entityId: GroupId,
          action: ACTIONS.PERMISSION_CHANGED,
          newValue: JSON.stringify(grantedMenuIds),
          description: `Menu permissions updated (${grantedMenuIds.length} menu(s) granted)`,
          req,
        });
      }

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode < 300,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        data: spResponse.ResponseCode < 300 ? { groupId: spResponse.GroupId } : null,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Save group access error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to save group access",
        code: "GROUP_ACCESS_SAVE_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }
}

module.exports = new UserGroupController();