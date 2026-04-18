const database = require("../config/database");
const { logActivity, ACTIONS } = require("../utils/activityLogger");
const { cleanSpRows } = require("../utils/spHelpers");

class TaskController {
  // ================================
  // MAIN TASK OPERATIONS
  // ================================

  async save(req, res) {
    try {
      const {
        Id = 0,
        Title,
        Description,
        WorkspaceId = null,
        ProjectId = null,
        ParentTaskId,
        AssignedToUserId,
        TeamId,
        Priority = "medium",
        Type = "task",
        Status = "todo",
        DueDate,
        EstimatedHours = 0,
        LoggedHours = 0,
        Progress = 0,
        IsBlocked = false,
        Labels,
        Watchers,
      } = req.body;

      const result = await database.executeStoredProcedure("sp_SaveTask", {
        Id,
        Title,
        Description,
        WorkspaceId,
        ProjectId,
        ParentTaskId,
        AssignedToUserId,
        CreatedByUserId: req.user.UserId,
        TeamId,
        Priority,
        Type,
        Status,
        DueDate,
        EstimatedHours,
        LoggedHours,
        Progress,
        IsBlocked,
        Labels: typeof Labels === "object" ? JSON.stringify(Labels) : Labels,
        Watchers:
          typeof Watchers === "object" ? JSON.stringify(Watchers) : Watchers,
        IsAdmin: req.user.IsAdmin ? 1 : 0,
        CompId: req.user.CompId,
        BranchId: req.user.BranchId,
      });

      const spResponse = result.recordsets[0][0];

      if (spResponse.ResponseCode < 300 && spResponse.TaskId) {
        await logActivity({
          entityType: "Task",
          entityId: spResponse.TaskId,
          action: Id === 0 ? ACTIONS.CREATED : ACTIONS.UPDATED,
          description: `Task ${Title || ""} ${Id === 0 ? "created" : "updated"}`,
          req,
        });

        if (AssignedToUserId && AssignedToUserId !== req.user.UserId) {
          database
            .executeStoredProcedure("sp_NotifyTaskAssigned", {
              TaskId: spResponse.TaskId,
              ActorUserId: req.user.UserId,
            })
            .catch((e) => console.error("sp_NotifyTaskAssigned failed:", e.message));
        }
      }

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode < 300,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        data:
          spResponse.ResponseCode < 300 ? { taskId: spResponse.TaskId } : null,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Save task error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to save task",
        code: "TASK_SAVE_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async fetch(req, res) {
    try {
      const {
        Id = 0,
        WorkspaceId = null,
        ProjectId = null,
        PageNumber = 1,
        PageSize = 25,
        SearchTerm = null,
      } = req.body;

      const accessibleBranchIdsJson = req.scope?.branchIds?.length
        ? JSON.stringify(req.scope.branchIds)
        : null;

      const result = await database.executeStoredProcedure("sp_FetchTask", {
        Id,
        WorkspaceId,
        ProjectId,
        UserId: req.user.UserId,
        CompId: req.user.CompId,
        BranchId: req.user.BranchId,
        IsAdmin: req.user.IsAdmin ? 1 : 0,
        AccessibleBranchIdsJson: accessibleBranchIdsJson,
        PageNumber,
        PageSize,
        SearchTerm,
      });

      const spResponse = result.recordsets[0][0];
      
      const tasks = cleanSpRows(result.recordsets[0]);

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode === 200,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        data: {
          tasks: tasks,
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
      console.error("Fetch task error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch tasks",
        code: "TASK_FETCH_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async delete(req, res) {
    try {
      const { Id } = req.body;

      if (!Id || Id <= 0) {
        return res.status(400).json({
          success: false,
          message: "Task ID is required",
          code: "VALIDATION_ERROR",
          responseCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      const result = await database.executeStoredProcedure("sp_DeleteTask", {
        Id,
        UserId: req.user.UserId,
        CompId: req.user.CompId,
        BranchId: req.user.BranchId,
        IsAdmin: req.user.IsAdmin,
      });

      const spResponse = result.recordsets[0][0];

      if (spResponse.ResponseCode === 200) {
        await logActivity({
          entityType: "Task",
          entityId: Id,
          action: ACTIONS.DELETED,
          description: "Task deleted",
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
      console.error("Delete task error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to delete task",
        code: "TASK_DELETE_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async bulkDelete(req, res) {
    try {
      const { TaskIds } = req.body;

      if (!TaskIds || TaskIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Task IDs are required",
          code: "VALIDATION_ERROR",
          responseCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      const taskIdsString = Array.isArray(TaskIds)
        ? TaskIds.join(",")
        : TaskIds;

      const result = await database.executeStoredProcedure(
        "sp_BulkDeleteTasks",
        {
          TaskIds: taskIdsString,
          UserId: req.user.UserId,
          CompId: req.user.CompId,
          BranchId: req.user.BranchId,
          IsAdmin: req.user.IsAdmin,
        }
      );

      const spResponse = result.recordsets[0][0];

      if (spResponse.ResponseCode === 200) {
        const ids = Array.isArray(TaskIds)
          ? TaskIds
          : String(TaskIds).split(",").map((s) => Number(s.trim())).filter(Boolean);
        await Promise.all(
          ids.map((id) =>
            logActivity({
              entityType: "Task",
              entityId: id,
              action: ACTIONS.DELETED,
              description: "Task bulk-deleted",
              req,
            })
          )
        );
      }

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode === 200,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        data:
          spResponse.ResponseCode === 200
            ? {
                deletedCount: spResponse.DeletedCount,
                failedCount: spResponse.FailedCount,
              }
            : null,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Bulk delete tasks error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to bulk delete tasks",
        code: "BULK_DELETE_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // ================================
  // TASK COMMENTS
  // ================================

  async addComment(req, res) {
    try {
      const { Id = 0, TaskId, Comment, ParentCommentId = null } = req.body;

      const result = await database.executeStoredProcedure(
        "sp_SaveTaskComment",
        {
          Id,
          TaskId,
          UserId: req.user.UserId,
          Comment,
          ParentCommentId,
          IsAdmin: req.user.IsAdmin ? 1 : 0,
          CompId: req.user.CompId,
          BranchId: req.user.BranchId,
        }
      );

      const spResponse = result.recordsets[0][0];

      if (spResponse.ResponseCode < 300 && spResponse.CommentId) {
        await logActivity({
          entityType: "Task",
          entityId: TaskId,
          action: ACTIONS.COMMENTED,
          description: Id === 0 ? "Comment added" : "Comment edited",
          req,
        });

        if (Id === 0) {
          database
            .executeStoredProcedure("sp_NotifyCommentAdded", {
              CommentId: spResponse.CommentId,
              ActorUserId: req.user.UserId,
            })
            .catch((e) => console.error("sp_NotifyCommentAdded failed:", e.message));
        }
      }

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode < 300,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        data:
          spResponse.ResponseCode < 300
            ? { commentId: spResponse.CommentId }
            : null,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Add comment error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to add comment",
        code: "COMMENT_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async getComments(req, res) {
    try {
      const { TaskId, PageNumber = 1, PageSize = 25 } = req.body;

      const result = await database.executeStoredProcedure(
        "sp_FetchTaskComment",
        {
          Id: 0,
          TaskId,
          UserId: req.user.UserId,
          CompId: req.user.CompId,
          BranchId: req.user.BranchId,
          PageNumber,
          PageSize,
        }
      );

      const spResponse = result.recordsets[0][0];

      const comments = cleanSpRows(result.recordsets[0]);

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode === 200,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        data: {
          comments: comments,
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
      console.error("Get comments error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to get comments",
        code: "COMMENTS_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async deleteComment(req, res) {
    try {
      const { Id } = req.body;

      if (!Id || Id <= 0) {
        return res.status(400).json({
          success: false,
          message: "Comment ID is required",
          code: "VALIDATION_ERROR",
          responseCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      const result = await database.executeStoredProcedure(
        "sp_DeleteTaskComment",
        {
          Id,
          UserId: req.user.UserId,
          IsAdmin: req.user.IsAdmin ? 1 : 0,
          CompId: req.user.CompId,
          BranchId: req.user.BranchId,
        }
      );

      const spResponse = result.recordsets[0][0];

      if (spResponse.ResponseCode === 200) {
        await logActivity({
          entityType: "TaskComment",
          entityId: Id,
          action: ACTIONS.DELETED,
          description: "Comment deleted",
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
      console.error("Delete comment error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to delete comment",
        code: "COMMENT_DELETE_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // ================================
  // TIME TRACKING
  // ================================

  async logTime(req, res) {
    try {
      const { TaskId, Hours, Description, WorkDate } = req.body;

      const result = await database.executeStoredProcedure("sp_SaveTimeEntry", {
        Id: 0,
        TaskId,
        UserId: req.user.UserId,
        Hours,
        Description,
        WorkDate: WorkDate || new Date().toISOString().split("T")[0],
        CompId: req.user.CompId,
        BranchId: req.user.BranchId,
      });

      const spResponse = result.recordsets[0][0];

      if (spResponse.ResponseCode < 300) {
        await logActivity({
          entityType: "Task",
          entityId: TaskId,
          action: ACTIONS.UPDATED,
          fieldName: "TimeEntry",
          newValue: `${Hours}h`,
          description: `Logged ${Hours} hours`,
          req,
        });
      }

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode < 300,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        data:
          spResponse.ResponseCode < 300
            ? { timeEntryId: spResponse.TimeEntryId }
            : null,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Log time error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to log time",
        code: "TIME_LOG_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async getTimeEntries(req, res) {
    try {
      const {
        TaskId = null,
        UserId = null,
        PageNumber = 1,
        PageSize = 20,
      } = req.body;

      const result = await database.executeStoredProcedure(
        "sp_FetchTimeEntry",
        {
          Id: 0,
          TaskId,
          UserId: UserId || (req.user.IsAdmin ? null : req.user.UserId),
          CompId: req.user.CompId,
          BranchId: req.user.BranchId,
          PageNumber,
          PageSize,
        }
      );

      const spResponse = result.recordsets[0][0];

      const timeEntries = cleanSpRows(result.recordsets[0]);

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode === 200,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        data: {
          timeEntries: timeEntries,
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
      console.error("Get time entries error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to get time entries",
        code: "TIME_ENTRIES_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async deleteTimeEntry(req, res) {
    try {
      const { Id } = req.body;

      if (!Id || Id <= 0) {
        return res.status(400).json({
          success: false,
          message: "Time entry ID is required",
          code: "VALIDATION_ERROR",
          responseCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      const result = await database.executeStoredProcedure(
        "sp_DeleteTimeEntry",
        {
          Id,
          UserId: req.user.UserId,
          CompId: req.user.CompId,
          BranchId: req.user.BranchId,
          IsAdmin: req.user.IsAdmin,
        }
      );

      const spResponse = result.recordsets[0][0];

      if (spResponse.ResponseCode === 200) {
        await logActivity({
          entityType: "TimeEntry",
          entityId: Id,
          action: ACTIONS.DELETED,
          description: "Time entry deleted",
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
      console.error("Delete time entry error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to delete time entry",
        code: "TIME_ENTRY_DELETE_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // ================================
  // CHECKLIST
  // ================================

  async saveChecklist(req, res) {
    try {
      const {
        Id = 0,
        TaskId,
        ItemText,
        IsCompleted = false,
        SortOrder = 0,
        CompId,
        BranchId,
      } = req.body;

      const result = await database.executeStoredProcedure(
        "sp_SaveTaskChecklist",
        {
          Id,
          TaskId,
          ItemText,
          IsCompleted,
          SortOrder,
          CompId: CompId || req.user.CompId,
          BranchId: BranchId || req.user.BranchId,
        }
      );

      const spResponse = result.recordsets[0][0];

      if (spResponse.ResponseCode < 300) {
        await logActivity({
          entityType: "Task",
          entityId: TaskId,
          action: Id === 0 ? ACTIONS.CREATED : ACTIONS.UPDATED,
          fieldName: "Checklist",
          newValue: ItemText,
          description:
            Id === 0
              ? `Checklist item added: ${ItemText}`
              : `Checklist item updated`,
          req,
        });
      }

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode < 300,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        data:
          spResponse.ResponseCode < 300
            ? { checklistId: spResponse.ChecklistId }
            : null,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Save checklist error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to save checklist item",
        code: "CHECKLIST_SAVE_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async getChecklist(req, res) {
    try {
      const { Id = 0, TaskId, PageNumber = 1, PageSize = 50 } = req.body;

      const result = await database.executeStoredProcedure(
        "sp_FetchTaskChecklist",
        {
          Id,
          TaskId,
          CompId: req.user.CompId,
          BranchId: req.user.BranchId,
          PageNumber,
          PageSize,
        }
      );

      const spResponse = result.recordsets[0][0];

      const checklist = cleanSpRows(result.recordsets[0]);

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode === 200,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        data: {
          checklist: checklist,
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
      console.error("Fetch checklist error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch checklist",
        code: "CHECKLIST_FETCH_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async deleteChecklist(req, res) {
    try {
      const { Id } = req.body;

      if (!Id || Id <= 0) {
        return res.status(400).json({
          success: false,
          message: "Checklist item ID is required",
          code: "VALIDATION_ERROR",
          responseCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      const result = await database.executeStoredProcedure(
        "sp_DeleteTaskChecklist",
        {
          Id,
          CompId: req.user.CompId,
          BranchId: req.user.BranchId,
        }
      );

      const spResponse = result.recordsets[0][0];

      if (spResponse.ResponseCode === 200) {
        await logActivity({
          entityType: "TaskChecklist",
          entityId: Id,
          action: ACTIONS.DELETED,
          description: "Checklist item deleted",
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
      console.error("Delete checklist item error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to delete checklist item",
        code: "CHECKLIST_DELETE_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // ================================
  // COMMENT EXTRAS (pin, mark-read)
  // ================================

  async pinComment(req, res) {
    try {
      const { CommentId, IsPinned = true } = req.body;
      if (!CommentId) {
        return res.status(400).json({
          success: false,
          message: "CommentId is required",
          code: "VALIDATION_ERROR",
          responseCode: 400,
          timestamp: new Date().toISOString(),
        });
      }

      const result = await database.executeStoredProcedure(
        "sp_PinTaskComment",
        {
          CommentId,
          IsPinned: IsPinned ? 1 : 0,
          UserId: req.user.UserId,
          IsAdmin: req.user.IsAdmin ? 1 : 0,
          CompId: req.user.CompId,
        }
      );
      const spResponse = result.recordsets[0][0];

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode === 200,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Pin comment error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to pin comment",
        code: "COMMENT_PIN_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async markCommentRead(req, res) {
    try {
      const { CommentId } = req.body;
      if (!CommentId) {
        return res.status(400).json({
          success: false,
          message: "CommentId is required",
          code: "VALIDATION_ERROR",
          responseCode: 400,
          timestamp: new Date().toISOString(),
        });
      }
      const result = await database.executeStoredProcedure(
        "sp_MarkCommentRead",
        { CommentId, UserId: req.user.UserId }
      );
      const spResponse = result.recordsets[0][0];
      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode === 200,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Mark comment read error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to mark comment read",
        code: "COMMENT_READ_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // ================================
  // DEPENDENCIES
  // ================================

  async addDependency(req, res) {
    try {
      const { TaskId, DependsOnTaskId, Type = "blocks" } = req.body;
      if (!TaskId || !DependsOnTaskId) {
        return res.status(400).json({
          success: false,
          message: "TaskId and DependsOnTaskId are required",
          code: "VALIDATION_ERROR",
          responseCode: 400,
          timestamp: new Date().toISOString(),
        });
      }
      const result = await database.executeStoredProcedure(
        "sp_AddTaskDependency",
        {
          TaskId,
          DependsOnTaskId,
          Type,
          ActingUserId: req.user.UserId,
          IsAdmin: req.user.IsAdmin ? 1 : 0,
          CompId: req.user.CompId,
        }
      );
      const spResponse = result.recordsets[0][0];

      if (spResponse.ResponseCode < 300) {
        await logActivity({
          entityType: "Task",
          entityId: TaskId,
          action: ACTIONS.UPDATED,
          fieldName: "Dependency",
          newValue: `blocked by task ${DependsOnTaskId}`,
          description: `Dependency added`,
          req,
        });
      }

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode < 300,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Add dependency error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to add dependency",
        code: "DEPENDENCY_ADD_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async removeDependency(req, res) {
    try {
      const { TaskId, DependsOnTaskId } = req.body;
      if (!TaskId || !DependsOnTaskId) {
        return res.status(400).json({
          success: false,
          message: "TaskId and DependsOnTaskId are required",
          code: "VALIDATION_ERROR",
          responseCode: 400,
          timestamp: new Date().toISOString(),
        });
      }
      const result = await database.executeStoredProcedure(
        "sp_RemoveTaskDependency",
        {
          TaskId,
          DependsOnTaskId,
          ActingUserId: req.user.UserId,
          IsAdmin: req.user.IsAdmin ? 1 : 0,
          CompId: req.user.CompId,
        }
      );
      const spResponse = result.recordsets[0][0];

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode === 200,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Remove dependency error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to remove dependency",
        code: "DEPENDENCY_REMOVE_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async fetchDependencies(req, res) {
    try {
      const { TaskId } = req.body;
      if (!TaskId) {
        return res.status(400).json({
          success: false,
          message: "TaskId is required",
          code: "VALIDATION_ERROR",
          responseCode: 400,
          timestamp: new Date().toISOString(),
        });
      }
      const result = await database.executeStoredProcedure(
        "sp_FetchTaskDependencies",
        {
          TaskId,
          UserId: req.user.UserId,
          IsAdmin: req.user.IsAdmin ? 1 : 0,
          CompId: req.user.CompId,
        }
      );
      const spResponse = result.recordsets[0][0];
      const rows = cleanSpRows(result.recordsets[0], "TaskId");
      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode === 200,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        data: {
          blockers: rows.filter((r) => r.Direction === "blocker"),
          dependents: rows.filter((r) => r.Direction === "dependent"),
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Fetch dependencies error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch dependencies",
        code: "DEPENDENCY_FETCH_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // ================================
  // ACTIVITY
  // ================================

  async getActivity(req, res) {
    try {
      const { TaskId, PageNumber = 1, PageSize = 50 } = req.body;

      const result = await database.executeStoredProcedure(
        "sp_FetchTaskActivity",
        {
          Id: 0,
          TaskId,
          UserId: null,
          CompId: req.user.CompId,
          BranchId: req.user.BranchId,
          PageNumber,
          PageSize,
        }
      );

      const spResponse = result.recordsets[0][0];

      const activities = cleanSpRows(result.recordsets[0]);

      return res.status(spResponse.ResponseCode).json({
        success: spResponse.ResponseCode === 200,
        message: spResponse.ResponseMess,
        responseCode: spResponse.ResponseCode,
        data: {
          activities: activities,
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
      console.error("Get activity error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to get task activity",
        code: "ACTIVITY_ERROR",
        responseCode: 500,
        timestamp: new Date().toISOString(),
      });
    }
  }
}

module.exports = new TaskController();
