-- 144 - SolarCRM only: the "Sales Executive" role loses the Customers page.
-- Salespeople do not do support; converting a lead needs leads/edit only.
-- Nobody is in this role today (2026-11-24), so no one notices the change.
-- Apply:  SQ -d SolarCRM -i sql/144_solarcrm_sales_exec_no_customers.sql
SET NOCOUNT ON;
IF DB_NAME() <> N'SolarCRM'
BEGIN
    RAISERROR('144: SolarCRM only. Nothing was changed.', 16, 1);
    SET NOEXEC ON;
END
GO
DELETE gm
FROM dbo.tblGroupModule gm
JOIN dbo.tblUserGroups g ON g.Id = gm.GroupId
WHERE g.Name = N'Sales Executive' AND gm.Module = N'customers';
PRINT CONCAT('144: removed ', @@ROWCOUNT, ' row(s)');
GO
-- Verify: no row.
SELECT g.Name, gm.Module FROM dbo.tblGroupModule gm JOIN dbo.tblUserGroups g ON g.Id = gm.GroupId
WHERE g.Name = N'Sales Executive' AND gm.Module = N'customers';
