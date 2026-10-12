-- 110_menu_order.sql — a ruled sidebar order. tblMenu had no order column, so the
-- sidebar came out in Id order (reports above the things they report on).
--   1. tblMenu.SortOrder INT NULL (guarded). NULL = unranked: sorts after ranked rows, by Id.
--   2. Rank every known row, matched by Route (never by Id — Ids differ between DBs).
--      Parents with a NULL Route ('Sales Reports', 'Team Reports') match on ParentId = 0 +
--      Description. Support Reports' parent shares its Route with its first child, so every
--      match also pins ParentId = 0 (top level) or <> 0 (child).
--   3. sp_ValidateUser (login RS2) and sp_FetchUserMenus (fetchMyAccess) return SortOrder and
--      order by ParentId, SortOrder, Id. Nothing else in either proc changes (copied from
--      TestCRM; identical on eCRM+). The web sorts by SortOrder itself too, so either side
--      alone is enough; before this is applied the web falls back to Id order.
-- sp_FetchMenu (legacy /getUserPermissions, tblGroupAccess) is not touched: no client builds
-- the sidebar from it.
-- Apply on TestCRM first, then eCRM+ and SolarCRM once checked. NOTE: SolarCRM has no
-- sp_FetchUserMenus today; CREATE OR ALTER below creates it there.
-- Apply: sqlcmd -I -S <server> -d TestCRM -i 110_menu_order.sql
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- ===========================================================================
-- 1. Column
-- ===========================================================================
IF COL_LENGTH('dbo.tblMenu', 'SortOrder') IS NULL
    ALTER TABLE dbo.tblMenu ADD SortOrder INT NULL;
GO

-- ===========================================================================
-- 2. Ranks. Top level 10, 20, ... ; children 1, 2, ... within their parent.
-- ===========================================================================
DECLARE @Rank TABLE (IsTop BIT, Route VARCHAR(200) NULL, Description VARCHAR(200) NULL, SortOrder INT);
INSERT INTO @Rank (IsTop, Route, Description, SortOrder) VALUES
    -- top level
    (1, '/dashboard',                    NULL,            10),
    (1, '/today',                        NULL,            20),
    (1, '/tasks',                        NULL,            30),
    (1, '/my-work',                      NULL,            40),
    (1, '/sales',                        NULL,            50),
    (1, '/support',                      NULL,            60),
    (1, NULL,                            'Team Reports',  70),
    (1, NULL,                            'Sales Reports', 80),
    (1, '/reports/tickets-by-category',  NULL,            90),   -- Support Reports
    (1, '/admin',                        NULL,           100),
    (1, '/settings',                     NULL,           110),
    -- Sales
    (0, '/sales/leads',                  NULL, 1),
    (0, '/sales/follow-ups',             NULL, 2),
    (0, '/sales/quotations',             NULL, 3),
    (0, '/sales/partners',               NULL, 4),
    -- Support
    (0, '/support/tickets',              NULL, 1),
    (0, '/support/customers',            NULL, 2),
    -- Team Reports
    (0, '/reports/tat',                  NULL, 1),
    (0, '/reports/attendance',           NULL, 2),
    -- Sales Reports
    (0, '/reports/funnel',               NULL, 1),
    (0, '/reports/funnel?groupBy=source',NULL, 2),
    (0, '/reports/pipeline-value',       NULL, 3),
    (0, '/reports/leaderboard',          NULL, 4),
    (0, '/reports/activity',             NULL, 5),
    (0, '/reports/follow-up-compliance', NULL, 6),
    (0, '/reports/aging',                NULL, 7),
    (0, '/reports/lost',                 NULL, 8),
    (0, '/reports/transfers',            NULL, 9),
    (0, '/reports/partners',             NULL, 10),
    -- Support Reports
    (0, '/reports/tickets-by-category',  NULL, 1),
    (0, '/reports/resolution-summary',   NULL, 2),
    -- Admin
    (0, '/users',                        NULL, 1),
    (0, '/teams',                        NULL, 2),
    (0, '/offices',                      NULL, 3),
    (0, '/groups',                       NULL, 4),
    (0, '/projects',                     NULL, 5),
    -- Settings
    (0, '/settings/lookups',             NULL, 1),
    (0, '/settings/priorities',          NULL, 2),
    (0, '/settings/ticket-categories',   NULL, 3),
    (0, '/settings/products',            NULL, 4),
    (0, '/settings/custom-fields',       NULL, 5),
    (0, '/settings/work-calendar',       NULL, 6);

UPDATE m SET m.SortOrder = r.SortOrder
FROM dbo.tblMenu m
JOIN @Rank r
  ON ((r.IsTop = 1 AND m.ParentId = 0) OR (r.IsTop = 0 AND m.ParentId <> 0))
 AND ((r.Route IS NOT NULL AND m.Route = r.Route)
   OR (r.Route IS NULL AND m.Route IS NULL AND m.Description = r.Description));
GO

-- ===========================================================================
-- 3a. sp_ValidateUser — SortOrder added to RS2 (and to the empty RS2 shapes); ORDER BY.
-- ===========================================================================
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
               NULL AS GroupName, NULL AS SortOrder
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
               NULL AS GroupName, NULL AS SortOrder
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
           @GroupName AS GroupName, m.SortOrder
    FROM menuRows r JOIN tblMenu m ON m.Id = r.Id
    ORDER BY m.ParentId, ISNULL(m.SortOrder, 2147483647), m.Id;
END
GO

-- ===========================================================================
-- 3b. sp_FetchUserMenus — SortOrder added to the output; ORDER BY.
-- ===========================================================================
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
           @GroupName AS GroupName, m.SortOrder
    FROM menuRows r JOIN tblMenu m ON m.Id = r.Id
    ORDER BY m.ParentId, ISNULL(m.SortOrder, 2147483647), m.Id;
END
GO

-- ===========================================================================
-- Verify after apply
-- ===========================================================================
-- 1. The ordered tree. Expect top level: Dashboard, Today, Tasks, My Work, Sales, Support,
--    Team Reports, Sales Reports, Support Reports, Admin, Settings; children as ruled.
--    Every row ranked (Unranked = 0) unless the DB has extra rows nobody ruled on.
-- SELECT CASE WHEN m.ParentId = 0 THEN m.Description ELSE '    ' + m.Description END AS Menu,
--        m.Id, m.ParentId, m.SortOrder, m.Route
-- FROM dbo.tblMenu m
-- LEFT JOIN dbo.tblMenu p ON p.Id = m.ParentId
-- ORDER BY ISNULL(p.SortOrder, ISNULL(m.SortOrder, 2147483647)), ISNULL(p.Id, m.Id),
--          CASE WHEN m.ParentId = 0 THEN 0 ELSE 1 END, ISNULL(m.SortOrder, 2147483647), m.Id;
-- SELECT COUNT(*) AS Unranked FROM dbo.tblMenu WHERE SortOrder IS NULL AND IsAllowed = 1 AND Id <> 6;
-- 2. Both procs return it: expect a SortOrder column, rows in that order within each parent.
-- EXEC dbo.sp_FetchUserMenus @UserId = 1;
-- EXEC dbo.sp_ValidateUser @UserId = 1;
