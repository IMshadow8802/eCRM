const database = require("../config/database");
const { cleanSpRows } = require("../utils/spHelpers");
const { logActivity, ACTIONS } = require("../utils/activityLogger");
const { success, validationError } = require("../utils/responseHelper");
const {
  asyncRoute,
  firstRow,
  spStatus,
  spOk,
  spMessage,
  pageParams,
  positiveInt,
} = require("../utils/controllerKit");

class UserGroupController {
  save = asyncRoute(
    async (req, res) => {
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

      const spResponse = firstRow(result);
      const ok = spOk(spResponse);

      if (ok) {
        await logActivity({
          entityType: "UserGroup",
          entityId: spResponse.GroupId ?? Id,
          action: Id === 0 ? ACTIONS.CREATED : ACTIONS.UPDATED,
          description: `Group "${Name ?? GroupName}" ${Id === 0 ? "created" : "updated"}`,
          req,
        });
      }

      return res.status(spStatus(spResponse)).json({
        success: ok,
        message: spMessage(spResponse),
        responseCode: spStatus(spResponse),
        data: ok ? { groupId: spResponse.GroupId } : null,
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to save user group",
    "USER_GROUP_SAVE_ERROR",
  );

  fetch = asyncRoute(
    async (req, res) => {
      // Handle empty request body
      const requestBody = req.body || {};

      const { Id = 0, SearchTerm = null } = requestBody;
      const { PageNumber, PageSize } = pageParams(requestBody, 10);

      const result = await database.executeStoredProcedure("sp_FetchUserGroup", {
        Id,
        CompId: req.user.CompId,
        BranchId: req.user.BranchId,
        IsAdmin: req.user.IsAdmin,
        PageNumber,
        PageSize,
        SearchTerm,
      });

      const spResponse = firstRow(result);
      const userGroups = cleanSpRows(result.recordsets[0]);

      return res.status(spStatus(spResponse)).json({
        success: spOk(spResponse),
        message: spMessage(spResponse),
        responseCode: spStatus(spResponse),
        data: {
          userGroups: userGroups,
          pagination: {
            currentPage: spResponse?.CurrentPage,
            pageSize: spResponse?.PageSize,
            totalRecords: spResponse?.TotalRecords,
            totalPages: spResponse?.TotalPages,
          },
        },
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to fetch user groups",
    "USER_GROUP_FETCH_ERROR",
  );

  delete = asyncRoute(
    async (req, res) => {
      // Validate request body exists
      if (!req.body || Object.keys(req.body).length === 0) {
        return validationError(res, "No payload found");
      }

      const Id = positiveInt(req.body.Id);

      if (!Id) return validationError(res, "Group ID is required");

      const result = await database.executeStoredProcedure("sp_DeleteUserGroup", {
        Id,
        CompId: req.user.CompId,
        BranchId: req.user.BranchId,
      });

      const spResponse = firstRow(result);

      if (spOk(spResponse)) {
        await logActivity({
          entityType: "UserGroup",
          entityId: Id,
          action: ACTIONS.DELETED,
          description: "User group deleted",
          req,
        });
      }

      return res.status(spStatus(spResponse)).json({
        success: spOk(spResponse),
        message: spMessage(spResponse),
        responseCode: spStatus(spResponse),
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to delete user group",
    "USER_GROUP_DELETE_ERROR",
  );

  // Fetch the full menu list with a group's grant flags (the permissions
  // matrix). sp_FetchGroupAccess returns every menu + CanView/Add/Edit/Delete
  // (0 where the group has no grant).
  fetchAccess = asyncRoute(
    async (req, res) => {
      const { GroupId } = req.body || {};

      if (!positiveInt(GroupId)) return validationError(res, "GroupId is required");

      const result = await database.executeStoredProcedure("sp_FetchGroupAccess", {
        GroupId,
        CompId: req.user.CompId,
      });

      return success(res, "Group access fetched", {
        access: cleanSpRows(result.recordsets[0], "MenuId"),
      });
    },
    "Failed to fetch group access",
    "GROUP_ACCESS_FETCH_ERROR",
  );

  // Bulk-replace a group's menu grants. Body: { GroupId, Access: [{ MenuId,
  // CanView, CanAdd, CanEdit, CanDelete }] }.
  saveAccess = asyncRoute(
    async (req, res) => {
      const { GroupId, Access = [] } = req.body || {};

      if (!positiveInt(GroupId)) return validationError(res, "GroupId is required");

      const accessList = Array.isArray(Access) ? Access : [];
      const accessJson = JSON.stringify(accessList);

      const result = await database.executeStoredProcedure("sp_SaveGroupAccess", {
        GroupId,
        AccessJson: accessJson,
        CompId: req.user.CompId,
      });

      const spResponse = firstRow(result);
      const ok = spOk(spResponse);

      if (ok) {
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

      return res.status(spStatus(spResponse)).json({
        success: ok,
        message: spMessage(spResponse),
        responseCode: spStatus(spResponse),
        data: ok ? { groupId: spResponse.GroupId } : null,
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to save group access",
    "GROUP_ACCESS_SAVE_ERROR",
  );
}

module.exports = new UserGroupController();
