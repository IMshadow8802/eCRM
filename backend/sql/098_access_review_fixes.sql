-- 098_access_review_fixes.sql — fixes from the org-hierarchy whole-branch review (spec 2026-10-07-org-hierarchy)
-- Apply on BOTH databases: sqlcmd -I -S <server> -U <user> -P <pw> -d "eCRM+"   -i 098_access_review_fixes.sql
--                          sqlcmd -I -S <server> -U <user> -P <pw> -d "SolarCRM" -i 098_access_review_fixes.sql
-- Idempotent (CREATE OR ALTER only). Each proc is the LIVE 096-era text with only the edits listed:
--   1. sp_ValidateUser   — leaf CTE: a non-admin sees the 'people' menu (/users) only with people Add or Edit.
--   2. sp_FetchUserMenus — same line as 1.
--   3. sp_FetchUser      — new @SearchSensitive BIT = 1; at 0 the search skips Email and Mobile
--                          (count query and page query). Default 1 = today's behaviour for the deployed Node.
-- Safe before the matching Node deploy: old Node never passes @SearchSensitive; the menu change only hides a menu.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- 1. sp_ValidateUser ------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_ValidateUser
    @identifier VARCHAR(150) = NULL,
    @UserId     INT          = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);
    DECLARE @FoundId INT;
    DECLARE @IsActive BIT;

    IF (@UserId IS NOT NULL)
        SELECT TOP 1 @FoundId = Id, @IsActive = IsActive
        FROM tblUser WHERE Id = @UserId;
    ELSE
        SELECT TOP 1 @FoundId = Id, @IsActive = IsActive
        FROM tblUser
        WHERE Username = @identifier OR Email = @identifier OR Mobile = @identifier;

    IF @FoundId IS NULL
    BEGIN
        SET @ResponseCode = 404;
        SET @ResponseMess = 'Username does not exist';

        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               NULL AS UserId, NULL AS UserName, NULL AS Password, NULL AS UserActive, NULL AS IsAdmin,
               NULL AS FullName, NULL AS Email, NULL AS JobTitle, NULL AS HourlyRate,
               NULL AS Mobile, NULL AS Avatar,
               NULL AS CompId, NULL AS BranchId,
               NULL AS CompName, NULL AS CompAddress, NULL AS CompPhone, NULL AS CompState,
               NULL AS CompStateCode, NULL AS CompEmail, NULL AS CompWebSite, NULL AS CompGSTIN;

        SELECT NULL AS MenuId, NULL AS ParentId, NULL AS Description, NULL AS Image,
               NULL AS FormId, NULL AS MenuType, NULL AS ActualId, NULL AS IsAllowed,
               NULL AS FormName, NULL AS FormClass, NULL AS OpenStyle, NULL AS Route,
               NULL AS CanAdd, NULL AS CanEdit, NULL AS CanDelete, NULL AS CanView,
               NULL AS GroupName
        WHERE 1 = 0;
        RETURN;
    END

    IF @IsActive = 0
    BEGIN
        SET @ResponseCode = 403;
        SET @ResponseMess = 'Account is inactive';

        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               NULL AS UserId, NULL AS UserName, NULL AS Password, NULL AS UserActive, NULL AS IsAdmin,
               NULL AS FullName, NULL AS Email, NULL AS JobTitle, NULL AS HourlyRate,
               NULL AS Mobile, NULL AS Avatar,
               NULL AS CompId, NULL AS BranchId,
               NULL AS CompName, NULL AS CompAddress, NULL AS CompPhone, NULL AS CompState,
               NULL AS CompStateCode, NULL AS CompEmail, NULL AS CompWebSite, NULL AS CompGSTIN;

        SELECT NULL AS MenuId, NULL AS ParentId, NULL AS Description, NULL AS Image,
               NULL AS FormId, NULL AS MenuType, NULL AS ActualId, NULL AS IsAllowed,
               NULL AS FormName, NULL AS FormClass, NULL AS OpenStyle, NULL AS Route,
               NULL AS CanAdd, NULL AS CanEdit, NULL AS CanDelete, NULL AS CanView,
               NULL AS GroupName
        WHERE 1 = 0;
        RETURN;
    END

    SET @ResponseCode = 200;
    SET @ResponseMess = 'User found successfully';

    SELECT @ResponseCode AS ResponseCode,
           @ResponseMess AS ResponseMess,
           u.Id       AS UserId,
           u.Username AS UserName,
           u.Password AS Password,
           u.IsActive AS UserActive,
           CAST(CASE WHEN EXISTS (SELECT 1 FROM tblUserGroupMap ugm
                                   JOIN tblUserGroups ug ON ug.Id = ugm.GroupId
                                  WHERE ugm.UserId = u.Id AND ug.IsActive = 1 AND ug.IsAdmin = 1)
                     THEN 1 ELSE 0 END AS BIT) AS IsAdmin,
           u.FullName, u.Email, u.JobTitle, u.HourlyRate,
           u.Mobile, u.Avatar,
           u.CompId, u.BranchId,
           'Your Company Name'  AS CompName,
           'Company Address'    AS CompAddress,
           'Company Phone'      AS CompPhone,
           'State'              AS CompState,
           'ST'                 AS CompStateCode,
           'company@email.com'  AS CompEmail,
           'www.company.com'    AS CompWebSite,
           'GSTIN123456789'     AS CompGSTIN
    FROM tblUser u
    WHERE u.Id = @FoundId;

    DECLARE @MenuAdmin BIT = CASE WHEN EXISTS (
        SELECT 1 FROM tblUserGroupMap ugm JOIN tblUserGroups ug ON ug.Id = ugm.GroupId
        WHERE ugm.UserId = @FoundId AND ug.IsActive = 1 AND ug.IsAdmin = 1) THEN 1 ELSE 0 END;
    DECLARE @GroupName VARCHAR(100) = (
        SELECT TOP 1 ug.Name FROM tblUserGroupMap ugm JOIN tblUserGroups ug ON ug.Id = ugm.GroupId
        WHERE ugm.UserId = @FoundId AND ug.IsActive = 1 ORDER BY ug.IsAdmin DESC, ug.HierarchyLevel, ug.Id);

    -- Menu rows now come from module grants (096), not tblGroupAccess.
    ;WITH g AS (
        SELECT gm.Module,
               MAX(CAST(gm.CanAdd AS INT)) AS A, MAX(CAST(gm.CanEdit AS INT)) AS E,
               MAX(CAST(gm.CanDelete AS INT)) AS D
        FROM tblUserGroupMap ugm
        JOIN tblUserGroups ug  ON ug.Id = ugm.GroupId AND ug.IsActive = 1
        JOIN tblGroupModule gm ON gm.GroupId = ug.Id AND gm.CanView = 1
        WHERE ugm.UserId = @FoundId
        GROUP BY gm.Module
    ),
    leaf AS (
        SELECT m.Id, m.ParentId,
               CAST(CASE WHEN @MenuAdmin = 1 THEN 1 ELSE g.A END AS BIT) AS CanAdd,
               CAST(CASE WHEN @MenuAdmin = 1 THEN 1 ELSE g.E END AS BIT) AS CanEdit,
               CAST(CASE WHEN @MenuAdmin = 1 THEN 1 ELSE g.D END AS BIT) AS CanDelete
        FROM tblMenu m
        LEFT JOIN g ON g.Module = m.Module
        WHERE m.IsAllowed = 1 AND m.Module IS NOT NULL
          AND (@MenuAdmin = 1 OR (g.Module IS NOT NULL AND m.Module NOT IN ('roles', 'offices')))
          -- 098: the Users screen is for managing people; viewing people alone (every role) does not show it.
          AND NOT (m.Module = 'people' AND @MenuAdmin = 0 AND ISNULL(g.A, 0) = 0 AND ISNULL(g.E, 0) = 0)
    ),
    menuRows AS (
        SELECT Id, CanAdd, CanEdit, CanDelete FROM leaf
        UNION ALL
        SELECT p.Id, CAST(0 AS BIT), CAST(0 AS BIT), CAST(0 AS BIT)
        FROM tblMenu p
        WHERE p.IsAllowed = 1 AND p.Module IS NULL
          AND EXISTS (SELECT 1 FROM leaf WHERE leaf.ParentId = p.Id)
    )
    SELECT m.Id AS MenuId, m.ParentId, m.Description, m.Image, m.FormId, m.MenuType, m.ActualId,
           m.IsAllowed, m.FormName, m.FormClass, m.OpenStyle, m.Route,
           r.CanAdd, r.CanEdit, r.CanDelete, CAST(1 AS BIT) AS CanView,
           @GroupName AS GroupName
    FROM menuRows r JOIN tblMenu m ON m.Id = r.Id
    ORDER BY m.ParentId, m.Id;
END
GO

-- 2. sp_FetchUserMenus ----------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchUserMenus
    @UserId INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @MenuAdmin BIT = CASE WHEN EXISTS (
        SELECT 1 FROM tblUserGroupMap ugm JOIN tblUserGroups ug ON ug.Id = ugm.GroupId
        WHERE ugm.UserId = @UserId AND ug.IsActive = 1 AND ug.IsAdmin = 1) THEN 1 ELSE 0 END;
    DECLARE @GroupName VARCHAR(100) = (
        SELECT TOP 1 ug.Name FROM tblUserGroupMap ugm JOIN tblUserGroups ug ON ug.Id = ugm.GroupId
        WHERE ugm.UserId = @UserId AND ug.IsActive = 1 ORDER BY ug.IsAdmin DESC, ug.HierarchyLevel, ug.Id);

    -- Menu rows now come from module grants (096), not tblGroupAccess.
    ;WITH g AS (
        SELECT gm.Module,
               MAX(CAST(gm.CanAdd AS INT)) AS A, MAX(CAST(gm.CanEdit AS INT)) AS E,
               MAX(CAST(gm.CanDelete AS INT)) AS D
        FROM tblUserGroupMap ugm
        JOIN tblUserGroups ug  ON ug.Id = ugm.GroupId AND ug.IsActive = 1
        JOIN tblGroupModule gm ON gm.GroupId = ug.Id AND gm.CanView = 1
        WHERE ugm.UserId = @UserId
        GROUP BY gm.Module
    ),
    leaf AS (
        SELECT m.Id, m.ParentId,
               CAST(CASE WHEN @MenuAdmin = 1 THEN 1 ELSE g.A END AS BIT) AS CanAdd,
               CAST(CASE WHEN @MenuAdmin = 1 THEN 1 ELSE g.E END AS BIT) AS CanEdit,
               CAST(CASE WHEN @MenuAdmin = 1 THEN 1 ELSE g.D END AS BIT) AS CanDelete
        FROM tblMenu m
        LEFT JOIN g ON g.Module = m.Module
        WHERE m.IsAllowed = 1 AND m.Module IS NOT NULL
          AND (@MenuAdmin = 1 OR (g.Module IS NOT NULL AND m.Module NOT IN ('roles', 'offices')))
          -- 098: the Users screen is for managing people; viewing people alone (every role) does not show it.
          AND NOT (m.Module = 'people' AND @MenuAdmin = 0 AND ISNULL(g.A, 0) = 0 AND ISNULL(g.E, 0) = 0)
    ),
    menuRows AS (
        SELECT Id, CanAdd, CanEdit, CanDelete FROM leaf
        UNION ALL
        SELECT p.Id, CAST(0 AS BIT), CAST(0 AS BIT), CAST(0 AS BIT)
        FROM tblMenu p
        WHERE p.IsAllowed = 1 AND p.Module IS NULL
          AND EXISTS (SELECT 1 FROM leaf WHERE leaf.ParentId = p.Id)
    )
    SELECT m.Id AS MenuId, m.ParentId, m.Description, m.Image, m.FormId, m.MenuType, m.ActualId,
           m.IsAllowed, m.FormName, m.FormClass, m.OpenStyle, m.Route,
           r.CanAdd, r.CanEdit, r.CanDelete, CAST(1 AS BIT) AS CanView,
           @GroupName AS GroupName
    FROM menuRows r JOIN tblMenu m ON m.Id = r.Id
    ORDER BY m.ParentId, m.Id;
END
GO

-- 3. sp_FetchUser ---------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_FetchUser
    @Id INT,
    @CompId BIGINT,
    @BranchId BIGINT,
    @IsAdmin BIT,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @PageNumber INT = 1,
    @PageSize INT = 10,
    @SearchTerm NVARCHAR(100) = NULL,
    -- 098: 0 = the caller may not see contact details, so search must not match on them.
    @SearchSensitive BIT = 1
AS
BEGIN
    SET NOCOUNT ON;

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

    -- Users with an ACTIVE manager somewhere up the chain (094). The walk
    -- continues only through inactive managers, so it stops at the first active one.
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
               (@SearchSensitive = 1 AND u.Email  LIKE '%' + @SearchTerm + '%') OR
               (@SearchSensitive = 1 AND u.Mobile LIKE '%' + @SearchTerm + '%') OR
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
                   NULL AS Mobile, NULL AS Avatar,
                   NULL AS GroupId, NULL AS GroupName,
                   NULL AS ReportsTo, NULL AS ReportsToName,
                   NULL AS BranchName, NULL AS NoManager,
                   NULL AS CompId, NULL AS BranchId, NULL AS CreatedDate;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'Users retrieved successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   u.Id, u.Username, u.IsActive, u.IsAdmin, u.FullName, u.Email,
                   u.JobTitle, u.HourlyRate, u.Mobile, u.Avatar,
                   (SELECT TOP 1 m.GroupId
                      FROM tblUserGroupMap m
                      JOIN tblUserGroups g ON g.Id = m.GroupId AND g.IsActive = 1
                     WHERE m.UserId = u.Id
                     ORDER BY m.Id) AS GroupId,
                   (SELECT TOP 1 g.Name
                      FROM tblUserGroupMap m
                      JOIN tblUserGroups g ON g.Id = m.GroupId AND g.IsActive = 1
                     WHERE m.UserId = u.Id
                     ORDER BY m.Id) AS GroupName,
                   u.ReportsTo,
                   (SELECT r.FullName FROM tblUser r WHERE r.Id = u.ReportsTo) AS ReportsToName,
                   b.BranchName,
                   CAST(CASE WHEN u.IsActive = 1
                              AND NOT EXISTS (SELECT 1 FROM @Managed mg WHERE mg.UserId = u.Id)
                              AND NOT EXISTS (SELECT 1 FROM tblUserGroupMap am
                                                JOIN tblUserGroups ag ON ag.Id = am.GroupId AND ag.IsActive = 1 AND ag.IsAdmin = 1
                                               WHERE am.UserId = u.Id)
                             THEN 1 ELSE 0 END AS BIT) AS NoManager,
                   u.CompId, u.BranchId, u.CreatedDate
            FROM tblUser u
            LEFT JOIN tblBranch b ON b.Id = u.BranchId
            WHERE u.CompId = @CompId
              AND ((@UseScope = 1 AND u.BranchId IN (SELECT BranchId FROM @BranchIds))
                OR (@UseScope = 0 AND (@IsAdmin = 1 OR u.BranchId = @BranchId)))
              AND (@SearchTerm IS NULL OR
                   u.Username LIKE '%' + @SearchTerm + '%' OR
                   u.FullName LIKE '%' + @SearchTerm + '%' OR
                   (@SearchSensitive = 1 AND u.Email  LIKE '%' + @SearchTerm + '%') OR
                   (@SearchSensitive = 1 AND u.Mobile LIKE '%' + @SearchTerm + '%') OR
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
                   u.JobTitle, u.HourlyRate, u.Mobile, u.Avatar,
                   (SELECT TOP 1 m.GroupId
                      FROM tblUserGroupMap m
                      JOIN tblUserGroups g ON g.Id = m.GroupId AND g.IsActive = 1
                     WHERE m.UserId = u.Id
                     ORDER BY m.Id) AS GroupId,
                   (SELECT TOP 1 g.Name
                      FROM tblUserGroupMap m
                      JOIN tblUserGroups g ON g.Id = m.GroupId AND g.IsActive = 1
                     WHERE m.UserId = u.Id
                     ORDER BY m.Id) AS GroupName,
                   u.ReportsTo,
                   (SELECT r.FullName FROM tblUser r WHERE r.Id = u.ReportsTo) AS ReportsToName,
                   b.BranchName,
                   CAST(CASE WHEN u.IsActive = 1
                              AND NOT EXISTS (SELECT 1 FROM @Managed mg WHERE mg.UserId = u.Id)
                              AND NOT EXISTS (SELECT 1 FROM tblUserGroupMap am
                                                JOIN tblUserGroups ag ON ag.Id = am.GroupId AND ag.IsActive = 1 AND ag.IsAdmin = 1
                                               WHERE am.UserId = u.Id)
                             THEN 1 ELSE 0 END AS BIT) AS NoManager,
                   u.CompId, u.BranchId, u.CreatedDate
            FROM tblUser u
            LEFT JOIN tblBranch b ON b.Id = u.BranchId
            WHERE u.Id = @Id AND u.CompId = @CompId;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 404; SET @ResponseMess = 'User not found or access denied';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   NULL AS Id, NULL AS Username, NULL AS IsActive, NULL AS IsAdmin,
                   NULL AS FullName, NULL AS Email, NULL AS JobTitle, NULL AS HourlyRate,
                   NULL AS Mobile, NULL AS Avatar,
                   NULL AS GroupId, NULL AS GroupName,
                   NULL AS ReportsTo, NULL AS ReportsToName,
                   NULL AS BranchName, NULL AS NoManager,
                   NULL AS CompId, NULL AS BranchId, NULL AS CreatedDate;
        END
    END
END
GO

-- VERIFY AFTER APPLY (read-only):
-- SELECT OBJECT_DEFINITION(OBJECT_ID('sp_FetchUserMenus')) LIKE '%m.Module = ''people'' AND @MenuAdmin = 0%';  -- 1
-- SELECT name FROM sys.parameters WHERE object_id = OBJECT_ID('sp_FetchUser') AND name = '@SearchSensitive';  -- 1 row
-- EXEC sp_FetchUserMenus @UserId = <a Sales Executive>;  -> no row with Route = '/users'
-- EXEC sp_FetchUserMenus @UserId = <an HR Manager>;      -> has Route = '/users'
-- EXEC sp_FetchUser @Id = 0, @CompId = 1, @BranchId = 1, @IsAdmin = 1, @SearchTerm = '<a full mobile>', @SearchSensitive = 0;
--      -> no row unless the term also matches a Username / FullName / JobTitle
