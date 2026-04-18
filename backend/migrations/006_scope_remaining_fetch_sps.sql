-- ============================================================
-- Migration 006 — Workstream C Phase 3
--
-- Adds @AccessibleBranchIdsJson scope param to the remaining
-- fetch SPs so multi-branch managers see across their
-- assigned branches:
--
--   sp_FetchTask        (scope via JOIN tblProjects.BranchId)
--   sp_FetchFollowUp    (scope via JOIN tblLeads.BranchId)
--   sp_FetchUser        (direct u.BranchId)
--   sp_FetchTeam        (direct t.BranchId)
--   sp_FetchTeamMember  (scope via JOIN tblTeams.BranchId)
--   sp_FetchTimeEntry   (scope via JOIN tblTasks → tblProjects.BranchId)
--   sp_Dashboard        (now company + branch scoped)
--   sp_ConvertedSummary (now company + branch scoped)
--
-- Backward-compatible: when the JSON is NULL/empty, falls back
-- to the existing behaviour.
-- ============================================================

USE [eCRM+]
GO

SET XACT_ABORT ON;
GO

-- ----- sp_FetchTask -----
ALTER PROC [dbo].[sp_FetchTask]
    @Id BIGINT,
    @ProjectId INT,
    @UserId INT,
    @CompId BIGINT,
    @BranchId BIGINT,
    @IsAdmin BIT,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @PageNumber INT = 1,
    @PageSize INT = 10,
    @SearchTerm NVARCHAR(100) = NULL
AS
BEGIN
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);
    DECLARE @TotalRecords INT;
    DECLARE @TotalPages INT;
    DECLARE @Offset INT;

    DECLARE @BranchIds TABLE (BranchId BIGINT);
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
        INSERT INTO @BranchIds (BranchId)
        SELECT CAST(value AS BIGINT) FROM OPENJSON(@AccessibleBranchIdsJson);
    DECLARE @UseScope BIT = CASE WHEN @AccessibleBranchIdsJson IS NULL OR @AccessibleBranchIdsJson = '' THEN 0 ELSE 1 END;

    IF (@Id = 0)
    BEGIN
        SET @Offset = (@PageNumber - 1) * @PageSize;

        SELECT @TotalRecords = COUNT(*)
        FROM tblTasks t
        INNER JOIN tblProjects p ON t.ProjectId = p.Id
        INNER JOIN tblUser creator ON t.CreatedByUserId = creator.Id
        LEFT JOIN tblUser assignee ON t.AssignedToUserId = assignee.Id
        LEFT JOIN tblTeams team ON t.TeamId = team.Id
        WHERE (@ProjectId IS NULL OR t.ProjectId = @ProjectId)
          AND (@UseScope = 0 OR p.BranchId IN (SELECT BranchId FROM @BranchIds))
          AND (@IsAdmin = 1 OR
               t.AssignedToUserId = @UserId OR t.CreatedByUserId = @UserId OR p.ManagerUserId = @UserId OR
               EXISTS (SELECT value FROM OPENJSON(p.Members) WHERE value = CAST(@UserId AS VARCHAR)) OR
               EXISTS (SELECT value FROM OPENJSON(t.Watchers) WHERE value = CAST(@UserId AS VARCHAR)))
          AND (@SearchTerm IS NULL OR t.Title LIKE '%' + @SearchTerm + '%' OR t.Description LIKE '%' + @SearchTerm + '%' OR assignee.FullName LIKE '%' + @SearchTerm + '%' OR team.Name LIKE '%' + @SearchTerm + '%');

        SET @TotalPages = CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize);

        IF @TotalRecords = 0
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'No tasks found';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   NULL AS Id, NULL AS Title, NULL AS Description, NULL AS ProjectId,
                   NULL AS ParentTaskId, NULL AS AssignedToUserId, NULL AS CreatedByUserId, NULL AS TeamId,
                   NULL AS Priority, NULL AS Type, NULL AS Status, NULL AS DueDate,
                   NULL AS EstimatedHours, NULL AS LoggedHours, NULL AS Progress, NULL AS IsBlocked,
                   NULL AS Labels, NULL AS Watchers, NULL AS Dependencies, NULL AS BranchId,
                   NULL AS ProjectName, NULL AS AssigneeName, NULL AS CreatorName, NULL AS TeamName, NULL AS SubTaskCount;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'Tasks retrieved successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   t.Id, t.Title, t.Description, t.ProjectId, t.ParentTaskId, t.AssignedToUserId,
                   t.CreatedByUserId, t.TeamId, t.Priority, t.Type, t.Status, t.DueDate,
                   t.EstimatedHours, t.LoggedHours, t.Progress, t.IsBlocked, t.Labels,
                   t.Watchers, t.Dependencies, p.BranchId,
                   p.Name AS ProjectName, assignee.FullName AS AssigneeName,
                   creator.FullName AS CreatorName, team.Name AS TeamName,
                   (SELECT COUNT(*) FROM tblTasks st WHERE st.ParentTaskId = t.Id) AS SubTaskCount
            FROM tblTasks t
            INNER JOIN tblProjects p ON t.ProjectId = p.Id
            INNER JOIN tblUser creator ON t.CreatedByUserId = creator.Id
            LEFT JOIN tblUser assignee ON t.AssignedToUserId = assignee.Id
            LEFT JOIN tblTeams team ON t.TeamId = team.Id
            WHERE (@ProjectId IS NULL OR t.ProjectId = @ProjectId)
              AND (@UseScope = 0 OR p.BranchId IN (SELECT BranchId FROM @BranchIds))
              AND (@IsAdmin = 1 OR
                   t.AssignedToUserId = @UserId OR t.CreatedByUserId = @UserId OR p.ManagerUserId = @UserId OR
                   EXISTS (SELECT value FROM OPENJSON(p.Members) WHERE value = CAST(@UserId AS VARCHAR)) OR
                   EXISTS (SELECT value FROM OPENJSON(t.Watchers) WHERE value = CAST(@UserId AS VARCHAR)))
              AND (@SearchTerm IS NULL OR t.Title LIKE '%' + @SearchTerm + '%' OR t.Description LIKE '%' + @SearchTerm + '%' OR assignee.FullName LIKE '%' + @SearchTerm + '%' OR team.Name LIKE '%' + @SearchTerm + '%')
            ORDER BY t.Priority DESC, t.DueDate ASC
            OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
        END
    END
    ELSE
    BEGIN
        IF EXISTS (
            SELECT 1 FROM tblTasks t
            INNER JOIN tblProjects p ON t.ProjectId = p.Id
            WHERE t.Id = @Id
              AND (@UseScope = 0 OR p.BranchId IN (SELECT BranchId FROM @BranchIds))
              AND (@IsAdmin = 1 OR
                   t.AssignedToUserId = @UserId OR t.CreatedByUserId = @UserId OR p.ManagerUserId = @UserId OR
                   EXISTS (SELECT value FROM OPENJSON(p.Members) WHERE value = CAST(@UserId AS VARCHAR)) OR
                   EXISTS (SELECT value FROM OPENJSON(t.Watchers) WHERE value = CAST(@UserId AS VARCHAR)))
        )
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'Task retrieved successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   t.Id, t.Title, t.Description, t.ProjectId, t.ParentTaskId, t.AssignedToUserId,
                   t.CreatedByUserId, t.TeamId, t.Priority, t.Type, t.Status, t.DueDate,
                   t.EstimatedHours, t.LoggedHours, t.Progress, t.IsBlocked, t.Labels,
                   t.Watchers, t.Dependencies, p.BranchId,
                   p.Name AS ProjectName, assignee.FullName AS AssigneeName,
                   creator.FullName AS CreatorName, team.Name AS TeamName,
                   (SELECT COUNT(*) FROM tblTasks st WHERE st.ParentTaskId = t.Id) AS SubTaskCount
            FROM tblTasks t
            INNER JOIN tblProjects p ON t.ProjectId = p.Id
            INNER JOIN tblUser creator ON t.CreatedByUserId = creator.Id
            LEFT JOIN tblUser assignee ON t.AssignedToUserId = assignee.Id
            LEFT JOIN tblTeams team ON t.TeamId = team.Id
            WHERE t.Id = @Id;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 404; SET @ResponseMess = 'Task not found or access denied';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   NULL AS Id, NULL AS Title, NULL AS Description, NULL AS ProjectId,
                   NULL AS ParentTaskId, NULL AS AssignedToUserId, NULL AS CreatedByUserId, NULL AS TeamId,
                   NULL AS Priority, NULL AS Type, NULL AS Status, NULL AS DueDate,
                   NULL AS EstimatedHours, NULL AS LoggedHours, NULL AS Progress, NULL AS IsBlocked,
                   NULL AS Labels, NULL AS Watchers, NULL AS Dependencies, NULL AS BranchId,
                   NULL AS ProjectName, NULL AS AssigneeName, NULL AS CreatorName, NULL AS TeamName, NULL AS SubTaskCount;
        END
    END
END
GO

-- ----- sp_FetchFollowUp -----
ALTER PROCEDURE sp_FetchFollowUp
(
    @Id INT = 0,
    @LeadId INT = 0,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @PageNumber INT = 1,
    @PageSize INT = 10,
    @SearchTerm NVARCHAR(200) = NULL
)
AS
BEGIN
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);
    DECLARE @TotalRecords INT;
    DECLARE @TotalPages INT;
    DECLARE @Offset INT;

    DECLARE @BranchIds TABLE (BranchId BIGINT);
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
        INSERT INTO @BranchIds (BranchId)
        SELECT CAST(value AS BIGINT) FROM OPENJSON(@AccessibleBranchIdsJson);
    DECLARE @UseScope BIT = CASE WHEN @AccessibleBranchIdsJson IS NULL OR @AccessibleBranchIdsJson = '' THEN 0 ELSE 1 END;

    IF (@Id = 0)
    BEGIN
        SET @Offset = (@PageNumber - 1) * @PageSize;

        SELECT @TotalRecords = COUNT(*)
        FROM tblFollowUp f
        LEFT JOIN tblLeads l ON f.LeadId = l.Id
        WHERE (@LeadId = 0 OR f.LeadId = @LeadId)
          AND (@UseScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
          AND (@SearchTerm IS NULL
               OR f.Remarks      LIKE '%' + @SearchTerm + '%'
               OR f.Status       LIKE '%' + @SearchTerm + '%'
               OR f.FollowupType LIKE '%' + @SearchTerm + '%');

        SET @TotalPages = CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize);

        IF @TotalRecords = 0
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'No follow-up records found';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   NULL AS Id, NULL AS LeadId, NULL AS NextFollowupDate,
                   NULL AS FollowupType, NULL AS Remarks, NULL AS Status,
                   NULL AS CreatedBy, NULL AS CreatedDate;
            RETURN;
        END

        SET @ResponseCode = 200; SET @ResponseMess = 'Follow-ups retrieved successfully';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
               @PageNumber AS CurrentPage, @PageSize AS PageSize,
               f.Id, f.LeadId, f.NextFollowupDate, f.FollowupType,
               f.Remarks, f.Status, f.CreatedBy, f.CreatedDate, f.EditBy, f.EditDate
        FROM tblFollowUp f
        LEFT JOIN tblLeads l ON f.LeadId = l.Id
        WHERE (@LeadId = 0 OR f.LeadId = @LeadId)
          AND (@UseScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
          AND (@SearchTerm IS NULL
               OR f.Remarks      LIKE '%' + @SearchTerm + '%'
               OR f.Status       LIKE '%' + @SearchTerm + '%'
               OR f.FollowupType LIKE '%' + @SearchTerm + '%')
        ORDER BY f.Id DESC
        OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
        RETURN;
    END
    ELSE
    BEGIN
        IF EXISTS (SELECT 1 FROM tblFollowUp WHERE Id = @Id)
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'Follow-up record fetched successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   f.*
            FROM tblFollowUp f
            WHERE f.Id = @Id;
            RETURN;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 404; SET @ResponseMess = 'Follow-up not found';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
        END
    END
END
GO

-- ----- sp_FetchUser -----
ALTER PROC [dbo].[sp_FetchUser]
    @Id INT,
    @CompId BIGINT,
    @BranchId BIGINT,
    @IsAdmin BIT,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @PageNumber INT = 1,
    @PageSize INT = 10,
    @SearchTerm NVARCHAR(100) = NULL
AS
BEGIN
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);
    DECLARE @TotalRecords INT;
    DECLARE @TotalPages INT;
    DECLARE @Offset INT;

    DECLARE @BranchIds TABLE (BranchId BIGINT);
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
        INSERT INTO @BranchIds (BranchId)
        SELECT CAST(value AS BIGINT) FROM OPENJSON(@AccessibleBranchIdsJson);
    DECLARE @UseScope BIT = CASE WHEN @AccessibleBranchIdsJson IS NULL OR @AccessibleBranchIdsJson = '' THEN 0 ELSE 1 END;

    IF (@Id = 0)
    BEGIN
        SET @Offset = (@PageNumber - 1) * @PageSize;

        SELECT @TotalRecords = COUNT(*)
        FROM tblUser u
        WHERE u.CompId = @CompId
          AND ((@UseScope = 1 AND u.BranchId IN (SELECT BranchId FROM @BranchIds))
            OR (@UseScope = 0 AND (@IsAdmin = 1 OR u.BranchId = @BranchId)))
          AND (@SearchTerm IS NULL OR
               u.Username LIKE '%' + @SearchTerm + '%' OR
               u.FullName LIKE '%' + @SearchTerm + '%' OR
               u.Email    LIKE '%' + @SearchTerm + '%' OR
               u.JobTitle LIKE '%' + @SearchTerm + '%');

        SET @TotalPages = CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize);

        IF @TotalRecords = 0
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'No users found';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   NULL AS Id, NULL AS Username, NULL AS IsActive, NULL AS IsAdmin,
                   NULL AS FullName, NULL AS Email, NULL AS JobTitle, NULL AS HourlyRate,
                   NULL AS GroupId, NULL AS GroupName,
                   NULL AS CompId, NULL AS BranchId, NULL AS CreatedDate;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'Users retrieved successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   u.Id, u.Username, u.IsActive, u.IsAdmin, u.FullName, u.Email,
                   u.JobTitle, u.HourlyRate, u.GroupId, ug.Name AS GroupName,
                   u.CompId, u.BranchId, u.CreatedDate
            FROM tblUser u
            LEFT JOIN tblUserGroups ug ON u.GroupId = ug.Id
            WHERE u.CompId = @CompId
              AND ((@UseScope = 1 AND u.BranchId IN (SELECT BranchId FROM @BranchIds))
                OR (@UseScope = 0 AND (@IsAdmin = 1 OR u.BranchId = @BranchId)))
              AND (@SearchTerm IS NULL OR
                   u.Username LIKE '%' + @SearchTerm + '%' OR
                   u.FullName LIKE '%' + @SearchTerm + '%' OR
                   u.Email    LIKE '%' + @SearchTerm + '%' OR
                   u.JobTitle LIKE '%' + @SearchTerm + '%')
            ORDER BY u.FullName
            OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
        END
    END
    ELSE
    BEGIN
        IF EXISTS (SELECT 1 FROM tblUser
                   WHERE Id = @Id AND CompId = @CompId
                     AND ((@UseScope = 1 AND BranchId IN (SELECT BranchId FROM @BranchIds))
                       OR (@UseScope = 0 AND (@IsAdmin = 1 OR BranchId = @BranchId))))
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'User retrieved successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   u.Id, u.Username, u.IsActive, u.IsAdmin, u.FullName, u.Email,
                   u.JobTitle, u.HourlyRate, u.GroupId, ug.Name AS GroupName,
                   u.CompId, u.BranchId, u.CreatedDate
            FROM tblUser u
            LEFT JOIN tblUserGroups ug ON u.GroupId = ug.Id
            WHERE u.Id = @Id AND u.CompId = @CompId;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 404; SET @ResponseMess = 'User not found or access denied';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   NULL AS Id, NULL AS Username, NULL AS IsActive, NULL AS IsAdmin,
                   NULL AS FullName, NULL AS Email, NULL AS JobTitle, NULL AS HourlyRate,
                   NULL AS GroupId, NULL AS GroupName,
                   NULL AS CompId, NULL AS BranchId, NULL AS CreatedDate;
        END
    END
END
GO

-- ----- sp_FetchTeam -----
ALTER PROC sp_FetchTeam
    @Id INT,
    @CompId BIGINT,
    @BranchId BIGINT,
    @IsAdmin BIT,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @PageNumber INT = 1,
    @PageSize INT = 10,
    @SearchTerm NVARCHAR(100) = NULL
AS
BEGIN
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);
    DECLARE @TotalRecords INT;
    DECLARE @TotalPages INT;
    DECLARE @Offset INT;

    DECLARE @BranchIds TABLE (BranchId BIGINT);
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
        INSERT INTO @BranchIds (BranchId)
        SELECT CAST(value AS BIGINT) FROM OPENJSON(@AccessibleBranchIdsJson);
    DECLARE @UseScope BIT = CASE WHEN @AccessibleBranchIdsJson IS NULL OR @AccessibleBranchIdsJson = '' THEN 0 ELSE 1 END;

    IF (@Id = 0)
    BEGIN
        SET @Offset = (@PageNumber - 1) * @PageSize;
        SELECT @TotalRecords = COUNT(*)
        FROM tblTeams t
        LEFT JOIN tblUser u ON t.LeadUserId = u.Id
        WHERE t.CompId = @CompId
          AND ((@UseScope = 1 AND t.BranchId IN (SELECT BranchId FROM @BranchIds))
            OR (@UseScope = 0 AND (@IsAdmin = 1 OR t.BranchId = @BranchId)))
          AND (@SearchTerm IS NULL OR t.Name LIKE '%' + @SearchTerm + '%' OR t.Description LIKE '%' + @SearchTerm + '%' OR u.FullName LIKE '%' + @SearchTerm + '%');
        SET @TotalPages = CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize);

        IF @TotalRecords = 0
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'No teams found';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   NULL AS Id, NULL AS Name, NULL AS Description, NULL AS LeadUserId,
                   NULL AS Color, NULL AS IsActive, NULL AS BranchId, NULL AS LeadName,
                   CAST(NULL AS NVARCHAR(MAX)) AS Members;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'Teams retrieved successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   t.Id, t.Name, t.Description, t.LeadUserId, t.Color, t.IsActive, t.BranchId,
                   u.FullName AS LeadName,
                   (SELECT '[' + STRING_AGG(
                       '{' +
                           '"UserId":' + CAST(tm.UserId AS VARCHAR) + ',' +
                           '"FullName":"' + REPLACE(ISNULL(mu.FullName, ''), '"', '\"') + '",' +
                           '"Email":"'    + REPLACE(ISNULL(mu.Email, ''),    '"', '\"') + '",' +
                           '"JobTitle":"' + REPLACE(ISNULL(mu.JobTitle, ''), '"', '\"') + '",' +
                           '"JoinedDate":"' + CONVERT(VARCHAR, tm.JoinedDate, 23) + '",' +
                           '"IsActive":' + CAST(tm.IsActive AS VARCHAR) +
                       '}', ',') + ']'
                    FROM tblTeamMembers tm INNER JOIN tblUser mu ON tm.UserId = mu.Id
                    WHERE tm.TeamId = t.Id AND tm.IsActive = 1 AND mu.IsActive = 1) AS Members
            FROM tblTeams t
            LEFT JOIN tblUser u ON t.LeadUserId = u.Id
            WHERE t.CompId = @CompId
              AND ((@UseScope = 1 AND t.BranchId IN (SELECT BranchId FROM @BranchIds))
                OR (@UseScope = 0 AND (@IsAdmin = 1 OR t.BranchId = @BranchId)))
              AND (@SearchTerm IS NULL OR t.Name LIKE '%' + @SearchTerm + '%' OR t.Description LIKE '%' + @SearchTerm + '%' OR u.FullName LIKE '%' + @SearchTerm + '%')
            ORDER BY t.Name
            OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
        END
    END
    ELSE
    BEGIN
        IF EXISTS (SELECT 1 FROM tblTeams WHERE Id = @Id AND CompId = @CompId)
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'Team retrieved successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   t.Id, t.Name, t.Description, t.LeadUserId, t.Color, t.IsActive, t.BranchId,
                   u.FullName AS LeadName,
                   (SELECT '[' + STRING_AGG(
                       '{' +
                           '"UserId":' + CAST(tm.UserId AS VARCHAR) + ',' +
                           '"FullName":"' + REPLACE(ISNULL(mu.FullName, ''), '"', '\"') + '",' +
                           '"Email":"'    + REPLACE(ISNULL(mu.Email, ''),    '"', '\"') + '",' +
                           '"JobTitle":"' + REPLACE(ISNULL(mu.JobTitle, ''), '"', '\"') + '",' +
                           '"JoinedDate":"' + CONVERT(VARCHAR, tm.JoinedDate, 23) + '",' +
                           '"IsActive":' + CAST(tm.IsActive AS VARCHAR) +
                       '}', ',') + ']'
                    FROM tblTeamMembers tm INNER JOIN tblUser mu ON tm.UserId = mu.Id
                    WHERE tm.TeamId = t.Id AND tm.IsActive = 1 AND mu.IsActive = 1) AS Members
            FROM tblTeams t
            LEFT JOIN tblUser u ON t.LeadUserId = u.Id
            WHERE t.Id = @Id;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 404; SET @ResponseMess = 'Team not found';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   NULL AS Id, NULL AS Name, NULL AS Description, NULL AS LeadUserId,
                   NULL AS Color, NULL AS IsActive, NULL AS BranchId, NULL AS LeadName,
                   CAST(NULL AS NVARCHAR(MAX)) AS Members;
        END
    END
END
GO

-- ----- sp_FetchTimeEntry -----
ALTER PROC sp_FetchTimeEntry
    @Id BIGINT,
    @TaskId BIGINT,
    @UserId INT,
    @CompId BIGINT,
    @BranchId BIGINT,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @PageNumber INT = 1,
    @PageSize INT = 20
AS
BEGIN
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);
    DECLARE @TotalRecords INT;
    DECLARE @TotalPages INT;
    DECLARE @Offset INT;

    DECLARE @BranchIds TABLE (BranchId BIGINT);
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
        INSERT INTO @BranchIds (BranchId)
        SELECT CAST(value AS BIGINT) FROM OPENJSON(@AccessibleBranchIdsJson);
    DECLARE @UseScope BIT = CASE WHEN @AccessibleBranchIdsJson IS NULL OR @AccessibleBranchIdsJson = '' THEN 0 ELSE 1 END;

    IF (@Id = 0)
    BEGIN
        SET @Offset = (@PageNumber - 1) * @PageSize;
        SELECT @TotalRecords = COUNT(*)
        FROM tblTimeEntries te
        INNER JOIN tblTasks t ON te.TaskId = t.Id
        INNER JOIN tblProjects p ON t.ProjectId = p.Id
        INNER JOIN tblUser u  ON te.UserId = u.Id
        WHERE (@TaskId IS NULL OR te.TaskId = @TaskId)
          AND (@UserId IS NULL OR te.UserId = @UserId)
          AND (@UseScope = 0 OR p.BranchId IN (SELECT BranchId FROM @BranchIds));
        SET @TotalPages = CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize);

        IF @TotalRecords = 0
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'No time entries found';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   NULL AS Id, NULL AS TaskId, NULL AS UserId, NULL AS Hours,
                   NULL AS Description, NULL AS WorkDate, NULL AS CreatedDate,
                   NULL AS TaskTitle, NULL AS UserName;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'Time entries retrieved successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
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
            ORDER BY te.WorkDate DESC, te.CreatedDate DESC
            OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
        END
    END
    ELSE
    BEGIN
        IF EXISTS (SELECT 1 FROM tblTimeEntries WHERE Id = @Id)
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'Time entry retrieved successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   te.Id, te.TaskId, te.UserId, te.Hours, te.Description, te.WorkDate, te.CreatedDate,
                   t.Title AS TaskTitle, u.FullName AS UserName
            FROM tblTimeEntries te
            INNER JOIN tblTasks t ON te.TaskId = t.Id
            INNER JOIN tblUser u  ON te.UserId = u.Id
            WHERE te.Id = @Id;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 404; SET @ResponseMess = 'Time entry not found';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   NULL AS Id, NULL AS TaskId, NULL AS UserId, NULL AS Hours,
                   NULL AS Description, NULL AS WorkDate, NULL AS CreatedDate,
                   NULL AS TaskTitle, NULL AS UserName;
        END
    END
END
GO

-- ----- sp_Dashboard (now scoped) -----
ALTER PROCEDURE sp_Dashboard
    @CompId BIGINT,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @BranchIds TABLE (BranchId BIGINT);
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
        INSERT INTO @BranchIds (BranchId)
        SELECT CAST(value AS BIGINT) FROM OPENJSON(@AccessibleBranchIdsJson);
    DECLARE @UseScope BIT = CASE WHEN @AccessibleBranchIdsJson IS NULL OR @AccessibleBranchIdsJson = '' THEN 0 ELSE 1 END;

    SELECT 'TotalLeads' AS Type, COUNT(*) AS Number
    FROM tblLeads
    WHERE CompId = @CompId
      AND (@UseScope = 0 OR BranchId IN (SELECT BranchId FROM @BranchIds))

    UNION ALL

    SELECT 'TodayNewLeads' AS Type, COUNT(*) AS Number
    FROM tblLeads
    WHERE CompId = @CompId
      AND (@UseScope = 0 OR BranchId IN (SELECT BranchId FROM @BranchIds))
      AND CAST(LeadDate AS DATE) = CAST(GETDATE() AS DATE)

    UNION ALL

    SELECT 'TodayFollowups' AS Type, COUNT(*) AS Number
    FROM tblLeads
    WHERE CompId = @CompId
      AND (@UseScope = 0 OR BranchId IN (SELECT BranchId FROM @BranchIds))
      AND CAST(FollowupDate AS DATE) = CAST(GETDATE() AS DATE)
      AND LeadStatus <> 'Converted'

    UNION ALL

    SELECT 'MissedFollowups' AS Type, COUNT(*) AS Number
    FROM tblLeads
    WHERE CompId = @CompId
      AND (@UseScope = 0 OR BranchId IN (SELECT BranchId FROM @BranchIds))
      AND FollowupDate < CAST(GETDATE() AS DATE)
      AND LeadStatus NOT IN ('Converted', 'Closed')
      AND FollowupDate IS NOT NULL;
END
GO

-- ----- sp_ConvertedSummary (now scoped) -----
ALTER PROCEDURE sp_ConvertedSummary
    @CompId BIGINT,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @BranchIds TABLE (BranchId BIGINT);
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
        INSERT INTO @BranchIds (BranchId)
        SELECT CAST(value AS BIGINT) FROM OPENJSON(@AccessibleBranchIdsJson);
    DECLARE @UseScope BIT = CASE WHEN @AccessibleBranchIdsJson IS NULL OR @AccessibleBranchIdsJson = '' THEN 0 ELSE 1 END;

    SELECT
        COUNT(*) AS TotalConverted,
        SUM(CASE
                WHEN CAST(InvoiceDate AS DATE) = CAST(GETDATE() AS DATE)
                THEN 1 ELSE 0
            END) AS TodayConverted
    FROM tblLeads
    WHERE CompId = @CompId
      AND LeadStatus = 'Converted'
      AND (@UseScope = 0 OR BranchId IN (SELECT BranchId FROM @BranchIds));
END
GO

PRINT '✓ Remaining fetch SPs are now scope-aware';
GO
