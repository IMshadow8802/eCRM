-- 111_retire_my_work.sql — retire the "My Work" menu (2026-10-11).
-- Today › Mine shows the same open tasks plus due / working / not started /
-- done, so My Work is gone from the web app; /my-work now redirects to /today.
-- This removes the menu row so it leaves the sidebar, and the rows that point
-- at it:
--   * tblGroupAccess (FK to tblMenu, NO ACTION; legacy, read by nothing — 12 rows on TestCRM)
--   * any child tblMenu rows (none on TestCRM)
-- Matched by Route, never by Id: Ids can differ between eCRM+, SolarCRM, TestCRM.
-- Data only; no schema change. Idempotent: a second run deletes nothing.
-- Apply on TestCRM first, then eCRM+ and SolarCRM once checked.
-- Apply: sqlcmd -I -S <server> -d TestCRM -i 111_retire_my_work.sql
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

SET XACT_ABORT ON;
BEGIN TRAN;

DECLARE @Ids TABLE (Id BIGINT PRIMARY KEY);
INSERT INTO @Ids (Id) SELECT Id FROM dbo.tblMenu WHERE Route = '/my-work';

-- children first (a child's access rows, then the child), then the row itself
DELETE ga FROM dbo.tblGroupAccess ga
WHERE ga.MenuId IN (SELECT c.Id FROM dbo.tblMenu c WHERE c.ParentId IN (SELECT Id FROM @Ids) AND c.Id NOT IN (SELECT Id FROM @Ids));
DELETE FROM dbo.tblMenu
WHERE ParentId IN (SELECT Id FROM @Ids) AND Id NOT IN (SELECT Id FROM @Ids);

DELETE FROM dbo.tblGroupAccess WHERE MenuId IN (SELECT Id FROM @Ids);
DELETE FROM dbo.tblMenu WHERE Id IN (SELECT Id FROM @Ids);

COMMIT;
GO

-- ---------------------------------------------------------------------------
-- Verify after apply (all three should be 0):
-- SELECT COUNT(*) AS menu_rows FROM dbo.tblMenu WHERE Route = '/my-work';
-- SELECT COUNT(*) AS access_rows FROM dbo.tblGroupAccess ga
--   WHERE NOT EXISTS (SELECT 1 FROM dbo.tblMenu m WHERE m.Id = ga.MenuId);
-- SELECT COUNT(*) AS orphans FROM dbo.tblMenu c
--   WHERE c.ParentId <> 0 AND c.ParentId <> c.Id
--     AND NOT EXISTS (SELECT 1 FROM dbo.tblMenu p WHERE p.Id = c.ParentId);
