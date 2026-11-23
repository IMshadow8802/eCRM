/* ============================================================================
   125 — Rename the SolarCRM database to 1SolarCRM (safety while SolarCRM is off)
   ----------------------------------------------------------------------------
   Why: SolarCRM is being taken offline. Renaming the database means nothing
        that still points at "SolarCRM" (the crm_solar container's .env.solarcrm
        DB_NAME, any stray tool) can connect to it, even if the container is
        started by mistake. Data and files are untouched — only the name changes.
   Run against: master (the script switches there itself).
        sqlcmd -I -b ... -d master -i backend/sql/125_rename_solarcrm_db.sql
   Undo (later): run the same three statements with the names swapped:
        ALTER DATABASE [1SolarCRM] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
        ALTER DATABASE [1SolarCRM] MODIFY NAME = [SolarCRM];
        ALTER DATABASE [SolarCRM] SET MULTI_USER;
   Note: SET SINGLE_USER WITH ROLLBACK IMMEDIATE disconnects anyone connected
        to SolarCRM (checked 2026-11-20: nobody was).
   ========================================================================== */
USE master;
GO

IF DB_ID(N'SolarCRM') IS NULL
    THROW 51250, '125: database SolarCRM not found (already renamed?).', 1;
IF DB_ID(N'1SolarCRM') IS NOT NULL
    THROW 51251, '125: a database named 1SolarCRM already exists.', 1;
GO

ALTER DATABASE [SolarCRM] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
GO
ALTER DATABASE [SolarCRM] MODIFY NAME = [1SolarCRM];
GO
ALTER DATABASE [1SolarCRM] SET MULTI_USER;
GO
PRINT '125: SolarCRM renamed to 1SolarCRM.';
GO

-- VERIFY: SELECT name, state_desc, user_access_desc FROM sys.databases WHERE name IN ('SolarCRM','1SolarCRM');
-- expect one row: 1SolarCRM · ONLINE · MULTI_USER
