/* ============================================================================
   123 — SolarCRM ONLY: open complaints, customers and leads to every role (testing)
   ----------------------------------------------------------------------------
   Why: the SolarCRM team is testing complaints and wants everyone to be able
        to see, add, edit and assign complaints to anyone. When they decide the
        real rules, run the RESTORE block at the bottom (or set roles in
        Admin → Roles & Permissions).
   What: for every active role in SolarCRM (CompId 1) the `complaints`,
        `customers` and `leads` grants become View + Add + Edit with
        Reach = Company, and every role can open the Sales Reports
        (`sales_reports` View; the reports then show the whole company).
        Delete is NOT given (existing Delete ticks are kept as they are).
        Roles that had no row for a module get one.
        The rows as they were before are copied to tblGroupModule_bak_123 first.
   Effect: "Assign to" on a complaint and "Transfer" on a lead/complaint list
        everyone; every role sees every complaint and every lead; roles that
        had no Complaints or Leads get the menu and the app tab.
   Apply: SolarCRM only — the script refuses any other database.
        sqlcmd -I -b ... -d SolarCRM -i backend/sql/123_solarcrm_open_complaints_for_testing.sql
        People must sign out of the phone app and sign back in (the app reads
        permissions at sign-in); the web picks it up on its next refresh.
   ========================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO

IF DB_NAME() <> N'SolarCRM'
    THROW 51230, '123 is for the SolarCRM database only.', 1;
GO

BEGIN TRY
    BEGIN TRAN;

    -- 1. Keep a copy of the current grants for these four modules (once).
    IF OBJECT_ID('dbo.tblGroupModule_bak_123') IS NULL
        SELECT gm.*, SYSDATETIME() AS BackedUpAt
        INTO dbo.tblGroupModule_bak_123
        FROM dbo.tblGroupModule gm
        JOIN dbo.tblUserGroups g ON g.Id = gm.GroupId
        WHERE g.CompId = 1 AND gm.Module IN ('complaints', 'customers', 'leads', 'sales_reports');

    -- 2. Raise existing rows to View + Add + Edit, Company reach (Delete untouched).
    UPDATE gm
    SET CanView = 1, CanAdd = 1, CanEdit = 1, Reach = 'Company'
    FROM dbo.tblGroupModule gm
    JOIN dbo.tblUserGroups g ON g.Id = gm.GroupId
    WHERE g.CompId = 1 AND g.IsActive = 1 AND gm.Module IN ('complaints', 'customers', 'leads');

    -- 2b. Sales Reports: View for everyone (reach comes from `leads`).
    UPDATE gm SET CanView = 1
    FROM dbo.tblGroupModule gm
    JOIN dbo.tblUserGroups g ON g.Id = gm.GroupId
    WHERE g.CompId = 1 AND g.IsActive = 1 AND gm.Module = 'sales_reports';

    -- 3. Add the missing rows for roles that had no grant.
    INSERT INTO dbo.tblGroupModule (GroupId, Module, CanView, CanAdd, CanEdit, CanDelete, Reach)
    SELECT g.Id, m.Module, 1, 1, 1, 0, 'Company'
    FROM dbo.tblUserGroups g
    CROSS JOIN (VALUES ('complaints'), ('customers'), ('leads')) m(Module)
    WHERE g.CompId = 1 AND g.IsActive = 1
      AND NOT EXISTS (SELECT 1 FROM dbo.tblGroupModule x WHERE x.GroupId = g.Id AND x.Module = m.Module);

    INSERT INTO dbo.tblGroupModule (GroupId, Module, CanView, CanAdd, CanEdit, CanDelete, Reach)
    SELECT g.Id, 'sales_reports', 1, 0, 0, 0, NULL
    FROM dbo.tblUserGroups g
    WHERE g.CompId = 1 AND g.IsActive = 1
      AND NOT EXISTS (SELECT 1 FROM dbo.tblGroupModule x WHERE x.GroupId = g.Id AND x.Module = 'sales_reports');

    COMMIT;
    PRINT '123: complaints, customers, leads opened to every active role (Company reach); sales reports viewable by all.';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
END CATCH;
GO

-- ---------------------------------------------------------------------------
-- VERIFY after apply (expect every active role: 1 1 1 Company for complaints/customers/leads, CanView 1 for sales_reports):
-- SELECT g.Name, gm.Module, gm.CanView, gm.CanAdd, gm.CanEdit, gm.CanDelete, gm.Reach
-- FROM dbo.tblUserGroups g JOIN dbo.tblGroupModule gm ON gm.GroupId = g.Id
-- WHERE g.CompId = 1 AND g.IsActive = 1 AND gm.Module IN ('complaints','customers','leads','sales_reports')
-- ORDER BY g.Name, gm.Module;
--
-- RESTORE later (puts the old grants back, removes rows this script added):
-- BEGIN TRAN;
-- DELETE gm FROM dbo.tblGroupModule gm JOIN dbo.tblUserGroups g ON g.Id = gm.GroupId
--   WHERE g.CompId = 1 AND gm.Module IN ('complaints','customers','leads','sales_reports')
--     AND NOT EXISTS (SELECT 1 FROM dbo.tblGroupModule_bak_123 b WHERE b.Id = gm.Id);
-- UPDATE gm SET CanView = b.CanView, CanAdd = b.CanAdd, CanEdit = b.CanEdit, CanDelete = b.CanDelete, Reach = b.Reach
--   FROM dbo.tblGroupModule gm JOIN dbo.tblGroupModule_bak_123 b ON b.Id = gm.Id;
-- COMMIT;
-- DROP TABLE dbo.tblGroupModule_bak_123;
