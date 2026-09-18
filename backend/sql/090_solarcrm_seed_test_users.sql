-- =============================================================================
-- 090_solarcrm_seed_test_users.sql
--
-- Purpose : test logins for the SolarCare evaluation.
--             * `super` — Owner (All scope, admin). Created if missing.
--             * `Amit`  — already exists in this DB as Owner/All (the login
--                         089 kept). Left exactly as it is; only the password
--                         is set. This is the one to hand the CEO.
--           Every user in this DB is then set to the shared demo password
--           123456 (bcrypt, 12 rounds — the hash the backend itself produces).
-- Target  : *** [SolarCRM] ONLY *** — the guard aborts anywhere else.
-- After   : share `super` / `Amit` + 123456. When the trial ends, change the
--           passwords in Settings › Users, or kill every login at once by
--           flipping IsActive = 0 on the SOLAR CARE rows in Central. A
--           six-digit shared password on a public API is for the demo window
--           and nothing longer.
-- Idempotent: re-running skips existing usernames and re-applies the password.
-- Note    : usernames are matched case-insensitively by the server's collation,
--           so 'amit' and 'Amit' are the same login.
-- =============================================================================
USE [SolarCRM];
GO
SET NOCOUNT ON;

IF DB_NAME() <> 'SolarCRM'
BEGIN
    RAISERROR('Refusing to run: connected to %s, not SolarCRM.', 16, 1, @@SERVERNAME);
    RETURN;
END

-- bcrypt("123456", 12) — generated with the backend's own bcryptjs, 2026-09-16.
DECLARE @Hash       VARCHAR(500) = '$2b$12$/caL4XOr8fXhfW10JrH/nO1ji0xTLXd2tHQZu90nulIJRRn6wDiZy';
DECLARE @CompId     BIGINT = (SELECT TOP 1 CompId   FROM dbo.tblUser ORDER BY Id);
DECLARE @BranchId   BIGINT = (SELECT MIN(Id)        FROM dbo.tblBranch);
DECLARE @OwnerGroup INT    = (SELECT MIN(Id)        FROM dbo.tblUserGroups WHERE Name = 'Owner' AND IsActive = 1);
DECLARE @out TABLE (ResponseCode INT, ResponseMess VARCHAR(400), UserId INT NULL, AssignedGroupId INT NULL);

IF @CompId IS NULL OR @BranchId IS NULL OR @OwnerGroup IS NULL
BEGIN
    RAISERROR('Missing CompId / branch / Owner group — run 089 first.', 16, 1);
    RETURN;
END

-- `super` — Owner, same branch as the existing login.
IF NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Username = 'super')
    INSERT INTO @out EXEC dbo.sp_SaveUser
        @Id = 0, @Username = 'super', @Password = @Hash, @UserActive = 1, @IsAdmin = 1,
        @UserIp = '', @AllowDay = 0, @FullName = 'Super Admin', @Email = NULL,
        @JobTitle = 'Owner', @HourlyRate = 0, @GroupId = @OwnerGroup,
        @CompId = @CompId, @BranchId = @BranchId, @Mobile = NULL, @ReportsTo = NULL;

-- Everyone in this DB gets the shared demo password. Groups are NOT touched:
-- `Amit` stays the Owner/All account the CEO will use.
UPDATE dbo.tblUser SET Password = @Hash, IsActive = 1;

-- ===== verify ===============================================================
SELECT * FROM @out;                                   -- one 201 row on first run, empty after
SELECT u.Id, u.Username, u.FullName, g.Name AS [Group], g.DataScope, u.IsAdmin,
       u.BranchId, u.ReportsTo,
       CASE WHEN u.Password = @Hash THEN 'demo pwd' ELSE 'OTHER' END AS Pwd
FROM dbo.tblUser u
LEFT JOIN dbo.tblUserGroupMap m ON m.UserId = u.Id
LEFT JOIN dbo.tblUserGroups  g  ON g.Id = m.GroupId
ORDER BY u.Id;
-- Expect 2 users (Amit, super), both Owner / All, both 'demo pwd'.
-- Then, from any machine:
--   curl -s -X POST https://shadowcodes.in/SolarCRM/api/auth/loginUser \
--     -H 'Content-Type: application/json' \
--     -d '{"identifier":"super","password":"123456"}'
--   → {"success":true,...}
GO
