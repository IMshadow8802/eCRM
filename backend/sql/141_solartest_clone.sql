-- ===========================================================================
-- 141 - SolarTest: a private test copy of the client's live SolarCRM database,
--       so the access model can be tried against his real people and data
--       before anything touches SolarCRM.
--
-- Run ONCE, against master (BACKUP/RESTORE cannot run inside the target DB):
--   SQ -d master -i backend/sql/141_solartest_clone.sql
-- (SQ = your sqlcmd helper; -d master overrides its -d TestCRM.)
--
-- SolarCRM is only READ: BACKUP ... COPY_ONLY does not touch its backup chain,
-- its users notice nothing. No Central row is added: SolarTest is reached only
-- by a local backend (DB_NAME=SolarTest), never by the client's phones or web.
-- Re-running is safe: it stops if SolarTest already exists. To refresh from
-- live data later: DROP DATABASE [SolarTest]; then run this again.
-- ===========================================================================
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF DB_NAME() <> N'master'
BEGIN
    RAISERROR(N'141: run against master (-d master). Nothing was done.', 16, 1);
    SET NOEXEC ON;
END
GO
IF DB_ID(N'SolarTest') IS NOT NULL
    RAISERROR(N'141: SolarTest already exists - nothing restored.', 10, 1);
ELSE
BEGIN
    BACKUP DATABASE [SolarCRM] TO DISK = N'SolarCRM_for_SolarTest.bak'
        WITH COPY_ONLY, INIT, FORMAT;

    RESTORE DATABASE [SolarTest] FROM DISK = N'SolarCRM_for_SolarTest.bak'
        WITH MOVE N'SolarCRM'     TO N'C:\Program Files\Microsoft SQL Server\MSSQL15.MSSQLSERVER\MSSQL\DATA\SolarTest.mdf',
             MOVE N'SolarCRM_log' TO N'C:\Program Files\Microsoft SQL Server\MSSQL15.MSSQLSERVER\MSSQL\DATA\SolarTest_log.ldf',
             RECOVERY;
    PRINT '141: SolarTest restored from SolarCRM.';
END
GO
SET NOEXEC OFF;
GO
-- VERIFY AFTER APPLY:
-- SELECT name, state_desc FROM sys.databases WHERE name = 'SolarTest';   -- ONLINE
-- SELECT COUNT(*) FROM [SolarTest].dbo.tblUser;    -- 14, same as SolarCRM
-- SELECT COUNT(*) FROM [SolarTest].dbo.tblLeads;   -- same as SolarCRM
