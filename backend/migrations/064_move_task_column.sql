-- =============================================================================
-- 064_move_task_column.sql
--
-- Workstream 4, final piece. Moving a card between columns becomes its own
-- operation, gated as change_status.
--
-- TWO BUGS THIS CLOSES
--
-- 1. Dragging a card could not be done by the person doing the work.
--    Drag-and-drop round-trips through sp_SaveTask, which checks 'edit_fields'
--    on update — owner/manager/creator only. So change_status, the action whose
--    entire purpose is "let the assignee progress the work", governed the
--    checkbox but not the column. An assignee could tick every box, watch the
--    task flip to complete, and still not move the card out of To Do.
--
-- 2. Dragging could silently drop co-assignees.
--    The board re-sends the whole task, including AssignedToUserId. Under 063
--    that parameter is a legacy single-assignee alias, so it sets
--    @HasAssigneeInput = 1 and REPLACES the assignee set with that one person.
--    A card with two assignees would quietly lose one every time it moved.
--
-- A dedicated proc fixes both by construction: it touches ColumnId and nothing
-- else, so there is no assignee payload to get wrong, and it asks for the
-- action that actually matches the gesture.
--
-- No schema changes.
-- =============================================================================

IF OBJECT_ID('dbo.sp_MoveTaskColumn', 'P') IS NULL
    EXEC('CREATE PROC dbo.sp_MoveTaskColumn AS SET NOCOUNT ON;');
GO

ALTER PROC dbo.sp_MoveTaskColumn
    @TaskId    BIGINT,
    @ColumnId  INT,
    @UserId    INT,
    @IsAdmin   BIT    = 0,
    @CompId    BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);
    DECLARE @WorkspaceId BIGINT;

    IF (@TaskId IS NULL OR @TaskId <= 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Task ID is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    SELECT @WorkspaceId = WorkspaceId FROM dbo.tblTasks WHERE Id = @TaskId;

    IF (@WorkspaceId IS NULL AND NOT EXISTS (SELECT 1 FROM dbo.tblTasks WHERE Id = @TaskId))
    BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Task not found';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- Moving a card IS the status change. Assignees get this; it is the whole
    -- point of the action.
    DECLARE @PermTable TABLE (Allowed BIT, Reason VARCHAR(400));
    INSERT INTO @PermTable
    EXEC dbo.sp_CheckTaskPermission
        @TaskId = @TaskId, @WorkspaceId = NULL, @CommentId = NULL,
        @UserId = @UserId, @Action = 'change_status',
        @IsAdmin = @IsAdmin, @CompId = @CompId;

    IF NOT EXISTS (SELECT 1 FROM @PermTable WHERE Allowed = 1)
    BEGIN
        DECLARE @Reason VARCHAR(400) = (SELECT TOP 1 Reason FROM @PermTable);
        SET @ResponseCode = 403;
        SET @ResponseMess = 'Permission denied: ' + ISNULL(@Reason, 'no reason');
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
    END

    -- The column must belong to this task's workspace, or a caller could park a
    -- card on someone else's board.
    IF (@ColumnId IS NOT NULL AND @ColumnId > 0
        AND NOT EXISTS (SELECT 1 FROM dbo.tblKanbanColumns
                         WHERE Id = @ColumnId AND WorkspaceId = @WorkspaceId AND IsActive = 1))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Column does not belong to this workspace';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    UPDATE dbo.tblTasks
       SET ColumnId = @ColumnId,
           UpdatedDate = GETDATE()
     WHERE Id = @TaskId;

    SET @ResponseCode = 200; SET @ResponseMess = 'Task moved';
    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
           @TaskId AS TaskId, @WorkspaceId AS WorkspaceId;
END
GO

-- =============================================================================
-- Verify after apply
-- =============================================================================
-- 1. Proc exists and asks for change_status:
--
-- SELECT CASE WHEN m.definition LIKE '%change_status%' THEN 'OK' ELSE 'NOT APPLIED' END AS Status
-- FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
-- WHERE o.name = 'sp_MoveTaskColumn';
--
-- 2. THE POINT — the assignee can move their own card. Task 10030 (workspace
--    10011) is created by Raaj(3) and assigned to Ayush(2), who is a plain
--    member and could not drag it before:
--
-- BEGIN TRAN;
--   DECLARE @col INT = (SELECT TOP 1 Id FROM tblKanbanColumns
--                        WHERE WorkspaceId = 10011 AND IsActive = 1 ORDER BY SortOrder DESC);
--   EXEC sp_MoveTaskColumn @TaskId=10030, @ColumnId=@col, @UserId=2, @IsAdmin=0, @CompId=1;
--   -- expect 200 'Task moved'   [sp_SaveTask would have returned 403 edit_fields]
-- ROLLBACK TRAN;
--
-- 3. A member who is neither assignee nor creator still cannot:
--
-- EXEC sp_MoveTaskColumn @TaskId=10030, @ColumnId=1, @UserId=11, @IsAdmin=0, @CompId=1;
-- -- expect 403
--
-- 4. Assignees survive a move — this is the co-assignee drop the old drag path
--    would have caused, since it re-sent AssignedToUserId as a legacy alias:
--
-- SELECT COUNT(*) FROM tblTaskAssignee WHERE TaskId = 10030;  -- note it
-- -- run verify 2 above, then re-run this: expect the same count
-- =============================================================================
