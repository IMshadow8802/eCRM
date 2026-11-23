/* ============================================================================
   124 — SolarCRM ONLY: undo 123, put the old role permissions back
   ----------------------------------------------------------------------------
   Why: 123 opened complaints, customers, leads and sales reports to every role
        with company-wide reach. The client wants the old rules back.
   What: from the backup 123 took (dbo.tblGroupModule_bak_123, 34 rows):
        1. rows 123 ADDED (not in the backup) for complaints / customers /
           leads / sales_reports are deleted;
        2. rows 123 CHANGED get their old View/Add/Edit/Delete/Reach back.
        The backup table is kept (drop it later by hand once all is well).
   Apply: SolarCRM only — refuses any other database, and refuses if the
        backup table is missing.
        sqlcmd -I -b ... -d SolarCRM -i backend/sql/124_solarcrm_restore_permissions.sql
        Then everyone signs out of the phone app and signs back in.
   ========================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO

IF DB_NAME() <> N'SolarCRM'
    THROW 51240, '124 is for the SolarCRM database only.', 1;
IF OBJECT_ID('dbo.tblGroupModule_bak_123') IS NULL
    THROW 51241, '124: backup table dbo.tblGroupModule_bak_123 not found — nothing to restore from.', 1;
GO

BEGIN TRY
    BEGIN TRAN;

    -- 1. Remove the rows 123 added.
    DELETE gm
    FROM dbo.tblGroupModule gm
    JOIN dbo.tblUserGroups g ON g.Id = gm.GroupId
    WHERE g.CompId = 1
      AND gm.Module IN ('complaints', 'customers', 'leads', 'sales_reports')
      AND NOT EXISTS (SELECT 1 FROM dbo.tblGroupModule_bak_123 b WHERE b.Id = gm.Id);
    DECLARE @removed INT = @@ROWCOUNT;

    -- 2. Put the changed rows back as they were.
    UPDATE gm
    SET CanView = b.CanView, CanAdd = b.CanAdd, CanEdit = b.CanEdit,
        CanDelete = b.CanDelete, Reach = b.Reach
    FROM dbo.tblGroupModule gm
    JOIN dbo.tblGroupModule_bak_123 b ON b.Id = gm.Id;
    DECLARE @restored INT = @@ROWCOUNT;

    COMMIT;
    PRINT CONCAT('124: removed ', @removed, ' added rows, restored ', @restored, ' rows to their old permissions.');
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
END CATCH;
GO

-- ---------------------------------------------------------------------------
-- VERIFY after apply (expect 0 rows — every grant equals its backup, no extras):
-- SELECT g.Name, gm.Module, gm.Reach FROM dbo.tblGroupModule gm
-- JOIN dbo.tblUserGroups g ON g.Id = gm.GroupId
-- LEFT JOIN dbo.tblGroupModule_bak_123 b ON b.Id = gm.Id
-- WHERE g.CompId = 1 AND gm.Module IN ('complaints','customers','leads','sales_reports')
--   AND (b.Id IS NULL OR gm.CanView <> b.CanView OR gm.CanAdd <> b.CanAdd OR gm.CanEdit <> b.CanEdit
--        OR gm.CanDelete <> b.CanDelete OR ISNULL(gm.Reach,'') <> ISNULL(b.Reach,''));
-- Expect e.g. Support Agent complaints = Own, Sales Executive leads = Own, Sales Team Lead leads = Team.
-- Later, once happy: DROP TABLE dbo.tblGroupModule_bak_123;
