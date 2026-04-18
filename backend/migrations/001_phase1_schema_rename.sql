-- ============================================================
-- Migration 001 — Phase 1 schema standardization
-- Renames legacy snake_case / lowercase columns to PascalCase
-- on tblUserGroups, tblGroupAccess, tblMenu, tblFollowUp,
-- tblUser_Groups (also renamed to tblUserGroupMap).
--
-- Out of scope (Phase 2): tblUser column rename — has 30+ SP
-- fanout via FK refs and needs its own migration.
--
-- Run in [eCRM+] in SSMS. Each batch is GO-terminated.
-- ============================================================

USE [eCRM+]
GO

SET XACT_ABORT ON;
GO

-- ============================================================
-- 1) Column renames (sp_rename preserves FKs automatically)
-- ============================================================

BEGIN TRANSACTION;

-- tblUserGroups
EXEC sp_rename 'tblUserGroups.grp_id',           'Id',           'COLUMN';
EXEC sp_rename 'tblUserGroups.grp_name',         'Name',         'COLUMN';
EXEC sp_rename 'tblUserGroups.grp_description',  'Description',  'COLUMN';
EXEC sp_rename 'tblUserGroups.is_active',        'IsActive',     'COLUMN';

-- tblGroupAccess
EXEC sp_rename 'tblGroupAccess.accessid', 'Id',        'COLUMN';
EXEC sp_rename 'tblGroupAccess.groupid',  'GroupId',   'COLUMN';
EXEC sp_rename 'tblGroupAccess.menuid',   'MenuId',    'COLUMN';
EXEC sp_rename 'tblGroupAccess.isAdd',    'CanAdd',    'COLUMN';
EXEC sp_rename 'tblGroupAccess.isedit',   'CanEdit',   'COLUMN';
EXEC sp_rename 'tblGroupAccess.isDelete', 'CanDelete', 'COLUMN';
EXEC sp_rename 'tblGroupAccess.isView',   'CanView',   'COLUMN';

-- tblMenu
EXEC sp_rename 'tblMenu.menuid',      'Id',         'COLUMN';
EXEC sp_rename 'tblMenu.parentid',    'ParentId',   'COLUMN';
EXEC sp_rename 'tblMenu.image',       'Image',      'COLUMN';
EXEC sp_rename 'tblMenu.formid',      'FormId',     'COLUMN';
EXEC sp_rename 'tblMenu.mnutype',     'MenuType',   'COLUMN';
EXEC sp_rename 'tblMenu.mnuActualID', 'ActualId',   'COLUMN';
EXEC sp_rename 'tblMenu.isallowed',   'IsAllowed',  'COLUMN';
EXEC sp_rename 'tblMenu.formname',    'FormName',   'COLUMN';
EXEC sp_rename 'tblMenu.formclass',   'FormClass',  'COLUMN';

-- tblFollowUp
EXEC sp_rename 'tblFollowUp.LeadID', 'LeadId', 'COLUMN';

-- tblUser_Groups → tblUserGroupMap (rename junction table + its cols)
EXEC sp_rename 'tblUser_Groups',          'tblUserGroupMap';
EXEC sp_rename 'tblUserGroupMap.ID',      'Id',      'COLUMN';
EXEC sp_rename 'tblUserGroupMap.user_id', 'UserId',  'COLUMN';
EXEC sp_rename 'tblUserGroupMap.grp_id',  'GroupId', 'COLUMN';

COMMIT TRANSACTION;
GO

PRINT '✓ Column/table renames complete';
GO

-- ============================================================
-- 2) Stored procedure rewrites
-- ============================================================

-- ----- sp_ValidateUser -----
ALTER PROC sp_ValidateUser
    @username VARCHAR(100)
AS
BEGIN
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);
    DECLARE @UserId INT;

    IF EXISTS (SELECT 1 FROM tblUser WHERE username = @username AND useractive = 1)
    BEGIN
        SELECT @UserId = userid FROM tblUser WHERE username = @username AND useractive = 1;

        SET @ResponseCode = 200;
        SET @ResponseMess = 'User found successfully';

        SELECT @ResponseCode AS ResponseCode,
               @ResponseMess AS ResponseMess,
               u.userid AS UserId,
               u.username AS UserName,
               u.password AS Password,
               u.useractive AS UserActive,
               u.isadmin AS IsAdmin,
               u.FullName,
               u.Email,
               u.JobTitle,
               u.HourlyRate,
               u.CompId,
               u.BranchId,
               'Your Company Name' AS CompName,
               'Company Address'  AS CompAddress,
               'Company Phone'    AS CompPhone,
               'State'            AS CompState,
               'ST'               AS CompStateCode,
               'company@email.com' AS CompEmail,
               'www.company.com'  AS CompWebSite,
               'GSTIN123456789'   AS CompGSTIN
        FROM tblUser u
        WHERE u.username = @username AND u.useractive = 1;

        SELECT DISTINCT
               m.Id          AS MenuId,
               m.ParentId,
               m.Description,
               m.Image,
               m.FormId,
               m.MenuType,
               m.ActualId,
               m.IsAllowed,
               m.FormName,
               m.FormClass,
               m.OpenStyle,
               ga.CanAdd,
               ga.CanEdit,
               ga.CanDelete,
               ga.CanView,
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

        SELECT @ResponseCode AS ResponseCode,
               @ResponseMess AS ResponseMess,
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

-- ----- sp_FetchMenu -----
ALTER PROC sp_FetchMenu
    @Id INT,
    @UserId INT,
    @ParentId INT = NULL
AS
BEGIN
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);

    IF (@Id = 0)
    BEGIN
        SET @ResponseCode = 200;
        SET @ResponseMess = 'Menu retrieved successfully';

        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               m.Id AS MenuId, m.ParentId, m.Description, m.Image, m.FormId, m.MenuType,
               m.ActualId, m.IsAllowed, m.FormName, m.FormClass, m.OpenStyle,
               ga.CanAdd, ga.CanEdit, ga.CanDelete, ga.CanView
        FROM tblMenu m
        INNER JOIN tblGroupAccess ga   ON m.Id = ga.MenuId
        INNER JOIN tblUserGroupMap ug  ON ga.GroupId = ug.GroupId
        WHERE ug.UserId = @UserId
          AND m.IsAllowed = 1
          AND ga.CanView = 1
          AND (@ParentId IS NULL OR m.ParentId = @ParentId)
        ORDER BY m.ParentId, m.Id;
    END
    ELSE
    BEGIN
        IF EXISTS (SELECT 1 FROM tblMenu WHERE Id = @Id)
        BEGIN
            SET @ResponseCode = 200;
            SET @ResponseMess = 'Menu item retrieved successfully';

            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   m.Id AS MenuId, m.ParentId, m.Description, m.Image, m.FormId, m.MenuType,
                   m.ActualId, m.IsAllowed, m.FormName, m.FormClass, m.OpenStyle,
                   NULL AS CanAdd, NULL AS CanEdit, NULL AS CanDelete, NULL AS CanView
            FROM tblMenu m
            WHERE m.Id = @Id;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 404;
            SET @ResponseMess = 'Menu item not found';

            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS MenuId, NULL AS ParentId, NULL AS Description, NULL AS Image,
                   NULL AS FormId, NULL AS MenuType, NULL AS ActualId, NULL AS IsAllowed,
                   NULL AS FormName, NULL AS FormClass, NULL AS OpenStyle,
                   NULL AS CanAdd, NULL AS CanEdit, NULL AS CanDelete, NULL AS CanView;
        END
    END
END
GO

-- ----- sp_SaveMenu -----
ALTER PROC sp_SaveMenu
    @Id INT,
    @ParentId INT,
    @Description VARCHAR(200),
    @Image VARCHAR(100),
    @FormId INT,
    @MenuType INT,
    @ActualId INT,
    @IsAllowed BIT,
    @FormName VARCHAR(100),
    @FormClass VARCHAR(200),
    @OpenStyle INT
AS
BEGIN
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);

    IF (@Description IS NULL OR LTRIM(RTRIM(@Description)) = '')
    BEGIN
        SET @ResponseCode = 400;
        SET @ResponseMess = 'Menu description is required and cannot be blank';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
        RETURN;
    END

    IF (@Id = 0)
    BEGIN
        INSERT INTO tblMenu (ParentId, Description, Image, FormId, MenuType, ActualId, IsAllowed, FormName, FormClass, OpenStyle)
        VALUES (@ParentId, @Description, @Image, @FormId, @MenuType, @ActualId, @IsAllowed, @FormName, @FormClass, @OpenStyle);

        SET @Id = SCOPE_IDENTITY();
        SET @ResponseCode = 201;
        SET @ResponseMess = 'Menu created successfully';

        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, @Id AS MenuId;
    END
    ELSE
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM tblMenu WHERE Id = @Id)
        BEGIN
            SET @ResponseCode = 404;
            SET @ResponseMess = 'Menu not found';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
            RETURN;
        END

        UPDATE tblMenu
        SET ParentId = @ParentId, Description = @Description, Image = @Image, FormId = @FormId,
            MenuType = @MenuType, ActualId = @ActualId, IsAllowed = @IsAllowed,
            FormName = @FormName, FormClass = @FormClass, OpenStyle = @OpenStyle
        WHERE Id = @Id;

        SET @ResponseCode = 200;
        SET @ResponseMess = 'Menu updated successfully';

        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, @Id AS MenuId;
    END
END
GO

-- ----- sp_DeleteMenu -----
ALTER PROC sp_DeleteMenu
    @Id INT
AS
BEGIN
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);

    IF (@Id IS NULL OR @Id <= 0)
    BEGIN
        SET @ResponseCode = 400;
        SET @ResponseMess = 'Menu ID is required';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
        RETURN;
    END

    IF NOT EXISTS (SELECT 1 FROM tblMenu WHERE Id = @Id)
    BEGIN
        SET @ResponseCode = 404;
        SET @ResponseMess = 'Menu item not found';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
        RETURN;
    END

    IF EXISTS (SELECT 1 FROM tblMenu WHERE ParentId = @Id)
    BEGIN
        SET @ResponseCode = 409;
        SET @ResponseMess = 'Cannot delete menu - has child items. Please delete child items first';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
        RETURN;
    END

    BEGIN TRY
        BEGIN TRANSACTION;
        DELETE FROM tblGroupAccess WHERE MenuId = @Id;
        DELETE FROM tblMenu WHERE Id = @Id;
        COMMIT TRANSACTION;

        SET @ResponseCode = 200;
        SET @ResponseMess = 'Menu item deleted successfully';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END TRY
    BEGIN CATCH
        ROLLBACK TRANSACTION;
        SET @ResponseCode = 500;
        SET @ResponseMess = 'Failed to delete menu item: ' + ERROR_MESSAGE();
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END CATCH
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
               u.username LIKE '%' + @SearchTerm + '%' OR
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
                   NULL AS userid, NULL AS username, NULL AS useractive, NULL AS isadmin,
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
                   u.userid, u.username, u.useractive, u.isadmin, u.FullName, u.Email,
                   u.JobTitle, u.HourlyRate, u.GroupId, ug.Name AS GroupName,
                   u.CompId, u.BranchId, u.CreatedDate
            FROM tblUser u
            LEFT JOIN tblUserGroups ug ON u.GroupId = ug.Id
            WHERE u.CompId = @CompId
              AND (@IsAdmin = 1 OR u.BranchId = @BranchId)
              AND (@SearchTerm IS NULL OR
                   u.username LIKE '%' + @SearchTerm + '%' OR
                   u.FullName LIKE '%' + @SearchTerm + '%' OR
                   u.Email    LIKE '%' + @SearchTerm + '%' OR
                   u.JobTitle LIKE '%' + @SearchTerm + '%')
            ORDER BY u.FullName
            OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
        END
    END
    ELSE
    BEGIN
        IF EXISTS (SELECT 1 FROM tblUser WHERE userid = @Id AND CompId = @CompId AND (@IsAdmin = 1 OR BranchId = @BranchId))
        BEGIN
            SET @ResponseCode = 200;
            SET @ResponseMess = 'User retrieved successfully';

            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   u.userid, u.username, u.useractive, u.isadmin, u.FullName, u.Email,
                   u.JobTitle, u.HourlyRate, u.GroupId, ug.Name AS GroupName,
                   u.CompId, u.BranchId, u.CreatedDate
            FROM tblUser u
            LEFT JOIN tblUserGroups ug ON u.GroupId = ug.Id
            WHERE u.userid = @Id AND u.CompId = @CompId;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 404;
            SET @ResponseMess = 'User not found or access denied';

            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   NULL AS userid, NULL AS username, NULL AS useractive, NULL AS isadmin,
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
    @User_IP VARCHAR(50),
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
        IF EXISTS (SELECT 1 FROM tblUser WHERE username = @Username AND CompId = @CompId)
        BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Username already exists';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

        INSERT INTO tblUser (username, password, useractive, isadmin, User_IP, AllowDay, FullName, Email, JobTitle, HourlyRate, GroupId, CompId, BranchId)
        VALUES (@Username, @Password, @UserActive, @IsAdmin, @User_IP, @AllowDay, @FullName, @Email, @JobTitle, @HourlyRate, @GroupId, @CompId, @BranchId);

        SET @Id = SCOPE_IDENTITY();
        SET @ResponseCode = 201;
        SET @ResponseMess = 'User created successfully';

        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               @Id AS UserId, @GroupId AS AssignedGroupId;
    END
    ELSE
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM tblUser WHERE userid = @Id AND CompId = @CompId)
        BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'User not found';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

        IF EXISTS (SELECT 1 FROM tblUser WHERE username = @Username AND userid != @Id AND CompId = @CompId)
        BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Username already exists';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

        UPDATE tblUser
        SET username = @Username, password = @Password, useractive = @UserActive, isadmin = @IsAdmin,
            User_IP = @User_IP, AllowDay = @AllowDay, FullName = @FullName, Email = @Email,
            JobTitle = @JobTitle, HourlyRate = @HourlyRate, GroupId = @GroupId
        WHERE userid = @Id AND CompId = @CompId;

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

    IF NOT EXISTS (SELECT 1 FROM tblUser WHERE userid = @Id AND CompId = @CompId AND (@IsAdmin = 1 OR BranchId = @BranchId))
    BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'User not found or access denied';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@Id = @RequestingUserId)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Cannot delete your own account';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF EXISTS (SELECT 1 FROM tblTasks WHERE AssignedToUserId = @Id)
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Cannot delete user - has assigned tasks. Please reassign tasks first';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF EXISTS (SELECT 1 FROM tblProjects WHERE ManagerUserId = @Id)
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Cannot delete user - is project manager. Please assign new manager first';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF EXISTS (SELECT 1 FROM tblTeams WHERE LeadUserId = @Id)
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Cannot delete user - is team lead. Please assign new team lead first';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;
        DELETE FROM tblUserGroupMap WHERE UserId = @Id;
        DELETE FROM tblTeamMembers  WHERE UserId = @Id;
        DELETE FROM tblTimeEntries  WHERE UserId = @Id;
        DELETE FROM tblTaskComments WHERE UserId = @Id;
        DELETE FROM tblTaskActivity WHERE UserId = @Id;
        DELETE FROM tblUser WHERE userid = @Id;
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

-- ----- sp_FetchUserGroup -----
ALTER PROC sp_FetchUserGroup
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
        FROM tblUserGroups ug
        WHERE ug.CompId = @CompId
          AND (@SearchTerm IS NULL OR ug.Name LIKE '%' + @SearchTerm + '%' OR ug.Description LIKE '%' + @SearchTerm + '%');

        SET @TotalPages = CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize);

        IF @TotalRecords = 0
        BEGIN
            SET @ResponseCode = 200;
            SET @ResponseMess = 'No user groups found';

            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   NULL AS Id, NULL AS Name, NULL AS Description, NULL AS IsActive,
                   NULL AS MemberCount;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 200;
            SET @ResponseMess = 'User groups retrieved successfully';

            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   ug.Id, ug.Name, ug.Description, ug.IsActive,
                   (SELECT COUNT(*) FROM tblUserGroupMap ugm WHERE ugm.GroupId = ug.Id) AS MemberCount
            FROM tblUserGroups ug
            WHERE ug.CompId = @CompId
              AND (@SearchTerm IS NULL OR ug.Name LIKE '%' + @SearchTerm + '%' OR ug.Description LIKE '%' + @SearchTerm + '%')
            ORDER BY ug.Name
            OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
        END
    END
    ELSE
    BEGIN
        IF EXISTS (SELECT 1 FROM tblUserGroups WHERE Id = @Id AND CompId = @CompId)
        BEGIN
            SET @ResponseCode = 200;
            SET @ResponseMess = 'User group retrieved successfully';

            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   ug.Id, ug.Name, ug.Description, ug.IsActive,
                   (SELECT COUNT(*) FROM tblUserGroupMap ugm WHERE ugm.GroupId = ug.Id) AS MemberCount
            FROM tblUserGroups ug
            WHERE ug.Id = @Id;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 404;
            SET @ResponseMess = 'User group not found';

            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   NULL AS Id, NULL AS Name, NULL AS Description, NULL AS IsActive,
                   NULL AS MemberCount;
        END
    END
END
GO

-- ----- sp_SaveUserGroup -----
ALTER PROC sp_SaveUserGroup
    @Id INT,
    @Name VARCHAR(100),
    @Description VARCHAR(500),
    @IsActive BIT,
    @CompId BIGINT,
    @BranchId BIGINT
AS
BEGIN
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);

    IF (@Name IS NULL OR LTRIM(RTRIM(@Name)) = '')
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Group name is required and cannot be blank';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@Id = 0)
    BEGIN
        IF EXISTS (SELECT 1 FROM tblUserGroups WHERE Name = @Name AND CompId = @CompId)
        BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Group name already exists';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

        INSERT INTO tblUserGroups (Name, Description, IsActive, CompId, BranchId)
        VALUES (@Name, @Description, @IsActive, @CompId, @BranchId);

        SET @Id = SCOPE_IDENTITY();
        SET @ResponseCode = 201;
        SET @ResponseMess = 'User group created successfully';

        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, @Id AS GroupId;
    END
    ELSE
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM tblUserGroups WHERE Id = @Id AND CompId = @CompId)
        BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'User group not found';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

        UPDATE tblUserGroups
        SET Name = @Name, Description = @Description, IsActive = @IsActive
        WHERE Id = @Id AND CompId = @CompId;

        SET @ResponseCode = 200;
        SET @ResponseMess = 'User group updated successfully';

        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, @Id AS GroupId;
    END
END
GO

-- ----- sp_DeleteUserGroup -----
ALTER PROC sp_DeleteUserGroup
    @Id INT,
    @CompId BIGINT,
    @BranchId BIGINT
AS
BEGIN
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);

    IF (@Id IS NULL OR @Id <= 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Group ID is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM tblUserGroups WHERE Id = @Id AND CompId = @CompId)
    BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'User group not found';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF EXISTS (SELECT 1 FROM tblUserGroupMap WHERE GroupId = @Id)
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Cannot delete group - has members. Please remove all members first';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;
        DELETE FROM tblGroupAccess WHERE GroupId = @Id;
        DELETE FROM tblUserGroups  WHERE Id = @Id;
        COMMIT TRANSACTION;

        SET @ResponseCode = 200;
        SET @ResponseMess = 'User group deleted successfully';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END TRY
    BEGIN CATCH
        ROLLBACK TRANSACTION;
        SET @ResponseCode = 500;
        SET @ResponseMess = 'Failed to delete user group: ' + ERROR_MESSAGE();
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END CATCH
END
GO

-- ----- sp_FetchFollowUp -----
ALTER PROCEDURE sp_FetchFollowUp
(
    @Id INT = 0,
    @LeadId INT = 0,
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

    IF (@Id = 0)
    BEGIN
        SET @Offset = (@PageNumber - 1) * @PageSize;

        SELECT @TotalRecords = COUNT(*)
        FROM tblFollowUp f
        WHERE (@LeadId = 0 OR f.LeadId = @LeadId)
          AND (@SearchTerm IS NULL
               OR f.Remarks      LIKE '%' + @SearchTerm + '%'
               OR f.Status       LIKE '%' + @SearchTerm + '%'
               OR f.FollowupType LIKE '%' + @SearchTerm + '%');

        SET @TotalPages = CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize);

        IF @TotalRecords = 0
        BEGIN
            SET @ResponseCode = 200;
            SET @ResponseMess = 'No follow-up records found';

            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   NULL AS Id, NULL AS LeadId, NULL AS NextFollowupDate,
                   NULL AS FollowupType, NULL AS Remarks, NULL AS Status,
                   NULL AS CreatedBy, NULL AS CreatedDate;
            RETURN;
        END

        SET @ResponseCode = 200;
        SET @ResponseMess = 'Follow-ups retrieved successfully';

        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
               @PageNumber AS CurrentPage, @PageSize AS PageSize,
               f.Id, f.LeadId, f.NextFollowupDate, f.FollowupType,
               f.Remarks, f.Status, f.CreatedBy, f.CreatedDate,
               f.EditBy, f.EditDate
        FROM tblFollowUp f
        WHERE (@LeadId = 0 OR f.LeadId = @LeadId)
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
            SET @ResponseCode = 200;
            SET @ResponseMess = 'Follow-up record fetched successfully';

            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   f.*
            FROM tblFollowUp f
            WHERE f.Id = @Id;
            RETURN;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 404;
            SET @ResponseMess = 'Follow-up not found';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
            RETURN;
        END
    END
END
GO

-- ----- sp_SaveFollowUp -----
ALTER PROCEDURE [dbo].[sp_SaveFollowUp]
(
    @Id INT = 0,
    @LeadId INT,
    @NextFollowupDate DATETIME = NULL,
    @FollowupType VARCHAR(50) = NULL,
    @Remarks VARCHAR(500) = NULL,
    @Status VARCHAR(50) = NULL,
    @CompId INT,
    @BranchId INT,
    @CreatedBy INT = NULL,
    @EditBy INT = NULL
)
AS
BEGIN
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(200);

    IF (@CompId IS NULL OR @CompId = 0 OR @BranchId IS NULL OR @BranchId = 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'CompId and BranchId are required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@Remarks IS NULL OR LTRIM(RTRIM(@Remarks)) = '')
    BEGIN SET @ResponseCode = 403; SET @ResponseMess = 'Remarks is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@Id = 0)
    BEGIN
        INSERT INTO tblFollowUp (CompId, BranchId, LeadId, NextFollowupDate, FollowupType, Remarks, Status, CreatedBy, CreatedDate)
        VALUES (@CompId, @BranchId, @LeadId, @NextFollowupDate, @FollowupType, @Remarks, @Status, @CreatedBy, GETDATE());

        SET @Id = SCOPE_IDENTITY();
        SET @ResponseCode = 201;
        SET @ResponseMess = 'Follow-up created successfully';

        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, @Id AS FollowUpId;
        RETURN;
    END
    ELSE
    BEGIN
        IF EXISTS (SELECT 1 FROM tblFollowUp WHERE Id = @Id)
        BEGIN
            UPDATE tblFollowUp
            SET CompId = @CompId, BranchId = @BranchId, LeadId = @LeadId,
                NextFollowupDate = @NextFollowupDate, FollowupType = @FollowupType,
                Remarks = @Remarks, Status = @Status, EditBy = @EditBy, EditDate = GETDATE()
            WHERE Id = @Id AND CompId = @CompId AND BranchId = @BranchId;

            DECLARE @RowsAffected INT = @@ROWCOUNT;

            IF (@RowsAffected = 0)
            BEGIN SET @ResponseCode = 404;
                  SET @ResponseMess = 'Follow-up not found or access denied (CompId/BranchId mismatch)';
                  SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

            SET @ResponseCode = 200;
            SET @ResponseMess = 'Follow-up updated successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
            RETURN;
        END
        ELSE
        BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Follow-up Id not found';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    END
END
GO

PRINT '✓ Stored procedures rewritten';
GO
