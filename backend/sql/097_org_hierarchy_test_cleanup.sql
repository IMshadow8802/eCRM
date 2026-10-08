-- 097_org_hierarchy_test_cleanup.sql — remove the throwaway "QA" data the
-- 2026-10-07 live access tests left in eCRM+ (spec 2026-10-07-org-hierarchy §7).
--
-- What it touches, matched by name pattern only:
--   * tblCustomer  Name LIKE 'QA %'          (inactive, no complaints)  -> deleted
--   * tblBranch    BranchName LIKE 'QA %'    (6 inactive test offices)  -> deleted,
--     after every row that points at them is moved to office 1 (HEAD OFFICE):
--     the QA users (inactive) and anything they created there.
--   * tblUser      Username LIKE 'qa[_]%'    -> left in place, inactive. They
--     have activity history; sp_DeleteUser refuses such users by design.
--
-- eCRM+ only (SolarCRM was never used for tests). Apply:
--   sqlcmd -S prdinfotech.in,1433 -U sa -d "eCRM+" -C -b -I -i sql/097_org_hierarchy_test_cleanup.sql
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO

BEGIN TRAN;

DECLARE @Qa TABLE (Id BIGINT PRIMARY KEY);
INSERT INTO @Qa SELECT Id FROM dbo.tblBranch WHERE BranchName LIKE 'QA %' AND IsActive = 0;

-- Safety: only test rows may point at these offices.
IF EXISTS (SELECT 1 FROM dbo.tblUser WHERE BranchId IN (SELECT Id FROM @Qa) AND Username NOT LIKE 'qa[_]%')
BEGIN
    RAISERROR('A non-QA user sits in a QA office; nothing changed.', 16, 1);
    ROLLBACK; RETURN;
END

DELETE FROM dbo.tblCustomer
 WHERE Name LIKE 'QA %' AND IsActive = 0
   AND NOT EXISTS (SELECT 1 FROM dbo.tblTicket t WHERE t.CustomerId = tblCustomer.Id);

DELETE FROM dbo.tblUserBranchAccess WHERE BranchId IN (SELECT Id FROM @Qa);

UPDATE dbo.tblUser          SET BranchId = 1 WHERE BranchId IN (SELECT Id FROM @Qa);
UPDATE dbo.tblActivityLog   SET BranchId = 1 WHERE BranchId IN (SELECT Id FROM @Qa);
UPDATE dbo.tblFollowUp      SET BranchId = 1 WHERE BranchId IN (SELECT Id FROM @Qa);
UPDATE dbo.tblKanbanColumns SET BranchId = 1 WHERE BranchId IN (SELECT Id FROM @Qa);
UPDATE dbo.tblLeads         SET BranchId = 1 WHERE BranchId IN (SELECT Id FROM @Qa);
UPDATE dbo.tblNotifications SET BranchId = 1 WHERE BranchId IN (SELECT Id FROM @Qa);
UPDATE dbo.tblProjects      SET BranchId = 1 WHERE BranchId IN (SELECT Id FROM @Qa);
UPDATE dbo.tblQuoteProfile  SET BranchId = 1 WHERE BranchId IN (SELECT Id FROM @Qa);
UPDATE dbo.tblTeams         SET BranchId = 1 WHERE BranchId IN (SELECT Id FROM @Qa);
UPDATE dbo.tblTicket        SET BranchId = 1 WHERE BranchId IN (SELECT Id FROM @Qa);
UPDATE dbo.tblWorkspaces    SET BranchId = 1 WHERE BranchId IN (SELECT Id FROM @Qa);

-- Children before parents isn't needed (no FK on tblBranch), but clear ParentId first anyway.
UPDATE dbo.tblBranch SET ParentId = NULL WHERE Id IN (SELECT Id FROM @Qa);
DELETE FROM dbo.tblBranch WHERE Id IN (SELECT Id FROM @Qa);

COMMIT;
GO

-- VERIFY AFTER APPLY (expect 0 / 0 / 19 inactive):
-- SELECT (SELECT COUNT(*) FROM tblBranch WHERE BranchName LIKE 'QA %') AS QaOffices,
--        (SELECT COUNT(*) FROM tblCustomer WHERE Name LIKE 'QA %') AS QaCustomers,
--        (SELECT COUNT(*) FROM tblUser WHERE Username LIKE 'qa[_]%' AND IsActive = 0) AS QaUsersInactive;
