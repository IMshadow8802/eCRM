-- 115_solarcrm_hide_cards.sql — SolarCRM does not use Visiting Cards.
--
-- 114 added the "Visiting Cards" menu row to every company DB. Admins see every
-- menu whatever the grants, so the row itself has to go for SolarCRM. The card
-- table and API stay (harmless, empty); only the sidebar entry is removed.
-- tblGroupAccess (legacy) references tblMenu, so its rows go first.
--
-- Run against SolarCRM ONLY:
--   sqlcmd ... -d SolarCRM -C -I -i sql/115_solarcrm_hide_cards.sql
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF DB_NAME() <> N'SolarCRM'
BEGIN
    RAISERROR(N'115 is for SolarCRM only - nothing changed.', 16, 1);
    SET NOEXEC ON;
END
GO

DELETE ga FROM dbo.tblGroupAccess ga
JOIN dbo.tblMenu m ON m.Id = ga.MenuId
WHERE m.Route = '/sales/visiting-cards';

DELETE FROM dbo.tblMenu WHERE Route = '/sales/visiting-cards';
GO
SET NOEXEC OFF;
GO

-- VERIFY AFTER APPLY (expect 0):
-- SELECT COUNT(*) FROM [SolarCRM].dbo.tblMenu WHERE Route = '/sales/visiting-cards';
