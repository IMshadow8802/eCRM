-- 117_osg_roles_cleanup.sql — OSG: only the roles OSG uses.
--
-- 116 switched the 10 template roles copied from SolarCRM off (IsActive = 0),
-- but the user form still lists them, and picking one ("Sales Executive" =
-- leads/customers/tasks) is refused for Super ("You can only give roles within
-- your own access"). Remove them outright — no one holds them — and rename
-- "Card scanner" to "Sales Executive", which is what OSG's staff are.
-- Owner/Admin stay (Super cannot hand them out; the server refuses).
--
-- Run against OSG ONLY:
--   sqlcmd ... -d OSG -C -b -I -i sql/117_osg_roles_cleanup.sql
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF DB_NAME() <> N'OSG'
BEGIN
    RAISERROR(N'117 is for OSG only - nothing changed.', 16, 1);
    SET NOEXEC ON;
END
GO

SET XACT_ABORT ON;
BEGIN TRAN;

DECLARE @Gone TABLE (Id INT PRIMARY KEY);
INSERT INTO @Gone (Id)
SELECT g.Id FROM dbo.tblUserGroups g
WHERE g.IsActive = 0 AND g.IsAdmin = 0
  AND NOT EXISTS (SELECT 1 FROM dbo.tblUserGroupMap m WHERE m.GroupId = g.Id);

DELETE FROM dbo.tblGroupAccess WHERE GroupId IN (SELECT Id FROM @Gone);
DELETE FROM dbo.tblGroupModule WHERE GroupId IN (SELECT Id FROM @Gone);
DELETE FROM dbo.tblUserGroups  WHERE Id      IN (SELECT Id FROM @Gone);

UPDATE dbo.tblUserGroups
SET Name = N'Sales Executive', Description = N'Scans cards in VisiScan; sees only own cards'
WHERE Name = N'Card scanner';

COMMIT;
GO
SET NOEXEC OFF;
GO

-- VERIFY AFTER APPLY (expect Owner, Admin, Manager, Sales Executive):
-- SELECT Id, Name, IsActive, IsAdmin FROM [OSG].dbo.tblUserGroups ORDER BY Id;
