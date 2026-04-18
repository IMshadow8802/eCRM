-- ============================================================
-- Migration 020 — Backfill default kanban columns for any
--                  shared/project workspace created before
--                  workspaceController.save started auto-seeding.
--
-- Idempotent: only seeds workspaces that currently have zero columns.
-- Safe to re-run.
-- ============================================================

USE [eCRM+];
GO

INSERT INTO dbo.tblKanbanColumns
    (WorkspaceId, Title, Color, SortOrder, MaxTasks, IsActive, CompId, BranchId, IsCompanyWide)
SELECT w.Id,
       v.Title,
       v.Color,
       v.SortOrder,
       NULL,
       1,
       w.CompId,
       w.BranchId,
       0
  FROM dbo.tblWorkspaces w
 CROSS JOIN (VALUES
        (1, 'To Do',       '#94A3B8'),
        (2, 'In Progress', '#3B82F6'),
        (3, 'Done',        '#10B981')
    ) AS v(SortOrder, Title, Color)
 WHERE w.IsArchived = 0
   AND w.Type IN ('shared', 'project')
   AND NOT EXISTS (
         SELECT 1
           FROM dbo.tblKanbanColumns c
          WHERE c.WorkspaceId = w.Id
       );
GO

PRINT 'Migration 020 complete — column backfill applied to all column-less shared/project workspaces.';
GO
