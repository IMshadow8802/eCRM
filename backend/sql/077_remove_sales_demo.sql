-- ============================================================================
-- 077_remove_sales_demo.sql — undo 076 completely
--
-- Leads named 'DEMO %' and every child row, the two 'DEMO %' products, the
-- four 'demo_%' users and their group/branch rows. Real data untouched.
-- Standalone and idempotent: it does not need 076's temp tables and may be
-- run twice. Children go before parents.
-- APPLY BY HAND when the demo data is no longer wanted.
-- Author: Claude  Date: 2026-09-10
-- ============================================================================
SET NOCOUNT ON;
DECLARE @CompId INT = 1;

DECLARE @Old TABLE (Id INT PRIMARY KEY);
INSERT INTO @Old SELECT Id FROM dbo.tblLeads WHERE CompId = @CompId AND Name COLLATE Latin1_General_CS_AS LIKE 'DEMO %';
DELETE FROM dbo.tblFollowUp          WHERE LeadId IN (SELECT Id FROM @Old);
DELETE FROM dbo.tblLeadAssignment    WHERE LeadId IN (SELECT Id FROM @Old);
DELETE FROM dbo.tblLeadStatusHistory WHERE LeadId IN (SELECT Id FROM @Old);
DELETE FROM dbo.tblLeadActivity      WHERE LeadId IN (SELECT Id FROM @Old);
DELETE FROM dbo.tblCustomFieldValue  WHERE CompId = @CompId AND Entity = 'lead' AND EntityId IN (SELECT Id FROM @Old);
DELETE FROM dbo.tblLeads             WHERE Id IN (SELECT Id FROM @Old);

DELETE FROM dbo.tblProduct WHERE CompId = @CompId AND Name COLLATE Latin1_General_CS_AS LIKE 'DEMO %';

DECLARE @Users TABLE (Id INT PRIMARY KEY);
INSERT INTO @Users SELECT Id FROM dbo.tblUser WHERE CompId = @CompId AND Username COLLATE Latin1_General_CS_AS LIKE 'demo\_%' ESCAPE '\';
-- Anything still pointing at a demo user would block the delete; nothing but
-- the demo rows above does, and those are gone by now.
UPDATE dbo.tblUser SET ReportsTo = NULL WHERE ReportsTo IN (SELECT Id FROM @Users);
DELETE FROM dbo.tblUserGroupMap     WHERE UserId IN (SELECT Id FROM @Users);
DELETE FROM dbo.tblUserBranchAccess WHERE UserId IN (SELECT Id FROM @Users);
DELETE FROM dbo.tblUser             WHERE Id IN (SELECT Id FROM @Users);
GO

-- verify after apply (expect 0 / 0 / 0 / 0 / 0)
SELECT 'demo leads' AS what, COUNT(*) AS N FROM dbo.tblLeads WHERE Name COLLATE Latin1_General_CS_AS LIKE 'DEMO %'
UNION ALL SELECT 'demo products', COUNT(*) FROM dbo.tblProduct WHERE Name COLLATE Latin1_General_CS_AS LIKE 'DEMO %'
UNION ALL SELECT 'demo users',    COUNT(*) FROM dbo.tblUser WHERE Username COLLATE Latin1_General_CS_AS LIKE 'demo\_%' ESCAPE '\'
UNION ALL SELECT 'demo group rows', COUNT(*) FROM dbo.tblUserGroupMap m WHERE NOT EXISTS (SELECT 1 FROM dbo.tblUser u WHERE u.Id = m.UserId)
UNION ALL SELECT 'orphan follow-ups', COUNT(*) FROM dbo.tblFollowUp f WHERE NOT EXISTS (SELECT 1 FROM dbo.tblLeads l WHERE l.Id = f.LeadId);
GO
