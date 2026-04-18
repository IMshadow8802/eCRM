const database = require("../config/database");
const { logActivity, ACTIONS } = require("../utils/activityLogger");
const { cleanSpRows } = require("../utils/spHelpers");

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
      });

      const spResponse = result.recordsets[0][0];
      const newWorkspaceId = spResponse.WorkspaceId;

      // Auto-seed kanban columns for non-personal workspaces on initial create.
      // Personal goes through sp_SeedDefaultWorkspace which already seeds.
      // This removes the silent-fail risk of a separate frontend apply-template
      // call and guarantees every workspace ships usable.
      let columnsSeeded = 0;
      if (
        Id === 0 &&
        spResponse.ResponseCode < 300 &&
        newWorkspaceId &&
        (Type === "shared" || Type === "project")
      ) {
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
