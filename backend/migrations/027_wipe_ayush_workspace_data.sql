-- ============================================================
-- Migration 027 — Wipe Ayush's (UserId = 2) workspace data.
--
-- Deletes every workspace Ayush owns, plus every child row that
-- hangs off those workspaces or tasks created by Ayush:
--   tblTaskDependencies
--   tblCommentReads
--   tblTaskComments
--   tblTaskReads
--   tblTaskChecklist      (if present)
--   tblTimeEntries         (if present)
--   tblNotifications       (task + workspace scoped)
--   tblActivityLog         (task + workspace scoped)
--   tblTasks
--   tblKanbanColumns
--   tblWorkspaceMembers
--   tblWorkspaces
--
-- Safe to re-run: all DELETEs filter by current state.
-- On next login Ayush's personal workspace is re-seeded automatically
-- by sp_SeedDefaultWorkspace.
-- ============================================================

USE [eCRM+];
GO

DECLARE @UserId INT = 2;

-- Collect target workspaces (owned by Ayush) + orphan tasks he created
DECLARE @Workspaces TABLE (Id BIGINT PRIMARY KEY);
INSERT INTO @Workspaces (Id)
SELECT Id FROM dbo.tblWorkspaces WHERE OwnerUserId = @UserId;

DECLARE @Tasks TABLE (Id BIGINT PRIMARY KEY);
INSERT INTO @Tasks (Id)
SELECT Id FROM dbo.tblTasks
 WHERE WorkspaceId IN (SELECT Id FROM @Workspaces)
    OR CreatedByUserId = @UserId;

PRINT CONCAT('Workspaces targeted: ', (SELECT COUNT(*) FROM @Workspaces));
PRINT CONCAT('Tasks targeted:      ', (SELECT COUNT(*) FROM @Tasks));

BEGIN TRY
    BEGIN TRANSACTION;

    -- Children of tasks
    IF OBJECT_ID('dbo.tblTaskDependencies','U') IS NOT NULL
        DELETE FROM dbo.tblTaskDependencies
         WHERE TaskId          IN (SELECT Id FROM @Tasks)
            OR DependsOnTaskId IN (SELECT Id FROM @Tasks);

    IF OBJECT_ID('dbo.tblCommentReads','U') IS NOT NULL
        DELETE FROM dbo.tblCommentReads
         WHERE CommentId IN (
               SELECT Id FROM dbo.tblTaskComments
                WHERE TaskId IN (SELECT Id FROM @Tasks)
         );

    IF OBJECT_ID('dbo.tblTaskComments','U') IS NOT NULL
        DELETE FROM dbo.tblTaskComments
         WHERE TaskId IN (SELECT Id FROM @Tasks);

    IF OBJECT_ID('dbo.tblTaskReads','U') IS NOT NULL
        DELETE FROM dbo.tblTaskReads
         WHERE TaskId IN (SELECT Id FROM @Tasks);

    IF OBJECT_ID('dbo.tblTaskChecklist','U') IS NOT NULL
        DELETE FROM dbo.tblTaskChecklist
         WHERE TaskId IN (SELECT Id FROM @Tasks);

    IF OBJECT_ID('dbo.tblTimeEntries','U') IS NOT NULL
        DELETE FROM dbo.tblTimeEntries
         WHERE TaskId IN (SELECT Id FROM @Tasks);

    IF OBJECT_ID('dbo.tblNotifications','U') IS NOT NULL
        DELETE FROM dbo.tblNotifications
         WHERE (EntityType = 'task'      AND EntityId IN (SELECT Id FROM @Tasks))
            OR (EntityType = 'workspace' AND EntityId IN (SELECT Id FROM @Workspaces));

    IF OBJECT_ID('dbo.tblActivityLog','U') IS NOT NULL
        DELETE FROM dbo.tblActivityLog
         WHERE (EntityType = 'Task'      AND EntityId IN (SELECT Id FROM @Tasks))
            OR (EntityType = 'Workspace' AND EntityId IN (SELECT Id FROM @Workspaces));

    -- Tasks first so ColumnId FK releases before we drop columns
    DELETE FROM dbo.tblTasks
     WHERE Id IN (SELECT Id FROM @Tasks);

    -- Board scaffolding
    DELETE FROM dbo.tblKanbanColumns
     WHERE WorkspaceId IN (SELECT Id FROM @Workspaces);

    DELETE FROM dbo.tblWorkspaceMembers
     WHERE WorkspaceId IN (SELECT Id FROM @Workspaces);

    DELETE FROM dbo.tblWorkspaces
     WHERE Id IN (SELECT Id FROM @Workspaces);

    COMMIT TRANSACTION;
    PRINT 'Migration 027 complete — Ayush''s workspace data wiped.';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    PRINT 'Migration 027 failed: ' + ERROR_MESSAGE();
    THROW;
END CATCH
GO
