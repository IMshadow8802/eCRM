-- ===========================================================================
-- 138 - TestCRM ONLY: give the 18 seed personas (am_*) their own test-only
--       password, so automated local runs (leak suite, Playwright, Maestro)
--       never use the owner's real password. The plain value lives only in
--       the git-ignored backend/.env.live (LIVE_PASSWORD); this file carries
--       its bcrypt hash (12 rounds, same as the app).
-- Apply: sqlcmd -I -b -f 65001 ... -d TestCRM -i 138_testcrm_persona_test_password.sql
-- Refuses any database but TestCRM. Re-run after every 136 (136 copies the
-- RefUser's hash). Undo = re-run 137 then 136.
-- ===========================================================================
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF DB_NAME() <> N'TestCRM'
BEGIN
    RAISERROR('138: TestCRM only. Nothing was changed.', 16, 1);
    SET NOEXEC ON;
END
GO
UPDATE dbo.tblUser
SET Password = '$2b$12$SgXgWTzb5VNV9eV9K/2YMuA34nV7ThIoZkU45VnTi.wF.14iEXnZW'
WHERE Username COLLATE Latin1_General_CS_AS LIKE 'am[_]%'
  AND FullName COLLATE Latin1_General_CS_AS LIKE 'AM %';
PRINT '138: personas updated: ' + CAST(@@ROWCOUNT AS VARCHAR(10));
GO
SET NOEXEC OFF;
GO
-- VERIFY: SELECT COUNT(*) FROM dbo.tblUser WHERE Username LIKE 'am[_]%' AND Password = '<hash above>';  -- expect 18
