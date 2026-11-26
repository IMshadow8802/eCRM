-- 152_mlss_rename_and_path.sql — MLSS CRM: database [MLSS] -> [MLSSCRM], public path /MLSSCRM/.
--   * the database 151 created is renamed MLSSCRM (logical files too; the files on disk
--     stay MLSS_CRM.mdf / MLSS_CRM_log.ldf). Nothing connects to it yet (crm_mlss not started);
--   * https://shadowcodes.in/MLSS/ is already MLSS's Attendance API, so the two ECRM rows
--     in Central point at /MLSSCRM instead.
-- Run against master:
--   sqlcmd ... -d master -C -b -I -i sql/152_mlss_rename_and_path.sql
-- Re-runnable: each step checks first.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF DB_ID(N'MLSS') IS NOT NULL AND DB_ID(N'MLSSCRM') IS NULL
BEGIN
    ALTER DATABASE [MLSS] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    ALTER DATABASE [MLSS] MODIFY NAME = [MLSSCRM];
    ALTER DATABASE [MLSSCRM] SET MULTI_USER;
END
GO
IF EXISTS (SELECT 1 FROM sys.master_files WHERE database_id = DB_ID(N'MLSSCRM') AND name = N'SolarCRM')
    ALTER DATABASE [MLSSCRM] MODIFY FILE (NAME = N'SolarCRM', NEWNAME = N'MLSSCRM');
IF EXISTS (SELECT 1 FROM sys.master_files WHERE database_id = DB_ID(N'MLSSCRM') AND name = N'SolarCRM_log')
    ALTER DATABASE [MLSSCRM] MODIFY FILE (NAME = N'SolarCRM_log', NEWNAME = N'MLSSCRM_log');
GO
UPDATE PRDInfotech.dbo.tblCompURL
SET BaseURL = 'https://shadowcodes.in/MLSSCRM'
WHERE CompCode = 'MLSS' AND AppType IN ('ECRM_ADMIN', 'ECRM_EMP');
GO
-- VERIFY AFTER APPLY:
-- SELECT name FROM sys.databases WHERE name IN ('MLSS', 'MLSSCRM');                    -- MLSSCRM only
-- SELECT name, physical_name FROM sys.master_files WHERE database_id = DB_ID('MLSSCRM'); -- MLSSCRM, MLSSCRM_log
-- SELECT AppType, BaseURL FROM PRDInfotech.dbo.tblCompURL WHERE CompCode = 'MLSS' AND AppType LIKE 'ECRM%';  -- /MLSSCRM
