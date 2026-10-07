# P1-A — Task foundation: items 1, 2, 3, 4, 5, 8, 10, 11, 15

Scope: spec §4 P1 items 1 (soft delete + web single delete), 2 (≥1 step), 3 (step rights split),
4 (viewers not assignees), 5 (leaving a board = leaving its open tasks), 8 ("Seen"), 10 (claim),
11 (board follows completion; assignee Column select), 15 (`sp_SaveTask` FK checks, `getTimeEntries` scope).

Everything below was read from the live DB (`eCRM+`, SQL Server 2019, compat 150, via
`OBJECT_DEFINITION`) and the working tree on `feat/task-tat-presence` on 2026-10-07.
Live facts it rests on:
- `tblTasks` has no `IsDeleted/DeletedAt/DeletedBy`. No `tblTaskReads` reader exists anywhere
  (SQL or JS); `FirstSeenAt/LastSeenAt` are 0/64.
- Tasks without a step: **10036** "Mobile Application" (shared, open), **10044** "KK Jwellers"
  (personal, open, sitting in "Done").
- Board/completion mismatches: 8 completed tasks not in their board's last column (10005, 10006,
  10027, 10030, 10031, 10033, 10038, 10041), plus 10044 (open, in "Done"). The last column is
  "Done" on every board involved.
- 0 viewer assignees today. `tblTeams.CompId` and `tblProjects.CompId` exist (nullable, default 1).
- `sp_FetchTimeEntry` has **no CompId filter at all**, and the controller lets a non-admin pass any
  `UserId` when there is no `TaskId`. That reads another user's entries, in any company. No client
  calls it without a `TaskId` (web `useTaskTimeEntries`, mobile `TimeSheet` always send one).
- No SP is called by `INSERT … EXEC` except `sp_CheckTaskPermission`/`sp_CreateNotification`, so
  the new helper (A4) can use `INSERT … EXEC sp_CreateNotification` inside its callers' transactions
  without nesting (`sp_SaveTeam`, `sp_SyncProjectWorkspaceMembers`, `sp_RemoveWorkspaceMember`,
  `sp_SetWorkspaceMemberRole`, `sp_ArchiveWorkspace` are only ever called from Node).
- The backend `sql/` folder is empty (093 applied and removed). This section's script is written as
  **`backend/sql/094_task_foundation.sql`**. If the P1-B people section also writes SQL, merge both
  into this one file (one manual apply) and keep the batch order below.

---

## SQL changes

### 0. Script header and order

```sql
-- ===========================================================================
-- 094_task_foundation.sql                                         2026-10-07
-- P1 task foundation (spec 2026-10-07-task-tat-presence-design.md §4).
-- Apply to BOTH clients: eCRM+ and SolarCRM. Then deploy the backend.
-- Old backend + new SQL is safe (every new parameter has a default that keeps
-- today's behaviour). New backend + old SQL is NOT (sp_ClaimTask is missing, and
-- sp_SaveTaskChecklist / sp_FetchTimeEntry reject the new @CanEdit /
-- @ViewerUserId parameters). Apply first, deploy right after.
-- ===========================================================================
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
```

Batch order (each `GO`-separated): A1 schema → A2 data → A4 helper (`sp_UnassignInvalidAssignees`)
→ every other procedure → verify block (commented). The new column must exist in an earlier batch:
SQL Server defers missing *tables* at `CREATE PROCEDURE`, not missing *columns* of an existing table.

### A1. Schema — soft delete (item 1)

```sql
IF COL_LENGTH('dbo.tblTasks', 'IsDeleted') IS NULL
    ALTER TABLE dbo.tblTasks ADD
        IsDeleted BIT      NOT NULL CONSTRAINT DF_tblTasks_IsDeleted DEFAULT (0),
        DeletedAt DATETIME NULL,
        DeletedBy INT      NULL;
GO
```

### A2. Data fixes (items 2 and 11)

```sql
-- Item 2: every task has at least one step (live: 10036, 10044). Generic, so it
-- also covers SolarCRM.
INSERT INTO dbo.tblTaskChecklist (TaskId, ItemText, IsCompleted, SortOrder)
SELECT t.Id, 'Complete this task', 0, 1
  FROM dbo.tblTasks t
 WHERE NOT EXISTS (SELECT 1 FROM dbo.tblTaskChecklist c WHERE c.TaskId = t.Id);

-- Item 11: the board follows completion from now on; line up today's cards.
-- Completed -> the board's last column; open but parked in the last column ->
-- the first column (only when the board has more than one column).
;WITH ends AS (
    SELECT t.Id, t.IsCompleted, t.ColumnId,
           (SELECT TOP 1 k.Id FROM dbo.tblKanbanColumns k
             WHERE k.WorkspaceId = t.WorkspaceId AND k.IsActive = 1
             ORDER BY k.SortOrder DESC, k.Id DESC) AS LastCol,
           (SELECT TOP 1 k.Id FROM dbo.tblKanbanColumns k
             WHERE k.WorkspaceId = t.WorkspaceId AND k.IsActive = 1
             ORDER BY k.SortOrder ASC, k.Id ASC)  AS FirstCol
      FROM dbo.tblTasks t
     WHERE t.IsDeleted = 0
)
UPDATE t
   SET ColumnId = CASE WHEN e.IsCompleted = 1 THEN e.LastCol ELSE e.FirstCol END,
       UpdatedDate = GETDATE()
  FROM dbo.tblTasks t
  JOIN ends e ON e.Id = t.Id
 WHERE e.LastCol IS NOT NULL
   AND (   (e.IsCompleted = 1 AND ISNULL(t.ColumnId, -1) <> e.LastCol)
        OR (e.IsCompleted = 0 AND t.ColumnId = e.LastCol AND e.FirstCol <> e.LastCol));
GO
```
(Open decision D3 — drop the second arm if the user wants open-in-Done cards left alone.)

### A3. `sp_CheckTaskPermission` — a deleted task permits nothing (item 1)

Every per-task action (view, comment, checklist, time, attachments, dependencies, move, save,
delete, claim) goes through this one procedure, so one guard here closes them all, including the
single-task `sp_FetchTask` (→ 404) and `assertRecordAccess` in Node.

Insert **before** these live lines (after the comment-context block):
```sql
    -- Workspace must be present for any decision
    IF (@WorkspaceId IS NULL OR @WorkspaceId <= 0)
```
New lines:
```sql
    -- A soft-deleted task is gone for every action (094).
    IF (@TaskId IS NOT NULL AND @TaskId > 0
        AND EXISTS (SELECT 1 FROM dbo.tblTasks WHERE Id = @TaskId AND IsDeleted = 1))
    BEGIN
        SELECT 0 AS Allowed, 'task deleted' AS Reason;
        RETURN;
    END

```
Callers (all unchanged): `sp_DeleteTask`, `sp_BulkDeleteTasks`, `sp_SaveTask`, `sp_FetchTask`,
`sp_MoveTaskColumn`, `sp_AddTaskDependency`, `sp_SaveTimeEntry`, `sp_DeleteTimeEntry`,
`sp_SaveTaskComment`, `sp_DeleteTaskComment`, `sp_PinTaskComment`, new `sp_ClaimTask`, and Node's
`assertRecordAccess` / new `taskAllowed`. Create/workspace-level actions pass `@TaskId = NULL` and
are unaffected.

### A4. NEW `sp_UnassignInvalidAssignees` (items 4 and 5; reused by P1-B item 16)

One rule, applied wherever membership changes: **an open task's assignee must be an active user who
is an active, non-viewer member of the board.** Anyone else is taken off; the owner is told about
each task that is left with nobody on it. Personal boards are skipped (only the owner can hold
those). Emits **no result set**, so callers keep their status row first.

```sql
-- ---------------------------------------------------------------------------
-- A4. sp_UnassignInvalidAssignees (NEW)
--    Called inside the caller's transaction by sp_RemoveWorkspaceMember,
--    sp_SyncProjectWorkspaceMembers, sp_SaveTeam, sp_SetWorkspaceMemberRole
--    (-> viewer) and sp_ArchiveWorkspace (@All = 1). User deactivation (P1-B
--    item 16) calls it once per board the user belongs to.
--    Never called through INSERT ... EXEC: it uses INSERT ... EXEC itself.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_UnassignInvalidAssignees
    @WorkspaceId  BIGINT,
    @ActorUserId  INT    = NULL,
    @CompId       BIGINT,
    @All          BIT    = 0,   -- 1 = archive: take everyone off open tasks
    @Notify       BIT    = 1    -- 0 = archive: the owner did it, or knows
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @WsType VARCHAR(20), @WsOwner INT, @WsBranchId BIGINT;

    SELECT @WsType = Type, @WsOwner = OwnerUserId, @WsBranchId = BranchId
      FROM dbo.tblWorkspaces
     WHERE Id = @WorkspaceId AND CompId = @CompId;

    IF (@WsType IS NULL OR @WsType = 'personal') RETURN;

    DECLARE @Gone TABLE (TaskId BIGINT, UserId INT);

    DELETE ta
    OUTPUT deleted.TaskId, deleted.UserId INTO @Gone (TaskId, UserId)
      FROM dbo.tblTaskAssignee ta
      JOIN dbo.tblTasks t ON t.Id = ta.TaskId
     WHERE t.WorkspaceId = @WorkspaceId
       AND t.IsCompleted = 0
       AND t.IsDeleted = 0
       AND (@All = 1
            OR NOT EXISTS (SELECT 1
                             FROM dbo.tblWorkspaceMembers m
                             JOIN dbo.tblUser u ON u.Id = m.UserId AND u.IsActive = 1
                            WHERE m.WorkspaceId = @WorkspaceId
                              AND m.UserId = ta.UserId
                              AND m.IsActive = 1
                              AND m.InviteStatus = 'active'
                              AND m.Role <> 'viewer'));

    IF NOT EXISTS (SELECT 1 FROM @Gone) RETURN;

    -- Legacy mirror, same rule sp_SaveTask uses.
    UPDATE t
       SET AssignedToUserId = (SELECT MIN(UserId) FROM dbo.tblTaskAssignee WHERE TaskId = t.Id),
           UpdatedDate = GETDATE()
      FROM dbo.tblTasks t
     WHERE t.Id IN (SELECT TaskId FROM @Gone);

    IF (@Notify = 0 OR @WsOwner IS NULL) RETURN;

    -- One notification per task that now has nobody on it. EntityType 'task'
    -- (lowercase, as sp_NotifyTaskAssigned) so the bell opens the task.
    DECLARE @Notif TABLE (ResponseCode INT, ResponseMess VARCHAR(400),
                          NotificationId BIGINT, UserId INT, Type VARCHAR(40));
    DECLARE @NTask BIGINT, @NBody NVARCHAR(1000);
    DECLARE nc CURSOR LOCAL FAST_FORWARD FOR
        SELECT g.TaskId,
               LEFT(MAX(t.Title) + N' — '
                    + STRING_AGG(ISNULL(u.FullName, u.Username), ', ')
                    + N' left the board', 1000)
          FROM @Gone g
          JOIN dbo.tblTasks t ON t.Id = g.TaskId
          LEFT JOIN dbo.tblUser u ON u.Id = g.UserId
         WHERE NOT EXISTS (SELECT 1 FROM dbo.tblTaskAssignee ta WHERE ta.TaskId = g.TaskId)
         GROUP BY g.TaskId;
    OPEN nc; FETCH NEXT FROM nc INTO @NTask, @NBody;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        INSERT INTO @Notif
        EXEC dbo.sp_CreateNotification
             @UserId      = @WsOwner,
             @Type        = 'task_unassigned',
             @EntityType  = 'task',
             @EntityId    = @NTask,
             @ActorUserId = @ActorUserId,
             @Title       = 'Task left unassigned',
             @Body        = @NBody,
             @CompId      = @CompId,
             @BranchId    = @WsBranchId,
             @SkipSelf    = 1;
        FETCH NEXT FROM nc INTO @NTask, @NBody;
    END
    CLOSE nc; DEALLOCATE nc;
END
GO
```
Note: "member removed" means `IsActive = 0` on the member row (or `InviteStatus <> 'active'`), so
the `NOT EXISTS` catches removal, leave, sync-out, team cascade, demotion to viewer and a
deactivated user in one predicate. The owner row is always `owner`/active, so the owner is never
removed. P3 will add "close the TAT clock with reason member_removed/archived" right after the
`DELETE` — this is the single place for it.

### A5. `sp_RemoveWorkspaceMember` — leaving takes you off open tasks (item 5)

Live lines (inside the `TRY`/transaction):
```sql
        IF (@WsType = 'project' AND @WsTeamId IS NOT NULL AND @WsTeamId > 0)
        BEGIN
            UPDATE dbo.tblTeamMembers
               SET IsActive = 0
             WHERE TeamId = @WsTeamId AND UserId = @UserId;
        END
```
Add immediately after them:
```sql

        -- Leaving the board means leaving its open tasks; the owner hears which
        -- tasks are now unowned (094).
        EXEC dbo.sp_UnassignInvalidAssignees
             @WorkspaceId = @WorkspaceId, @ActorUserId = @ActingUserId, @CompId = @CompId;
```
Covers both "remove" (owner/manager/admin acting) and "leave" (`@ActingUserId = @UserId`; there is
no separate leave SP — `workspaceController.removeMember` serves both). Everything else unchanged,
including the `workspace_left` notification and the single status row.

### A6. `sp_SyncProjectWorkspaceMembers` (item 5)

Live lines:
```sql
                            WHERE tm.TeamId = @WsTeamId AND tm.UserId = m.UserId AND tm.IsActive = 1);
        SET @Deactivated = @@ROWCOUNT;
```
Add after them:
```sql

        EXEC dbo.sp_UnassignInvalidAssignees
             @WorkspaceId = @WorkspaceId, @ActorUserId = @ActingUserId, @CompId = @CompId;
```
(`@Deactivated` is read before the EXEC, so the reported count is unchanged.)

### A7. `sp_SaveTeam` cascade (item 5)

Live lines (end of the `IF (@Members IS NOT NULL)` block):
```sql
            WHEN NOT MATCHED BY TARGET THEN
                INSERT (WorkspaceId, UserId, Role, AddedByUserId, IsActive, InviteStatus)
                VALUES (src.WorkspaceId, src.UserId, 'member', @LeadUserId, 1, 'active');
```
Add after them (still inside the `IF` block, inside the transaction):
```sql

            -- People dropped from the team leave the linked boards' open tasks (094).
            DECLARE @LwId BIGINT;
            DECLARE lw CURSOR LOCAL FAST_FORWARD FOR SELECT Id FROM @LinkedWorkspaces;
            OPEN lw; FETCH NEXT FROM lw INTO @LwId;
            WHILE @@FETCH_STATUS = 0
            BEGIN
                EXEC dbo.sp_UnassignInvalidAssignees
                     @WorkspaceId = @LwId, @ActorUserId = NULL, @CompId = @CompId;
                FETCH NEXT FROM lw INTO @LwId;
            END
            CLOSE lw; DEALLOCATE lw;
```
`sp_SaveTeam` has no acting-user parameter, so `@ActorUserId = NULL` (owner is always notified).
Teams/Projects writes are gated by `requireMenuRight` since 093 — no controller change.

### A8. `sp_SetWorkspaceMemberRole` — demotion to viewer (item 4)

Live lines (end of procedure):
```sql
    -- Role ONLY. Invite state is deliberately untouched (see header).
    UPDATE dbo.tblWorkspaceMembers
       SET Role = @Role
     WHERE WorkspaceId = @WorkspaceId AND UserId = @UserId;

    SELECT 200 AS ResponseCode, 'Role updated' AS ResponseMess,
           @WorkspaceId AS WorkspaceId, @UserId AS UserId, @Role AS Role;
END
```
After:
```sql
    -- Role ONLY. Invite state is deliberately untouched (see header).
    -- A viewer cannot hold a task (094): demotion takes them off open tasks.
    BEGIN TRY
        BEGIN TRANSACTION;
        UPDATE dbo.tblWorkspaceMembers
           SET Role = @Role
         WHERE WorkspaceId = @WorkspaceId AND UserId = @UserId;

        IF (@Role = 'viewer')
            EXEC dbo.sp_UnassignInvalidAssignees
                 @WorkspaceId = @WorkspaceId, @ActorUserId = @ActingUserId, @CompId = @CompId;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT 500 AS ResponseCode, 'Role change failed: ' + ERROR_MESSAGE() AS ResponseMess;
        RETURN;
    END CATCH

    SELECT 200 AS ResponseCode, 'Role updated' AS ResponseMess,
           @WorkspaceId AS WorkspaceId, @UserId AS UserId, @Role AS Role;
END
```

### A9. `sp_ArchiveWorkspace` (item 5)

Live lines:
```sql
    UPDATE dbo.tblWorkspaces
       SET IsArchived = @IsArchived, UpdatedDate = GETDATE()
     WHERE Id = @WorkspaceId;

    SELECT 200 AS ResponseCode,
```
After:
```sql
    BEGIN TRY
        BEGIN TRANSACTION;
        UPDATE dbo.tblWorkspaces
           SET IsArchived = @IsArchived, UpdatedDate = GETDATE()
         WHERE Id = @WorkspaceId;

        -- An archived board holds no live work (094): its open tasks lose their
        -- assignees. Unarchive does not restore them. No notifications — the
        -- archiver is the owner or an admin acting for them.
        IF (@IsArchived = 1)
            EXEC dbo.sp_UnassignInvalidAssignees
                 @WorkspaceId = @WorkspaceId, @ActorUserId = @ActingUserId,
                 @CompId = @CompId, @All = 1, @Notify = 0;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT 500 AS ResponseCode, 'Archive failed: ' + ERROR_MESSAGE() AS ResponseMess;
        RETURN;
    END CATCH

    SELECT 200 AS ResponseCode,
```
(See open decision D1 — this is the one destructive part of item 5.)

### A10. `sp_DeleteTask` — soft delete (item 1)

Hunks against the live body:

1. Existence:
```sql
    IF NOT EXISTS (SELECT 1 FROM dbo.tblTasks WHERE Id = @Id)
```
→
```sql
    IF NOT EXISTS (SELECT 1 FROM dbo.tblTasks WHERE Id = @Id AND IsDeleted = 0)
```

2. Delete these live lines entirely (the guard that made delete impossible):
```sql
    IF EXISTS (SELECT 1 FROM dbo.tblTaskChecklist WHERE TaskId = @Id)
    BEGIN SET @ResponseCode = 409;
          SET @ResponseMess = 'Clear checklist items before deleting this task';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
```

3. Subtask guard counts live children only:
```sql
    IF EXISTS (SELECT 1 FROM dbo.tblTasks WHERE ParentTaskId = @Id)
```
→
```sql
    IF EXISTS (SELECT 1 FROM dbo.tblTasks WHERE ParentTaskId = @Id AND IsDeleted = 0)
```

4. The transaction body. Live:
```sql
        IF OBJECT_ID('dbo.tblTaskDependencies', 'U') IS NOT NULL
            DELETE FROM dbo.tblTaskDependencies
             WHERE TaskId = @Id OR DependsOnTaskId = @Id;

        IF OBJECT_ID('dbo.tblCommentReads', 'U') IS NOT NULL
            DELETE FROM dbo.tblCommentReads
             WHERE CommentId IN (SELECT Id FROM dbo.tblTaskComments WHERE TaskId = @Id);

        IF OBJECT_ID('dbo.tblTaskComments', 'U') IS NOT NULL
            DELETE FROM dbo.tblTaskComments WHERE TaskId = @Id;

        IF OBJECT_ID('dbo.tblTaskReads', 'U') IS NOT NULL
            DELETE FROM dbo.tblTaskReads WHERE TaskId = @Id;

        IF OBJECT_ID('dbo.tblTimeEntries', 'U') IS NOT NULL
            DELETE FROM dbo.tblTimeEntries WHERE TaskId = @Id;

        DELETE FROM dbo.tblTasks WHERE Id = @Id;

        COMMIT TRANSACTION;
        SET @ResponseCode = 200; SET @ResponseMess = 'Task deleted';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, @Id AS TaskId;
```
→
```sql
        -- Soft delete (094): the task, its steps, comments, time and reads stay
        -- for history (TAT reports need them). Only dependency links go, so a
        -- deleted task never blocks a live one.
        DELETE FROM dbo.tblTaskDependencies
         WHERE TaskId = @Id OR DependsOnTaskId = @Id;

        UPDATE dbo.tblTasks
           SET IsDeleted = 1, DeletedAt = GETDATE(), DeletedBy = @UserId,
               UpdatedDate = GETDATE()
         WHERE Id = @Id;

        COMMIT TRANSACTION;
        SET @ResponseCode = 200; SET @ResponseMess = 'Task deleted';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, @Id AS TaskId,
               (SELECT WorkspaceId FROM dbo.tblTasks WHERE Id = @Id) AS WorkspaceId;
```
(The added `WorkspaceId` column lets the controller emit without a client hint. `tblTaskAssignee`
rows are kept: they are history, every reader goes through the guard in A3 or filters
`IsDeleted`.)

### A11. `sp_BulkDeleteTasks` — soft delete (item 1)

1. Delete the live checklist guard:
```sql
    IF EXISTS (
        SELECT 1 FROM dbo.tblTaskChecklist c
         WHERE c.TaskId IN (SELECT TaskId FROM @Targets)
    )
    BEGIN
        SET @ResponseCode = 409;
        SET @ResponseMess = 'One or more tasks still have checklist items. Clear them first.';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
    END
```

2. Subtask guard:
```sql
        INNER JOIN @Targets tgt ON t.ParentTaskId = tgt.TaskId
```
→
```sql
        INNER JOIN @Targets tgt ON t.ParentTaskId = tgt.TaskId
         WHERE t.IsDeleted = 0
```

3. Transaction body — replace from `IF OBJECT_ID('dbo.tblTaskDependencies', 'U') IS NOT NULL` through
`SET @DeletedCount = @@ROWCOUNT;` with:
```sql
        DELETE FROM dbo.tblTaskDependencies
         WHERE TaskId IN (SELECT TaskId FROM @Targets)
            OR DependsOnTaskId IN (SELECT TaskId FROM @Targets);

        UPDATE dbo.tblTasks
           SET IsDeleted = 1, DeletedAt = GETDATE(), DeletedBy = @UserId,
               UpdatedDate = GETDATE()
         WHERE Id IN (SELECT TaskId FROM @Targets) AND IsDeleted = 0;
        SET @DeletedCount = @@ROWCOUNT;
```
The per-id permission loop is unchanged; an already-deleted id now fails the loop with 403 via A3
(same as an id from another company today).

### A12. `sp_FetchTask` — list hides deleted; "Seen" stamp (items 1, 8)

**Coordinate with item 9** (P1 My Work adds `@AssigneeUserId/@OnlyOpen/@Overdue` and drops
archived to the same procedure). Both hunks below must land in whichever full body is written.

1. List filter — in **both** the count query and the page query, the live line
```sql
     WHERE (@WorkspaceId IS NULL OR t.WorkspaceId = @WorkspaceId)
```
→
```sql
     WHERE (@WorkspaceId IS NULL OR t.WorkspaceId = @WorkspaceId)
       AND t.IsDeleted = 0
```
(The single-task path needs nothing: A3 makes `view_task` fail → existing 404 branch.)

2. "Seen" (item 8). Live lines in the `@Id > 0` path:
```sql
        IF (@WsTypeOne IN ('shared','project'))
            IF NOT EXISTS (SELECT 1 FROM dbo.tblTaskReads WHERE TaskId = @Id AND UserId = @UserId)
                INSERT INTO dbo.tblTaskReads (TaskId, UserId, DeliveredAt)
                VALUES (@Id, @UserId, GETDATE());
```
→
```sql
        IF (@WsTypeOne IN ('shared','project'))
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM dbo.tblTaskReads WHERE TaskId = @Id AND UserId = @UserId)
                INSERT INTO dbo.tblTaskReads (TaskId, UserId, DeliveredAt)
                VALUES (@Id, @UserId, GETDATE());

            -- "Seen" (094): stamped only for the people the task is handed to.
            -- A manager opening it is not the assignee seeing it.
            UPDATE dbo.tblTaskReads
               SET FirstSeenAt = ISNULL(FirstSeenAt, GETDATE()),
                   LastSeenAt  = GETDATE()
             WHERE TaskId = @Id AND UserId = @UserId
               AND EXISTS (SELECT 1 FROM dbo.tblTaskAssignee
                            WHERE TaskId = @Id AND UserId = @UserId);
        END
```
Who calls the single fetch: web `TaskDetailModal` (`fetchTasks {Id}`), mobile `TaskDetailScreen`
and `TaskFormScreen` (`fetchTaskById`). So opening a task on either client stamps it — no client
change needed for item 8. Not stamped by board/list fetches (correct: a card in a list is not
"opened").

### A13. `sp_RecomputeTaskCompletion` — the board follows completion (item 11)

The only completion engine (called by `sp_SaveTaskChecklist` and `sp_DeleteTaskChecklist`, nothing
else). Live lines:
```sql
    DECLARE @Now BIT = CASE WHEN @Total > 0 AND @Open = 0 THEN 1 ELSE 0 END;

    UPDATE dbo.tblTasks
       SET IsCompleted = @Now,
```
→
```sql
    DECLARE @Now BIT = CASE WHEN @Total > 0 AND @Open = 0 THEN 1 ELSE 0 END;

    -- The board follows completion (094): completing moves the card to the
    -- board's last column, reopening moves it to the first. Only on a change of
    -- state — a tick that leaves the task as it was never moves the card.
    DECLARE @MoveTo INT = NULL;
    IF (@Now <> ISNULL(@Was, 0))
        SELECT TOP 1 @MoveTo = k.Id
          FROM dbo.tblKanbanColumns k
          JOIN dbo.tblTasks t ON t.WorkspaceId = k.WorkspaceId
         WHERE t.Id = @TaskId AND k.IsActive = 1
         ORDER BY CASE WHEN @Now = 1 THEN k.SortOrder END DESC,
                  CASE WHEN @Now = 1 THEN k.Id END DESC,
                  CASE WHEN @Now = 0 THEN k.SortOrder END ASC,
                  CASE WHEN @Now = 0 THEN k.Id END ASC;

    UPDATE dbo.tblTasks
       SET IsCompleted = @Now,
           ColumnId = COALESCE(@MoveTo, ColumnId),
```
Rest unchanged (still emits no result set; `sp_ResolveDependencies` still fires on 0→1).
**Coordinate with item 7** (completion/reopen notifications): this transition `IF` is the natural
hook; merge both edits into one body.

### A14. `sp_SaveTaskChecklist` — tick never renames (item 3)

1. Parameter list, live:
```sql
    @BranchId     BIGINT,
    @ActingUserId INT = NULL
AS
```
→
```sql
    @BranchId     BIGINT,
    @ActingUserId INT = NULL,
    @CanEdit      BIT = 1     -- 0 = the caller may only tick (change_status)
AS
```
2. Update, live:
```sql
        UPDATE dbo.tblTaskChecklist
           SET ItemText    = @ItemText,
               IsCompleted = @IsCompleted,
               SortOrder   = @SortOrder
         WHERE Id = @Id AND TaskId = @TaskId;
```
→
```sql
        -- Ticking is change_status; renaming/reordering is manage_checklist.
        -- A tick-only caller (e.g. an assigned viewer) changes IsCompleted and
        -- nothing else, whatever text it sends (094).
        UPDATE dbo.tblTaskChecklist
           SET ItemText    = CASE WHEN @CanEdit = 1 THEN @ItemText  ELSE ItemText  END,
               IsCompleted = @IsCompleted,
               SortOrder   = CASE WHEN @CanEdit = 1 THEN @SortOrder ELSE SortOrder END
         WHERE Id = @Id AND TaskId = @TaskId;
```
Default `1` = today's behaviour for the still-deployed backend between apply and deploy. Insert path
unchanged (adding is `manage_checklist`, enforced in the controller).

### A15. `sp_DeleteTaskChecklist` — never the last step (item 2)

Live lines:
```sql
    IF NOT EXISTS (SELECT 1 FROM dbo.tblTaskChecklist WHERE Id = @Id AND TaskId = @TaskId)
    BEGIN SELECT 404 AS ResponseCode, 'Checklist item not found' AS ResponseMess; RETURN; END
```
Add after them:
```sql

    -- Every task keeps at least one step (094) — completion is "all steps done",
    -- so deleting the last one would make a task that can never complete.
    IF NOT EXISTS (SELECT 1 FROM dbo.tblTaskChecklist WHERE TaskId = @TaskId AND Id <> @Id)
    BEGIN SELECT 409 AS ResponseCode,
                 'A task needs at least one step. Add another step before removing this one.' AS ResponseMess;
          RETURN; END
```
(Side benefit for TAT: an assignee can no longer "complete" by deleting the only open step when it
is the only step. Deleting one open step out of several still completes — that is spec R15, a P3
concern.)

### A16. `sp_SaveTask` — viewers are not assignees; FK checks (items 4, 15)

1. Viewer rule (item 4). Insert after the live lines
```sql
    BEGIN SET @ResponseCode = 400;
          SET @ResponseMess = 'Every assignee must be an active member of this workspace';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
```
new:
```sql

    -- A viewer can't complete a task, so it can't be theirs (094).
    IF (@WsTypeChk IN ('shared','project')
        AND EXISTS (SELECT 1 FROM @Assignees a
                      JOIN dbo.tblWorkspaceMembers m
                        ON m.WorkspaceId = @WsIdChk AND m.UserId = a.UserId
                     WHERE m.IsActive = 1 AND m.InviteStatus = 'active' AND m.Role = 'viewer'))
    BEGIN SET @ResponseCode = 400;
          SET @ResponseMess = 'A viewer cannot be assigned a task. Make them a member first.';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
```

2. Team (item 15), live:
```sql
        AND NOT EXISTS (SELECT 1 FROM dbo.tblTeams WHERE Id = @TeamId AND IsActive = 1))
```
→
```sql
        AND NOT EXISTS (SELECT 1 FROM dbo.tblTeams
                         WHERE Id = @TeamId AND IsActive = 1 AND CompId = @CompId))
```

3. Parent task (item 15), live:
```sql
        AND NOT EXISTS (SELECT 1 FROM dbo.tblTasks WHERE Id = @ParentTaskId))
```
→
```sql
        AND NOT EXISTS (SELECT 1 FROM dbo.tblTasks
                         WHERE Id = @ParentTaskId AND WorkspaceId = @WorkspaceId
                           AND IsDeleted = 0 AND Id <> ISNULL(@Id, 0)))
```
(Same workspace implies same company; `@WorkspaceId` is already the task's own on edit (093) and
CompId-checked on create.)

4. Project (item 15) — no check exists today. Insert right after the parent-task block (before
`DECLARE @PermTable`):
```sql

    IF (@ProjectId IS NOT NULL AND @ProjectId > 0
        AND NOT EXISTS (SELECT 1 FROM dbo.tblProjects WHERE Id = @ProjectId AND CompId = @CompId))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid project selected';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
```
Live data: 0 tasks use ParentTaskId/TeamId/ProjectId, so no existing edit starts failing.
Clients re-send `task.ProjectId/TeamId/ParentTaskId` unchanged on edit (all NULL today).

### A17. `sp_AddTaskDependency` — a deleted task can't be a blocker (item 1)

Live line:
```sql
    SELECT @BlockerWs = WorkspaceId FROM dbo.tblTasks WHERE Id = @DependsOnTaskId;
```
→
```sql
    SELECT @BlockerWs = WorkspaceId FROM dbo.tblTasks WHERE Id = @DependsOnTaskId AND IsDeleted = 0;
```
(Falls into the existing "Task(s) not found in this workspace" 404.)

### A18. `sp_FetchTimeEntry` — company + personal privacy (item 15)

1. Parameters, live:
```sql
    @SearchTerm NVARCHAR(200) = NULL
AS
```
→
```sql
    @SearchTerm NVARCHAR(200) = NULL,
    @ViewerUserId INT = NULL     -- the caller; personal-board entries are theirs only
AS
```
2. In **both** the `COUNT(*)` query and the page query, after the live line
```sql
      AND (@UserId IS NULL OR te.UserId = @UserId)
```
add
```sql
      -- 094: never another company's entries, never someone else's personal board.
      AND EXISTS (SELECT 1 FROM dbo.tblWorkspaces w
                   WHERE w.Id = t.WorkspaceId AND w.CompId = @CompId
                     AND (w.Type <> 'personal' OR w.OwnerUserId = @ViewerUserId))
```
(Comment line goes only in the first; tasks with `WorkspaceId IS NULL` — 0 live — are excluded,
fail-closed.) The `@Id <> 0` branch is unreachable from the controller (always `Id: 0`); left as is.

### A19. NEW `sp_ClaimTask` (item 10)

```sql
-- ---------------------------------------------------------------------------
-- A19. sp_ClaimTask (NEW) — "Take this task".
--    claim_task in sp_CheckTaskPermission: owner/manager/member of the board
--    (not a viewer) on a task with nobody assigned. An admin bypasses the
--    permission but must still be someone who can hold a task (A16 rule).
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_ClaimTask
    @TaskId  BIGINT,
    @UserId  INT,
    @IsAdmin BIT = 0,
    @CompId  BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @WsId BIGINT, @WsType VARCHAR(20), @Done BIT;

    SELECT @WsId = t.WorkspaceId, @WsType = w.Type, @Done = t.IsCompleted
      FROM dbo.tblTasks t
      JOIN dbo.tblWorkspaces w ON w.Id = t.WorkspaceId
     WHERE t.Id = @TaskId AND t.IsDeleted = 0 AND w.CompId = @CompId;

    IF (@WsId IS NULL)
    BEGIN SELECT 404 AS ResponseCode, 'Task not found' AS ResponseMess; RETURN; END

    IF EXISTS (SELECT 1 FROM dbo.tblTaskAssignee WHERE TaskId = @TaskId)
    BEGIN SELECT 409 AS ResponseCode, 'Someone already has this task' AS ResponseMess; RETURN; END

    IF (@Done = 1)
    BEGIN SELECT 409 AS ResponseCode, 'This task is already complete' AS ResponseMess; RETURN; END

    DECLARE @Perm TABLE (Allowed BIT, Reason VARCHAR(400));
    INSERT INTO @Perm
    EXEC dbo.sp_CheckTaskPermission
        @TaskId = @TaskId, @WorkspaceId = NULL, @CommentId = NULL,
        @UserId = @UserId, @Action = 'claim_task',
        @IsAdmin = @IsAdmin, @CompId = @CompId;
    IF NOT EXISTS (SELECT 1 FROM @Perm WHERE Allowed = 1)
    BEGIN SELECT 403 AS ResponseCode,
                 'Permission denied: ' + ISNULL((SELECT TOP 1 Reason FROM @Perm), 'no reason') AS ResponseMess;
          RETURN; END

    IF (@WsType IN ('shared','project')
        AND NOT EXISTS (SELECT 1 FROM dbo.tblWorkspaceMembers
                         WHERE WorkspaceId = @WsId AND UserId = @UserId
                           AND IsActive = 1 AND InviteStatus = 'active' AND Role <> 'viewer'))
    BEGIN SELECT 400 AS ResponseCode, 'Only a member of this board can take its tasks' AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;

        -- Two people pressing "Take" together: the lock makes the second see the first.
        IF EXISTS (SELECT 1 FROM dbo.tblTaskAssignee WITH (UPDLOCK, HOLDLOCK) WHERE TaskId = @TaskId)
        BEGIN
            ROLLBACK TRANSACTION;
            SELECT 409 AS ResponseCode, 'Someone already has this task' AS ResponseMess;
            RETURN;
        END

        INSERT INTO dbo.tblTaskAssignee (TaskId, UserId, AssignedByUserId)
        VALUES (@TaskId, @UserId, @UserId);

        UPDATE dbo.tblTasks
           SET AssignedToUserId = @UserId, UpdatedDate = GETDATE()
         WHERE Id = @TaskId;

        IF (@WsType IN ('shared','project')
            AND NOT EXISTS (SELECT 1 FROM dbo.tblTaskReads WHERE TaskId = @TaskId AND UserId = @UserId))
            INSERT INTO dbo.tblTaskReads (TaskId, UserId, DeliveredAt)
            VALUES (@TaskId, @UserId, GETDATE());

        COMMIT TRANSACTION;
        SELECT 200 AS ResponseCode, 'Task taken' AS ResponseMess,
               @TaskId AS TaskId, @WsId AS WorkspaceId;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT 500 AS ResponseCode, 'Claim failed: ' + ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO
```
`sp_CheckTaskPermission` needs no change: `claim_task` already exists (owner/manager/member, task
unassigned; viewers denied; personal = owner; admin bypass on shared/project).

### A20. Verify after apply (put at the end of 094, commented; all read-only or rolled back)

```sql
-- 1. Schema + data
SELECT COL_LENGTH('dbo.tblTasks','IsDeleted') AS IsDeleted_len;                 -- not NULL
SELECT COUNT(*) AS TasksWithoutSteps FROM dbo.tblTasks t
 WHERE NOT EXISTS (SELECT 1 FROM dbo.tblTaskChecklist c WHERE c.TaskId = t.Id); -- 0
SELECT COUNT(*) AS BoardMismatches FROM dbo.tblTasks t
 WHERE t.IsDeleted = 0 AND t.IsCompleted = 1
   AND ISNULL(t.ColumnId,-1) <> (SELECT TOP 1 k.Id FROM dbo.tblKanbanColumns k
                                  WHERE k.WorkspaceId = t.WorkspaceId AND k.IsActive = 1
                                  ORDER BY k.SortOrder DESC, k.Id DESC);           -- 0
SELECT name FROM sys.procedures
 WHERE name IN ('sp_ClaimTask','sp_UnassignInvalidAssignees');                     -- 2 rows

-- 2. Soft delete (owner of a shared board deletes one of its tasks)
BEGIN TRAN;
DECLARE @t BIGINT, @o INT, @c BIGINT;
SELECT TOP 1 @t = t.Id, @o = w.OwnerUserId, @c = w.CompId
  FROM dbo.tblTasks t JOIN dbo.tblWorkspaces w ON w.Id = t.WorkspaceId
 WHERE w.Type = 'shared' AND t.IsDeleted = 0
   AND EXISTS (SELECT 1 FROM dbo.tblTaskChecklist c WHERE c.TaskId = t.Id);
EXEC dbo.sp_DeleteTask @Id = @t, @UserId = @o, @IsAdmin = 0, @CompId = @c, @BranchId = 1;  -- 200, WorkspaceId set
SELECT IsDeleted, DeletedAt, DeletedBy FROM dbo.tblTasks WHERE Id = @t;                     -- 1, now, @o
SELECT COUNT(*) AS StepsKept FROM dbo.tblTaskChecklist WHERE TaskId = @t;                    -- > 0
EXEC dbo.sp_FetchTask @Id = @t, @UserId = @o, @CompId = @c;                                  -- 404
EXEC dbo.sp_DeleteTask @Id = @t, @UserId = @o, @IsAdmin = 0, @CompId = @c, @BranchId = 1;  -- 404
EXEC dbo.sp_CheckTaskPermission @TaskId = @t, @UserId = @o, @Action = 'view_task', @CompId = @c; -- 0, 'task deleted'
ROLLBACK;

-- 3. Last step can't go; tick-only can't rename
BEGIN TRAN;
DECLARE @t3 BIGINT = (SELECT TOP 1 TaskId FROM dbo.tblTaskChecklist GROUP BY TaskId HAVING COUNT(*) = 1);
DECLARE @i3 BIGINT = (SELECT Id FROM dbo.tblTaskChecklist WHERE TaskId = @t3);
EXEC dbo.sp_DeleteTaskChecklist @Id = @i3, @TaskId = @t3, @CompId = 1, @BranchId = 1;      -- 409
EXEC dbo.sp_SaveTaskChecklist @Id = @i3, @TaskId = @t3, @ItemText = 'RENAMED', @IsCompleted = 0,
     @SortOrder = 99, @CompId = 1, @BranchId = 1, @CanEdit = 0;                             -- 200
SELECT ItemText, SortOrder FROM dbo.tblTaskChecklist WHERE Id = @i3;                         -- unchanged
ROLLBACK;

-- 4. Completion moves the card; reopen moves it back
BEGIN TRAN;
DECLARE @t4 BIGINT = (SELECT TOP 1 t.Id FROM dbo.tblTasks t
                       WHERE t.IsCompleted = 0 AND t.IsDeleted = 0 AND t.WorkspaceId IS NOT NULL);
UPDATE dbo.tblTaskChecklist SET IsCompleted = 1 WHERE TaskId = @t4;
EXEC dbo.sp_RecomputeTaskCompletion @TaskId = @t4;
SELECT t.IsCompleted, k.Title FROM dbo.tblTasks t JOIN dbo.tblKanbanColumns k ON k.Id = t.ColumnId WHERE t.Id = @t4; -- 1, last column
UPDATE TOP (1) dbo.tblTaskChecklist SET IsCompleted = 0 WHERE TaskId = @t4;
EXEC dbo.sp_RecomputeTaskCompletion @TaskId = @t4;
SELECT t.IsCompleted, k.Title FROM dbo.tblTasks t JOIN dbo.tblKanbanColumns k ON k.Id = t.ColumnId WHERE t.Id = @t4; -- 0, first column
ROLLBACK;

-- 5. "Seen" for an assignee, not for a non-assignee
BEGIN TRAN;
DECLARE @t5 BIGINT, @u5 INT, @c5 BIGINT;
SELECT TOP 1 @t5 = ta.TaskId, @u5 = ta.UserId, @c5 = w.CompId
  FROM dbo.tblTaskAssignee ta JOIN dbo.tblTasks t ON t.Id = ta.TaskId
  JOIN dbo.tblWorkspaces w ON w.Id = t.WorkspaceId
 WHERE w.Type = 'shared' AND t.IsDeleted = 0;
EXEC dbo.sp_FetchTask @Id = @t5, @UserId = @u5, @CompId = @c5;
SELECT FirstSeenAt, LastSeenAt FROM dbo.tblTaskReads WHERE TaskId = @t5 AND UserId = @u5;    -- both set
ROLLBACK;

-- 6. Leaving a board unassigns + tells the owner
BEGIN TRAN;
DECLARE @w6 BIGINT, @u6 INT, @c6 BIGINT, @own6 INT;
SELECT TOP 1 @w6 = t.WorkspaceId, @u6 = ta.UserId, @c6 = w.CompId, @own6 = w.OwnerUserId
  FROM dbo.tblTaskAssignee ta JOIN dbo.tblTasks t ON t.Id = ta.TaskId
  JOIN dbo.tblWorkspaces w ON w.Id = t.WorkspaceId
 WHERE w.Type = 'shared' AND t.IsCompleted = 0 AND t.IsDeleted = 0 AND ta.UserId <> w.OwnerUserId;
EXEC dbo.sp_RemoveWorkspaceMember @WorkspaceId = @w6, @UserId = @u6, @ActingUserId = @u6, @CompId = @c6;  -- 200
SELECT COUNT(*) AS StillAssigned FROM dbo.tblTaskAssignee ta JOIN dbo.tblTasks t ON t.Id = ta.TaskId
 WHERE t.WorkspaceId = @w6 AND ta.UserId = @u6 AND t.IsCompleted = 0;                      -- 0
SELECT Type, EntityType, EntityId, Body FROM dbo.tblNotifications
 WHERE UserId = @own6 AND Type = 'task_unassigned' AND CreatedDate > DATEADD(MINUTE,-1,GETDATE());
ROLLBACK;

-- 7. Viewer can't be assigned
SELECT COUNT(*) AS ViewerAssignees FROM dbo.tblTaskAssignee ta
  JOIN dbo.tblTasks t ON t.Id = ta.TaskId
  JOIN dbo.tblWorkspaceMembers m ON m.WorkspaceId = t.WorkspaceId AND m.UserId = ta.UserId
 WHERE m.IsActive = 1 AND m.InviteStatus = 'active' AND m.Role = 'viewer';                -- 0

-- 8. Claim (needs an unassigned open shared task; 4 exist live)
BEGIN TRAN;
DECLARE @t8 BIGINT, @m8 INT, @c8 BIGINT;
SELECT TOP 1 @t8 = t.Id, @m8 = m.UserId, @c8 = w.CompId
  FROM dbo.tblTasks t JOIN dbo.tblWorkspaces w ON w.Id = t.WorkspaceId
  JOIN dbo.tblWorkspaceMembers m ON m.WorkspaceId = w.Id AND m.IsActive = 1
       AND m.InviteStatus = 'active' AND m.Role = 'member'
 WHERE w.Type = 'shared' AND t.IsCompleted = 0 AND t.IsDeleted = 0
   AND NOT EXISTS (SELECT 1 FROM dbo.tblTaskAssignee ta WHERE ta.TaskId = t.Id);
EXEC dbo.sp_ClaimTask @TaskId = @t8, @UserId = @m8, @CompId = @c8;   -- 200
EXEC dbo.sp_ClaimTask @TaskId = @t8, @UserId = @m8, @CompId = @c8;   -- 409
ROLLBACK;

-- 9. Time entries: another company sees nothing
EXEC dbo.sp_FetchTimeEntry @Id = 0, @TaskId = NULL, @UserId = NULL, @CompId = -1,
     @BranchId = 1, @ViewerUserId = 1;                                                       -- 0 rows
```

---

## Backend tasks

All commands from `backend/`. Fix the test first, watch it fail, then implement.

### B1. `permission.js` — `taskAllowed` (yes/no, no response) — for item 3

`src/middleware/permission.js`, add after `assertRecordAccess` (≈ line 344):
```js
// One sp_CheckTaskPermission answer as a boolean, without answering the
// request — for a controller that needs to know a SECOND right after the gate
// already passed (a tick-only caller vs one who may also rename the step).
async function taskAllowed(req, taskId, action) {
  const result = await database.executeStoredProcedure("sp_CheckTaskPermission", {
    TaskId: Number(taskId) || 0,
    UserId: req.user.UserId,
    Action: action,
    IsAdmin: req.scope?.isAdmin ? 1 : 0,
    CompId: req.user.CompId,
  });
  const row = result.recordsets?.[0]?.[0] ?? result.recordset?.[0];
  return row?.Allowed === true || row?.Allowed === 1;
}
```
and add `taskAllowed,` to `module.exports`.

Test — `tests/unit/middleware/permission.test.js`, add `taskAllowed` to the destructured import and:
```js
  describe("taskAllowed", () => {
    const req = { user: { UserId: 7, CompId: 1 }, scope: { isAdmin: true } };
    beforeEach(() => database.executeStoredProcedure.mockReset());

    it("asks sp_CheckTaskPermission for the exact action and answers true", async () => {
      database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ Allowed: 1 }]] });
      await expect(taskAllowed(req, "12", "manage_checklist")).resolves.toBe(true);
      expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_CheckTaskPermission", {
        TaskId: 12, UserId: 7, Action: "manage_checklist", IsAdmin: 1, CompId: 1,
      });
    });

    it("answers false on a refusal or an empty answer", async () => {
      database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[{ Allowed: 0 }]] });
      await expect(taskAllowed(req, 12, "manage_checklist")).resolves.toBe(false);
      database.executeStoredProcedure.mockResolvedValueOnce({ recordsets: [[]] });
      await expect(taskAllowed(req, 12, "manage_checklist")).resolves.toBe(false);
    });
  });
```
Run: `cd backend && pnpm exec jest tests/unit/middleware/permission.test.js` (fails: `taskAllowed` is
not a function) → implement → green.

### B2. `taskController.saveChecklist` — tick never renames (item 3)

`src/controllers/taskController.js`:
- line 7: `const { assertRecordAccess, scopeJson, taskAllowed } = require("../middleware/permission");`
- after the `if (!allowed) return;` that follows the `assertRecordAccess(... Id > 0 ? "change_status" : "manage_checklist")` call (≈ line 820), add:
```js
      // Passing change_status lets the caller TICK. Renaming or reordering a
      // step is manage_checklist — an assigned viewer has the first and not
      // the second, and used to be able to rename through this same call.
      // The SP keeps text and order as they are when CanEdit is 0.
      const canEdit = Id > 0 ? await taskAllowed(req, TaskId, "manage_checklist") : true;
```
- in the `sp_SaveTaskChecklist` params (≈ line 824-833) add `CanEdit: canEdit ? 1 : 0,`.

Tests — `tests/unit/controllers/taskController.test.js`:
- In the `jest.mock("../../../src/middleware/permission", …)` factory add
  `taskAllowed: jest.fn().mockResolvedValue(true),`; import it next to `assertRecordAccess`; in
  `beforeEach` add `taskAllowed.mockClear(); taskAllowed.mockResolvedValue(true);`.
- New tests (in the `time-tracking + checklist + activity` describe):
```js
  // REGRESSION (spec P1 item 3): ticking needs only change_status, and the same
  // call used to write ItemText/SortOrder — an assigned viewer could rename a step.
  it("saveChecklist tells the SP a tick-only caller may not rename (CanEdit=0)", async () => {
    taskAllowed.mockResolvedValueOnce(false);
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "ok", ChecklistId: 7 }]),
    );
    await taskController.saveChecklist(
      baseReq({ body: { Id: 7, TaskId: 1, ItemText: "renamed", IsCompleted: true, SortOrder: 9 } }),
      mockRes(),
    );
    expect(taskAllowed).toHaveBeenCalledWith(expect.anything(), 1, "manage_checklist");
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_SaveTaskChecklist",
      expect.objectContaining({ Id: 7, CanEdit: 0 }),
    );
  });

  it("saveChecklist lets someone with manage_checklist rename (CanEdit=1)", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "ok", ChecklistId: 7 }]),
    );
    await taskController.saveChecklist(
      baseReq({ body: { Id: 7, TaskId: 1, ItemText: "renamed", IsCompleted: false } }),
      mockRes(),
    );
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_SaveTaskChecklist",
      expect.objectContaining({ CanEdit: 1 }),
    );
  });

  it("saveChecklist does not ask a second question when adding a step", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 201, ResponseMess: "ok", ChecklistId: 8 }]),
    );
    await taskController.saveChecklist(baseReq({ body: { TaskId: 1, ItemText: "new" } }), mockRes());
    expect(taskAllowed).not.toHaveBeenCalled();
    expect(database.executeStoredProcedure).toHaveBeenCalledWith(
      "sp_SaveTaskChecklist",
      expect.objectContaining({ Id: 0, CanEdit: 1 }),
    );
  });
```
Existing tests stay green (taskAllowed defaults to true; `assertRecordAccess` is still called with
`change_status` for a tick). Run: `cd backend && pnpm exec jest tests/unit/controllers/taskController.test.js`.

### B3. `taskController.delete` — soft delete keeps files; emit without a hint (item 1)

`src/controllers/taskController.js` `delete` (≈ lines 276-325):
- remove line 297 `await attachmentController.cascadeDelete(req.user.CompId, "task", Id);` (the task
  still exists, soft-deleted; its files are its history — decision D2). That is the file's only use
  of `attachmentController`, so drop the `require` on line 4 too.
- replace the emit block
```js
        if (WorkspaceId) {
          emitToWorkspace(WorkspaceId, SCOPES.TASK_LIST, {
            workspaceId: WorkspaceId,
          });
        }
```
with
```js
        // sp_DeleteTask returns the task's WorkspaceId since 094.
        const roomId = WorkspaceId ?? spResponse.WorkspaceId;
        if (roomId) {
          emitToWorkspace(roomId, SCOPES.TASK_LIST, { workspaceId: roomId });
        }
```
and delete the now-stale comment above it.

Test — `tests/unit/controllers/realtimeEmits.test.js` (events and `attachmentController` are
already mocked there):
```js
  // REGRESSION (094 soft delete): a deleted task keeps its files, and the board
  // refreshes even when the client sent no WorkspaceId hint (mobile never does).
  it("task delete keeps attachments and emits TASK_LIST to the SP's WorkspaceId", async () => {
    const attachmentController = require("../../../src/controllers/attachmentController");
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "Task deleted", TaskId: 11, WorkspaceId: 5 }]),
    );
    await taskController.delete(baseReq({ Id: 11 }), mockRes());
    expect(attachmentController.cascadeDelete).not.toHaveBeenCalled();
    expect(emitToWorkspace).toHaveBeenCalledWith(5, SCOPES.TASK_LIST, { workspaceId: 5 });
  });
```
(If `beforeEach` there doesn't clear `cascadeDelete`, add `attachmentController.cascadeDelete.mockClear()`
at the top of the test.) Run: `cd backend && pnpm exec jest tests/unit/controllers/realtimeEmits.test.js`.

### B4. `taskController.claim` + route (item 10)

`src/controllers/taskController.js`, add after `moveColumn`:
```js
  // "Take this task" — a member puts themselves on an UNASSIGNED task
  // (claim_task). A task that already has someone stays a reassignment, which
  // is owner/manager/creator work through saveTask.
  claim = asyncRoute(
    async (req, res) => {
      const { TaskId } = req.body;
      if (!positiveInt(TaskId)) {
        return validationError(res, "TaskId is required");
      }

      const result = await database.executeStoredProcedure("sp_ClaimTask", {
        TaskId,
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
          action: ACTIONS.ASSIGNED,
          fieldName: "Assignee",
          newValue: String(req.user.UserId),
          description: "Took this task",
          req,
        });
        const roomId = spResponse.WorkspaceId;
        if (roomId) {
          emitToWorkspace(roomId, SCOPES.TASK_LIST, { workspaceId: roomId });
          emitToWorkspace(roomId, SCOPES.TASK_DETAIL, { workspaceId: roomId, taskId: TaskId });
        }
      }

      return res.status(status).json({
        success: ok,
        message: spMessage(spResponse),
        responseCode: status,
        timestamp: new Date().toISOString(),
      });
    },
    "Failed to take task",
    "TASK_CLAIM_ERROR",
  );
```
`src/routes/taskRoutes.js` after line 17 (`moveTaskColumn`):
```js
// "Take this task" — claim_task, unassigned tasks only (094).
router.post("/claimTask", taskController.claim);
```
Tests — `taskController.test.js`:
```js
describe("taskController.claim", () => {
  it("rejects a missing TaskId with 400 and runs no query", async () => {
    const res = mockRes();
    await taskController.claim(baseReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(database.executeStoredProcedure).not.toHaveBeenCalled();
  });

  it("claims as the caller (never a body UserId) and logs the assignment", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "Task taken", TaskId: 11, WorkspaceId: 5 }]),
    );
    const res = mockRes();
    await taskController.claim(baseReq({ body: { TaskId: 11, UserId: 99 } }), res);
    expect(database.executeStoredProcedure).toHaveBeenCalledWith("sp_ClaimTask", {
      TaskId: 11, UserId: 7, IsAdmin: 0, CompId: 1,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 11, action: "Assigned", newValue: "7" }),
    );
  });

  it("passes the SP's 409 through and logs nothing", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 409, ResponseMess: "Someone already has this task" }]),
    );
    const res = mockRes();
    await taskController.claim(baseReq({ body: { TaskId: 11 } }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("returns 500 when DB throws", async () => {
    database.executeStoredProcedure.mockRejectedValueOnce(new Error("x"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const res = mockRes();
    await taskController.claim(baseReq({ body: { TaskId: 11 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    spy.mockRestore();
  });
});
```
`realtimeEmits.test.js`:
```js
  it("claim emits TASK_LIST + TASK_DETAIL to the task's board", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(
      spResult([{ ResponseCode: 200, ResponseMess: "ok", TaskId: 11, WorkspaceId: 5 }]),
    );
    await taskController.claim(baseReq({ TaskId: 11 }), mockRes());
    expect(emitToWorkspace).toHaveBeenCalledWith(5, SCOPES.TASK_LIST, { workspaceId: 5 });
    expect(emitToWorkspace).toHaveBeenCalledWith(5, SCOPES.TASK_DETAIL, { workspaceId: 5, taskId: 11 });
  });
```

### B5. `taskController.getTimeEntries` — scoped without a TaskId (item 15)

`src/controllers/taskController.js` ≈ lines 683-694, replace
```js
          UserId: UserId || (req.scope?.isAdmin ? null : req.user.UserId),
```
with
```js
          // Without a TaskId nothing above gated the read, so a non-admin sees
          // only their own entries whatever UserId they send. With a TaskId the
          // task gate passed and the old rule stands.
          UserId:
            !TaskId && !req.scope?.isAdmin
              ? req.user.UserId
              : UserId || (req.scope?.isAdmin ? null : req.user.UserId),
          // The SP hides other companies and other people's personal boards (094).
          ViewerUserId: req.user.UserId,
```
Tests:
```js
  // REGRESSION (spec P1 item 15): with no TaskId nothing gated the read, and a
  // body UserId was passed straight through — anyone's time log, any company.
  it("getTimeEntries without a TaskId pins a non-admin to their own entries", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(spResult([]));
    await taskController.getTimeEntries(baseReq({ body: { UserId: 99 } }), mockRes());
    expect(assertRecordAccess).not.toHaveBeenCalled();
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({
      TaskId: null, UserId: 7, ViewerUserId: 7,
    });
  });

  it("getTimeEntries lets an admin filter by any user without a TaskId", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(spResult([]));
    await taskController.getTimeEntries(
      baseReq({ scope: { branchIds: [1], isAdmin: true }, body: { UserId: 99 } }),
      mockRes(),
    );
    expect(database.executeStoredProcedure.mock.calls[0][1]).toMatchObject({ UserId: 99, ViewerUserId: 7 });
  });

  it("getTimeEntries keeps a UserId filter inside a task the caller may see", async () => {
    database.executeStoredProcedure.mockResolvedValueOnce(spResult([]));
    await taskController.getTimeEntries(baseReq({ body: { TaskId: 1, UserId: 99 } }), mockRes());
    expect(database.executeStoredProcedure.mock.calls[0][1].UserId).toBe(99);
  });
```
The two existing `getTimeEntries` tests stay green.

### B6. `workspaceController` — refresh boards after membership changes (item 5)

The unassignment is in SQL (A4–A9); the controller only has to tell open boards and bells.
`src/controllers/workspaceController.js`:
- `setMemberRole` success block (≈ line 266-271), add:
  `emitToWorkspace(WorkspaceId, SCOPES.TASK_LIST, { workspaceId: WorkspaceId });`
  `emitToWorkspace(WorkspaceId, SCOPES.NOTIFICATIONS);`
- `removeMember` success block (≈ line 377-384), add the `TASK_LIST` line (NOTIFICATIONS is there).
- `archive` success block (≈ line 510), add the `TASK_LIST` line.
- `syncProjectMembers` success block (≈ line 740-743), add `TASK_LIST` + `NOTIFICATIONS`.
(No emit from `teamController.save` — it has no board id in hand; boards refetch on focus.)

Tests — `realtimeEmits.test.js`, extend the four existing tests with one assertion each, e.g. in
"removeMember: members + notifications…":
```js
    // 094: leaving a board takes the person off its open tasks — cards change.
    expect(emitToWorkspace).toHaveBeenCalledWith(5, SCOPES.TASK_LIST, { workspaceId: 5 });
```
same `TASK_LIST` assertion in "archive emits WORKSPACES…", "syncProjectMembers emits…" (+
`expect(emitToWorkspace).toHaveBeenCalledWith(5, SCOPES.NOTIFICATIONS)`), and "setMemberRole emits
WORKSPACE_MEMBERS…" (+ NOTIFICATIONS). The "emits nothing when the SP refuses" test keeps proving no
emit on failure. Each new assertion fails before the edit.

### B7. Coverage run

```
cd backend && pnpm exec jest tests/unit/controllers/taskController.test.js tests/unit/controllers/realtimeEmits.test.js tests/unit/middleware/permission.test.js --coverage \
  --collectCoverageFrom='src/controllers/taskController.js' --collectCoverageFrom='src/controllers/workspaceController.js' --collectCoverageFrom='src/middleware/permission.js'
cd backend && pnpm exec jest --silent
```
≥80% line/branch on the three touched files.

---

## Web tasks

All commands from `web/`.

### W1. Endpoints + MSW handlers

`src/api/taskQueries.js` `TASK_ENDPOINTS.tasks` add:
```js
    deleteTask: "/api/tasks/deleteTask",
    claimTask: "/api/tasks/claimTask",
```
(No fetcher exports — both are used through `useApiMutation` by endpoint.)

`src/test/mocks/handlers.js`:
- `deleteTask` handler (≈ line 512): delete the `ChecklistItems` 409 branch (soft delete has no
  such refusal).
- `bulkDeleteTasks` handler (≈ line 487): delete the `blocked` lookup and its 409 return.
- add
```js
  http.post(`*/api/tasks/claimTask`, async ({ request }) => {
    const body = await request.json();
    const task = taskFixture.list.find((t) => t.Id === body?.TaskId);
    if (task) task.AssigneesJson = JSON.stringify([{ UserId: 1, FullName: "Me" }]);
    return HttpResponse.json({ success: true, message: "Task taken", responseCode: 200 });
  }),
```

`src/pages/Task/TaskBoard.test.jsx` "bulk delete surfaces 409 toast when checklist items block
deletion" — the behaviour it pins is gone. Replace with:
```js
  it("bulk delete removes a task that still has steps (soft delete, no 409)", async () => {
    // …same setup as before, task 888 with ChecklistItems: ["step 1"]…
    await user.click(deleteBtn);
    await waitFor(() => {
      expect(taskFixture.list.find((t) => t.Id === 888)).toBeUndefined();
    });
  });
```

### W2. Single delete in `TaskDetailModal` (item 1)

`src/pages/Task/Components/TaskDetailModal.jsx`:
- imports: `import { useQueryClient } from "@tanstack/react-query";`, `import { enqueueSnackbar } from "notistack";`,
  add `Trash2` to the lucide import, `import { useApiMutation } from "../../../hooks/useApiMutation";`,
  `import { useConfirmation } from "../../../hooks/useConfirmation";`,
  `import ConfirmationDialog from "../../../components/ConfirmationDialog";`.
- after `const canLogTime = …` (line 134):
```js
  const queryClient = useQueryClient();
  const confirmation = useConfirmation();
  const deleteMutation = useApiMutation({
    endpoint: TASK_ENDPOINTS.tasks.deleteTask,
    showSuccessMessage: false,
  });
  // delete_task: owner/manager, or the creator while nobody else is on it —
  // the server decides the second half and says why when it refuses.
  const requestDelete = () =>
    confirmation.confirmDelete({
      title: "Delete task",
      message: `Delete "${task.Title}"? It disappears from every board and list.`,
      confirmText: "Delete",
      onConfirm: async () => {
        await deleteMutation.mutateAsync({ Id: task.Id, WorkspaceId: task.WorkspaceId });
        enqueueSnackbar("Task deleted", { variant: "success" });
        queryClient.invalidateQueries({ queryKey: ["tasks"], refetchType: "all" });
        queryClient.removeQueries({ queryKey: ["task", task.Id] });
        onClose?.();
      },
    });
```
  (`useConfirmation.handleConfirm` keeps the dialog open on a throw; `useApiMutation` shows the
  server's message.) Hooks go above the `if (!open) return null;`.
- Footer (line 479-497): inside `<Modal.Footer>` before the Close button:
```jsx
          <Button
            variant="destructive"
            leftIcon={<Trash2 size={14} />}
            onClick={requestDelete}
            disabled={details.isSaving}
            data-testid="task-delete-btn"
            sx={{ mr: "auto" }}
          >
            Delete
          </Button>
```
  (`ui/Button` variants: primary/hero/secondary/tonal/ghost/destructive/text; it takes `sx`, not `style`.)
- after `</Modal>`, before `<LogTimeModal …/>`:
```jsx
    <ConfirmationDialog
      open={confirmation.confirmationState.open}
      onClose={confirmation.hideConfirmation}
      onConfirm={confirmation.handleConfirm}
      title={confirmation.confirmationState.title}
      message={confirmation.confirmationState.message}
      confirmText={confirmation.confirmationState.confirmText}
      cancelText={confirmation.confirmationState.cancelText}
      type={confirmation.confirmationState.type}
      isLoading={confirmation.confirmationState.isLoading}
    />
```

Tests — `TaskDetailModal.test.jsx` (default seed: task 501 created by user 1 → can edit):
```js
  it("deletes the task after confirming, then closes", async () => {
    const onClose = vi.fn();
    let body;
    server.use(
      http.post(`*/api/tasks/deleteTask`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, message: "Task deleted", responseCode: 200 });
      }),
    );
    renderModal(501, { onClose });
    await screen.findByText("Task 501");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("task-delete-btn"));
    const dialog = await screen.findByTestId("confirmation-dialog");
    await user.click(within(dialog).getByRole("button", { name: /^Delete$/ }));
    await waitFor(() => expect(body).toEqual({ Id: 501, WorkspaceId: 100 }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("stays open when the server refuses the delete", async () => {
    const onClose = vi.fn();
    server.use(
      http.post(`*/api/tasks/deleteTask`, async () =>
        HttpResponse.json({
          success: false,
          message: "Permission denied: others have contributed to this task",
          responseCode: 403,
        }),
      ),
    );
    renderModal(501, { onClose });
    await screen.findByText("Task 501");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("task-delete-btn"));
    const dialog = await screen.findByTestId("confirmation-dialog");
    await user.click(within(dialog).getByRole("button", { name: /^Delete$/ }));
    expect(await screen.findByText(/others have contributed/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows no Delete to someone who neither created nor manages the task", async () => {
    taskFixture.list[0].CreatedByUserId = 99;
    renderModal(501);
    await screen.findByText("Task 501");
    expect(screen.queryByTestId("task-delete-btn")).not.toBeInTheDocument();
  });
```
(The first fails today: no `task-delete-btn`.)

### W3. Last step can't be removed (item 2)

`src/pages/Task/Components/TaskDetail/ChecklistPanel.jsx` line 37:
```jsx
            // The last step stays: a task with no steps can never complete (094).
            canDelete={canManageArtifacts && checklistItems.length > 1}
```
Tests — `TaskDetailModal.test.jsx`:
- Existing "lets the assignee manage checklist items…" and "checklist delete sends TaskId…" seed a
  single item; change their `getTaskChecklist` overrides to two items
  (`{ Id: 900, … }, { Id: 901, ItemText: "step two", IsCompleted: false }`) and pick the first
  remove button: `(await screen.findAllByRole("button", { name: /Remove item/i }))[0]`.
- New:
```js
  it("never offers to remove a task's last step", async () => {
    server.use(
      http.post(`*/api/tasks/getTaskChecklist`, async () =>
        HttpResponse.json({
          success: true, message: "ok", responseCode: 200,
          data: { checklist: [{ Id: 900, ItemText: "only step", IsCompleted: false }] },
        }),
      ),
    );
    await openChecklistTab();               // task created by me → canManageArtifacts
    await screen.findByTestId("checklist-toggle-900");
    expect(screen.queryByRole("button", { name: /Remove item/i })).not.toBeInTheDocument();
  });
```
(Place it in the describe that defines `openChecklistTab`; reset the fixture to the default seed if
that describe's helper re-seeds.)

### W4. Viewers are never offered as assignees (item 4)

`src/hooks/useWorkspaceMemberOptions.jsx` line 29:
```js
      // A viewer can't complete a task, so sp_SaveTask refuses them (094).
      .filter((m) => m.IsActive && m.InviteStatus === "active" && m.Role !== "viewer")
```
(Also covers `TaskCreateModal`, which uses the same hook — confirm with grep.)

Test — `TaskDetailModal.test.jsx` (import `workspaceFixture` from handlers):
```js
  it("never offers a viewer as an assignee", async () => {
    workspaceFixture.members = [
      { UserId: 1, FullName: "Me", Role: "owner", IsActive: true, InviteStatus: "active" },
      { UserId: 2, FullName: "Vera Viewer", Role: "viewer", IsActive: true, InviteStatus: "active" },
      { UserId: 3, FullName: "Mo Member", Role: "member", IsActive: true, InviteStatus: "active" },
    ];
    try {
      renderModal(501);
      await screen.findByText("Task 501");
      const user = userEvent.setup();
      const select = screen.getByTestId("task-assignee-select");
      await user.click(select.querySelector("[role='combobox']") ?? select);
      expect(await screen.findByRole("option", { name: /Mo Member/ })).toBeInTheDocument();
      expect(screen.queryByRole("option", { name: /Vera Viewer/ })).not.toBeInTheDocument();
    } finally {
      workspaceFixture.members = null;
    }
  });
```

### W5. Column select = move, open to assignees (item 11)

`src/pages/Task/Components/TaskDetail/useTaskDraft.js`: delete `ColumnId` from the draft
(line 29), from `isDirty` (line 44) and from the save payload (line 66). The column is no longer
part of "edit the task" — it is progress (`change_status`), and `sp_SaveTask` keeps the column
when `ColumnId` is absent.

`TaskDetailModal.jsx`:
- next to the delete mutation:
```js
  // Column = progress (change_status), same endpoint and gate as dragging the
  // card — so an assignee can use it, not only someone who may edit fields.
  const moveMutation = useApiMutation({
    endpoint: TASK_ENDPOINTS.tasks.moveTaskColumn,
    showSuccessMessage: false,
  });
  const moveToColumn = async (columnId) => {
    if (!task || !columnId || columnId === task.ColumnId) return;
    try {
      await moveMutation.mutateAsync({
        TaskId: task.Id,
        ColumnId: columnId,
        WorkspaceId: task.WorkspaceId,
      });
      queryClient.invalidateQueries({ queryKey: ["tasks"], refetchType: "all" });
      refetchTask();
    } catch {
      /* useApiMutation already showed why */
    }
  };
```
- Column `Combobox` (lines ≈ 266-279):
```jsx
                        value={columnOptions.find((o) => o.value === task.ColumnId) ?? null}
                        onChange={(v) => moveToColumn(v?.value)}
                        disabled={!canProgressThisTask || moveMutation.isPending}
```

Tests — `TaskDetailModal.test.jsx`:
- Replace "column change + Save dispatches save mutation with new ColumnId" with:
```js
  it("changing the column moves the card at once through moveTaskColumn", async () => {
    let moveBody;
    server.use(
      http.post(`*/api/tasks/moveTaskColumn`, async ({ request }) => {
        moveBody = await request.json();
        return HttpResponse.json({ success: true, message: "Task moved", responseCode: 200 });
      }),
    );
    renderModal(501);
    await screen.findByText("Task 501");
    const user = userEvent.setup();
    const select = await screen.findByTestId("task-column-select");
    await user.click(select.querySelector("[role='combobox']") ?? select);
    await user.click(await screen.findByRole("option", { name: /Done/i }));
    await waitFor(() =>
      expect(moveBody).toEqual({ TaskId: 501, ColumnId: 3, WorkspaceId: 100 }),
    );
  });
```
- New, in the describe with `seedAssignedToMe`:
```js
  // REGRESSION (spec P1 item 11): an assignee could drag the card but the
  // Column select was locked behind edit_fields.
  it("lets an assignee who can't edit the task change its column", async () => {
    seedAssignedToMe();
    renderModal(501);
    await screen.findByText("Task 501");
    const select = await screen.findByTestId("task-column-select");
    const combo = select.querySelector("[role='combobox']") ?? select;
    expect(combo).not.toBeDisabled();
    expect(screen.getByTestId("task-title-input")).toBeDisabled(); // still can't redefine it
  });
```
- "description edit + Save dispatches save mutation" (line 434) — if it asserts the payload, make
  sure it no longer expects `ColumnId`.

### W6. "Take this task" (item 10)

`TaskDetailModal.jsx`:
- import `UserCheck` from lucide-react, `assigneeIdsOf` from `../../../utils/taskAssignees`.
- after `canLogTime`:
```js
  // claim_task: a member/manager/owner of a shared or project board may put
  // themselves on an open task nobody has. Viewers can't hold tasks (094).
  const canClaim =
    task && !isPersonal && !task.IsCompleted &&
    assigneeIdsOf(task).length === 0 && canCreateTasks;
  const claimMutation = useApiMutation({
    endpoint: TASK_ENDPOINTS.tasks.claimTask,
    successMessage: "You've taken this task",
  });
  const claim = async () => {
    try {
      await claimMutation.mutateAsync({ TaskId: task.Id, WorkspaceId: task.WorkspaceId });
      queryClient.invalidateQueries({ queryKey: ["tasks"], refetchType: "all" });
      refetchTask();
    } catch {
      /* message already shown */
    }
  };
```
- In the Assignees cell (after the `Combobox` at ≈ line 304-319, inside the same `<div style={{ flex: 1 }}>`):
```jsx
                        {canClaim && (
                          <Button
                            variant="ghost"
                            size="sm"
                            leftIcon={<UserCheck size={14} />}
                            onClick={claim}
                            loading={claimMutation.isPending}
                            data-testid="task-claim-btn"
                            sx={{ mt: 0.75 }}
                          >
                            Take this task
                          </Button>
                        )}
```
Tests — `TaskDetailModal.test.jsx` (add `afterEach` to the vitest import; import `useWorkspaceStore` from `../../../stores/useWorkspaceStore`):
```js
describe("TaskDetailModal — take this task", () => {
  beforeEach(() => {
    taskFixture.reset();
    useAuthStore.setState({ isAuthenticated: true, token: null, user: { UserId: 1 }, UserId: 1 });
    taskFixture.seed({
      Id: 501, Title: "Task 501", WorkspaceId: 100, ColumnId: 1, ColumnTitle: "To Do",
      IsCompleted: 0, Priority: "high", CreatedByUserId: 99, AssigneesJson: null,
    });
  });
  afterEach(() =>
    useWorkspaceStore.setState({ activeWorkspaceRole: null, activeWorkspaceType: null }),
  );

  it("lets a member take an unassigned task", async () => {
    useWorkspaceStore.setState({ activeWorkspaceRole: "member", activeWorkspaceType: "shared" });
    let body;
    server.use(
      http.post(`*/api/tasks/claimTask`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, message: "Task taken", responseCode: 200 });
      }),
    );
    renderModal(501);
    await screen.findByText("Task 501");
    await userEvent.setup().click(screen.getByTestId("task-claim-btn"));
    await waitFor(() => expect(body).toEqual({ TaskId: 501, WorkspaceId: 100 }));
  });

  it("is not offered once someone has the task", async () => {
    useWorkspaceStore.setState({ activeWorkspaceRole: "member", activeWorkspaceType: "shared" });
    taskFixture.list[0].AssigneesJson = JSON.stringify([{ UserId: 2, FullName: "Bo" }]);
    renderModal(501);
    await screen.findByText("Task 501");
    expect(screen.queryByTestId("task-claim-btn")).not.toBeInTheDocument();
  });

  it("is not offered to a viewer", async () => {
    useWorkspaceStore.setState({ activeWorkspaceRole: "viewer", activeWorkspaceType: "shared" });
    renderModal(501);
    await screen.findByText("Task 501");
    expect(screen.queryByTestId("task-claim-btn")).not.toBeInTheDocument();
  });
});
```
(Check `assigneeIdsOf` reads `AssigneesJson` and falls back to `AssignedToUserId`; the seed has
neither, so it returns `[]`.)

### W7. Runs

```
cd web && pnpm exec vitest run src/pages/Task/Components/TaskDetailModal.test.jsx src/pages/Task/TaskBoard.test.jsx
cd web && pnpm exec vitest run --coverage   # full suite: TaskDetailModal/useTaskDraft/ChecklistPanel/useWorkspaceMemberOptions/handlers are shared
```
≥80% line/branch on `TaskDetailModal.jsx`, `useTaskDraft.js`, `ChecklistPanel.jsx`,
`useWorkspaceMemberOptions.jsx`.

---

## Mobile tasks

Gate: `cd mobile && pnpm typecheck && pnpm lint` (no tests on mobile).

### M1. `api/taskQueries.ts` — claim fetcher (item 10)

`TASK_ENDPOINTS` add `claimTask: "/api/tasks/claimTask",` and after `moveTaskColumn`:
```ts
/**
 * "Take this task" — puts the CALLER on an unassigned task (claim_task). The
 * server ignores who you say you are; a task that already has someone is a
 * reassignment and goes through saveTask.
 */
export const claimTask = (params: {
  TaskId: number;
  WorkspaceId?: number | null;
}): Promise<ApiEnvelope<unknown>> =>
  post(TASK_ENDPOINTS.claimTask, { WorkspaceId: null, ...params });
```
Also fix the `saveTaskChecklist` doc comment: "adding or renaming (`Id === 0`)" → ticking is
`change_status`; adding, renaming, reordering are `manage_checklist` — the server keeps text and
order as they are for a tick-only caller.

### M2. `features/tasks/TaskDetailScreen.tsx`

- Import `claimTask` from `../../api/taskQueries` and `UserCheck` from `lucide-react-native`.
- Next to `move` (≈ line 220):
```ts
  const claim = useMutation({
    mutationFn: claimTask,
    onError: (err) => toast.error(apiErrorMessage(err, "Could not take this task.")),
    onSuccess: invalidate,
  });
```
- After `const columns = columnsQuery.data ?? [];` (after the early returns):
```ts
  // claim_task: owner/manager/member, open task, nobody on it. A viewer can't
  // hold a task (094), so they never see it.
  const canClaim =
    !task.IsCompleted &&
    assignees.length === 0 &&
    (role === "owner" || role === "manager" || role === "member");
```
- `menuActions` literal, first entry:
```ts
    ...(canClaim
      ? [
          {
            key: "claim",
            label: "Take this task",
            icon: UserCheck,
            onPress: () => claim.mutate({ TaskId: taskId, WorkspaceId: task.WorkspaceId }),
          } satisfies SheetAction,
        ]
      : []),
```
- Header actions condition (≈ line 429): `can.changeStatus || can.editFields || canClaim` (a plain
  member who is neither creator nor assignee has no menu today, so "Take" would be unreachable).
- Delete dialog copy (≈ line 632-633) — no longer true that it can't be undone or that the
  checklist/comments go with it:
```tsx
        message="It disappears from every board and list. Its history is kept."
```

### M3. `features/tasks/Checklist.tsx` — last step stays (item 2)

Line ≈ 125: `{canManage ? (` → `{canManage && total > 1 ? (` with a one-line comment:
`{/* The last step stays — a task with no steps can never complete (094). */}`.

### M4. `features/tasks/TaskFormScreen.tsx` — no viewer assignees (item 4)

Line 155: `.filter((m) => m.InviteStatus === "active" && m.IsActive && m.Role !== "viewer")`, and
extend the comment above it: "…A viewer can't complete a task, so the server refuses them too."

### M5. Nothing else

- Item 8: `fetchTaskById` already hits the single-task fetch → stamps "Seen".
- Item 11: "Move to column" already uses `moveTaskColumn` gated on `changeStatus`; the server moves
  the card on completion.
- Item 3: tick payload still sends `ItemText`/`SortOrder`; the server ignores them for a tick-only
  caller, so installed builds keep working.

---

## Open decisions

| # | Question the spec leaves open | Recommended default (what this plan does) |
|---|---|---|
| D1 | Item 5 lists **archive** among "leaving": should archiving a board strip every open task's assignees? It is the only destructive one — unarchive can't restore them. | Follow the spec: archive unassigns all open tasks (`@All = 1`), **no notifications** (`@Notify = 0`), unarchive restores nothing. Alternative: don't unassign on archive; hide archived boards from My Work (item 9) and have P3's sweep skip them. Ask the user — one line in A9 to drop. |
| D2 | Soft delete: delete the task's **attachment files** (today `cascadeDelete`) or keep them? | Keep. The task row still exists; files are part of its history, and every read of them is gated by the task (denied once deleted). Disk cost is small. No undelete UI (YAGNI) — undelete is one `UPDATE` if ever needed. |
| D3 | Item 11 backfill: move today's 8 completed cards to the last column, and the 1 open card (10044, in "Done") back to the first? | Yes, both — after A2 adds a step to 10044 it is open, and a "Done" column holding an open task is exactly what item 11 removes. Drop the second arm of the A2 `UPDATE` if the user prefers to leave open cards where they are. |
| D4 | Item 3: a tick-only caller sends a different `ItemText` — 403, or ignore? | Ignore (keep stored text/order, apply the tick). Installed mobile builds always resend text; a 403 would break nothing today but would make any client drift fail a tick. |
| D5 | Item 4: demoting an assigned member to viewer — refuse the role change, or unassign? | Unassign (A8) and notify the owner per task left with nobody. Role changes are an owner/manager act; blocking them on task state is friction. |
| D6 | Item 5: who is told, and how often? | Only the board **owner**, one `task_unassigned` notification per task that ended up with **nobody** (tasks that still have a co-assignee are not reported). Self-actions skipped (`@SkipSelf`). The removed person is not notified. |
| D7 | Item 8: keep writing `DeliveredAt` rows for non-assignee viewers (managers) on single fetch? | Keep (unchanged behaviour); stamp `FirstSeenAt/LastSeenAt` only for assignees. Nothing reads the table yet; P3's timeline reads only assignee rows. |
| D8 | Item 10: may a completed task be claimed? Should claiming notify anyone? | No (409). No notification — the claimer is acting on themselves; history logs "Took this task". |
| D9 | Item 11: reopen moves the card to the **first** column even if it was in "In Progress". | As the spec says (first column). A manager adding a step to a done task therefore sends the card back to "To Do". |
| D10 | Item 15: an admin calling `getTimeEntries` with no `TaskId`. | Company-wide (as today, but now actually limited to the company) minus other people's personal boards. |

---

## Risks / callers affected

- **Deploy order:** SQL first, backend immediately after. Old backend on new SQL is safe (all new
  params defaulted; `sp_DeleteTask` returning an extra `WorkspaceId` column is harmless). New
  backend on old SQL fails `claimTask`, checklist saves (`@CanEdit` unknown) and time-entry reads
  (`@ViewerUserId` unknown).
- **Shared SP bodies with other P1 items — merge, don't overwrite:**
  - `sp_FetchTask` — item 9 (My Work filters, archived) edits the same list `WHERE`; A12's two
    hunks must be in the final body.
  - `sp_RecomputeTaskCompletion` — item 7 (notify on complete/reopen/unblock) hooks the same
    transition as A13.
  - `sp_FetchKanbanColumn` — item 14 rewrites it; its `TaskCount` subquery should add
    `AND t.IsDeleted = 0` or deleted cards inflate the column count (and the "N tasks will move"
    delete prompt).
  - `sp_SaveTask` — item 12 (history diffs) is controller-side; A16 hunks are independent.
  - User deactivation (item 16, P1-B) should call `sp_UnassignInvalidAssignees` for every board the
    user is an active member of — the helper already treats an inactive user as invalid.
  - `taskController.save` / `TaskDetailModal` are touched by items 12/13 too.
- **Every task read that skips `sp_CheckTaskPermission`** must filter `IsDeleted`: covered here are
  `sp_FetchTask` (list), `sp_AddTaskDependency` (blocker), `sp_ClaimTask`,
  `sp_UnassignInvalidAssignees`, `sp_SaveTask` (parent). Not covered (0 live rows use them):
  `sp_FetchProject.TaskCount`, `sp_DeleteProject`/`sp_DeleteTeam` "has tasks" 409s (a soft-deleted
  task still blocks deleting its team/project — add `AND IsDeleted = 0` there if the user wants),
  `sp_DeleteKanbanColumn` (moves deleted cards too — harmless). P3's `tblTaskTat` and P4 reports
  must filter `IsDeleted` themselves.
- `sp_DeleteWorkspace` still hard-deletes everything, deleted tasks included — unchanged and fine.
- Notifications pointing at a deleted task open to "Task not found or access denied" (web 404
  path, mobile "Task not available") — acceptable.
- `sp_UnassignInvalidAssignees` must never be called via `INSERT … EXEC` (it nests one). All five
  callers call it with plain `EXEC`; none of them is itself `INSERT … EXEC`'d (checked in
  `sys.sql_modules`).
- The checklist SQL rules (A14, A15) and the "Seen"/board moves (A12, A13) are SQL-only; mocked
  jest tests cannot prove them — the A20 verify block is their test, plus the live API check the
  phase plan calls for (same as 093).
- Existing tests that change meaning (not silenced, rewritten): web "bulk delete surfaces 409…",
  "column change + Save dispatches save mutation with new ColumnId", the two single-item checklist
  remove tests; backend none (defaults keep them green).
- `assertRecordAccess` and the new `taskAllowed` both call `sp_CheckTaskPermission`: a tick now
  costs two permission calls. Fine at this scale; fold into one SP call if it ever shows up.
