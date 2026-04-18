-- ============================================================
-- Migration 029 — Rewire task delete SPs on sp_CheckTaskPermission
--                 + treat open subtasks as implicit blockers.
--
-- Fixes:
--   • sp_BulkDeleteTasks referenced tblProjects.Members and the old
--     legacy access model. Personal-workspace tasks (ProjectId NULL)
--     always 403'd. Now delegates to sp_CheckTaskPermission.
--   • sp_DeleteTask similarly tightened to the same path.
--   • sp_SaveTask blocks transition to an IsDone column if the task
--     has any active subtasks whose column isn't IsDone.
--     A parent can't be "done" while its own breakdown isn't.
-- ============================================================

USE [eCRM+];
GO

-- ----- sp_DeleteTask ------------------------------------------
IF OBJECT_ID('dbo.sp_DeleteTask', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_DeleteTask;
GO

CREATE PROCEDURE dbo.sp_DeleteTask
    @Id       BIGINT,
    @UserId   INT,
    @IsAdmin  BIT     = 0,
    @CompId   BIGINT,
    @BranchId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);

    IF (@Id IS NULL OR @Id <= 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Task Id is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM dbo.tblTasks WHERE Id = @Id)
    BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Task not found';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    DECLARE @Perm TABLE (Allowed BIT, Reason VARCHAR(400));
    INSERT INTO @Perm
    EXEC dbo.sp_CheckTaskPermission
        @TaskId = @Id, @WorkspaceId = NULL, @CommentId = NULL,
        @UserId = @UserId, @Action = 'delete_task',
        @IsAdmin = @IsAdmin, @CompId = @CompId;

    IF NOT EXISTS (SELECT 1 FROM @Perm WHERE Allowed = 1)
    BEGIN
        SET @ResponseCode = 403;
        SET @ResponseMess = 'Permission denied: ' + ISNULL((SELECT TOP 1 Reason FROM @Perm), 'no reason');
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
    END

    IF EXISTS (SELECT 1 FROM dbo.tblTasks WHERE ParentTaskId = @Id)
    BEGIN SET @ResponseCode = 409;
          SET @ResponseMess = 'Task has subtasks. Delete or reparent them first.';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;

        IF OBJECT_ID('dbo.tblTaskDependencies', 'U') IS NOT NULL
            DELETE FROM dbo.tblTaskDependencies
             WHERE TaskId = @Id OR DependsOnTaskId = @Id;

        IF OBJECT_ID('dbo.tblCommentReads', 'U') IS NOT NULL
            DELETE FROM dbo.tblCommentReads
             WHERE CommentId IN (SELECT Id FROM dbo.tblTaskComments WHERE TaskId = @Id);

        IF OBJECT_ID('dbo.tblTaskComments', 'U') IS NOT NULL
            DELETE FROM dbo.tblTaskComments WHERE TaskId = @Id;

        IF OBJECT_ID('dbo.tblTaskReads', 'U') IS NOT NULL
            DELETE FROM dbo.tblTaskReads WHERE TaskId = @Id;

        IF OBJECT_ID('dbo.tblTaskChecklist', 'U') IS NOT NULL
            DELETE FROM dbo.tblTaskChecklist WHERE TaskId = @Id;

        IF OBJECT_ID('dbo.tblTimeEntries', 'U') IS NOT NULL
            DELETE FROM dbo.tblTimeEntries WHERE TaskId = @Id;

        DELETE FROM dbo.tblTasks WHERE Id = @Id;

        COMMIT TRANSACTION;
        SET @ResponseCode = 200; SET @ResponseMess = 'Task deleted';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, @Id AS TaskId;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SET @ResponseCode = 500;
        SET @ResponseMess = 'Delete failed: ' + ERROR_MESSAGE();
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END CATCH
END
GO

-- ----- sp_BulkDeleteTasks -------------------------------------
IF OBJECT_ID('dbo.sp_BulkDeleteTasks', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_BulkDeleteTasks;
GO

CREATE PROCEDURE dbo.sp_BulkDeleteTasks
    @TaskIds  NVARCHAR(MAX),
    @UserId   INT,
    @CompId   BIGINT,
    @BranchId BIGINT,
    @IsAdmin  BIT     = 0
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);
    DECLARE @DeletedCount INT = 0;

    IF (@TaskIds IS NULL OR LTRIM(RTRIM(@TaskIds)) = '')
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Task IDs are required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    DECLARE @Targets TABLE (TaskId BIGINT PRIMARY KEY);
    INSERT INTO @Targets (TaskId)
    SELECT DISTINCT CAST(value AS BIGINT)
      FROM STRING_SPLIT(@TaskIds, ',')
     WHERE ISNUMERIC(value) = 1;

    -- Reject if any target has subtasks still parented under it.
    IF EXISTS (
        SELECT 1 FROM dbo.tblTasks t
        INNER JOIN @Targets tgt ON t.ParentTaskId = tgt.TaskId
    )
    BEGIN
        SET @ResponseCode = 409;
        SET @ResponseMess = 'One or more tasks have subtasks. Delete subtasks first.';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
        RETURN;
    END

    -- Permission check per task via sp_CheckTaskPermission
    DECLARE @FailedId BIGINT = NULL;
    DECLARE @CurrentId BIGINT;
    DECLARE cur CURSOR LOCAL FAST_FORWARD FOR SELECT TaskId FROM @Targets;
    OPEN cur;
    FETCH NEXT FROM cur INTO @CurrentId;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        DECLARE @Perm TABLE (Allowed BIT, Reason VARCHAR(400));
        INSERT INTO @Perm
        EXEC dbo.sp_CheckTaskPermission
            @TaskId = @CurrentId, @WorkspaceId = NULL, @CommentId = NULL,
            @UserId = @UserId, @Action = 'delete_task',
            @IsAdmin = @IsAdmin, @CompId = @CompId;

        IF NOT EXISTS (SELECT 1 FROM @Perm WHERE Allowed = 1)
        BEGIN
            SET @FailedId = @CurrentId;
            BREAK;
        END
        DELETE FROM @Perm;
        FETCH NEXT FROM cur INTO @CurrentId;
    END
    CLOSE cur; DEALLOCATE cur;

    IF (@FailedId IS NOT NULL)
    BEGIN
        SET @ResponseCode = 403;
        SET @ResponseMess = CONCAT('Permission denied for task #', @FailedId);
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
        RETURN;
    END

    BEGIN TRY
        BEGIN TRANSACTION;

        IF OBJECT_ID('dbo.tblTaskDependencies', 'U') IS NOT NULL
            DELETE FROM dbo.tblTaskDependencies
             WHERE TaskId IN (SELECT TaskId FROM @Targets)
                OR DependsOnTaskId IN (SELECT TaskId FROM @Targets);

        IF OBJECT_ID('dbo.tblCommentReads', 'U') IS NOT NULL
            DELETE FROM dbo.tblCommentReads
             WHERE CommentId IN (
                   SELECT Id FROM dbo.tblTaskComments
                    WHERE TaskId IN (SELECT TaskId FROM @Targets));

        IF OBJECT_ID('dbo.tblTaskComments', 'U') IS NOT NULL
            DELETE FROM dbo.tblTaskComments
             WHERE TaskId IN (SELECT TaskId FROM @Targets);

        IF OBJECT_ID('dbo.tblTaskReads', 'U') IS NOT NULL
            DELETE FROM dbo.tblTaskReads
             WHERE TaskId IN (SELECT TaskId FROM @Targets);

        IF OBJECT_ID('dbo.tblTaskChecklist', 'U') IS NOT NULL
            DELETE FROM dbo.tblTaskChecklist
             WHERE TaskId IN (SELECT TaskId FROM @Targets);

        IF OBJECT_ID('dbo.tblTimeEntries', 'U') IS NOT NULL
            DELETE FROM dbo.tblTimeEntries
             WHERE TaskId IN (SELECT TaskId FROM @Targets);

        DELETE FROM dbo.tblTasks
         WHERE Id IN (SELECT TaskId FROM @Targets);
        SET @DeletedCount = @@ROWCOUNT;

        COMMIT TRANSACTION;
        SET @ResponseCode = 200;
        SET @ResponseMess = CONCAT('Deleted ', @DeletedCount, ' task(s)');
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               @DeletedCount AS DeletedCount, 0 AS FailedCount;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SET @ResponseCode = 500;
        SET @ResponseMess = 'Bulk delete failed: ' + ERROR_MESSAGE();
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END CATCH
END
GO

-- ============================================================
-- Extend sp_SaveTask: open subtasks block parent from entering
-- an IsDone column. (Dependencies already cover sibling links;
-- this layers an implicit parent↔subtask block on top.)
-- ============================================================
IF OBJECT_ID('dbo.sp_SaveTask', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_SaveTask;
GO

CREATE PROCEDURE dbo.sp_SaveTask
    @Id                BIGINT          = 0,
    @Title             VARCHAR(500),
    @Description       NVARCHAR(MAX)   = NULL,
    @WorkspaceId       BIGINT          = NULL,
    @ColumnId          INT             = NULL,
    @ProjectId         INT             = NULL,
    @ParentTaskId      BIGINT          = NULL,
    @AssignedToUserId  INT             = NULL,
    @CreatedByUserId   INT,
    @TeamId            INT             = NULL,
    @Priority          VARCHAR(20)     = 'medium',
    @Type              VARCHAR(50)     = 'task',
    @DueDate           DATE            = NULL,
    @EstimatedHours    DECIMAL(10,2)   = 0,
    @LoggedHours       DECIMAL(10,2)   = 0,
    @Progress          DECIMAL(5,2)    = 0,
    @IsBlocked         BIT             = 0,
    @Labels            NVARCHAR(MAX)   = NULL,
    @Watchers          NVARCHAR(MAX)   = NULL,
    @Dependencies      NVARCHAR(MAX)   = NULL,
    @IsAdmin           BIT             = 0,
    @CompId            BIGINT,
    @BranchId          BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);

    IF (@Title IS NULL OR LTRIM(RTRIM(@Title)) = '')
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Task title is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@CreatedByUserId IS NULL OR @CreatedByUserId <= 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Created by user is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@WorkspaceId IS NOT NULL AND @WorkspaceId > 0)
        IF NOT EXISTS (SELECT 1 FROM dbo.tblWorkspaces WHERE Id = @WorkspaceId AND CompId = @CompId)
        BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid workspace';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@ColumnId IS NOT NULL AND @ColumnId > 0)
        IF NOT EXISTS (
            SELECT 1 FROM dbo.tblKanbanColumns
             WHERE Id = @ColumnId AND WorkspaceId = @WorkspaceId AND IsActive = 1
        )
        BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Column does not belong to this workspace';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@ProjectId IS NOT NULL AND @ProjectId > 0
        AND NOT EXISTS (SELECT 1 FROM dbo.tblProjects WHERE Id = @ProjectId))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid project selected';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@AssignedToUserId IS NOT NULL AND @AssignedToUserId > 0
        AND NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Id = @AssignedToUserId AND IsActive = 1))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid assigned user selected';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@TeamId IS NOT NULL AND @TeamId > 0
        AND NOT EXISTS (SELECT 1 FROM dbo.tblTeams WHERE Id = @TeamId AND IsActive = 1))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid team selected';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@ParentTaskId IS NOT NULL AND @ParentTaskId > 0
        AND NOT EXISTS (SELECT 1 FROM dbo.tblTasks WHERE Id = @ParentTaskId))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid parent task selected';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    DECLARE @PermTable TABLE (Allowed BIT, Reason VARCHAR(400));
    DECLARE @OldColumnId INT;
    DECLARE @OldIsDone BIT, @NewIsDone BIT = 0;

    IF (@Id = 0)
    BEGIN
        IF (@WorkspaceId IS NULL OR @WorkspaceId <= 0)
        BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'WorkspaceId is required to create a task';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

        INSERT INTO @PermTable
        EXEC dbo.sp_CheckTaskPermission
            @TaskId = NULL, @WorkspaceId = @WorkspaceId, @CommentId = NULL,
            @UserId = @CreatedByUserId, @Action = 'create_task',
            @IsAdmin = @IsAdmin, @CompId = @CompId;
    END
    ELSE
    BEGIN
        SELECT @OldColumnId = ColumnId FROM dbo.tblTasks WHERE Id = @Id;
        IF NOT EXISTS (SELECT 1 FROM dbo.tblTasks WHERE Id = @Id)
        BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Task not found';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

        SELECT @OldIsDone = ISNULL(IsDone,0) FROM dbo.tblKanbanColumns WHERE Id = @OldColumnId;

        DECLARE @EditAction VARCHAR(50) =
            CASE WHEN @ColumnId IS NOT NULL AND @ColumnId <> @OldColumnId
                 THEN 'change_status' ELSE 'edit_fields' END;

        INSERT INTO @PermTable
        EXEC dbo.sp_CheckTaskPermission
            @TaskId = @Id, @WorkspaceId = NULL, @CommentId = NULL,
            @UserId = @CreatedByUserId, @Action = @EditAction,
            @IsAdmin = @IsAdmin, @CompId = @CompId;
    END

    IF NOT EXISTS (SELECT 1 FROM @PermTable WHERE Allowed = 1)
    BEGIN
        DECLARE @Reason VARCHAR(400) = (SELECT TOP 1 Reason FROM @PermTable);
        SET @ResponseCode = 403;
        SET @ResponseMess = 'Permission denied: ' + ISNULL(@Reason, 'no reason');
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
    END

    IF (@ColumnId IS NOT NULL)
        SELECT @NewIsDone = ISNULL(IsDone,0) FROM dbo.tblKanbanColumns WHERE Id = @ColumnId;

    -- Dependency block: explicit blockers
    IF (@Id > 0 AND @NewIsDone = 1 AND ISNULL(@OldIsDone,0) = 0)
    BEGIN
        IF EXISTS (
            SELECT 1
              FROM dbo.tblTaskDependencies d
              JOIN dbo.tblTasks b      ON b.Id = d.DependsOnTaskId
              LEFT JOIN dbo.tblKanbanColumns bc ON bc.Id = b.ColumnId
             WHERE d.TaskId = @Id
               AND d.Type = 'blocks'
               AND (bc.IsDone IS NULL OR bc.IsDone = 0)
        )
        BEGIN SET @ResponseCode = 409;
              SET @ResponseMess = 'Cannot move to Done — blocked by unfinished dependencies';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

        -- Implicit blocker: open subtasks (parent can't be done first).
        IF EXISTS (
            SELECT 1
              FROM dbo.tblTasks sub
              LEFT JOIN dbo.tblKanbanColumns sc ON sc.Id = sub.ColumnId
             WHERE sub.ParentTaskId = @Id
               AND (sc.IsDone IS NULL OR sc.IsDone = 0)
        )
        BEGIN SET @ResponseCode = 409;
              SET @ResponseMess = 'Cannot move to Done — open subtasks remain';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    END

    BEGIN TRY
        BEGIN TRANSACTION;

        IF (@Id = 0)
        BEGIN
            IF (@ColumnId IS NULL AND @WorkspaceId IS NOT NULL)
                SELECT TOP 1 @ColumnId = Id FROM dbo.tblKanbanColumns
                 WHERE WorkspaceId = @WorkspaceId AND IsActive = 1
                 ORDER BY SortOrder ASC, Id ASC;

            SELECT @NewIsDone = ISNULL(IsDone,0) FROM dbo.tblKanbanColumns WHERE Id = @ColumnId;

            INSERT INTO dbo.tblTasks
                (Title, Description, WorkspaceId, ColumnId, ProjectId, ParentTaskId,
                 AssignedToUserId, CreatedByUserId, TeamId, Priority, Type,
                 DueDate, EstimatedHours, LoggedHours, Progress, IsBlocked,
                 Labels, Watchers,
                 CompletedDate, CompletedByUserId, UpdatedDate)
            VALUES
                (@Title, @Description, @WorkspaceId, @ColumnId, @ProjectId, @ParentTaskId,
                 @AssignedToUserId, @CreatedByUserId, @TeamId, @Priority, @Type,
                 @DueDate, @EstimatedHours, @LoggedHours, @Progress, @IsBlocked,
                 @Labels, @Watchers,
                 CASE WHEN @NewIsDone = 1 THEN GETDATE() ELSE NULL END,
                 CASE WHEN @NewIsDone = 1 THEN @CreatedByUserId ELSE NULL END,
                 GETDATE());

            SET @Id = SCOPE_IDENTITY();

            IF (@AssignedToUserId IS NOT NULL AND @AssignedToUserId > 0)
            BEGIN
                DECLARE @WsTypeForSeed VARCHAR(20);
                SELECT @WsTypeForSeed = Type FROM dbo.tblWorkspaces WHERE Id = @WorkspaceId;
                IF (@WsTypeForSeed IN ('shared','project'))
                BEGIN
                    IF NOT EXISTS (SELECT 1 FROM dbo.tblTaskReads
                                    WHERE TaskId = @Id AND UserId = @AssignedToUserId)
                        INSERT INTO dbo.tblTaskReads (TaskId, UserId, DeliveredAt)
                        VALUES (@Id, @AssignedToUserId, GETDATE());
                END
            END

            COMMIT TRANSACTION;
            SET @ResponseCode = 201; SET @ResponseMess = 'Task created successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, @Id AS TaskId;
        END
        ELSE
        BEGIN
            UPDATE dbo.tblTasks
               SET Title = @Title,
                   Description = @Description,
                   ColumnId = COALESCE(@ColumnId, ColumnId),
                   ProjectId = @ProjectId,
                   ParentTaskId = @ParentTaskId,
                   AssignedToUserId = @AssignedToUserId,
                   TeamId = @TeamId,
                   Priority = @Priority,
                   Type = @Type,
                   DueDate = @DueDate,
                   EstimatedHours = @EstimatedHours,
                   LoggedHours = @LoggedHours,
                   Progress = @Progress,
                   IsBlocked = @IsBlocked,
                   Labels = @Labels,
                   Watchers = @Watchers,
                   CompletedDate = CASE
                       WHEN @NewIsDone = 1 AND CompletedDate IS NULL THEN GETDATE()
                       WHEN @NewIsDone = 0 THEN NULL
                       ELSE CompletedDate END,
                   CompletedByUserId = CASE
                       WHEN @NewIsDone = 1 AND CompletedByUserId IS NULL THEN @CreatedByUserId
                       WHEN @NewIsDone = 0 THEN NULL
                       ELSE CompletedByUserId END,
                   UpdatedDate = GETDATE()
             WHERE Id = @Id;

            COMMIT TRANSACTION;
            SET @ResponseCode = 200; SET @ResponseMess = 'Task updated successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, @Id AS TaskId;
        END
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SET @ResponseCode = 500;
        SET @ResponseMess = 'Save failed: ' + ERROR_MESSAGE();
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END CATCH
END
GO

PRINT 'Migration 029 complete — task delete SPs rewired + subtask implicit block.';
GO
