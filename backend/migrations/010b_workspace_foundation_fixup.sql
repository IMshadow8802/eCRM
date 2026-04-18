-- ============================================================
-- Migration 010b — Fixup for 010_workspace_foundation
--
-- Completes work rolled back by 010 when ALTER COLUMN on
-- tblKanbanColumns.WorkspaceId failed due to index/FK dependency.
--
-- After 010 the 8 new tables exist, but:
--   * tblTasks missing: WorkspaceId, CompletedDate, CompletedByUserId,
--                       UpdatedDate, FK_tblTasks_Workspace
--   * tblTasks still has: Dependencies column (should be dropped)
--   * tblTaskComments missing: ParentCommentId, UpdatedDate,
--                              IsPinned, IsDeleted, FK_tblTaskComments_Parent
--   * tblKanbanColumns still has: ProjectId (should be renamed + widened)
--   * tblKanbanColumns has: FK_KanbanColumns_Projects + IX_KanbanColumns_ProjectId
--                           which blocked the rename
--
-- Strategy this run: no outer transaction. Each ALTER is its own
-- auto-committed DDL batch so one error doesn't roll back the rest.
-- Every block is idempotent via IF EXISTS / IF NOT EXISTS guards so
-- safe to re-run.
-- ============================================================

USE [eCRM+]
GO

SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- ============================================================
-- 1) tblKanbanColumns — drop dependent objects, rename, widen, recreate index
-- ============================================================

-- Drop FK to tblProjects (the rename target is tblWorkspaces now, different type)
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_KanbanColumns_Projects')
    ALTER TABLE dbo.tblKanbanColumns DROP CONSTRAINT FK_KanbanColumns_Projects;
GO

-- Drop index on old column
IF EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.tblKanbanColumns') AND name = 'IX_KanbanColumns_ProjectId'
)
    DROP INDEX IX_KanbanColumns_ProjectId ON dbo.tblKanbanColumns;
GO

-- Rename ProjectId → WorkspaceId (only if still named ProjectId)
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblKanbanColumns') AND name = 'ProjectId')
   AND NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblKanbanColumns') AND name = 'WorkspaceId')
BEGIN
    EXEC sp_rename 'dbo.tblKanbanColumns.ProjectId', 'WorkspaceId', 'COLUMN';
END;
GO

-- Widen WorkspaceId to BIGINT (to match tblWorkspaces.Id) + allow NULL during transition
ALTER TABLE dbo.tblKanbanColumns ALTER COLUMN WorkspaceId BIGINT NULL;
GO

-- Recreate index on new column
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.tblKanbanColumns') AND name = 'IX_KanbanColumns_WorkspaceId'
)
    CREATE INDEX IX_KanbanColumns_WorkspaceId ON dbo.tblKanbanColumns (WorkspaceId);
GO

-- FK to tblWorkspaces
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_KanbanColumns_Workspace')
    ALTER TABLE dbo.tblKanbanColumns
        ADD CONSTRAINT FK_KanbanColumns_Workspace FOREIGN KEY (WorkspaceId)
            REFERENCES dbo.tblWorkspaces (Id);
GO

-- ============================================================
-- 2) tblTasks — add missing columns, drop Dependencies, add FK
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblTasks') AND name = 'WorkspaceId')
    ALTER TABLE dbo.tblTasks ADD WorkspaceId BIGINT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblTasks') AND name = 'CompletedDate')
    ALTER TABLE dbo.tblTasks ADD CompletedDate DATETIME NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblTasks') AND name = 'CompletedByUserId')
    ALTER TABLE dbo.tblTasks ADD CompletedByUserId INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblTasks') AND name = 'UpdatedDate')
    ALTER TABLE dbo.tblTasks ADD UpdatedDate DATETIME NULL;
GO

-- Drop Dependencies column (moved to tblTaskDependencies FK table)
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblTasks') AND name = 'Dependencies')
BEGIN
    DECLARE @df_deps sysname;
    SELECT @df_deps = dc.name
    FROM sys.default_constraints dc
    JOIN sys.columns c ON c.default_object_id = dc.object_id
    WHERE c.object_id = OBJECT_ID('dbo.tblTasks') AND c.name = 'Dependencies';
    IF @df_deps IS NOT NULL
        EXEC('ALTER TABLE dbo.tblTasks DROP CONSTRAINT ' + @df_deps);
    ALTER TABLE dbo.tblTasks DROP COLUMN Dependencies;
END;
GO

-- FK on WorkspaceId
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_tblTasks_Workspace')
    ALTER TABLE dbo.tblTasks
        ADD CONSTRAINT FK_tblTasks_Workspace FOREIGN KEY (WorkspaceId)
            REFERENCES dbo.tblWorkspaces (Id);
GO

-- ============================================================
-- 3) tblTaskComments — threading + soft delete + pin
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblTaskComments') AND name = 'ParentCommentId')
    ALTER TABLE dbo.tblTaskComments ADD ParentCommentId BIGINT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblTaskComments') AND name = 'UpdatedDate')
    ALTER TABLE dbo.tblTaskComments ADD UpdatedDate DATETIME NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblTaskComments') AND name = 'IsPinned')
    ALTER TABLE dbo.tblTaskComments ADD IsPinned BIT NOT NULL
        CONSTRAINT DF_tblTaskComments_IsPinned DEFAULT (0);
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblTaskComments') AND name = 'IsDeleted')
    ALTER TABLE dbo.tblTaskComments ADD IsDeleted BIT NOT NULL
        CONSTRAINT DF_tblTaskComments_IsDeleted DEFAULT (0);
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_tblTaskComments_Parent')
    ALTER TABLE dbo.tblTaskComments
        ADD CONSTRAINT FK_tblTaskComments_Parent FOREIGN KEY (ParentCommentId)
            REFERENCES dbo.tblTaskComments (Id);
GO

-- ============================================================
-- 4) Sanity check — verify every target change landed
-- ============================================================
PRINT '----- migration 010b sanity -----';

SELECT 'tblKanbanColumns.WorkspaceId' AS chk,
       CASE WHEN EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.tblKanbanColumns') AND name='WorkspaceId')
            THEN 'OK' ELSE 'MISSING' END AS status
UNION ALL SELECT 'tblKanbanColumns.ProjectId (should be gone)',
       CASE WHEN EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.tblKanbanColumns') AND name='ProjectId')
            THEN 'STILL PRESENT' ELSE 'OK' END
UNION ALL SELECT 'FK_KanbanColumns_Workspace',
       CASE WHEN EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name='FK_KanbanColumns_Workspace') THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'tblTasks.WorkspaceId',
       CASE WHEN EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.tblTasks') AND name='WorkspaceId') THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'tblTasks.CompletedDate',
       CASE WHEN EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.tblTasks') AND name='CompletedDate') THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'tblTasks.CompletedByUserId',
       CASE WHEN EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.tblTasks') AND name='CompletedByUserId') THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'tblTasks.UpdatedDate',
       CASE WHEN EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.tblTasks') AND name='UpdatedDate') THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'tblTasks.Dependencies (should be gone)',
       CASE WHEN EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.tblTasks') AND name='Dependencies') THEN 'STILL PRESENT' ELSE 'OK' END
UNION ALL SELECT 'FK_tblTasks_Workspace',
       CASE WHEN EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name='FK_tblTasks_Workspace') THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'tblTaskComments.ParentCommentId',
       CASE WHEN EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.tblTaskComments') AND name='ParentCommentId') THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'tblTaskComments.IsPinned',
       CASE WHEN EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.tblTaskComments') AND name='IsPinned') THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'tblTaskComments.IsDeleted',
       CASE WHEN EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.tblTaskComments') AND name='IsDeleted') THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'tblTaskComments.UpdatedDate',
       CASE WHEN EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.tblTaskComments') AND name='UpdatedDate') THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'FK_tblTaskComments_Parent',
       CASE WHEN EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name='FK_tblTaskComments_Parent') THEN 'OK' ELSE 'MISSING' END;
GO
