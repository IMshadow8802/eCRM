const database = require("../config/database");
const { cleanSpRows } = require("../utils/spHelpers");
const { logActivity, ACTIONS } = require("../utils/activityLogger");
const { success, error, validationError } = require("../utils/responseHelper");
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
  // A role's module grants (spec 2026-10-07): RS1 head + sensitive/admin flags, RS2 one row per module.
  fetchModules = asyncRoute(
    async (req, res) => {
      const GroupId = positiveInt(req.body?.GroupId);
      if (!GroupId) return validationError(res, "GroupId is required");
      const result = await database.executeStoredProcedure("sp_FetchGroupModules", {
        GroupId,
        CompId: req.user.CompId,
      });
      const head = firstRow(result);
      if (!spOk(head)) return error(res, spMessage(head), "NOT_FOUND", spStatus(head));
      return success(res, "Role modules retrieved", {
        modules: result.recordsets[1] || [],
        canSeeSensitive: head.CanSeeSensitive === true || head.CanSeeSensitive === 1,
        isAdmin: head.IsAdmin === true || head.IsAdmin === 1,
      });
    },
    "Failed to fetch role modules",
    "ROLE_MODULES_ERROR",
  );

  // Bulk-replace a role's module grants. Body: { GroupId, Modules: [...], CanSeeSensitive }.
  saveModules = asyncRoute(
    async (req, res) => {
      const { GroupId, Modules, CanSeeSensitive = false } = req.body || {};
      if (!Array.isArray(Modules)) return validationError(res, "Modules must be a list");
      const groupId = positiveInt(GroupId);
      if (!groupId) return validationError(res, "GroupId is required");
      const result = await database.executeStoredProcedure("sp_SaveGroupModules", {
        GroupId: groupId,
        CompId: req.user.CompId,
        ModulesJson: JSON.stringify(Modules),
        CanSeeSensitive: CanSeeSensitive ? 1 : 0,
      });
      const row = firstRow(result);
      const ok = spOk(row);
      if (ok) {
        await logActivity({
          entityType: "UserGroup",
          entityId: groupId,
          action: ACTIONS.PERMISSION_CHANGED,
          newValue: JSON.stringify({ Modules, CanSeeSensitive: !!CanSeeSensitive }),
          description: `Module permissions updated (${Modules.length} module(s))`,
          req,
        });
      }
      return res.status(spStatus(row)).json({
        success: ok,
        message: spMessage(row),
        responseCode: spStatus(row),
        data: ok ? { groupId: row.Id } : null,
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to save role modules",
    "ROLE_MODULES_SAVE_ERROR",
  );

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
}

module.exports = new UserGroupController();
