-- 106_testcrm_clone.sql — a test copy of the live PRD database.
--
-- Creates database [TestCRM] as a copy of [eCRM+] (data and all) and registers
-- company code TestCRM in Central, pointing at https://shadowcodes.in/TestCRM.
-- [eCRM+] is only read (BACKUP ... COPY_ONLY does not touch its backup chain).
--
-- Run ONCE, against master (BACKUP/RESTORE cannot run inside the target DB):
--   sqlcmd -S prdinfotech.in,1433 -U sa -d master -C -b -I -i sql/106_testcrm_clone.sql
--
-- Re-running is safe: it stops if TestCRM already exists. To refresh the copy
-- later from live data, DROP DATABASE [TestCRM] first, then run this again.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF DB_ID(N'TestCRM') IS NOT NULL
BEGIN
    RAISERROR(N'TestCRM already exists - nothing restored.', 10, 1);
END
ELSE
BEGIN
    -- A bare file name lands in the server's default backup folder.
    BACKUP DATABASE [eCRM+] TO DISK = N'eCRM_for_TestCRM.bak'
        WITH COPY_ONLY, INIT, FORMAT;

    RESTORE DATABASE [TestCRM] FROM DISK = N'eCRM_for_TestCRM.bak'
        WITH MOVE N'eCRM+'     TO N'C:\Program Files\Microsoft SQL Server\MSSQL15.MSSQLSERVER\MSSQL\DATA\TestCRM.mdf',
             MOVE N'eCRM+_log' TO N'C:\Program Files\Microsoft SQL Server\MSSQL15.MSSQLSERVER\MSSQL\DATA\TestCRM_log.ldf',
             RECOVERY;
END
GO

-- Central: company code TestCRM -> the TestCRM backend (admin + employee app).
IF NOT EXISTS (SELECT 1 FROM PRDInfotech.dbo.tblCompURL WHERE CompCode = 'TestCRM')
    INSERT INTO PRDInfotech.dbo.tblCompURL
        (Company, Location, ActivationDate, IsActive, Ref, CompCode, AppType, BaseURL, LogoURL, PrimaryColor)
    VALUES
        ('PRD Infotech (Test)', 'Delhi', GETDATE(), 1, '', 'TestCRM', 'ECRM_ADMIN', 'https://shadowcodes.in/TestCRM', '', ''),
        ('PRD Infotech (Test)', 'Delhi', GETDATE(), 1, '', 'TestCRM', 'ECRM_EMP',   'https://shadowcodes.in/TestCRM', '', '');
GO

-- VERIFY AFTER APPLY:
-- SELECT name, state_desc FROM sys.databases WHERE name = 'TestCRM';               -- ONLINE
-- SELECT COUNT(*) FROM [TestCRM].dbo.tblUser;                                      -- same as eCRM+
-- SELECT CompCode, AppType, BaseURL FROM PRDInfotech.dbo.tblCompURL WHERE CompCode = 'TestCRM';  -- 2 rows
