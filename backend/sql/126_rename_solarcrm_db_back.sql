/* ============================================================================
   126 — Undo 125: rename 1SolarCRM back to SolarCRM
   ----------------------------------------------------------------------------
   Run against master. Disconnects anyone on 1SolarCRM (nobody should be).
        sqlcmd -I -b ... -d master -i backend/sql/126_rename_solarcrm_db_back.sql
   Then start the API: docker compose start crm_solar
   ========================================================================== */
USE master;
GO

IF DB_ID(N'1SolarCRM') IS NULL
    THROW 51260, '126: database 1SolarCRM not found (already renamed back?).', 1;
IF DB_ID(N'SolarCRM') IS NOT NULL
    THROW 51261, '126: a database named SolarCRM already exists.', 1;
GO

ALTER DATABASE [1SolarCRM] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
GO
ALTER DATABASE [1SolarCRM] MODIFY NAME = [SolarCRM];
GO
ALTER DATABASE [SolarCRM] SET MULTI_USER;
GO
PRINT '126: 1SolarCRM renamed back to SolarCRM.';
GO

-- VERIFY: SELECT name, state_desc, user_access_desc FROM sys.databases WHERE name IN ('SolarCRM','1SolarCRM');
-- expect one row: SolarCRM · ONLINE · MULTI_USER
