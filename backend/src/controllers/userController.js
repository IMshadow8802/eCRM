const database = require("../config/database");
const { scopeJson, scopeFor, canWriteBranch } = require("../middleware/permission");
const { stripSensitive, roleWithin } = require("../middleware/access");
const { logActivity, ACTIONS } = require("../utils/activityLogger");
const { emitToWorkspace, emitToUser } = require("../realtime/events");
const { SCOPES } = require("../realtime/contract");
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

const bit = (v) => v === true || v === 1;

// May this caller edit (password reset included) this person? ONE predicate:
// save refuses with it and fetch shows it as the row's CanEdit. A non-admin needs
// people edit + the sensitive permission, a non-admin row, and write reach over
// the row's office. RoleIsAdmin (from the role, sp_FetchUser 100) beats the lagging
// tblUser.IsAdmin mirror; the mirror is the fallback on an older DB. Row-only on purpose; the target's roles are checked in save
// (personRefusal), which stays the authority.
function canEditPerson(req, row) {
  if (req.access?.isAdmin) return true;
  return !!row && !bit(row.RoleIsAdmin ?? row.IsAdmin) && !!req.access?.canSeeSensitive
    && !!req.access?.modules?.people?.edit && canWriteBranch(req, row.BranchId);
}

// Grants (RS2) a non-admin may not hand out or touch: a missing RS2 fails closed,
// as does a sensitive role without the caller's sensitive permission.
const tooWide = (req, head, rows) =>
  !Array.isArray(rows) || (bit(head.CanSeeSensitive) && !req.access?.canSeeSensitive) || !roleWithin(req.access, rows);

// The response when a role (sp_FetchGroupModules) grants more than the caller
// holds (roleWithin), or is sensitive and they are not; null when it fits.
async function roleRefusal(req, res, groupId, message) {
  const role = await database.executeStoredProcedure("sp_FetchGroupModules", { GroupId: groupId, CompId: req.user.CompId });
  const head = firstRow(role);
  if (!spOk(head)) return error(res, "Role not found", "NOT_FOUND", 404);
  return tooWide(req, head, role.recordsets?.[1]) ? error(res, message, "FORBIDDEN", 403) : null;
}

// Same test on a person's CURRENT roles: sp_FetchUserAccess is the union over
// every active group they hold (not just the first one sp_FetchUser shows), and
// its header carries the real IsAdmin (tblUser.IsAdmin is a mirror that can lag).
async function personRefusal(req, res, userId, message) {
  const result = await database.executeStoredProcedure("sp_FetchUserAccess", { UserId: userId, CompId: req.user.CompId });
  const head = result.recordsets?.[0]?.[0];
  if (!head || bit(head.IsAdmin) || tooWide(req, head, result.recordsets?.[1])) {
    return error(res, message, "FORBIDDEN", 403);
  }
  return null;
}

class UserController {
  save = asyncRoute(
    async (req, res) => {
      // Accept both new (UserIp) and legacy (User_IP) field names.
      const {
        Id = 0,
        Username,
        Password,
        UserActive = true,
        UserIp,
        User_IP,
        AllowDay = 0,
        FullName,
        Email,
        JobTitle,
        HourlyRate = 0,
        GroupId,
        BranchId,
        Mobile = null,
        ReportsTo,
        WorkCalendarId,
        PresenceExempt,
      } = req.body;

      // No default role: the old `GroupId = 8` pointed at a group that does not exist.
      const groupId = positiveInt(GroupId);
      if (!groupId) return validationError(res, "Pick a role for this user");
      const isEdit = positiveInt(Id) !== null;

      const actorIsAdmin = !!req.access?.isAdmin;
      if (!actorIsAdmin && !req.access?.canSeeSensitive) {
        return error(res, "Editing people needs the salary & contact permission", "INSUFFICIENT_ROLE", 403);
      }
      const branch = positiveInt(BranchId);
      if (!actorIsAdmin && branch && !canWriteBranch(req, branch)) {
        return error(res, "You cannot place people in that office", "FORBIDDEN", 403);
      }
      // Editing someone also needs write reach over the office they are in NOW,
      // not just the one they are moving to; else an out-of-reach person could be
      // edited (or have their password reset) by sending no BranchId.
      let currentGroupId = null;
      if (!actorIsAdmin && isEdit) {
        const found = await database.executeStoredProcedure("sp_FetchUser", {
          Id: positiveInt(Id),
          CompId: req.user.CompId,
          BranchId: req.user.BranchId, // ignored when IsAdmin=1
          IsAdmin: 1,
          AccessibleBranchIdsJson: null,
          PageNumber: 1,
          PageSize: 1,
          SearchTerm: null,
        });
        const target = cleanSpRows(found.recordsets?.[0] ?? [])[0];
        if (!target?.Id) return error(res, "User not found", "NOT_FOUND", 404);
        if (!canEditPerson(req, target)) {
          return error(res, "You cannot edit this person", "FORBIDDEN", 403);
        }
        currentGroupId = positiveInt(target.GroupId);
        if (positiveInt(Id) === Number(req.user.UserId) && currentGroupId !== groupId) {
          return error(res, "You cannot change your own role", "FORBIDDEN", 403);
        }
      }
      // A non-admin may edit (password reset included) only people whose CURRENT
      // roles (every active group) are inside their own access, else HR could reset a Sales Head's
      // password and sign in as them; and may hand out only roles inside it, else
      // HR could give someone Sales/Support reach they do not hold. Same role = one fetch.
      if (!actorIsAdmin && isEdit) {
        const refused = await personRefusal(req, res, positiveInt(Id),
          "You can only edit people whose role is within your own access");
        if (refused) return refused;
      }
      if (!actorIsAdmin && (!isEdit || currentGroupId !== groupId)) {
        const refused = await roleRefusal(req, res, groupId, "You can only give roles within your own access");
        if (refused) return refused;
      }
      // 0 = company standard shift, null/absent = keep; anything else must be a real id.
      const calendarGiven = WorkCalendarId !== undefined && WorkCalendarId !== null;
      const calendarId = !calendarGiven ? null : Number(WorkCalendarId) === 0 && WorkCalendarId !== "" ? 0 : positiveInt(WorkCalendarId);
      if (calendarGiven && calendarId === null) return validationError(res, "Choose a valid shift");

      // ReportsTo: absent/null = keep the current manager, 0 = clear it (spec §6).
      const reportsTo = ReportsTo === 0 || ReportsTo === "0" ? 0 : positiveInt(ReportsTo);
      if (reportsTo === 0 && !actorIsAdmin) {
        return error(res, "Only an administrator can clear a manager", "FORBIDDEN", 403);
      }

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
        UserIp: UserIp ?? User_IP ?? "",
        AllowDay,
        FullName,
        Email,
        JobTitle,
        HourlyRate,
        GroupId: groupId,
        CompId: req.user.CompId,
        // A body branch is allowed: people module; a non-admin is limited to offices they can write.
        // Absent on edit = null = the SP keeps the current branch.
        BranchId: positiveInt(BranchId) ?? (isEdit ? null : req.user.BranchId),
        Mobile,
        ReportsTo: reportsTo,
        ActorUserId: req.user.UserId,
        // Always explicit: NULL makes sp_SaveUser treat the caller as a legacy admin
        // and skip its non-admin guard (assigning an admin role / editing an admin).
        ActorIsAdmin: actorIsAdmin ? 1 : 0,
      });

      const spResponse = firstRow(result);
      const ok = spOk(spResponse);
      let profileFail = null;

      // Shift and presence exemption live on their own proc (099). The user row is
      // already saved by now, so a failure here says so. Exemption is admin-only.
      if (ok && spResponse.UserId && (WorkCalendarId !== undefined || PresenceExempt !== undefined)) {
        const profile = firstRow(await database.executeStoredProcedure("sp_SetUserWorkProfile", {
          UserId: spResponse.UserId,
          CompId: req.user.CompId,
          WorkCalendarId: calendarId,
          PresenceExempt: actorIsAdmin && PresenceExempt !== undefined ? (PresenceExempt ? 1 : 0) : null,
        }));
        if (!spOk(profile)) profileFail = profile;
        else {
          // A new shift moves this person's due times: open clocks are re-derived on the next sweep.
          // Script 100 may not be applied yet, so a failure is logged and the save still succeeds.
          try {
            await database.executeStoredProcedure("sp_TatMarkStale", { CompId: req.user.CompId, TaskId: null, UserId: spResponse.UserId, Kind: "change" });
          } catch (err) { console.error("sp_TatMarkStale skipped:", err.message); }
        }
      }

      // Deactivation unassigns open tasks inside the SP and returns one row per
      // affected board (WorkspaceId, OwnerUserId, TaskCount) as a second result set.
      const unassigned = ok ? (result.recordsets?.[1] ?? []) : [];
      for (const r of unassigned) {
        emitToWorkspace(r.WorkspaceId, SCOPES.TASK_LIST, { workspaceId: r.WorkspaceId });
        emitToUser(r.OwnerUserId, SCOPES.NOTIFICATIONS, {});
      }

      if (ok && spResponse.UserId) {
        await logActivity({
          entityType: "User",
          entityId: spResponse.UserId,
          action: !isEdit ? ACTIONS.CREATED : ACTIONS.UPDATED,
          description:
            !isEdit
              ? `User ${Username} created`
              : `User ${Username} updated`,
          req,
        });
      }

      if (ok && isEdit && Password) {
        await logActivity({
          entityType: "User",
          entityId: spResponse.UserId ?? positiveInt(Id),
          action: ACTIONS.PASSWORD_RESET,
          description: `Password reset for ${Username}`,
          req,
        });
      }

      if (profileFail) {
        return res.status(spStatus(profileFail)).json({
          success: false,
          message: `Saved, but the shift could not be set: ${spMessage(profileFail)}`,
          responseCode: spStatus(profileFail),
          data: null,
          timestamp: new Date().toISOString(),
        });
      }

      return res.status(spStatus(spResponse)).json({
        success: ok,
        message: spMessage(spResponse),
        responseCode: spStatus(spResponse),
        data: ok
          ? {
              userId: spResponse.UserId,
              assignedGroupId: spResponse.AssignedGroupId,
              unassignedTasks: unassigned.reduce((n, r) => n + (r.TaskCount || 0), 0),
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

      const result = await database.executeStoredProcedure("sp_FetchUser", {
        Id,
        CompId: req.user.CompId,
        BranchId: req.user.BranchId, // ignored when IsAdmin=1; the SP has no default for it
        // The people picker is company-wide (spec §2.6); detail is stripped below.
        // The SP's own branch filter applies only when UseScope=0 and IsAdmin=0,
        // so IsAdmin: 1 with a null branch list is what makes it company-wide.
        IsAdmin: 1,
        AccessibleBranchIdsJson: null,
        PageNumber,
        PageSize,
        SearchTerm,
        // Without the sensitive permission, a search must not find people by email/mobile.
        SearchSensitive: req.access?.canSeeSensitive ? 1 : 0,
      });

      const spResponse = firstRow(result);
      const users = cleanSpRows(result.recordsets[0]).map((u) => ({
        ...stripSensitive(req.access, req.user.UserId, u),
        CanEdit: canEditPerson(req, u), // cheap checks only; save re-checks the roles
      }));

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
        IsAdmin: req.scope?.isAdmin ? 1 : 0,
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

  // What a user still holds (open tasks, leads, complaints, owned workspaces,
  // direct reports) so an admin can hand it over around deactivation.
  handover = asyncRoute(
    async (req, res) => {
      const Id = positiveInt(req.body.Id);
      if (!Id) return validationError(res, "User ID is required");
      const result = await database.executeStoredProcedure("sp_FetchUserHandover", {
        UserId: Id,
        CompId: req.user.CompId,
      });
      const head = firstRow(result);
      if (!spOk(head)) {
        return res.status(spStatus(head)).json({
          success: false,
          message: spMessage(head),
          responseCode: spStatus(head),
          timestamp: new Date().toISOString(),
        });
      }
      const { OpenTasks = 0, OpenLeads = 0, OpenTickets = 0, OwnedWorkspaces = 0, DirectReports = 0 } = head;
      return success(res, "Handover retrieved", {
        handover: {
          OpenTasks, OpenLeads, OpenTickets, OwnedWorkspaces, DirectReports,
          workspaces: cleanSpRows(result.recordsets?.[1] ?? []),
          reports: cleanSpRows(result.recordsets?.[2] ?? []),
        },
      });
    },
    "Failed to fetch handover",
    "USER_HANDOVER_ERROR",
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
      // Whose roster: the scope of the module being assigned in. Old clients send
      // no Module: leads if the caller can see leads, else complaints (support roles).
      const module = req.body?.Module ?? (scopeFor(req, "leads").can.view ? "leads" : "complaints");
      if (!["leads", "complaints"].includes(module)) {
        return validationError(res, "Module must be leads or complaints");
      }
      const s = scopeFor(req, module);
      if (!s.can.view) return error(res, "You do not have permission for this action", "INSUFFICIENT_ROLE", 403);
      const result = await database.executeStoredProcedure("sp_FetchAssignableUsers", {
        UserId: req.user.UserId,
        CompId: req.user.CompId,
        BranchId: positiveInt(req.body?.BranchId),
        AccessibleBranchIdsJson: scopeJson(s.branchIds),
        OwnerIdsJson: scopeJson(s.ownerIds),
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
