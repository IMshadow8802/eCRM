-- ============================================================
-- Migration 022b — Finish the Status drop blocked by indexes.
--
-- Migration 022 failed on `ALTER TABLE ... DROP COLUMN Status` because:
--   1. IX_tblTasks_Status references Status (legacy index).
--   2. IX_tblTasks_WorkspaceId_ColumnId had Status in its INCLUDE list
--      (leftover from 021b).
-- Drop both, drop Status, recreate the WorkspaceId_ColumnId index
-- without Status.
-- ============================================================

USE [eCRM+];
GO

IF EXISTS (
    SELECT 1 FROM sys.indexes
     WHERE name = 'IX_tblTasks_Status'
       AND object_id = OBJECT_ID('dbo.tblTasks')
)
    DROP INDEX IX_tblTasks_Status ON dbo.tblTasks;
GO

IF EXISTS (
    SELECT 1 FROM sys.indexes
     WHERE name = 'IX_tblTasks_WorkspaceId_ColumnId'
       AND object_id = OBJECT_ID('dbo.tblTasks')
)
    DROP INDEX IX_tblTasks_WorkspaceId_ColumnId ON dbo.tblTasks;
GO

IF EXISTS (
    SELECT 1 FROM sys.columns
     WHERE object_id = OBJECT_ID('dbo.tblTasks')
       AND name      = 'Status'
)
BEGIN
    DECLARE @dc SYSNAME;
    SELECT @dc = dc.name
      FROM sys.default_constraints dc
      JOIN sys.columns c ON c.default_object_id = dc.object_id
     WHERE c.object_id = OBJECT_ID('dbo.tblTasks')
       AND c.name      = 'Status';
    IF @dc IS NOT NULL
        EXEC('ALTER TABLE dbo.tblTasks DROP CONSTRAINT ' + @dc);

    ALTER TABLE dbo.tblTasks DROP COLUMN Status;
    PRINT 'Dropped tblTasks.Status';
END
GO

-- Recreate the hot-path index without Status.
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
     WHERE name = 'IX_tblTasks_WorkspaceId_ColumnId'
       AND object_id = OBJECT_ID('dbo.tblTasks')
)
BEGIN
    CREATE INDEX IX_tblTasks_WorkspaceId_ColumnId
        ON dbo.tblTasks (WorkspaceId, ColumnId)
     INCLUDE (Priority, AssignedToUserId);
    PRINT 'Rebuilt IX_tblTasks_WorkspaceId_ColumnId';
END
GO

PRINT 'Migration 022b complete — Status fully removed.';
GO
