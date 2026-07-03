-- 036_seed_menus.sql
-- Make the Sales/Support/Settings/Reports navigation DB-driven (tblMenu +
-- tblGroupAccess) instead of hardcoded in the web Sidebar. Adds a `Route`
-- column so a menu row can point at a nested SPA route (the legacy
-- title-slug convention can't express `/support/board` etc.), seeds the menu
-- tree + group access, and threads `Route` through the login/menu SPs.
-- Apply by hand. Idempotent: guarded by Route existence.
USE [eCRM+]
GO
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- 1) Route column (nullable; legacy rows stay NULL and fall back to the
--    title-slug path in web buildDynamicMenu).
IF COL_LENGTH('dbo.tblMenu', 'Route') IS NULL
    ALTER TABLE dbo.tblMenu ADD Route NVARCHAR(200) NULL;
GO

-- 2) Seed the menu tree (only once — guarded on a known Route).
IF NOT EXISTS (SELECT 1 FROM dbo.tblMenu WHERE Route = '/support/board')
BEGIN
    DECLARE @newMenus TABLE (MenuId INT, AdminOnly BIT);
    DECLARE @sales INT, @support INT, @settings INT;

    -- Reuse the existing "Reports" parent if present, else create it.
    DECLARE @reports INT = (SELECT TOP 1 Id FROM dbo.tblMenu WHERE ParentId = 0 AND Description = 'Reports' ORDER BY Id);
    IF @reports IS NULL
    BEGIN
        INSERT INTO dbo.tblMenu (ParentId, Description, IsAllowed, Route) VALUES (0, 'Reports', 1, '/reports');
        SET @reports = SCOPE_IDENTITY();
        INSERT INTO @newMenus VALUES (@reports, 0);
    END

    -- Sales
    INSERT INTO dbo.tblMenu (ParentId, Description, IsAllowed, Route) VALUES (0, 'Sales', 1, '/sales');
    SET @sales = SCOPE_IDENTITY(); INSERT INTO @newMenus VALUES (@sales, 0);
    INSERT INTO dbo.tblMenu (ParentId, Description, IsAllowed, Route) VALUES (@sales, 'Pipeline', 1, '/sales/pipeline');
    INSERT INTO @newMenus VALUES (SCOPE_IDENTITY(), 0);
    INSERT INTO dbo.tblMenu (ParentId, Description, IsAllowed, Route) VALUES (@sales, 'Leads', 1, '/sales/leads');
    INSERT INTO @newMenus VALUES (SCOPE_IDENTITY(), 0);

    -- Support
    INSERT INTO dbo.tblMenu (ParentId, Description, IsAllowed, Route) VALUES (0, 'Support', 1, '/support');
    SET @support = SCOPE_IDENTITY(); INSERT INTO @newMenus VALUES (@support, 0);
    INSERT INTO dbo.tblMenu (ParentId, Description, IsAllowed, Route) VALUES (@support, 'Ticket Board', 1, '/support/board');
    INSERT INTO @newMenus VALUES (SCOPE_IDENTITY(), 0);
    INSERT INTO dbo.tblMenu (ParentId, Description, IsAllowed, Route) VALUES (@support, 'Tickets', 1, '/support/tickets');
    INSERT INTO @newMenus VALUES (SCOPE_IDENTITY(), 0);

    -- Reports children (sales + ticket analytics)
    INSERT INTO dbo.tblMenu (ParentId, Description, IsAllowed, Route) VALUES (@reports, 'Pipeline Funnel', 1, '/reports/pipeline-funnel');
    INSERT INTO @newMenus VALUES (SCOPE_IDENTITY(), 0);
    INSERT INTO dbo.tblMenu (ParentId, Description, IsAllowed, Route) VALUES (@reports, 'Calls per User', 1, '/reports/calls-per-user');
    INSERT INTO @newMenus VALUES (SCOPE_IDENTITY(), 0);
    INSERT INTO dbo.tblMenu (ParentId, Description, IsAllowed, Route) VALUES (@reports, 'Conversion by Source', 1, '/reports/conversion-by-source');
    INSERT INTO @newMenus VALUES (SCOPE_IDENTITY(), 0);
    INSERT INTO dbo.tblMenu (ParentId, Description, IsAllowed, Route) VALUES (@reports, 'SLA Breach', 1, '/reports/sla-breach');
    INSERT INTO @newMenus VALUES (SCOPE_IDENTITY(), 0);
    INSERT INTO dbo.tblMenu (ParentId, Description, IsAllowed, Route) VALUES (@reports, 'Tickets by Category', 1, '/reports/tickets-by-category');
    INSERT INTO @newMenus VALUES (SCOPE_IDENTITY(), 0);
    INSERT INTO dbo.tblMenu (ParentId, Description, IsAllowed, Route) VALUES (@reports, 'Resolution Summary', 1, '/reports/resolution-summary');
    INSERT INTO @newMenus VALUES (SCOPE_IDENTITY(), 0);

    -- Settings (admin-only)
    INSERT INTO dbo.tblMenu (ParentId, Description, IsAllowed, Route) VALUES (0, 'Settings', 1, '/settings');
    SET @settings = SCOPE_IDENTITY(); INSERT INTO @newMenus VALUES (@settings, 1);
    INSERT INTO dbo.tblMenu (ParentId, Description, IsAllowed, Route) VALUES (@settings, 'Custom Fields', 1, '/settings/custom-fields');
    INSERT INTO @newMenus VALUES (SCOPE_IDENTITY(), 1);
    INSERT INTO dbo.tblMenu (ParentId, Description, IsAllowed, Route) VALUES (@settings, 'Pipelines', 1, '/settings/pipelines');
    INSERT INTO @newMenus VALUES (SCOPE_IDENTITY(), 1);
    INSERT INTO dbo.tblMenu (ParentId, Description, IsAllowed, Route) VALUES (@settings, 'Lookups', 1, '/settings/lookups');
    INSERT INTO @newMenus VALUES (SCOPE_IDENTITY(), 1);
    INSERT INTO dbo.tblMenu (ParentId, Description, IsAllowed, Route) VALUES (@settings, 'Ticket Categories', 1, '/settings/ticket-categories');
    INSERT INTO @newMenus VALUES (SCOPE_IDENTITY(), 1);
    INSERT INTO dbo.tblMenu (ParentId, Description, IsAllowed, Route) VALUES (@settings, 'Priorities', 1, '/settings/priorities');
    INSERT INTO @newMenus VALUES (SCOPE_IDENTITY(), 1);
    INSERT INTO dbo.tblMenu (ParentId, Description, IsAllowed, Route) VALUES (@settings, 'SLA Rules', 1, '/settings/sla');
    INSERT INTO @newMenus VALUES (SCOPE_IDENTITY(), 1);

    -- 3) Grant access. Non-admin menus (Sales/Support/Reports) -> every active
    --    group; admin menus (Settings) -> Super Admins (1) + Admins (2) only.
    --    Adjust per-group later via the group-access admin if you want tighter
    --    visibility. Full CRUD granted; narrow with CanEdit/CanDelete as needed.
    INSERT INTO dbo.tblGroupAccess (GroupId, MenuId, CanAdd, CanEdit, CanDelete, CanView)
    SELECT g.Id, nm.MenuId, 1, 1, 1, 1
    FROM @newMenus nm
    CROSS JOIN dbo.tblUserGroups g
    WHERE g.IsActive = 1
      AND (nm.AdminOnly = 0 OR g.Id IN (1, 2))
      AND NOT EXISTS (SELECT 1 FROM dbo.tblGroupAccess ga WHERE ga.GroupId = g.Id AND ga.MenuId = nm.MenuId);
END
GO

-- 4) Thread Route through the login + menu SPs (verbatim reproductions with
--    `m.Route` added to the menu result set).
CREATE OR ALTER PROC dbo.sp_ValidateUser
    @username VARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);
    DECLARE @UserId INT;
    DECLARE @IsActive BIT;

    SELECT TOP 1 @UserId = Id, @IsActive = IsActive
    FROM tblUser
    WHERE Username = @username;

    IF @UserId IS NULL
    BEGIN
        SET @ResponseCode = 404;
        SET @ResponseMess = 'Username does not exist';

        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               NULL AS UserId, NULL AS UserName, NULL AS Password, NULL AS UserActive, NULL AS IsAdmin,
               NULL AS FullName, NULL AS Email, NULL AS JobTitle, NULL AS HourlyRate,
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
    WHERE u.Id = @UserId;

    SELECT DISTINCT
           m.Id          AS MenuId,
           m.ParentId, m.Description, m.Image, m.FormId, m.MenuType, m.ActualId,
           m.IsAllowed, m.FormName, m.FormClass, m.OpenStyle, m.Route,
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
GO

CREATE OR ALTER PROC sp_FetchMenu
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
               m.ActualId, m.IsAllowed, m.FormName, m.FormClass, m.OpenStyle, m.Route,
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
                   m.ActualId, m.IsAllowed, m.FormName, m.FormClass, m.OpenStyle, m.Route,
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
                   NULL AS FormName, NULL AS FormClass, NULL AS OpenStyle, NULL AS Route,
                   NULL AS CanAdd, NULL AS CanEdit, NULL AS CanDelete, NULL AS CanView;
        END
    END
END
GO
