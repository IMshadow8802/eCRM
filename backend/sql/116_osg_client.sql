-- 116_osg_client.sql — new client OSG India: visiting cards + users only.
--
-- Creates database [OSG] as a copy of [SolarCRM] (a clean client: schema, menus,
-- lookups, 1 office, 1 user, no data), then turns it into OSG:
--   * office "Head Office" gets OSG's registered address;
--   * two roles: "Manager" (NOT admin — an admin sees every module): people
--     view/add/edit Company + sees mobiles/emails, cards view/add/delete Company
--     (company details stay admin-only: saving an office is requireAdmin); "Card scanner": cards view/add/delete Own;
--   * the 10 unused template roles are switched off (IsActive = 0);
--   * Solar's only user becomes "Super" (Manager), plus user "Test" (Card scanner,
--     reports to Super). Passwords were given by the user in chat; their bcrypt
--     hashes (cost 12, utils/encryption.js) were in the applied copy, removed here;
--   * Central: company code OSG -> https://shadowcodes.in/OSG (admin + employee app).
-- [SolarCRM] is only read (BACKUP ... COPY_ONLY does not touch its backup chain).
--
-- Run ONCE, against master:
--   sqlcmd ... -d master -C -b -I -i sql/116_osg_client.sql
-- Re-running is safe: the restore is skipped if OSG exists, and every later
-- step is guarded. To start over: DROP DATABASE [OSG], then run again.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF DB_ID(N'OSG') IS NOT NULL
BEGIN
    RAISERROR(N'OSG already exists - nothing restored.', 10, 1);
END
ELSE
BEGIN
    BACKUP DATABASE [SolarCRM] TO DISK = N'SolarCRM_for_OSG.bak'
        WITH COPY_ONLY, INIT, FORMAT;

    RESTORE DATABASE [OSG] FROM DISK = N'SolarCRM_for_OSG.bak'
        WITH MOVE N'SolarCRM'     TO N'C:\Program Files\Microsoft SQL Server\MSSQL15.MSSQLSERVER\MSSQL\DATA\OSG.mdf',
             MOVE N'SolarCRM_log' TO N'C:\Program Files\Microsoft SQL Server\MSSQL15.MSSQLSERVER\MSSQL\DATA\OSG_log.ldf',
             RECOVERY;
END
GO

USE [OSG];
GO

SET XACT_ABORT ON;
BEGIN TRAN;

-- Company details live on the office (Offices screen).
UPDATE dbo.tblBranch
SET Address = N'Plot 6, Sector 8, IMT Manesar, Gurgaon 122050'  -- column is NVARCHAR(50)
WHERE Id = 1;

-- Roles.
IF NOT EXISTS (SELECT 1 FROM dbo.tblUserGroups WHERE Name = N'Manager')
    INSERT INTO dbo.tblUserGroups (Name, Description, IsActive, CompId, BranchId, CreatedDate, HierarchyLevel, IsAdmin, CanSeeSensitive)
    VALUES (N'Manager', N'Creates users and sees every visiting card', 1, 1, 1, GETDATE(), 2, 0, 1);
IF NOT EXISTS (SELECT 1 FROM dbo.tblUserGroups WHERE Name = N'Card scanner')
    INSERT INTO dbo.tblUserGroups (Name, Description, IsActive, CompId, BranchId, CreatedDate, HierarchyLevel, IsAdmin, CanSeeSensitive)
    VALUES (N'Card scanner', N'Scans cards in VisiScan; sees only own cards', 1, 1, 1, GETDATE(), 5, 0, 0);

DECLARE @Manager INT = (SELECT Id FROM dbo.tblUserGroups WHERE Name = N'Manager');
DECLARE @Scanner INT = (SELECT Id FROM dbo.tblUserGroups WHERE Name = N'Card scanner');

DELETE FROM dbo.tblGroupModule WHERE GroupId IN (@Manager, @Scanner);
INSERT INTO dbo.tblGroupModule (GroupId, Module, CanView, CanAdd, CanEdit, CanDelete, Reach) VALUES
    (@Manager, 'people',  1, 1, 1, 0, 'Company'),
    (@Manager, 'cards',   1, 1, 0, 1, 'Company'),  -- add too: a non-admin may only hand out roles within its own access, and Card scanner adds
    (@Scanner, 'cards',   1, 1, 0, 1, 'Own');

-- Template roles nobody here uses: off, not deleted (legacy tables reference them).
UPDATE dbo.tblUserGroups SET IsActive = 0
WHERE Id NOT IN (@Manager, @Scanner) AND IsAdmin = 0 AND IsActive = 1;

-- Users. Solar's one user (Id 2) is repurposed rather than deleted (FKs).
UPDATE dbo.tblUser
SET Username = N'Super', FullName = N'Super', Email = NULL, Mobile = NULL, JobTitle = N'Manager',
    Password = N'<bcrypt hash - applied 2026-10-22, not kept in the repo>', IsActive = 1, IsAdmin = 0, BranchId = 1, ReportsTo = NULL
WHERE Id = 2 AND Username <> N'Super';
DELETE FROM dbo.tblUserGroupMap WHERE UserId = 2;
INSERT INTO dbo.tblUserGroupMap (UserId, GroupId) VALUES (2, @Manager);

IF NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Username = N'Test')
BEGIN
    INSERT INTO dbo.tblUser (Username, Password, IsActive, IsAdmin, FullName, JobTitle, CompId, BranchId, CreatedDate, ReportsTo)
    VALUES (N'Test', N'<bcrypt hash - applied 2026-10-22, not kept in the repo>', 1, 0, N'Test', N'Card scanner', 1, 1, GETDATE(), 2);
    INSERT INTO dbo.tblUserGroupMap (UserId, GroupId) VALUES (SCOPE_IDENTITY(), @Scanner);
END

-- The Visiting Cards menu. SolarCRM lost it in 115 (run before this copy was
-- taken), so put it back here — same row 114 adds.
IF NOT EXISTS (SELECT 1 FROM dbo.tblMenu WHERE Route = '/sales/visiting-cards')
    INSERT INTO dbo.tblMenu (ParentId, Description, MenuType, FormId, ActualId, IsAllowed, Route, Module, SortOrder)
    SELECT p.Id, 'Visiting Cards', 1, 0, 0, 1, '/sales/visiting-cards', 'cards',
           ISNULL((SELECT MAX(SortOrder) FROM dbo.tblMenu m WHERE m.ParentId = p.Id), 0) + 1
    FROM dbo.tblMenu p WHERE p.Route = '/sales' AND p.ParentId = 0;

COMMIT;
GO

-- Central: company code OSG -> the OSG backend (web + VisiScan / employee app).
IF NOT EXISTS (SELECT 1 FROM PRDInfotech.dbo.tblCompURL WHERE CompCode = 'OSG')
    INSERT INTO PRDInfotech.dbo.tblCompURL
        (Company, Location, ActivationDate, IsActive, Ref, CompCode, AppType, BaseURL, LogoURL, PrimaryColor)
    VALUES
        ('OSG (INDIA) PVT. LTD.', 'Gurgaon', GETDATE(), 1, '', 'OSG', 'ECRM_ADMIN', 'https://shadowcodes.in/OSG', '', ''),
        ('OSG (INDIA) PVT. LTD.', 'Gurgaon', GETDATE(), 1, '', 'OSG', 'ECRM_EMP',   'https://shadowcodes.in/OSG', '', '');
GO

-- VERIFY AFTER APPLY:
-- SELECT name, state_desc FROM sys.databases WHERE name = 'OSG';                       -- ONLINE
-- SELECT u.Username, g.Name, g.IsAdmin FROM [OSG].dbo.tblUser u
--   JOIN [OSG].dbo.tblUserGroupMap m ON m.UserId = u.Id JOIN [OSG].dbo.tblUserGroups g ON g.Id = m.GroupId;  -- Super/Manager/0, Test/Card scanner/0
-- SELECT g.Name, gm.Module, gm.Reach FROM [OSG].dbo.tblGroupModule gm JOIN [OSG].dbo.tblUserGroups g ON g.Id = gm.GroupId
--   WHERE g.Name IN ('Manager','Card scanner');                                          -- 3 rows
-- SELECT CompCode, AppType, BaseURL FROM PRDInfotech.dbo.tblCompURL WHERE CompCode = 'OSG';  -- 2 rows
