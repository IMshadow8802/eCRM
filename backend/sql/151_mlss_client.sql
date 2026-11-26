-- 151_mlss_client.sql — new client MLSS (Manohar Lal Sarraf & Sons Jewellers): calling only.
--
-- Creates database [MLSS] as a copy of [OSG] (a near-empty client: schema with 149,
-- menus, lookups, 1 office, 2 users), then turns it into MLSS:
--   * OSG's records go (12 visiting cards, notifications, sessions, presence days);
--   * sidebar = calling only. Super is an admin, and an admin sees every tblMenu row
--     whatever the grants, so the other rows are deleted (115 pattern). What stays:
--     Sales > Leads, Follow-ups, Calling Lists, Do not call · Sales Reports > Calling ·
--     Admin > Users;
--   * roles: Owner/Admin stay; new "Caller" = leads view/add/edit, Own (calling is part
--     of leads add; a turned lead stays with its caller). OSG's Manager / Sales
--     Executive / Support Team Lead go;
--   * users: Super (Owner, admin) + caller1..caller4 "Calling Employee 1..4" (Caller,
--     report to Super). Super edits them and adds more from Admin > Users;
--   * no attendance warnings: NotifyNotSignedIn = 0, everyone PresenceExempt;
--   * Central: company code MLSS, ECRM_ADMIN + ECRM_EMP -> https://shadowcodes.in/MLSSCRM
--     (MLSS's ESTIMATE / KITTY rows are left alone).
-- Password hashes (bcrypt, cost 12) are in the applied copy only — never commit this
-- file with them. [OSG] is only read (BACKUP ... COPY_ONLY).
--
-- Run ONCE, against master:
--   sqlcmd ... -d master -C -b -I -i sql/151_mlss_client.sql
-- Re-running is safe: the restore is skipped if MLSS exists, every later step is
-- guarded. To start over: DROP DATABASE [MLSS], then run again.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF DB_ID(N'MLSS') IS NOT NULL
BEGIN
    RAISERROR(N'MLSS already exists - nothing restored.', 10, 1);
END
ELSE
BEGIN
    BACKUP DATABASE [OSG] TO DISK = N'OSG_for_MLSS.bak'
        WITH COPY_ONLY, INIT, FORMAT;

    RESTORE DATABASE [MLSS] FROM DISK = N'OSG_for_MLSS.bak'
        WITH MOVE N'SolarCRM'     TO N'C:\Program Files\Microsoft SQL Server\MSSQL15.MSSQLSERVER\MSSQL\DATA\MLSS_CRM.mdf',
             MOVE N'SolarCRM_log' TO N'C:\Program Files\Microsoft SQL Server\MSSQL15.MSSQLSERVER\MSSQL\DATA\MLSS_CRM_log.ldf',
             RECOVERY;
END
GO

USE [MLSS];
GO
IF DB_NAME() <> N'MLSS'
BEGIN
    RAISERROR(N'151: not on MLSS - nothing changed.', 16, 1);
    SET NOEXEC ON;
END
GO

SET XACT_ABORT ON;
BEGIN TRAN;

-- OSG's records.
DELETE FROM dbo.tblVisitingCard;
DELETE FROM dbo.tblNotifications;
DELETE FROM dbo.tblUserSession;
DELETE FROM dbo.tblPresenceDay;
DELETE FROM dbo.tblActivityLog;
DELETE FROM dbo.tblAccessModelBackup;

UPDATE dbo.tblBranch SET Address = NULL WHERE Id = 1;

-- Sidebar: calling only.
DECLARE @Keep TABLE (Id INT PRIMARY KEY);
INSERT INTO @Keep (Id)
SELECT Id FROM dbo.tblMenu
WHERE Route IN ('/sales', '/sales/leads', '/sales/follow-ups', '/sales/calling-lists', '/sales/do-not-call',
                '/reports/sales/calling', '/admin', '/users')
   OR (ParentId = 0 AND Description = 'Sales Reports');
DELETE FROM dbo.tblGroupAccess WHERE MenuId NOT IN (SELECT Id FROM @Keep);
DELETE FROM dbo.tblMenu WHERE Id NOT IN (SELECT Id FROM @Keep);

-- Roles.
IF NOT EXISTS (SELECT 1 FROM dbo.tblUserGroups WHERE Name = N'Caller')
    INSERT INTO dbo.tblUserGroups (Name, Description, IsActive, CompId, BranchId, CreatedDate, HierarchyLevel, IsAdmin, CanSeeSensitive)
    VALUES (N'Caller', N'Calls the contacts handed to them; keeps the leads they turn up', 1, 1, 1, GETDATE(), 5, 0, 0);
DECLARE @Caller INT = (SELECT Id FROM dbo.tblUserGroups WHERE Name = N'Caller');
DECLARE @Owner  INT = (SELECT Id FROM dbo.tblUserGroups WHERE Name = N'Owner' AND IsAdmin = 1);

DELETE FROM dbo.tblGroupModule WHERE GroupId = @Caller;
INSERT INTO dbo.tblGroupModule (GroupId, Module, CanView, CanAdd, CanEdit, CanDelete, Reach)
VALUES (@Caller, 'leads', 1, 1, 1, 0, 'Own');

-- Users. OSG's two are repurposed rather than deleted (FKs): 2 -> Super, 27 -> caller1.
UPDATE dbo.tblUser
SET Username = N'Super', FullName = N'Super', Email = NULL, Mobile = NULL, JobTitle = N'Owner',
    Password = N'<bcrypt hash - applied 2026-11-26, not kept in the repo>', IsActive = 1, IsAdmin = 1, BranchId = 1, ReportsTo = NULL, PresenceExempt = 1
WHERE Id = 2;
DELETE FROM dbo.tblUserGroupMap WHERE UserId = 2;
INSERT INTO dbo.tblUserGroupMap (UserId, GroupId) VALUES (2, @Owner);

UPDATE dbo.tblUser
SET Username = N'caller1', FullName = N'Calling Employee 1', Email = NULL, Mobile = NULL, JobTitle = N'Caller',
    Password = N'<bcrypt hash - applied 2026-11-26, not kept in the repo>', IsActive = 1, IsAdmin = 0, BranchId = 1, ReportsTo = 2, PresenceExempt = 1
WHERE Id = 27;
DELETE FROM dbo.tblUserGroupMap WHERE UserId = 27;
INSERT INTO dbo.tblUserGroupMap (UserId, GroupId) VALUES (27, @Caller);

DECLARE @n INT = 2, @Id INT;
WHILE @n <= 4
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Username = CONCAT(N'caller', @n))
    BEGIN
        INSERT INTO dbo.tblUser (Username, Password, IsActive, IsAdmin, FullName, JobTitle, CompId, BranchId, CreatedDate, ReportsTo, PresenceExempt)
        VALUES (CONCAT(N'caller', @n), N'<bcrypt hash - applied 2026-11-26, not kept in the repo>', 1, 0, CONCAT(N'Calling Employee ', @n), N'Caller', 1, 1, GETDATE(), 2, 1);
        SET @Id = SCOPE_IDENTITY();
        INSERT INTO dbo.tblUserGroupMap (UserId, GroupId) VALUES (@Id, @Caller);
    END
    SET @n += 1;
END

-- OSG's roles, now held by nobody.
DECLARE @Gone TABLE (Id INT PRIMARY KEY);
INSERT INTO @Gone (Id)
SELECT g.Id FROM dbo.tblUserGroups g
WHERE g.IsAdmin = 0 AND g.Id <> @Caller
  AND NOT EXISTS (SELECT 1 FROM dbo.tblUserGroupMap m WHERE m.GroupId = g.Id);
DELETE FROM dbo.tblGroupAccess WHERE GroupId IN (SELECT Id FROM @Gone);
DELETE FROM dbo.tblGroupModule WHERE GroupId IN (SELECT Id FROM @Gone);
DELETE FROM dbo.tblUserGroups  WHERE Id      IN (SELECT Id FROM @Gone);

-- No attendance warnings.
UPDATE dbo.tblCompanySetting SET NotifyNotSignedIn = 0, UpdatedAt = GETDATE();

COMMIT;
GO
SET NOEXEC OFF;
GO

-- Central: company code MLSS -> the MLSS backend (web + phone app).
IF NOT EXISTS (SELECT 1 FROM PRDInfotech.dbo.tblCompURL WHERE CompCode = 'MLSS' AND AppType IN ('ECRM_ADMIN', 'ECRM_EMP'))
    INSERT INTO PRDInfotech.dbo.tblCompURL
        (Company, Location, ActivationDate, IsActive, Ref, CompCode, AppType, BaseURL, LogoURL, PrimaryColor)
    VALUES
        ('Manohar Lal Sarraf & Sons Jewellers', 'South Ex', GETDATE(), 1, '', 'MLSS', 'ECRM_ADMIN', 'https://shadowcodes.in/MLSSCRM', 'https://prdinfotech.in/api/BholaJewl/Uploads/MLSS_Logo.png', ''),
        ('Manohar Lal Sarraf & Sons Jewellers', 'South Ex', GETDATE(), 1, '', 'MLSS', 'ECRM_EMP',   'https://shadowcodes.in/MLSSCRM', 'https://prdinfotech.in/api/BholaJewl/Uploads/MLSS_Logo.png', '');
GO

-- VERIFY AFTER APPLY:
-- SELECT name, state_desc FROM sys.databases WHERE name = 'MLSS';                                  -- ONLINE
-- SELECT u.Username, u.FullName, g.Name, g.IsAdmin, u.ReportsTo FROM [MLSS].dbo.tblUser u
--   JOIN [MLSS].dbo.tblUserGroupMap m ON m.UserId = u.Id JOIN [MLSS].dbo.tblUserGroups g ON g.Id = m.GroupId;
--                                     -- Super/Owner/1, caller1..caller4/Caller/0 reporting to 2
-- SELECT Id, Name, IsAdmin FROM [MLSS].dbo.tblUserGroups;                                        -- Owner, Admin, Caller
-- SELECT Description, Route FROM [MLSS].dbo.tblMenu ORDER BY ParentId, SortOrder;                -- 9 rows
-- SELECT COUNT(*) FROM [MLSS].dbo.tblVisitingCard;                                               -- 0
-- SELECT CompCode, AppType, BaseURL FROM PRDInfotech.dbo.tblCompURL WHERE CompCode = 'MLSS';    -- + 2 ECRM rows
