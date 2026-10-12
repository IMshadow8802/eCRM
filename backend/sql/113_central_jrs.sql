-- 113_central_jrs.sql — register the JRS app for company code PRD in Central.
--
-- Database: PRDInfotech (Central's licensing DB), NOT a CRM database.
-- Central answers GET https://shadowcodes.in/Central/api/clients/<CompCode>?appType=<AppType>
-- from dbo.tblCompURL; one row per (CompCode, AppType). The client app then calls
-- <BaseURL>/api/... itself, so BaseURL is the backend root without /api and
-- without a trailing slash, the same as every other row
-- (CRM = https://shadowcodes.in/CRM).
--
-- Idempotent: inserts only when no PRD/JRS row exists yet.

SET NOCOUNT ON;

IF NOT EXISTS (SELECT 1 FROM dbo.tblCompURL WHERE CompCode = 'PRD' AND AppType = 'JRS')
BEGIN
    INSERT INTO dbo.tblCompURL (Company, Location, ActivationDate, IsActive, Ref, CompCode, AppType, BaseURL, LogoURL, PrimaryColor)
    VALUES ('PRD Infotech Pvt Ltd', 'Delhi', GETDATE(), 1, '', 'PRD', 'JRS', 'https://shadowcodes.in/JRS', '', '');
END

-- Verify after apply (expect exactly one row, IsActive = 1):
-- SELECT Id, CompCode, AppType, BaseURL, IsActive FROM dbo.tblCompURL WHERE CompCode = 'PRD' AND AppType = 'JRS';
-- curl -s "https://shadowcodes.in/Central/api/clients/PRD?appType=JRS"   -- success:true, data.BaseURL = https://shadowcodes.in/JRS
