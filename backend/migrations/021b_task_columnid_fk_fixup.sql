-- ============================================================
-- Migration 021b — Fix up ColumnId type mismatch.
--
-- Migration 021 added tblTasks.ColumnId as BIGINT, but
-- tblKanbanColumns.Id is INT — FK creation failed (msg 1778).
--
-- This migration:
--   1. Drops the mis-typed ColumnId column (backfilled data is lost;
--      we re-run the backfill with the correct type so nothing moves).
--   2. Re-adds ColumnId as INT.
--   3. Re-runs the Status→Title backfill.
--   4. Falls back to first column per workspace for anything still NULL.
--   5. Creates FK_tblTasks_ColumnId → tblKanbanColumns(Id).
--   6. Recreates the index.
-- ============================================================

USE [eCRM+];
GO

-- Drop old index + FK first (idempotent — both checked before drop).
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_tblTasks_ColumnId')
    ALTER TABLE dbo.tblTasks DROP CONSTRAINT FK_tblTasks_ColumnId;
GO

IF EXISTS (
    SELECT 1 FROM sys.indexes
     WHERE name = 'IX_tblTasks_WorkspaceId_ColumnId'
       AND object_id = OBJECT_ID('dbo.tblTasks')
)
    DROP INDEX IX_tblTasks_WorkspaceId_ColumnId ON dbo.tblTasks;
GO

-- Ensure the column is INT. If it exists as something else, drop + re-add.
IF EXISTS (
    SELECT 1 FROM sys.columns c
     WHERE c.object_id = OBJECT_ID('dbo.tblTasks')
       AND c.name = 'ColumnId'
       AND c.system_type_id <> TYPE_ID('int')
)
BEGIN
    ALTER TABLE dbo.tblTasks DROP COLUMN ColumnId;
    PRINT 'Dropped mis-typed ColumnId';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
     WHERE object_id = OBJECT_ID('dbo.tblTasks') AND name = 'ColumnId'
)
BEGIN
    ALTER TABLE dbo.tblTasks ADD ColumnId INT NULL;
    PRINT 'Added tblTasks.ColumnId (INT)';
END
GO

-- Backfill: map by matching Status → normalized column Title per workspace.
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

-- Anything left unmapped → first column of its workspace.
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

-- FK
IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_tblTasks_ColumnId'
)
BEGIN
    ALTER TABLE dbo.tblTasks
       ADD CONSTRAINT FK_tblTasks_ColumnId
       FOREIGN KEY (ColumnId) REFERENCES dbo.tblKanbanColumns(Id);
    PRINT 'Added FK_tblTasks_ColumnId';
END
GO

-- Index
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

PRINT 'Migration 021b complete — ColumnId FK now typed INT.';
GO
