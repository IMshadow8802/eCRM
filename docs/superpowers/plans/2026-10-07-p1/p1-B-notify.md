# P1-B — Notifications open the task (6), told when it's done (7), My Work on web (9), history diffs (12)

Planner notes: every SP quoted below was read live from `eCRM+` via `OBJECT_DEFINITION` on 2026-10-07.
Rules honoured: SQL is a file the user applies (§0.2); no git writes; tests ship with every backend/web change (§0.4); mobile gate is `pnpm typecheck && pnpm lint`.

Live facts this plan rests on:
- `tblNotifications.EntityType VARCHAR(20)`. Live rows: `comment/comment_added` 24 (7 unread), `task/task_assigned` 39, `ticket/*` 4, `Workspace/*` 13.
- `sp_CreateNotification` **returns a status row**. `sp_AddWorkspaceMember` / `sp_TransferTicket` capture it with `INSERT INTO @t EXEC`. `sp_NotifyCommentAdded` does not, so its rows leak to the caller, which ignores them.
- `sp_RecomputeTaskCompletion` is called only by `sp_SaveTaskChecklist` and `sp_DeleteTaskChecklist`. `sp_ResolveDependencies` is called only by Recompute. Its own comment says a result set leaking out of this chain once displaced the checklist status row ("fail then works" bug).
- The `tblActivityLog` columns `FieldName/OldValue/NewValue` already exist, and `logActivity` already accepts them. Web `ActivityRow.jsx` already renders `OldValue → NewValue` when both are set. Mobile `ActivityTab.tsx` renders only `Description`.
- `tblMenu`: Tasks = Id 2 (`ParentId 0`, `/tasks`). `sp_ValidateUser` orders menus `ORDER BY m.ParentId, m.Id`, so a new top-level row lands **after Admin (35)**. `tblMenu.Id` is IDENTITY. `tblGroupAccess` for MenuId 2 has **duplicate rows** for groups 9–17 (two each), so the grant must `SELECT DISTINCT GroupId`.
- `tblWorkspaces.IsArchived BIT NOT NULL DEFAULT 0` exists. `tblTasks.IsDeleted` does **not** exist yet; another planner adds it as `BIT NOT NULL DEFAULT 0`.

---

## SQL changes

Everything below goes into the single P1 script (the spec says one script per phase). Working name: `backend/sql/094_p1_tasks_people.sql`, section "B". The script starts with `SET QUOTED_IDENTIFIER ON; SET ANSI_NULLS ON;`, uses `CREATE OR ALTER`, and **must come after the soft-delete section** (it references `tblTasks.IsDeleted`).

### B1. `sp_RecomputeTaskCompletion` reports the transition (item 7)

Full body. It is short, so it is rewritten whole:

```sql
CREATE OR ALTER PROCEDURE dbo.sp_RecomputeTaskCompletion
    @TaskId       BIGINT,
    @ActingUserId INT = NULL,
    @Transition   VARCHAR(10) = NULL OUTPUT   -- 'completed' | 'reopened' | NULL (no change)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Total INT, @Open INT, @Was BIT;

    SELECT @Was = ISNULL(IsCompleted, 0) FROM dbo.tblTasks WHERE Id = @TaskId;
    SELECT @Total = COUNT(*),
           @Open  = SUM(CASE WHEN ISNULL(IsCompleted,0) = 0 THEN 1 ELSE 0 END)
      FROM dbo.tblTaskChecklist WHERE TaskId = @TaskId;

    DECLARE @Now BIT = CASE WHEN @Total > 0 AND @Open = 0 THEN 1 ELSE 0 END;

    UPDATE dbo.tblTasks
       SET IsCompleted = @Now,
           CompletedDate = CASE
               WHEN @Now = 1 AND CompletedDate IS NULL THEN GETDATE()
               WHEN @Now = 0 THEN NULL
               ELSE CompletedDate END,
           CompletedByUserId = CASE
               WHEN @Now = 1 AND CompletedByUserId IS NULL
               THEN ISNULL(@ActingUserId, CreatedByUserId)
               WHEN @Now = 0 THEN NULL
               ELSE CompletedByUserId END,
           UpdatedDate = GETDATE()
     WHERE Id = @TaskId;

    -- An OUTPUT parameter, never a result set: a SELECT here would leak into
    -- sp_SaveTaskChecklist/sp_DeleteTaskChecklist and displace their status row.
    SET @Transition = CASE WHEN @Now = 1 AND @Was = 0 THEN 'completed'
                           WHEN @Now = 0 AND @Was = 1 THEN 'reopened' END;

    IF (@Now = 1 AND @Was = 0)
        EXEC dbo.sp_ResolveDependencies @ResolvedTaskId = @TaskId;
END
```
Diff against live: the new `@Transition` parameter plus the `SET @Transition` line. Nothing else changes.
**Coordinate:** item 11 ("Board = completion", moving the card on complete/reopen) also edits this procedure. Whoever lands second merges. The `@Transition` value is exactly the hook item 11 needs.

### B2. Checklist SPs return `CompletionChange` (item 7)

`sp_SaveTaskChecklist`. Before (live):
```sql
    EXEC dbo.sp_RecomputeTaskCompletion @TaskId = @TaskId, @ActingUserId = @ActingUserId;

    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
           @Id AS ChecklistId;
```
After:
```sql
    DECLARE @Transition VARCHAR(10);
    EXEC dbo.sp_RecomputeTaskCompletion @TaskId = @TaskId, @ActingUserId = @ActingUserId,
         @Transition = @Transition OUTPUT;

    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
           @Id AS ChecklistId, @Transition AS CompletionChange;
```

`sp_DeleteTaskChecklist`. Before (live):
```sql
    EXEC dbo.sp_RecomputeTaskCompletion @TaskId = @TaskId, @ActingUserId = @ActingUserId;

    SELECT 200 AS ResponseCode, 'Checklist item deleted' AS ResponseMess,
           @Id AS ChecklistId, @TaskId AS TaskId;
```
After:
```sql
    DECLARE @Transition VARCHAR(10);
    EXEC dbo.sp_RecomputeTaskCompletion @TaskId = @TaskId, @ActingUserId = @ActingUserId,
         @Transition = @Transition OUTPUT;

    SELECT 200 AS ResponseCode, 'Checklist item deleted' AS ResponseMess,
           @Id AS ChecklistId, @TaskId AS TaskId, @Transition AS CompletionChange;
```
**Coordinate:** item 2 ("refuse deleting the last step") and item 3 ("step rights split") edit these same two procedures. Apply these hunks on top of their versions. The early-return status rows do not need the new column, because the controller reads it as optional.

### B3. New `sp_NotifyTaskCompletion` (item 7)

```sql
-- Notifies on a completion transition. Called by taskController AFTER the
-- checklist SP commits — same shape as sp_NotifyTaskAssigned / sp_NotifyCommentAdded.
-- Returns ONE result set: who was actually notified, for realtime emitToUser.
CREATE OR ALTER PROCEDURE dbo.sp_NotifyTaskCompletion
    @TaskId      BIGINT,
    @ActorUserId INT,
    @Event       VARCHAR(10)          -- 'completed' | 'reopened'
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Title VARCHAR(500), @CompId BIGINT, @BranchId BIGINT, @WsType VARCHAR(20);
    DECLARE @ActorName VARCHAR(200);
    DECLARE @Sent TABLE (ResponseCode INT, ResponseMess VARCHAR(400),
                         NotificationId BIGINT, UserId INT, Type VARCHAR(40));

    SELECT @Title = t.Title, @CompId = w.CompId, @BranchId = w.BranchId, @WsType = w.Type
      FROM dbo.tblTasks t
      JOIN dbo.tblWorkspaces w ON w.Id = t.WorkspaceId
     WHERE t.Id = @TaskId AND t.IsDeleted = 0;

    -- Personal = owner-only: nobody else to tell.
    IF (@WsType IS NULL OR @WsType = 'personal' OR @Event NOT IN ('completed','reopened'))
    BEGIN
        SELECT UserId, NotificationId, Type FROM @Sent;
        RETURN;
    END

    SELECT @ActorName = FullName FROM dbo.tblUser WHERE Id = @ActorUserId;

    DECLARE @Type VARCHAR(40) = CASE @Event WHEN 'completed' THEN 'task_completed' ELSE 'task_reopened' END;
    DECLARE @NTitle VARCHAR(200) = CASE @Event WHEN 'completed' THEN 'Task completed' ELSE 'Task reopened' END;
    DECLARE @NBody NVARCHAR(1000) = LEFT(ISNULL(@ActorName, 'Someone')
        + CASE @Event WHEN 'completed' THEN ' completed: ' ELSE ' reopened: ' END
        + ISNULL(@Title, ''), 1000);

    -- Creator + everyone who assigned a current assignee. Actor excluded
    -- (sp_CreateNotification also skips self; this keeps the cursor short).
    DECLARE @To TABLE (UserId INT PRIMARY KEY);
    INSERT INTO @To (UserId)
    SELECT DISTINCT UserId FROM (
        SELECT CreatedByUserId AS UserId FROM dbo.tblTasks WHERE Id = @TaskId
        UNION
        SELECT AssignedByUserId FROM dbo.tblTaskAssignee WHERE TaskId = @TaskId
    ) s
    WHERE UserId IS NOT NULL AND UserId <> @ActorUserId;

    DECLARE @U INT;
    DECLARE cur CURSOR FAST_FORWARD LOCAL FOR SELECT UserId FROM @To;
    OPEN cur; FETCH NEXT FROM cur INTO @U;
    WHILE (@@FETCH_STATUS = 0)
    BEGIN
        INSERT INTO @Sent
        EXEC dbo.sp_CreateNotification
             @UserId = @U, @Type = @Type, @EntityType = 'task', @EntityId = @TaskId,
             @ActorUserId = @ActorUserId, @Title = @NTitle, @Body = @NBody,
             @CompId = @CompId, @BranchId = @BranchId, @SkipSelf = 1;
        FETCH NEXT FROM cur INTO @U;
    END
    CLOSE cur; DEALLOCATE cur;

    -- A finished blocker frees its dependents: tell their assignees, but only
    -- for dependents with no OTHER open blocker left.
    IF (@Event = 'completed')
    BEGIN
        DECLARE @DepId BIGINT, @DepTitle VARCHAR(500), @DepComp BIGINT, @DepBranch BIGINT;
        DECLARE dcur CURSOR FAST_FORWARD LOCAL FOR
            SELECT DISTINCT d.TaskId, ta.UserId, dt.Title, dw.CompId, dw.BranchId
              FROM dbo.tblTaskDependencies d
              JOIN dbo.tblTasks dt       ON dt.Id = d.TaskId
                                        AND ISNULL(dt.IsCompleted, 0) = 0 AND dt.IsDeleted = 0
              JOIN dbo.tblWorkspaces dw  ON dw.Id = dt.WorkspaceId AND dw.IsArchived = 0
              JOIN dbo.tblTaskAssignee ta ON ta.TaskId = d.TaskId
             WHERE d.DependsOnTaskId = @TaskId AND d.Type = 'blocks'
               AND ta.UserId <> @ActorUserId
               AND NOT EXISTS (SELECT 1 FROM dbo.tblTaskDependencies d2
                                 JOIN dbo.tblTasks b ON b.Id = d2.DependsOnTaskId
                                WHERE d2.TaskId = d.TaskId AND d2.Type = 'blocks'
                                  AND ISNULL(b.IsCompleted, 0) = 0);
        OPEN dcur; FETCH NEXT FROM dcur INTO @DepId, @U, @DepTitle, @DepComp, @DepBranch;
        WHILE (@@FETCH_STATUS = 0)
        BEGIN
            DECLARE @UBody NVARCHAR(1000) =
                LEFT(ISNULL(@Title, '') + N' is done — you can start: ' + ISNULL(@DepTitle, ''), 1000);
            INSERT INTO @Sent
            EXEC dbo.sp_CreateNotification
                 @UserId = @U, @Type = 'task_unblocked', @EntityType = 'task', @EntityId = @DepId,
                 @ActorUserId = @ActorUserId, @Title = 'Task unblocked', @Body = @UBody,
                 @CompId = @DepComp, @BranchId = @DepBranch, @SkipSelf = 1;
            FETCH NEXT FROM dcur INTO @DepId, @U, @DepTitle, @DepComp, @DepBranch;
        END
        CLOSE dcur; DEALLOCATE dcur;
    END

    SELECT UserId, NotificationId, Type FROM @Sent WHERE NotificationId IS NOT NULL;
END
```
Why a controller-called procedure rather than an EXEC inside Recompute: (a) it matches `sp_NotifyTaskAssigned` and `sp_NotifyCommentAdded`, which the controller also calls after the write; (b) the controller needs the recipient ids to `emitToUser(..., NOTIFICATIONS)`, and Recompute can't hand those back without a result set, which is the known leak; (c) a notification failure can't roll back the tick.

### B4. Comment notifications point at the task (item 6)

`sp_NotifyCommentAdded`. Before (live):
```sql
            @EntityType  = 'comment',
            @EntityId    = @CommentId,
```
After:
```sql
            @EntityType  = 'task',      -- a comment is opened BY opening its task
            @EntityId    = @TaskId,
```
(`Type` stays `comment_added` / `reply`, so the bell still says "New comment".)

Backfill and cleanup in the same section:
```sql
UPDATE n SET n.EntityType = 'task', n.EntityId = c.TaskId
  FROM dbo.tblNotifications n
  JOIN dbo.tblTaskComments c ON c.Id = n.EntityId
 WHERE n.EntityType = 'comment';

-- Whatever is still 'comment' points at a deleted comment (audit B19: 2 rows). Nothing to open.
DELETE FROM dbo.tblNotifications WHERE EntityType = 'comment';
```

### B5. `sp_FetchTask` filters (item 9)

The live body is about 15 KB. The script carries the **live body with these hunks** (`CREATE` → `CREATE OR ALTER`). Fetch it with `SELECT OBJECT_DEFINITION(OBJECT_ID('sp_FetchTask'))` when writing the script; do not retype it.

Hunk 1, the parameter list. Before:
```sql
    @PageSize                INT           = 25,
    @SearchTerm              NVARCHAR(200) = NULL
AS
```
After:
```sql
    @PageSize                INT           = 25,
    @SearchTerm              NVARCHAR(200) = NULL,
    @AssigneeUserId          INT           = NULL,   -- narrows; never widens
    @OnlyOpen                BIT           = 0,
    @Overdue                 BIT           = 0
AS
```

Hunk 2 goes in **twice**, in the count query (ends `;`) and in the page query (followed by `ORDER BY`), or pagination lies. Before (both places):
```sql
            OR team.Name LIKE '%' + @SearchTerm + '%')
```
After (count query: append `;` after the last line; page query: `ORDER BY` follows):
```sql
            OR team.Name LIKE '%' + @SearchTerm + '%')
       AND (@AssigneeUserId IS NULL
            OR EXISTS (SELECT 1 FROM dbo.tblTaskAssignee fa
                        WHERE fa.TaskId = t.Id AND fa.UserId = @AssigneeUserId))
       AND (@OnlyOpen = 0 OR ISNULL(t.IsCompleted, 0) = 0)
       AND (@Overdue  = 0 OR (ISNULL(t.IsCompleted, 0) = 0
                              AND t.DueDate < CAST(GETDATE() AS DATE)))
       -- Cross-workspace lists (My Work, mobile, Today) skip archived boards.
       -- An explicit @WorkspaceId still opens an archived board read-only.
       AND (@WorkspaceId IS NOT NULL OR ISNULL(w.IsArchived, 0) = 0)
       AND t.IsDeleted = 0
```
Both queries already `LEFT JOIN dbo.tblWorkspaces w`, so no join changes. The `@Id > 0` branch and the two NULL-shaped branches stay untouched. **Coordinate:** the soft-delete planner owns `IsDeleted` on the `@Id` branch. If they also touch the list predicates, one of the two hunks is dropped; the predicate must appear once per query.
`ORDER BY` stays as it is. My Work sorts overdue-first on the client (≤200 rows; see Risks).

### B6. `sp_SaveTask` returns field diffs (item 12)

Edit-branch only; create is unchanged. Three hunks on the live body (CREATE OR ALTER, rest byte-identical):

Hunk 1, after `SELECT @OldColumnId = ColumnId FROM dbo.tblTasks WHERE Id = @Id;` (inside the `ELSE` of the permission block):
```sql
        SELECT @OldColumnId = ColumnId FROM dbo.tblTasks WHERE Id = @Id;
        SELECT @OldTitle = Title, @OldPriority = Priority, @OldDueDate = DueDate,
               @OldDescription = Description
          FROM dbo.tblTasks WHERE Id = @Id;
        INSERT INTO @OldAssignees (UserId) SELECT UserId FROM dbo.tblTaskAssignee WHERE TaskId = @Id;
```
and next to `DECLARE @OldColumnId INT;`:
```sql
    DECLARE @OldColumnId INT;
    DECLARE @OldTitle VARCHAR(500), @OldPriority VARCHAR(20), @OldDueDate DATE,
            @OldDescription NVARCHAR(MAX);
    DECLARE @OldAssignees TABLE (UserId INT PRIMARY KEY);
```

Hunk 2, edit branch. Before (live):
```sql
            COMMIT TRANSACTION;
            SET @ResponseCode = 200; SET @ResponseMess = 'Task updated';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, @Id AS TaskId;

            -- 2nd result set: who was newly assigned, for the caller to notify.
            SELECT UserId AS NewAssigneeUserId FROM @NewAssignees;
        END
```
After:
```sql
            COMMIT TRANSACTION;
            SET @ResponseCode = 200; SET @ResponseMess = 'Task updated';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, @Id AS TaskId;

            -- 2nd result set: who was newly assigned, for the caller to notify.
            SELECT UserId AS NewAssigneeUserId FROM @NewAssignees;

            -- 3rd result set: what this edit changed, display-ready, for task history.
            DECLARE @NewColumnId INT = (SELECT ColumnId FROM dbo.tblTasks WHERE Id = @Id);
            SELECT Field, OldValue, NewValue FROM (
                SELECT 'Title' AS Field, CAST(@OldTitle AS NVARCHAR(MAX)) AS OldValue,
                       CAST(@Title AS NVARCHAR(MAX)) AS NewValue
                 WHERE ISNULL(@OldTitle, '') <> ISNULL(@Title, '')
                UNION ALL
                SELECT 'Priority', @OldPriority, @Priority
                 WHERE ISNULL(@OldPriority, '') <> ISNULL(@Priority, '')
                UNION ALL
                SELECT 'DueDate',
                       ISNULL(CONVERT(NVARCHAR(10), @OldDueDate, 105), N'none'),
                       ISNULL(CONVERT(NVARCHAR(10), @DueDate, 105), N'none')
                 WHERE ISNULL(@OldDueDate, '19000101') <> ISNULL(@DueDate, '19000101')
                UNION ALL
                SELECT 'Description', NULL, NULL
                 WHERE ISNULL(@OldDescription, N'') <> ISNULL(@Description, N'')
                UNION ALL
                SELECT 'Column', oc.Title, nc.Title
                  FROM (SELECT 1 x) one
                  LEFT JOIN dbo.tblKanbanColumns oc ON oc.Id = @OldColumnId
                  LEFT JOIN dbo.tblKanbanColumns nc ON nc.Id = @NewColumnId
                 WHERE ISNULL(@OldColumnId, 0) <> ISNULL(@NewColumnId, 0)
                UNION ALL
                SELECT 'AssigneesAdded', NULL,
                       (SELECT STRING_AGG(u.FullName, ', ') FROM tblTaskAssignee ta
                          JOIN tblUser u ON u.Id = ta.UserId
                         WHERE ta.TaskId = @Id
                           AND ta.UserId NOT IN (SELECT UserId FROM @OldAssignees))
                 WHERE @HasAssigneeInput = 1
                   AND EXISTS (SELECT 1 FROM tblTaskAssignee ta WHERE ta.TaskId = @Id
                                AND ta.UserId NOT IN (SELECT UserId FROM @OldAssignees))
                UNION ALL
                SELECT 'AssigneesRemoved',
                       (SELECT STRING_AGG(u.FullName, ', ') FROM @OldAssignees o
                          JOIN tblUser u ON u.Id = o.UserId
                         WHERE o.UserId NOT IN (SELECT UserId FROM tblTaskAssignee WHERE TaskId = @Id)),
                       NULL
                 WHERE @HasAssigneeInput = 1
                   AND EXISTS (SELECT 1 FROM @OldAssignees o
                                WHERE o.UserId NOT IN (SELECT UserId FROM tblTaskAssignee WHERE TaskId = @Id))
            ) ch;
        END
```
(Date style 105 = `dd-mm-yyyy`, matching the app's `DD-MM-YYYY`.)
**Coordinate:** the TAT/item-5 planner wants sp_SaveTask to return *removed* assignee ids (audit §3 #2). Put those in **RS4** (`SELECT UserId AS RemovedAssigneeUserId FROM @OldAssignees WHERE UserId NOT IN (…)`) so RS3 stays this diff. Both planners must agree the order before the script is written. Item 4 (viewers can't be assignees) and item 15 (parent/team/project checks) also edit sp_SaveTask; all hunks get merged onto one copy of the live body.

### B7. My Work menu row + grants (item 9)

```sql
IF NOT EXISTS (SELECT 1 FROM dbo.tblMenu WHERE Route = N'/my-work')
    INSERT INTO dbo.tblMenu (ParentId, Description, Image, FormId, MenuType, ActualId,
                             IsAllowed, FormName, OpenStyle, Route)
    VALUES (0, 'My Work', NULL, 0, 1, 0, 1, NULL, 1, N'/my-work');

DECLARE @MyWorkMenuId INT = (SELECT Id FROM dbo.tblMenu WHERE Route = N'/my-work');

-- Everyone who can see Tasks (menu 2) can see My Work. DISTINCT: menu 2 has
-- duplicate grant rows for groups 9-17.
INSERT INTO dbo.tblGroupAccess (GroupId, MenuId, CanAdd, CanEdit, CanDelete, CanView)
SELECT DISTINCT ga.GroupId, @MyWorkMenuId, 0, 0, 0, 1
  FROM dbo.tblGroupAccess ga
 WHERE ga.MenuId = 2 AND ga.CanView = 1
   AND NOT EXISTS (SELECT 1 FROM dbo.tblGroupAccess x
                    WHERE x.GroupId = ga.GroupId AND x.MenuId = @MyWorkMenuId);
```
Check before writing: is `tblGroupAccess.Id` an IDENTITY? Read `COLUMNPROPERTY(OBJECT_ID('tblGroupAccess'),'Id','IsIdentity')` when writing the script. If it is not, mirror the `086` pattern (`MAX(Id)+ROW_NUMBER()`).
The row has to be applied to **both** clients' DBs (eCRM+ and SolarCRM). Users see it after re-login (menus load at login).

### Verify after apply

```sql
-- B1-B3 objects + quoted identifier
SELECT name, uses_quoted_identifier FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
 WHERE o.name IN ('sp_RecomputeTaskCompletion','sp_SaveTaskChecklist','sp_DeleteTaskChecklist',
                  'sp_NotifyTaskCompletion','sp_NotifyCommentAdded','sp_FetchTask','sp_SaveTask');   -- all 1
SELECT name FROM sys.parameters WHERE object_id = OBJECT_ID('sp_RecomputeTaskCompletion') AND is_output = 1; -- @Transition
SELECT name FROM sys.parameters WHERE object_id = OBJECT_ID('sp_FetchTask')
 AND name IN ('@AssigneeUserId','@OnlyOpen','@Overdue');                                                  -- 3 rows
-- B4: no comment-entity notifications left; new code writes 'task'
SELECT COUNT(*) FROM tblNotifications WHERE EntityType = 'comment';                                        -- 0
SELECT CHARINDEX('@EntityType  = ''task''', OBJECT_DEFINITION(OBJECT_ID('sp_NotifyCommentAdded')));       -- > 0
-- B5: predicate present twice
SELECT (LEN(d) - LEN(REPLACE(d, '@AssigneeUserId IS NULL', ''))) / LEN('@AssigneeUserId IS NULL')
  FROM (SELECT OBJECT_DEFINITION(OBJECT_ID('sp_FetchTask')) d) x;                                          -- 2
-- B6: RS3 present
SELECT CHARINDEX('AssigneesRemoved', OBJECT_DEFINITION(OBJECT_ID('sp_SaveTask')));                        -- > 0
-- B7
SELECT m.Id, m.Route, COUNT(ga.Id) grants FROM tblMenu m LEFT JOIN tblGroupAccess ga ON ga.MenuId = m.Id
 WHERE m.Route = '/my-work' GROUP BY m.Id, m.Route;                       -- 1 row, grants = distinct groups on menu 2 (12 today)
```
Live API check (like 093's), by the user with a real token: tick the last step of a shared task as an assignee. The response `data.completionChange = "completed"`, and the creator's `fetchNotifications` gets a `task_completed` row with `EntityType: "task"`.

---

## Backend tasks

All tests run with `cd backend && pnpm exec jest <file>`. The coverage gate is `pnpm exec jest taskController --coverage --collectCoverageFrom='src/controllers/taskController.js'` (≥80% on touched lines/branches).

### BE-1. Completion notifications (item 7). `src/controllers/taskController.js`

1. **Test first** (`tests/unit/controllers/taskController.test.js`, new `describe("checklist completion notify")`):
   - `saveChecklist` tick, SP row `{ResponseCode:200, ChecklistId:5, CompletionChange:"completed"}`, then `sp_NotifyTaskCompletion` mocked `{recordsets:[[{UserId:3,NotificationId:1,Type:"task_completed"},{UserId:4,...}]]}`. After `await new Promise(r => setImmediate(r))`, assert call[1] is `["sp_NotifyTaskCompletion", {TaskId:11, ActorUserId:7, Event:"completed"}]`, `emitToUser` called for 3 and 4 with `SCOPES.NOTIFICATIONS`, and `logActivity` called with `{fieldName:"Completion", newValue:"completed", description:"Task completed"}`. Mock `../../../src/realtime/events` (`emitToUser: jest.fn(), emitToWorkspace: jest.fn()`) if the file does not already.
   - Untick with `CompletionChange:"reopened"` → `Event:"reopened"`.
   - `deleteChecklist` with `CompletionChange:"completed"` (deleting the last open step) → notify called.
   - **Regression** (fails today): the response body has `data.completionChange` (`"completed"`), so clients can toast "Task completed". Today saveChecklist returns only `checklistId` and deleteChecklist no `data`.
   - No-change path (`CompletionChange: null`) → exactly 1 SP call, no emit.
   - Notify SP rejects → response still 200, `console.error` called (spy).
2. **Code.** Add a module-level helper next to the class:
   ```js
   // Fire-and-forget like sp_NotifyTaskAssigned: a failed ping never fails the tick.
   function notifyCompletion(req, taskId, change) {
     if (change !== "completed" && change !== "reopened") return;
     database
       .executeStoredProcedure("sp_NotifyTaskCompletion", {
         TaskId: taskId, ActorUserId: req.user.UserId, Event: change,
       })
       .then((r) => {
         for (const id of new Set((r?.recordsets?.[0] ?? []).map((x) => x.UserId))) {
           emitToUser(id, SCOPES.NOTIFICATIONS);
         }
       })
       .catch((e) => console.error("sp_NotifyTaskCompletion failed:", e.message));
   }
   ```
   In `saveChecklist` and `deleteChecklist`, inside `if (ok)` after the existing logActivity:
   ```js
   const change = spResponse.CompletionChange ?? null;
   if (change) {
     await logActivity({ entityType: "Task", entityId: TaskId, action: ACTIONS.STATUS_CHANGED,
       fieldName: "Completion", newValue: change,
       description: change === "completed" ? "Task completed" : "Task reopened", req });
     notifyCompletion(req, TaskId, change);
   }
   ```
   Response data: saveChecklist `{ checklistId, completionChange: spResponse.CompletionChange ?? null }`; deleteChecklist gains `data: ok ? { completionChange: … } : null`.

### BE-2. `fetch` filters (item 9). `taskController.fetch`

1. **Test first** (`describe("taskController.fetch")`):
   - Forwards `{AssigneeUserId: 7, OnlyOpen: 1, Overdue: 0}` when the body has `AssigneeUserId: 7, OnlyOpen: true`.
   - Defaults: no body flags → `AssigneeUserId: null, OnlyOpen: 0, Overdue: 0`. Update the existing "passes WorkspaceId filter…" `toMatchObject`/`toEqual` if it is strict.
   - Junk `AssigneeUserId: "abc"` / `-1` → `null`. This is a narrowing filter, so dropping junk is the safe direction.
2. **Code.** Destructure `AssigneeUserId = null, OnlyOpen = false, Overdue = false` and pass
   `AssigneeUserId: positiveInt(AssigneeUserId), OnlyOpen: OnlyOpen ? 1 : 0, Overdue: Overdue ? 1 : 0`
   (`positiveInt` already returns the number or `null`). No scope check is needed: the SP's membership clause still gates every row, and the filter only narrows. Anyone may ask "tasks assigned to user X" and gets only the ones they can already see. That is what the P3 manager view needs.

### BE-3. History diffs (item 12). `taskController.save`

1. **Test first:**
   - Edit with RS3 `[{Field:"Priority",OldValue:"medium",NewValue:"high"},{Field:"AssigneesAdded",OldValue:null,NewValue:"Ravi"},{Field:"AssigneesRemoved",OldValue:"Neha",NewValue:null},{Field:"DueDate",OldValue:"none",NewValue:"10-10-2026"}]` (extend `mockSequence` with a 4th arg `changes` → `recordsets[2]`). Assert `logActivity` is called with
     `{action:"Updated", fieldName:"Priority", oldValue:"medium", newValue:"high", description:"Priority changed"}`,
     `{action:"Assigned", fieldName:"Assignees", description:"Assigned Ravi"}`,
     `{action:"Assigned", fieldName:"Assignees", description:"Unassigned Neha"}`,
     `{fieldName:"DueDate", oldValue:"none", newValue:"10-10-2026", description:"Due date changed"}`,
     and **not** with the generic `"Task … updated"`. This is the regression: today only the generic row is written.
   - Edit with empty RS3 (e.g. EstimatedHours-only) → the generic `"Task X updated"` row is still written (unchanged behaviour).
   - Create → unchanged (`Created`, no diff rows).
   - Description → `{fieldName:"Description", description:"Description edited"}` with no values.
   - Add `ASSIGNED: "Assigned"` to the jest ACTIONS mock if missing. It is already there.
2. **Code.** Replace the single `logActivity` in `save` with:
   ```js
   const LABEL = { Title: "Title", Priority: "Priority", DueDate: "Due date", Column: "Column", Description: "Description" };
   const changes = Id > 0 ? (result.recordsets[2] ?? []) : [];
   if (changes.length === 0) {
     await logActivity({ /* existing generic call, unchanged */ });
   }
   for (const c of changes) {
     if (c.Field === "AssigneesAdded" || c.Field === "AssigneesRemoved") {
       const added = c.Field === "AssigneesAdded";
       await logActivity({ entityType: "Task", entityId: spResponse.TaskId, action: ACTIONS.ASSIGNED,
         fieldName: "Assignees", description: `${added ? "Assigned" : "Unassigned"} ${added ? c.NewValue : c.OldValue}`, req });
     } else {
       await logActivity({ entityType: "Task", entityId: spResponse.TaskId, action: ACTIONS.UPDATED,
         fieldName: c.Field, oldValue: c.OldValue, newValue: c.NewValue,
         description: c.Field === "Description" ? "Description edited" : `${LABEL[c.Field] ?? c.Field} changed`, req });
     }
   }
   ```
   `Description` is NVARCHAR(500). STRING_AGG names could exceed that on a huge set, so truncate: `.slice(0, 480)`.
   `sp_FetchTaskActivity` needs no change. It already returns `OldValue/NewValue/Description`.

### BE-4. No change to `notificationController`

The fetch/markRead/markAll payloads are already what mobile needs. The tests are untouched.

---

## Web tasks

All tests run with `cd web && pnpm exec vitest run <file>`. Run the full suite once at the end (`pnpm exec vitest run`), because TaskBoard/TopNav/menuBuilder are shared.

### WEB-1. Deep link `?taskId=` (item 6)

New hook `web/src/pages/Task/useFocusTaskWorkspace.js`. It is shared by TaskBoard and My Work, because TaskDetailModal takes its role/type from the **active** workspace store, so a task from another board must switch the store first or the modal shows wrong abilities.
```js
// Makes the task's own workspace the active one, so TaskDetailModal's
// role-derived abilities are right. Shares the ["task", id] cache with the modal
// and ["workspaces","list"] with WorkspaceSwitcher — no extra requests.
export default function useFocusTaskWorkspace(taskId) {
  const { data: taskPayload } = useApiQuery({
    queryKey: ["task", taskId], endpoint: TASK_ENDPOINTS.tasks.fetchTasks,
    params: { Id: taskId }, enabled: Boolean(taskId), showErrorMessage: false,
  });
  const { data: wsPayload } = useApiQuery({
    queryKey: ["workspaces", "list"], endpoint: WORKSPACE_ENDPOINTS.workspaces.fetchWorkspaces,
    params: { PageNumber: 1, PageSize: 100, IncludeArchived: true }, enabled: Boolean(taskId),
  });
  const task = taskPayload?.tasks?.[0];
  useEffect(() => {
    if (!task?.WorkspaceId) return;
    const row = (wsPayload?.workspaces ?? []).find((w) => w.Id === task.WorkspaceId);
    if (row && useWorkspaceStore.getState().activeWorkspaceId !== row.Id) {
      useWorkspaceStore.getState().setActiveWorkspace(row);
    }
  }, [task?.WorkspaceId, wsPayload]);
  return task ?? null;
}
```
(The workspace-list params must be **identical** to WorkspaceSwitcher's, or the cache key splits. Better: export a `WORKSPACE_LIST_PARAMS` constant from `api/workspaceQueries.js` and use it in both places.)
If the row is not found (an admin non-member), do not switch. The modal still loads; the server decides access.

`TaskBoard.jsx`:
```js
import { useSearchParams } from "react-router-dom";
const [searchParams, setSearchParams] = useSearchParams();
const linkedTaskId = Number(searchParams.get("taskId")) || null;
useEffect(() => {
  if (!linkedTaskId) return;
  setOpenTaskId(linkedTaskId);
  // Consume the param so closing the modal doesn't reopen it; a second click on
  // the same notification re-adds it and fires again.
  setSearchParams((p) => { p.delete("taskId"); return p; }, { replace: true });
}, [linkedTaskId, setSearchParams]);
useFocusTaskWorkspace(openTaskId);
```
(Opening a card on the current board is a no-op for the hook: the ids already match.)

`TopNav.jsx`: delete the `entity === "comment"` branch. Comment notifications now arrive as `EntityType: "task"` (SQL B4). Update the comment above it.

Tests:
- `TaskBoard.test.jsx` **regression** (fails today, since nothing reads the param): `renderWithProviders(<TaskBoard />, { route: "/tasks?taskId=101" })` with the store active on ws 1. MSW `fetchTasks` with `Id:101` returns `{Id:101, WorkspaceId:2, Title:"Linked task"}`, and `fetchWorkspaces` returns ws 2 with `MyRole:"member"`. Expect `findByText("Linked task")` in the dialog and `useWorkspaceStore.getState().activeWorkspaceId === 2`.
- Edge: the workspace is not in the list → the store stays on ws 1 and the modal still opens.
- `TopNav.test.jsx`: replace "opens a comment notification on the board" with "a comment notification (EntityType task) opens its task": `{EntityType:"task", Type:"comment_added", EntityId:42}` → `/tasks?taskId=42`. Delete the `commentId` expectation.

### WEB-2. Completion feedback (item 7, optional, tiny)

In `useTaskChecklist.js`, when a tick/delete mutation resolves with `data.completionChange === "completed"`, `enqueueSnackbar("Task completed — the creator has been told", { variant: "success" })`. Test it in the existing `TaskDetailModal.test.jsx` checklist case: an MSW handler returns `completionChange`, and the assertion checks the toast text. Skip if the reviewer finds it noisy. It is not in the spec.

### WEB-3. My Work page (item 9)

- `web/src/pages/Task/myWorkOrder.js` + `myWorkOrder.test.js`: `orderMyWork(tasks, today = new Date())` gives overdue (oldest due first) → due today → upcoming (soonest first) → undated, with ties broken by priority rank `critical, high, medium, low`. Tests: one per bucket, plus undated last.
- `web/src/pages/Task/MyWork.jsx`:
  ```jsx
  const userId = useAuthStore((s) => s.user?.UserId ?? s.UserId);
  const [openTaskId, setOpenTaskId] = useState(null);
  const { data, isLoading } = useApiQuery({
    queryKey: ["tasks", "my-work", userId],            // ["tasks"] prefix → realtime TASK_LIST invalidates it
    endpoint: TASK_ENDPOINTS.tasks.fetchTasks,
    params: { WorkspaceId: null, AssigneeUserId: userId, OnlyOpen: true, PageNumber: 1, PageSize: 200 },
    enabled: Boolean(userId),
  });
  const tasks = useMemo(() => orderMyWork(data?.tasks ?? []), [data]);
  useFocusTaskWorkspace(openTaskId);
  ```
  Render `PageHeader` (title "My Work", subtitle "`n` open · `m` overdue" where `m` comes from the ordered list) and `HelpGuide` if a guide key exists (else skip). Below that, a responsive grid of `KanbanCardView` (`canDrag={false}`, `onOpen={() => setOpenTaskId(t.Id)}`), each card captioned with `t.WorkspaceName` (a `Chip size="sm"` above the card). Then `EmptyState` ("Nothing assigned to you" + a button to `/tasks`), a `Skeleton` while loading, and `<TaskDetailModal taskId={openTaskId} open={Boolean(openTaskId)} onClose={() => setOpenTaskId(null)} />`. Use `ui/` only; no raw MUI.
- `App.jsx`: `const MyWork = lazy(() => import("./pages/Task/MyWork"));` and `{ path: "/my-work", element: <ProtectedRoute element={<MyWork />} /> }`.
- `utils/menuBuilder.js` `getMenuIcon`: before the `"task"` line, add `if (title.includes("my work")) return AssignmentIndOutlined;` (import from `@mui/icons-material`). Test in `menuBuilder.test.js`: `getMenuIcon("My Work") === AssignmentIndOutlined`.
- MSW `test/mocks/handlers.js` `fetchTasks`: honour `AssigneeUserId`/`OnlyOpen` on the fixture (filter by `AssigneesJson` containing the id, and `!IsCompleted`), so the page test exercises the contract.
- `MyWork.test.jsx`:
  1. The request body carries `AssigneeUserId: <logged-in id>, OnlyOpen: true, WorkspaceId: null`. Capture it via `server.use` with a spy.
  2. An overdue task renders before a later-due one (compare `getAllByTestId`/text order).
  3. Clicking a card opens the detail dialog and switches the active workspace to the task's.
  4. An empty list → the EmptyState text.

---

## Mobile tasks

Gate: `cd mobile && pnpm typecheck && pnpm lint` (no test suite, §0.4).

### MOB-1. Types (`src/types/api.ts`)

Replace the unused, wrong `Notification` interface (it has `Message`; the SP returns `Body`) with the SP's real columns (`sp_FetchNotifications` page select):
```ts
/** A row of sp_FetchNotifications. EntityType casing is per-SP ('task','ticket','Workspace'). */
export interface AppNotification {
  Id: number;
  UserId: number;
  /** task_assigned · task_completed · task_reopened · task_unblocked · comment_added · reply · ticket_assigned · ticket_escalated · workspace_* */
  Type: string;
  EntityType: string;
  EntityId: number;
  ActorUserId: number | null;
  ActorName: string | null;
  Title: string;
  Body: string | null;
  IsRead: boolean;
  ReadAt: string | null;
  CreatedDate: string;
}
```
(Grep confirms nothing imports `Notification` today. The name changes to `AppNotification` so it does not shadow the DOM global that `lib.dom` may declare.)

### MOB-2. `src/api/notificationQueries.ts` (payloads verbatim from `notificationController.js`)

```ts
// Payloads taken from backend/src/controllers/notificationController.js.
import { post } from "./client";
import type { ApiEnvelope, AppNotification, Pagination } from "../types/api";

export const NOTIFICATION_ENDPOINTS = {
  fetchNotifications: "/api/notifications/fetchNotifications",
  markNotificationRead: "/api/notifications/markNotificationRead",
  markAllNotificationsRead: "/api/notifications/markAllNotificationsRead",
} as const;

export interface NotificationsPayload {
  notifications: AppNotification[];
  unreadCount: number;
  pagination: Pagination;
}

export const fetchNotifications = ({
  UnreadOnly = false, PageNumber = 1, PageSize = 50, SearchTerm = null,
}: { UnreadOnly?: boolean; PageNumber?: number; PageSize?: number; SearchTerm?: string | null } = {},
): Promise<ApiEnvelope<NotificationsPayload>> =>
  post<NotificationsPayload>(NOTIFICATION_ENDPOINTS.fetchNotifications,
    { UnreadOnly, PageNumber, PageSize, SearchTerm });

export const markNotificationRead = (Id: number) =>
  post(NOTIFICATION_ENDPOINTS.markNotificationRead, { Id });

export const markAllNotificationsRead = () =>
  post<{ updatedCount: number }>(NOTIFICATION_ENDPOINTS.markAllNotificationsRead, {});
```
Note: when there are none, the SP returns one all-NULL data row with the status. `cleanSpRows` on the backend strips it, so `notifications` is `[]`. Confirm `cleanSpRows` drops `Id: null` rows. If it does not, filter `n.Id != null` in the screen.

### MOB-3. `src/features/notifications/NotificationsScreen.tsx`

- `useQuery({ queryKey: ["notifications"], queryFn: () => fetchNotifications() })`. App-focus refetch is already wired (`App.tsx` `focusManager`). Tab-focus refresh comes from `ui/Refresher`, which already uses `useFocusEffect`, the same as ComplaintsScreen.
- `Screen` + `ScreenHeader` (title "Inbox"; right action "Mark all read" `Button variant="ghost"`, shown only when `unreadCount > 0`) + `FlatList` of `Card`s. Each card shows the `Text variant` title, `Body` secondary, and `relativeTime(CreatedDate)` caption (reuse `features/tasks/taskHelpers.relativeTime`). An unread row gets a leading solid `colors.primary` dot (a token, not opacity). Icon per type from lucide: `UserPlus` assigned, `CircleCheck` completed, `RotateCcw` reopened, `Unlock` unblocked, `MessageCircle` comment/reply, `Ticket` ticket, `Users` workspace, else `Bell`.
- Tap: `markNotificationRead(n.Id)` (fire-and-forget, then `invalidateQueries(["notifications"])`) and route by `n.EntityType.toLowerCase()`:
  `task` → `navigation.navigate("TaskDetail", { taskId: n.EntityId, workspaceId: null })` · `ticket` → `navigate("ComplaintDetail", { ticketId: n.EntityId })` · `workspace` → `navigate("Boards")` (an invite is answered there) · else nothing.
  A 404 on TaskDetail (a deleted task, or lost access) is handled by TaskDetailScreen's existing error state. Do not pre-check.
- `EmptyState icon={Bell} title="You're all caught up"`.
- Build the menu/action list as literals (§9.5 "never `.push()`"). Use no `Alert` and no rgba.

### MOB-4. Navigation

`RootNavigator.tsx`: `TabParamList` gains `Inbox: undefined`. Add `<Tab.Screen name="Inbox" component={NotificationsScreen} options={{ title: "Inbox" }} />` between MyWork and Work. `FloatingTabBar.tsx` `TAB_ICONS` gains `Inbox: Bell`. (See Open decisions on the badge.)

### MOB-5. MyWork uses the server filter (item 9)

- `api/taskQueries.ts` `FetchTasksParams` gains `AssigneeUserId?: number | null; OnlyOpen?: boolean; Overdue?: boolean;`. `fetchTasks` destructures them with defaults `null/false/false` and sends them verbatim (they match the BE-2 controller names). Update the doc comment that says "without a backend change".
- `MyWorkScreen.tsx`:
  ```ts
  const mine = useQuery({
    queryKey: ["tasks", "mine", userId],
    queryFn: () => fetchTasks({ WorkspaceId: null, AssigneeUserId: userId, OnlyOpen: true, PageSize: 200 }),
    enabled: userId != null,
  });
  const everyone = useQuery({
    queryKey: ["tasks", "all-workspaces"],
    queryFn: () => fetchTasks({ WorkspaceId: null, PageSize: 200 }),
    enabled: filter !== "mine",
  });
  const visible = filter === "mine" ? mineTasks
    : filter === "unassigned" ? allTasks.filter(isUnassigned) : allTasks;
  ```
  `mineCount = mineTasks.length`, which is now accurate rather than capped by the 200-row window. Remove the "sp_FetchTask has no assignee parameter" comment. `isAssignee` is no longer used here; leave it in `taskHelpers` if other callers use it.
  Refresh/`isRefetching` comes from whichever query is active.

### MOB-6. History shows the change (item 12)

`features/tasks/ActivityTab.tsx`:
```ts
const change = item.OldValue && item.NewValue && item.OldValue !== item.NewValue
  ? ` · ${item.OldValue} → ${item.NewValue}` : "";
title: (item.Description ?? item.Action) + change,
```
(The same rule as web `ActivityRow`.) Also add `{ match: "statuschang", Icon: CircleCheck, tone: "success" }` **before** `"updat"`, so completion rows (`Action = "StatusChanged"`) get the check icon. Keep `"assign"` above `"updat"` as it is today.

---

## Open decisions (recommended default first)

1. **Where completion notify runs**: **controller after the checklist SP, using the returned `CompletionChange`** (recommended; matches the existing notify SPs, gives Node the recipient ids for realtime, and stays out of the result-set leak that already bit this chain). The alternative is an `INSERT…EXEC sp_CreateNotification` inside Recompute. It saves one round-trip but gives no realtime emit.
2. **Who counts as "assigner"**: **`tblTaskAssignee.AssignedByUserId` of current assignees, plus the creator.** Removed assignees' assigners are not told.
3. **Comment notifications**: **store `EntityType='task'`, backfill the 24 rows, and delete the 2 orphans.** The alternative is a server-side `commentId → taskId` resolve endpoint, which adds a request on every click forever.
4. **Archived filter scope**: **only when `@WorkspaceId IS NULL`** (cross-workspace lists). An explicit archived board still loads, because the switcher lists archived boards with Restore.
5. **My Work sidebar position**: **top-level row, accepting that it renders last (after Admin)**, because `sp_ValidateUser` orders by `ParentId, Id`. If that is unacceptable, the cheapest fix is to change `sp_ValidateUser`'s `ORDER BY` to `m.ParentId, CASE m.Route WHEN '/my-work' THEN 2.5 ELSE m.Id END`. That is hacky; a real `SortOrder` column on `tblMenu` would be the proper fix (out of scope). A no-SQL option is to fold My Work into the `/tasks` page as a "My Work" pseudo-workspace in the switcher. Rejected, because the spec says a page and P3 turns it into Today.
6. **My Work = open only** on both clients (`OnlyOpen=1`). Mobile "Mine" therefore drops completed tasks, which is a small behaviour change. The default is yes, because the screen's own copy is about what's left to do.
7. **Mobile notifications entry point**: **a 4th tab "Inbox"** (always one tap away for field staff). There is **no unread badge in v1**. A badge needs `FloatingTabBar` to read `options.tabBarBadge` (about 10 lines) plus a lightweight unread query. Add it if users miss notifications.
8. **Overdue definition**: `DueDate < today` (date-only, server clock), matching KanbanCard's client rule. TAT due *times* (P-later) will refine it.
9. **Generic "Task X updated" row**: written **only when the save produced no field diffs**, to avoid a duplicate line per edit.

## Risks / callers affected

- **sp_FetchTask** has one caller (`taskController.fetch`), but every client goes through it: the web board, TaskDetailModal (`Id`), MyWork mobile, and the board fetch on mobile. The new params default to no-op. Behaviour changes: (a) cross-workspace fetches (mobile MyWork "All/Unassigned", any `WorkspaceId:null` call) **stop returning archived-board tasks**, which is intended (audit B11); (b) deleted tasks vanish once soft delete lands. 0 archived tasks live today.
- **The `IsDeleted` dependency**: B3/B5 reference `tblTasks.IsDeleted`. If the soft-delete section is not in the same script, or is ordered after B, **CREATE OR ALTER fails** at apply time. The script order must be: soft-delete DDL → B.
- **Five sections touch the same SPs**: sp_SaveTask (items 4, 5/TAT, 12, 15), the checklist SPs (2, 3, 7), Recompute (7, 11), sp_FetchTask (1, 9). One merge owner must build each SP from the **live body plus all hunks**, or a later `CREATE OR ALTER` silently reverts an earlier section. Recommend one SP = one owner in the master plan.
- **sp_SaveTask result-set order**: RS1 status, RS2 new assignees, RS3 diff (this plan), RS4 removed ids (TAT). Backend reads by index, so the order is a contract. The mssql driver returns `recordsets` only for SELECTs that actually ran, so the create path (no RS3) gives `recordsets[2] === undefined`. The controller defaults to `[]`, and the test covers it.
- **The TopNav comment branch removed**: an old unread `comment` notification created *between* the SQL apply and the web deploy is impossible, because B4 makes the new SP write `task` immediately. Web deployed *before* SQL: comment rows would do nothing on click for that window. Deploy SQL first.
- **`sp_NotifyCommentAdded` still leaks `sp_CreateNotification` status rows** to `taskController.addComment`, which ignores them. This is unchanged; it is listed so nobody "fixes" the backend reader.
- **My Work ceiling**: client ordering over at most 200 open tasks per user (live max is far below). `ponytail:` add a server `ORDER BY` branch for `@OnlyOpen=1` if someone ever has more than 200 open.
- **Workspace switch side effect**: opening a task from My Work or a notification changes the persisted active board. The user returns to that board on `/tasks`. This is acceptable, and it is how the abilities stay correct.
- **Realtime on My Work (web)**: TASK_LIST is emitted to the *workspace room*. If the socket only joins the active workspace's room, My Work misses live updates from other boards until refocus/refetch. Check `SocketProvider` room joins. If it joins only the active workspace, accept it for P1 (TanStack refetch-on-focus covers it).
- **Notification volume**: one tick that completes a task with 3 assigners notifies at most 4 people. Unblock fan-out is bounded by dependents × assignees (0 dependencies live).
