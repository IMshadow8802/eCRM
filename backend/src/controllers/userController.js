const database = require("../config/database");
const { scopeJson } = require("../middleware/permission");
const { logActivity, ACTIONS } = require("../utils/activityLogger");
const { cleanSpRows } = require("../utils/spHelpers");
const { hashPassword, comparePassword } = require("../utils/encryption");
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

class UserController {
  save = asyncRoute(
    async (req, res) => {
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
        ReportsTo = null,
      } = req.body;

      // Hash before it ever reaches the DB. Login bcrypt-compares against this
      // column, so a plaintext write here means the account can never log in.
      // Blank on edit means "keep the current password" -- sp_SaveUser leaves
      // the column untouched when we send null (059).
      const PasswordHash = Password ? await hashPassword(Password) : null;

      const result = await database.executeStoredProcedure("sp_SaveUser", {
        Id,
        Username,
        Password: PasswordHash,
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
        ReportsTo: positiveInt(ReportsTo),
      });

      const spResponse = firstRow(result);
      const ok = spOk(spResponse);

      if (ok && spResponse.UserId) {
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

      return res.status(spStatus(spResponse)).json({
        success: ok,
        message: spMessage(spResponse),
        responseCode: spStatus(spResponse),
        data: ok
          ? {
              userId: spResponse.UserId,
              assignedGroupId: spResponse.AssignedGroupId
            }
          : null,
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to save user",
    "USER_SAVE_ERROR",
  );

  fetch = asyncRoute(
    async (req, res) => {
      const { Id = 0, SearchTerm = null } = req.body;
      const { PageNumber, PageSize } = pageParams(req.body, 10);

      // scopeJson, not `?.length ? stringify : null`. That form collapses an
      // empty scope to NULL, which every one of these SPs reads as "apply no
      // branch filter at all" — the widest possible answer for the narrowest
      // possible scope. '[]' is an empty allow-list and matches nothing.
      const accessibleBranchIdsJson = scopeJson(req.scope?.branchIds);

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

      const spResponse = firstRow(result);
      const users = cleanSpRows(result.recordsets[0]);

      return res.status(spStatus(spResponse)).json({
        success: spOk(spResponse),
        message: spMessage(spResponse),
        responseCode: spStatus(spResponse),
        data: {
          users: users,
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
    "Failed to fetch users",
    "USER_FETCH_ERROR",
  );

  delete = asyncRoute(
    async (req, res) => {
      // Validated here rather than left to the SP: an absent Id reached
      // sp_DeleteUser as undefined and the procedure decided for itself what
      // that meant.
      const Id = positiveInt(req.body.Id);

      if (!Id) return validationError(res, "User ID is required");

      const result = await database.executeStoredProcedure("sp_DeleteUser", {
        Id,
        CompId: req.user.CompId,
        BranchId: req.user.BranchId,
        IsAdmin: req.user.IsAdmin,
        RequestingUserId: req.user.UserId,
      });

      const spResponse = firstRow(result);

      if (spOk(spResponse)) {
        await logActivity({
          entityType: "User",
          entityId: Id,
          action: ACTIONS.DELETED,
          description: "User deleted",
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
    "Failed to delete user",
    "USER_DELETE_ERROR",
  );

  // --------------------------------------------------------------------------
  // Self-service ( /me ) — always operates on req.user.UserId, never a body id.
  // --------------------------------------------------------------------------

  // Edit own display name (FullName) + avatar preset. Username stays admin-only.
  updateMyProfile = asyncRoute(
    async (req, res) => {
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
      const spResponse = firstRow(result);
      const ok = spOk(spResponse);

      if (ok) {
        await logActivity({
          entityType: "User",
          entityId: req.user.UserId,
          action: ACTIONS.UPDATED,
          description: "Updated own profile",
          req,
        });
      }

      return res.status(spStatus(spResponse)).json({
        success: ok,
        message: spMessage(spResponse),
        responseCode: spStatus(spResponse),
        data: ok ? { FullName, Avatar, Email, Mobile } : null,
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to update profile",
    "PROFILE_UPDATE_ERROR",
  );

  // Change own password: bcrypt-verify the current one, then write the new hash
  // through the same profile SP (keeping the current name + avatar).
  changeMyPassword = asyncRoute(
    async (req, res) => {
      const { CurrentPassword, NewPassword } = req.body;

      if (!CurrentPassword || !NewPassword) {
        return validationError(res, "Current and new password are required");
      }
      if (String(NewPassword).length < 6) {
        return validationError(
          res,
          "New password must be at least 6 characters",
        );
      }

      // Read the current hash + profile (sp_ValidateUser returns all three).
      // Resolve by UserId, not the UserName JWT claim — that claim is minted at
      // login, so an admin rename in between would 401 the user out of their
      // own password change until they logged back in (059).
      const current = await database.executeStoredProcedure("sp_ValidateUser", {
        UserId: req.user.UserId,
      });
      const me = firstRow(current);
      if (!spOk(me)) {
        return error(res, "Could not verify current user", "AUTH_ERROR", 401);
      }

      const ok = await comparePassword(CurrentPassword, me.Password);
      if (!ok) {
        return error(res, "Current password is incorrect", "WRONG_PASSWORD", 401);
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
      const spResponse = firstRow(result);
      const saved = spOk(spResponse);

      if (saved) {
        await logActivity({
          entityType: "User",
          entityId: req.user.UserId,
          action: ACTIONS.UPDATED,
          description: "Changed own password",
          req,
        });
      }

      return res.status(spStatus(spResponse)).json({
        success: saved,
        message: saved ? "Password changed" : spMessage(spResponse),
        responseCode: spStatus(spResponse),
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to change password",
    "PASSWORD_CHANGE_ERROR",
  );

  // Light company roster {Id, FullName, Avatar} for client-side avatar lookup
  // in feeds. Any authenticated user; company-scoped.
  directory = asyncRoute(
    async (req, res) => {
      const result = await database.executeStoredProcedure(
        "sp_FetchUserDirectory",
        { CompId: req.user.CompId }
      );
      const users = cleanSpRows(result.recordsets[0] || []);

      return success(res, "Directory retrieved", { users });
    },
    "Failed to fetch directory",
    "DIRECTORY_ERROR",
  );

  // Who the caller may hand a lead to. Body { BranchId } lists a destination
  // branch's roster for cross-branch transfers; the RIGHT to do that is checked
  // in assertCanAssign at transfer time, not here — this only lists.
  assignableUsers = asyncRoute(
    async (req, res) => {
      const result = await database.executeStoredProcedure("sp_FetchAssignableUsers", {
        UserId: req.user.UserId,
        CompId: req.user.CompId,
        BranchId: positiveInt(req.body?.BranchId),
      });
      const users = cleanSpRows(result.recordsets?.[0] ?? []);
      return success(res, "Assignable users retrieved", { users });
    },
    "Failed to fetch assignable users",
    "ASSIGNABLE_USERS_ERROR",
  );

  // Branch pick-list for cross-branch transfers. Any authenticated user.
  branches = asyncRoute(
    async (req, res) => {
      const result = await database.executeStoredProcedure("sp_FetchBranches", {});
      return success(res, "Branches retrieved", { branches: result.recordsets?.[0] ?? [] });
    },
    "Failed to fetch branches",
    "BRANCHES_ERROR",
  );
}

module.exports = new UserController();
