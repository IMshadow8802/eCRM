const path = require("path");
const fs = require("fs");
const database = require("../config/database");
const { logActivity, ACTIONS } = require("../utils/activityLogger");
const { cleanSpRows } = require("../utils/spHelpers");
const { UPLOAD_ROOT } = require("../middleware/upload");
const { emitToWorkspace, emitToUser } = require("../realtime/events");
const { SCOPES } = require("../realtime/contract");

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
  async save(req, res) {
    try {
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
        IsAdmin: req.user.IsAdmin ? 1 : 0,
      });

      const spResponse = result.recordsets[0][0];
      const newWorkspaceId = spResponse.WorkspaceId;

      // Auto-seed kanban columns for every new workspace using the template
      // the caller picked. sp_SeedDefaultWorkspace still handles the first-
      // login auto-seed path; manual creates (any type, personal included)
      // always honour TemplateKey so the board ships usable.
      let columnsSeeded = 0;
      if (Id === 0 && spResponse.ResponseCode < 300 && newWorkspaceId) {
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
          columnsSeeded = tplResult.recordsets[0][0]?.ColumnsCreated ?? 0;
        } catch (tplErr) {
          console.error(
            "sp_ApplyKanbanTemplate failed for workspace",
            newWorkspaceId,
            tplErr.message,
          );
        }
      }

      if (spResponse.ResponseCode < 300 && newWorkspaceId) {
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

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode < 300,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        data:
          spResponse.ResponseCode < 300
            ? { workspaceId: newWorkspaceId, columnsSeeded }
            : null,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Save workspace error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to save workspace",
        code: "WORKSPACE_SAVE_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async fetch(req, res) {
    try {
      const {
        Id = 0,
        Type = null,
        IncludeArchived = false,
        PageNumber = 1,
        PageSize = 25,
        SearchTerm = null,
      } = req.body;

      const accessibleBranchIdsJson = req.scope?.branchIds?.length
        ? JSON.stringify(req.scope.branchIds)
        : null;

      const result = await database.executeStoredProcedure("sp_FetchWorkspaces", {
        Id,
        UserId: req.user.UserId,
        CompId: req.user.CompId,
        BranchId: req.user.BranchId,
        IsAdmin: req.user.IsAdmin,
        AccessibleBranchIdsJson: accessibleBranchIdsJson,
        Type,
        IncludeArchived,
        PageNumber,
        PageSize,
        SearchTerm,
      });

      const spResponse = result.recordsets[0][0];
      const workspaces = cleanSpRows(result.recordsets[0]);

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode === 200,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
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
    } catch (err) {
      console.error("Fetch workspaces error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch workspaces",
        code: "WORKSPACE_FETCH_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async fetchMembers(req, res) {
    try {
      const { WorkspaceId } = req.body;
      if (!WorkspaceId) {
        return res.status(400).json({
          success: false,
          message: "WorkspaceId is required",
          code: "VALIDATION_ERROR",
          responseCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      const result = await database.executeStoredProcedure(
        "sp_FetchWorkspaceMembers",
        {
          WorkspaceId,
          ActingUserId: req.user.UserId,
          IsAdmin: req.user.IsAdmin ? 1 : 0,
          CompId: req.user.CompId,
        },
      );

      // Status columns ride the data rows; a permission refusal comes back as
      // a single status-only row.
      const spResponse = result.recordsets[0]?.[0] ?? {
        ResponseCode: 200,
        ResponseMess: "Members retrieved",
      };
      if (spResponse.ResponseCode !== 200) {
        return res.status(spResponse.ResponseCode).json({
          success: false,
          message: spResponse.ResponseMess,
          responseCode: spResponse.ResponseCode,
          timestamp: new Date().toISOString(),
        });
      }

      return res.status(200).json({
        success: true,
        message: spResponse.ResponseMess,
        responseCode: 200,
        data: { members: cleanSpRows(result.recordsets[0] || [], "UserId") },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Fetch workspace members error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch workspace members",
        code: "WORKSPACE_MEMBERS_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async addMember(req, res) {
    try {
      const { WorkspaceId, UserId, Role = "member" } = req.body;

      if (!WorkspaceId || !UserId) {
        return res.status(400).json({
          success: false,
          message: "WorkspaceId and UserId are required",
          code: "VALIDATION_ERROR",
          responseCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      const result = await database.executeStoredProcedure(
        "sp_AddWorkspaceMember",
        {
          WorkspaceId,
          UserId,
          Role,
          ActingUserId: req.user.UserId,
          IsAdmin: req.user.IsAdmin,
          CompId: req.user.CompId,
        },
      );

      const spResponse = result.recordsets[0][0];

      if (spResponse.ResponseCode < 300) {
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

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode < 300,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        data:
          spResponse.ResponseCode < 300
            ? {
                workspaceId: spResponse.WorkspaceId,
                userId: spResponse.UserId,
                role: spResponse.Role,
              }
            : null,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Add workspace member error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to add member",
        code: "WORKSPACE_MEMBER_ADD_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async removeMember(req, res) {
    try {
      const { WorkspaceId, UserId } = req.body;

      if (!WorkspaceId || !UserId) {
        return res.status(400).json({
          success: false,
          message: "WorkspaceId and UserId are required",
          code: "VALIDATION_ERROR",
          responseCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      const result = await database.executeStoredProcedure(
        "sp_RemoveWorkspaceMember",
        {
          WorkspaceId,
          UserId,
          ActingUserId: req.user.UserId,
          IsAdmin: req.user.IsAdmin,
          CompId: req.user.CompId,
        },
      );

      const spResponse = result.recordsets[0][0];

      if (spResponse.ResponseCode === 200) {
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

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode === 200,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Remove workspace member error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to remove member",
        code: "WORKSPACE_MEMBER_REMOVE_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async applyTemplate(req, res) {
    try {
      const { WorkspaceId, TemplateKey = "basic" } = req.body;
      if (!WorkspaceId) {
        return res.status(400).json({
          success: false,
          message: "WorkspaceId is required",
          code: "VALIDATION_ERROR",
          responseCode: 400,
          timestamp: new Date().toISOString(),
        });
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
      const spResponse = result.recordsets[0][0];
      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode < 300,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        data:
          spResponse.ResponseCode < 300
            ? {
                workspaceId: spResponse.WorkspaceId,
                templateKey: spResponse.TemplateKey,
                columnsCreated: spResponse.ColumnsCreated ?? 0,
              }
            : null,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Apply template error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to apply template",
        code: "WORKSPACE_TEMPLATE_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async ensurePersonal(req, res) {
    try {
      const result = await database.executeStoredProcedure(
        "sp_SeedDefaultWorkspace",
        {
          UserId: req.user.UserId,
          CompId: req.user.CompId,
          BranchId: req.user.BranchId,
        },
      );
      const spResponse = result.recordsets[0][0];

      if (spResponse.ResponseCode < 300 && spResponse.Seeded) {
        await logActivity({
          entityType: "Workspace",
          entityId: spResponse.WorkspaceId,
          action: ACTIONS.CREATED,
          description: "Personal workspace seeded on first login",
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
                workspaceId: spResponse.WorkspaceId,
                seeded: !!spResponse.Seeded,
              }
            : null,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Ensure personal workspace error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to ensure personal workspace",
        code: "WORKSPACE_SEED_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async archive(req, res) {
    try {
      const { WorkspaceId, IsArchived = true } = req.body;

      if (!WorkspaceId) {
        return res.status(400).json({
          success: false,
          message: "WorkspaceId is required",
          code: "VALIDATION_ERROR",
          responseCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      const result = await database.executeStoredProcedure(
        "sp_ArchiveWorkspace",
        {
          WorkspaceId,
          IsArchived: IsArchived ? 1 : 0,
          ActingUserId: req.user.UserId,
          IsAdmin: req.user.IsAdmin,
          CompId: req.user.CompId,
        },
      );

      const spResponse = result.recordsets[0][0];

      if (spResponse.ResponseCode === 200) {
        await logActivity({
          entityType: "Workspace",
          entityId: WorkspaceId,
          action: IsArchived ? ACTIONS.DELETED : ACTIONS.UPDATED,
          description: IsArchived ? "Workspace archived" : "Workspace unarchived",
          req,
        });

        emitToWorkspace(WorkspaceId, SCOPES.WORKSPACES);
      }

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode === 200,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Archive workspace error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to archive workspace",
        code: "WORKSPACE_ARCHIVE_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // POST /convertWorkspaceToShared — one-way personal -> shared (owner-only,
  // enforced by the SP; controller just passes acting identity faithfully).
  async convertToShared(req, res) {
    try {
      const { WorkspaceId, MemberIds } = req.body;

      if (!WorkspaceId) {
        return res.status(400).json({
          success: false,
          message: "WorkspaceId is required",
          code: "VALIDATION_ERROR",
          responseCode: 400,
          timestamp: new Date().toISOString(),
        });
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

      const spResponse = result.recordsets[0][0];

      if (spResponse.ResponseCode === 200) {
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

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode === 200,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        data:
          spResponse.ResponseCode === 200
            ? { workspaceId: spResponse.WorkspaceId }
            : null,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Convert workspace error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to share workspace",
        code: "WORKSPACE_CONVERT_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // POST /deleteWorkspace — archived-only cascade delete. DryRun=1 returns the
  // blast-radius counts only (no writes, no unlink, no audit).
  async delete(req, res) {
    try {
      const { WorkspaceId, DryRun } = req.body;

      if (!WorkspaceId) {
        return res.status(400).json({
          success: false,
          message: "WorkspaceId is required",
          code: "VALIDATION_ERROR",
          responseCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      const isDryRun = DryRun ? 1 : 0;
      const result = await database.executeStoredProcedure(
        "sp_DeleteWorkspace",
        {
          WorkspaceId,
          ActingUserId: req.user.UserId,
          IsAdmin: req.user.IsAdmin ? 1 : 0,
          CompId: req.user.CompId,
          DryRun: isDryRun,
        },
      );

      const spResponse = result.recordsets[0][0];
      const counts = {
        taskCount: spResponse.TaskCount ?? 0,
        commentCount: spResponse.CommentCount ?? 0,
        attachmentCount: spResponse.AttachmentCount ?? 0,
        memberCount: spResponse.MemberCount ?? 0,
      };

      if (spResponse.ResponseCode === 200 && !isDryRun) {
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

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode === 200,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        data:
          spResponse.ResponseCode === 200
            ? { workspaceId: spResponse.WorkspaceId, dryRun: !!isDryRun, ...counts }
            : null,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Delete workspace error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to delete workspace",
        code: "WORKSPACE_DELETE_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // POST /transferWorkspaceOwnership — shared/project only (SP-enforced).
  async transferOwnership(req, res) {
    try {
      const { WorkspaceId, NewOwnerUserId } = req.body;

      if (!WorkspaceId || !NewOwnerUserId) {
        return res.status(400).json({
          success: false,
          message: "WorkspaceId and NewOwnerUserId are required",
          code: "VALIDATION_ERROR",
          responseCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      const result = await database.executeStoredProcedure(
        "sp_TransferWorkspaceOwnership",
        {
          WorkspaceId,
          NewOwnerUserId,
          ActingUserId: req.user.UserId,
          IsAdmin: req.user.IsAdmin ? 1 : 0,
          CompId: req.user.CompId,
        },
      );

      const spResponse = result.recordsets[0][0];

      if (spResponse.ResponseCode === 200) {
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

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode === 200,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        data:
          spResponse.ResponseCode === 200
            ? {
                workspaceId: spResponse.WorkspaceId,
                newOwnerUserId: spResponse.NewOwnerUserId,
              }
            : null,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Transfer ownership error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to transfer ownership",
        code: "WORKSPACE_TRANSFER_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // POST /syncProjectWorkspaceMembers — explicit "sync from team" refresh.
  async syncProjectMembers(req, res) {
    try {
      const { WorkspaceId } = req.body;

      if (!WorkspaceId) {
        return res.status(400).json({
          success: false,
          message: "WorkspaceId is required",
          code: "VALIDATION_ERROR",
          responseCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      const result = await database.executeStoredProcedure(
        "sp_SyncProjectWorkspaceMembers",
        {
          WorkspaceId,
          ActingUserId: req.user.UserId,
          IsAdmin: req.user.IsAdmin ? 1 : 0,
          CompId: req.user.CompId,
        },
      );

      const spResponse = result.recordsets[0][0];

      if (spResponse.ResponseCode === 200) {
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

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode === 200,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        data:
          spResponse.ResponseCode === 200
            ? {
                workspaceId: spResponse.WorkspaceId,
                membersAddedOrRestored: spResponse.MembersAddedOrRestored ?? 0,
                membersDeactivated: spResponse.MembersDeactivated ?? 0,
              }
            : null,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Sync project members error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to sync members",
        code: "WORKSPACE_SYNC_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async respondInvite(req, res) {
    try {
      const { WorkspaceId, Action } = req.body;

      if (!WorkspaceId || !Action || !["accept", "decline"].includes(Action)) {
        return res.status(400).json({
          success: false,
          message: "WorkspaceId and Action (accept|decline) are required",
          code: "VALIDATION_ERROR",
          responseCode: 400,
          timestamp: new Date().toISOString(),
        });
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

      const spResponse = result.recordsets[0][0];

      if (spResponse.ResponseCode === 200) {
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

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode === 200,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        data:
          spResponse.ResponseCode === 200
            ? {
                workspaceId: spResponse.WorkspaceId,
                inviteStatus: spResponse.InviteStatus,
              }
            : null,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Respond invite error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to respond to invite",
        code: "WORKSPACE_INVITE_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }
}

module.exports = new WorkspaceController();
