-- ============================================================
-- Rollback for migration 010 — workspace foundation
--
-- Reverses every schema change from 010_workspace_foundation.sql.
-- Order: drop FKs → drop new tables → undo ALTERs on existing tables.
-- Safe only while DB has no rows in new tables (enforced by Phase 1
-- context: empty DB). If data exists, back up tblWorkspaces*,
-- tblTaskReads, tblCommentReads, tblNotifications, tblTaskDependencies
-- before running.
-- ============================================================

USE [eCRM+]
GO

SET XACT_ABORT ON
GO

BEGIN TRANSACTION;

-- ---------- Undo tblKanbanColumns rename ----------
IF EXISTS (
    SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblKanbanColumns') AND name = 'WorkspaceId'
)
AND NOT EXISTS (
    SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblKanbanColumns') AND name = 'ProjectId'
)
BEGIN
    EXEC sp_rename 'dbo.tblKanbanColumns.WorkspaceId', 'ProjectId', 'COLUMN';
    ALTER TABLE dbo.tblKanbanColumns ALTER COLUMN ProjectId INT NULL;
END;

-- ---------- Undo tblTaskComments additions ----------
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_tblTaskComments_Parent')
    ALTER TABLE dbo.tblTaskComments DROP CONSTRAINT FK_tblTaskComments_Parent;

IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_tblTaskComments_IsDeleted')
    ALTER TABLE dbo.tblTaskComments DROP CONSTRAINT DF_tblTaskComments_IsDeleted;
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblTaskComments') AND name = 'IsDeleted')
    ALTER TABLE dbo.tblTaskComments DROP COLUMN IsDeleted;

IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_tblTaskComments_IsPinned')
    ALTER TABLE dbo.tblTaskComments DROP CONSTRAINT DF_tblTaskComments_IsPinned;
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblTaskComments') AND name = 'IsPinned')
    ALTER TABLE dbo.tblTaskComments DROP COLUMN IsPinned;

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblTaskComments') AND name = 'UpdatedDate')
    ALTER TABLE dbo.tblTaskComments DROP COLUMN UpdatedDate;

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblTaskComments') AND name = 'ParentCommentId')
    ALTER TABLE dbo.tblTaskComments DROP COLUMN ParentCommentId;

-- ---------- Undo tblTasks additions ----------
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_tblTasks_Workspace')
    ALTER TABLE dbo.tblTasks DROP CONSTRAINT FK_tblTasks_Workspace;

-- Re-add Dependencies column (legacy JSON, no longer source of truth)
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblTasks') AND name = 'Dependencies')
    ALTER TABLE dbo.tblTasks ADD Dependencies NVARCHAR(MAX) NULL;

-- TeamId back to NOT NULL (legacy state — kept lax; flip manually if your seed requires it)
-- NOTE: skipping auto-flip because prior state had notnull=true + null-default mismatch.
-- Manual restore only if needed: ALTER TABLE dbo.tblTasks ALTER COLUMN TeamId INT NOT NULL;

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblTasks') AND name = 'UpdatedDate')
    ALTER TABLE dbo.tblTasks DROP COLUMN UpdatedDate;
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblTasks') AND name = 'CompletedByUserId')
    ALTER TABLE dbo.tblTasks DROP COLUMN CompletedByUserId;
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblTasks') AND name = 'CompletedDate')
    ALTER TABLE dbo.tblTasks DROP COLUMN CompletedDate;
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.tblTasks') AND name = 'WorkspaceId')
    ALTER TABLE dbo.tblTasks DROP COLUMN WorkspaceId;

-- ---------- Drop new tables (children first) ----------
IF OBJECT_ID('dbo.tblNotificationPreferences', 'U') IS NOT NULL DROP TABLE dbo.tblNotificationPreferences;
IF OBJECT_ID('dbo.tblUserPushTokens',         'U') IS NOT NULL DROP TABLE dbo.tblUserPushTokens;
IF OBJECT_ID('dbo.tblTaskDependencies',       'U') IS NOT NULL DROP TABLE dbo.tblTaskDependencies;
IF OBJECT_ID('dbo.tblNotifications',          'U') IS NOT NULL DROP TABLE dbo.tblNotifications;
IF OBJECT_ID('dbo.tblCommentReads',           'U') IS NOT NULL DROP TABLE dbo.tblCommentReads;
IF OBJECT_ID('dbo.tblTaskReads',              'U') IS NOT NULL DROP TABLE dbo.tblTaskReads;
IF OBJECT_ID('dbo.tblWorkspaceMembers',       'U') IS NOT NULL DROP TABLE dbo.tblWorkspaceMembers;
IF OBJECT_ID('dbo.tblWorkspaces',             'U') IS NOT NULL DROP TABLE dbo.tblWorkspaces;

COMMIT TRANSACTION;
GO

PRINT 'migration 010 rolled back';
GO
