const database = require("../config/database");
const { logActivity, ACTIONS } = require("../utils/activityLogger");
const { cleanSpRows } = require("../utils/spHelpers");
const attachmentController = require("./attachmentController");
const { emitToWorkspace, emitToUser } = require("../realtime/events");
const { SCOPES } = require("../realtime/contract");
const { assertRecordAccess, scopeJson } = require("../middleware/permission");
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

class TaskController {
  // ================================
  // MAIN TASK OPERATIONS
  // ================================

  save = asyncRoute(
    async (req, res) => {
      const {
        Id = 0,
        Title,
        Description,
        WorkspaceId = null,
        ColumnId = null,
        ProjectId = null,
        ParentTaskId,
        // AssigneeIds is the real input — an array of user ids.
        // AssignedToUserId stays accepted as a legacy single-assignee alias so
        // older clients keep working; sp_SaveTask treats it as a 1-element set.
        AssigneeIds,
        AssignedToUserId,
        TeamId,
        Priority = "medium",
        Type = "task",
        DueDate,
        EstimatedHours = 0,
        LoggedHours = 0,
        Progress = 0,
        IsBlocked = false,
        Labels,
        Watchers,
        ChecklistItems,
      } = req.body;

      let checklistItemsJson = null;
      if (Id === 0 || !Id) {
        const items = Array.isArray(ChecklistItems)
          ? ChecklistItems
              .map((it) =>
                typeof it === "string" ? it : it?.ItemText ?? it?.text ?? "",
              )
              .map((s) => (s == null ? "" : String(s).trim()))
              .filter((s) => s.length > 0)
          : [];
        checklistItemsJson = items.length ? JSON.stringify(items) : null;
      }

      const result = await database.executeStoredProcedure("sp_SaveTask", {
        Id,
        Title,
        Description,
        WorkspaceId,
        ColumnId,
        ProjectId,
        ParentTaskId,
        AssignedToUserId,
        // null (not '[]') means "no opinion, leave assignees alone" — the
        // drag-and-drop path re-sends the whole task without assignee fields,
        // and must not unassign everyone.
        AssigneeIdsJson: Array.isArray(AssigneeIds)
          ? JSON.stringify(AssigneeIds.map(Number).filter((n) => n > 0))
          : null,
        CreatedByUserId: req.user.UserId,
        TeamId,
        Priority,
        Type,
        DueDate,
        EstimatedHours,
        LoggedHours,
        Progress,
        IsBlocked,
        Labels: typeof Labels === "object" ? JSON.stringify(Labels) : Labels,
        Watchers:
          typeof Watchers === "object" ? JSON.stringify(Watchers) : Watchers,
        ChecklistItemsJson: checklistItemsJson,
        IsAdmin: req.scope?.isAdmin ? 1 : 0,
        CompId: req.user.CompId,
        BranchId: req.user.BranchId,
      });

      const spResponse = firstRow(result);
      const ok = spOk(spResponse);
      const status = spStatus(spResponse);

      if (ok && spResponse.TaskId) {
        await logActivity({
          entityType: "Task",
          entityId: spResponse.TaskId,
          action: Id === 0 ? ACTIONS.CREATED : ACTIONS.UPDATED,
          description: `Task ${Title || ""} ${Id === 0 ? "created" : "updated"}`,
          req,
        });

        // sp_SaveTask returns the assignees this save actually ADDED as a
        // second result set, so only new people get pinged. The old code
        // re-notified the assignee on every save, a drag-and-drop included.
        const newAssignees = (result.recordsets[1] ?? [])
          .map((r) => r.NewAssigneeUserId)
          .filter((id) => id && id !== req.user.UserId);

        for (const assigneeId of newAssignees) {
          database
            .executeStoredProcedure("sp_NotifyTaskAssigned", {
              TaskId: spResponse.TaskId,
              ActorUserId: req.user.UserId,
              AssigneeUserId: assigneeId,
            })
            .catch((e) => console.error("sp_NotifyTaskAssigned failed:", e.message));
          // Bell goes realtime: target each assignee's user room directly.
          emitToUser(assigneeId, SCOPES.NOTIFICATIONS);
        }

        // sp_SaveTask returns only TaskId — updates that omit WorkspaceId in
        // the body can't be routed to a room (no extra DB round-trip for an
        // emit), so this is skipped when WorkspaceId is unknown.
        if (WorkspaceId) {
          emitToWorkspace(WorkspaceId, SCOPES.TASK_LIST, {
            workspaceId: WorkspaceId,
          });
          if (Id > 0) {
            emitToWorkspace(WorkspaceId, SCOPES.TASK_DETAIL, {
              workspaceId: WorkspaceId,
              taskId: spResponse.TaskId,
            });
          }
        }
      }

      return res.status(status).json({
        success: ok,
        message: spMessage(spResponse),
        responseCode: status,
        data: ok ? { taskId: spResponse.TaskId } : null,
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to save task",
    "TASK_SAVE_ERROR",
  );

  // Moving a card between columns is its own operation, gated as change_status
  // rather than edit_fields — the assignee is exactly who should be able to
  // progress their own work. Routing it through saveTask also meant re-sending
  // the whole task, including the legacy AssignedToUserId alias, which under
  // 063 would replace the assignee set with one person and silently drop
  // co-assignees on every drag.
  moveColumn = asyncRoute(
    async (req, res) => {
      const { TaskId, ColumnId, WorkspaceId = null } = req.body;

      if (!positiveInt(TaskId) || !positiveInt(ColumnId)) {
        return validationError(res, "TaskId and ColumnId are required");
      }

      const result = await database.executeStoredProcedure("sp_MoveTaskColumn", {
        TaskId,
        ColumnId,
        UserId: req.user.UserId,
        IsAdmin: req.scope?.isAdmin ? 1 : 0,
        CompId: req.user.CompId,
      });

      const spResponse = firstRow(result);
      const ok = spOk(spResponse);
      const status = spStatus(spResponse);

      if (ok) {
        await logActivity({
          entityType: "Task",
          entityId: TaskId,
          action: ACTIONS.STATUS_CHANGED,
          fieldName: "ColumnId",
          newValue: String(ColumnId),
          description: "Task moved to another column",
          req,
        });

        const roomId = WorkspaceId ?? spResponse.WorkspaceId;
        if (roomId) {
          emitToWorkspace(roomId, SCOPES.TASK_LIST, { workspaceId: roomId });
        }
      }

      return res.status(status).json({
        success: ok,
        message: spMessage(spResponse),
        responseCode: status,
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to move task",
    "TASK_MOVE_ERROR",
  );

  fetch = asyncRoute(
    async (req, res) => {
      const {
        Id = 0,
        WorkspaceId = null,
        ProjectId = null,
        // Optional UI filter. Tasks are membership-governed; sp_FetchTask
        // treats @BranchId as a narrowing filter, NOT a scope gate. Passing
        // req.user.BranchId here silently hid every cross-branch workspace
        // from its own members (e.g. a branch-1 member of a branch-2 shared
        // workspace saw zero tasks).
        BranchId = null,
        SearchTerm = null,
      } = req.body;
      const { PageNumber, PageSize } = pageParams(req.body, 25);

      // scopeJson, not `?.length ? stringify : null`. That form collapses an
      // empty scope to NULL, which every one of these SPs reads as "apply no
      // branch filter at all" — the widest possible answer for the narrowest
      // possible scope. '[]' is an empty allow-list and matches nothing.
      const accessibleBranchIdsJson = scopeJson(req.scope?.branchIds);

      const result = await database.executeStoredProcedure("sp_FetchTask", {
        Id,
        WorkspaceId,
        ProjectId,
        UserId: req.user.UserId,
        CompId: req.user.CompId,
        BranchId,
        IsAdmin: req.scope?.isAdmin ? 1 : 0,
        AccessibleBranchIdsJson: accessibleBranchIdsJson,
        PageNumber,
        PageSize,
        SearchTerm,
      });

      // No status row at all (an SP that RETURNed before its SELECT) is a
      // malformed response, not an empty page — spStatus answers 500 for it
      // rather than the RangeError the bare ResponseCode read used to throw.
      const spResponse = firstRow(result) ?? {};
      const status = spStatus(spResponse);

      const tasks = cleanSpRows(result.recordsets[0]);

      return res.status(status).json({
        success: spOk(spResponse),
        message: spMessage(spResponse),
        responseCode: status,
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
    },
    "Failed to fetch tasks",
    "TASK_FETCH_ERROR",
  );

  delete = asyncRoute(
    async (req, res) => {
      const { Id, WorkspaceId = null } = req.body;

      if (!positiveInt(Id)) {
        return validationError(res, "Task ID is required");
      }

      const result = await database.executeStoredProcedure("sp_DeleteTask", {
        Id,
        UserId: req.user.UserId,
        CompId: req.user.CompId,
        BranchId: req.user.BranchId,
        IsAdmin: req.scope?.isAdmin ? 1 : 0,
      });

      const spResponse = firstRow(result);
      const ok = spOk(spResponse);
      const status = spStatus(spResponse);

      if (ok) {
        await attachmentController.cascadeDelete(req.user.CompId, "task", Id);
        await logActivity({
          entityType: "Task",
          entityId: Id,
          action: ACTIONS.DELETED,
          description: "Task deleted",
          req,
        });

        // WorkspaceId is an optional client hint — sp_DeleteTask doesn't
        // return it and we won't add a DB round-trip for an emit; skip if
        // unknown.
        if (WorkspaceId) {
          emitToWorkspace(WorkspaceId, SCOPES.TASK_LIST, {
            workspaceId: WorkspaceId,
          });
        }
      }

      return res.status(status).json({
        success: ok,
        message: spMessage(spResponse),
        responseCode: status,
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to delete task",
    "TASK_DELETE_ERROR",
  );

  bulkDelete = asyncRoute(
    async (req, res) => {
      // WorkspaceId is an emit-routing hint only; not passed to the SP.
      const { TaskIds, WorkspaceId = null } = req.body;

      if (!TaskIds || TaskIds.length === 0) {
        return validationError(res, "Task IDs are required");
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
          IsAdmin: req.scope?.isAdmin ? 1 : 0,
        }
      );

      const spResponse = firstRow(result);
      const ok = spOk(spResponse);
      const status = spStatus(spResponse);

      if (ok) {
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

        if (WorkspaceId) {
          emitToWorkspace(WorkspaceId, SCOPES.TASK_LIST, {
            workspaceId: WorkspaceId,
          });
        }
      }

      return res.status(status).json({
        success: ok,
        message: spMessage(spResponse),
        responseCode: status,
        data: ok
          ? {
              deletedCount: spResponse.DeletedCount,
              failedCount: spResponse.FailedCount,
            }
          : null,
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to bulk delete tasks",
    "BULK_DELETE_ERROR",
  );

  // ================================
  // TASK COMMENTS
  // ================================

  addComment = asyncRoute(
    async (req, res) => {
      const {
        Id = 0,
        TaskId,
        Comment,
        ParentCommentId = null,
        WorkspaceId = null, // emit-routing hint only; not passed to the SP
      } = req.body;

      if (!positiveInt(TaskId)) {
        return validationError(res, "TaskId is required");
      }

      const result = await database.executeStoredProcedure(
        "sp_SaveTaskComment",
        {
          Id,
          TaskId,
          UserId: req.user.UserId,
          Comment,
          ParentCommentId,
          IsAdmin: req.scope?.isAdmin ? 1 : 0,
          CompId: req.user.CompId,
          BranchId: req.user.BranchId,
        }
      );

      const spResponse = firstRow(result);
      const ok = spOk(spResponse);
      const status = spStatus(spResponse);

      if (ok && spResponse.CommentId) {
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

        // sp_SaveTaskComment doesn't return WorkspaceId; without the client
        // hint we can't route to a room, so skip (no extra DB round-trips).
        if (WorkspaceId) {
          emitToWorkspace(WorkspaceId, SCOPES.TASK_COMMENTS, {
            workspaceId: WorkspaceId,
            taskId: TaskId,
          });
          // Comment-count badges on board cards.
          emitToWorkspace(WorkspaceId, SCOPES.TASK_LIST, {
            workspaceId: WorkspaceId,
          });
          // Watcher ids aren't known here — broadcast NOTIFICATIONS to the
          // room; payloads are invalidation-only, non-watchers just refetch
          // a cheap bell count.
          emitToWorkspace(WorkspaceId, SCOPES.NOTIFICATIONS);
        }
      }

      return res.status(status).json({
        success: ok,
        message: spMessage(spResponse),
        responseCode: status,
        data: ok ? { commentId: spResponse.CommentId } : null,
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to add comment",
    "COMMENT_ERROR",
  );

  getComments = asyncRoute(
    async (req, res) => {
      const { TaskId } = req.body;
      const { PageNumber, PageSize } = pageParams(req.body, 25);

      // sp_FetchTaskComment has no permission logic and does not even filter
      // by CompId, so without this any authenticated user could read any
      // task's thread by id, across companies. It also writes read receipts on
      // this path, so an unauthorised read would corrupt "Seen by N" too.
      const allowed = await assertRecordAccess(req, res, "task", TaskId, "view");
      if (!allowed) return;

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

      // Status columns ride on the data rows, so a task with zero comments
      // returns zero rows — default the response instead of crashing on
      // undefined (that was the COMMENTS_ERROR 500 on any commentless task).
      const spResponse = firstRow(result) ?? {
        ResponseCode: 200,
        ResponseMess: "Comments retrieved",
        CurrentPage: PageNumber,
        PageSize,
        TotalRecords: 0,
        TotalPages: 0,
      };

      const comments = cleanSpRows(result.recordsets[0] || []);
      const status = spStatus(spResponse);

      return res.status(status).json({
        success: spOk(spResponse),
        message: spMessage(spResponse),
        responseCode: status,
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
    },
    "Failed to get comments",
    "COMMENTS_ERROR",
  );

  deleteComment = asyncRoute(
    async (req, res) => {
      // TaskId/WorkspaceId are emit-routing hints only; not passed to the SP.
      const { Id, TaskId = null, WorkspaceId = null } = req.body;

      if (!positiveInt(Id)) {
        return validationError(res, "Comment ID is required");
      }

      const result = await database.executeStoredProcedure(
        "sp_DeleteTaskComment",
        {
          Id,
          UserId: req.user.UserId,
          IsAdmin: req.scope?.isAdmin ? 1 : 0,
          CompId: req.user.CompId,
          BranchId: req.user.BranchId,
        }
      );

      const spResponse = firstRow(result);
      const ok = spOk(spResponse);
      const status = spStatus(spResponse);

      if (ok) {
        // Log under the parent Task (not the comment id) so it surfaces in the
        // task's History tab, which filters on EntityType='Task'.
        await logActivity({
          entityType: "Task",
          entityId: TaskId,
          action: ACTIONS.DELETED,
          fieldName: "Comment",
          description: "Comment deleted",
          req,
        });

        // sp_DeleteTaskComment returns neither TaskId nor WorkspaceId —
        // emit only when the client supplied both hints.
        if (WorkspaceId && TaskId) {
          emitToWorkspace(WorkspaceId, SCOPES.TASK_COMMENTS, {
            workspaceId: WorkspaceId,
            taskId: TaskId,
          });
        }
      }

      return res.status(status).json({
        success: ok,
        message: spMessage(spResponse),
        responseCode: status,
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to delete comment",
    "COMMENT_DELETE_ERROR",
  );

  // ================================
  // TIME TRACKING
  // ================================

  logTime = asyncRoute(
    async (req, res) => {
      // WorkspaceId is an emit-routing hint only; not passed to the SP.
      // LogDate is accepted as an alias because the web client sent that name
      // while this read WorkDate — the field was silently dropped and every
      // entry defaulted to today.
      const {
        TaskId,
        Hours,
        Description,
        WorkDate,
        LogDate,
        WorkspaceId = null,
      } = req.body;

      if (!positiveInt(TaskId)) {
        return validationError(res, "TaskId is required");
      }

      const result = await database.executeStoredProcedure("sp_SaveTimeEntry", {
        Id: 0,
        TaskId,
        UserId: req.user.UserId,
        Hours,
        Description,
        WorkDate:
          WorkDate || LogDate || new Date().toISOString().split("T")[0],
        CompId: req.user.CompId,
        BranchId: req.user.BranchId,
        // sp_SaveTimeEntry now delegates to sp_CheckTaskPermission (062), which
        // needs to know whether to apply the admin bypass.
        IsAdmin: req.scope?.isAdmin ? 1 : 0,
      });

      const spResponse = firstRow(result);
      const ok = spOk(spResponse);
      const status = spStatus(spResponse);

      if (ok) {
        await logActivity({
          entityType: "Task",
          entityId: TaskId,
          action: ACTIONS.UPDATED,
          fieldName: "TimeEntry",
          newValue: `${Hours}h`,
          description: `Logged ${Hours} hours`,
          req,
        });

        // sp_SaveTimeEntry doesn't return WorkspaceId — client hint or skip.
        if (WorkspaceId) {
          emitToWorkspace(WorkspaceId, SCOPES.TASK_DETAIL, {
            workspaceId: WorkspaceId,
            taskId: TaskId,
          });
        }
      }

      return res.status(status).json({
        success: ok,
        message: spMessage(spResponse),
        responseCode: status,
        data: ok ? { timeEntryId: spResponse.TimeEntryId } : null,
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to log time",
    "TIME_LOG_ERROR",
  );

  getTimeEntries = asyncRoute(
    async (req, res) => {
      const { TaskId = null, UserId = null } = req.body;
      const { PageNumber, PageSize } = pageParams(req.body, 20);

      // sp_FetchTimeEntry has no permission logic of its own. Asking for one
      // task's entries needs membership on that task; asking without a TaskId
      // is already pinned to the caller's own entries below (admins excepted).
      if (TaskId) {
        const allowed = await assertRecordAccess(req, res, "task", TaskId, "view");
        if (!allowed) return;
      }

      const result = await database.executeStoredProcedure(
        "sp_FetchTimeEntry",
        {
          Id: 0,
          TaskId,
          UserId: UserId || (req.scope?.isAdmin ? null : req.user.UserId),
          CompId: req.user.CompId,
          BranchId: req.user.BranchId,
          PageNumber,
          PageSize,
        }
      );

      // Status columns ride on the data rows — zero time entries means zero
      // rows, so default the response instead of crashing on undefined.
      const spResponse = firstRow(result) ?? {
        ResponseCode: 200,
        ResponseMess: "Time entries retrieved",
        CurrentPage: PageNumber,
        PageSize,
        TotalRecords: 0,
        TotalPages: 0,
      };

      const timeEntries = cleanSpRows(result.recordsets[0] || []);
      const status = spStatus(spResponse);

      return res.status(status).json({
        success: spOk(spResponse),
        message: spMessage(spResponse),
        responseCode: status,
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
    },
    "Failed to get time entries",
    "TIME_ENTRIES_ERROR",
  );

  deleteTimeEntry = asyncRoute(
    async (req, res) => {
      // TaskId/WorkspaceId are emit-routing hints only; not passed to the SP.
      const { Id, TaskId = null, WorkspaceId = null } = req.body;

      if (!positiveInt(Id)) {
        return validationError(res, "Time entry ID is required");
      }

      const result = await database.executeStoredProcedure(
        "sp_DeleteTimeEntry",
        {
          Id,
          UserId: req.user.UserId,
          CompId: req.user.CompId,
          BranchId: req.user.BranchId,
          IsAdmin: req.scope?.isAdmin ? 1 : 0,
        }
      );

      const spResponse = firstRow(result);
      const ok = spOk(spResponse);
      const status = spStatus(spResponse);

      if (ok) {
        // Log under the parent Task so it shows in the History tab.
        await logActivity({
          entityType: "Task",
          entityId: TaskId,
          action: ACTIONS.DELETED,
          fieldName: "TimeEntry",
          description: "Time entry deleted",
          req,
        });

        // sp_DeleteTimeEntry doesn't return TaskId/WorkspaceId — emit only
        // when the client supplied both hints.
        if (WorkspaceId && TaskId) {
          emitToWorkspace(WorkspaceId, SCOPES.TASK_DETAIL, {
            workspaceId: WorkspaceId,
            taskId: TaskId,
          });
        }
      }

      return res.status(status).json({
        success: ok,
        message: spMessage(spResponse),
        responseCode: status,
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to delete time entry",
    "TIME_ENTRY_DELETE_ERROR",
  );

  // ================================
  // CHECKLIST
  // ================================

  saveChecklist = asyncRoute(
    async (req, res) => {
      const {
        Id = 0,
        TaskId,
        ItemText,
        IsCompleted = false,
        SortOrder = 0,
        WorkspaceId = null, // emit-routing hint only; not passed to the SP
      } = req.body;
      // CompId and BranchId are deliberately NOT read from the body. They used
      // to be, as `CompId || req.user.CompId` — the only place in the backend
      // that took a tenant id from the request. assertRecordAccess below gates
      // the TaskId but says nothing about the company, so posting a checklist
      // item against your own task with `"CompId": 999` wrote the row into
      // company 999. Both now come from the verified token, like everywhere
      // else.

      // sp_SaveTaskChecklist has no permission check of its own, so this is
      // the only gate. Ticking an item is change_status (checklist drives
      // completion) — that lets anyone assigned do the work they were given.
      // Adding or renaming an item is manage_checklist: a work artifact, owned
      // by the assignees and the creator, but not by an assigned viewer.
      const allowed = await assertRecordAccess(
        req,
        res,
        "task",
        TaskId,
        Id > 0 ? "change_status" : "manage_checklist",
      );
      if (!allowed) return;

      const result = await database.executeStoredProcedure(
        "sp_SaveTaskChecklist",
        {
          Id,
          TaskId,
          ItemText,
          IsCompleted,
          SortOrder,
          CompId: req.user.CompId,
          BranchId: req.user.BranchId,
          ActingUserId: req.user.UserId,
        }
      );

      const spResponse = firstRow(result);
      const ok = spOk(spResponse);
      const status = spStatus(spResponse);

      if (ok) {
        // Id>0 always means a tick/untick here (there's no text-edit UI), so
        // record which way it went — that's the accountability trail: who
        // ticked what, when.
        await logActivity({
          entityType: "Task",
          entityId: TaskId,
          action: Id === 0 ? ACTIONS.CREATED : ACTIONS.STATUS_CHANGED,
          fieldName: "Checklist",
          newValue: Id === 0 ? ItemText : IsCompleted ? "done" : "open",
          description:
            Id === 0
              ? `Checklist item added: ${ItemText}`
              : IsCompleted
                ? `Checklist ticked: ${ItemText}`
                : `Checklist unticked: ${ItemText}`,
          req,
        });

        // Checklist drives completion — board cards change too, so both
        // detail and list invalidate. Needs the client WorkspaceId hint
        // (the SP doesn't return it); skip when unknown.
        if (WorkspaceId) {
          emitToWorkspace(WorkspaceId, SCOPES.TASK_DETAIL, {
            workspaceId: WorkspaceId,
            taskId: TaskId,
          });
          emitToWorkspace(WorkspaceId, SCOPES.TASK_LIST, {
            workspaceId: WorkspaceId,
          });
        }
      }

      return res.status(status).json({
        success: ok,
        message: spMessage(spResponse),
        responseCode: status,
        data: ok ? { checklistId: spResponse.ChecklistId } : null,
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to save checklist item",
    "CHECKLIST_SAVE_ERROR",
  );

  getChecklist = asyncRoute(
    async (req, res) => {
      const { Id = 0, TaskId } = req.body;
      const { PageNumber, PageSize } = pageParams(req.body, 50);

      // sp_FetchTaskChecklist has no permission logic and ignores its own
      // CompId/BranchId params — this is the only gate.
      const allowed = await assertRecordAccess(req, res, "task", TaskId, "view");
      if (!allowed) return;

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

      // Zero checklist items => zero rows (status rides on the data rows), so
      // default rather than read undefined.
      const spResponse = firstRow(result) ?? {
        ResponseCode: 200,
        ResponseMess: "Checklist retrieved",
        CurrentPage: PageNumber,
        PageSize,
        TotalRecords: 0,
        TotalPages: 0,
      };

      const checklist = cleanSpRows(result.recordsets[0] || []);
      const status = spStatus(spResponse);

      return res.status(status).json({
        success: spOk(spResponse),
        message: spMessage(spResponse),
        responseCode: status,
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
    },
    "Failed to fetch checklist",
    "CHECKLIST_FETCH_ERROR",
  );

  deleteChecklist = asyncRoute(
    async (req, res) => {
      const { Id, TaskId, WorkspaceId = null } = req.body;

      if (!positiveInt(Id)) {
        return validationError(res, "Checklist item ID is required");
      }

      // Removing an item is manage_checklist, same class as adding one — the
      // person doing the work decides the steps. TaskId comes from the client
      // because the SP only returns it after the delete has already happened.
      const allowed = await assertRecordAccess(req, res, "task", TaskId, "manage_checklist");
      if (!allowed) return;

      const result = await database.executeStoredProcedure(
        "sp_DeleteTaskChecklist",
        {
          Id,
          CompId: req.user.CompId,
          BranchId: req.user.BranchId,
          ActingUserId: req.user.UserId,
        }
      );

      const spResponse = firstRow(result);
      const ok = spOk(spResponse);
      const status = spStatus(spResponse);

      if (ok) {
        // Log under the parent Task so it shows in the History tab.
        await logActivity({
          entityType: "Task",
          entityId: TaskId,
          action: ACTIONS.DELETED,
          fieldName: "Checklist",
          description: "Checklist item removed",
          req,
        });

        // sp_DeleteTaskChecklist returns TaskId; WorkspaceId is a client
        // hint (not returned by the SP) — skip the emit when unknown.
        if (WorkspaceId) {
          emitToWorkspace(WorkspaceId, SCOPES.TASK_DETAIL, {
            workspaceId: WorkspaceId,
            taskId: spResponse.TaskId,
          });
          emitToWorkspace(WorkspaceId, SCOPES.TASK_LIST, {
            workspaceId: WorkspaceId,
          });
        }
      }

      return res.status(status).json({
        success: ok,
        message: spMessage(spResponse),
        responseCode: status,
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to delete checklist item",
    "CHECKLIST_DELETE_ERROR",
  );

  // ================================
  // COMMENT EXTRAS (pin, mark-read)
  // ================================

  pinComment = asyncRoute(
    async (req, res) => {
      // TaskId/WorkspaceId are emit-routing hints only; not passed to the SP.
      const { CommentId, IsPinned = true, TaskId = null, WorkspaceId = null } =
        req.body;
      if (!positiveInt(CommentId)) {
        return validationError(res, "CommentId is required");
      }

      const result = await database.executeStoredProcedure(
        "sp_PinTaskComment",
        {
          CommentId,
          IsPinned: IsPinned ? 1 : 0,
          UserId: req.user.UserId,
          IsAdmin: req.scope?.isAdmin ? 1 : 0,
          CompId: req.user.CompId,
        }
      );
      const spResponse = firstRow(result);
      const ok = spOk(spResponse);
      const status = spStatus(spResponse);

      // Pins render inside the comments list — TASK_COMMENTS covers it.
      if (ok && WorkspaceId && TaskId) {
        emitToWorkspace(WorkspaceId, SCOPES.TASK_COMMENTS, {
          workspaceId: WorkspaceId,
          taskId: TaskId,
        });
      }

      return res.status(status).json({
        success: ok,
        message: spMessage(spResponse),
        responseCode: status,
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to pin comment",
    "COMMENT_PIN_ERROR",
  );

  markCommentRead = asyncRoute(
    async (req, res) => {
      const { CommentId } = req.body;
      if (!positiveInt(CommentId)) {
        return validationError(res, "CommentId is required");
      }
      const result = await database.executeStoredProcedure(
        "sp_MarkCommentRead",
        { CommentId, UserId: req.user.UserId }
      );
      const spResponse = firstRow(result);
      const ok = spOk(spResponse);
      const status = spStatus(spResponse);

      // Reader's own bell count changed — sync their OTHER tabs/devices.
      if (ok) {
        emitToUser(req.user.UserId, SCOPES.NOTIFICATIONS);
      }

      return res.status(status).json({
        success: ok,
        message: spMessage(spResponse),
        responseCode: status,
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to mark comment read",
    "COMMENT_READ_ERROR",
  );

  // ================================
  // DEPENDENCIES
  // ================================

  addDependency = asyncRoute(
    async (req, res) => {
      // WorkspaceId is an emit-routing hint only; not passed to the SP.
      const { TaskId, DependsOnTaskId, Type = "blocks", WorkspaceId = null } =
        req.body;
      if (!positiveInt(TaskId) || !positiveInt(DependsOnTaskId)) {
        return validationError(res, "TaskId and DependsOnTaskId are required");
      }
      const result = await database.executeStoredProcedure(
        "sp_AddTaskDependency",
        {
          TaskId,
          DependsOnTaskId,
          Type,
          ActingUserId: req.user.UserId,
          IsAdmin: req.scope?.isAdmin ? 1 : 0,
          CompId: req.user.CompId,
        }
      );
      const spResponse = firstRow(result);
      const ok = spOk(spResponse);
      const status = spStatus(spResponse);

      if (ok) {
        await logActivity({
          entityType: "Task",
          entityId: TaskId,
          action: ACTIONS.UPDATED,
          fieldName: "Dependency",
          newValue: `blocked by task ${DependsOnTaskId}`,
          description: `Dependency added`,
          req,
        });

        // sp_AddTaskDependency doesn't return WorkspaceId — client hint or
        // skip.
        if (WorkspaceId) {
          emitToWorkspace(WorkspaceId, SCOPES.TASK_DETAIL, {
            workspaceId: WorkspaceId,
            taskId: TaskId,
          });
        }
      }

      return res.status(status).json({
        success: ok,
        message: spMessage(spResponse),
        responseCode: status,
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to add dependency",
    "DEPENDENCY_ADD_ERROR",
  );

  removeDependency = asyncRoute(
    async (req, res) => {
      // WorkspaceId is an emit-routing hint only; not passed to the SP.
      const { TaskId, DependsOnTaskId, WorkspaceId = null } = req.body;
      if (!positiveInt(TaskId) || !positiveInt(DependsOnTaskId)) {
        return validationError(res, "TaskId and DependsOnTaskId are required");
      }
      const result = await database.executeStoredProcedure(
        "sp_RemoveTaskDependency",
        {
          TaskId,
          DependsOnTaskId,
          ActingUserId: req.user.UserId,
          IsAdmin: req.scope?.isAdmin ? 1 : 0,
          CompId: req.user.CompId,
        }
      );
      const spResponse = firstRow(result);
      const ok = spOk(spResponse);
      const status = spStatus(spResponse);

      // sp_RemoveTaskDependency doesn't return WorkspaceId — client hint or
      // skip.
      if (ok && WorkspaceId) {
        emitToWorkspace(WorkspaceId, SCOPES.TASK_DETAIL, {
          workspaceId: WorkspaceId,
          taskId: TaskId,
        });
      }

      return res.status(status).json({
        success: ok,
        message: spMessage(spResponse),
        responseCode: status,
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to remove dependency",
    "DEPENDENCY_REMOVE_ERROR",
  );

  fetchDependencies = asyncRoute(
    async (req, res) => {
      const { TaskId } = req.body;
      if (!positiveInt(TaskId)) {
        return validationError(res, "TaskId is required");
      }
      const result = await database.executeStoredProcedure(
        "sp_FetchTaskDependencies",
        {
          TaskId,
          UserId: req.user.UserId,
          IsAdmin: req.scope?.isAdmin ? 1 : 0,
          CompId: req.user.CompId,
        }
      );
      // The SP carries its status columns on the data rows, so a task with
      // zero dependencies returns ZERO rows — reading [0].ResponseCode blind
      // was a TypeError -> 500 on every dependency-free task.
      const spResponse = firstRow(result) ?? {
        ResponseCode: 200,
        ResponseMess: "Dependencies retrieved",
      };
      const rows = cleanSpRows(result.recordsets[0] || [], "TaskId");
      const status = spStatus(spResponse);
      return res.status(status).json({
        success: spOk(spResponse),
        message: spMessage(spResponse),
        responseCode: status,
        data: {
          blockers: rows.filter((r) => r.Direction === "blocker"),
          dependents: rows.filter((r) => r.Direction === "dependent"),
        },
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to fetch dependencies",
    "DEPENDENCY_FETCH_ERROR",
  );

  // ================================
  // ACTIVITY
  // ================================

  getActivity = asyncRoute(
    async (req, res) => {
      const { TaskId } = req.body;
      const { PageNumber, PageSize } = pageParams(req.body, 50);

      // History is task-scoped and can be sensitive (who did what, when) —
      // gate it behind membership, same as viewing the task.
      const allowed = await assertRecordAccess(req, res, "task", TaskId, "view");
      if (!allowed) return;

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

      // A task with no logged activity returns zero rows — default rather than
      // crash on undefined.
      const spResponse = firstRow(result) ?? {
        ResponseCode: 200,
        ResponseMess: "Activity retrieved",
        CurrentPage: PageNumber,
        PageSize,
        TotalRecords: 0,
        TotalPages: 0,
      };

      const activities = cleanSpRows(result.recordsets[0] || []);
      const status = spStatus(spResponse);

      return res.status(status).json({
        success: spOk(spResponse),
        message: spMessage(spResponse),
        responseCode: status,
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
    },
    "Failed to get task activity",
    "ACTIVITY_ERROR",
  );
}

module.exports = new TaskController();
