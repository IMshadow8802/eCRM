-- 096_org_hierarchy.sql — office tree + per-module role grants (spec 2026-10-07-org-hierarchy)
-- Apply on BOTH databases: sqlcmd -I -S <server> -U <user> -P <pw> -d "eCRM+"   -i 096_org_hierarchy.sql
--                          sqlcmd -I -S <server> -U <user> -P <pw> -d "SolarCRM" -i 096_org_hierarchy.sql
-- Idempotent. Verify-after-apply block at the end.
-- Safe to apply before the matching Node deploy: every changed proc keeps today's callers' behaviour (or narrows it).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO

-- 1. Schema --------------------------------------------------------------
IF COL_LENGTH('dbo.tblBranch', 'ParentId') IS NULL
    ALTER TABLE dbo.tblBranch ADD ParentId BIGINT NULL;
IF COL_LENGTH('dbo.tblBranch', 'IsActive') IS NULL
    ALTER TABLE dbo.tblBranch ADD IsActive BIT NOT NULL CONSTRAINT DF_tblBranch_IsActive DEFAULT 1;
IF COL_LENGTH('dbo.tblUserGroups', 'CanSeeSensitive') IS NULL
    ALTER TABLE dbo.tblUserGroups ADD CanSeeSensitive BIT NOT NULL CONSTRAINT DF_tblUserGroups_CanSeeSensitive DEFAULT 0;
IF COL_LENGTH('dbo.tblMenu', 'Module') IS NULL
    ALTER TABLE dbo.tblMenu ADD Module VARCHAR(30) NULL;
GO
IF OBJECT_ID('dbo.tblGroupModule') IS NULL
CREATE TABLE dbo.tblGroupModule (
    Id        INT IDENTITY(1,1) CONSTRAINT PK_tblGroupModule PRIMARY KEY,
    GroupId   INT          NOT NULL CONSTRAINT FK_tblGroupModule_Group REFERENCES dbo.tblUserGroups(Id),
    Module    VARCHAR(30)  NOT NULL,
    CanView   BIT NOT NULL CONSTRAINT DF_tblGroupModule_V DEFAULT 0,
    CanAdd    BIT NOT NULL CONSTRAINT DF_tblGroupModule_A DEFAULT 0,
    CanEdit   BIT NOT NULL CONSTRAINT DF_tblGroupModule_E DEFAULT 0,
    CanDelete BIT NOT NULL CONSTRAINT DF_tblGroupModule_D DEFAULT 0,
    Reach     VARCHAR(12)  NULL,
    CONSTRAINT UX_tblGroupModule UNIQUE (GroupId, Module),
    -- 'roles' and 'offices' are admin-only menus: they carry no grant row.
    CONSTRAINT CK_tblGroupModule_Module CHECK (Module IN ('leads','sales_reports','complaints','support_reports',
        'customers','people','tasks','teams','projects','settings','dashboard')),
    CONSTRAINT CK_tblGroupModule_Reach CHECK (
        (Module IN ('leads','complaints','customers','people') AND Reach IN ('Own','Team','Office','OfficeTree','Company'))
     OR (Module NOT IN ('leads','complaints','customers','people') AND Reach IS NULL))
);
GO

-- 2. Menus belong to a module. Parents (rows with children) stay NULL: they
--    show when any child shows. Matched by Route so both databases agree.
UPDATE m SET Module = NULL FROM dbo.tblMenu m
 WHERE EXISTS (SELECT 1 FROM dbo.tblMenu c WHERE c.ParentId = m.Id);

UPDATE m SET Module = x.Module
FROM dbo.tblMenu m
JOIN (VALUES
    ('/dashboard','dashboard'), ('/tasks','tasks'), ('/my-work','tasks'),
    ('/sales/leads','leads'), ('/sales/follow-ups','leads'), ('/sales/quotations','leads'),
    ('/support/tickets','complaints'), ('/support/customers','customers'),
    ('/settings/custom-fields','settings'), ('/settings/lookups','settings'),
    ('/settings/ticket-categories','settings'), ('/settings/priorities','settings'),
    ('/settings/products','settings'),
    ('/users','people'), ('/teams','teams'), ('/projects','projects'),
    ('/groups','roles'), ('/offices','offices')
) x(Route, Module) ON x.Route = m.Route
WHERE NOT EXISTS (SELECT 1 FROM dbo.tblMenu c WHERE c.ParentId = m.Id);

-- Report leaves are matched by their parent, since a parent shares a child's route.
UPDATE c SET Module = CASE WHEN p.Description = 'Sales Reports' THEN 'sales_reports' ELSE 'support_reports' END
FROM dbo.tblMenu c JOIN dbo.tblMenu p ON p.Id = c.ParentId
WHERE p.Description IN ('Sales Reports', 'Support Reports');

-- The Offices screen, under Admin.
IF NOT EXISTS (SELECT 1 FROM dbo.tblMenu WHERE Route = '/offices')
    INSERT INTO dbo.tblMenu (ParentId, Description, IsAllowed, Route, Module)
    SELECT TOP 1 Id, 'Offices', 1, '/offices', 'offices' FROM dbo.tblMenu WHERE Route = '/admin';
GO

-- 3. Fill tblGroupModule from today's tblGroupAccess + DataScope, then pin
--    the stock roles to the spec §4 table. Only when the table is empty, so a
--    re-run never overwrites grants an admin has edited since.
BEGIN TRAN;
IF NOT EXISTS (SELECT 1 FROM dbo.tblGroupModule WITH (TABLOCKX, HOLDLOCK))   -- re-entry guard, held for the whole transaction
BEGIN
    INSERT INTO dbo.tblGroupModule (GroupId, Module, CanView, CanAdd, CanEdit, CanDelete, Reach)
    SELECT g.Id, m.Module,
           ISNULL(MAX(CAST(ga.CanView AS INT)), 0), ISNULL(MAX(CAST(ga.CanAdd AS INT)), 0),
           ISNULL(MAX(CAST(ga.CanEdit AS INT)), 0), ISNULL(MAX(CAST(ga.CanDelete AS INT)), 0),
           CASE WHEN m.Module IN ('leads','complaints','customers','people') THEN
                CASE g.DataScope WHEN 'Self' THEN 'Own' WHEN 'Team' THEN 'Team'
                                 WHEN 'Branch' THEN 'Office' WHEN 'MultiBranch' THEN 'Office'
                                 ELSE 'Company' END END
    FROM dbo.tblUserGroups g
    JOIN dbo.tblGroupAccess ga ON ga.GroupId = g.Id
    JOIN dbo.tblMenu m ON m.Id = ga.MenuId AND m.Module NOT IN ('roles','offices')
    GROUP BY g.Id, g.DataScope, m.Module
    HAVING ISNULL(MAX(CAST(ga.CanView AS INT)), 0) = 1;

    -- Stock roles, by name (spec §4). V/A/E = 1/1/1/0; V = 1/0/0/0; V/A = 1/1/0/0.
    DECLARE @Stock TABLE (RoleName VARCHAR(100), Module VARCHAR(30), V BIT, A BIT, E BIT, D BIT, Reach VARCHAR(12));
    INSERT INTO @Stock VALUES
     ('Sales Head','leads',1,1,1,0,'Company'), ('Sales Head','customers',1,1,1,0,'Company'), ('Sales Head','people',1,0,0,0,'Team'),
     ('Sales Head','tasks',1,1,1,1,NULL), ('Sales Head','dashboard',1,0,0,0,NULL), ('Sales Head','sales_reports',1,0,0,0,NULL),
     ('Support Head','complaints',1,1,1,0,'Company'), ('Support Head','customers',1,1,1,0,'Company'), ('Support Head','people',1,0,0,0,'Team'),
     ('Support Head','tasks',1,1,1,1,NULL), ('Support Head','dashboard',1,0,0,0,NULL), ('Support Head','support_reports',1,0,0,0,NULL),
     ('HR Manager','people',1,1,1,0,'Company'), ('HR Manager','tasks',1,1,1,1,NULL), ('HR Manager','dashboard',1,0,0,0,NULL),
     ('HR Manager','teams',1,1,1,1,NULL), ('HR Manager','projects',1,1,1,1,NULL),
     ('Regional Manager','leads',1,1,1,0,'OfficeTree'), ('Regional Manager','complaints',1,1,1,0,'OfficeTree'),
     ('Regional Manager','customers',1,1,1,0,'OfficeTree'), ('Regional Manager','people',1,0,0,0,'OfficeTree'),
     ('Regional Manager','tasks',1,1,1,1,NULL), ('Regional Manager','dashboard',1,0,0,0,NULL),
     ('Regional Manager','sales_reports',1,0,0,0,NULL), ('Regional Manager','support_reports',1,0,0,0,NULL),
     ('Regional Manager','teams',1,1,1,0,NULL), ('Regional Manager','projects',1,1,1,0,NULL),
     ('Branch Manager','leads',1,1,1,0,'Office'), ('Branch Manager','complaints',1,1,1,0,'Office'),
     ('Branch Manager','customers',1,1,1,0,'Office'), ('Branch Manager','people',1,0,0,0,'Office'),
     ('Branch Manager','tasks',1,1,1,1,NULL), ('Branch Manager','dashboard',1,0,0,0,NULL),
     ('Branch Manager','sales_reports',1,0,0,0,NULL), ('Branch Manager','support_reports',1,0,0,0,NULL),
     ('Branch Manager','teams',1,1,1,0,NULL), ('Branch Manager','projects',1,1,1,0,NULL),
     ('Support Manager','complaints',1,1,1,0,'Office'), ('Support Manager','customers',1,1,1,0,'Office'),
     ('Support Manager','people',1,0,0,0,'Office'), ('Support Manager','tasks',1,1,1,1,NULL),
     ('Support Manager','dashboard',1,0,0,0,NULL), ('Support Manager','support_reports',1,0,0,0,NULL),
     ('Sales Team Lead','leads',1,1,1,0,'Team'), ('Sales Team Lead','customers',1,1,1,0,'Office'),
     ('Sales Team Lead','people',1,0,0,0,'Team'), ('Sales Team Lead','tasks',1,1,1,1,NULL),
     ('Sales Team Lead','dashboard',1,0,0,0,NULL), ('Sales Team Lead','sales_reports',1,0,0,0,NULL),
     ('Sales Executive','leads',1,1,1,0,'Own'), ('Sales Executive','customers',1,1,0,0,'Office'),
     ('Sales Executive','people',1,0,0,0,'Own'), ('Sales Executive','tasks',1,1,1,1,NULL), ('Sales Executive','dashboard',1,0,0,0,NULL),
     ('Support Agent','complaints',1,1,1,0,'Own'), ('Support Agent','customers',1,1,0,0,'Office'),
     ('Support Agent','people',1,0,0,0,'Own'), ('Support Agent','tasks',1,1,1,1,NULL), ('Support Agent','dashboard',1,0,0,0,NULL),
     ('Task Collaborator','people',1,0,0,0,'Own'), ('Task Collaborator','tasks',1,1,1,1,NULL);

    -- A stock role is replaced wholesale by its table rows.
    DELETE gm FROM dbo.tblGroupModule gm
    JOIN dbo.tblUserGroups g ON g.Id = gm.GroupId
    WHERE g.Name IN (SELECT DISTINCT RoleName FROM @Stock) AND g.IsAdmin = 0;

    INSERT INTO dbo.tblGroupModule (GroupId, Module, CanView, CanAdd, CanEdit, CanDelete, Reach)
    SELECT g.Id, s.Module, s.V, s.A, s.E, s.D, s.Reach
    FROM @Stock s JOIN dbo.tblUserGroups g ON g.Name = s.RoleName AND g.IsAdmin = 0;

    UPDATE dbo.tblUserGroups SET CanSeeSensitive = 1 WHERE IsAdmin = 1 OR Name = 'HR Manager';
END
COMMIT;
GO

-- 4. The one access read. Node builds per-module scopes from these lists.
CREATE OR ALTER PROC dbo.sp_FetchUserAccess
    @UserId INT,
    @CompId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Home BIGINT, @IsActive BIT, @IsAdmin BIT = 0, @Sensitive BIT = 0;

    SELECT @Home = BranchId, @IsActive = IsActive
    FROM dbo.tblUser WHERE Id = @UserId AND CompId = @CompId;

    SELECT @IsAdmin   = CAST(ISNULL(MAX(CAST(g.IsAdmin AS INT)), 0) AS BIT),
           @Sensitive = CAST(ISNULL(MAX(CAST(g.CanSeeSensitive AS INT)), 0) AS BIT)
    FROM dbo.tblUserGroupMap m
    JOIN dbo.tblUserGroups g ON g.Id = m.GroupId AND g.IsActive = 1 AND g.CompId = @CompId
    WHERE m.UserId = @UserId;

    -- RS1 header. No user row = inactive (fail closed).
    SELECT @Home AS PrimaryBranchId,
           CAST(ISNULL(@IsActive, 0) AS BIT) AS IsActive,
           @IsAdmin AS IsAdmin,
           CAST(CASE WHEN @IsAdmin = 1 OR @Sensitive = 1 THEN 1 ELSE 0 END AS BIT) AS CanSeeSensitive;

    -- RS2 modules: union over active groups; widest reach wins.
    SELECT gm.Module,
           CAST(MAX(CAST(gm.CanView   AS INT)) AS BIT) AS CanView,
           CAST(MAX(CAST(gm.CanAdd    AS INT)) AS BIT) AS CanAdd,
           CAST(MAX(CAST(gm.CanEdit   AS INT)) AS BIT) AS CanEdit,
           CAST(MAX(CAST(gm.CanDelete AS INT)) AS BIT) AS CanDelete,
           CASE MAX(CASE gm.Reach WHEN 'Own' THEN 1 WHEN 'Team' THEN 2 WHEN 'Office' THEN 3
                                  WHEN 'OfficeTree' THEN 4 WHEN 'Company' THEN 5 END)
                WHEN 1 THEN 'Own' WHEN 2 THEN 'Team' WHEN 3 THEN 'Office'
                WHEN 4 THEN 'OfficeTree' WHEN 5 THEN 'Company' END AS Reach
    FROM dbo.tblUserGroupMap m
    JOIN dbo.tblUserGroups g   ON g.Id = m.GroupId AND g.IsActive = 1 AND g.CompId = @CompId
    JOIN dbo.tblGroupModule gm ON gm.GroupId = g.Id AND gm.CanView = 1
    WHERE m.UserId = @UserId
    GROUP BY gm.Module;

    -- Office lists per reach level.
    DECLARE @Office TABLE (BranchId BIGINT PRIMARY KEY, CanWrite BIT);
    IF @Home IS NOT NULL INSERT INTO @Office VALUES (@Home, 1);
    INSERT INTO @Office (BranchId, CanWrite)
    SELECT a.BranchId, CAST(MAX(CAST(a.CanWrite AS INT)) AS BIT)
    FROM dbo.tblUserBranchAccess a
    WHERE a.UserId = @UserId AND a.CompId = @CompId AND a.CanRead = 1 AND a.BranchId <> ISNULL(@Home, -1)
    GROUP BY a.BranchId;

    DECLARE @Tree TABLE (BranchId BIGINT PRIMARY KEY, CanWrite BIT);
    ;WITH t AS (
        SELECT BranchId, CanWrite, 0 AS Depth FROM @Office
        UNION ALL
        SELECT b.Id, t.CanWrite, t.Depth + 1
        FROM dbo.tblBranch b JOIN t ON b.ParentId = t.BranchId
        WHERE t.Depth < 30
    )
    INSERT INTO @Tree (BranchId, CanWrite)
    SELECT BranchId, CAST(MAX(CAST(CanWrite AS INT)) AS BIT) FROM t GROUP BY BranchId
    OPTION (MAXRECURSION 32);

    DECLARE @Subtree TABLE (UserId INT PRIMARY KEY, BranchId BIGINT NULL);
    ;WITH chain AS (
        SELECT Id, BranchId FROM dbo.tblUser WHERE Id = @UserId AND CompId = @CompId
        UNION ALL
        SELECT u.Id, u.BranchId FROM dbo.tblUser u JOIN chain c ON u.ReportsTo = c.Id
        WHERE u.CompId = @CompId AND u.Id <> @UserId
    )
    INSERT INTO @Subtree (UserId, BranchId) SELECT DISTINCT Id, BranchId FROM chain OPTION (MAXRECURSION 32);

    -- RS3 offices per reach.
    SELECT 'Own' AS Reach, @Home AS BranchId, CAST(1 AS BIT) AS CanWrite WHERE @Home IS NOT NULL
    UNION ALL
    SELECT 'Team', BranchId, CAST(1 AS BIT) FROM (
        SELECT @Home AS BranchId WHERE @Home IS NOT NULL
        UNION SELECT BranchId FROM @Subtree WHERE BranchId IS NOT NULL) x
    UNION ALL
    SELECT 'Office', BranchId, CanWrite FROM @Office
    UNION ALL
    SELECT 'OfficeTree', BranchId, CanWrite FROM @Tree
    UNION ALL
    -- Inactive offices are included on purpose: old records there stay visible.
    SELECT 'Company', b.Id, CAST(1 AS BIT) FROM dbo.tblBranch b WHERE b.Id IS NOT NULL;

    -- RS4 the Team owner list (self included).
    SELECT UserId AS OwnerId FROM @Subtree;
END
GO

-- 5. sp_ValidateUser: menu rows from module grants (live text, only the final menu SELECT replaced).
-- NOTE: numbers in the carried-over history comment below (e.g. '6.', '9.2', '7.1') are from earlier scripts, not 096 sections.
-- ---------------------------------------------------------------------------
-- 6. sp_ValidateUser — IsAdmin now comes from the user's ACTIVE group(s),
--    the same flag requireAdmin and sp_CheckTaskPermission already use. The
--    tblUser.IsAdmin column (set by a checkbox on the Users form) used to go
--    into the token and from there into user/team/project fetches, deletes
--    and socket rooms, so ticking that box made anyone a partial admin.
--    Live effect on 2026-10-07: exactly one user changes (Admin group, column
--    0) and gains admin, which is what their role already says.
-- ---------------------------------------------------------------------------
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

-- sp_FetchUserMenus: the same menu rows for a signed-in user (fetchMyAccess).
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

-- 6. Role grid read/write.
CREATE OR ALTER PROC dbo.sp_FetchGroupModules
    @GroupId INT,
    @CompId  BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.tblUserGroups WHERE Id = @GroupId AND CompId = @CompId)
    BEGIN SELECT 404 AS ResponseCode, 'Role not found' AS ResponseMess; RETURN; END
    SELECT 200 AS ResponseCode, 'Role modules retrieved' AS ResponseMess,
           g.CanSeeSensitive, g.IsAdmin
    FROM dbo.tblUserGroups g WHERE g.Id = @GroupId;
    SELECT Module, CanView, CanAdd, CanEdit, CanDelete, Reach
    FROM dbo.tblGroupModule WHERE GroupId = @GroupId ORDER BY Module;
END
GO

CREATE OR ALTER PROC dbo.sp_SaveGroupModules
    @GroupId         INT,
    @CompId          BIGINT,
    @ModulesJson     NVARCHAR(MAX),
    @CanSeeSensitive BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.tblUserGroups WHERE Id = @GroupId AND CompId = @CompId)
    BEGIN SELECT @GroupId AS Id, 404 AS ResponseCode, 'Role not found' AS ResponseMess; RETURN; END
    IF ISJSON(@ModulesJson) <> 1
    BEGIN SELECT @GroupId AS Id, 400 AS ResponseCode, 'Modules must be a JSON array' AS ResponseMess; RETURN; END

    DECLARE @In TABLE (Module VARCHAR(30) PRIMARY KEY, V BIT, A BIT, E BIT, D BIT, Reach VARCHAR(12));

    BEGIN TRY
        -- Parsed inside the TRY, and de-duplicated per module, so a bad payload is a 400, not a raw 500.
        INSERT INTO @In
        SELECT Module, MAX(CAST(ISNULL(CanView,0) AS INT)), MAX(CAST(ISNULL(CanAdd,0) AS INT)),
               MAX(CAST(ISNULL(CanEdit,0) AS INT)), MAX(CAST(ISNULL(CanDelete,0) AS INT)), MAX(NULLIF(Reach, ''))
        FROM OPENJSON(@ModulesJson) WITH (Module VARCHAR(30), CanView BIT, CanAdd BIT, CanEdit BIT, CanDelete BIT, Reach VARCHAR(12))
        WHERE Module IS NOT NULL
        GROUP BY Module;

        -- Any right implies view; no view = no row.
        UPDATE @In SET V = 1 WHERE A = 1 OR E = 1 OR D = 1;
        DELETE FROM @In WHERE V = 0;
        -- Reach modules default to Own; others carry none.
        UPDATE @In SET Reach = ISNULL(Reach, 'Own') WHERE Module IN ('leads','complaints','customers','people');
        UPDATE @In SET Reach = NULL WHERE Module NOT IN ('leads','complaints','customers','people');

        BEGIN TRAN;
        DELETE FROM dbo.tblGroupModule WHERE GroupId = @GroupId;
        INSERT INTO dbo.tblGroupModule (GroupId, Module, CanView, CanAdd, CanEdit, CanDelete, Reach)
        SELECT @GroupId, Module, V, A, E, D, Reach FROM @In;
        UPDATE dbo.tblUserGroups SET CanSeeSensitive = ISNULL(@CanSeeSensitive, 0) WHERE Id = @GroupId;
        COMMIT;
        SELECT @GroupId AS Id, 200 AS ResponseCode, 'Role permissions saved' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        -- 547 = the CHECK constraints (unknown module / bad reach); 245/2628/8114/8152 = unparseable or oversize values.
        SELECT @GroupId AS Id,
               CASE WHEN ERROR_NUMBER() IN (547, 245, 2628, 8114, 8152) THEN 400 ELSE 500 END AS ResponseCode,
               CASE WHEN ERROR_NUMBER() IN (547, 245, 2628, 8114, 8152) THEN 'Unknown module or reach' ELSE ERROR_MESSAGE() END AS ResponseMess;
    END CATCH
END
GO

-- sp_DeleteUserGroup: also removes the role's module grants.
-- ----- sp_DeleteUserGroup -----
CREATE OR ALTER PROC sp_DeleteUserGroup
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
        DELETE FROM tblGroupModule WHERE GroupId = @Id;   -- 096
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

-- 7. Offices.
CREATE OR ALTER PROC dbo.sp_FetchBranches
AS
BEGIN
    SET NOCOUNT ON;
    SELECT b.Id, b.BranchName, b.ParentId, b.IsActive, b.Address,
           (SELECT COUNT(*) FROM dbo.tblUser u WHERE u.BranchId = b.Id AND u.IsActive = 1) AS PeopleCount
    FROM dbo.tblBranch b
    WHERE b.Id IS NOT NULL
    ORDER BY b.BranchName;
END
GO

CREATE OR ALTER PROC dbo.sp_SaveBranch
    @Id         BIGINT       = 0,
    @BranchName VARCHAR(50),
    @ParentId   BIGINT       = NULL,
    @Address    VARCHAR(50)  = NULL,
    @IsActive   BIT          = 1,
    @CompId     BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    SET @Id = ISNULL(@Id, 0);
    SET @BranchName = NULLIF(LTRIM(RTRIM(@BranchName)), '');
    IF @ParentId <= 0 SET @ParentId = NULL;

    IF @BranchName IS NULL
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Office name is required' AS ResponseMess; RETURN; END
    IF @Id > 0 AND NOT EXISTS (SELECT 1 FROM dbo.tblBranch WHERE Id = @Id)
    BEGIN SELECT @Id AS Id, 404 AS ResponseCode, 'Office not found' AS ResponseMess; RETURN; END
    IF @ParentId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.tblBranch WHERE Id = @ParentId)
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Parent office not found' AS ResponseMess; RETURN; END
    IF EXISTS (SELECT 1 FROM dbo.tblBranch WHERE BranchName = @BranchName AND Id <> @Id)
    BEGIN SELECT @Id AS Id, 409 AS ResponseCode, 'Another office already has this name' AS ResponseMess; RETURN; END

    -- No loops: walk up from the new parent; meeting @Id means it would sit under itself.
    IF @Id > 0 AND @ParentId IS NOT NULL
    BEGIN
        DECLARE @cur BIGINT = @ParentId, @hops INT = 0;
        WHILE @cur IS NOT NULL AND @hops < 32
        BEGIN
            IF @cur = @Id
            BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'An office cannot sit under itself or one of its own offices' AS ResponseMess; RETURN; END
            SET @cur = (SELECT ParentId FROM dbo.tblBranch WHERE Id = @cur);
            SET @hops += 1;
        END
    END

    IF @Id > 0 AND @IsActive = 0
       AND EXISTS (SELECT 1 FROM dbo.tblUser WHERE BranchId = @Id AND CompId = @CompId AND IsActive = 1)
    BEGIN SELECT @Id AS Id, 409 AS ResponseCode, 'Move or deactivate the people in this office first' AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRAN;
        IF @Id > 0
            UPDATE dbo.tblBranch SET BranchName = @BranchName, ParentId = @ParentId,
                   Address = @Address, IsActive = ISNULL(@IsActive, 1)
            WHERE Id = @Id;
        ELSE
        BEGIN
            -- tblBranch.Id is not an identity column.
            SELECT @Id = ISNULL(MAX(Id), 0) + 1 FROM dbo.tblBranch WITH (UPDLOCK, HOLDLOCK);
            INSERT INTO dbo.tblBranch (Id, BranchName, Address, ParentId, IsActive)
            VALUES (@Id, @BranchName, @Address, @ParentId, 1);
        END
        COMMIT;
        SELECT @Id AS Id, 200 AS ResponseCode, 'Office saved' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT @Id AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

-- 8. Who the caller may hand a record to — decided by the module scope Node
--    passes, not by a DataScope read here. Narrow (owner list) = own subtree +
--    own manager; wide = everyone in the readable offices; @BranchId = that
--    office's roster (Node decides whether a cross-office move is allowed).
CREATE OR ALTER PROC dbo.sp_FetchAssignableUsers
    @UserId                  INT,
    @CompId                  INT,
    @BranchId                INT           = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Users TABLE (Id INT PRIMARY KEY);
    DECLARE @ManagerId INT = (SELECT ReportsTo FROM dbo.tblUser WHERE Id = @UserId AND CompId = @CompId);

    IF @BranchId IS NOT NULL
        INSERT INTO @Users SELECT Id FROM dbo.tblUser
        WHERE CompId = @CompId AND BranchId = @BranchId AND IsActive = 1;
    ELSE IF @OwnerIdsJson IS NOT NULL AND @OwnerIdsJson <> ''
    BEGIN
        INSERT INTO @Users SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@OwnerIdsJson);
        IF @ManagerId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM @Users WHERE Id = @ManagerId)
            INSERT INTO @Users (Id) VALUES (@ManagerId);
        DELETE x FROM @Users x JOIN dbo.tblUser u ON u.Id = x.Id WHERE u.IsActive = 0 OR u.CompId <> @CompId;
    END
    ELSE IF @AccessibleBranchIdsJson IS NULL OR @AccessibleBranchIdsJson = ''
    BEGIN
        -- Legacy caller (no scope at all): fail closed, never "whole company".
        -- Returns only the caller and their active manager. New Node always sends a non-null list.
        INSERT INTO @Users SELECT Id FROM dbo.tblUser
        WHERE CompId = @CompId AND IsActive = 1 AND (Id = @UserId OR Id = @ManagerId);
    END
    ELSE
        INSERT INTO @Users SELECT Id FROM dbo.tblUser
        WHERE CompId = @CompId AND IsActive = 1
          AND BranchId IN (SELECT CAST(value AS BIGINT) FROM OPENJSON(@AccessibleBranchIdsJson));

    SELECT u.Id, u.FullName, u.Avatar, u.JobTitle, u.BranchId, b.BranchName, u.ReportsTo,
           200 AS ResponseCode, 'Assignable users retrieved successfully' AS ResponseMess
    FROM @Users x
    JOIN dbo.tblUser u ON u.Id = x.Id
    LEFT JOIN dbo.tblBranch b ON b.Id = u.BranchId
    ORDER BY u.FullName;
END
GO

-- 9. Customers belong to an office. Live index (checked 2026-10-07):
--    UX_tblCustomer_CompId_Mobile, filter ([IsActive]=(1) AND [Mobile] IS NOT NULL).
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_tblCustomer_CompId_Mobile' AND object_id = OBJECT_ID('dbo.tblCustomer'))
    DROP INDEX UX_tblCustomer_CompId_Mobile ON dbo.tblCustomer;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_tblCustomer_Branch_Mobile' AND object_id = OBJECT_ID('dbo.tblCustomer'))
    CREATE UNIQUE INDEX UX_tblCustomer_Branch_Mobile ON dbo.tblCustomer (CompId, BranchId, Mobile)
    WHERE IsActive = 1 AND Mobile IS NOT NULL;
GO

-- sp_SaveCustomer: dedupe per office; BranchId on edit NULL = keep, value = move.
-- NOTE: numbers in the carried-over history comment below (e.g. '6.', '9.2', '7.1') are from earlier scripts, not 096 sections.
-- ---------------------------------------------------------------------------
-- 8.4 sp_SaveCustomer — + @GSTIN; and the mobile rule becomes TEN DIGITS.
--     The old checks allowed '+' and any length, which is how '+919310500657'
--     and '111' got in. The backend normalises before calling; this makes the
--     SP say the same thing in words instead of tripping the CHECK constraint.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_SaveCustomer
    @Id            INT            = 0,
    @CompId        INT,
    @BranchId      INT,
    @UserId        INT,
    @Name          NVARCHAR(200),
    @ContactPerson NVARCHAR(200)  = NULL,
    @Mobile        VARCHAR(20)    = NULL,
    @AltMobile     VARCHAR(20)    = NULL,
    @Email         NVARCHAR(200)  = NULL,
    @Address       NVARCHAR(500)  = NULL,
    @City          NVARCHAR(100)  = NULL,
    @State         NVARCHAR(100)  = NULL,
    @Pincode       VARCHAR(10)    = NULL,
    @Remarks       NVARCHAR(MAX)  = NULL,
    @GSTIN         VARCHAR(15)    = NULL,
    @MoveToBranchId INT           = NULL   -- 096: edit only; non-null moves the customer to that office
AS
BEGIN
    SET NOCOUNT ON;
    SET @Id = ISNULL(@Id, 0);
    IF @MoveToBranchId <= 0 SET @MoveToBranchId = NULL;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess; RETURN; END
    IF @Id = 0 AND (@BranchId IS NULL OR @BranchId <= 0)
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'BranchId is required' AS ResponseMess; RETURN; END

    SET @Name          = NULLIF(LTRIM(RTRIM(@Name)), N'');
    SET @ContactPerson = NULLIF(LTRIM(RTRIM(@ContactPerson)), N'');
    SET @Email         = NULLIF(LTRIM(RTRIM(@Email)), N'');
    SET @Mobile        = NULLIF(REPLACE(REPLACE(LTRIM(RTRIM(@Mobile)),    ' ', ''), '-', ''), '');
    SET @AltMobile     = NULLIF(REPLACE(REPLACE(LTRIM(RTRIM(@AltMobile)), ' ', ''), '-', ''), '');
    SET @GSTIN         = NULLIF(UPPER(REPLACE(LTRIM(RTRIM(@GSTIN)), ' ', '')), '');

    IF @Name IS NULL
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Name is required' AS ResponseMess; RETURN; END
    IF @Mobile IS NULL AND @Email IS NULL
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'A mobile number or an email is required' AS ResponseMess; RETURN; END
    IF @Mobile IS NOT NULL AND @Mobile NOT LIKE '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Mobile number must be 10 digits' AS ResponseMess; RETURN; END
    IF @AltMobile IS NOT NULL AND @AltMobile NOT LIKE '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Alternate mobile must be 10 digits' AS ResponseMess; RETURN; END
    IF @Email IS NOT NULL AND @Email NOT LIKE '%_@_%'
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Invalid email' AS ResponseMess; RETURN; END
    IF @GSTIN IS NOT NULL AND (LEN(@GSTIN) <> 15 OR @GSTIN NOT LIKE '[0-9][0-9]%' OR @GSTIN LIKE '%[^0-9A-Z]%')
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'GSTIN must be 15 characters' AS ResponseMess; RETURN; END

    IF @Id > 0 AND NOT EXISTS (SELECT 1 FROM dbo.tblCustomer WHERE Id = @Id AND CompId = @CompId)
    BEGIN SELECT @Id AS Id, 404 AS ResponseCode, 'Customer not found' AS ResponseMess; RETURN; END

    -- 096: @BranchId is used on insert only; an edit moves the customer only via @MoveToBranchId.
    IF @Id = 0 AND @BranchId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.tblBranch WHERE Id = @BranchId)
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Office not found' AS ResponseMess; RETURN; END
    IF @Id > 0 AND @MoveToBranchId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.tblBranch WHERE Id = @MoveToBranchId)
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Office not found' AS ResponseMess; RETURN; END

    -- One live customer per mobile per office (spec 2026-10-07 §2.5).
    -- UX_tblCustomer_Branch_Mobile is the backstop for the race this check cannot see.
    IF @Mobile IS NOT NULL
       AND EXISTS (SELECT 1 FROM dbo.tblCustomer
                   WHERE CompId = @CompId AND Mobile = @Mobile AND IsActive = 1 AND Id <> @Id
                     AND BranchId = CASE WHEN @Id > 0 THEN ISNULL(@MoveToBranchId, (SELECT BranchId FROM dbo.tblCustomer WHERE Id = @Id)) ELSE @BranchId END)
    BEGIN SELECT @Id AS Id, 409 AS ResponseCode, 'Another customer in this office already has this mobile number' AS ResponseMess; RETURN; END

    BEGIN TRY
        IF @Id > 0
        BEGIN
            UPDATE dbo.tblCustomer
            SET Name = @Name, ContactPerson = @ContactPerson,
                Mobile = @Mobile, AltMobile = @AltMobile, Email = @Email,
                Address = @Address, City = @City, State = @State, Pincode = @Pincode,
                GSTIN = @GSTIN, Remarks = @Remarks,
                BranchId = ISNULL(@MoveToBranchId, BranchId),
                EditBy = @UserId, UpdatedAt = GETDATE()
            WHERE Id = @Id AND CompId = @CompId;

            SELECT @Id AS Id, 200 AS ResponseCode, 'Customer updated successfully' AS ResponseMess;
        END
        ELSE
        BEGIN
            INSERT INTO dbo.tblCustomer
                (CompId, BranchId, Name, ContactPerson, Mobile, AltMobile, Email,
                 Address, City, State, Pincode, GSTIN, Remarks, IsActive, CreatedBy, EditBy, CreatedAt)
            VALUES
                (@CompId, @BranchId, @Name, @ContactPerson, @Mobile, @AltMobile, @Email,
                 @Address, @City, @State, @Pincode, @GSTIN, @Remarks, 1, @UserId, @UserId, GETDATE());

            SELECT CAST(SCOPE_IDENTITY() AS INT) AS Id, 200 AS ResponseCode, 'Customer created successfully' AS ResponseMess;
        END
    END TRY
    BEGIN CATCH
        -- 2601 / 2627: the unique index caught a concurrent insert of the same mobile.
        IF ERROR_NUMBER() IN (2601, 2627)
            SELECT @Id AS Id, 409 AS ResponseCode, 'Another customer in this office already has this mobile number' AS ResponseMess;
        ELSE
            SELECT @Id AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

-- sp_FetchCustomers: scoped by the customers module.
-- NOTE: numbers in the carried-over history comment below (e.g. '6.', '9.2', '7.1') are from earlier scripts, not 096 sections.
CREATE OR ALTER PROC dbo.sp_FetchCustomers
    @CompId     INT,
    @PageNumber INT           = 1,
    @PageSize   INT           = 25,
    @SearchTerm NVARCHAR(200) = NULL,
    @BranchId   INT           = NULL,
    @IsActive   BIT           = 1,
    @UserId                  INT           = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL
AS
BEGIN
    -- Scoped by the customers module (office + CreatedBy as owner), paged, newest first.
    -- Search: Name / ContactPerson / Mobile / AltMobile / Email / City. A
    -- digits-only term also matches a mobile typed with spaces or dashes.
    -- @IsActive NULL = both live and soft-deleted rows.
    SET NOCOUNT ON;

    SET @PageNumber = CASE WHEN ISNULL(@PageNumber, 1)  < 1 THEN 1  ELSE @PageNumber END;
    SET @PageSize   = CASE WHEN ISNULL(@PageSize,  25)  < 1 THEN 25 ELSE @PageSize   END;
    SET @SearchTerm = NULLIF(LTRIM(RTRIM(@SearchTerm)), N'');
    DECLARE @Digits VARCHAR(50) = CASE WHEN @SearchTerm IS NOT NULL
                                        AND REPLACE(REPLACE(@SearchTerm, ' ', ''), '-', '') NOT LIKE '%[^0-9+]%'
                                       THEN REPLACE(REPLACE(@SearchTerm, ' ', ''), '-', '') END;

    DECLARE @BranchIds TABLE (BranchId INT PRIMARY KEY);
    DECLARE @OwnerIds  TABLE (OwnerId  INT PRIMARY KEY);
    DECLARE @UseBranchScope BIT = 0, @UseOwnerScope BIT = 0;
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
    BEGIN
        INSERT INTO @BranchIds (BranchId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@AccessibleBranchIdsJson);
        SET @UseBranchScope = 1;
    END
    IF (@OwnerIdsJson IS NOT NULL AND @OwnerIdsJson <> '')
    BEGIN
        INSERT INTO @OwnerIds (OwnerId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@OwnerIdsJson);
        SET @UseOwnerScope = 1;
    END

    -- One predicate, one scan: the matching ids, then count and page from them.
    DECLARE @F TABLE (Id INT PRIMARY KEY, CreatedAt DATETIME);
    INSERT INTO @F (Id, CreatedAt)
    SELECT c.Id, c.CreatedAt
    FROM dbo.tblCustomer c
    WHERE c.CompId = @CompId
      AND (@IsActive IS NULL OR c.IsActive = @IsActive)
      AND (@BranchId IS NULL OR c.BranchId = @BranchId)
      AND (
            (    (@UseBranchScope = 0 OR c.BranchId  IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR c.CreatedBy IN (SELECT OwnerId  FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND c.CreatedBy = @UserId)
          )
      AND (@SearchTerm IS NULL
           OR c.Name          LIKE '%' + @SearchTerm + '%'
           OR c.ContactPerson LIKE '%' + @SearchTerm + '%'
           OR c.Mobile        LIKE '%' + ISNULL(@Digits, @SearchTerm) + '%'
           OR c.AltMobile     LIKE '%' + ISNULL(@Digits, @SearchTerm) + '%'
           OR c.Email         LIKE '%' + @SearchTerm + '%'
           OR c.City          LIKE '%' + @SearchTerm + '%');

    DECLARE @Total INT = (SELECT COUNT(*) FROM @F);

    -- RS1: the page, with complaint counts (company-wide — a customer is one record)
    SELECT c.Id, c.CompId, c.BranchId, b.BranchName,
           c.Name, c.ContactPerson, c.Mobile, c.AltMobile, c.Email,
           c.Address, c.City, c.State, c.Pincode, c.GSTIN, c.Remarks, c.IsActive,
           ISNULL(tk.OpenTickets, 0) AS OpenTickets,
           ISNULL(tk.TotalTickets, 0) AS TotalTickets,
           tk.LastTicketAt,
           c.CreatedAt, c.UpdatedAt,
           200 AS ResponseCode, 'Customers retrieved successfully' AS ResponseMess
    FROM @F f
    JOIN dbo.tblCustomer c ON c.Id = f.Id
    LEFT JOIN dbo.tblBranch b ON b.Id = c.BranchId
    OUTER APPLY (
        SELECT COUNT(*) AS TotalTickets,
               SUM(CASE WHEN st.Code IN ('open', 'onhold') THEN 1 ELSE 0 END) AS OpenTickets,
               MAX(t.CreatedAt) AS LastTicketAt
        FROM dbo.tblTicket t
        JOIN dbo.tblLookup st ON st.Id = t.StatusId
        WHERE t.CompId = c.CompId AND t.CustomerId = c.Id
    ) tk
    ORDER BY f.CreatedAt DESC, f.Id DESC
    OFFSET (@PageNumber - 1) * @PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;

    -- RS2: pagination
    SELECT @PageNumber AS CurrentPage,
           @PageSize   AS PageSize,
           @Total      AS TotalRecords,
           CASE WHEN @Total = 0 THEN 0 ELSE CEILING(CAST(@Total AS FLOAT) / @PageSize) END AS TotalPages;
END
GO

-- sp_FetchCustomerDetail: RS1 also returns CreatedBy.
-- NOTE: numbers in the carried-over history comment below (e.g. '6.', '9.2', '7.1') are from earlier scripts, not 096 sections.
-- ---------------------------------------------------------------------------
-- 5.3 sp_FetchCustomerDetail — RS1 the customer (company-wide, same columns
--     as sp_FetchCustomers); RS2 that customer's complaints UNDER THE
--     CALLER'S SCOPE (branch AND owner, OR assignee/creator) — a Self agent
--     sees only their own complaints of this customer.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchCustomerDetail
    @CompId                  INT,
    @CustomerId              INT,
    @UserId                  INT           = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Now DATETIME = GETDATE();

    DECLARE @BranchIds TABLE (BranchId INT PRIMARY KEY);
    DECLARE @OwnerIds  TABLE (OwnerId  INT PRIMARY KEY);
    DECLARE @UseBranchScope BIT = 0, @UseOwnerScope BIT = 0;
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
    BEGIN
        INSERT INTO @BranchIds (BranchId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@AccessibleBranchIdsJson);
        SET @UseBranchScope = 1;
    END
    IF (@OwnerIdsJson IS NOT NULL AND @OwnerIdsJson <> '')
    BEGIN
        INSERT INTO @OwnerIds (OwnerId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@OwnerIdsJson);
        SET @UseOwnerScope = 1;
    END

    -- RS1: the customer
    SELECT c.Id, c.CompId, c.BranchId, b.BranchName,
           c.Name, c.ContactPerson, c.Mobile, c.AltMobile, c.Email,
           c.Address, c.City, c.State, c.Pincode, c.GSTIN, c.Remarks, c.IsActive,
           c.CreatedBy,   -- 096: Node's visibility check needs the owner
           ISNULL(tk.OpenTickets, 0) AS OpenTickets,
           ISNULL(tk.TotalTickets, 0) AS TotalTickets,
           tk.LastTicketAt,
           c.CreatedAt, c.UpdatedAt,
           200 AS ResponseCode, 'Customer detail retrieved successfully' AS ResponseMess
    FROM dbo.tblCustomer c
    LEFT JOIN dbo.tblBranch b ON b.Id = c.BranchId
    OUTER APPLY (
        SELECT COUNT(*) AS TotalTickets,
               SUM(CASE WHEN st.Code IN ('open', 'onhold') THEN 1 ELSE 0 END) AS OpenTickets,
               MAX(t.CreatedAt) AS LastTicketAt
        FROM dbo.tblTicket t
        JOIN dbo.tblLookup st ON st.Id = t.StatusId
        WHERE t.CompId = c.CompId AND t.CustomerId = c.Id
    ) tk
    WHERE c.Id = @CustomerId AND c.CompId = @CompId;

    -- RS2: their complaints, scoped
    SELECT t.Id, t.TicketNo, t.Subject,
           t.StatusId, st.Value AS StatusName, st.Code AS StatusCode,
           t.Priority, p.Value AS PriorityName,
           t.AssignedTo, a.FullName AS AssigneeName,
           t.DueAt,
           CAST(CASE WHEN st.Code IN ('open', 'onhold') AND t.DueAt < @Now THEN 1 ELSE 0 END AS BIT) AS IsOverdue,
           t.CreatedAt, t.ResolvedAt, t.ClosedAt
    FROM dbo.tblTicket t
    JOIN dbo.tblLookup st     ON st.Id = t.StatusId
    LEFT JOIN dbo.tblLookup p ON p.Id  = t.Priority
    LEFT JOIN dbo.tblUser a   ON a.Id  = t.AssignedTo
    WHERE t.CompId = @CompId AND t.CustomerId = @CustomerId
      AND (
            (    (@UseBranchScope = 0 OR t.BranchId   IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR t.AssignedTo IN (SELECT OwnerId  FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (t.AssignedTo = @UserId OR t.CreatedBy = @UserId))
          )
    ORDER BY t.CreatedAt DESC, t.Id DESC;
END
GO

-- sp_ConvertLead: customer match restricted to the lead's office.
-- NOTE: numbers in the carried-over history comment below (e.g. '6.', '9.2', '7.1') are from earlier scripts, not 096 sections.
-- ===== 7. Procedures — convert engine (sp_ConvertLead, sp_SetLeadStatus)

-- ---------------------------------------------------------------------------
-- 7.1 sp_ConvertLead — the proc sp_SetLeadStatus has been pointing at since
--     071 ("Use convert to move a lead to Converted") and which never existed.
--
--     ONE engine writes a win. "Accepted" on a quotation and "Won" in the
--     lead's status dropdown both land here; the only difference is where the
--     value comes from:
--        with @QuotationId → the quotation's BEFORE-TAX total (GST is not
--                            revenue); any @WonValue passed is ignored
--        without           → @WonValue, typed by the agent (small leads are
--                            won without a quotation — spec decision 6)
--
--     It also does what "convert" has always meant in this product: the
--     prospect becomes a customer. An active tblCustomer with the lead's mobile
--     is LINKED (a repeat buyer must not become a duplicate); otherwise one is
--     created from the lead. Mobiles are 10 digits on both sides (§1), so the
--     match is reliable.
--
--     Idempotent: a lead that is already won answers 200 and changes nothing.
--     tblLeadStatusHistory now has three writers — sp_SaveLead (insert),
--     sp_SetLeadStatus, and this.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_ConvertLead
    @CompId      INT,
    @LeadId      INT,
    @UserId      INT,
    @WonValue    DECIMAL(18,2) = NULL,
    @Remarks     NVARCHAR(500) = NULL,
    @QuotationId INT           = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN; END
    IF @LeadId IS NULL OR @LeadId <= 0
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'LeadId is required' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN; END
    IF @QuotationId IS NOT NULL AND @QuotationId <= 0 SET @QuotationId = NULL;
    SET @Remarks = NULLIF(LTRIM(RTRIM(@Remarks)), N'');

    DECLARE @FromStatusId INT, @FromCode VARCHAR(30), @FromName NVARCHAR(200),
            @BranchId INT, @CustomerId INT, @CurWon DECIMAL(18,2),
            @LName NVARCHAR(200), @LCompany NVARCHAR(200), @LMobile VARCHAR(20), @LAlt VARCHAR(20),
            @LEmail NVARCHAR(200), @LAddress NVARCHAR(500), @LCity NVARCHAR(100), @LState NVARCHAR(100), @LPin VARCHAR(10);

    SELECT @FromStatusId = l.StatusId, @FromCode = st.Code, @FromName = st.Value,
           @BranchId = l.BranchId, @CustomerId = l.CustomerId, @CurWon = l.WonValue,
           @LName = l.Name, @LCompany = NULLIF(LTRIM(RTRIM(l.Company)), N''), @LMobile = l.MobileNo, @LAlt = l.AltMobile,
           @LEmail = l.Email, @LAddress = l.Address, @LCity = l.City, @LState = l.State, @LPin = l.Pincode
    FROM dbo.tblLeads l JOIN dbo.tblLookup st ON st.Id = l.StatusId
    WHERE l.Id = @LeadId AND l.CompId = @CompId;

    IF @FromStatusId IS NULL
    BEGIN SELECT @LeadId AS Id, 404 AS ResponseCode, 'Lead not found' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN; END
    IF @FromCode = 'converted'
    BEGIN SELECT @LeadId AS Id, 200 AS ResponseCode, 'Lead is already won' AS ResponseMess, @CustomerId AS CustomerId, @CurWon AS WonValue; RETURN; END
    IF @FromCode NOT IN ('open','qualified')
    BEGIN SELECT @LeadId AS Id, 409 AS ResponseCode, 'Only an active lead can be marked won — reopen it first' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN; END

    DECLARE @WonStatusId INT, @ToName NVARCHAR(200);
    SELECT TOP 1 @WonStatusId = Id, @ToName = Value FROM dbo.tblLookup
    WHERE CompId = @CompId AND Kind = 'lead_status' AND Code = 'converted' AND IsActive = 1
    ORDER BY SortOrder, Id;
    IF @WonStatusId IS NULL
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'No Won status is configured for this company' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN; END

    DECLARE @QuoteNo VARCHAR(30), @QuoteGstin VARCHAR(15);
    IF @QuotationId IS NOT NULL
    BEGIN
        DECLARE @QStatus VARCHAR(20);
        SELECT @QStatus = Status, @QuoteNo = QuoteNo, @WonValue = TaxableTotal, @QuoteGstin = ToGSTIN
        FROM dbo.tblQuotation WHERE Id = @QuotationId AND CompId = @CompId AND LeadId = @LeadId;
        IF @QStatus IS NULL
        BEGIN SELECT @LeadId AS Id, 404 AS ResponseCode, 'That quotation does not belong to this lead' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN; END
        IF @QStatus <> 'final'
        BEGIN SELECT @LeadId AS Id, 409 AS ResponseCode, 'Only a finalised quotation can be accepted' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN; END
    END
    ELSE IF @WonValue IS NULL OR @WonValue < 0
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'Enter the value this lead was won for' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;

        -- LOCK ORDER, and why this proc takes it in exactly this direction:
        --   tblCustomer → tblLeads → tblQuotation → tblLeadActivity
        -- sp_SetLeadStatus (7.2) writes tblLeads then tblQuotation, so this
        -- proc must too — taking the quotation first would close a deadlock
        -- cycle with an agent moving the same lead to lost at the same moment.
        -- The other four writers of tblQuotation.Status (save, finalise,
        -- revise, reject) read tblLeads BEFORE their transaction opens and so
        -- never hold a quotation lock while asking for a lead row; their own
        -- order, tblQuotation → tblQuotationLine → tblLeadActivity, is a
        -- suffix of this one and stays intact.

        -- The customer: keep the link the lead already has, else match on the
        -- mobile, else create.
        IF @CustomerId IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM dbo.tblCustomer WHERE Id = @CustomerId AND CompId = @CompId AND IsActive = 1)
            SET @CustomerId = NULL;

        IF @CustomerId IS NULL AND @LMobile IS NOT NULL
            SELECT TOP 1 @CustomerId = Id FROM dbo.tblCustomer WITH (UPDLOCK, HOLDLOCK)
            WHERE CompId = @CompId AND BranchId = @BranchId AND Mobile = @LMobile AND IsActive = 1 ORDER BY Id;  -- 096: match within the lead's office

        IF @CustomerId IS NULL
        BEGIN
            INSERT INTO dbo.tblCustomer
                (CompId, BranchId, Name, ContactPerson, Mobile, AltMobile, Email,
                 Address, City, State, Pincode, GSTIN, Remarks, IsActive, CreatedBy, EditBy, CreatedAt)
            VALUES
                (@CompId, @BranchId, ISNULL(@LCompany, @LName), CASE WHEN @LCompany IS NOT NULL THEN @LName END,
                 @LMobile, @LAlt, @LEmail, @LAddress, @LCity, @LState, @LPin, @QuoteGstin,
                 NULL, 1, @UserId, @UserId, GETDATE());
            SET @CustomerId = CAST(SCOPE_IDENTITY() AS INT);
        END
        ELSE IF @QuoteGstin IS NOT NULL
            UPDATE dbo.tblCustomer SET GSTIN = @QuoteGstin, EditBy = @UserId, UpdatedAt = GETDATE()
            WHERE Id = @CustomerId AND CompId = @CompId AND GSTIN IS NULL;

        -- The win.
        DECLARE @hist TABLE (FromStatusId INT);
        UPDATE dbo.tblLeads
        SET StatusId = @WonStatusId, WonAt = GETDATE(), WonValue = @WonValue, CustomerId = @CustomerId,
            LostAt = NULL, LostReasonId = NULL, EditBy = @UserId, UpdatedAt = GETDATE()
        OUTPUT deleted.StatusId INTO @hist (FromStatusId)
        WHERE Id = @LeadId AND CompId = @CompId;

        INSERT INTO dbo.tblLeadStatusHistory (CompId, LeadId, FromStatusId, ToStatusId, ChangedBy, ChangedAt)
        SELECT @CompId, @LeadId, h.FromStatusId, @WonStatusId, @UserId, GETDATE() FROM @hist h;

        -- Its quotations: the accepted one, and everything else on the lead.
        --
        -- This is the FIFTH writer of tblQuotation.Status, and it wears the
        -- same race guard as finalise: re-read the row under UPDLOCK, re-assert
        -- the status the decision above was made on, guard the UPDATE itself
        -- with that status and check @@ROWCOUNT. The `IS NULL` arm is not
        -- decoration — `SELECT @v = col` leaves @v untouched when no row
        -- matches, and NULL <> 'final' is UNKNOWN, not TRUE, so a row deleted
        -- in the gap would otherwise fall straight through.
        -- @WonValue was read from this row before the transaction and is
        -- already on the lead by now; re-reading TaxableTotal here would buy
        -- nothing, because only sp_SaveQuotation writes the totals and it
        -- refuses anything that is not a draft — a row still 'final' under the
        -- lock has the same total it had a moment ago.
        IF @QuotationId IS NOT NULL
        BEGIN
            DECLARE @LockStatus VARCHAR(20);
            SELECT @LockStatus = Status FROM dbo.tblQuotation WITH (UPDLOCK)
            WHERE Id = @QuotationId AND CompId = @CompId AND LeadId = @LeadId;

            IF @LockStatus IS NULL OR @LockStatus <> 'final'
            BEGIN
                ROLLBACK TRANSACTION;
                SELECT @LeadId AS Id, 409 AS ResponseCode, 'Only a finalised quotation can be accepted' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN;
            END

            UPDATE dbo.tblQuotation
            SET Status = 'accepted', CustomerId = @CustomerId, ClosedAt = GETDATE(), ClosedBy = @UserId,
                CloseRemarks = @Remarks, EditBy = @UserId, UpdatedAt = GETDATE()
            WHERE Id = @QuotationId AND CompId = @CompId AND Status = 'final';

            IF @@ROWCOUNT = 0
            BEGIN
                ROLLBACK TRANSACTION;
                SELECT @LeadId AS Id, 409 AS ResponseCode, 'Only a finalised quotation can be accepted' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN;
            END
        END

        -- The sweep needs no re-read: the status it requires is in its own
        -- WHERE, so the test and the write are one atomic statement. Zero rows
        -- is a legitimate answer here (a lead won without a quotation), which
        -- is why this one is not @@ROWCOUNT-checked.
        UPDATE dbo.tblQuotation
        SET Status = 'unused', ClosedAt = GETDATE(), ClosedBy = @UserId,
            CloseRemarks = CASE WHEN @QuoteNo IS NOT NULL THEN N'Lead won on ' + @QuoteNo ELSE N'Lead won without a quotation' END
        WHERE CompId = @CompId AND LeadId = @LeadId AND Status IN ('draft','final')
          AND (@QuotationId IS NULL OR Id <> @QuotationId);

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));
        -- 500, matching sp_LogLeadActivity's own @Summary: a wider variable only
        -- moves the truncation to the EXEC, where it is invisible.
        DECLARE @Summary NVARCHAR(500) = N'Status: ' + @FromName + N' → ' + @ToName
                                        + N' · value ' + CAST(@WonValue AS NVARCHAR(30))
                                        + ISNULL(N' · ' + @QuoteNo, N'')
                                        + ISNULL(N' — ' + @Remarks, N'');
        DECLARE @Meta NVARCHAR(MAX) = (SELECT @FromStatusId AS fromStatusId, @WonStatusId AS toStatusId,
                                              @FromCode AS fromCode, 'converted' AS toCode,
                                              @WonValue AS wonValue, @QuotationId AS quotationId,
                                              @CustomerId AS customerId, @Remarks AS remarks
                                       FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
        INSERT INTO @actLog
        EXEC dbo.sp_LogLeadActivity @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId,
             @Type = 'status', @Summary = @Summary, @MetaJSON = @Meta;

        COMMIT TRANSACTION;
        SELECT @LeadId AS Id, 200 AS ResponseCode, 'Lead marked won' AS ResponseMess, @CustomerId AS CustomerId, @WonValue AS WonValue;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        -- 2601 / 2627: someone created a customer with this mobile a moment ago.
        IF ERROR_NUMBER() IN (2601, 2627)
            SELECT @LeadId AS Id, 409 AS ResponseCode, 'A customer with this mobile was just created — please try again' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue;
        ELSE
            SELECT @LeadId AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue;
    END CATCH
END
GO

-- 10. sp_Dashboard: ticket and call figures take their own (complaints) scope.
-- NOTE: numbers in the carried-over history comment below (e.g. '6.', '9.2', '7.1') are from earlier scripts, not 096 sections.
CREATE OR ALTER PROC dbo.sp_Dashboard
    @CompId                  BIGINT,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @UserId                  INT           = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL,
    @TicketBranchIdsJson     NVARCHAR(MAX) = NULL,   -- 096: ticket/call figures use the complaints scope
    @TicketOwnerIdsJson      NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @BranchIds TABLE (BranchId BIGINT PRIMARY KEY);
    DECLARE @OwnerIds  TABLE (OwnerId  BIGINT PRIMARY KEY);
    DECLARE @UseBranchScope BIT = 0, @UseOwnerScope BIT = 0;

    IF (@AccessibleBranchIdsJson IS NOT NULL AND LTRIM(RTRIM(@AccessibleBranchIdsJson)) <> '')
    BEGIN
        INSERT INTO @BranchIds (BranchId)
        SELECT DISTINCT CAST(value AS BIGINT) FROM OPENJSON(@AccessibleBranchIdsJson);
        SET @UseBranchScope = 1;
    END

    IF (@OwnerIdsJson IS NOT NULL AND LTRIM(RTRIM(@OwnerIdsJson)) <> '')
    BEGIN
        INSERT INTO @OwnerIds (OwnerId)
        SELECT DISTINCT CAST(value AS BIGINT) FROM OPENJSON(@OwnerIdsJson);
        SET @UseOwnerScope = 1;
    END

    DECLARE @TBranchIds TABLE (BranchId INT PRIMARY KEY);
    DECLARE @TOwnerIds  TABLE (OwnerId  INT PRIMARY KEY);
    DECLARE @UseTBranch BIT = 0, @UseTOwner BIT = 0;
    IF (@TicketBranchIdsJson IS NOT NULL AND @TicketBranchIdsJson <> '')
    BEGIN INSERT INTO @TBranchIds SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@TicketBranchIdsJson); SET @UseTBranch = 1; END
    IF (@TicketOwnerIdsJson IS NOT NULL AND @TicketOwnerIdsJson <> '')
    BEGIN INSERT INTO @TOwnerIds SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@TicketOwnerIdsJson); SET @UseTOwner = 1; END

    -- Legacy caller (no ticket lists at all): ticket/call figures use the lead lists, as before 096.
    IF @TicketBranchIdsJson IS NULL AND @TicketOwnerIdsJson IS NULL
    BEGIN
        INSERT INTO @TBranchIds SELECT BranchId FROM @BranchIds;
        INSERT INTO @TOwnerIds  SELECT OwnerId  FROM @OwnerIds;
        SET @UseTBranch = @UseBranchScope; SET @UseTOwner = @UseOwnerScope;
    END

    DECLARE @Today DATETIME = CAST(CAST(GETDATE() AS DATE) AS DATETIME);

    /* RS0 — KPI rows */
    SELECT 'WonMonth' AS Type, CAST(COUNT(*) AS DECIMAL(18,2)) AS Number
    FROM tblLeads l
    WHERE l.CompId = @CompId
      AND l.WonAt >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))
          )
    UNION ALL
    SELECT 'WonValueMonth', CAST(ISNULL(SUM(l.WonValue), 0) AS DECIMAL(18,2))
    FROM tblLeads l
    WHERE l.CompId = @CompId
      AND l.WonAt >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))
          )
    UNION ALL
    SELECT 'TotalLeads', COUNT(*)
    FROM tblLeads l
    WHERE l.CompId = @CompId
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))
          )

    UNION ALL

    SELECT 'TodayNewLeads', COUNT(*)
    FROM tblLeads l
    WHERE l.CompId = @CompId
      AND CAST(l.CreatedAt AS DATE) = CAST(GETDATE() AS DATE)
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))
          )

    UNION ALL

    SELECT 'TodayFollowups', COUNT(*)
    FROM tblFollowUp f
    JOIN tblLeads l ON l.Id = f.LeadId AND l.CompId = f.CompId
    JOIN tblLookup st ON st.Id = l.StatusId
    WHERE f.CompId = @CompId AND f.Status = 'open'
      AND CAST(f.DueAt AS DATE) = CAST(GETDATE() AS DATE)
      AND st.Code IN ('open','qualified')
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId IN (SELECT OwnerId FROM @OwnerIds) OR f.AssignedTo IN (SELECT OwnerId FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId OR f.AssignedTo = @UserId))
          )

    UNION ALL

    SELECT 'MissedFollowups', COUNT(*)
    FROM tblFollowUp f
    JOIN tblLeads l ON l.Id = f.LeadId AND l.CompId = f.CompId
    JOIN tblLookup st ON st.Id = l.StatusId
    WHERE f.CompId = @CompId AND f.Status = 'open'
      AND f.DueAt < @Today
      AND st.Code IN ('open','qualified')
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId IN (SELECT OwnerId FROM @OwnerIds) OR f.AssignedTo IN (SELECT OwnerId FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId OR f.AssignedTo = @UserId))
          );

    /* RS1 — leads per day, last 7 days */
    ;WITH days AS (
        SELECT DATEADD(DAY, -v.n, CAST(GETDATE() AS DATE)) AS D
        FROM (VALUES (6),(5),(4),(3),(2),(1),(0)) v(n)
    )
    SELECT LEFT(DATENAME(WEEKDAY, d.D), 3) AS Name,
           d.D AS [Date],
           (SELECT COUNT(*) FROM tblLeads l
             WHERE l.CompId = @CompId
               AND CAST(l.CreatedAt AS DATE) = d.D
               AND (
                     (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
                      AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
                  OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))
                   )) AS Leads,
           (SELECT COUNT(*) FROM tblLeads l
             WHERE l.CompId = @CompId
               AND CAST(l.WonAt AS DATE) = d.D
               AND (
                     (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
                      AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
                  OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))
                   )) AS Converted
    FROM days d
    ORDER BY d.D;

    /* RS2 — leads by source, top 5 + Other */
    ;WITH src AS (
        SELECT ISNULL(lk.Value, N'Unknown') AS Name,
               COUNT(*) AS Value,
               ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC) AS rn
        FROM tblLeads l
        LEFT JOIN tblLookup lk ON lk.Id = l.SourceId AND lk.CompId = l.CompId
        WHERE l.CompId = @CompId
          AND (
                (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
                 AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
             OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))
              )
        GROUP BY ISNULL(lk.Value, N'Unknown')
    )
    SELECT x.Name, x.Value
    FROM (
        SELECT Name, Value, rn FROM src WHERE rn <= 5
        UNION ALL
        SELECT N'Other', SUM(Value), 6 FROM src WHERE rn > 5 HAVING SUM(Value) > 0
    ) x
    ORDER BY x.rn;

    /* RS3 — funnel: leads per status (scope lives in the LEFT JOIN's ON, so
       an out-of-scope lead drops out without dropping the status row) */
    SELECT st.Value AS Name, COUNT(l.Id) AS Value, st.SortOrder
    FROM tblLookup st
    LEFT JOIN tblLeads l
           ON l.StatusId = st.Id AND l.CompId = @CompId
          AND (
                (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
                 AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
             OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))
              )
    WHERE st.CompId = @CompId AND st.Kind = 'lead_status' AND st.IsActive = 1
    GROUP BY st.Id, st.Value, st.SortOrder
    ORDER BY st.SortOrder;

    /* RS4 — team load: active leads per owner, top 5 */
    SELECT TOP 5 u.FullName AS Name, COUNT(*) AS Value
    FROM tblLeads l
    JOIN tblUser u ON u.Id = l.OwnerId AND u.IsActive = 1
    JOIN tblLookup st ON st.Id = l.StatusId
    WHERE l.CompId = @CompId
      AND st.Code IN ('open','qualified')
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))
          )
    GROUP BY u.Id, u.FullName
    ORDER BY Value DESC;

    /* RS5 — activity per quarter, current year */
    ;WITH q AS (SELECT v.n FROM (VALUES (1),(2),(3),(4)) v(n))
    SELECT 'Q' + CAST(q.n AS VARCHAR(1)) AS Name,
           (SELECT COUNT(*) FROM tblLeads l
             WHERE l.CompId = @CompId
               AND YEAR(l.CreatedAt) = YEAR(GETDATE())
               AND DATEPART(QUARTER, l.CreatedAt) = q.n
               AND (
                     (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
                      AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
                  OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))
                   )) AS Leads,
           (SELECT COUNT(*) FROM tblFollowUp f
              JOIN tblLeads bl ON bl.Id = f.LeadId AND bl.CompId = f.CompId
             WHERE f.CompId = @CompId AND f.Type = 'call' AND f.Status = 'done'
               AND YEAR(f.DoneAt) = YEAR(GETDATE())
               AND DATEPART(QUARTER, f.DoneAt) = q.n
               AND (
                     (    (@UseBranchScope = 0 OR bl.BranchId IN (SELECT BranchId FROM @BranchIds))
                      AND (@UseOwnerScope  = 0 OR bl.OwnerId IN (SELECT OwnerId FROM @OwnerIds) OR f.AssignedTo IN (SELECT OwnerId FROM @OwnerIds)) )
                  OR (@UserId IS NOT NULL AND (bl.OwnerId = @UserId OR bl.CreatedBy = @UserId OR f.AssignedTo = @UserId))
                   ))
           + (SELECT COUNT(*) FROM tblCall c
               JOIN tblTicket bt ON bt.Id = c.TicketId AND bt.CompId = c.CompId
              WHERE c.CompId = @CompId
                AND YEAR(c.CalledAt) = YEAR(GETDATE())
                AND DATEPART(QUARTER, c.CalledAt) = q.n
                AND (
                      (    (@UseTBranch = 0 OR bt.BranchId   IN (SELECT BranchId FROM @TBranchIds))
                       AND (@UseTOwner  = 0 OR bt.AssignedTo IN (SELECT OwnerId  FROM @TOwnerIds)) )
                   OR (@UserId IS NOT NULL AND (bt.AssignedTo = @UserId OR bt.CreatedBy = @UserId))
                    )) AS Calls,
           (SELECT COUNT(*) FROM tblTicket t
             WHERE t.CompId = @CompId
               AND YEAR(t.CreatedAt) = YEAR(GETDATE())
               AND DATEPART(QUARTER, t.CreatedAt) = q.n
               AND (
                     (    (@UseTBranch = 0 OR t.BranchId   IN (SELECT BranchId FROM @TBranchIds))
                      AND (@UseTOwner  = 0 OR t.AssignedTo IN (SELECT OwnerId  FROM @TOwnerIds)) )
                  OR (@UserId IS NOT NULL AND (t.AssignedTo = @UserId OR t.CreatedBy = @UserId))
                   )) AS Tickets
    FROM q
    ORDER BY q.n;
END
GO

-- 11. sp_SaveUser: ReportsTo NULL = keep / 0 = clear; non-admin actor cannot touch admins.
-- NOTE: numbers in the carried-over history comment below (e.g. '6.', '9.2', '7.1') are from earlier scripts, not 096 sections.
-- ===========================================================================
-- D·S2. sp_SaveUser — role required, branch, admin from group, deactivation releases tasks, last-admin guard (items 16-19)
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- 9.2 sp_SaveUser — +@ReportsTo (defaults NULL; old callers unaffected)
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_SaveUser
    @Id INT,
    @Username VARCHAR(100),
    @Password VARCHAR(500),
    @UserActive BIT,
    @IsAdmin BIT = NULL,             -- ignored since 094: admin comes from the group
    @UserIp VARCHAR(50),
    @AllowDay INT,
    @FullName VARCHAR(200),
    @Email VARCHAR(150),
    @JobTitle VARCHAR(100),
    @HourlyRate DECIMAL(10,2),
    @GroupId INT,
    @CompId BIGINT,
    @BranchId BIGINT = NULL,         -- NULL on edit = keep the current branch (094)
    @Mobile VARCHAR(20) = NULL,
    @ReportsTo INT = NULL,
    @ActorUserId INT = NULL,         -- who is saving (094)
    @ActorIsAdmin BIT = NULL         -- 096: Node passes req.scope.isAdmin; NULL = legacy caller (admin-only route)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);

    IF (@Username IS NULL OR LTRIM(RTRIM(@Username)) = '')
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Username is required and cannot be blank';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- A new user needs a password. An edit may omit it to keep the current one.
    IF (@Id = 0 AND (@Password IS NULL OR LTRIM(RTRIM(@Password)) = ''))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Password is required and cannot be blank';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@FullName IS NULL OR LTRIM(RTRIM(@FullName)) = '')
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Full name is required and cannot be blank';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- Normalize blanks to NULL so filtered-unique indexes ignore them.
    IF (@Mobile IS NOT NULL AND LTRIM(RTRIM(@Mobile)) = '') SET @Mobile = NULL;
    IF (@Email  IS NOT NULL AND LTRIM(RTRIM(@Email))  = '') SET @Email  = NULL;
    -- NULL = keep the current manager; 0 = clear it (spec 2026-10-07 §6).
    DECLARE @ClearReportsTo BIT = CASE WHEN @ReportsTo IS NOT NULL AND @ReportsTo <= 0 THEN 1 ELSE 0 END;
    IF @ClearReportsTo = 1 SET @ReportsTo = NULL;

    IF (@Id > 0 AND @UserActive = 0 AND @Id = @ActorUserId)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'You cannot deactivate your own account';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- No default group (094): the old ELSE SET @GroupId = 8 pointed at a group
    -- that does not exist. A role is required, and it must be this company's.
    IF (@GroupId IS NULL OR @GroupId <= 0
        OR NOT EXISTS (SELECT 1 FROM tblUserGroups WHERE Id = @GroupId AND CompId = @CompId AND IsActive = 1))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Pick an active role for this user';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- A non-admin (HR with people.edit) may not mint or touch an admin.
    IF @ActorIsAdmin = 0   -- NULL (legacy caller) skips the guard
    BEGIN
        IF EXISTS (SELECT 1 FROM tblUserGroups WHERE Id = @GroupId AND IsAdmin = 1)
        BEGIN SET @ResponseCode = 403; SET @ResponseMess = 'Only an administrator can give the admin role';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
        IF @Id > 0 AND EXISTS (SELECT 1 FROM tblUserGroupMap m JOIN tblUserGroups g ON g.Id = m.GroupId
                               WHERE m.UserId = @Id AND g.IsAdmin = 1 AND g.IsActive = 1)
        BEGIN SET @ResponseCode = 403; SET @ResponseMess = 'Only an administrator can edit an administrator';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    END

    IF (@Id = 0 AND @BranchId IS NULL)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Branch is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    IF (@BranchId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tblBranch WHERE Id = @BranchId))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid branch';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- tblUser.IsAdmin is a mirror of the role, never taken from the form (094).
    DECLARE @GroupIsAdmin BIT = (SELECT IsAdmin FROM tblUserGroups WHERE Id = @GroupId);

    -- Never deactivate the last active admin, nor move them into a non-admin
    -- role: either way nobody would be left to undo it.
    IF (@Id > 0 AND (@UserActive = 0 OR ISNULL(@GroupIsAdmin, 0) = 0)
        AND EXISTS (SELECT 1 FROM tblUser u
                      JOIN tblUserGroupMap m ON m.UserId = u.Id
                      JOIN tblUserGroups g ON g.Id = m.GroupId AND g.IsActive = 1 AND g.IsAdmin = 1
                     WHERE u.Id = @Id AND u.CompId = @CompId AND u.IsActive = 1)
        AND NOT EXISTS (SELECT 1 FROM tblUser u
                          JOIN tblUserGroupMap m ON m.UserId = u.Id
                          JOIN tblUserGroups g ON g.Id = m.GroupId AND g.IsActive = 1 AND g.IsAdmin = 1
                         WHERE u.CompId = @CompId AND u.IsActive = 1 AND u.Id <> @Id))
    BEGIN SET @ResponseCode = 409;
          SET @ResponseMess = 'This is the last active admin. Make someone else an admin before deactivating them or changing their role.';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- Reporting line: must be a colleague, not self, and must not loop.
    IF @ReportsTo IS NOT NULL
    BEGIN
        IF @ReportsTo = @Id
        BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'A user cannot report to themselves';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
        IF NOT EXISTS (SELECT 1 FROM tblUser WHERE Id = @ReportsTo AND CompId = @CompId)
        BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Reports To must be a user in this company';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

        DECLARE @cur INT = @ReportsTo, @hops INT = 0;
        WHILE @cur IS NOT NULL AND @hops < 20
        BEGIN
            IF @cur = @Id
            BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Reporting line would loop back to this user';
                  SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
            SET @cur = (SELECT ReportsTo FROM tblUser WHERE Id = @cur AND CompId = @CompId);
            SET @hops += 1;
        END
    END

    -- Login keys are GLOBAL (not per-company) -- a friendly 409 before the
    -- unique index would throw a raw error.
    IF EXISTS (SELECT 1 FROM tblUser WHERE Username = @Username AND Id <> @Id)
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Username already exists';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    IF (@Email IS NOT NULL AND EXISTS (SELECT 1 FROM tblUser WHERE Email = @Email AND Id <> @Id))
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Email already in use';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    IF (@Mobile IS NOT NULL AND EXISTS (SELECT 1 FROM tblUser WHERE Mobile = @Mobile AND Id <> @Id))
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Mobile already in use';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    DECLARE @WasActive BIT;
    -- Boards where a deactivated user held open work (094): returned as the
    -- 2nd result set so the caller can refresh those boards and owners.
    DECLARE @Released TABLE (WorkspaceId BIGINT PRIMARY KEY, OwnerUserId INT, TaskCount INT);

    BEGIN TRY
        BEGIN TRANSACTION;

        IF (@Id = 0)
        BEGIN
            INSERT INTO tblUser
                (Username, Password, IsActive, IsAdmin, UserIp, AllowDay,
                 FullName, Email, JobTitle, HourlyRate, Mobile, CompId, BranchId, ReportsTo)
            VALUES
                (@Username, @Password, @UserActive, @GroupIsAdmin, @UserIp, @AllowDay,
                 @FullName, @Email, @JobTitle, @HourlyRate, @Mobile, @CompId, @BranchId, @ReportsTo);

            SET @Id = SCOPE_IDENTITY();

            INSERT INTO tblUserGroupMap (UserId, GroupId) VALUES (@Id, @GroupId);

            COMMIT TRANSACTION;

            SET @ResponseCode = 201;
            SET @ResponseMess = 'User created successfully';

            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @Id AS UserId, @GroupId AS AssignedGroupId;
        END
        ELSE
        BEGIN
            SELECT @WasActive = IsActive FROM tblUser WHERE Id = @Id AND CompId = @CompId;
            IF (@WasActive IS NULL)
            BEGIN
                ROLLBACK TRANSACTION;
                SET @ResponseCode = 404; SET @ResponseMess = 'User not found';
                SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
            END

            UPDATE tblUser
               SET Username = @Username, IsActive = @UserActive,
                   IsAdmin = @GroupIsAdmin, UserIp = @UserIp, AllowDay = @AllowDay,
                   FullName = @FullName, Email = @Email, JobTitle = @JobTitle,
                   HourlyRate = @HourlyRate, Mobile = @Mobile,
                   ReportsTo = CASE WHEN @ClearReportsTo = 1 THEN NULL ELSE ISNULL(@ReportsTo, ReportsTo) END,
                   BranchId = ISNULL(@BranchId, BranchId),
                   -- Password only when a new hash is supplied; blank means
                   -- "keep current" (same contract as sp_UpdateOwnProfile).
                   Password = CASE WHEN @Password IS NOT NULL AND LEN(@Password) > 0
                                   THEN @Password ELSE Password END
             WHERE Id = @Id AND CompId = @CompId;

            DELETE FROM tblUserGroupMap WHERE UserId = @Id;
            INSERT INTO tblUserGroupMap (UserId, GroupId) VALUES (@Id, @GroupId);

            -- Deactivation releases their open tasks (spec items 5/16, 094): one
            -- rule in one place, sp_UnassignInvalidAssignees, run per board the
            -- user holds open work on. Plain EXEC — it uses INSERT...EXEC itself.
            IF (@WasActive = 1 AND @UserActive = 0)
            BEGIN
                INSERT INTO @Released (WorkspaceId, OwnerUserId, TaskCount)
                SELECT w.Id, w.OwnerUserId, COUNT(DISTINCT t.Id)
                  FROM dbo.tblTaskAssignee a
                  JOIN dbo.tblTasks      t ON t.Id = a.TaskId
                  JOIN dbo.tblWorkspaces w ON w.Id = t.WorkspaceId
                 WHERE a.UserId = @Id
                   AND w.CompId = @CompId
                   AND w.Type IN ('shared', 'project')
                   AND t.IsCompleted = 0
                   AND t.IsDeleted = 0
                 GROUP BY w.Id, w.OwnerUserId;

                DECLARE @RelWs BIGINT = (SELECT MIN(WorkspaceId) FROM @Released);
                WHILE (@RelWs IS NOT NULL)
                BEGIN
                    EXEC dbo.sp_UnassignInvalidAssignees
                         @WorkspaceId = @RelWs, @ActorUserId = @ActorUserId, @CompId = @CompId;
                    SET @RelWs = (SELECT MIN(WorkspaceId) FROM @Released WHERE WorkspaceId > @RelWs);
                END
            END

            COMMIT TRANSACTION;

            SET @ResponseCode = 200;
            SET @ResponseMess = 'User updated successfully';

            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @Id AS UserId, @GroupId AS AssignedGroupId;
            -- 2nd result set (094): boards whose open tasks this save released.
            SELECT WorkspaceId, OwnerUserId, TaskCount FROM @Released;
        END
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SET @ResponseCode = 500;
        SET @ResponseMess = ERROR_MESSAGE();
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END CATCH
END
GO

-- 12. VERIFY AFTER APPLY (read-only):
-- SELECT g.Name, gm.Module, gm.CanView, gm.CanAdd, gm.CanEdit, gm.CanDelete, gm.Reach
--   FROM tblGroupModule gm JOIN tblUserGroups g ON g.Id = gm.GroupId ORDER BY g.Name, gm.Module;
--   -> HR Manager has NO leads / complaints / customers / sales_reports / support_reports rows.
-- SELECT Route, Module FROM tblMenu ORDER BY Module;           -> no leaf with NULL Module except parents
-- EXEC sp_FetchUserAccess @UserId = <an executive>, @CompId = 1;  -> 4 result sets
-- EXEC sp_ValidateUser ... (log in through the app) -> same sidebar as before for Owner
-- SELECT name FROM sys.indexes WHERE name = 'UX_tblCustomer_Branch_Mobile';  -> 1 row
-- Nothing reads tblGroupAccess any more except sp_FetchGroupAccess / sp_SaveGroupAccess /
-- sp_CheckMenuRight (unused); a later cleanup script drops them with the table.
