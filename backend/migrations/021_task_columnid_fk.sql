-- ============================================================
-- Migration 021 — Hard link between tasks and kanban columns.
--
-- Before: tblTasks.Status (VARCHAR) was string-matched to
-- tblKanbanColumns.Title on the client. Any column rename
-- silently orphaned every task in it.
--
-- After: tblTasks.ColumnId (BIGINT FK → tblKanbanColumns.Id).
-- Status stays as a semantic enum (todo/in-progress/done/blocked)
-- for reports + dashboards, decoupled from column titles.
--
-- Idempotent-ish: safe to re-run in the same direction (ALTER fails
-- fast if column already exists). Backfill is idempotent via LEFT JOIN.
-- ============================================================

USE [eCRM+];
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
     WHERE object_id = OBJECT_ID('dbo.tblTasks')
       AND name      = 'ColumnId'
)
BEGIN
    ALTER TABLE dbo.tblTasks ADD ColumnId BIGINT NULL;
    PRINT 'Added tblTasks.ColumnId';
END
GO

-- Backfill: map each task to the column whose normalized title
-- matches Status within the same workspace.
;WITH mapping AS (
    SELECT t.Id AS TaskId,
           c.Id AS ColumnId,
           ROW_NUMBER() OVER (
               PARTITION BY t.Id
               ORDER BY c.SortOrder, c.Id
           ) AS rn
      FROM dbo.tblTasks t
      JOIN dbo.tblKanbanColumns c
        ON c.WorkspaceId = t.WorkspaceId
       AND c.IsActive = 1
       AND LOWER(REPLACE(c.Title, ' ', '')) IN (
           LOWER(t.Status),
           LOWER(REPLACE(t.Status, '-', ''))
       )
     WHERE t.ColumnId IS NULL
)
UPDATE t
   SET ColumnId = m.ColumnId
  FROM dbo.tblTasks t
  JOIN mapping m ON m.TaskId = t.Id AND m.rn = 1;
GO

-- For any remaining unmapped tasks, assign to the workspace's first
-- column (by SortOrder) so nothing is orphaned at the DB layer.
;WITH firstCol AS (
    SELECT WorkspaceId,
           Id AS ColumnId,
           ROW_NUMBER() OVER (PARTITION BY WorkspaceId ORDER BY SortOrder, Id) AS rn
      FROM dbo.tblKanbanColumns
     WHERE IsActive = 1
)
UPDATE t
   SET ColumnId = fc.ColumnId
  FROM dbo.tblTasks t
  JOIN firstCol fc ON fc.WorkspaceId = t.WorkspaceId AND fc.rn = 1
 WHERE t.ColumnId IS NULL;
GO

-- FK constraint
IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys
     WHERE name = 'FK_tblTasks_ColumnId'
)
BEGIN
    ALTER TABLE dbo.tblTasks
       ADD CONSTRAINT FK_tblTasks_ColumnId
       FOREIGN KEY (ColumnId) REFERENCES dbo.tblKanbanColumns(Id);
    PRINT 'Added FK_tblTasks_ColumnId';
END
GO

-- Index for board-fetch hot path: tasks by workspace+column
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
     WHERE name = 'IX_tblTasks_WorkspaceId_ColumnId'
       AND object_id = OBJECT_ID('dbo.tblTasks')
)
BEGIN
    CREATE INDEX IX_tblTasks_WorkspaceId_ColumnId
        ON dbo.tblTasks (WorkspaceId, ColumnId)
     INCLUDE (Status, Priority, AssignedToUserId);
    PRINT 'Added IX_tblTasks_WorkspaceId_ColumnId';
END
GO

PRINT 'Migration 021 complete.';
GO
