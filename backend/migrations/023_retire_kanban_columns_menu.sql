-- ============================================================
-- Migration 023 — Retire "Kanban Columns" sidebar menu.
--
-- Column management moved onto the Task board itself
-- (per-workspace inline). The standalone Master → Kanban
-- Columns page is no longer shipped. Remove the menu row and
-- its group-access grants so no backend user ever sees it again.
-- Frontend also hides MenuId=6 defensively via menuBuilder.js.
-- ============================================================

USE [eCRM+];
GO

IF EXISTS (SELECT 1 FROM dbo.tblMenu WHERE Id = 6 AND Description = 'Kanban Columns')
BEGIN
    DELETE FROM dbo.tblGroupAccess WHERE MenuId = 6;
    DELETE FROM dbo.tblMenu        WHERE Id = 6;
    PRINT 'Migration 023 — Kanban Columns menu (Id=6) removed.';
END
ELSE
BEGIN
    PRINT 'Migration 023 — Kanban Columns menu row not found (already removed).';
END
GO
