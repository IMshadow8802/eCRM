-- ============================================================
-- Migration 009 — uniform pagination + search across every fetch SP
--
-- Pattern for every user-facing list SP:
--   params: @PageNumber INT = 1, @PageSize INT = 25, @SearchTerm NVARCHAR(200) = NULL
--   returns (row 1 is envelope header):
--     ResponseCode, ResponseMess, TotalRecords, TotalPages, CurrentPage, PageSize, <data columns>
--   body: COUNT(*) + OFFSET…FETCH NEXT paging, SearchTerm LIKE filter on the
--   domain's most relevant text columns.
--
-- SPs that already had pagination + search (sp_FetchUser, sp_FetchUserGroup,
-- sp_FetchProject, sp_FetchTask, sp_FetchTeam, sp_FetchLeads, sp_FetchFollowUp)
-- are NOT re-touched here — they already follow the pattern.
--
-- SPs rewritten in this migration:
--   sp_FetchLeadSource         (added both)
--   sp_FetchStatus             (added both)
--   sp_FetchKanbanColumn       (added both)
--   sp_FetchUserBranchAccess   (added both)
--   sp_FetchTaskComment        (added search)
--   sp_FetchTaskActivity       (added search, still reads from tblActivityLog)
--   sp_FetchTaskChecklist      (added search)
--   sp_FetchTimeEntry          (added search)
--   sp_FetchTeamMember         (added search)
--   sp_FetchActivityLog        (added search on Description/Action)
-- ============================================================

USE [eCRM+]
GO

SET XACT_ABORT ON;
GO

-- ----- sp_FetchLeadSource -----
ALTER PROCEDURE [dbo].[sp_FetchLeadSource]
(
    @SourceId INT = 0,
    @PageNumber INT = 1,
    @PageSize INT = 25,
    @SearchTerm NVARCHAR(200) = NULL
)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @TotalRecords INT, @TotalPages INT, @Offset INT;

    IF (@SourceId <> 0)
    BEGIN
        SELECT 200 AS ResponseCode, 'OK' AS ResponseMess,
               NULL AS TotalRecords, NULL AS TotalPages,
               NULL AS CurrentPage, NULL AS PageSize,
               SourceId, SourceName
        FROM tblLeadSource
        WHERE SourceId = @SourceId;
        RETURN;
    END

    SET @Offset = (@PageNumber - 1) * @PageSize;

    SELECT @TotalRecords = COUNT(*)
    FROM tblLeadSource
    WHERE (@SearchTerm IS NULL OR SourceName LIKE '%' + @SearchTerm + '%');

    SET @TotalPages = CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize);

    SELECT 200 AS ResponseCode, 'OK' AS ResponseMess,
           @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
           @PageNumber AS CurrentPage, @PageSize AS PageSize,
           SourceId, SourceName
    FROM tblLeadSource
    WHERE (@SearchTerm IS NULL OR SourceName LIKE '%' + @SearchTerm + '%')
    ORDER BY SourceName
    OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
END
GO

-- ----- sp_FetchStatus -----
ALTER PROCEDURE sp_FetchStatus
(
    @StatusId INT = 0,
    @PageNumber INT = 1,
    @PageSize INT = 25,
    @SearchTerm NVARCHAR(200) = NULL
)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @TotalRecords INT, @TotalPages INT, @Offset INT;

    IF (@StatusId <> 0)
    BEGIN
        SELECT 200 AS ResponseCode, 'OK' AS ResponseMess,
               NULL AS TotalRecords, NULL AS TotalPages,
               NULL AS CurrentPage, NULL AS PageSize,
               StatusId, StatusName
        FROM tblStatus
        WHERE StatusId = @StatusId;
        RETURN;
    END

    SET @Offset = (@PageNumber - 1) * @PageSize;

    SELECT @TotalRecords = COUNT(*)
    FROM tblStatus
    WHERE (@SearchTerm IS NULL OR StatusName LIKE '%' + @SearchTerm + '%');

    SET @TotalPages = CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize);

    SELECT 200 AS ResponseCode, 'OK' AS ResponseMess,
           @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
           @PageNumber AS CurrentPage, @PageSize AS PageSize,
           StatusId, StatusName
    FROM tblStatus
    WHERE (@SearchTerm IS NULL OR StatusName LIKE '%' + @SearchTerm + '%')
    ORDER BY StatusId
    OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
END
GO

-- ----- sp_FetchKanbanColumn -----
ALTER PROC [dbo].[sp_FetchKanbanColumn]
    @Id INT = 0,
    @ProjectId INT = NULL,
    @CompId INT,
    @BranchId INT,
    @IsAdmin BIT = 0,
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

    IF (@CompId IS NULL OR @CompId <= 0 OR @BranchId IS NULL OR @BranchId <= 0)
    BEGIN
        SELECT 400 AS ResponseCode, 'Company and Branch ID are required' AS ResponseMess;
        RETURN;
    END

    SET @Offset = (@PageNumber - 1) * @PageSize;

    SELECT @TotalRecords = COUNT(*)
    FROM tblKanbanColumns kc
    LEFT JOIN tblProjects p ON kc.ProjectId = p.Id
    WHERE (@Id = 0 OR kc.Id = @Id)
      AND (@ProjectId IS NULL OR kc.ProjectId = @ProjectId)
      AND kc.CompId = @CompId
      AND kc.IsActive = 1
      AND (
        kc.IsCompanyWide = 1
        OR (@UseScope = 1 AND kc.BranchId IN (SELECT BranchId FROM @BranchIds))
        OR (@UseScope = 0 AND kc.BranchId = @BranchId)
      )
      AND (@SearchTerm IS NULL OR kc.Title LIKE '%' + @SearchTerm + '%' OR p.Name LIKE '%' + @SearchTerm + '%');

    SET @TotalPages = CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize);

    SELECT 200 AS ResponseCode, 'Kanban columns fetched successfully' AS ResponseMess,
           @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
           @PageNumber AS CurrentPage, @PageSize AS PageSize,
           kc.Id, kc.ProjectId, p.Name AS ProjectName, kc.Title, kc.Color,
           kc.SortOrder, kc.MaxTasks, kc.IsActive, kc.IsCompanyWide,
           kc.CompId, kc.BranchId, kc.CreatedDate
    FROM tblKanbanColumns kc
    LEFT JOIN tblProjects p ON kc.ProjectId = p.Id
    WHERE (@Id = 0 OR kc.Id = @Id)
      AND (@ProjectId IS NULL OR kc.ProjectId = @ProjectId)
      AND kc.CompId = @CompId
      AND kc.IsActive = 1
      AND (
        kc.IsCompanyWide = 1
        OR (@UseScope = 1 AND kc.BranchId IN (SELECT BranchId FROM @BranchIds))
        OR (@UseScope = 0 AND kc.BranchId = @BranchId)
      )
      AND (@SearchTerm IS NULL OR kc.Title LIKE '%' + @SearchTerm + '%' OR p.Name LIKE '%' + @SearchTerm + '%')
    ORDER BY kc.ProjectId, kc.SortOrder
    OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
END
GO

-- ----- sp_FetchUserBranchAccess -----
ALTER PROC sp_FetchUserBranchAccess
    @UserId INT,
    @CompId BIGINT,
    @PageNumber INT = 1,
    @PageSize INT = 25,
    @SearchTerm NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @TotalRecords INT, @TotalPages INT, @Offset INT;
    SET @Offset = (@PageNumber - 1) * @PageSize;

    SELECT @TotalRecords = COUNT(*)
    FROM tblUserBranchAccess uba
    INNER JOIN tblBranch b ON b.Id = uba.BranchId
    WHERE uba.UserId = @UserId AND uba.CompId = @CompId
      AND (@SearchTerm IS NULL OR b.BranchName LIKE '%' + @SearchTerm + '%');

    SET @TotalPages = CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize);

    SELECT 200 AS ResponseCode, 'OK' AS ResponseMess,
           @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
           @PageNumber AS CurrentPage, @PageSize AS PageSize,
           uba.Id, uba.UserId, uba.BranchId, b.BranchName,
           uba.CanRead, uba.CanWrite, uba.CreatedDate
    FROM tblUserBranchAccess uba
    INNER JOIN tblBranch b ON b.Id = uba.BranchId
    WHERE uba.UserId = @UserId AND uba.CompId = @CompId
      AND (@SearchTerm IS NULL OR b.BranchName LIKE '%' + @SearchTerm + '%')
    ORDER BY b.BranchName
    OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
END
GO

-- ----- sp_FetchTaskComment (add @SearchTerm on Comment) -----
ALTER PROC sp_FetchTaskComment
    @Id BIGINT,
    @TaskId BIGINT,
    @UserId INT,
    @CompId BIGINT,
    @BranchId BIGINT,
    @PageNumber INT = 1,
    @PageSize INT = 25,
    @SearchTerm NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @TotalRecords INT, @TotalPages INT, @Offset INT;

    IF (@Id <> 0)
    BEGIN
        IF EXISTS (SELECT 1 FROM tblTaskComments WHERE Id = @Id)
            SELECT 200 AS ResponseCode, 'Comment retrieved successfully' AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   tc.Id, tc.TaskId, tc.UserId, tc.Comment, tc.IsEdited, tc.CreatedDate,
                   u.FullName AS UserName
            FROM tblTaskComments tc INNER JOIN tblUser u ON tc.UserId = u.Id
            WHERE tc.Id = @Id;
        ELSE
            SELECT 404 AS ResponseCode, 'Comment not found' AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   NULL AS Id, NULL AS TaskId, NULL AS UserId, NULL AS Comment,
                   NULL AS IsEdited, NULL AS CreatedDate, NULL AS UserName;
        RETURN;
    END

    SET @Offset = (@PageNumber - 1) * @PageSize;

    SELECT @TotalRecords = COUNT(*)
    FROM tblTaskComments tc INNER JOIN tblUser u ON tc.UserId = u.Id
    WHERE tc.TaskId = @TaskId
      AND (@SearchTerm IS NULL OR tc.Comment LIKE '%' + @SearchTerm + '%' OR u.FullName LIKE '%' + @SearchTerm + '%');

    SET @TotalPages = CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize);

    SELECT 200 AS ResponseCode, 'Comments retrieved successfully' AS ResponseMess,
           @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
           @PageNumber AS CurrentPage, @PageSize AS PageSize,
           tc.Id, tc.TaskId, tc.UserId, tc.Comment, tc.IsEdited, tc.CreatedDate,
           u.FullName AS UserName
    FROM tblTaskComments tc INNER JOIN tblUser u ON tc.UserId = u.Id
    WHERE tc.TaskId = @TaskId
      AND (@SearchTerm IS NULL OR tc.Comment LIKE '%' + @SearchTerm + '%' OR u.FullName LIKE '%' + @SearchTerm + '%')
    ORDER BY tc.CreatedDate DESC
    OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
END
GO

-- ----- sp_FetchTaskChecklist (add @SearchTerm on ItemText) -----
ALTER PROC sp_FetchTaskChecklist
    @Id BIGINT,
    @TaskId BIGINT,
    @CompId BIGINT,
    @BranchId BIGINT,
    @PageNumber INT = 1,
    @PageSize INT = 25,
    @SearchTerm NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @TotalRecords INT, @TotalPages INT, @Offset INT;

    IF (@Id <> 0)
    BEGIN
        IF EXISTS (SELECT 1 FROM tblTaskChecklist WHERE Id = @Id)
            SELECT 200 AS ResponseCode, 'OK' AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   Id, TaskId, ItemText, IsCompleted, SortOrder
            FROM tblTaskChecklist WHERE Id = @Id;
        ELSE
            SELECT 404 AS ResponseCode, 'Checklist item not found' AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   NULL AS Id, NULL AS TaskId, NULL AS ItemText, NULL AS IsCompleted, NULL AS SortOrder;
        RETURN;
    END

    SET @Offset = (@PageNumber - 1) * @PageSize;

    SELECT @TotalRecords = COUNT(*)
    FROM tblTaskChecklist
    WHERE TaskId = @TaskId
      AND (@SearchTerm IS NULL OR ItemText LIKE '%' + @SearchTerm + '%');

    SET @TotalPages = CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize);

    SELECT 200 AS ResponseCode, 'Checklist items retrieved successfully' AS ResponseMess,
           @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
           @PageNumber AS CurrentPage, @PageSize AS PageSize,
           Id, TaskId, ItemText, IsCompleted, SortOrder
    FROM tblTaskChecklist
    WHERE TaskId = @TaskId
      AND (@SearchTerm IS NULL OR ItemText LIKE '%' + @SearchTerm + '%')
    ORDER BY SortOrder, Id
    OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
END
GO

-- ----- sp_FetchTimeEntry (add @SearchTerm on Description) -----
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
    INNER JOIN tblProjects p ON t.ProjectId = p.Id
    INNER JOIN tblUser u  ON te.UserId = u.Id
    WHERE (@TaskId IS NULL OR te.TaskId = @TaskId)
      AND (@UserId IS NULL OR te.UserId = @UserId)
      AND (@UseScope = 0 OR p.BranchId IN (SELECT BranchId FROM @BranchIds))
      AND (@SearchTerm IS NULL OR te.Description LIKE '%' + @SearchTerm + '%' OR t.Title LIKE '%' + @SearchTerm + '%' OR u.FullName LIKE '%' + @SearchTerm + '%');

    SET @TotalPages = CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize);

    SELECT 200 AS ResponseCode, 'Time entries retrieved successfully' AS ResponseMess,
           @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
           @PageNumber AS CurrentPage, @PageSize AS PageSize,
           te.Id, te.TaskId, te.UserId, te.Hours, te.Description, te.WorkDate, te.CreatedDate,
           t.Title AS TaskTitle, u.FullName AS UserName
    FROM tblTimeEntries te
    INNER JOIN tblTasks t ON te.TaskId = t.Id
    INNER JOIN tblProjects p ON t.ProjectId = p.Id
    INNER JOIN tblUser u  ON te.UserId = u.Id
    WHERE (@TaskId IS NULL OR te.TaskId = @TaskId)
      AND (@UserId IS NULL OR te.UserId = @UserId)
      AND (@UseScope = 0 OR p.BranchId IN (SELECT BranchId FROM @BranchIds))
      AND (@SearchTerm IS NULL OR te.Description LIKE '%' + @SearchTerm + '%' OR t.Title LIKE '%' + @SearchTerm + '%' OR u.FullName LIKE '%' + @SearchTerm + '%')
    ORDER BY te.WorkDate DESC, te.CreatedDate DESC
    OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
END
GO

-- ----- sp_FetchTeamMember (add @SearchTerm on FullName/JobTitle) -----
ALTER PROC sp_FetchTeamMember
    @Id INT,
    @TeamId INT,
    @UserId INT,
    @CompId BIGINT,
    @BranchId BIGINT,
    @PageNumber INT = 1,
    @PageSize INT = 25,
    @SearchTerm NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @TotalRecords INT, @TotalPages INT, @Offset INT;

    IF (@Id <> 0)
    BEGIN
        IF EXISTS (SELECT 1 FROM tblTeamMembers WHERE Id = @Id)
            SELECT 200 AS ResponseCode, 'OK' AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   tm.Id, tm.TeamId, tm.UserId, tm.JoinedDate, tm.IsActive,
                   t.Name AS TeamName, u.FullName AS UserName, u.Email, u.JobTitle
            FROM tblTeamMembers tm
            INNER JOIN tblTeams t ON tm.TeamId = t.Id
            INNER JOIN tblUser u  ON tm.UserId = u.Id
            WHERE tm.Id = @Id;
        ELSE
            SELECT 404 AS ResponseCode, 'Team member not found' AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   NULL AS Id, NULL AS TeamId, NULL AS UserId, NULL AS JoinedDate, NULL AS IsActive,
                   NULL AS TeamName, NULL AS UserName, NULL AS Email, NULL AS JobTitle;
        RETURN;
    END

    SET @Offset = (@PageNumber - 1) * @PageSize;

    SELECT @TotalRecords = COUNT(*)
    FROM tblTeamMembers tm
    INNER JOIN tblTeams t ON tm.TeamId = t.Id
    INNER JOIN tblUser u  ON tm.UserId = u.Id
    WHERE (@TeamId IS NULL OR tm.TeamId = @TeamId)
      AND (@UserId IS NULL OR tm.UserId = @UserId)
      AND (@SearchTerm IS NULL OR u.FullName LIKE '%' + @SearchTerm + '%' OR u.Email LIKE '%' + @SearchTerm + '%' OR u.JobTitle LIKE '%' + @SearchTerm + '%' OR t.Name LIKE '%' + @SearchTerm + '%');

    SET @TotalPages = CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize);

    SELECT 200 AS ResponseCode, 'Team members retrieved successfully' AS ResponseMess,
           @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
           @PageNumber AS CurrentPage, @PageSize AS PageSize,
           tm.Id, tm.TeamId, tm.UserId, tm.JoinedDate, tm.IsActive,
           t.Name AS TeamName, u.FullName AS UserName, u.Email, u.JobTitle
    FROM tblTeamMembers tm
    INNER JOIN tblTeams t ON tm.TeamId = t.Id
    INNER JOIN tblUser u  ON tm.UserId = u.Id
    WHERE (@TeamId IS NULL OR tm.TeamId = @TeamId)
      AND (@UserId IS NULL OR tm.UserId = @UserId)
      AND (@SearchTerm IS NULL OR u.FullName LIKE '%' + @SearchTerm + '%' OR u.Email LIKE '%' + @SearchTerm + '%' OR u.JobTitle LIKE '%' + @SearchTerm + '%' OR t.Name LIKE '%' + @SearchTerm + '%')
    ORDER BY t.Name, u.FullName
    OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
END
GO

-- ----- sp_FetchTaskActivity (reads tblActivityLog; add @SearchTerm) -----
ALTER PROC sp_FetchTaskActivity
    @Id BIGINT,
    @TaskId BIGINT,
    @UserId INT,
    @CompId BIGINT,
    @BranchId BIGINT,
    @PageNumber INT = 1,
    @PageSize INT = 25,
    @SearchTerm NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @TotalRecords INT, @TotalPages INT, @Offset INT;

    IF (@Id <> 0)
    BEGIN
        IF EXISTS (SELECT 1 FROM tblActivityLog WHERE Id = @Id)
            SELECT 200 AS ResponseCode, 'OK' AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   al.Id, al.EntityId AS TaskId, al.UserId, al.Action,
                   al.OldValue, al.NewValue, al.Description, al.CreatedDate,
                   u.FullName AS UserName
            FROM tblActivityLog al
            LEFT JOIN tblUser u ON al.UserId = u.Id
            WHERE al.Id = @Id;
        ELSE
            SELECT 404 AS ResponseCode, 'Activity not found' AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   NULL AS Id, NULL AS TaskId, NULL AS UserId, NULL AS Action,
                   NULL AS OldValue, NULL AS NewValue, NULL AS Description, NULL AS CreatedDate,
                   NULL AS UserName;
        RETURN;
    END

    SET @Offset = (@PageNumber - 1) * @PageSize;

    SELECT @TotalRecords = COUNT(*)
    FROM tblActivityLog al
    LEFT JOIN tblUser u ON al.UserId = u.Id
    WHERE al.EntityType IN ('Task', 'TaskComment', 'TaskChecklist', 'TimeEntry')
      AND (@TaskId IS NULL OR (al.EntityType = 'Task' AND al.EntityId = @TaskId))
      AND (@UserId IS NULL OR al.UserId = @UserId)
      AND al.CompId = @CompId
      AND (@SearchTerm IS NULL OR al.Description LIKE '%' + @SearchTerm + '%' OR al.Action LIKE '%' + @SearchTerm + '%' OR u.FullName LIKE '%' + @SearchTerm + '%');

    SET @TotalPages = CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize);

    SELECT 200 AS ResponseCode, 'Activities retrieved successfully' AS ResponseMess,
           @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
           @PageNumber AS CurrentPage, @PageSize AS PageSize,
           al.Id, al.EntityId AS TaskId, al.UserId, al.Action,
           al.OldValue, al.NewValue, al.Description, al.CreatedDate,
           u.FullName AS UserName
    FROM tblActivityLog al
    LEFT JOIN tblUser u ON al.UserId = u.Id
    WHERE al.EntityType IN ('Task', 'TaskComment', 'TaskChecklist', 'TimeEntry')
      AND (@TaskId IS NULL OR (al.EntityType = 'Task' AND al.EntityId = @TaskId))
      AND (@UserId IS NULL OR al.UserId = @UserId)
      AND al.CompId = @CompId
      AND (@SearchTerm IS NULL OR al.Description LIKE '%' + @SearchTerm + '%' OR al.Action LIKE '%' + @SearchTerm + '%' OR u.FullName LIKE '%' + @SearchTerm + '%')
    ORDER BY al.CreatedDate DESC
    OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
END
GO

-- ----- sp_FetchActivityLog (admin viewer — add @SearchTerm on Description/Action) -----
ALTER PROC sp_FetchActivityLog
    @EntityType VARCHAR(50) = NULL,
    @EntityId   BIGINT = NULL,
    @UserId     INT = NULL,
    @Action     VARCHAR(50) = NULL,
    @FromDate   DATETIME = NULL,
    @ToDate     DATETIME = NULL,
    @CompId     BIGINT,
    @BranchIdsJson NVARCHAR(MAX) = NULL,
    @PageNumber INT = 1,
    @PageSize   INT = 25,
    @SearchTerm NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @TotalRecords INT, @TotalPages INT, @Offset INT;
    SET @Offset = (@PageNumber - 1) * @PageSize;

    DECLARE @BranchIds TABLE (BranchId BIGINT);
    IF (@BranchIdsJson IS NOT NULL AND @BranchIdsJson <> '')
        INSERT INTO @BranchIds (BranchId) SELECT CAST(value AS BIGINT) FROM OPENJSON(@BranchIdsJson);

    SELECT @TotalRecords = COUNT(*)
    FROM tblActivityLog al
    LEFT JOIN tblUser u ON al.UserId = u.Id
    WHERE al.CompId = @CompId
      AND (@EntityType IS NULL OR al.EntityType = @EntityType)
      AND (@EntityId   IS NULL OR al.EntityId   = @EntityId)
      AND (@UserId     IS NULL OR al.UserId     = @UserId)
      AND (@Action     IS NULL OR al.Action     = @Action)
      AND (@FromDate   IS NULL OR al.CreatedDate >= @FromDate)
      AND (@ToDate     IS NULL OR al.CreatedDate <= @ToDate)
      AND (@BranchIdsJson IS NULL OR al.BranchId IN (SELECT BranchId FROM @BranchIds))
      AND (@SearchTerm IS NULL OR al.Description LIKE '%' + @SearchTerm + '%' OR al.Action LIKE '%' + @SearchTerm + '%' OR al.EntityType LIKE '%' + @SearchTerm + '%' OR u.FullName LIKE '%' + @SearchTerm + '%');

    SET @TotalPages = CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize);

    SELECT 200 AS ResponseCode, 'OK' AS ResponseMess,
           @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
           @PageNumber AS CurrentPage, @PageSize AS PageSize,
           al.Id, al.EntityType, al.EntityId, al.Action, al.FieldName,
           al.OldValue, al.NewValue, al.Description,
           al.UserId, u.FullName AS UserName,
           al.CompId, al.BranchId, al.IpAddress, al.UserAgent, al.CreatedDate
    FROM tblActivityLog al
    LEFT JOIN tblUser u ON al.UserId = u.Id
    WHERE al.CompId = @CompId
      AND (@EntityType IS NULL OR al.EntityType = @EntityType)
      AND (@EntityId   IS NULL OR al.EntityId   = @EntityId)
      AND (@UserId     IS NULL OR al.UserId     = @UserId)
      AND (@Action     IS NULL OR al.Action     = @Action)
      AND (@FromDate   IS NULL OR al.CreatedDate >= @FromDate)
      AND (@ToDate     IS NULL OR al.CreatedDate <= @ToDate)
      AND (@BranchIdsJson IS NULL OR al.BranchId IN (SELECT BranchId FROM @BranchIds))
      AND (@SearchTerm IS NULL OR al.Description LIKE '%' + @SearchTerm + '%' OR al.Action LIKE '%' + @SearchTerm + '%' OR al.EntityType LIKE '%' + @SearchTerm + '%' OR u.FullName LIKE '%' + @SearchTerm + '%')
    ORDER BY al.CreatedDate DESC
    OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
END
GO

PRINT '✓ Every user-facing fetch SP now has @PageNumber/@PageSize/@SearchTerm + TotalRecords envelope';
GO
