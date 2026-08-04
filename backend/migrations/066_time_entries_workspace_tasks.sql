-- 066_time_entries_workspace_tasks.sql
--
-- Fix: sp_FetchTimeEntry returns nothing for a workspace task.
--
-- The list query joins tblProjects with an INNER JOIN:
--
--     INNER JOIN tblProjects p ON t.ProjectId = p.Id
--
-- tblTasks.ProjectId is NULLable and every task created in a workspace has it
-- NULL, so the join drops the row and the caller sees an empty time log even
-- though the entry was written. Logging time then reading it back is the
-- normal flow, so the feature is dead for workspace tasks.
--
-- The join exists only to reach p.BranchId for the branch-scope filter. That
-- makes it a filter, not a gate — the same rule already applied to
-- sp_FetchTask, where AND-ing branch scope with membership blinded
-- cross-branch workspace members (see ROLES.md). Workspace tasks are
-- membership-governed and carry no branch of their own; tblTasks has neither
-- CompId nor BranchId.
--
-- Fix: LEFT JOIN, and let a task with no project through the scope predicate.
-- A project task still filters exactly as before.
--
-- No schema change. Nothing else calls this procedure.

ALTER PROC sp_FetchTimeEntry
    @Id BIGINT,
    @TaskId BIGINT,
    @UserId INT,
    @CompId BIGINT,
    @BranchId BIGINT,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @PageNumber INT = 1,
    @PageSize INT = 25,
    @SearchTerm NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @TotalRecords INT, @TotalPages INT, @Offset INT;

    DECLARE @BranchIds TABLE (BranchId BIGINT);
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
        INSERT INTO @BranchIds (BranchId)
        SELECT CAST(value AS BIGINT) FROM OPENJSON(@AccessibleBranchIdsJson);
    DECLARE @UseScope BIT = CASE WHEN @AccessibleBranchIdsJson IS NULL OR @AccessibleBranchIdsJson = '' THEN 0 ELSE 1 END;

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
      -- p.Id IS NULL = a workspace task, which has no branch to scope by.
      AND (@UseScope = 0 OR p.Id IS NULL OR p.BranchId IN (SELECT BranchId FROM @BranchIds))
      AND (@SearchTerm IS NULL OR te.Description LIKE '%' + @SearchTerm + '%' OR t.Title LIKE '%' + @SearchTerm + '%' OR u.FullName LIKE '%' + @SearchTerm + '%');

    SET @TotalPages = CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize);

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
      AND (@UseScope = 0 OR p.Id IS NULL OR p.BranchId IN (SELECT BranchId FROM @BranchIds))
      AND (@SearchTerm IS NULL OR te.Description LIKE '%' + @SearchTerm + '%' OR t.Title LIKE '%' + @SearchTerm + '%' OR u.FullName LIKE '%' + @SearchTerm + '%')
    ORDER BY te.WorkDate DESC, te.CreatedDate DESC
    OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
END
GO

-- ============================ verify after apply ============================
-- 1. The proc still compiles and the LEFT JOIN is in place:
--
--    SELECT CASE WHEN definition LIKE '%LEFT  JOIN tblProjects%'
--                THEN 'patched' ELSE 'NOT patched' END AS Status
--      FROM sys.sql_modules
--     WHERE object_id = OBJECT_ID('sp_FetchTimeEntry');
--
-- 2. A workspace task's time entries now come back. Pick any task with
--    ProjectId IS NULL that has entries, then:
--
--    EXEC sp_FetchTimeEntry @Id = 0, @TaskId = <that task id>, @UserId = NULL,
--         @CompId = <your CompId>, @BranchId = <your BranchId>;
--
--    Expect one row per entry. Before this script it returned zero.
--
-- 3. Project tasks are unaffected — same call with a task that HAS a
--    ProjectId returns exactly what it did before.
