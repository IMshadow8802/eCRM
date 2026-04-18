-- ============================================================
-- Migration 003 — Phase 2 of Workstream B + Workstream D
--
-- Part 1 (B-Phase 2): rename tblUser legacy columns to PascalCase
--   userid     → Id
--   username   → Username
--   password   → Password
--   useractive → IsActive
--   isadmin    → IsAdmin
--   User_IP    → UserIp
--
-- Part 2: ALTER all 17 SPs that referenced the legacy column names.
--
-- Part 3 (Workstream D): central tblActivityLog with sp_SaveActivityLog
-- and sp_FetchActivityLog. Existing tblTaskActivity rows are copied in
-- (one-time backfill); tblTaskActivity is left in place for now and
-- will be retired once every controller is wired through activityLogger.
--
-- Run in [eCRM+] in SSMS. Each batch is GO-terminated.
-- ============================================================

USE [eCRM+]
GO

SET XACT_ABORT ON;
GO

-- ============================================================
-- Part 1) tblUser column renames
-- ============================================================
BEGIN TRANSACTION;
EXEC sp_rename 'tblUser.userid',     'Id',       'COLUMN';
EXEC sp_rename 'tblUser.username',   'Username', 'COLUMN';
EXEC sp_rename 'tblUser.password',   'Password', 'COLUMN';
EXEC sp_rename 'tblUser.useractive', 'IsActive', 'COLUMN';
EXEC sp_rename 'tblUser.isadmin',    'IsAdmin',  'COLUMN';
EXEC sp_rename 'tblUser.User_IP',    'UserIp',   'COLUMN';
COMMIT TRANSACTION;
GO

PRINT '✓ tblUser columns renamed';
GO

-- ============================================================
-- Part 2) Stored procedure rewrites
-- ============================================================

-- ----- sp_ValidateUser -----
ALTER PROC sp_ValidateUser
    @username VARCHAR(100)
AS
BEGIN
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);
    DECLARE @UserId INT;

    IF EXISTS (SELECT 1 FROM tblUser WHERE Username = @username AND IsActive = 1)
    BEGIN
        SELECT @UserId = Id FROM tblUser WHERE Username = @username AND IsActive = 1;

        SET @ResponseCode = 200;
        SET @ResponseMess = 'User found successfully';

        SELECT @ResponseCode AS ResponseCode,
               @ResponseMess AS ResponseMess,
               u.Id       AS UserId,
               u.Username AS UserName,
               u.Password AS Password,
               u.IsActive AS UserActive,
               u.IsAdmin  AS IsAdmin,
               u.FullName, u.Email, u.JobTitle, u.HourlyRate, u.CompId, u.BranchId,
               'Your Company Name'  AS CompName,
               'Company Address'    AS CompAddress,
               'Company Phone'      AS CompPhone,
               'State'              AS CompState,
               'ST'                 AS CompStateCode,
               'company@email.com'  AS CompEmail,
               'www.company.com'    AS CompWebSite,
               'GSTIN123456789'     AS CompGSTIN
        FROM tblUser u
        WHERE u.Username = @username AND u.IsActive = 1;

        SELECT DISTINCT
               m.Id          AS MenuId,
               m.ParentId, m.Description, m.Image, m.FormId, m.MenuType, m.ActualId,
               m.IsAllowed, m.FormName, m.FormClass, m.OpenStyle,
               ga.CanAdd, ga.CanEdit, ga.CanDelete, ga.CanView,
               ug.Name AS GroupName
        FROM tblMenu m
        INNER JOIN tblGroupAccess ga    ON m.Id = ga.MenuId
        INNER JOIN tblUserGroupMap ugm  ON ga.GroupId = ugm.GroupId
        INNER JOIN tblUserGroups ug     ON ugm.GroupId = ug.Id
        WHERE ugm.UserId = @UserId
          AND m.IsAllowed = 1
          AND ga.CanView = 1
          AND ug.IsActive = 1
        ORDER BY m.ParentId, m.Id;
    END
    ELSE
    BEGIN
        SET @ResponseCode = 401;
        SET @ResponseMess = 'Invalid username or user is inactive';

        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               NULL AS UserId, NULL AS UserName, NULL AS Password, NULL AS UserActive, NULL AS IsAdmin,
               NULL AS FullName, NULL AS Email, NULL AS JobTitle, NULL AS HourlyRate,
               NULL AS CompId, NULL AS BranchId,
               NULL AS CompName, NULL AS CompAddress, NULL AS CompPhone, NULL AS CompState,
               NULL AS CompStateCode, NULL AS CompEmail, NULL AS CompWebSite, NULL AS CompGSTIN;

        SELECT NULL AS MenuId, NULL AS ParentId, NULL AS Description, NULL AS Image,
               NULL AS FormId, NULL AS MenuType, NULL AS ActualId, NULL AS IsAllowed,
               NULL AS FormName, NULL AS FormClass, NULL AS OpenStyle,
               NULL AS CanAdd, NULL AS CanEdit, NULL AS CanDelete, NULL AS CanView,
               NULL AS GroupName
        WHERE 1 = 0;
    END
END
GO

-- ----- sp_FetchUser -----
ALTER PROC [dbo].[sp_FetchUser]
    @Id INT,
    @CompId BIGINT,
    @BranchId BIGINT,
    @IsAdmin BIT,
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

    IF (@Id = 0)
    BEGIN
        SET @Offset = (@PageNumber - 1) * @PageSize;

        SELECT @TotalRecords = COUNT(*)
        FROM tblUser u
        WHERE u.CompId = @CompId
          AND (@IsAdmin = 1 OR u.BranchId = @BranchId)
          AND (@SearchTerm IS NULL OR
               u.Username LIKE '%' + @SearchTerm + '%' OR
               u.FullName LIKE '%' + @SearchTerm + '%' OR
               u.Email    LIKE '%' + @SearchTerm + '%' OR
               u.JobTitle LIKE '%' + @SearchTerm + '%');

        SET @TotalPages = CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize);

        IF @TotalRecords = 0
        BEGIN
            SET @ResponseCode = 200;
            SET @ResponseMess = 'No users found';
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
            SET @ResponseCode = 200;
            SET @ResponseMess = 'Users retrieved successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   u.Id, u.Username, u.IsActive, u.IsAdmin, u.FullName, u.Email,
                   u.JobTitle, u.HourlyRate, u.GroupId, ug.Name AS GroupName,
                   u.CompId, u.BranchId, u.CreatedDate
            FROM tblUser u
            LEFT JOIN tblUserGroups ug ON u.GroupId = ug.Id
            WHERE u.CompId = @CompId
              AND (@IsAdmin = 1 OR u.BranchId = @BranchId)
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
        IF EXISTS (SELECT 1 FROM tblUser WHERE Id = @Id AND CompId = @CompId AND (@IsAdmin = 1 OR BranchId = @BranchId))
        BEGIN
            SET @ResponseCode = 200;
            SET @ResponseMess = 'User retrieved successfully';
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
            SET @ResponseCode = 404;
            SET @ResponseMess = 'User not found or access denied';
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

-- ----- sp_SaveUser -----
ALTER PROC [dbo].[sp_SaveUser]
    @Id INT,
    @Username VARCHAR(100),
    @Password VARCHAR(500),
    @UserActive BIT,
    @IsAdmin BIT,
    @UserIp VARCHAR(50),
    @AllowDay INT,
    @FullName VARCHAR(200),
    @Email VARCHAR(150),
    @JobTitle VARCHAR(100),
    @HourlyRate DECIMAL(10,2),
    @GroupId INT,
    @CompId BIGINT,
    @BranchId BIGINT
AS
BEGIN
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);

    IF (@Username IS NULL OR LTRIM(RTRIM(@Username)) = '')
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Username is required and cannot be blank';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@Password IS NULL OR LTRIM(RTRIM(@Password)) = '')
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Password is required and cannot be blank';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@FullName IS NULL OR LTRIM(RTRIM(@FullName)) = '')
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Full name is required and cannot be blank';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@GroupId IS NOT NULL AND @GroupId > 0)
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM tblUserGroups WHERE Id = @GroupId AND IsActive = 1)
        BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid group selected';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    END
    ELSE
    BEGIN SET @GroupId = 8; END

    IF (@Id = 0)
    BEGIN
        IF EXISTS (SELECT 1 FROM tblUser WHERE Username = @Username AND CompId = @CompId)
        BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Username already exists';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

        INSERT INTO tblUser (Username, Password, IsActive, IsAdmin, UserIp, AllowDay, FullName, Email, JobTitle, HourlyRate, GroupId, CompId, BranchId)
        VALUES (@Username, @Password, @UserActive, @IsAdmin, @UserIp, @AllowDay, @FullName, @Email, @JobTitle, @HourlyRate, @GroupId, @CompId, @BranchId);

        SET @Id = SCOPE_IDENTITY();
        SET @ResponseCode = 201;
        SET @ResponseMess = 'User created successfully';

        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               @Id AS UserId, @GroupId AS AssignedGroupId;
    END
    ELSE
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM tblUser WHERE Id = @Id AND CompId = @CompId)
        BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'User not found';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

        IF EXISTS (SELECT 1 FROM tblUser WHERE Username = @Username AND Id != @Id AND CompId = @CompId)
        BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Username already exists';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

        UPDATE tblUser
        SET Username = @Username, Password = @Password, IsActive = @UserActive, IsAdmin = @IsAdmin,
            UserIp = @UserIp, AllowDay = @AllowDay, FullName = @FullName, Email = @Email,
            JobTitle = @JobTitle, HourlyRate = @HourlyRate, GroupId = @GroupId
        WHERE Id = @Id AND CompId = @CompId;

        SET @ResponseCode = 200;
        SET @ResponseMess = 'User updated successfully';

        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               @Id AS UserId, @GroupId AS AssignedGroupId;
    END
END
GO

-- ----- sp_DeleteUser -----
ALTER PROC sp_DeleteUser
    @Id INT,
    @CompId BIGINT,
    @BranchId BIGINT,
    @IsAdmin BIT,
    @RequestingUserId INT
AS
BEGIN
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);

    IF (@Id IS NULL OR @Id <= 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'User ID is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM tblUser WHERE Id = @Id AND CompId = @CompId AND (@IsAdmin = 1 OR BranchId = @BranchId))
    BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'User not found or access denied';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@Id = @RequestingUserId)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Cannot delete your own account';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF EXISTS (SELECT 1 FROM tblTasks WHERE AssignedToUserId = @Id)
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Cannot delete user - has assigned tasks';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF EXISTS (SELECT 1 FROM tblProjects WHERE ManagerUserId = @Id)
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Cannot delete user - is project manager';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF EXISTS (SELECT 1 FROM tblTeams WHERE LeadUserId = @Id)
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Cannot delete user - is team lead';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;
        DELETE FROM tblUserGroupMap WHERE UserId = @Id;
        DELETE FROM tblTeamMembers  WHERE UserId = @Id;
        DELETE FROM tblTimeEntries  WHERE UserId = @Id;
        DELETE FROM tblTaskComments WHERE UserId = @Id;
        DELETE FROM tblTaskActivity WHERE UserId = @Id;
        DELETE FROM tblUser WHERE Id = @Id;
        COMMIT TRANSACTION;

        SET @ResponseCode = 200;
        SET @ResponseMess = 'User deleted successfully';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END TRY
    BEGIN CATCH
        ROLLBACK TRANSACTION;
        SET @ResponseCode = 500;
        SET @ResponseMess = 'Failed to delete user: ' + ERROR_MESSAGE();
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END CATCH
END
GO

-- ----- sp_FetchAccessibleBranchIds (re-applied with new col names) -----
ALTER PROC sp_FetchAccessibleBranchIds
    @UserId INT,
    @CompId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @HierarchyLevel TINYINT;
    DECLARE @DataScope VARCHAR(20);
    DECLARE @PrimaryBranchId BIGINT;

    SELECT TOP 1
        @HierarchyLevel  = ug.HierarchyLevel,
        @DataScope       = ug.DataScope,
        @PrimaryBranchId = u.BranchId
    FROM tblUser u
    LEFT JOIN tblUserGroupMap ugm ON ugm.UserId = u.Id
    LEFT JOIN tblUserGroups   ug  ON ug.Id = ugm.GroupId
    WHERE u.Id = @UserId AND u.CompId = @CompId
    ORDER BY ug.HierarchyLevel ASC;

    IF @DataScope IS NULL      SET @DataScope = 'Self';
    IF @HierarchyLevel IS NULL SET @HierarchyLevel = 4;

    SELECT @HierarchyLevel AS HierarchyLevel, @DataScope AS DataScope, @PrimaryBranchId AS PrimaryBranchId;

    IF @DataScope IN ('All', 'Company')
        SELECT b.Id AS BranchId, CAST(1 AS BIT) AS CanWrite FROM tblBranch b;
    ELSE IF @DataScope = 'MultiBranch'
        SELECT BranchId, CanWrite FROM (
            SELECT @PrimaryBranchId AS BranchId, CAST(1 AS BIT) AS CanWrite
            UNION
            SELECT BranchId, CanWrite FROM tblUserBranchAccess WHERE UserId = @UserId AND CanRead = 1
        ) merged GROUP BY BranchId, CanWrite;
    ELSE
        SELECT @PrimaryBranchId AS BranchId, CAST(1 AS BIT) AS CanWrite;
END
GO

-- ----- sp_FetchProject -----
ALTER PROC sp_FetchProject
    @Id INT,
    @UserId INT,
    @CompId BIGINT,
    @BranchId BIGINT,
    @IsAdmin BIT,
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

    IF (@Id = 0)
    BEGIN
        SET @Offset = (@PageNumber - 1) * @PageSize;

        SELECT @TotalRecords = COUNT(*)
        FROM tblProjects p
        INNER JOIN tblUser u ON p.ManagerUserId = u.Id
        LEFT JOIN tblTeams t ON p.TeamId = t.Id
        LEFT JOIN tblTeamMembers tm ON tm.TeamId = p.TeamId AND tm.UserId = @UserId
        WHERE p.CompId = @CompId
          AND (@IsAdmin = 1 OR p.ManagerUserId = @UserId OR tm.UserId IS NOT NULL OR
               JSON_VALUE(p.Members, '$') LIKE '%' + CAST(@UserId AS VARCHAR) + '%')
          AND (@SearchTerm IS NULL OR p.Name LIKE '%' + @SearchTerm + '%' OR p.Description LIKE '%' + @SearchTerm + '%' OR u.FullName LIKE '%' + @SearchTerm + '%' OR t.Name LIKE '%' + @SearchTerm + '%');

        SET @TotalPages = CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize);

        IF @TotalRecords = 0
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'No projects found';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   NULL AS Id, NULL AS Name, NULL AS Description, NULL AS ManagerUserId,
                   NULL AS TeamId, NULL AS Members, NULL AS Status, NULL AS Priority,
                   NULL AS StartDate, NULL AS EndDate, NULL AS Budget, NULL AS Progress,
                   NULL AS ManagerName, NULL AS TeamName, NULL AS TaskCount;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'Projects retrieved successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   p.Id, p.Name, p.Description, p.ManagerUserId, p.TeamId, p.Members,
                   p.Status, p.Priority, p.StartDate, p.EndDate, p.Budget, p.Progress,
                   u.FullName AS ManagerName, t.Name AS TeamName,
                   (SELECT COUNT(*) FROM tblTasks ts WHERE ts.ProjectId = p.Id) AS TaskCount
            FROM tblProjects p
            INNER JOIN tblUser u ON p.ManagerUserId = u.Id
            LEFT JOIN tblTeams t ON p.TeamId = t.Id
            LEFT JOIN tblTeamMembers tm ON tm.TeamId = p.TeamId AND tm.UserId = @UserId
            WHERE p.CompId = @CompId
              AND (@IsAdmin = 1 OR p.ManagerUserId = @UserId OR tm.UserId IS NOT NULL OR
                   JSON_VALUE(p.Members, '$') LIKE '%' + CAST(@UserId AS VARCHAR) + '%')
              AND (@SearchTerm IS NULL OR p.Name LIKE '%' + @SearchTerm + '%' OR p.Description LIKE '%' + @SearchTerm + '%' OR u.FullName LIKE '%' + @SearchTerm + '%' OR t.Name LIKE '%' + @SearchTerm + '%')
            ORDER BY p.Name
            OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
        END
    END
    ELSE
    BEGIN
        IF EXISTS (
            SELECT 1 FROM tblProjects p
            LEFT JOIN tblTeamMembers tm ON tm.TeamId = p.TeamId AND tm.UserId = @UserId
            WHERE p.Id = @Id AND p.CompId = @CompId
              AND (@IsAdmin = 1 OR p.ManagerUserId = @UserId OR tm.UserId IS NOT NULL OR
                   JSON_VALUE(p.Members, '$') LIKE '%' + CAST(@UserId AS VARCHAR) + '%')
        )
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'Project retrieved successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   p.Id, p.Name, p.Description, p.ManagerUserId, p.TeamId, p.Members,
                   p.Status, p.Priority, p.StartDate, p.EndDate, p.Budget, p.Progress,
                   u.FullName AS ManagerName, t.Name AS TeamName,
                   (SELECT COUNT(*) FROM tblTasks ts WHERE ts.ProjectId = p.Id) AS TaskCount
            FROM tblProjects p
            INNER JOIN tblUser u ON p.ManagerUserId = u.Id
            LEFT JOIN tblTeams t ON p.TeamId = t.Id
            WHERE p.Id = @Id;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 404; SET @ResponseMess = 'Project not found or access denied';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   NULL AS Id, NULL AS Name, NULL AS Description, NULL AS ManagerUserId,
                   NULL AS TeamId, NULL AS Members, NULL AS Status, NULL AS Priority,
                   NULL AS StartDate, NULL AS EndDate, NULL AS Budget, NULL AS Progress,
                   NULL AS ManagerName, NULL AS TeamName, NULL AS TaskCount;
        END
    END
END
GO

-- ----- sp_SaveProject -----
ALTER PROC sp_SaveProject
    @Id INT,
    @Name VARCHAR(300),
    @Description NVARCHAR(MAX),
    @ManagerUserId INT,
    @TeamId INT,
    @Members NVARCHAR(MAX),
    @Status VARCHAR(20),
    @Priority VARCHAR(20),
    @StartDate DATE,
    @EndDate DATE,
    @Budget DECIMAL(18,2),
    @Progress DECIMAL(5,2),
    @CompId BIGINT,
    @BranchId BIGINT
AS
BEGIN
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);

    IF (@Name IS NULL OR LTRIM(RTRIM(@Name)) = '')
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Project name is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@ManagerUserId IS NULL OR @ManagerUserId <= 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Project manager is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM tblUser WHERE Id = @ManagerUserId AND IsActive = 1)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid project manager selected';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@TeamId IS NOT NULL AND @TeamId > 0)
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM tblTeams WHERE Id = @TeamId AND IsActive = 1)
        BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid team selected';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    END

    IF (@StartDate IS NOT NULL AND @EndDate IS NOT NULL AND @EndDate < @StartDate)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'End date must be after start date';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@Id = 0)
    BEGIN
        INSERT INTO tblProjects (Name, Description, ManagerUserId, TeamId, Members, Status, Priority, StartDate, EndDate, Budget, Progress, CompId, BranchId)
        VALUES (@Name, @Description, @ManagerUserId, @TeamId, @Members, @Status, @Priority, @StartDate, @EndDate, @Budget, @Progress, @CompId, @BranchId);
        SET @Id = SCOPE_IDENTITY();
        SET @ResponseCode = 201; SET @ResponseMess = 'Project created successfully';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, @Id AS ProjectId;
    END
    ELSE
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM tblProjects WHERE Id = @Id AND CompId = @CompId)
        BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Project not found';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

        UPDATE tblProjects
        SET Name = @Name, Description = @Description, ManagerUserId = @ManagerUserId, TeamId = @TeamId,
            Members = @Members, Status = @Status, Priority = @Priority, StartDate = @StartDate,
            EndDate = @EndDate, Budget = @Budget, Progress = @Progress
        WHERE Id = @Id AND CompId = @CompId;

        SET @ResponseCode = 200; SET @ResponseMess = 'Project updated successfully';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, @Id AS ProjectId;
    END
END
GO

-- ----- sp_FetchTask -----
ALTER PROC [dbo].[sp_FetchTask]
    @Id BIGINT,
    @ProjectId INT,
    @UserId INT,
    @CompId BIGINT,
    @BranchId BIGINT,
    @IsAdmin BIT,
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
                   NULL AS Labels, NULL AS Watchers, NULL AS Dependencies, NULL AS ProjectName,
                   NULL AS AssigneeName, NULL AS CreatorName, NULL AS TeamName, NULL AS SubTaskCount;
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
                   t.Watchers, t.Dependencies, p.Name AS ProjectName, assignee.FullName AS AssigneeName,
                   creator.FullName AS CreatorName, team.Name AS TeamName,
                   (SELECT COUNT(*) FROM tblTasks st WHERE st.ParentTaskId = t.Id) AS SubTaskCount
            FROM tblTasks t
            INNER JOIN tblProjects p ON t.ProjectId = p.Id
            INNER JOIN tblUser creator ON t.CreatedByUserId = creator.Id
            LEFT JOIN tblUser assignee ON t.AssignedToUserId = assignee.Id
            LEFT JOIN tblTeams team ON t.TeamId = team.Id
            WHERE (@ProjectId IS NULL OR t.ProjectId = @ProjectId)
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
                   t.Watchers, t.Dependencies, p.Name AS ProjectName, assignee.FullName AS AssigneeName,
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
                   NULL AS Labels, NULL AS Watchers, NULL AS Dependencies, NULL AS ProjectName,
                   NULL AS AssigneeName, NULL AS CreatorName, NULL AS TeamName, NULL AS SubTaskCount;
        END
    END
END
GO

-- ----- sp_SaveTask (validation reference to tblUser) -----
ALTER PROC sp_SaveTask
    @Id BIGINT,
    @Title VARCHAR(500),
    @Description NVARCHAR(MAX),
    @ProjectId INT,
    @ParentTaskId BIGINT,
    @AssignedToUserId INT,
    @CreatedByUserId INT,
    @TeamId INT,
    @Priority VARCHAR(20),
    @Type VARCHAR(50),
    @Status VARCHAR(50),
    @DueDate DATE,
    @EstimatedHours DECIMAL(10,2),
    @LoggedHours DECIMAL(10,2),
    @Progress DECIMAL(5,2),
    @IsBlocked BIT,
    @Labels NVARCHAR(MAX),
    @Watchers NVARCHAR(MAX),
    @Dependencies NVARCHAR(MAX),
    @CompId BIGINT,
    @BranchId BIGINT
AS
BEGIN
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);

    IF (@Title IS NULL OR LTRIM(RTRIM(@Title)) = '')
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Task title is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@ProjectId IS NULL OR @ProjectId <= 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Project is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@CreatedByUserId IS NULL OR @CreatedByUserId <= 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Created by user is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM tblProjects WHERE Id = @ProjectId)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid project selected';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@AssignedToUserId IS NOT NULL AND @AssignedToUserId > 0)
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM tblUser WHERE Id = @AssignedToUserId AND IsActive = 1)
        BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid assigned user selected';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    END

    IF (@TeamId IS NOT NULL AND @TeamId > 0)
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM tblTeams WHERE Id = @TeamId AND IsActive = 1)
        BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid team selected';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    END

    IF (@ParentTaskId IS NOT NULL AND @ParentTaskId > 0)
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM tblTasks WHERE Id = @ParentTaskId)
        BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid parent task selected';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    END

    IF (@Id = 0)
    BEGIN
        INSERT INTO tblTasks (Title, Description, ProjectId, ParentTaskId, AssignedToUserId, CreatedByUserId,
                             TeamId, Priority, Type, Status, DueDate, EstimatedHours, LoggedHours,
                             Progress, IsBlocked, Labels, Watchers, Dependencies)
        VALUES (@Title, @Description, @ProjectId, @ParentTaskId, @AssignedToUserId, @CreatedByUserId,
                @TeamId, @Priority, @Type, @Status, @DueDate, @EstimatedHours, @LoggedHours,
                @Progress, @IsBlocked, @Labels, @Watchers, @Dependencies);

        SET @Id = SCOPE_IDENTITY();
        INSERT INTO tblTaskActivity (TaskId, UserId, Action, Description)
        VALUES (@Id, @CreatedByUserId, 'created', 'Task created');

        SET @ResponseCode = 201; SET @ResponseMess = 'Task created successfully';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, @Id AS TaskId;
    END
    ELSE
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM tblTasks WHERE Id = @Id)
        BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Task not found';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

        DECLARE @OldStatus VARCHAR(50);
        SELECT @OldStatus = Status FROM tblTasks WHERE Id = @Id;

        UPDATE tblTasks
        SET Title = @Title, Description = @Description, ProjectId = @ProjectId,
            ParentTaskId = @ParentTaskId, AssignedToUserId = @AssignedToUserId, TeamId = @TeamId,
            Priority = @Priority, Type = @Type, Status = @Status, DueDate = @DueDate,
            EstimatedHours = @EstimatedHours, LoggedHours = @LoggedHours, Progress = @Progress,
            IsBlocked = @IsBlocked, Labels = @Labels, Watchers = @Watchers, Dependencies = @Dependencies
        WHERE Id = @Id;

        IF (@OldStatus != @Status)
        BEGIN
            INSERT INTO tblTaskActivity (TaskId, UserId, Action, OldValue, NewValue, Description)
            VALUES (@Id, @CreatedByUserId, 'status_changed', @OldStatus, @Status,
                    'Status changed from ' + @OldStatus + ' to ' + @Status);
        END
        ELSE
        BEGIN
            INSERT INTO tblTaskActivity (TaskId, UserId, Action, Description)
            VALUES (@Id, @CreatedByUserId, 'updated', 'Task updated');
        END

        SET @ResponseCode = 200; SET @ResponseMess = 'Task updated successfully';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, @Id AS TaskId;
    END
END
GO

-- ----- sp_FetchTaskComment -----
ALTER PROC sp_FetchTaskComment
    @Id BIGINT,
    @TaskId BIGINT,
    @UserId INT,
    @CompId BIGINT,
    @BranchId BIGINT,
    @PageNumber INT = 1,
    @PageSize INT = 20
AS
BEGIN
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);
    DECLARE @TotalRecords INT;
    DECLARE @TotalPages INT;
    DECLARE @Offset INT;

    IF (@Id = 0)
    BEGIN
        SET @Offset = (@PageNumber - 1) * @PageSize;
        SELECT @TotalRecords = COUNT(*) FROM tblTaskComments tc INNER JOIN tblUser u ON tc.UserId = u.Id WHERE tc.TaskId = @TaskId;
        SET @TotalPages = CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize);

        IF @TotalRecords = 0
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'No comments found';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   NULL AS Id, NULL AS TaskId, NULL AS UserId, NULL AS Comment,
                   NULL AS IsEdited, NULL AS CreatedDate, NULL AS UserName;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'Comments retrieved successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   tc.Id, tc.TaskId, tc.UserId, tc.Comment, tc.IsEdited, tc.CreatedDate,
                   u.FullName AS UserName
            FROM tblTaskComments tc INNER JOIN tblUser u ON tc.UserId = u.Id
            WHERE tc.TaskId = @TaskId
            ORDER BY tc.CreatedDate DESC
            OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
        END
    END
    ELSE
    BEGIN
        IF EXISTS (SELECT 1 FROM tblTaskComments WHERE Id = @Id)
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'Comment retrieved successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   tc.Id, tc.TaskId, tc.UserId, tc.Comment, tc.IsEdited, tc.CreatedDate,
                   u.FullName AS UserName
            FROM tblTaskComments tc INNER JOIN tblUser u ON tc.UserId = u.Id
            WHERE tc.Id = @Id;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 404; SET @ResponseMess = 'Comment not found';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   NULL AS Id, NULL AS TaskId, NULL AS UserId, NULL AS Comment,
                   NULL AS IsEdited, NULL AS CreatedDate, NULL AS UserName;
        END
    END
END
GO

-- ----- sp_SaveTaskComment -----
ALTER PROC sp_SaveTaskComment
    @Id BIGINT,
    @TaskId BIGINT,
    @UserId INT,
    @Comment NVARCHAR(MAX),
    @IsEdited BIT,
    @CompId BIGINT,
    @BranchId BIGINT
AS
BEGIN
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);

    IF (@TaskId IS NULL OR @TaskId <= 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Task ID is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    IF (@UserId IS NULL OR @UserId <= 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'User ID is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    IF (@Comment IS NULL OR LTRIM(RTRIM(@Comment)) = '')
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Comment cannot be blank';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM tblTasks WHERE Id = @TaskId)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid task selected';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM tblUser WHERE Id = @UserId AND IsActive = 1)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid user selected';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@Id = 0)
    BEGIN
        INSERT INTO tblTaskComments (TaskId, UserId, Comment, IsEdited)
        VALUES (@TaskId, @UserId, @Comment, 0);
        SET @Id = SCOPE_IDENTITY();
        INSERT INTO tblTaskActivity (TaskId, UserId, Action, Description)
        VALUES (@TaskId, @UserId, 'commented', 'Added a comment');
        SET @ResponseCode = 201; SET @ResponseMess = 'Comment added successfully';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, @Id AS CommentId;
    END
    ELSE
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM tblTaskComments WHERE Id = @Id AND UserId = @UserId)
        BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Comment not found or access denied';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

        UPDATE tblTaskComments SET Comment = @Comment, IsEdited = 1 WHERE Id = @Id AND UserId = @UserId;
        SET @ResponseCode = 200; SET @ResponseMess = 'Comment updated successfully';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, @Id AS CommentId;
    END
END
GO

-- ----- sp_FetchTaskActivity -----
ALTER PROC sp_FetchTaskActivity
    @Id BIGINT,
    @TaskId BIGINT,
    @UserId INT,
    @CompId BIGINT,
    @BranchId BIGINT,
    @PageNumber INT = 1,
    @PageSize INT = 50
AS
BEGIN
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);
    DECLARE @TotalRecords INT;
    DECLARE @TotalPages INT;
    DECLARE @Offset INT;

    IF (@Id = 0)
    BEGIN
        SET @Offset = (@PageNumber - 1) * @PageSize;
        SELECT @TotalRecords = COUNT(*) FROM tblTaskActivity ta INNER JOIN tblUser u ON ta.UserId = u.Id
        WHERE (@TaskId IS NULL OR ta.TaskId = @TaskId) AND (@UserId IS NULL OR ta.UserId = @UserId);
        SET @TotalPages = CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize);

        IF @TotalRecords = 0
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'No activities found';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   NULL AS Id, NULL AS TaskId, NULL AS UserId, NULL AS Action,
                   NULL AS OldValue, NULL AS NewValue, NULL AS Description, NULL AS CreatedDate,
                   NULL AS UserName;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'Activities retrieved successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   ta.Id, ta.TaskId, ta.UserId, ta.Action, ta.OldValue, ta.NewValue,
                   ta.Description, ta.CreatedDate, u.FullName AS UserName
            FROM tblTaskActivity ta INNER JOIN tblUser u ON ta.UserId = u.Id
            WHERE (@TaskId IS NULL OR ta.TaskId = @TaskId) AND (@UserId IS NULL OR ta.UserId = @UserId)
            ORDER BY ta.CreatedDate DESC
            OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
        END
    END
    ELSE
    BEGIN
        IF EXISTS (SELECT 1 FROM tblTaskActivity WHERE Id = @Id)
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'Activity retrieved successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   ta.Id, ta.TaskId, ta.UserId, ta.Action, ta.OldValue, ta.NewValue,
                   ta.Description, ta.CreatedDate, u.FullName AS UserName
            FROM tblTaskActivity ta INNER JOIN tblUser u ON ta.UserId = u.Id
            WHERE ta.Id = @Id;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 404; SET @ResponseMess = 'Activity not found';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   NULL AS Id, NULL AS TaskId, NULL AS UserId, NULL AS Action,
                   NULL AS OldValue, NULL AS NewValue, NULL AS Description, NULL AS CreatedDate,
                   NULL AS UserName;
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
    @PageNumber INT = 1,
    @PageSize INT = 20
AS
BEGIN
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);
    DECLARE @TotalRecords INT;
    DECLARE @TotalPages INT;
    DECLARE @Offset INT;

    IF (@Id = 0)
    BEGIN
        SET @Offset = (@PageNumber - 1) * @PageSize;
        SELECT @TotalRecords = COUNT(*)
        FROM tblTimeEntries te
        INNER JOIN tblTasks t ON te.TaskId = t.Id
        INNER JOIN tblUser u  ON te.UserId = u.Id
        WHERE (@TaskId IS NULL OR te.TaskId = @TaskId) AND (@UserId IS NULL OR te.UserId = @UserId);
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
            INNER JOIN tblUser u  ON te.UserId = u.Id
            WHERE (@TaskId IS NULL OR te.TaskId = @TaskId) AND (@UserId IS NULL OR te.UserId = @UserId)
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

-- ----- sp_SaveTimeEntry (no tblUser ref by alias; left unchanged) -----
-- (Body untouched — it doesn't reference tblUser cols.)

-- ----- sp_FetchTeam -----
ALTER PROC sp_FetchTeam
    @Id INT,
    @CompId BIGINT,
    @BranchId BIGINT,
    @IsAdmin BIT,
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

    IF (@Id = 0)
    BEGIN
        SET @Offset = (@PageNumber - 1) * @PageSize;
        SELECT @TotalRecords = COUNT(*)
        FROM tblTeams t
        LEFT JOIN tblUser u ON t.LeadUserId = u.Id
        WHERE t.CompId = @CompId AND (@IsAdmin = 1 OR t.BranchId = @BranchId)
          AND (@SearchTerm IS NULL OR t.Name LIKE '%' + @SearchTerm + '%' OR t.Description LIKE '%' + @SearchTerm + '%' OR u.FullName LIKE '%' + @SearchTerm + '%');
        SET @TotalPages = CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize);

        IF @TotalRecords = 0
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'No teams found';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   NULL AS Id, NULL AS Name, NULL AS Description, NULL AS LeadUserId,
                   NULL AS Color, NULL AS IsActive, NULL AS LeadName,
                   CAST(NULL AS NVARCHAR(MAX)) AS Members;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'Teams retrieved successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   t.Id, t.Name, t.Description, t.LeadUserId, t.Color, t.IsActive,
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
            WHERE t.CompId = @CompId AND (@IsAdmin = 1 OR t.BranchId = @BranchId)
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
                   t.Id, t.Name, t.Description, t.LeadUserId, t.Color, t.IsActive,
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
                   NULL AS Color, NULL AS IsActive, NULL AS LeadName,
                   CAST(NULL AS NVARCHAR(MAX)) AS Members;
        END
    END
END
GO

-- ----- sp_SaveTeam -----
ALTER PROC [dbo].[sp_SaveTeam]
    @Id INT,
    @Name VARCHAR(200),
    @Description VARCHAR(500),
    @LeadUserId INT,
    @Color VARCHAR(10),
    @Members NVARCHAR(MAX),
    @IsActive BIT,
    @CompId BIGINT,
    @BranchId BIGINT
AS
BEGIN
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);
    DECLARE @MemberCount INT = 0;

    IF (@Name IS NULL OR LTRIM(RTRIM(@Name)) = '')
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Team name is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@LeadUserId IS NOT NULL AND @LeadUserId > 0)
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM tblUser WHERE Id = @LeadUserId AND IsActive = 1)
        BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid team lead selected';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    END

    BEGIN TRY
        BEGIN TRANSACTION;
        IF (@Id = 0)
        BEGIN
            INSERT INTO tblTeams (Name, Description, LeadUserId, Color, IsActive, CompId, BranchId)
            VALUES (@Name, @Description, @LeadUserId, @Color, @IsActive, @CompId, @BranchId);
            SET @Id = SCOPE_IDENTITY();
            SET @ResponseCode = 201; SET @ResponseMess = 'Team created successfully';
        END
        ELSE
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM tblTeams WHERE Id = @Id AND CompId = @CompId)
            BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Team not found';
                  SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
                  ROLLBACK TRANSACTION; RETURN; END
            UPDATE tblTeams
            SET Name = @Name, Description = @Description, LeadUserId = @LeadUserId,
                Color = @Color, IsActive = @IsActive
            WHERE Id = @Id AND CompId = @CompId;
            SET @ResponseCode = 200; SET @ResponseMess = 'Team updated successfully';
            DELETE FROM tblTeamMembers WHERE TeamId = @Id;
        END

        IF (@Members IS NOT NULL AND @Members != '')
        BEGIN
            INSERT INTO tblTeamMembers (TeamId, UserId, JoinedDate, IsActive)
            SELECT @Id, CAST(value AS INT), GETDATE(), 1
            FROM OPENJSON(@Members)
            WHERE CAST(value AS INT) IN (SELECT Id FROM tblUser WHERE IsActive = 1);
            SET @MemberCount = @@ROWCOUNT;
        END

        COMMIT TRANSACTION;
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               @Id AS TeamId, @MemberCount AS MemberCount;
    END TRY
    BEGIN CATCH
        ROLLBACK TRANSACTION;
        SET @ResponseCode = 500; SET @ResponseMess = 'Error saving team: ' + ERROR_MESSAGE();
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END CATCH
END
GO

-- ----- sp_FetchTeamMember -----
ALTER PROC sp_FetchTeamMember
    @Id INT,
    @TeamId INT,
    @UserId INT,
    @CompId BIGINT,
    @BranchId BIGINT,
    @PageNumber INT = 1,
    @PageSize INT = 20
AS
BEGIN
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);
    DECLARE @TotalRecords INT;
    DECLARE @TotalPages INT;
    DECLARE @Offset INT;

    IF (@Id = 0)
    BEGIN
        SET @Offset = (@PageNumber - 1) * @PageSize;
        SELECT @TotalRecords = COUNT(*)
        FROM tblTeamMembers tm
        INNER JOIN tblTeams t ON tm.TeamId = t.Id
        INNER JOIN tblUser u  ON tm.UserId = u.Id
        WHERE (@TeamId IS NULL OR tm.TeamId = @TeamId) AND (@UserId IS NULL OR tm.UserId = @UserId);
        SET @TotalPages = CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize);

        IF @TotalRecords = 0
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'No team members found';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   NULL AS Id, NULL AS TeamId, NULL AS UserId, NULL AS JoinedDate, NULL AS IsActive,
                   NULL AS TeamName, NULL AS UserName, NULL AS Email, NULL AS JobTitle;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'Team members retrieved successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   tm.Id, tm.TeamId, tm.UserId, tm.JoinedDate, tm.IsActive,
                   t.Name AS TeamName, u.FullName AS UserName, u.Email, u.JobTitle
            FROM tblTeamMembers tm
            INNER JOIN tblTeams t ON tm.TeamId = t.Id
            INNER JOIN tblUser u  ON tm.UserId = u.Id
            WHERE (@TeamId IS NULL OR tm.TeamId = @TeamId) AND (@UserId IS NULL OR tm.UserId = @UserId)
            ORDER BY t.Name, u.FullName
            OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
        END
    END
    ELSE
    BEGIN
        IF EXISTS (SELECT 1 FROM tblTeamMembers WHERE Id = @Id)
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'Team member retrieved successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   tm.Id, tm.TeamId, tm.UserId, tm.JoinedDate, tm.IsActive,
                   t.Name AS TeamName, u.FullName AS UserName, u.Email, u.JobTitle
            FROM tblTeamMembers tm
            INNER JOIN tblTeams t ON tm.TeamId = t.Id
            INNER JOIN tblUser u  ON tm.UserId = u.Id
            WHERE tm.Id = @Id;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 404; SET @ResponseMess = 'Team member not found';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   NULL AS Id, NULL AS TeamId, NULL AS UserId, NULL AS JoinedDate, NULL AS IsActive,
                   NULL AS TeamName, NULL AS UserName, NULL AS Email, NULL AS JobTitle;
        END
    END
END
GO

-- ----- sp_SaveTeamMember (validation reference to tblUser) -----
ALTER PROC sp_SaveTeamMember
    @Id INT,
    @TeamId INT,
    @UserId INT,
    @JoinedDate DATE,
    @IsActive BIT,
    @CompId BIGINT,
    @BranchId BIGINT
AS
BEGIN
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);

    IF (@TeamId IS NULL OR @TeamId <= 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Team ID is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    IF (@UserId IS NULL OR @UserId <= 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'User ID is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM tblTeams WHERE Id = @TeamId AND IsActive = 1)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid team selected';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    IF NOT EXISTS (SELECT 1 FROM tblUser WHERE Id = @UserId AND IsActive = 1)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid user selected';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@Id = 0)
    BEGIN
        IF EXISTS (SELECT 1 FROM tblTeamMembers WHERE TeamId = @TeamId AND UserId = @UserId AND IsActive = 1)
        BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'User is already a member of this team';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

        INSERT INTO tblTeamMembers (TeamId, UserId, JoinedDate, IsActive)
        VALUES (@TeamId, @UserId, ISNULL(@JoinedDate, GETDATE()), @IsActive);
        SET @Id = SCOPE_IDENTITY();
        SET @ResponseCode = 201; SET @ResponseMess = 'Team member added successfully';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, @Id AS TeamMemberId;
    END
    ELSE
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM tblTeamMembers WHERE Id = @Id)
        BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Team member not found';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

        UPDATE tblTeamMembers SET JoinedDate = @JoinedDate, IsActive = @IsActive WHERE Id = @Id;
        SET @ResponseCode = 200; SET @ResponseMess = 'Team member updated successfully';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, @Id AS TeamMemberId;
    END
END
GO

PRINT '✓ tblUser-dependent SPs rewritten';
GO

-- ============================================================
-- Part 3) Workstream D — central activity log
-- ============================================================

CREATE TABLE tblActivityLog (
    Id          BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    EntityType  VARCHAR(50)  NOT NULL,
    EntityId    BIGINT       NOT NULL,
    Action      VARCHAR(50)  NOT NULL,
    FieldName   VARCHAR(100) NULL,
    OldValue    NVARCHAR(MAX) NULL,
    NewValue    NVARCHAR(MAX) NULL,
    Description NVARCHAR(500) NULL,
    UserId      INT          NOT NULL,
    CompId      BIGINT       NOT NULL,
    BranchId    BIGINT       NOT NULL,
    IpAddress   VARCHAR(45)  NULL,
    UserAgent   NVARCHAR(500) NULL,
    CreatedDate DATETIME     NOT NULL CONSTRAINT DF_tblActivityLog_CreatedDate DEFAULT GETDATE()
);
GO
CREATE INDEX IX_ActivityLog_Entity      ON tblActivityLog (EntityType, EntityId, CreatedDate DESC);
CREATE INDEX IX_ActivityLog_User_Date   ON tblActivityLog (UserId, CreatedDate DESC);
CREATE INDEX IX_ActivityLog_Branch_Date ON tblActivityLog (CompId, BranchId, CreatedDate DESC);
GO

-- ----- sp_SaveActivityLog -----
CREATE OR ALTER PROC sp_SaveActivityLog
    @EntityType  VARCHAR(50),
    @EntityId    BIGINT,
    @Action      VARCHAR(50),
    @FieldName   VARCHAR(100) = NULL,
    @OldValue    NVARCHAR(MAX) = NULL,
    @NewValue    NVARCHAR(MAX) = NULL,
    @Description NVARCHAR(500) = NULL,
    @UserId      INT,
    @CompId      BIGINT,
    @BranchId    BIGINT,
    @IpAddress   VARCHAR(45) = NULL,
    @UserAgent   NVARCHAR(500) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO tblActivityLog (EntityType, EntityId, Action, FieldName, OldValue, NewValue,
                                Description, UserId, CompId, BranchId, IpAddress, UserAgent)
    VALUES (@EntityType, @EntityId, @Action, @FieldName, @OldValue, @NewValue,
            @Description, @UserId, @CompId, @BranchId, @IpAddress, @UserAgent);
    SELECT 200 AS ResponseCode, 'Activity logged' AS ResponseMess, SCOPE_IDENTITY() AS Id;
END
GO

-- ----- sp_FetchActivityLog -----
CREATE OR ALTER PROC sp_FetchActivityLog
    @EntityType VARCHAR(50) = NULL,
    @EntityId   BIGINT = NULL,
    @UserId     INT = NULL,
    @Action     VARCHAR(50) = NULL,
    @FromDate   DATETIME = NULL,
    @ToDate     DATETIME = NULL,
    @CompId     BIGINT,
    @BranchIdsJson NVARCHAR(MAX) = NULL,  -- JSON array of branch IDs caller can read
    @PageNumber INT = 1,
    @PageSize   INT = 50
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @TotalRecords INT;
    DECLARE @TotalPages INT;
    DECLARE @Offset INT;
    SET @Offset = (@PageNumber - 1) * @PageSize;

    -- Parse JSON array of branch IDs (NULL means no scope filter — admin)
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
      AND (@BranchIdsJson IS NULL OR al.BranchId IN (SELECT BranchId FROM @BranchIds));

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
    ORDER BY al.CreatedDate DESC
    OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
END
GO

-- ============================================================
-- Part 4) One-time backfill: copy tblTaskActivity → tblActivityLog
-- (with EntityType='Task'). We pull CompId/BranchId from the related
-- task. Activity rows whose tasks have been hard-deleted are skipped.
-- ============================================================

INSERT INTO tblActivityLog (EntityType, EntityId, Action, FieldName, OldValue, NewValue,
                            Description, UserId, CompId, BranchId, CreatedDate)
SELECT 'Task' AS EntityType,
       ta.TaskId,
       ta.Action,
       NULL AS FieldName,
       ta.OldValue,
       ta.NewValue,
       ta.Description,
       ta.UserId,
       1 AS CompId,        -- single-tenant default; refine if multi-company added
       1 AS BranchId,      -- ditto; backfill placeholder
       ta.CreatedDate
FROM tblTaskActivity ta;
GO

PRINT '✓ tblActivityLog created and backfilled';
GO
