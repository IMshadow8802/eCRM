# P1-D — People (spec §4 items 16–20)

Read against **live** `eCRM+` on 2026-10-07 (`OBJECT_DEFINITION`). SolarCRM is assumed to match; the same script goes to both.

**Facts the plan depends on (verified live):**
- **Item 19, login half: already done.** `sp_ValidateUser` (093) computes `IsAdmin` as "any active group with `IsAdmin = 1`". Only `sp_FetchAccessibleBranchIds` still takes `IsAdmin` from the top group by `HierarchyLevel`.
- `tblUser.IsAdmin` is written only by `sp_SaveUser` and read only by `sp_FetchUser`, which just displays it. No other SP reads `u.IsAdmin`.
- `tblUserGroupMap.GroupId` **has an FK** to `tblUserGroups` now. A `GroupId = 0` save maps to 8 and fails the FK, so today it returns a raw **500**, not a phantom group. The fix is still a 400.
- `tblUserGroups` has `CompId`. `sp_SaveUser`'s group check does not filter on it, so an admin can map a user to another company's group. The new check closes this.
- FKs to `tblUser` (all NO ACTION): `tblUserGroupMap`, `tblTaskAssignee`, `tblTeams.LeadUserId`, `tblTeamMembers`, `tblProjects.ManagerUserId`, `tblTasks.AssignedToUserId/CreatedByUserId`, `tblTaskComments`, `tblTimeEntries`. `tblKanbanColumns.WorkspaceId` → `tblWorkspaces` is NO ACTION. `tblWorkspaceMembers` → `tblWorkspaces` is CASCADE.
- **The task mirror rule** (from `sp_SaveTask`): `AssignedToUserId = (SELECT MIN(UserId) FROM tblTaskAssignee WHERE TaskId = …)`. `tblTasks.IsCompleted` is `bit NOT NULL`.
- **Open task assignments a deactivation would release today:** 9 (shared/project, `IsCompleted = 0`).
- Lead status codes: `open, qualified, converted, lost, junk`. Ticket status codes: `open, onhold, resolved, closed, rejected`.
- Web list deep links already work: `/sales/leads?OwnerId=` (`leadsParamsToState`) and `/support/tickets?AssignedTo=` (`ticketStatus.js` `FILTER_KEYS`).
- `GET` of branches already exists: `POST /api/users/fetchBranches` → `sp_FetchBranches` (any authenticated user). The web calls it as `SALES_ENDPOINTS.users.fetchBranches` with queryKey `["branches"]`.
- Notifications render generically (Title/Body), so the new `task_unassigned` type needs no client change.

---

## SQL changes

One script: **`backend/sql/NNN_people_foundation.sql`**. The coordinator assigns NNN; 093 is the last applied and the folder is empty today. Objects in the order they must be created:

### S1. NEW `sp_UnassignUserFromOpenTasks` (shared with item 5)
Item 5 (member removal, leave, team sync, archive) needs the same operation, scoped to one workspace. **One SP for both. If the item-5 plan also defines one, keep this signature.** It is the hook where P3 closes clocks later (`CloseReason = 'unassigned' | 'user_left'`).

It returns **one** result set and no status row, so callers capture it with `INSERT … EXEC`. Notifications are inserted set-based, **not** through `EXEC sp_CreateNotification`, because an `INSERT EXEC` inside a proc that is itself called by `INSERT EXEC` fails with "cannot be nested". The insert replicates `sp_CreateNotification`'s guards: recipient active, skip self/actor, honour in-app opt-out.

```sql
-- sp_UnassignUserFromOpenTasks — remove @UserId from every OPEN task's assignee
-- set (shared/project workspaces; personal ones are the user's own and private),
-- keep the AssignedToUserId mirror in step, and tell each affected workspace
-- owner how many of their tasks became unassigned.
-- @WorkspaceId NULL = every workspace (deactivation); a value = that one (item 5).
-- The CALLER owns the transaction. One result set: WorkspaceId, OwnerUserId, TaskCount.
CREATE OR ALTER PROC dbo.sp_UnassignUserFromOpenTasks
    @UserId      INT,
    @CompId      BIGINT,
    @WorkspaceId BIGINT = NULL,
    @ActorUserId INT    = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Hit TABLE (TaskId BIGINT PRIMARY KEY, WorkspaceId BIGINT, OwnerUserId INT, BranchId BIGINT);

    INSERT INTO @Hit (TaskId, WorkspaceId, OwnerUserId, BranchId)
    SELECT DISTINCT t.Id, w.Id, w.OwnerUserId, w.BranchId
      FROM dbo.tblTaskAssignee a
      JOIN dbo.tblTasks      t ON t.Id = a.TaskId
      JOIN dbo.tblWorkspaces w ON w.Id = t.WorkspaceId
     WHERE a.UserId = @UserId
       AND w.CompId = @CompId
       AND w.Type IN ('shared', 'project')
       AND t.IsCompleted = 0
       -- if item 1 (soft delete) ships in the same script: AND t.IsDeleted = 0
       AND (@WorkspaceId IS NULL OR w.Id = @WorkspaceId);

    DELETE a FROM dbo.tblTaskAssignee a
      JOIN @Hit h ON h.TaskId = a.TaskId
     WHERE a.UserId = @UserId;

    UPDATE t
       SET AssignedToUserId = (SELECT MIN(x.UserId) FROM dbo.tblTaskAssignee x WHERE x.TaskId = t.Id),
           UpdatedDate = GETDATE()
      FROM dbo.tblTasks t JOIN @Hit h ON h.TaskId = t.Id;

    DECLARE @Name VARCHAR(200) =
        (SELECT ISNULL(NULLIF(FullName, ''), Username) FROM dbo.tblUser WHERE Id = @UserId);

    INSERT INTO dbo.tblNotifications
        (UserId, Type, EntityType, EntityId, ActorUserId, Title, Body, CompId, BranchId)
    SELECT h.OwnerUserId, 'task_unassigned', 'Workspace', h.WorkspaceId, @ActorUserId,
           'Tasks became unassigned',
           CONCAT(@Name, ' is no longer assigned to ', COUNT(*), ' open task(s)'),
           @CompId, MIN(h.BranchId)
      FROM @Hit h
      JOIN dbo.tblUser o ON o.Id = h.OwnerUserId AND o.IsActive = 1
     WHERE h.OwnerUserId <> @UserId
       AND (@ActorUserId IS NULL OR h.OwnerUserId <> @ActorUserId)
       AND NOT EXISTS (SELECT 1 FROM dbo.tblNotificationPreferences p
                        WHERE p.UserId = h.OwnerUserId AND p.Type = 'task_unassigned'
                          AND p.Channel = 'inapp' AND p.IsEnabled = 0)
     GROUP BY h.OwnerUserId, h.WorkspaceId;

    SELECT WorkspaceId, OwnerUserId, COUNT(*) AS TaskCount
      FROM @Hit GROUP BY WorkspaceId, OwnerUserId;
END
```
`tblTaskReads` rows are kept as history.

### S2. `sp_SaveUser`: full `CREATE OR ALTER` (items 16, 17, 18, 19)
This is the full body, because the changes touch params, validation and both branches. Everything not listed below is identical to the live text.

| Change | Before (live) | After |
|---|---|---|
| params | `@IsAdmin BIT,` · `@BranchId BIGINT,` | `@IsAdmin BIT = NULL,` (**ignored**, kept so an old caller doesn't fail) · `@BranchId BIGINT = NULL,` · add `@ActorUserId INT = NULL` last |
| group | `IF (@GroupId IS NOT NULL AND @GroupId > 0) BEGIN IF NOT EXISTS (… WHERE Id = @GroupId AND IsActive = 1) … 'Invalid group selected' … END ELSE BEGIN SET @GroupId = 8; END` | `IF (@GroupId IS NULL OR @GroupId <= 0 OR NOT EXISTS (SELECT 1 FROM tblUserGroups WHERE Id = @GroupId AND CompId = @CompId AND IsActive = 1))` → `400 'Pick an active role for this user'` |
| branch (new) | — | `IF (@Id = 0 AND @BranchId IS NULL)` → `400 'Branch is required'`; `IF (@BranchId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tblBranch WHERE Id = @BranchId))` → `400 'Invalid branch'` |
| self-deactivate (new) | — | `IF (@Id > 0 AND @UserActive = 0 AND @Id = @ActorUserId)` → `400 'You cannot deactivate your own account'` |
| admin mirror | INSERT `@IsAdmin`; UPDATE `IsAdmin = @IsAdmin` | `DECLARE @GroupIsAdmin BIT = (SELECT IsAdmin FROM tblUserGroups WHERE Id = @GroupId);` INSERT and UPDATE write `@GroupIsAdmin` |
| update: existence | `IF NOT EXISTS (SELECT 1 FROM tblUser WHERE Id = @Id AND CompId = @CompId)` | `SELECT @WasActive = IsActive FROM tblUser WHERE Id = @Id AND CompId = @CompId; IF @WasActive IS NULL` (same 404) |
| update: branch | (no BranchId) | `BranchId = ISNULL(@BranchId, BranchId),` (absent = keep) |
| update: deactivation | — | after the group re-map, before COMMIT: `IF (@WasActive = 1 AND @UserActive = 0) INSERT INTO @Unassigned EXEC dbo.sp_UnassignUserFromOpenTasks @UserId = @Id, @CompId = @CompId, @WorkspaceId = NULL, @ActorUserId = @ActorUserId;` |
| update: output | status row only | status row, then **RS2** `SELECT WorkspaceId, OwnerUserId, TaskCount FROM @Unassigned;` |

`DECLARE @WasActive BIT; DECLARE @Unassigned TABLE (WorkspaceId BIGINT, OwnerUserId INT, TaskCount INT);` go above `BEGIN TRY`. The insert branch is unchanged apart from `IsAdmin` → `@GroupIsAdmin`; a new user cannot hold tasks.

Full text to put in the script (Claude writes it from the live body plus the table above). The new and changed lines in context:
```sql
CREATE OR ALTER PROC dbo.sp_SaveUser
    @Id INT, @Username VARCHAR(100), @Password VARCHAR(500), @UserActive BIT,
    @IsAdmin BIT = NULL,             -- ignored since NNN: admin comes from the group
    @UserIp VARCHAR(50), @AllowDay INT, @FullName VARCHAR(200), @Email VARCHAR(150),
    @JobTitle VARCHAR(100), @HourlyRate DECIMAL(10,2), @GroupId INT, @CompId BIGINT,
    @BranchId BIGINT = NULL,         -- NULL on edit = keep the current branch
    @Mobile VARCHAR(20) = NULL, @ReportsTo INT = NULL,
    @ActorUserId INT = NULL
AS
BEGIN
    ... (Username / Password / FullName checks, blank→NULL normalisation: unchanged)

    IF (@Id > 0 AND @UserActive = 0 AND @Id = @ActorUserId)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'You cannot deactivate your own account';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- No default group: the old ELSE SET @GroupId = 8 pointed at a group that
    -- does not exist. A role is required, and it must be this company's.
    IF (@GroupId IS NULL OR @GroupId <= 0
        OR NOT EXISTS (SELECT 1 FROM tblUserGroups WHERE Id = @GroupId AND CompId = @CompId AND IsActive = 1))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Pick an active role for this user';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@Id = 0 AND @BranchId IS NULL)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Branch is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    IF (@BranchId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tblBranch WHERE Id = @BranchId))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid branch';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    DECLARE @GroupIsAdmin BIT = (SELECT IsAdmin FROM tblUserGroups WHERE Id = @GroupId);

    ... (ReportsTo checks, 409 uniqueness checks: unchanged)

    DECLARE @WasActive BIT;
    DECLARE @Unassigned TABLE (WorkspaceId BIGINT, OwnerUserId INT, TaskCount INT);

    BEGIN TRY
        BEGIN TRANSACTION;
        IF (@Id = 0)
        BEGIN
            ... INSERT exactly as live, with @GroupIsAdmin in place of @IsAdmin ...
        END
        ELSE
        BEGIN
            SELECT @WasActive = IsActive FROM tblUser WHERE Id = @Id AND CompId = @CompId;
            IF @WasActive IS NULL
            BEGIN ROLLBACK TRANSACTION; SET @ResponseCode = 404; SET @ResponseMess = 'User not found';
                  SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

            UPDATE tblUser
               SET Username = @Username, IsActive = @UserActive,
                   IsAdmin = @GroupIsAdmin, UserIp = @UserIp, AllowDay = @AllowDay,
                   FullName = @FullName, Email = @Email, JobTitle = @JobTitle,
                   HourlyRate = @HourlyRate, Mobile = @Mobile,
                   ReportsTo = @ReportsTo,
                   BranchId = ISNULL(@BranchId, BranchId),
                   Password = CASE WHEN @Password IS NOT NULL AND LEN(@Password) > 0
                                   THEN @Password ELSE Password END
             WHERE Id = @Id AND CompId = @CompId;

            DELETE FROM tblUserGroupMap WHERE UserId = @Id;
            INSERT INTO tblUserGroupMap (UserId, GroupId) VALUES (@Id, @GroupId);

            -- Deactivation releases their open tasks (spec item 16 / 5).
            IF (@WasActive = 1 AND @UserActive = 0)
                INSERT INTO @Unassigned
                EXEC dbo.sp_UnassignUserFromOpenTasks
                     @UserId = @Id, @CompId = @CompId, @WorkspaceId = NULL, @ActorUserId = @ActorUserId;

            COMMIT TRANSACTION;
            SET @ResponseCode = 200; SET @ResponseMess = 'User updated successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @Id AS UserId, @GroupId AS AssignedGroupId;
            SELECT WorkspaceId, OwnerUserId, TaskCount FROM @Unassigned;
        END
    END TRY
    ... (CATCH unchanged)
END
```
**Callers:** only `userController.save`. Mobile never saves users.

### S3. `sp_DeleteUser`: full `CREATE OR ALTER` (item 17)
- The `@Id` / 404 / self checks stay exactly as live.
- The three separate 409 guards (assignee, project manager, team lead) are replaced by one history check that names what was found.
- The transaction **no longer deletes `tblTimeEntries` or `tblTaskComments`**. It also drops the `tblTaskAssignee` delete, which the guard makes unreachable.
```sql
    DECLARE @Has VARCHAR(60) =
      CASE
        WHEN EXISTS (SELECT 1 FROM tblTaskAssignee WHERE UserId = @Id)
          OR EXISTS (SELECT 1 FROM tblTasks WHERE CreatedByUserId = @Id OR AssignedToUserId = @Id OR CompletedByUserId = @Id)
             THEN 'tasks'
        WHEN EXISTS (SELECT 1 FROM tblTaskComments WHERE UserId = @Id) THEN 'task comments'
        WHEN EXISTS (SELECT 1 FROM tblTimeEntries  WHERE UserId = @Id) THEN 'time entries'
        WHEN EXISTS (SELECT 1 FROM tblLeads WHERE OwnerId = @Id OR CreatedBy = @Id) THEN 'leads'
        WHEN EXISTS (SELECT 1 FROM tblTicket WHERE AssignedTo = @Id OR CreatedBy = @Id OR EscalatedTo = @Id) THEN 'complaints'
        WHEN EXISTS (SELECT 1 FROM tblLeadActivity   WHERE UserId = @Id)
          OR EXISTS (SELECT 1 FROM tblTicketActivity WHERE UserId = @Id)
          OR EXISTS (SELECT 1 FROM tblCall           WHERE UserId = @Id)
          OR EXISTS (SELECT 1 FROM tblFollowUp       WHERE AssignedTo = @Id OR CreatedBy = @Id)
             THEN 'sales or support activity'
        WHEN EXISTS (SELECT 1 FROM tblUser WHERE ReportsTo = @Id) THEN 'people reporting to them'
        WHEN EXISTS (SELECT 1 FROM tblWorkspaces WHERE OwnerUserId = @Id AND Type <> 'personal') THEN 'workspaces they own'
        WHEN EXISTS (SELECT 1 FROM tblProjects WHERE ManagerUserId = @Id) THEN 'projects they manage'
        WHEN EXISTS (SELECT 1 FROM tblTeams    WHERE LeadUserId    = @Id) THEN 'teams they lead'
        WHEN EXISTS (SELECT 1 FROM tblActivityLog WHERE UserId = @Id) THEN 'activity history'
      END;
    IF @Has IS NOT NULL
    BEGIN SET @ResponseCode = 409;
          SET @ResponseMess = 'Cannot delete: this user has ' + @Has + '. Deactivate them instead.';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;
        -- Only rows with no history value: role map, roster, access, prefs,
        -- devices, their own inbox and receipts, and an empty personal workspace.
        DELETE FROM tblUserGroupMap            WHERE UserId = @Id;
        DELETE FROM tblTeamMembers             WHERE UserId = @Id;
        DELETE FROM tblUserBranchAccess        WHERE UserId = @Id;
        DELETE FROM tblNotificationPreferences WHERE UserId = @Id;
        DELETE FROM tblUserPushTokens          WHERE UserId = @Id;
        DELETE FROM tblNotifications           WHERE UserId = @Id;
        DELETE FROM tblTaskReads               WHERE UserId = @Id;
        DELETE FROM tblCommentReads            WHERE UserId = @Id;
        DELETE FROM tblWorkspaceMembers        WHERE UserId = @Id;
        DELETE k FROM tblKanbanColumns k JOIN tblWorkspaces w ON w.Id = k.WorkspaceId
         WHERE w.OwnerUserId = @Id AND w.Type = 'personal';   -- no tasks: guarded above
        DELETE FROM tblWorkspaces WHERE OwnerUserId = @Id AND Type = 'personal';
        DELETE FROM tblUser WHERE Id = @Id;
        COMMIT TRANSACTION;
        ... (200 / CATCH unchanged)
```
`tblUserBranchAccess.CreatedBy` / `tblNotifications.ActorUserId` rows pointing at the user are left alone (no FK, and they are history). The effect: delete is now only for a mistaken, never-used account (13 of 20 users have no `tblActivityLog` row). **Callers:** `userController.delete`.

### S4. `sp_FetchAccessibleBranchIds`: hunk (item 19, per request)
```diff
     SELECT TOP 1
         @HierarchyLevel  = ug.HierarchyLevel,
         @DataScope       = ug.DataScope,
-        @IsAdmin         = ug.IsAdmin,
         @PrimaryBranchId = u.BranchId,
         @IsActive        = u.IsActive
     FROM dbo.tblUser u
     LEFT JOIN dbo.tblUserGroupMap ugm ON ugm.UserId = u.Id
     LEFT JOIN dbo.tblUserGroups   ug  ON ug.Id = ugm.GroupId AND ug.IsActive = 1
     WHERE u.Id = @UserId AND u.CompId = @CompId
-    ORDER BY CASE WHEN ug.Id IS NULL THEN 1 ELSE 0 END, ug.HierarchyLevel ASC;
+    ORDER BY CASE WHEN ug.Id IS NULL THEN 1 ELSE 0 END, ug.HierarchyLevel ASC, ug.IsAdmin DESC, ug.Id;
+
+    -- Admin = ANY active group says so, exactly as sp_ValidateUser (093) does
+    -- at login. Top-by-level alone let a level-2 Head tie with Admin and win.
+    SET @IsAdmin = CASE WHEN EXISTS (
+        SELECT 1 FROM dbo.tblUserGroupMap m
+          JOIN dbo.tblUserGroups g ON g.Id = m.GroupId
+          JOIN dbo.tblUser u2 ON u2.Id = m.UserId AND u2.CompId = @CompId
+         WHERE m.UserId = @UserId AND g.IsActive = 1 AND g.IsAdmin = 1) THEN 1 ELSE 0 END;
```
The rest is unchanged. This is applied as `CREATE OR ALTER` with the live body plus this hunk. The tie-break makes `DataScope` deterministic. **Callers:** `loadScope` on every request. The contract (3 result sets, same columns) is unchanged.

### S5. `sp_FetchUser`: full `CREATE OR ALTER` (items 18, 20)
It gains two columns on every row shape (both placeholder rows get `NULL AS BranchName, NULL AS NoManager`):
- **`BranchName`**: `LEFT JOIN tblBranch b ON b.Id = u.BranchId` in both real selects.
- **`NoManager`** (BIT): the user is active, has **no active ancestor** up `ReportsTo` (walking through inactive managers, like `sp_FetchEscalationTargets`), and is **not** in an active `IsAdmin` group (see Open decision D3).

Computed once, before the `IF (@Id = 0)` branch:
```sql
    -- Users with an ACTIVE manager somewhere up the chain. The walk continues
    -- only through inactive managers, so it stops at the first active one.
    DECLARE @Managed TABLE (UserId INT PRIMARY KEY);
    ;WITH up AS (
        SELECT u.Id AS UserId, u.ReportsTo AS AncestorId, 1 AS Depth
          FROM tblUser u WHERE u.CompId = @CompId AND u.ReportsTo IS NOT NULL
        UNION ALL
        SELECT up.UserId, m.ReportsTo, up.Depth + 1
          FROM up JOIN tblUser m ON m.Id = up.AncestorId
         WHERE m.CompId = @CompId AND m.IsActive = 0 AND m.ReportsTo IS NOT NULL AND up.Depth < 20
    )
    INSERT INTO @Managed (UserId)
    SELECT DISTINCT up.UserId
      FROM up JOIN tblUser a ON a.Id = up.AncestorId AND a.CompId = @CompId AND a.IsActive = 1
     WHERE a.Id <> up.UserId
    OPTION (MAXRECURSION 32);
```
Column expression (added after `ReportsToName` in both real selects):
```sql
       b.BranchName,
       CAST(CASE WHEN u.IsActive = 1
                  AND NOT EXISTS (SELECT 1 FROM @Managed mg WHERE mg.UserId = u.Id)
                  AND NOT EXISTS (SELECT 1 FROM tblUserGroupMap am
                                    JOIN tblUserGroups ag ON ag.Id = am.GroupId AND ag.IsActive = 1 AND ag.IsAdmin = 1
                                   WHERE am.UserId = u.Id)
                 THEN 1 ELSE 0 END AS BIT) AS NoManager,
```
`u.IsAdmin` stays in the output for now (harmless; the web stops reading it). **Callers:** `userController.fetch` only. Web callers of `fetchUsers` include Users, Leads/Tickets (`useUsers`) and the task pickers; added columns do not break them.

### S6. NEW `sp_FetchUserHandover` (item 16)
```sql
-- What a user still holds, so an admin can hand it over before/after deactivating.
-- RS1: one row of counts + status. RS2: owned shared/project workspaces. RS3: direct reports.
CREATE OR ALTER PROC dbo.sp_FetchUserHandover
    @UserId INT,
    @CompId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Id = @UserId AND CompId = @CompId)
    BEGIN SELECT 404 AS ResponseCode, 'User not found' AS ResponseMess; RETURN; END

    SELECT 200 AS ResponseCode, 'Handover retrieved' AS ResponseMess,
      (SELECT COUNT(DISTINCT t.Id) FROM dbo.tblTaskAssignee a
         JOIN dbo.tblTasks t ON t.Id = a.TaskId
         JOIN dbo.tblWorkspaces w ON w.Id = t.WorkspaceId
        WHERE a.UserId = @UserId AND w.CompId = @CompId
          AND w.Type IN ('shared','project') AND t.IsCompleted = 0)          AS OpenTasks,
      (SELECT COUNT(*) FROM dbo.tblLeads l
         LEFT JOIN dbo.tblLookup s ON s.Id = l.StatusId
        WHERE l.CompId = @CompId AND l.OwnerId = @UserId
          AND ISNULL(s.Code, '') NOT IN ('converted','lost','junk'))         AS OpenLeads,
      (SELECT COUNT(*) FROM dbo.tblTicket k
         JOIN dbo.tblLookup s ON s.Id = k.StatusId
        WHERE k.CompId = @CompId AND k.AssignedTo = @UserId
          AND s.Code IN ('open','onhold'))                                   AS OpenTickets,
      (SELECT COUNT(*) FROM dbo.tblWorkspaces
        WHERE CompId = @CompId AND OwnerUserId = @UserId
          AND Type IN ('shared','project') AND IsArchived = 0)               AS OwnedWorkspaces,
      (SELECT COUNT(*) FROM dbo.tblUser
        WHERE CompId = @CompId AND ReportsTo = @UserId AND IsActive = 1)     AS DirectReports;

    SELECT Id, Name, Type FROM dbo.tblWorkspaces
     WHERE CompId = @CompId AND OwnerUserId = @UserId
       AND Type IN ('shared','project') AND IsArchived = 0
     ORDER BY Name;

    SELECT Id, FullName FROM dbo.tblUser
     WHERE CompId = @CompId AND ReportsTo = @UserId AND IsActive = 1
     ORDER BY FullName;
END
```

### S7. NEW `sp_FetchPersonManagers` (item 20; consumed by P2/P3, no endpoint now)
```sql
-- Who gets told about a person: their first ACTIVE manager up ReportsTo
-- (walking through inactive ones, like sp_FetchEscalationTargets), else the
-- company's active admins (active user in an active IsAdmin group). A person
-- who is themselves an admin with no manager gets nobody (audit 02 §5.10).
-- Always exactly one result set: UserId, Source ('manager' | 'admin').
CREATE OR ALTER PROC dbo.sp_FetchPersonManagers
    @UserId INT,
    @CompId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ManagerId INT;

    ;WITH chain AS (
        SELECT u.Id, u.ReportsTo, 0 AS Depth
          FROM dbo.tblUser u WHERE u.Id = @UserId AND u.CompId = @CompId
        UNION ALL
        SELECT m.Id, m.ReportsTo, c.Depth + 1
          FROM dbo.tblUser m JOIN chain c ON m.Id = c.ReportsTo
         WHERE m.CompId = @CompId AND c.Depth < 20
    )
    SELECT TOP 1 @ManagerId = u.Id
      FROM chain c JOIN dbo.tblUser u ON u.Id = c.Id
     WHERE c.Depth > 0 AND u.IsActive = 1 AND u.Id <> @UserId
     ORDER BY c.Depth
    OPTION (MAXRECURSION 32);

    DECLARE @PersonIsAdmin BIT = CASE WHEN EXISTS (
        SELECT 1 FROM dbo.tblUserGroupMap m JOIN dbo.tblUserGroups g ON g.Id = m.GroupId
         WHERE m.UserId = @UserId AND g.IsActive = 1 AND g.IsAdmin = 1) THEN 1 ELSE 0 END;

    SELECT u.Id AS UserId,
           CASE WHEN u.Id = @ManagerId THEN 'manager' ELSE 'admin' END AS Source
      FROM dbo.tblUser u
     WHERE u.CompId = @CompId AND u.IsActive = 1 AND u.Id <> @UserId
       AND (u.Id = @ManagerId
            OR (@ManagerId IS NULL AND @PersonIsAdmin = 0
                AND EXISTS (SELECT 1 FROM dbo.tblUserGroupMap m
                              JOIN dbo.tblUserGroups g ON g.Id = m.GroupId
                             WHERE m.UserId = u.Id AND g.IsActive = 1 AND g.IsAdmin = 1)));
END
```
The `NoManager` rule in S5 and this SP agree: NoManager = 1 ⇔ this SP returns `Source = 'admin'` rows (or nothing for an admin). `sp_FetchEscalationTargets` is left unchanged; it lists the whole chain for the picker.

### Verify after apply (read-only, or `BEGIN TRAN … ROLLBACK`)
```sql
-- 1. Objects exist
SELECT name FROM sys.procedures WHERE name IN
 ('sp_UnassignUserFromOpenTasks','sp_FetchUserHandover','sp_FetchPersonManagers');

-- 2. No-group save is a 400, not FK 500; cross-company group refused
BEGIN TRAN;
EXEC sp_SaveUser @Id=0,@Username='zz_probe',@Password='x',@UserActive=1,@UserIp='',@AllowDay=0,
     @FullName='Probe',@Email=NULL,@JobTitle=NULL,@HourlyRate=0,@GroupId=0,@CompId=1,@BranchId=1; -- expect 400
EXEC sp_SaveUser @Id=0,@Username='zz_probe',@Password='x',@UserActive=1,@UserIp='',@AllowDay=0,
     @FullName='Probe',@Email=NULL,@JobTitle=NULL,@HourlyRate=0,@GroupId=16,@CompId=1,@BranchId=2; -- expect 201, branch 2
SELECT BranchId, IsAdmin FROM tblUser WHERE Username='zz_probe';                                  -- 2, 0
ROLLBACK;

-- 3. Deactivation releases open tasks (pick a user holding some)
DECLARE @u INT = (SELECT TOP 1 a.UserId FROM tblTaskAssignee a JOIN tblTasks t ON t.Id=a.TaskId
                   JOIN tblWorkspaces w ON w.Id=t.WorkspaceId
                  WHERE t.IsCompleted=0 AND w.Type<>'personal' AND w.OwnerUserId<>a.UserId);
BEGIN TRAN;
DECLARE @g INT = (SELECT TOP 1 GroupId FROM tblUserGroupMap WHERE UserId=@u);
DECLARE @r TABLE(...);  -- or just run and read both result sets
EXEC sp_FetchUserHandover @UserId=@u, @CompId=1;   -- OpenTasks > 0
-- (re-save with @UserActive=0 using that user's current values, @ActorUserId=1)
-- then:
SELECT COUNT(*) FROM tblTaskAssignee a JOIN tblTasks t ON t.Id=a.TaskId
 JOIN tblWorkspaces w ON w.Id=t.WorkspaceId
 WHERE a.UserId=@u AND t.IsCompleted=0 AND w.Type<>'personal';               -- 0
SELECT COUNT(*) FROM tblTasks t WHERE t.AssignedToUserId=@u AND t.IsCompleted=0
  AND NOT EXISTS (SELECT 1 FROM tblWorkspaces w WHERE w.Id=t.WorkspaceId AND w.Type='personal'); -- 0
SELECT TOP 5 * FROM tblNotifications WHERE Type='task_unassigned' ORDER BY Id DESC;
ROLLBACK;

-- 4. Delete refuses a user with history (no delete happens)
BEGIN TRAN;
EXEC sp_DeleteUser @Id=<any user with tblActivityLog rows>, @CompId=1, @BranchId=1, @IsAdmin=1, @RequestingUserId=1; -- 409 '...has ...'
ROLLBACK;

-- 5. Scope admin = any active group (two-group probe, rolled back)
DECLARE @se INT = (SELECT TOP 1 m.UserId FROM tblUserGroupMap m WHERE m.GroupId = 9); -- a Sales Head (level 2)
BEGIN TRAN;
INSERT INTO tblUserGroupMap (UserId, GroupId) VALUES (@se, 2);   -- also Admin (level 2, tie)
EXEC sp_FetchAccessibleBranchIds @UserId=@se, @CompId=1;          -- RS1 IsAdmin = 1 (was order-dependent)
EXEC sp_ValidateUser @UserId=@se;                                -- IsAdmin = 1 (same answer)
ROLLBACK;

-- 6. Manager resolution: today's no-manager people
SELECT u.Id, u.FullName FROM tblUser u WHERE u.IsActive=1 AND u.ReportsTo IS NULL;  -- 7 live
EXEC sp_FetchPersonManagers @UserId=<a Task Collaborator id>, @CompId=1;  -- admins, Source='admin'
EXEC sp_FetchPersonManagers @UserId=<an Owner id>, @CompId=1;            -- 0 rows
EXEC sp_FetchPersonManagers @UserId=<a Sales Exec with ReportsTo>, @CompId=1; -- 1 row 'manager'

-- 7. NoManager flag: expect 3 today (Sales Head + 2 Task Collaborators) under D3 default
EXEC sp_FetchUser @Id=0,@CompId=1,@BranchId=1,@IsAdmin=1,@AccessibleBranchIdsJson=NULL,@PageSize=100;
```

---

## Backend tasks

Files: `backend/src/controllers/userController.js`, `backend/src/routes/userRoutes.js`, tests in `backend/tests/unit/controllers/userController.test.js` and `backend/tests/unit/routes/userRoutes.test.js`.

### B1. `save`: group required, branch, no IsAdmin, actor, unassign fan-out (items 16–19)
**Tests first** (`userController.test.js`). Add `jest.mock("../../../src/realtime/events", () => ({ emitToWorkspace: jest.fn(), emitToUser: jest.fn() }))`. **Existing save tests send no `GroupId`, so they would now 400. Add `GroupId: 16` to every existing save body** (Mobile, hashes ×2, error handling ×2, ReportsTo ×2).
1. `400 VALIDATION_ERROR` and **no SP call** when `GroupId` is missing, `0`, `"abc"` or `-1` (`it.each`). *Regression: fails today (the default is 8).*
2. `IsAdmin: true` in the body is **not** forwarded: `params` has no `IsAdmin` key. *Regression: fails today.*
3. Create with `BranchId: 5` sends `BranchId: 5`; create without one sends `req.user.BranchId` (2).
4. Edit (`Id: 5`) without `BranchId` sends `BranchId: null` (the SP keeps the current one). *Regression: today it sends the admin's branch.*
5. Edit with `BranchId: 3` sends `3`. Edit with `BranchId: "x"` sends `null`.
6. `ActorUserId: req.user.UserId` (7) is sent.
7. When the SP returns RS2 `[{WorkspaceId: 40, OwnerUserId: 3, TaskCount: 2}]`: `emitToWorkspace(40, "task-list")` and `emitToUser(3, "notifications")` are called, and the response `data.unassignedTasks === 2`.
8. When there is no RS2 / empty RS2 (create): no emits, `unassignedTasks === 0`.
9. On an SP 400 ("You cannot deactivate your own account"): status passes through, no emits, no `logActivity`.

Run: `cd backend && pnpm exec jest tests/unit/controllers/userController.test.js` → red.

**Implementation** (`userController.js`):
- `require("../realtime/events")` → `{ emitToWorkspace, emitToUser }`; `require("../realtime/contract")` → `{ SCOPES }`.
- Destructure: drop `IsAdmin = false` and `GroupId = 8`; take `GroupId`, `BranchId`.
- Add before hashing:
  ```js
  // No default role: the old `GroupId = 8` pointed at a group that does not exist.
  const groupId = positiveInt(GroupId);
  if (!groupId) return validationError(res, "Pick a role for this user");
  const isEdit = positiveInt(Id) !== null;
  ```
- Params: remove `IsAdmin`. `GroupId: groupId`. `BranchId: positiveInt(BranchId) ?? (isEdit ? null : req.user.BranchId)` (admin-only route, so a body branch is allowed; absent on edit = keep). Add `ActorUserId: req.user.UserId`.
- After `ok`:
  ```js
  const unassigned = ok ? (result.recordsets?.[1] ?? []) : [];
  for (const r of unassigned) {
    emitToWorkspace(r.WorkspaceId, SCOPES.TASK_LIST);
    emitToUser(r.OwnerUserId, SCOPES.NOTIFICATIONS);
  }
  ```
  `data` gains `unassignedTasks: unassigned.reduce((n, r) => n + (r.TaskCount || 0), 0)`.
- `logActivity` description: `Id === 0` is kept as is; use `isEdit` for consistency.

Green → run coverage: `cd backend && pnpm exec jest tests/unit/controllers/userController.test.js --coverage --collectCoverageFrom='src/controllers/userController.js'` (≥80%).

### B2. `fetch` / `delete` read admin from `req.scope` (item 19, per request)
- Tests: `fetch` sends `IsAdmin: 1` when `req.scope.isAdmin === true` even if `req.user.IsAdmin` is false, and `0` in the reverse case. Same for `delete`. *Regression: fails today (it reads the JWT claim).*
- Impl: `IsAdmin: req.scope?.isAdmin ? 1 : 0` at both call sites (lines 112, 155), matching `workspaceController`.

### B3. `delete`: 409 passes through (item 17)
- Test: the SP returns `{ResponseCode: 409, ResponseMess: "Cannot delete: this user has leads. Deactivate them instead."}` → `res.status(409)`, the message is verbatim, no `logActivity`. The existing "surfaces an SP refusal" test covers the shape; this adds the 409 case explicitly. No code change is needed beyond B2.

### B4. NEW `handover` endpoint (item 16)
- Route: `router.post("/fetchUserHandover", requireAdmin, requirePayload, userController.handover);`
- Controller:
  ```js
  // What a user still holds (open tasks, leads, complaints, owned workspaces,
  // direct reports) so an admin can hand it over around deactivation.
  handover = asyncRoute(async (req, res) => {
    const Id = positiveInt(req.body.Id);
    if (!Id) return validationError(res, "User ID is required");
    const result = await database.executeStoredProcedure("sp_FetchUserHandover", {
      UserId: Id, CompId: req.user.CompId,
    });
    const head = firstRow(result);
    if (!spOk(head)) {
      return res.status(spStatus(head)).json({ success: false, message: spMessage(head),
        responseCode: spStatus(head), timestamp: new Date().toISOString() });
    }
    const { OpenTasks = 0, OpenLeads = 0, OpenTickets = 0, OwnedWorkspaces = 0, DirectReports = 0 } = head;
    return success(res, "Handover retrieved", { handover: {
      OpenTasks, OpenLeads, OpenTickets, OwnedWorkspaces, DirectReports,
      workspaces: cleanSpRows(result.recordsets?.[1] ?? []),
      reports: cleanSpRows(result.recordsets?.[2] ?? []),
    } });
  }, "Failed to fetch handover", "USER_HANDOVER_ERROR");
  ```
- Controller tests: 400 without `Id` (no SP call); it calls `sp_FetchUserHandover` with `{UserId, CompId: 1}` (not a body CompId); maps RS1–RS3; a 404 passes through; a throw → 500 `USER_HANDOVER_ERROR`.
- Route tests (`userRoutes.test.js`): add `handover` to the mocked controller; add `["/api/users/fetchUserHandover", { Id: 3 }]` to the `it.each` 403-for-non-admin list and to the department-head case; admin → 200.
- `tenancyContract.test.js` needs no change: the call passes `CompId`.

Run: `cd backend && pnpm exec jest tests/unit/controllers/userController.test.js tests/unit/routes/userRoutes.test.js tests/unit/controllers/tenancyContract.test.js`.

### B5. Docs (same change)
- `backend/ROLES.md:81`: Team = "ReportsTo subtree, + self" (audit B13).
- Replace the ROLES.md sentence "tblUser.IsAdmin is derived from the group at login" with: "the token **and** `req.scope` take IsAdmin from any active group; `tblUser.IsAdmin` is a mirror written by `sp_SaveUser` from the group and read by nothing".
- Add a one-liner on manager resolution: `sp_FetchPersonManagers`.

---

## Web tasks

Files: `web/src/pages/Master/Users.jsx`, `web/src/pages/Master/components/UserForm.jsx`, `web/src/api/masterQueries.js`, tests `Users.test.jsx`, `components/UserForm.test.jsx`, `web/src/test/mocks/handlers.js`.

### W1. `masterQueries.js`
- `users.fetchUserHandover: "/api/users/fetchUserHandover"` and `export const fetchUserHandover = post(MASTER_ENDPOINTS.users.fetchUserHandover);`
- MSW (`handlers.js`), next to `fetchUsers`:
  `http.post("*/api/users/fetchUserHandover", () => HttpResponse.json({ success: true, message: "ok", responseCode: 200, data: { handover: { OpenTasks: 0, OpenLeads: 0, OpenTickets: 0, OwnedWorkspaces: 0, DirectReports: 0, workspaces: [], reports: [] } } }))`

### W2. `UserForm.jsx`: drop Is Admin, role required, branch field, deactivation confirm (items 16–19)
**Tests first** (`UserForm.test.jsx`). `useApiQuery` is mocked globally there; change the `beforeEach` to `mockImplementation(({ endpoint }) => endpoint === "/api/users/fetchBranches" ? { data: { branches: [{ Id: 2, BranchName: "Mumbai" }, { Id: 3, BranchName: "Delhi" }] } } : { data: { users: [...] } })`.
1. No "Is Admin" checkbox is rendered (`queryByLabelText(/is admin/i)` is null), and the save payload has no `IsAdmin` key. *Regression.*
2. An edit of a user whose `GroupId` is `null`/`0` shows "Pick a role" and does **not** post. *Regression for audit B4: today it posts `GroupId: 0`.*
3. Create: the Branch select defaults to the admin's `BranchId` (2); picking "Delhi" sends `BranchId: 3`.
4. Edit: the Branch select is prefilled from `editingUser.BranchId` (3) and the payload sends `BranchId: 3`, **not** the admin's 2. *Regression: today `onSubmit` spreads `BranchId` from the auth store, which once the backend honours it would move every edited user to the admin's branch.*
5. The payload carries no `CompId` (the server takes it from the token).
6. Deactivation: edit an active user, untick "User Active", submit →
   - posts `/api/users/fetchUserHandover {Id: 11}` first, **not** `saveUser`;
   - a dialog shows "3 open tasks will be unassigned", "5 open leads", "2 open complaints", "1 workspace they own: Ops", "1 person reports to them: Asha";
   - the lead link `href` ends `/sales/leads?OwnerId=11` and the complaint link `/support/tickets?AssignedTo=11`;
   - Confirm "Deactivate" → posts `saveUser` with `UserActive: false`. Cancel → no save.
7. If the handover fetch fails, the dialog still opens with "Couldn't load what this user holds", and Confirm still saves. A lookup must not block the admin.
8. Editing that keeps `UserActive` unchanged (or re-activates) posts `saveUser` directly, with no handover call.
9. Success after deactivation: the snackbar reads "User updated successfully! 3 open tasks were unassigned." when `data.unassignedTasks > 0`.

Run: `cd web && pnpm exec vitest run src/pages/Master/components/UserForm.test.jsx` → red.

**Implementation:**
- Schema:
  - Remove `IsAdmin`.
  - `GroupId: z.number({ error: "Pick a role" }).int().positive("Pick a role")` (zod 4).
  - Add `BranchId: z.number({ error: "Pick a branch" }).int().positive("Pick a branch")`.
- Defaults: remove `IsAdmin: false`; add `BranchId: BranchId` from `useAuthStore()` for create. On edit `...editingUser` carries `BranchId` (W3).
- Branch options:
  ```js
  const { data: branchData } = useApiQuery({ queryKey: ["branches"], endpoint: SALES_ENDPOINTS.users.fetchBranches, params: {}, showErrorMessage: false });
  const branchOptions = (branchData?.branches ?? []).map((b) => ({ value: String(b.Id), label: b.BranchName }));
  ```
  Import `SALES_ENDPOINTS` from `api/salesQueries`. It reuses the Leads/Tickets cache key.
- Add a `FormSelect` "Branch" (required) in the Reports To row: `value={field.value ? String(field.value) : ""}`, `onChange={(e) => field.onChange(parseInt(e.target.value, 10))}`.
- Delete the `IsAdmin` Controller. The checkbox row keeps only "User Active".
- `onSubmit`: build `payload = { ...data, Id: editingUser ? editingUser.Id : 0, ReportsTo: data.ReportsTo ?? null, ...(editingUser && !data.Password && { Password: undefined }) }`. **Remove the `CompId`/`BranchId` auth-store overrides.** Move the existing save + snackbar body into `const doSave = async (payload) => {…}`. Throw on failure inside the confirm path so the dialog stays open (the `useConfirmation.handleConfirm` contract). Keep the current toast behaviour for the direct path.
- Deactivation:
  ```js
  const deactivating = Boolean(editingUser?.UserActive) && data.UserActive === false;
  if (!deactivating) return doSave(payload);
  let handover = null;
  try { handover = (await fetchUserHandover({ Id: editingUser.Id })).data?.data?.handover ?? null; } catch { /* shown as unknown */ }
  confirmation.confirmAction({
    title: "Deactivate user",
    message: <HandoverSummary userId={editingUser.Id} handover={handover} />,
    confirmText: "Deactivate",
    onConfirm: () => doSave(payload),
  });
  ```
  `confirmation = useConfirmation()` (import from `../../../hooks/useConfirmation`, not the barrel). Render `<ConfirmationDialog …/>` in the form with the same props as `Users.jsx:226-238`.
- `HandoverSummary`: a small component in the same file. It has one line per non-zero count, and "Nothing assigned" when all are zero.
  - "N open tasks will be unassigned. Their workspace owners are told."
  - "N open leads" → `<Link to={`/sales/leads?OwnerId=${id}`}>Transfer</Link>`
  - "N open complaints" → `<Link to={`/support/tickets?AssignedTo=${id}`}>Transfer</Link>`
  - "Owns: Ops, Sales board": names from `workspaces`, transferred from workspace settings.
  - "Reports to them: Asha, Ravi": re-point their Reports To.
  - The sentence "They keep ownership of leads, complaints and workspaces until you transfer them."
  
  Use `ui/` typography/Chip; no raw colours. `Link` from `react-router-dom`: the form is inside the router, and the Leads page's no-remount caveat does not apply because we are on `/users`.

### W3. `Users.jsx`: drop the Admin column, add Branch, "No manager" badge (items 18–20)
**Tests first** (`Users.test.jsx`):
1. Column order becomes `["Username","FullName","Email","JobTitle","GroupName","BranchName","ReportsToName","HourlyRate","IsActive","CreatedDate"]` (no `IsAdmin`). Update the existing order test and drop the IsAdmin Yes/No assertions in "renders the derived cells". *These are the regression assertions for item 19.*
2. The Reports To cell, with `row.original = { ReportsToName: null, NoManager: true }`, renders a "No manager" chip. With a name, it renders the name. With null and `NoManager: false` (an admin), it renders "—". The Cell signature changes to `({ cell, row })`; update the existing test helper to pass `row: { original: {...} }`.
3. `handleEdit` carries `BranchId: 3` and **no** `IsAdmin` into `editingUser`. It passes `GroupId: row.original.GroupId ?? null` (not `|| 0`), so the form's "Pick a role" fires instead of a silent 0.
4. The delete confirm message mentions "deactivate" (copy): "…Users with any history can't be deleted; deactivate them instead."

Run: `cd web && pnpm exec vitest run src/pages/Master/Users.test.jsx` → red.

**Implementation:**
- Remove the `IsAdmin` column (lines 71-83) and `IsAdmin: row.original.IsAdmin` (line 122).
- Add `{ accessorKey: "BranchName", header: "Branch", size: 110, Cell: ({ cell }) => cell.getValue() || "—" }` after GroupName.
- ReportsToName Cell:
  ```jsx
  Cell: ({ cell, row }) => cell.getValue()
    || (row.original.NoManager
        ? <Chip label="No manager" color="warning" size="small" variant="outlined" />
        : "—"),
  ```
  Add a `Tooltip`: "Alerts about this person go to the company admins".
- `handleEdit`: add `BranchId: row.original.BranchId ?? null`; change `GroupId: row.original.GroupId || 0` → `?? null`.
- Delete message copy as in test 4. The SP's 409 text already surfaces via `useMasterDelete`. The existing "surfaces a refusal from the API" test covers that.

Full web gate after W1–W3: `cd web && pnpm exec vitest run` (UserForm/Users are imported widely via `fetchUsers` consumers; nothing else reads `IsAdmin` from that list). Coverage on the touched files: `cd web && pnpm exec vitest run src/pages/Master --coverage` (≥80% on `Users.jsx`, `UserForm.jsx`).

---

## Mobile tasks

None. Admin user CRUD is permanently web-only (§9). Mobile reads `IsAdmin` only from the login payload, which is unchanged (`sp_ValidateUser` is already group-derived).

---

## Open decisions (recommended defaults)

- **D1. `tblUser.IsAdmin` column.** **Keep it, and stop taking it from the form.** `sp_SaveUser` writes it as a mirror of the chosen group's `IsAdmin`, so the column stays honest for ad-hoc SQL and old reports. Nothing reads it for a decision. Do not drop it now; a later cleanup can, once grep and `sys.sql_modules` show zero readers.
- **D2. Deactivation confirm UX.** **ConfirmationDialog on save when Active flips off** (counts + Transfer links). There is no list-level handover column and no panel for already-inactive users; reopening the user's edit form does not re-show counts. If wanted later, show `HandoverSummary` inline whenever editing an inactive user (same endpoint, no SQL).
- **D3. Who is flagged "No manager".** **Active users with no active ancestor, excluding members of an `IsAdmin` group** (Owner/Admin sit at the top by design, and their own alerts go nowhere per audit §5.10). Live, that is 3 (Sales Head + 2 Task Collaborators). The alternative is to flag all 7 as the spec text counts. One-line change in S5.
- **D4. Admin with no manager: who is told?** **Nobody** (`sp_FetchPersonManagers` returns 0 rows when the person is themselves an admin). The alternative is the other admins (drop the `@PersonIsAdmin = 0` term).
- **D5. Personal workspaces on deactivation.** **Untouched.** Only the owner can be assigned there, they are private even from admins, and P3 puts no clocks there. Unassigning would only orphan the user's own to-dos.
- **D6. Notification granularity.** **One per (owner, workspace)** with a count, `EntityType='Workspace'`. Per-task rows would flood an owner when a busy person leaves. Item 6 (deep links) can open the workspace.
- **D7. Self-deactivation guard** (`400 'You cannot deactivate your own account'`). **Include it**; it is a one-line lockout guard. "Last active admin" protection is **not** included; add it if wanted (one `NOT EXISTS` in S2).
- **D8. Delete refusal breadth.** **Any `tblActivityLog` row counts as history**, so delete becomes "undo a mistaken account" only. If too strict, drop that `WHEN` (and the sales/support-activity one).
- **D9. Branch list is company-blind** (`tblBranch` has no `CompId`; one company per DB today). Accepted, as in `sp_FetchBranches`. `sp_SaveUser` validates only that the branch exists.

---

## Risks / callers affected

- **Payload drift in the web form (high, fixed in W2).** `UserForm.onSubmit` sends `BranchId` from the **auth store** today. The backend ignores it now, but after B1 it would move every edited user to the admin's branch. W2 must ship **with** B1 (same deploy). Old cached web bundles hit the same risk. The SP's `ISNULL(@BranchId, BranchId)` protects only callers that omit it, so **deploy web and backend together** and tell admins to hard-refresh.
- **GroupId now required server-side.** Any other caller of `saveUser` without `GroupId` gets a 400. Only the web form calls it (grep: `masterQueries.saveUser` ← `UserForm.jsx`). Existing jest save tests must add `GroupId` (listed in B1).
- **`sp_SaveUser` returns a 2nd result set on update.** `firstRow` reads RS1 only, so this is safe.
- **`INSERT … EXEC` nesting.** `sp_UnassignUserFromOpenTasks` must never call another proc through `INSERT EXEC`, and it notifies via a direct `INSERT`. Item 5's callers (`sp_RemoveWorkspaceMember`, `sp_SaveTeam` cascade, `sp_SyncProjectWorkspaceMembers`, `sp_ArchiveWorkspace`) must invoke it as `INSERT INTO @t EXEC …` or plain `EXEC`. A plain `EXEC` would add a result set ahead of the caller's status row, so it is **only safe after the caller's own SELECTs, or via INSERT EXEC**. Coordinate with the item-5 plan, which owns those call sites.
- **Item 1 (soft delete) ordering.** If `tblTasks.IsDeleted` lands in the same script, add `AND t.IsDeleted = 0` in S1 and S6 (the comment is in place). Referencing the column before it exists fails at `CREATE`.
- **P3 hook.** P3's clock close (`CloseReason='user_left'`) belongs inside `sp_UnassignUserFromOpenTasks`. Item 16's "ends sessions" (P2) is likewise added to S2's deactivation branch then, not now.
- **`sp_FetchAccessibleBranchIds` runs on every request.** The added `EXISTS` is one indexed lookup on `tblUserGroupMap(UserId)`, so the cost is negligible. Behaviour changes only for multi-group users (0 live).
- **`sp_FetchUser` recursion** is over company users each call (20 rows); trivial now. With hundreds of users it is still fine, because the walk only continues through inactive managers.
- **Not closed here (other agents / later):**
  - `req.user.IsAdmin` (stale JWT) is still passed by `projectController`, `teamController`, `kanbanController`, `userGroupController` and `realtime/socket.js`. It is group-derived since 093 but stale until re-login. Switch them to `req.scope.isAdmin` in their own items.
  - `loadScope`'s catch fallback has no `isActive` (audit B7).
  - Sockets survive deactivation (B8).
- **Mobile:** no change. `mobile/src/types/api.ts` `IsAdmin` comes from login, which is unchanged.
- **Notion log (§0.5)** after shipping: Done + Change Log + Bug Fix Log, covering the GroupId 8 / FK 500, admin branch on create, delete wiping comments and time, and the scope IsAdmin tie.
