const path = require("path");
const fs = require("fs");
const database = require("../config/database");
const { logActivity, ACTIONS } = require("../utils/activityLogger");
const { cleanSpRows } = require("../utils/spHelpers");
const { UPLOAD_ROOT } = require("../middleware/upload");
const { emitToWorkspace, emitToUser } = require("../realtime/events");
const { SCOPES } = require("../realtime/contract");
const { validationError } = require("../utils/responseHelper");
const {
  asyncRoute,
  firstRow,
  spStatus,
  spOk,
  spMessage,
  pageParams,
  positiveInt,
} = require("../utils/controllerKit");

// Best-effort unlink — a missing file must never block the DB operation.
// (Same pattern as attachmentController.)
function unlinkQuiet(p) {
  fs.unlink(p, (err) => {
    if (err && err.code !== "ENOENT") {
      console.error("Workspace attachment unlink failed:", p, err.message);
    }
  });
}

class WorkspaceController {
  save = asyncRoute(
    async (req, res) => {
      const {
        Id = 0,
        Name,
        Type,
        TeamId = null,
        ProjectId = null,
        Color = null,
        Icon = null,
        TemplateKey = "basic",
        Members = [],
      } = req.body;

      const membersJson = Array.isArray(Members) && Members.length
        ? JSON.stringify(Members.map((m) => Number(m)).filter(Boolean))
        : null;

      const result = await database.executeStoredProcedure("sp_SaveWorkspace", {
        Id,
        Name,
        Type,
        OwnerUserId: req.user.UserId,
        TeamId,
        ProjectId,
        Color,
        Icon,
        MembersJson: membersJson,
        CompId: req.user.CompId,
        BranchId: req.user.BranchId,
        ActingUserId: req.user.UserId,
        IsAdmin: req.scope?.isAdmin ? 1 : 0,
      });

      // `?? {}` so a status-less result (an SP that RETURNed before its
      // SELECT) answers 500 via spStatus instead of throwing on undefined.
      const spResponse = firstRow(result) ?? {};
      const ok = spOk(spResponse);
      const status = spStatus(spResponse);
      const newWorkspaceId = spResponse.WorkspaceId;

      // Auto-seed kanban columns for every new workspace using the template
      // the caller picked. sp_SeedDefaultWorkspace still handles the first-
      // login auto-seed path; manual creates (any type, personal included)
      // always honour TemplateKey so the board ships usable.
      let columnsSeeded = 0;
      if (Id === 0 && ok && newWorkspaceId) {
        try {
          const tplResult = await database.executeStoredProcedure(
            "sp_ApplyKanbanTemplate",
            {
              WorkspaceId: newWorkspaceId,
              TemplateKey,
              CompId: req.user.CompId,
              BranchId: req.user.BranchId,
            },
          );
          columnsSeeded = firstRow(tplResult)?.ColumnsCreated ?? 0;
        } catch (tplErr) {
          console.error(
            "sp_ApplyKanbanTemplate failed for workspace",
            newWorkspaceId,
            tplErr.message,
          );
        }
      }

      if (ok && newWorkspaceId) {
        await logActivity({
          entityType: "Workspace",
          entityId: newWorkspaceId,
          action: Id === 0 ? ACTIONS.CREATED : ACTIONS.UPDATED,
          description: `Workspace ${Name || ""} ${Id === 0 ? "created" : "updated"}`,
          req,
        });

        // Update only — a freshly created workspace has no room yet.
        if (Id > 0) {
          emitToWorkspace(newWorkspaceId, SCOPES.WORKSPACES);
        }
      }

      return res.status(status).json({
        success: ok,
        message: spMessage(spResponse),
        responseCode: status,
        data: ok ? { workspaceId: newWorkspaceId, columnsSeeded } : null,
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to save workspace",
    "WORKSPACE_SAVE_ERROR",
  );

  fetch = asyncRoute(
    async (req, res) => {
      const {
        Id = 0,
        Type = null,
        IncludeArchived = false,
        SearchTerm = null,
      } = req.body;
      const { PageNumber, PageSize } = pageParams(req.body, 25);

      const result = await database.executeStoredProcedure("sp_FetchWorkspaces", {
        Id,
        UserId: req.user.UserId,
        CompId: req.user.CompId,
        // Workspaces are membership-governed, never branch-governed — a shared
        // board or project deliberately spans branches. Passing the caller's
        // own BranchId (or their accessible-branch list) as a gate hid every
        // cross-branch workspace from its own members: they still received the
        // tasks via sp_FetchTask but the board was missing from the switcher,
        // which also made a cross-branch invite impossible to accept. 061 drops
        // both from the SP's visibility rule; they stay in the signature only
        // so the call shape is unchanged.
        BranchId: null,
        IsAdmin: req.scope?.isAdmin ? 1 : 0,
        AccessibleBranchIdsJson: null,
        Type,
        IncludeArchived,
        PageNumber,
        PageSize,
        SearchTerm,
      });

      const spResponse = firstRow(result) ?? {};
      const status = spStatus(spResponse);
      const workspaces = cleanSpRows(result.recordsets[0]);

      return res.status(status).json({
        success: spOk(spResponse),
        message: spMessage(spResponse),
        responseCode: status,
        data: {
          workspaces,
          pagination: {
            currentPage: spResponse.CurrentPage,
            pageSize: spResponse.PageSize,
            totalRecords: spResponse.TotalRecords,
            totalPages: spResponse.TotalPages,
          },
        },
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to fetch workspaces",
    "WORKSPACE_FETCH_ERROR",
  );

  fetchMembers = asyncRoute(
    async (req, res) => {
      const { WorkspaceId } = req.body;
      if (!positiveInt(WorkspaceId)) {
        return validationError(res, "WorkspaceId is required");
      }

      const result = await database.executeStoredProcedure(
        "sp_FetchWorkspaceMembers",
        {
          WorkspaceId,
          ActingUserId: req.user.UserId,
          IsAdmin: req.scope?.isAdmin ? 1 : 0,
          CompId: req.user.CompId,
        },
      );

      // Status columns ride the data rows; a permission refusal comes back as
      // a single status-only row.
      const spResponse = firstRow(result) ?? {
        ResponseCode: 200,
        ResponseMess: "Members retrieved",
      };
      if (!spOk(spResponse)) {
        const status = spStatus(spResponse);
        return res.status(status).json({
          success: false,
          message: spMessage(spResponse),
          responseCode: status,
          timestamp: new Date().toISOString(),
        });
      }

      return res.status(200).json({
        success: true,
        message: spMessage(spResponse),
        responseCode: 200,
        data: { members: cleanSpRows(result.recordsets[0] || [], "UserId") },
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to fetch workspace members",
    "WORKSPACE_MEMBERS_ERROR",
  );

  // Change an existing member's role. Deliberately NOT sp_AddWorkspaceMember,
  // whose upsert branch also resets InviteStatus to 'pending' — demoting an
  // active member with it would knock them back to pending and (since 061) lock
  // them out of the board until they accepted again.
  setMemberRole = asyncRoute(
    async (req, res) => {
      const { WorkspaceId, UserId, Role } = req.body;

      if (!positiveInt(WorkspaceId) || !positiveInt(UserId) || !Role) {
        return validationError(res, "WorkspaceId, UserId and Role are required");
      }

      const result = await database.executeStoredProcedure(
        "sp_SetWorkspaceMemberRole",
        {
          WorkspaceId,
          UserId,
          Role,
          ActingUserId: req.user.UserId,
          IsAdmin: req.scope?.isAdmin ? 1 : 0,
          CompId: req.user.CompId,
        },
      );

      const spResponse = firstRow(result);
      const ok = spOk(spResponse);
      const status = spStatus(spResponse);

      if (ok) {
        await logActivity({
          entityType: "Workspace",
          entityId: WorkspaceId,
          action: ACTIONS.UPDATED,
          description: `Changed user ${UserId} to ${Role}`,
          req,
        });

        emitToWorkspace(WorkspaceId, SCOPES.WORKSPACE_MEMBERS, {
          workspaceId: WorkspaceId,
        });
        // Their own sidebar/permissions change, and they may not be in the
        // workspace room right now — ping their user room too.
        emitToUser(UserId, SCOPES.WORKSPACES);
      }

      return res.status(status).json({
        success: ok,
        message: spMessage(spResponse),
        responseCode: status,
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to change member role",
    "MEMBER_ROLE_ERROR",
  );

  addMember = asyncRoute(
    async (req, res) => {
      const { WorkspaceId, UserId, Role = "member" } = req.body;

      if (!positiveInt(WorkspaceId) || !positiveInt(UserId)) {
        return validationError(res, "WorkspaceId and UserId are required");
      }

      const result = await database.executeStoredProcedure(
        "sp_AddWorkspaceMember",
        {
          WorkspaceId,
          UserId,
          Role,
          ActingUserId: req.user.UserId,
          IsAdmin: req.scope?.isAdmin ? 1 : 0,
          CompId: req.user.CompId,
        },
      );

      const spResponse = firstRow(result);
      const ok = spOk(spResponse);
      const status = spStatus(spResponse);

      if (ok) {
        await logActivity({
          entityType: "Workspace",
          entityId: WorkspaceId,
          action: ACTIONS.ASSIGNED,
          description: `Added user ${UserId} as ${Role}`,
          req,
        });

        emitToWorkspace(WorkspaceId, SCOPES.WORKSPACE_MEMBERS, {
          workspaceId: WorkspaceId,
        });
        // The invitee isn't in the workspace room yet — target their user
        // room so their switcher list and bell update.
        emitToUser(UserId, SCOPES.WORKSPACES);
        emitToUser(UserId, SCOPES.NOTIFICATIONS);
      }

      return res.status(status).json({
        success: ok,
        message: spMessage(spResponse),
        responseCode: status,
        data: ok
          ? {
              workspaceId: spResponse.WorkspaceId,
              userId: spResponse.UserId,
              role: spResponse.Role,
            }
          : null,
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to add member",
    "WORKSPACE_MEMBER_ADD_ERROR",
  );

  removeMember = asyncRoute(
    async (req, res) => {
      const { WorkspaceId, UserId } = req.body;

      if (!positiveInt(WorkspaceId) || !positiveInt(UserId)) {
        return validationError(res, "WorkspaceId and UserId are required");
      }

      const result = await database.executeStoredProcedure(
        "sp_RemoveWorkspaceMember",
        {
          WorkspaceId,
          UserId,
          ActingUserId: req.user.UserId,
          IsAdmin: req.scope?.isAdmin ? 1 : 0,
          CompId: req.user.CompId,
        },
      );

      const spResponse = firstRow(result);
      const ok = spOk(spResponse);
      const status = spStatus(spResponse);

      if (ok) {
        await logActivity({
          entityType: "Workspace",
          entityId: WorkspaceId,
          action: ACTIONS.TRANSFERRED,
          description: `Removed user ${UserId}`,
          req,
        });

        emitToWorkspace(WorkspaceId, SCOPES.WORKSPACE_MEMBERS, {
          workspaceId: WorkspaceId,
        });
        // Leave/removal creates notifications for members.
        emitToWorkspace(WorkspaceId, SCOPES.NOTIFICATIONS);
        // The removed user loses the workspace — hit their user room.
        emitToUser(UserId, SCOPES.WORKSPACES);
        emitToUser(UserId, SCOPES.NOTIFICATIONS);
      }

      return res.status(status).json({
        success: ok,
        message: spMessage(spResponse),
        responseCode: status,
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to remove member",
    "WORKSPACE_MEMBER_REMOVE_ERROR",
  );

  applyTemplate = asyncRoute(
    async (req, res) => {
      const { WorkspaceId, TemplateKey = "basic" } = req.body;
      if (!positiveInt(WorkspaceId)) {
        return validationError(res, "WorkspaceId is required");
      }
      const result = await database.executeStoredProcedure(
        "sp_ApplyKanbanTemplate",
        {
          WorkspaceId,
          TemplateKey,
          CompId: req.user.CompId,
          BranchId: req.user.BranchId,
        },
      );
      const spResponse = firstRow(result);
      const ok = spOk(spResponse);
      const status = spStatus(spResponse);
      return res.status(status).json({
        success: ok,
        message: spMessage(spResponse),
        responseCode: status,
        data: ok
          ? {
              workspaceId: spResponse.WorkspaceId,
              templateKey: spResponse.TemplateKey,
              columnsCreated: spResponse.ColumnsCreated ?? 0,
            }
          : null,
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to apply template",
    "WORKSPACE_TEMPLATE_ERROR",
  );

  ensurePersonal = asyncRoute(
    async (req, res) => {
      const result = await database.executeStoredProcedure(
        "sp_SeedDefaultWorkspace",
        {
          UserId: req.user.UserId,
          CompId: req.user.CompId,
          BranchId: req.user.BranchId,
        },
      );
      const spResponse = firstRow(result);
      const ok = spOk(spResponse);
      const status = spStatus(spResponse);

      if (ok && spResponse.Seeded) {
        await logActivity({
          entityType: "Workspace",
          entityId: spResponse.WorkspaceId,
          action: ACTIONS.CREATED,
          description: "Personal workspace seeded on first login",
          req,
        });
      }

      return res.status(status).json({
        success: ok,
        message: spMessage(spResponse),
        responseCode: status,
        data: ok
          ? {
              workspaceId: spResponse.WorkspaceId,
              seeded: !!spResponse.Seeded,
            }
          : null,
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to ensure personal workspace",
    "WORKSPACE_SEED_ERROR",
  );

  archive = asyncRoute(
    async (req, res) => {
      const { WorkspaceId, IsArchived = true } = req.body;

      if (!positiveInt(WorkspaceId)) {
        return validationError(res, "WorkspaceId is required");
      }

      const result = await database.executeStoredProcedure(
        "sp_ArchiveWorkspace",
        {
          WorkspaceId,
          IsArchived: IsArchived ? 1 : 0,
          ActingUserId: req.user.UserId,
          IsAdmin: req.scope?.isAdmin ? 1 : 0,
          CompId: req.user.CompId,
        },
      );

      const spResponse = firstRow(result);
      const ok = spOk(spResponse);
      const status = spStatus(spResponse);

      if (ok) {
        await logActivity({
          entityType: "Workspace",
          entityId: WorkspaceId,
          action: IsArchived ? ACTIONS.DELETED : ACTIONS.UPDATED,
          description: IsArchived ? "Workspace archived" : "Workspace unarchived",
          req,
        });

        emitToWorkspace(WorkspaceId, SCOPES.WORKSPACES);
      }

      return res.status(status).json({
        success: ok,
        message: spMessage(spResponse),
        responseCode: status,
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to archive workspace",
    "WORKSPACE_ARCHIVE_ERROR",
  );

  // POST /convertWorkspaceToShared — one-way personal -> shared (owner-only,
  // enforced by the SP; controller just passes acting identity faithfully).
  convertToShared = asyncRoute(
    async (req, res) => {
      const { WorkspaceId, MemberIds } = req.body;

      if (!positiveInt(WorkspaceId)) {
        return validationError(res, "WorkspaceId is required");
      }

      const result = await database.executeStoredProcedure(
        "sp_ConvertWorkspaceToShared",
        {
          WorkspaceId,
          ActingUserId: req.user.UserId,
          MembersJson: JSON.stringify(MemberIds || []),
          CompId: req.user.CompId,
        },
      );

      const spResponse = firstRow(result);
      const ok = spOk(spResponse);
      const status = spStatus(spResponse);

      if (ok) {
        await logActivity({
          entityType: "Workspace",
          entityId: WorkspaceId,
          action: ACTIONS.UPDATED,
          description: "Workspace shared (personal -> shared)",
          req,
        });

        emitToWorkspace(WorkspaceId, SCOPES.WORKSPACES);
        emitToWorkspace(WorkspaceId, SCOPES.WORKSPACE_MEMBERS, {
          workspaceId: WorkspaceId,
        });
      }

      return res.status(status).json({
        success: ok,
        message: spMessage(spResponse),
        responseCode: status,
        data: ok ? { workspaceId: spResponse.WorkspaceId } : null,
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to share workspace",
    "WORKSPACE_CONVERT_ERROR",
  );

  // POST /deleteWorkspace — archived-only cascade delete. DryRun=1 returns the
  // blast-radius counts only (no writes, no unlink, no audit).
  delete = asyncRoute(
    async (req, res) => {
      const { WorkspaceId, DryRun } = req.body;

      if (!positiveInt(WorkspaceId)) {
        return validationError(res, "WorkspaceId is required");
      }

      const isDryRun = DryRun ? 1 : 0;
      const result = await database.executeStoredProcedure(
        "sp_DeleteWorkspace",
        {
          WorkspaceId,
          ActingUserId: req.user.UserId,
          IsAdmin: req.scope?.isAdmin ? 1 : 0,
          CompId: req.user.CompId,
          DryRun: isDryRun,
        },
      );

      const spResponse = firstRow(result) ?? {};
      const ok = spOk(spResponse);
      const status = spStatus(spResponse);
      const counts = {
        taskCount: spResponse.TaskCount ?? 0,
        commentCount: spResponse.CommentCount ?? 0,
        attachmentCount: spResponse.AttachmentCount ?? 0,
        memberCount: spResponse.MemberCount ?? 0,
      };

      if (ok && !isDryRun) {
        // Rows are gone (committed) — remove the files, best-effort. DB is the
        // source of truth; a missing file never fails the request.
        const files = result.recordsets[1] || [];
        files.forEach((f) =>
          unlinkQuiet(path.join(UPLOAD_ROOT, f.Entity, f.StoredName)),
        );

        await logActivity({
          entityType: "Workspace",
          entityId: WorkspaceId,
          action: ACTIONS.DELETED,
          description:
            `Workspace deleted (${counts.taskCount} tasks, ` +
            `${counts.commentCount} comments, ${counts.attachmentCount} attachments, ` +
            `${counts.memberCount} members)`,
          req,
        });

        // Real delete only — never on dry-run.
        emitToWorkspace(WorkspaceId, SCOPES.WORKSPACES);
      }

      return res.status(status).json({
        success: ok,
        message: spMessage(spResponse),
        responseCode: status,
        data: ok
          ? { workspaceId: spResponse.WorkspaceId, dryRun: !!isDryRun, ...counts }
          : null,
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to delete workspace",
    "WORKSPACE_DELETE_ERROR",
  );

  // POST /transferWorkspaceOwnership — shared/project only (SP-enforced).
  transferOwnership = asyncRoute(
    async (req, res) => {
      const { WorkspaceId, NewOwnerUserId } = req.body;

      if (!positiveInt(WorkspaceId) || !positiveInt(NewOwnerUserId)) {
        return validationError(
          res,
          "WorkspaceId and NewOwnerUserId are required",
        );
      }

      const result = await database.executeStoredProcedure(
        "sp_TransferWorkspaceOwnership",
        {
          WorkspaceId,
          NewOwnerUserId,
          ActingUserId: req.user.UserId,
          IsAdmin: req.scope?.isAdmin ? 1 : 0,
          CompId: req.user.CompId,
        },
      );

      const spResponse = firstRow(result);
      const ok = spOk(spResponse);
      const status = spStatus(spResponse);

      if (ok) {
        await logActivity({
          entityType: "Workspace",
          entityId: WorkspaceId,
          action: ACTIONS.UPDATED,
          description: `Ownership transferred to user ${NewOwnerUserId}`,
          req,
        });

        emitToWorkspace(WorkspaceId, SCOPES.WORKSPACES);
        emitToWorkspace(WorkspaceId, SCOPES.WORKSPACE_MEMBERS, {
          workspaceId: WorkspaceId,
        });
        // Transfer creates notifications for members.
        emitToWorkspace(WorkspaceId, SCOPES.NOTIFICATIONS);
      }

      return res.status(status).json({
        success: ok,
        message: spMessage(spResponse),
        responseCode: status,
        data: ok
          ? {
              workspaceId: spResponse.WorkspaceId,
              newOwnerUserId: spResponse.NewOwnerUserId,
            }
          : null,
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to transfer ownership",
    "WORKSPACE_TRANSFER_ERROR",
  );

  // POST /syncProjectWorkspaceMembers — explicit "sync from team" refresh.
  syncProjectMembers = asyncRoute(
    async (req, res) => {
      const { WorkspaceId } = req.body;

      if (!positiveInt(WorkspaceId)) {
        return validationError(res, "WorkspaceId is required");
      }

      const result = await database.executeStoredProcedure(
        "sp_SyncProjectWorkspaceMembers",
        {
          WorkspaceId,
          ActingUserId: req.user.UserId,
          IsAdmin: req.scope?.isAdmin ? 1 : 0,
          CompId: req.user.CompId,
        },
      );

      const spResponse = firstRow(result);
      const ok = spOk(spResponse);
      const status = spStatus(spResponse);

      if (ok) {
        await logActivity({
          entityType: "Workspace",
          entityId: WorkspaceId,
          action: ACTIONS.UPDATED,
          description:
            `Members synced from team ` +
            `(${spResponse.MembersAddedOrRestored ?? 0} added/restored, ` +
            `${spResponse.MembersDeactivated ?? 0} deactivated)`,
          req,
        });

        emitToWorkspace(WorkspaceId, SCOPES.WORKSPACE_MEMBERS, {
          workspaceId: WorkspaceId,
        });
        emitToWorkspace(WorkspaceId, SCOPES.WORKSPACES);
      }

      return res.status(status).json({
        success: ok,
        message: spMessage(spResponse),
        responseCode: status,
        data: ok
          ? {
              workspaceId: spResponse.WorkspaceId,
              membersAddedOrRestored: spResponse.MembersAddedOrRestored ?? 0,
              membersDeactivated: spResponse.MembersDeactivated ?? 0,
            }
          : null,
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to sync members",
    "WORKSPACE_SYNC_ERROR",
  );

  respondInvite = asyncRoute(
    async (req, res) => {
      const { WorkspaceId, Action } = req.body;

      if (!positiveInt(WorkspaceId) || !["accept", "decline"].includes(Action)) {
        return validationError(
          res,
          "WorkspaceId and Action (accept|decline) are required",
        );
      }

      const result = await database.executeStoredProcedure(
        "sp_RespondWorkspaceInvite",
        {
          WorkspaceId,
          UserId: req.user.UserId,
          Action,
          CompId: req.user.CompId,
        },
      );

      const spResponse = firstRow(result);
      const ok = spOk(spResponse);
      const status = spStatus(spResponse);

      if (ok) {
        await logActivity({
          entityType: "Workspace",
          entityId: WorkspaceId,
          action:
            Action === "accept" ? ACTIONS.ASSIGNED : ACTIONS.DELETED,
          description: `Invite ${Action}ed`,
          req,
        });

        emitToWorkspace(WorkspaceId, SCOPES.WORKSPACE_MEMBERS, {
          workspaceId: WorkspaceId,
        });
        // Responding creates notifications for members.
        emitToWorkspace(WorkspaceId, SCOPES.NOTIFICATIONS);
        // The responder's own switcher list and bell change too.
        emitToUser(req.user.UserId, SCOPES.WORKSPACES);
        emitToUser(req.user.UserId, SCOPES.NOTIFICATIONS);
      }

      return res.status(status).json({
        success: ok,
        message: spMessage(spResponse),
        responseCode: status,
        data: ok
          ? {
              workspaceId: spResponse.WorkspaceId,
              inviteStatus: spResponse.InviteStatus,
            }
          : null,
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to respond to invite",
    "WORKSPACE_INVITE_ERROR",
  );
}

module.exports = new WorkspaceController();
