-- =============================================================================
-- 062_time_logging.sql
--
-- Workstream 3 of docs/superpowers/specs/2026-07-29-workspace-permission-model-design.md
--
-- Time logging has never worked. sp_SaveTimeEntry gates access with:
--
--     IF NOT EXISTS (
--         SELECT 1 FROM tblTasks t
--         INNER JOIN tblProjects p ON t.ProjectId = p.Id
--         WHERE t.Id = @TaskId
--           AND (t.AssignedToUserId = @UserId OR t.CreatedByUserId = @UserId
--                OR p.ManagerUserId = @UserId))
--
-- tblTasks.ProjectId was made nullable by 019_tbltasks_projectid_nullable.sql,
-- and every task in the system is a workspace task with ProjectId IS NULL
-- (19/19 live). The INNER JOIN therefore eliminates every row, the guard always
-- trips, and every logTaskTime call returns 404 'Task not found or access
-- denied'. The log_time action defined in sp_CheckTaskPermission has never been
-- reachable — it is dead code today.
--
-- The gate becomes a delegation to sp_CheckTaskPermission, which is the single
-- place task authority is decided. That also makes the proc work for workspace
-- tasks (all of them) instead of only project-linked ones.
--
-- Requires @IsAdmin, which the proc did not previously take; taskController
-- passes it (already does for every sibling call).
--
-- NOTE ON SEMANTICS: sp_CheckTaskPermission currently grants 'log_time' to
-- owner/manager/member — any member, assigned or not. The spec tightens this to
-- "owner/manager, or an assignee" as part of workstream 4, when the assignee
-- SET lands (tblTaskAssignee). Deliberately NOT tightened here: this script's
-- job is to make the feature work at all, and the tighter rule needs data that
-- does not exist yet. Do not "fix" the log_time branch in isolation.
--
-- sp_FetchTimeEntry carries the SAME broken INNER JOIN tblProjects, in both its
-- count and page queries — so even once logging works, the list would always
-- come back empty. Fixed here too; the join becomes a LEFT JOIN and the branch
-- scope predicate is dropped (time entries are task-scoped, and the controller
-- now authorizes the TaskId before calling — see 7271594).
--
-- sp_DeleteTimeEntry is correct as-is (own entry, or admin) and is untouched.
--
-- No schema changes, no data migration.
-- =============================================================================

ALTER PROC dbo.sp_SaveTimeEntry
    @Id          BIGINT,
    @TaskId      BIGINT,
    @UserId      INT,
    @Hours       DECIMAL(10,2),
    @Description VARCHAR(500),
    @WorkDate    DATE,
    @CompId      BIGINT,
    @BranchId    BIGINT,
    @IsAdmin     BIT = 0
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);
    DECLARE @TimeEntryId BIGINT;

    -- Validation
    IF (@TaskId IS NULL OR @TaskId <= 0)
    BEGIN
        SET @ResponseCode = 400;
        SET @ResponseMess = 'Task ID is required';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
        RETURN;
    END

    IF (@Hours IS NULL OR @Hours <= 0)
    BEGIN
        SET @ResponseCode = 400;
        SET @ResponseMess = 'Hours must be greater than 0';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
        RETURN;
    END

    -- Authority lives in sp_CheckTaskPermission, same as every other task
    -- write. The old INNER JOIN tblProjects gate could never match a workspace
    -- task (ProjectId is NULL on all of them), so this always 404'd. (062)
    DECLARE @PermTable TABLE (Allowed BIT, Reason VARCHAR(400));
    INSERT INTO @PermTable
    EXEC dbo.sp_CheckTaskPermission
        @TaskId      = @TaskId,
        @WorkspaceId = NULL,
        @CommentId   = NULL,
        @UserId      = @UserId,
        @Action      = 'log_time',
        @IsAdmin     = @IsAdmin,
        @CompId      = @CompId;

    IF NOT EXISTS (SELECT 1 FROM @PermTable WHERE Allowed = 1)
    BEGIN
        SET @ResponseCode = 404;
        SET @ResponseMess = 'Task not found or access denied';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
        RETURN;
    END

    IF (@Id = 0) -- Create new time entry
    BEGIN
        INSERT INTO tblTimeEntries (TaskId, UserId, Hours, Description, WorkDate)
        VALUES (@TaskId, @UserId, @Hours, @Description, @WorkDate);

        SET @TimeEntryId = SCOPE_IDENTITY();
        SET @ResponseCode = 201;
        SET @ResponseMess = 'Time logged successfully';

        UPDATE tblTasks
           SET LoggedHours = ISNULL(LoggedHours, 0) + @Hours
         WHERE Id = @TaskId;
    END
    ELSE -- Update existing time entry
    BEGIN
        DECLARE @OldHours DECIMAL(10,2);

        -- Editing someone else's entry stays owner-only regardless of the
        -- task-level grant above: an admin may correct any entry.
        SELECT @OldHours = Hours
          FROM tblTimeEntries
         WHERE Id = @Id AND (@IsAdmin = 1 OR UserId = @UserId);

        IF (@OldHours IS NULL)
        BEGIN
            SET @ResponseCode = 404;
            SET @ResponseMess = 'Time entry not found or access denied';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
            RETURN;
        END

        UPDATE tblTimeEntries
           SET Hours = @Hours, Description = @Description, WorkDate = @WorkDate
         WHERE Id = @Id;

        SET @TimeEntryId = @Id;
        SET @ResponseCode = 200;
        SET @ResponseMess = 'Time entry updated successfully';

        UPDATE tblTasks
           SET LoggedHours = ISNULL(LoggedHours, 0) - @OldHours + @Hours
         WHERE Id = @TaskId;
    END

    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
           @TimeEntryId AS TimeEntryId;
END
GO

-- ---------------------------------------------------------------------------
-- sp_FetchTimeEntry — same broken join, same fix.
--
--   INNER JOIN tblProjects p ON t.ProjectId = p.Id
--
-- appears in both the count and the page query. ProjectId is NULL on every
-- workspace task, so the list was always empty regardless of what had been
-- logged. LEFT JOIN keeps the (unused today) project-task case working.
--
-- The branch predicate (@UseScope / p.BranchId) goes with it: time entries are
-- task-scoped, and taskController.getTimeEntries now authorizes the TaskId via
-- sp_CheckTaskPermission before this runs. @AccessibleBranchIdsJson stays in
-- the signature so the call shape is unchanged, but is no longer a gate — the
-- same shape sp_FetchTask and sp_FetchWorkspaces settled on.
-- ---------------------------------------------------------------------------
ALTER PROC dbo.sp_FetchTimeEntry
    @Id                      BIGINT,
    @TaskId                  BIGINT,
    @UserId                  INT,
    @CompId                  BIGINT,
    @BranchId                BIGINT,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,   -- accepted, intentionally unused
    @PageNumber              INT = 1,
    @PageSize                INT = 25,
    @SearchTerm              NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @TotalRecords INT, @TotalPages INT, @Offset INT;

    IF (@Id <> 0)
    BEGIN
        IF EXISTS (SELECT 1 FROM tblTimeEntries WHERE Id = @Id)
            SELECT 200 AS ResponseCode, 'OK' AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   te.Id, te.TaskId, te.UserId, te.Hours, te.Description, te.WorkDate, te.CreatedDate,
                   t.Title AS TaskTitle, u.FullName AS UserName
            FROM tblTimeEntries te
            INNER JOIN tblTasks t ON te.TaskId = t.Id
            INNER JOIN tblUser u  ON te.UserId = u.Id
            WHERE te.Id = @Id;
        ELSE
            SELECT 404 AS ResponseCode, 'Time entry not found' AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   NULL AS Id, NULL AS TaskId, NULL AS UserId, NULL AS Hours,
                   NULL AS Description, NULL AS WorkDate, NULL AS CreatedDate,
                   NULL AS TaskTitle, NULL AS UserName;
        RETURN;
    END

    SET @Offset = (@PageNumber - 1) * @PageSize;

    SELECT @TotalRecords = COUNT(*)
    FROM tblTimeEntries te
    INNER JOIN tblTasks t ON te.TaskId = t.Id
    LEFT  JOIN tblProjects p ON t.ProjectId = p.Id
    INNER JOIN tblUser u  ON te.UserId = u.Id
    WHERE (@TaskId IS NULL OR te.TaskId = @TaskId)
      AND (@UserId IS NULL OR te.UserId = @UserId)
      AND (@SearchTerm IS NULL OR te.Description LIKE '%' + @SearchTerm + '%' OR t.Title LIKE '%' + @SearchTerm + '%' OR u.FullName LIKE '%' + @SearchTerm + '%');

    SET @TotalPages = CASE WHEN @PageSize > 0
                           THEN CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize)
                           ELSE 0 END;

    SELECT 200 AS ResponseCode, 'Time entries retrieved successfully' AS ResponseMess,
           @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
           @PageNumber AS CurrentPage, @PageSize AS PageSize,
           te.Id, te.TaskId, te.UserId, te.Hours, te.Description, te.WorkDate, te.CreatedDate,
           t.Title AS TaskTitle, u.FullName AS UserName
    FROM tblTimeEntries te
    INNER JOIN tblTasks t ON te.TaskId = t.Id
    LEFT  JOIN tblProjects p ON t.ProjectId = p.Id
    INNER JOIN tblUser u  ON te.UserId = u.Id
    WHERE (@TaskId IS NULL OR te.TaskId = @TaskId)
      AND (@UserId IS NULL OR te.UserId = @UserId)
      AND (@SearchTerm IS NULL OR te.Description LIKE '%' + @SearchTerm + '%' OR t.Title LIKE '%' + @SearchTerm + '%' OR u.FullName LIKE '%' + @SearchTerm + '%')
    ORDER BY te.WorkDate DESC, te.CreatedDate DESC
    OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
END
GO


-- =============================================================================
-- Verify after apply
-- =============================================================================
-- 1. The broken join is gone and the delegation is in:
--
-- SELECT CASE WHEN m.definition LIKE '%INNER JOIN tblProjects%' THEN 'NOT APPLIED'
--             WHEN m.definition LIKE '%sp_CheckTaskPermission%' THEN 'OK - 062 applied'
--             ELSE 'UNEXPECTED' END AS Status
-- FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
-- WHERE o.name = 'sp_SaveTimeEntry';
--
-- 2. An assignee can now log time on a workspace task (task 10030 in workspace
--    10011 is assigned to UserId 2). Roll back so no stray hours are kept:
--
-- BEGIN TRAN;
--   EXEC sp_SaveTimeEntry @Id = 0, @TaskId = 10030, @UserId = 2, @Hours = 1.5,
--        @Description = 'verify 062', @WorkDate = '2026-07-29',
--        @CompId = 1, @BranchId = 1, @IsAdmin = 0;
--   -- expect ResponseCode 201 'Time logged successfully' (was 404 before)
-- ROLLBACK TRAN;
--
-- 3. A non-member is still refused:
--
-- EXEC sp_SaveTimeEntry @Id = 0, @TaskId = 10030, @UserId = 1, @Hours = 1,
--      @Description = 'should fail', @WorkDate = '2026-07-29',
--      @CompId = 1, @BranchId = 1, @IsAdmin = 0;
-- -- expect ResponseCode 404 (UserId 1 'Super' is not a member of workspace 10011)
--
-- 4. Fractional hours survive the round trip (the sql.Int truncation fixed in
--    c29f370 applied to every decimal param, including @Hours):
--
-- BEGIN TRAN;
--   EXEC sp_SaveTimeEntry @Id = 0, @TaskId = 10030, @UserId = 2, @Hours = 2.25,
--        @Description = 'fractional', @WorkDate = '2026-07-29',
--        @CompId = 1, @BranchId = 1, @IsAdmin = 0;
--   SELECT TOP 1 Hours FROM tblTimeEntries ORDER BY Id DESC;  -- expect 2.25, not 2
-- ROLLBACK TRAN;
--
-- 5. The list actually returns what was logged (this was the second half of the
--    same bug — sp_FetchTimeEntry had the identical broken join, so entries
--    were invisible even when they existed):
--
-- SELECT CASE WHEN m.definition LIKE '%INNER JOIN tblProjects%'
--             THEN 'NOT APPLIED' ELSE 'OK - 062 applied' END AS Status
-- FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
-- WHERE o.name = 'sp_FetchTimeEntry';
--
-- BEGIN TRAN;
--   EXEC sp_SaveTimeEntry @Id = 0, @TaskId = 10030, @UserId = 2, @Hours = 1,
--        @Description = 'roundtrip', @WorkDate = '2026-07-29',
--        @CompId = 1, @BranchId = 1, @IsAdmin = 0;
--   EXEC sp_FetchTimeEntry @Id = 0, @TaskId = 10030, @UserId = NULL,
--        @CompId = 1, @BranchId = 1, @PageNumber = 1, @PageSize = 25;
--   -- expect the entry above, with WorkDate populated
-- ROLLBACK TRAN;
-- =============================================================================
