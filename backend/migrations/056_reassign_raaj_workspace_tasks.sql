-- 056_reassign_raaj_workspace_tasks.sql
-- ============================================================================
-- DATA FIX (one-off, not schema).
--
-- Workspace 10007 "Ayush's Tasks" is owned by Raaj (UserId 3) with Ayush
-- (UserId 2) as a `member`. Raaj created all 7 tasks AND left every one of
-- them assigned to himself, so Ayush was neither creator nor assignee — the
-- permission model correctly refused him the checklist, which is not what
-- Raaj meant when he named the workspace "Ayush's Tasks".
--
-- This hands the work over properly: AssignedToUserId -> Ayush. CreatedBy
-- stays Raaj (he did create them — that's history, not permission).
--
-- After this, Ayush can tick checklist items (change_status grants the
-- assignee) but still cannot add/remove items or edit fields (edit_fields
-- stays creator/manager). If Raaj wants Ayush to restructure the tasks too,
-- the answer is to make Ayush a `manager` instead — see the OPTIONAL block
-- at the bottom, commented out on purpose.
--
-- Idempotent: re-running changes nothing once the rows already point at Ayush.
-- ============================================================================
USE [eCRM+];
GO

BEGIN TRANSACTION;

    DECLARE @WorkspaceId BIGINT = 10007,
            @Ayush       INT    = 2,
            @Raaj        INT    = 3;

    -- Safety: bail out if the workspace isn't the one this script was written
    -- for (ids differ per environment).
    IF NOT EXISTS (
        SELECT 1 FROM dbo.tblWorkspaces
         WHERE Id = @WorkspaceId AND OwnerUserId = @Raaj AND Type = 'shared'
    )
    BEGIN
        RAISERROR('Workspace 10007 is not Raaj''s shared workspace here — aborting.', 16, 1);
        ROLLBACK TRANSACTION;
        RETURN;
    END

    -- Ayush must already be an active member; this script hands over work, it
    -- does not grant access.
    IF NOT EXISTS (
        SELECT 1 FROM dbo.tblWorkspaceMembers
         WHERE WorkspaceId = @WorkspaceId AND UserId = @Ayush
           AND IsActive = 1 AND InviteStatus = 'active'
    )
    BEGIN
        RAISERROR('Ayush is not an active member of workspace 10007 — aborting.', 16, 1);
        ROLLBACK TRANSACTION;
        RETURN;
    END

    UPDATE dbo.tblTasks
       SET AssignedToUserId = @Ayush
     WHERE WorkspaceId      = @WorkspaceId
       AND AssignedToUserId = @Raaj;

    PRINT CONCAT('Tasks reassigned to Ayush: ', @@ROWCOUNT);

COMMIT TRANSACTION;
GO

-- ============================================================================
-- VERIFY AFTER APPLY
-- Expected:
--   1. every row shows AssignedTo = Ayush (CreatedBy stays Raaj)
--   2. Allowed = 1 for change_status  -> Ayush can tick the checklist
--   3. Allowed = 0 for edit_fields    -> he still can't restructure the task
-- ============================================================================
SELECT t.Id, t.Title, cu.FullName AS CreatedBy, au.FullName AS AssignedTo,
       (SELECT COUNT(*) FROM dbo.tblTaskChecklist c WHERE c.TaskId = t.Id) AS ChecklistItems
  FROM dbo.tblTasks t
  LEFT JOIN dbo.tblUser cu ON cu.Id = t.CreatedByUserId
  LEFT JOIN dbo.tblUser au ON au.Id = t.AssignedToUserId
 WHERE t.WorkspaceId = 10007
 ORDER BY t.Id;                                                      -- (1)

DECLARE @ProbeTask BIGINT = (SELECT MIN(Id) FROM dbo.tblTasks WHERE WorkspaceId = 10007);

EXEC dbo.sp_CheckTaskPermission
     @TaskId = @ProbeTask, @UserId = 2, @Action = 'change_status',
     @IsAdmin = 0, @CompId = 1;                                      -- (2)

EXEC dbo.sp_CheckTaskPermission
     @TaskId = @ProbeTask, @UserId = 2, @Action = 'edit_fields',
     @IsAdmin = 0, @CompId = 1;                                      -- (3)
GO

-- ============================================================================
-- OPTIONAL — only if Raaj wants Ayush to fully own these tasks (add/remove
-- checklist items, edit fields, reassign). Uncomment and run separately.
-- ============================================================================
-- UPDATE dbo.tblWorkspaceMembers
--    SET Role = 'manager'
--  WHERE WorkspaceId = 10007 AND UserId = 2;
