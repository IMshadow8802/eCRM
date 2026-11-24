-- 145 - SolarCRM only: support set-up from the client's message (2026-11-24).
--   * Vinod is the senior; Rohit and Vivek report to him; Vinod reports to Amit.
--   * Nitin and Prashant register every complaint and see all complaints + all customers
--     -> moved from "Support Agent" to the existing "Support Manager" role (Office reach, add/edit).
--   * Vinod, Vivek, Rohit (left in "Support Agent") see only complaints assigned to them,
--     cannot register a complaint, and lose the Customers page. They keep Edit so they can
--     resolve; the complaint itself still shows customer name and mobile.
-- Neha (Branch Manager) and Amit (Owner) are unchanged.
-- No sign-out needed: server checks access per request; web and phone re-read it on focus (<=1/min).
-- Apply:  SQ -d SolarCRM -i sql/145_solarcrm_support_desk.sql
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME() <> N'SolarCRM'
BEGIN
    RAISERROR('145: SolarCRM only. Nothing was changed.', 16, 1);
    SET NOEXEC ON;
END
GO
-- Refuse if the people or roles are not the ones read on 2026-11-24.
IF (SELECT COUNT(*) FROM dbo.tblUser WHERE
        (Id = 2  AND FullName LIKE N'Amit%')   OR
        (Id = 35 AND FullName LIKE N'Nitin%')  OR
        (Id = 36 AND FullName LIKE N'Pras%')   OR
        (Id = 37 AND FullName LIKE N'Rohit%')  OR
        (Id = 38 AND FullName LIKE N'Vinod%')  OR
        (Id = 39 AND FullName LIKE N'Vivek%')) <> 6
   OR NOT EXISTS (SELECT 1 FROM dbo.tblUserGroups WHERE Id = 17 AND Name = N'Support Agent')
   OR NOT EXISTS (SELECT 1 FROM dbo.tblUserGroups WHERE Id = 14 AND Name = N'Support Manager')
BEGIN
    RAISERROR('145: people or roles differ from 2026-11-24. Nothing was changed.', 16, 1);
    SET NOEXEC ON;
END
GO
BEGIN TRAN;

-- 1. Reporting: Vinod -> Amit; Rohit, Vivek -> Vinod.
UPDATE dbo.tblUser SET ReportsTo = 2  WHERE Id = 38;
UPDATE dbo.tblUser SET ReportsTo = 38 WHERE Id IN (37, 39);
PRINT '145.1 reporting lines set';

-- 2. Nitin, Prashant: Support Agent -> Support Manager.
UPDATE dbo.tblUserGroupMap SET GroupId = 14 WHERE UserId IN (35, 36) AND GroupId = 17;
PRINT CONCAT('145.2 moved to Support Manager: ', @@ROWCOUNT);

-- 3. Support Agent: no new complaints, no Customers page.
UPDATE dbo.tblGroupModule SET CanAdd = 0 WHERE GroupId = 17 AND Module = N'complaints';
PRINT CONCAT('145.3 complaints add off: ', @@ROWCOUNT);
DELETE dbo.tblGroupModule WHERE GroupId = 17 AND Module = N'customers';
PRINT CONCAT('145.3 customers removed: ', @@ROWCOUNT);

COMMIT;
GO
-- Verify: Nitin, Prashant = Support Manager under Amit; Vinod = Support Agent under Amit;
-- Rohit, Vivek = Support Agent under Vinod. Support Agent: complaints 1|0|1|0 Own, no customers row.
SELECT u.Id, LEFT(u.FullName,16) Name, LEFT(ISNULL(m.FullName,'-'),12) ReportsTo, LEFT(g.Name,16) Role
FROM dbo.tblUser u LEFT JOIN dbo.tblUser m ON m.Id = u.ReportsTo
JOIN dbo.tblUserGroupMap ugm ON ugm.UserId = u.Id JOIN dbo.tblUserGroups g ON g.Id = ugm.GroupId
WHERE u.Id BETWEEN 35 AND 39 ORDER BY u.Id;
SELECT LEFT(Module,12) Module, CanView V, CanAdd A, CanEdit E, CanDelete D, Reach, AssignReach
FROM dbo.tblGroupModule WHERE GroupId = 17 AND Module IN (N'complaints', N'customers');
