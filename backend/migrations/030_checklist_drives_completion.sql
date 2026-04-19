-- ============================================================
-- Migration 030 — Checklist drives completion.
--
-- Rule set enforced by this migration:
--   • Every task MUST have ≥1 checklist item (enforced on create).
--   • Task.IsCompleted is derived: (count > 0 AND all items checked).
--     Recomputed on every checklist mutation.
--   • Task can't be deleted while it has checklist items
--     (user has to manually clear them first — safety interlock).
--   • Column.IsDone is retired. Columns are pure visual buckets.
--
-- Schema:
--   + tblTasks.IsCompleted BIT (default 0)
--   + tblTaskChecklist seeded: any task with 0 items gets
--     "Complete this task" (checked if task was in a done column).
--   - tblKanbanColumns.IsDone is dropped.
--
-- SPs rewritten:
--   sp_SaveTask                 require ChecklistItemsJson on create
--   sp_DeleteTask               reject if items remain
--   sp_BulkDeleteTasks          reject if items remain
--   sp_SaveTaskChecklist        recompute parent IsCompleted
--   sp_DeleteTaskChecklist      recompute parent IsCompleted
--   sp_FetchTask                include IsCompleted
--   sp_FetchKanbanColumn        drop IsDone
--   sp_SaveKanbanColumn         drop @IsDone
--   sp_DeleteKanbanColumn       drop IsDone completion sync
--   sp_ApplyKanbanTemplate      drop IsDone from seed
--   sp_SeedDefaultWorkspace     drop IsDone from seed
--   sp_AddTaskDependency        cycle/block check uses IsCompleted
--   sp_RemoveTaskDependency     same
--   sp_FetchTaskDependencies    include ColumnTitle + IsCompleted
--   sp_ResolveDependencies      IsCompleted based
-- ============================================================

USE [eCRM+];
GO

-- ===== Schema =====
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
     WHERE object_id = OBJECT_ID('dbo.tblTasks')
       AND name      = 'IsCompleted'
)
BEGIN
    ALTER TABLE dbo.tblTasks
      ADD IsCompleted BIT NOT NULL CONSTRAINT DF_tblTasks_IsCompleted DEFAULT 0;
    PRINT 'Added tblTasks.IsCompleted';
END
GO

-- Seed IsCompleted from column.IsDone (where the column column still exists).
IF EXISTS (
    SELECT 1 FROM sys.columns
     WHERE object_id = OBJECT_ID('dbo.tblKanbanColumns')
       AND name      = 'IsDone'
)
BEGIN
    UPDATE t
       SET IsCompleted = ISNULL(c.IsDone, 0)
      FROM dbo.tblTasks t
      LEFT JOIN dbo.tblKanbanColumns c ON c.Id = t.ColumnId;
END
GO

-- Seed checklist items for tasks with none.
INSERT INTO dbo.tblTaskChecklist (TaskId, ItemText, IsCompleted, SortOrder)
SELECT t.Id,
       'Complete this task',
       ISNULL(t.IsCompleted, 0),
       1
  FROM dbo.tblTasks t
 WHERE NOT EXISTS (
       SELECT 1 FROM dbo.tblTaskChecklist c WHERE c.TaskId = t.Id
 );
GO

-- Recompute IsCompleted from checklist truth.
UPDATE t
   SET IsCompleted = CASE
         WHEN stats.TotalItems = 0 THEN 0
         WHEN stats.OpenItems  = 0 THEN 1
         ELSE 0
     END,
       CompletedDate = CASE
         WHEN stats.TotalItems > 0 AND stats.OpenItems = 0 AND t.CompletedDate IS NULL
         THEN GETDATE() ELSE t.CompletedDate END,
       CompletedByUserId = CASE
         WHEN stats.TotalItems > 0 AND stats.OpenItems = 0 AND t.CompletedByUserId IS NULL
         THEN t.CreatedByUserId ELSE t.CompletedByUserId END
  FROM dbo.tblTasks t
  CROSS APPLY (
      SELECT COUNT(*) AS TotalItems,
             SUM(CASE WHEN ISNULL(IsCompleted,0) = 0 THEN 1 ELSE 0 END) AS OpenItems
        FROM dbo.tblTaskChecklist WHERE TaskId = t.Id
  ) stats;
GO

-- Drop tblKanbanColumns.IsDone (and its default) so it stops being a concept.
IF EXISTS (
    SELECT 1 FROM sys.columns
     WHERE object_id = OBJECT_ID('dbo.tblKanbanColumns')
       AND name      = 'IsDone'
)
BEGIN
    DECLARE @dc SYSNAME;
    SELECT @dc = dc.name
      FROM sys.default_constraints dc
      JOIN sys.columns c ON c.default_object_id = dc.object_id
     WHERE c.object_id = OBJECT_ID('dbo.tblKanbanColumns')
       AND c.name      = 'IsDone';
    IF @dc IS NOT NULL EXEC('ALTER TABLE dbo.tblKanbanColumns DROP CONSTRAINT ' + @dc);

    ALTER TABLE dbo.tblKanbanColumns DROP COLUMN IsDone;
    PRINT 'Dropped tblKanbanColumns.IsDone';
END
GO

-- ===== Helper inline for recompute =====
-- Reusable from sp_SaveTaskChecklist / sp_DeleteTaskChecklist.
IF OBJECT_ID('dbo.sp_RecomputeTaskCompletion', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_RecomputeTaskCompletion;
GO

CREATE PROCEDURE dbo.sp_RecomputeTaskCompletion
    @TaskId     BIGINT,
    @ActingUserId INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Total INT, @Open INT, @Was BIT;

    SELECT @Was = ISNULL(IsCompleted, 0) FROM dbo.tblTasks WHERE Id = @TaskId;
    SELECT @Total = COUNT(*),
           @Open  = SUM(CASE WHEN ISNULL(IsCompleted,0) = 0 THEN 1 ELSE 0 END)
      FROM dbo.tblTaskChecklist WHERE TaskId = @TaskId;

    DECLARE @Now BIT = CASE WHEN @Total > 0 AND @Open = 0 THEN 1 ELSE 0 END;

    UPDATE dbo.tblTasks
       SET IsCompleted = @Now,
           CompletedDate = CASE
               WHEN @Now = 1 AND CompletedDate IS NULL THEN GETDATE()
               WHEN @Now = 0 THEN NULL
               ELSE CompletedDate END,
           CompletedByUserId = CASE
               WHEN @Now = 1 AND CompletedByUserId IS NULL
               THEN ISNULL(@ActingUserId, CreatedByUserId)
               WHEN @Now = 0 THEN NULL
               ELSE CompletedByUserId END,
           UpdatedDate = GETDATE()
     WHERE Id = @TaskId;

    IF (@Now = 1 AND @Was = 0)
        EXEC dbo.sp_ResolveDependencies @ResolvedTaskId = @TaskId;
END
GO

-- ===== sp_SaveTaskChecklist =====
IF OBJECT_ID('dbo.sp_SaveTaskChecklist', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_SaveTaskChecklist;
GO

CREATE PROCEDURE dbo.sp_SaveTaskChecklist
    @Id           BIGINT,
    @TaskId       BIGINT,
    @ItemText     VARCHAR(500),
    @IsCompleted  BIT,
    @SortOrder    INT,
    @CompId       BIGINT,
    @BranchId     BIGINT,
    @ActingUserId INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);

    IF (@TaskId IS NULL OR @TaskId <= 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'TaskId is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@ItemText IS NULL OR LTRIM(RTRIM(@ItemText)) = '')
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Checklist item text cannot be blank';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM dbo.tblTasks WHERE Id = @TaskId)
    BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Task not found';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@Id = 0)
    BEGIN
        IF (@SortOrder IS NULL OR @SortOrder = 0)
            SELECT @SortOrder = ISNULL(MAX(SortOrder), 0) + 1
              FROM dbo.tblTaskChecklist WHERE TaskId = @TaskId;

        INSERT INTO dbo.tblTaskChecklist (TaskId, ItemText, IsCompleted, SortOrder)
        VALUES (@TaskId, @ItemText, ISNULL(@IsCompleted, 0), @SortOrder);

        SET @Id = SCOPE_IDENTITY();
        SET @ResponseCode = 201; SET @ResponseMess = 'Checklist item created';
    END
    ELSE
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.tblTaskChecklist WHERE Id = @Id)
        BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Checklist item not found';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

        UPDATE dbo.tblTaskChecklist
           SET ItemText    = @ItemText,
               IsCompleted = @IsCompleted,
               SortOrder   = @SortOrder
         WHERE Id = @Id;

        SET @ResponseCode = 200; SET @ResponseMess = 'Checklist item updated';
    END

    EXEC dbo.sp_RecomputeTaskCompletion @TaskId = @TaskId, @ActingUserId = @ActingUserId;

    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
           @Id AS ChecklistId;
END
GO

-- ===== sp_DeleteTaskChecklist =====
IF OBJECT_ID('dbo.sp_DeleteTaskChecklist', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_DeleteTaskChecklist;
GO

CREATE PROCEDURE dbo.sp_DeleteTaskChecklist
    @Id           BIGINT,
    @CompId       BIGINT,
    @BranchId     BIGINT,
    @ActingUserId INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @TaskId BIGINT;

    SELECT @TaskId = TaskId FROM dbo.tblTaskChecklist WHERE Id = @Id;
    IF (@TaskId IS NULL)
    BEGIN SELECT 404 AS ResponseCode, 'Checklist item not found' AS ResponseMess; RETURN; END

    DELETE FROM dbo.tblTaskChecklist WHERE Id = @Id;

    EXEC dbo.sp_RecomputeTaskCompletion @TaskId = @TaskId, @ActingUserId = @ActingUserId;

    SELECT 200 AS ResponseCode, 'Checklist item deleted' AS ResponseMess,
           @Id AS ChecklistId, @TaskId AS TaskId;
END
GO

-- ===== sp_SaveTask =====
IF OBJECT_ID('dbo.sp_SaveTask', 'P') IS NOT NULL DROP PROCEDURE dbo.sp_SaveTask;
GO

CREATE PROCEDURE dbo.sp_SaveTask
    @Id                 BIGINT          = 0,
    @Title              VARCHAR(500),
    @Description        NVARCHAR(MAX)   = NULL,
    @WorkspaceId        BIGINT          = NULL,
    @ColumnId           INT             = NULL,
    @ProjectId          INT             = NULL,
    @ParentTaskId       BIGINT          = NULL,
    @AssignedToUserId   INT             = NULL,
    @CreatedByUserId    INT,
    @TeamId             INT             = NULL,
    @Priority           VARCHAR(20)     = 'medium',
    @Type               VARCHAR(50)     = 'task',
    @DueDate            DATE            = NULL,
    @EstimatedHours     DECIMAL(10,2)   = 0,
    @LoggedHours        DECIMAL(10,2)   = 0,
    @Progress           DECIMAL(5,2)    = 0,
    @IsBlocked          BIT             = 0,
    @Labels             NVARCHAR(MAX)   = NULL,
    @Watchers           NVARCHAR(MAX)   = NULL,
    @Dependencies       NVARCHAR(MAX)   = NULL,
    @ChecklistItemsJson NVARCHAR(MAX)   = NULL,
    @IsAdmin            BIT             = 0,
    @CompId             BIGINT,
    @BranchId           BIGINT
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

    IF (@Id = 0)
    BEGIN
        IF (@WorkspaceId IS NULL OR @WorkspaceId <= 0)
        BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'WorkspaceId is required to create a task';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

        -- Enforce ≥1 checklist item on create.
        DECLARE @ItemCount INT = 0;
        IF (@ChecklistItemsJson IS NOT NULL AND @ChecklistItemsJson <> '')
            SELECT @ItemCount = COUNT(*) FROM OPENJSON(@ChecklistItemsJson)
             WHERE LTRIM(RTRIM(CAST(value AS NVARCHAR(500)))) <> '';

        IF (@ItemCount = 0)
        BEGIN SET @ResponseCode = 400;
              SET @ResponseMess = 'At least one checklist item is required';
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

        INSERT INTO @PermTable
        EXEC dbo.sp_CheckTaskPermission
            @TaskId = @Id, @WorkspaceId = NULL, @CommentId = NULL,
            @UserId = @CreatedByUserId, @Action = 'edit_fields',
            @IsAdmin = @IsAdmin, @CompId = @CompId;
    END

    IF NOT EXISTS (SELECT 1 FROM @PermTable WHERE Allowed = 1)
    BEGIN
        DECLARE @Reason VARCHAR(400) = (SELECT TOP 1 Reason FROM @PermTable);
        SET @ResponseCode = 403;
        SET @ResponseMess = 'Permission denied: ' + ISNULL(@Reason, 'no reason');
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
    END

    BEGIN TRY
        BEGIN TRANSACTION;

        IF (@Id = 0)
        BEGIN
            IF (@ColumnId IS NULL AND @WorkspaceId IS NOT NULL)
                SELECT TOP 1 @ColumnId = Id FROM dbo.tblKanbanColumns
                 WHERE WorkspaceId = @WorkspaceId AND IsActive = 1
                 ORDER BY SortOrder ASC, Id ASC;

            INSERT INTO dbo.tblTasks
                (Title, Description, WorkspaceId, ColumnId, ProjectId, ParentTaskId,
                 AssignedToUserId, CreatedByUserId, TeamId, Priority, Type,
                 DueDate, EstimatedHours, LoggedHours, Progress, IsBlocked,
                 IsCompleted, Labels, Watchers,
                 CompletedDate, CompletedByUserId, UpdatedDate)
            VALUES
                (@Title, @Description, @WorkspaceId, @ColumnId, @ProjectId, @ParentTaskId,
                 @AssignedToUserId, @CreatedByUserId, @TeamId, @Priority, @Type,
                 @DueDate, @EstimatedHours, @LoggedHours, @Progress, @IsBlocked,
                 0, @Labels, @Watchers,
                 NULL, NULL, GETDATE());

            SET @Id = SCOPE_IDENTITY();

            -- Insert checklist items from JSON payload.
            IF (@ChecklistItemsJson IS NOT NULL AND @ChecklistItemsJson <> '')
            BEGIN
                ;WITH items AS (
                    SELECT LTRIM(RTRIM(CAST(value AS NVARCHAR(500)))) AS ItemText,
                           ROW_NUMBER() OVER (ORDER BY [key]) AS SortOrder
                      FROM OPENJSON(@ChecklistItemsJson)
                )
                INSERT INTO dbo.tblTaskChecklist (TaskId, ItemText, IsCompleted, SortOrder)
                SELECT @Id, ItemText, 0, SortOrder
                  FROM items
                 WHERE ItemText <> '';
            END

            -- Assignee delivery receipt (shared/project only).
            IF (@AssignedToUserId IS NOT NULL AND @AssignedToUserId > 0)
            BEGIN
                DECLARE @WsType VARCHAR(20);
                SELECT @WsType = Type FROM dbo.tblWorkspaces WHERE Id = @WorkspaceId;
                IF (@WsType IN ('shared','project'))
                    IF NOT EXISTS (SELECT 1 FROM dbo.tblTaskReads
                                    WHERE TaskId = @Id AND UserId = @AssignedToUserId)
                        INSERT INTO dbo.tblTaskReads (TaskId, UserId, DeliveredAt)
                        VALUES (@Id, @AssignedToUserId, GETDATE());
            END

            COMMIT TRANSACTION;
            SET @ResponseCode = 201; SET @ResponseMess = 'Task created';
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
                   UpdatedDate = GETDATE()
             WHERE Id = @Id;

            COMMIT TRANSACTION;
            SET @ResponseCode = 200; SET @ResponseMess = 'Task updated';
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

-- ===== sp_DeleteTask =====
IF OBJECT_ID('dbo.sp_DeleteTask', 'P') IS NOT NULL DROP PROCEDURE dbo.sp_DeleteTask;
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

    IF EXISTS (SELECT 1 FROM dbo.tblTaskChecklist WHERE TaskId = @Id)
    BEGIN SET @ResponseCode = 409;
          SET @ResponseMess = 'Clear checklist items before deleting this task';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

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

-- ===== sp_BulkDeleteTasks =====
IF OBJECT_ID('dbo.sp_BulkDeleteTasks', 'P') IS NOT NULL DROP PROCEDURE dbo.sp_BulkDeleteTasks;
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

    IF EXISTS (
        SELECT 1 FROM dbo.tblTaskChecklist c
         WHERE c.TaskId IN (SELECT TaskId FROM @Targets)
    )
    BEGIN
        SET @ResponseCode = 409;
        SET @ResponseMess = 'One or more tasks still have checklist items. Clear them first.';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
    END

    IF EXISTS (
        SELECT 1 FROM dbo.tblTasks t
        INNER JOIN @Targets tgt ON t.ParentTaskId = tgt.TaskId
    )
    BEGIN
        SET @ResponseCode = 409;
        SET @ResponseMess = 'One or more tasks have subtasks. Delete subtasks first.';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
    END

    DECLARE @FailedId BIGINT = NULL, @CurrentId BIGINT;
    DECLARE cur CURSOR LOCAL FAST_FORWARD FOR SELECT TaskId FROM @Targets;
    OPEN cur; FETCH NEXT FROM cur INTO @CurrentId;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        DECLARE @Perm TABLE (Allowed BIT, Reason VARCHAR(400));
        INSERT INTO @Perm
        EXEC dbo.sp_CheckTaskPermission
            @TaskId = @CurrentId, @WorkspaceId = NULL, @CommentId = NULL,
            @UserId = @UserId, @Action = 'delete_task',
            @IsAdmin = @IsAdmin, @CompId = @CompId;

        IF NOT EXISTS (SELECT 1 FROM @Perm WHERE Allowed = 1)
        BEGIN SET @FailedId = @CurrentId; BREAK; END
        DELETE FROM @Perm;
        FETCH NEXT FROM cur INTO @CurrentId;
    END
    CLOSE cur; DEALLOCATE cur;

    IF (@FailedId IS NOT NULL)
    BEGIN
        SET @ResponseCode = 403;
        SET @ResponseMess = CONCAT('Permission denied for task #', @FailedId);
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
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

        IF OBJECT_ID('dbo.tblTimeEntries', 'U') IS NOT NULL
            DELETE FROM dbo.tblTimeEntries
             WHERE TaskId IN (SELECT TaskId FROM @Targets);

        DELETE FROM dbo.tblTasks WHERE Id IN (SELECT TaskId FROM @Targets);
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

-- ===== sp_FetchKanbanColumn =====
IF OBJECT_ID('dbo.sp_FetchKanbanColumn', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_FetchKanbanColumn;
GO

CREATE PROCEDURE dbo.sp_FetchKanbanColumn
    @Id                      INT           = 0,
    @WorkspaceId             BIGINT        = NULL,
    @CompId                  BIGINT,
    @BranchId                BIGINT,
    @IsAdmin                 BIT           = 0,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @PageNumber              INT           = 1,
    @PageSize                INT           = 200,
    @SearchTerm              NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @TotalRecords INT, @TotalPages INT, @Offset INT;

    DECLARE @BranchIds TABLE (BranchId BIGINT);
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
        INSERT INTO @BranchIds (BranchId)
        SELECT CAST(value AS BIGINT) FROM OPENJSON(@AccessibleBranchIdsJson);
    DECLARE @UseScope BIT =
        CASE WHEN @AccessibleBranchIdsJson IS NULL OR @AccessibleBranchIdsJson = '' THEN 0 ELSE 1 END;

    SET @Offset = (@PageNumber - 1) * @PageSize;

    SELECT @TotalRecords = COUNT(*)
      FROM dbo.tblKanbanColumns kc
     WHERE (@Id = 0 OR kc.Id = @Id)
       AND (@WorkspaceId IS NULL OR kc.WorkspaceId = @WorkspaceId)
       AND kc.CompId = @CompId
       AND kc.IsActive = 1
       AND (kc.IsCompanyWide = 1
            OR (@UseScope = 1 AND kc.BranchId IN (SELECT BranchId FROM @BranchIds))
            OR (@UseScope = 0 AND (@IsAdmin = 1 OR kc.BranchId = @BranchId)))
       AND (@SearchTerm IS NULL OR kc.Title LIKE '%' + @SearchTerm + '%');

    SET @TotalPages = CASE WHEN @PageSize > 0
                           THEN CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize)
                           ELSE 0 END;

    SELECT 200 AS ResponseCode, 'Kanban columns fetched' AS ResponseMess,
           @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
           @PageNumber AS CurrentPage, @PageSize AS PageSize,
           kc.Id, kc.WorkspaceId, w.Name AS WorkspaceName,
           kc.Title, kc.Color, kc.SortOrder, kc.MaxTasks,
           kc.IsActive, kc.IsCompanyWide, kc.CompId, kc.BranchId, kc.CreatedDate,
           (SELECT COUNT(*) FROM dbo.tblTasks t WHERE t.ColumnId = kc.Id) AS TaskCount
      FROM dbo.tblKanbanColumns kc
      LEFT JOIN dbo.tblWorkspaces w ON w.Id = kc.WorkspaceId
     WHERE (@Id = 0 OR kc.Id = @Id)
       AND (@WorkspaceId IS NULL OR kc.WorkspaceId = @WorkspaceId)
       AND kc.CompId = @CompId
       AND kc.IsActive = 1
       AND (kc.IsCompanyWide = 1
            OR (@UseScope = 1 AND kc.BranchId IN (SELECT BranchId FROM @BranchIds))
            OR (@UseScope = 0 AND (@IsAdmin = 1 OR kc.BranchId = @BranchId)))
       AND (@SearchTerm IS NULL OR kc.Title LIKE '%' + @SearchTerm + '%')
     ORDER BY kc.WorkspaceId, kc.SortOrder, kc.Id
     OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
END
GO

-- ===== sp_SaveKanbanColumn =====
IF OBJECT_ID('dbo.sp_SaveKanbanColumn', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_SaveKanbanColumn;
GO

CREATE PROCEDURE dbo.sp_SaveKanbanColumn
    @Id          INT          = 0,
    @WorkspaceId BIGINT,
    @Title       VARCHAR(100),
    @Color       VARCHAR(20)  = NULL,
    @SortOrder   INT          = 0,
    @MaxTasks    INT          = NULL,
    @IsActive    BIT          = 1,
    @UserId      INT,
    @IsAdmin     BIT          = 0,
    @CompId      BIGINT,
    @BranchId    BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);
    DECLARE @SavedId INT;

    IF (@WorkspaceId IS NULL OR @WorkspaceId <= 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'WorkspaceId is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@Title IS NULL OR LTRIM(RTRIM(@Title)) = '')
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Column title is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    DECLARE @WsType VARCHAR(20), @WsOwner INT;
    SELECT @WsType = Type, @WsOwner = OwnerUserId
      FROM dbo.tblWorkspaces
     WHERE Id = @WorkspaceId AND CompId = @CompId;
    IF (@WsType IS NULL)
    BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Workspace not found';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    DECLARE @CanManage BIT = 0;
    IF (@IsAdmin = 1 AND @WsType <> 'personal') SET @CanManage = 1;
    ELSE IF (@WsType = 'personal' AND @WsOwner = @UserId) SET @CanManage = 1;
    ELSE IF (EXISTS (
        SELECT 1 FROM dbo.tblWorkspaceMembers m
         WHERE m.WorkspaceId = @WorkspaceId AND m.UserId = @UserId
           AND m.IsActive = 1 AND m.Role IN ('owner','manager')))
        SET @CanManage = 1;

    IF (@CanManage = 0)
    BEGIN SET @ResponseCode = 403; SET @ResponseMess = 'Permission denied';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    BEGIN TRY
        IF (@Id = 0)
        BEGIN
            IF EXISTS (
                SELECT 1 FROM dbo.tblKanbanColumns
                 WHERE WorkspaceId = @WorkspaceId AND Title = @Title AND IsActive = 1
            )
            BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Column with this title already exists';
                  SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

            IF (@SortOrder IS NULL OR @SortOrder = 0)
                SELECT @SortOrder = ISNULL(MAX(SortOrder), 0) + 1
                  FROM dbo.tblKanbanColumns WHERE WorkspaceId = @WorkspaceId;

            INSERT INTO dbo.tblKanbanColumns
                (WorkspaceId, Title, Color, SortOrder, MaxTasks, IsActive,
                 CompId, BranchId, IsCompanyWide)
            VALUES
                (@WorkspaceId, @Title, @Color, @SortOrder, @MaxTasks, @IsActive,
                 @CompId, @BranchId, 0);

            SET @SavedId = SCOPE_IDENTITY();
            SET @ResponseCode = 201; SET @ResponseMess = 'Column created';
        END
        ELSE
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM dbo.tblKanbanColumns
                 WHERE Id = @Id AND WorkspaceId = @WorkspaceId
            )
            BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Column not found';
                  SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

            IF EXISTS (
                SELECT 1 FROM dbo.tblKanbanColumns
                 WHERE WorkspaceId = @WorkspaceId AND Title = @Title
                   AND Id <> @Id AND IsActive = 1
            )
            BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Column with this title already exists';
                  SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

            UPDATE dbo.tblKanbanColumns
               SET Title = @Title, Color = @Color, SortOrder = @SortOrder,
                   MaxTasks = @MaxTasks, IsActive = @IsActive
             WHERE Id = @Id;

            SET @SavedId = @Id;
            SET @ResponseCode = 200; SET @ResponseMess = 'Column updated';
        END

        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               @SavedId AS ColumnId;
    END TRY
    BEGIN CATCH
        SET @ResponseCode = 500;
        SET @ResponseMess = 'Failed to save column: ' + ERROR_MESSAGE();
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END CATCH
END
GO

-- ===== sp_DeleteKanbanColumn =====
IF OBJECT_ID('dbo.sp_DeleteKanbanColumn', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_DeleteKanbanColumn;
GO

CREATE PROCEDURE dbo.sp_DeleteKanbanColumn
    @Id                   INT,
    @ReassignToColumnId   INT    = NULL,
    @UserId               INT,
    @IsAdmin              BIT    = 0,
    @CompId               BIGINT,
    @BranchId             BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);
    DECLARE @WorkspaceId BIGINT, @WsType VARCHAR(20), @WsOwner INT;
    DECLARE @ReassignTargetId INT;
    DECLARE @MovedCount INT = 0;

    IF (@Id IS NULL OR @Id <= 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Column Id is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    SELECT @WorkspaceId = kc.WorkspaceId
      FROM dbo.tblKanbanColumns kc
     WHERE kc.Id = @Id AND kc.CompId = @CompId AND kc.IsActive = 1;

    IF (@WorkspaceId IS NULL)
    BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Column not found';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    SELECT @WsType = Type, @WsOwner = OwnerUserId
      FROM dbo.tblWorkspaces WHERE Id = @WorkspaceId;

    DECLARE @CanManage BIT = 0;
    IF (@IsAdmin = 1 AND @WsType <> 'personal') SET @CanManage = 1;
    ELSE IF (@WsType = 'personal' AND @WsOwner = @UserId) SET @CanManage = 1;
    ELSE IF (EXISTS (
        SELECT 1 FROM dbo.tblWorkspaceMembers m
         WHERE m.WorkspaceId = @WorkspaceId AND m.UserId = @UserId
           AND m.IsActive = 1 AND m.Role IN ('owner','manager')))
        SET @CanManage = 1;

    IF (@CanManage = 0)
    BEGIN SET @ResponseCode = 403; SET @ResponseMess = 'Permission denied';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@ReassignToColumnId IS NOT NULL AND @ReassignToColumnId > 0)
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM dbo.tblKanbanColumns
             WHERE Id = @ReassignToColumnId AND WorkspaceId = @WorkspaceId
               AND IsActive = 1 AND Id <> @Id
        )
        BEGIN SET @ResponseCode = 400;
              SET @ResponseMess = 'Reassign target is not in this workspace';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
        SET @ReassignTargetId = @ReassignToColumnId;
    END
    ELSE
        SELECT TOP 1 @ReassignTargetId = Id
          FROM dbo.tblKanbanColumns
         WHERE WorkspaceId = @WorkspaceId AND IsActive = 1 AND Id <> @Id
         ORDER BY SortOrder ASC, Id ASC;

    BEGIN TRY
        BEGIN TRANSACTION;

        UPDATE dbo.tblTasks
           SET ColumnId = @ReassignTargetId, UpdatedDate = GETDATE()
         WHERE ColumnId = @Id;
        SET @MovedCount = @@ROWCOUNT;

        UPDATE dbo.tblKanbanColumns SET IsActive = 0 WHERE Id = @Id;

        COMMIT TRANSACTION;
        SET @ResponseCode = 200;
        SET @ResponseMess = 'Column deleted';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               @MovedCount AS TasksMoved,
               @ReassignTargetId AS ReassignedTo;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SET @ResponseCode = 500;
        SET @ResponseMess = 'Failed to delete column: ' + ERROR_MESSAGE();
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END CATCH
END
GO

-- ===== sp_ApplyKanbanTemplate =====
IF OBJECT_ID('dbo.sp_ApplyKanbanTemplate', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_ApplyKanbanTemplate;
GO

CREATE PROCEDURE dbo.sp_ApplyKanbanTemplate
    @WorkspaceId  BIGINT,
    @TemplateKey  VARCHAR(40) = 'basic',
    @CompId       BIGINT,
    @BranchId     BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);

    IF NOT EXISTS (SELECT 1 FROM dbo.tblWorkspaces WHERE Id = @WorkspaceId)
    BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Workspace not found';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    DECLARE @Cols TABLE (SortOrder INT, Title VARCHAR(100), Color VARCHAR(20));

    IF (@TemplateKey = 'basic')
        INSERT INTO @Cols VALUES
            (1,'To Do','#94A3B8'),
            (2,'In Progress','#3B82F6'),
            (3,'Done','#10B981');
    ELSE IF (@TemplateKey = 'scrum')
        INSERT INTO @Cols VALUES
            (1,'Backlog','#94A3B8'),
            (2,'Sprint','#8B5CF6'),
            (3,'In Progress','#3B82F6'),
            (4,'Review','#F59E0B'),
            (5,'Done','#10B981');
    ELSE IF (@TemplateKey = 'bug')
        INSERT INTO @Cols VALUES
            (1,'New','#EF4444'),
            (2,'Triaged','#F59E0B'),
            (3,'In Progress','#3B82F6'),
            (4,'Fixed','#10B981'),
            (5,'Verified','#6366F1');
    ELSE IF (@TemplateKey = 'content')
        INSERT INTO @Cols VALUES
            (1,'Idea','#94A3B8'),
            (2,'Draft','#F59E0B'),
            (3,'Review','#3B82F6'),
            (4,'Published','#10B981');
    ELSE
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Unknown template key';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    INSERT INTO dbo.tblKanbanColumns
        (WorkspaceId, Title, Color, SortOrder, MaxTasks, IsActive,
         CompId, BranchId, IsCompanyWide)
    SELECT @WorkspaceId, c.Title, c.Color, c.SortOrder, NULL, 1,
           @CompId, @BranchId, 0
      FROM @Cols c;

    SET @ResponseCode = 201; SET @ResponseMess = 'Template applied';
    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
           @WorkspaceId AS WorkspaceId, @TemplateKey AS TemplateKey,
           @@ROWCOUNT AS ColumnsCreated;
END
GO

-- ===== sp_SeedDefaultWorkspace =====
IF OBJECT_ID('dbo.sp_SeedDefaultWorkspace', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_SeedDefaultWorkspace;
GO

CREATE PROCEDURE dbo.sp_SeedDefaultWorkspace
    @UserId   INT,
    @CompId   BIGINT,
    @BranchId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);
    DECLARE @WorkspaceId BIGINT, @Seeded BIT = 0;

    IF NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Id = @UserId AND IsActive = 1)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid user';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    SELECT TOP 1 @WorkspaceId = Id FROM dbo.tblWorkspaces
     WHERE Type = 'personal' AND OwnerUserId = @UserId AND IsArchived = 0
     ORDER BY Id ASC;

    IF (@WorkspaceId IS NOT NULL)
    BEGIN
        SET @ResponseCode = 200;
        SET @ResponseMess = 'Personal workspace already exists';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               @WorkspaceId AS WorkspaceId, @Seeded AS Seeded;
        RETURN;
    END

    DECLARE @DisplayName VARCHAR(200) =
        ISNULL((SELECT FullName FROM dbo.tblUser WHERE Id = @UserId),
               (SELECT Username FROM dbo.tblUser WHERE Id = @UserId));
    DECLARE @Name VARCHAR(200) = CONCAT(@DisplayName, '''s Tasks');

    BEGIN TRY
        BEGIN TRANSACTION;

        INSERT INTO dbo.tblWorkspaces
            (Name, Type, OwnerUserId, IsArchived, CompId, BranchId)
        VALUES
            (@Name, 'personal', @UserId, 0, @CompId, @BranchId);
        SET @WorkspaceId = SCOPE_IDENTITY();

        INSERT INTO dbo.tblWorkspaceMembers
            (WorkspaceId, UserId, Role, AddedByUserId, IsActive, InviteStatus)
        VALUES
            (@WorkspaceId, @UserId, 'owner', @UserId, 1, 'active');

        INSERT INTO dbo.tblKanbanColumns
            (WorkspaceId, Title, Color, SortOrder, MaxTasks, IsActive,
             CompId, BranchId, IsCompanyWide)
        VALUES
            (@WorkspaceId, 'To Do',       '#94A3B8', 1, NULL, 1, @CompId, @BranchId, 0),
            (@WorkspaceId, 'In Progress', '#3B82F6', 2, NULL, 1, @CompId, @BranchId, 0),
            (@WorkspaceId, 'Done',        '#10B981', 3, NULL, 1, @CompId, @BranchId, 0);

        COMMIT TRANSACTION;

        SET @Seeded = 1;
        SET @ResponseCode = 201;
        SET @ResponseMess = 'Personal workspace seeded';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               @WorkspaceId AS WorkspaceId, @Seeded AS Seeded;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SET @ResponseCode = 500;
        SET @ResponseMess = 'Seed failed: ' + ERROR_MESSAGE();
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END CATCH
END
GO

-- ===== sp_FetchTask =====
IF OBJECT_ID('dbo.sp_FetchTask', 'P') IS NOT NULL DROP PROCEDURE dbo.sp_FetchTask;
GO

CREATE PROCEDURE dbo.sp_FetchTask
    @Id                      BIGINT        = 0,
    @WorkspaceId             BIGINT        = NULL,
    @ProjectId               INT           = NULL,
    @UserId                  INT,
    @CompId                  BIGINT,
    @BranchId                BIGINT,
    @IsAdmin                 BIT           = 0,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @PageNumber              INT           = 1,
    @PageSize                INT           = 25,
    @SearchTerm              NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);
    DECLARE @TotalRecords INT, @TotalPages INT, @Offset INT;

    DECLARE @BranchIds TABLE (BranchId BIGINT);
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
        INSERT INTO @BranchIds (BranchId)
        SELECT CAST(value AS BIGINT) FROM OPENJSON(@AccessibleBranchIdsJson);
    DECLARE @UseScope BIT =
        CASE WHEN @AccessibleBranchIdsJson IS NULL OR @AccessibleBranchIdsJson = '' THEN 0 ELSE 1 END;

    IF (@Id > 0)
    BEGIN
        DECLARE @PermTable TABLE (Allowed BIT, Reason VARCHAR(400));
        INSERT INTO @PermTable
        EXEC dbo.sp_CheckTaskPermission
            @TaskId = @Id, @WorkspaceId = NULL, @CommentId = NULL,
            @UserId = @UserId, @Action = 'view_task',
            @IsAdmin = @IsAdmin, @CompId = @CompId;

        IF NOT EXISTS (SELECT 1 FROM @PermTable WHERE Allowed = 1)
        BEGIN
            SET @ResponseCode = 404; SET @ResponseMess = 'Task not found or access denied';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   NULL AS Id, NULL AS Title, NULL AS Description,
                   NULL AS WorkspaceId, NULL AS ColumnId, NULL AS ColumnTitle,
                   NULL AS IsCompleted,
                   NULL AS ProjectId, NULL AS ParentTaskId,
                   NULL AS AssignedToUserId, NULL AS CreatedByUserId, NULL AS TeamId,
                   NULL AS Priority, NULL AS Type, NULL AS DueDate,
                   NULL AS EstimatedHours, NULL AS LoggedHours, NULL AS Progress,
                   NULL AS IsBlocked, NULL AS Labels, NULL AS Watchers,
                   NULL AS CompletedDate, NULL AS CompletedByUserId, NULL AS UpdatedDate,
                   NULL AS BranchId, NULL AS ProjectName, NULL AS WorkspaceName, NULL AS AssigneeName,
                   NULL AS CreatorName, NULL AS TeamName,
                   NULL AS SubTaskCount, NULL AS BlockerCount,
                   NULL AS ChecklistTotal, NULL AS ChecklistDone;
            RETURN;
        END

        DECLARE @WsTypeOne VARCHAR(20);
        SELECT @WsTypeOne = w.Type
          FROM dbo.tblTasks t LEFT JOIN dbo.tblWorkspaces w ON w.Id = t.WorkspaceId
         WHERE t.Id = @Id;

        IF (@WsTypeOne IN ('shared','project'))
            IF NOT EXISTS (SELECT 1 FROM dbo.tblTaskReads WHERE TaskId = @Id AND UserId = @UserId)
                INSERT INTO dbo.tblTaskReads (TaskId, UserId, DeliveredAt)
                VALUES (@Id, @UserId, GETDATE());

        SET @ResponseCode = 200; SET @ResponseMess = 'Task retrieved';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
               t.Id, t.Title, t.Description, t.WorkspaceId, t.ColumnId,
               col.Title AS ColumnTitle,
               ISNULL(t.IsCompleted, 0) AS IsCompleted,
               t.ProjectId, t.ParentTaskId,
               t.AssignedToUserId, t.CreatedByUserId, t.TeamId,
               t.Priority, t.Type, t.DueDate,
               t.EstimatedHours, t.LoggedHours, t.Progress,
               CAST(CASE WHEN EXISTS (
                   SELECT 1 FROM dbo.tblTaskDependencies d
                   JOIN dbo.tblTasks b ON b.Id = d.DependsOnTaskId
                   WHERE d.TaskId = t.Id AND d.Type = 'blocks'
                     AND ISNULL(b.IsCompleted, 0) = 0
               ) THEN 1 ELSE 0 END AS BIT) AS IsBlocked,
               t.Labels, t.Watchers,
               t.CompletedDate, t.CompletedByUserId, t.UpdatedDate,
               ISNULL(p.BranchId, w.BranchId) AS BranchId,
               p.Name AS ProjectName, w.Name AS WorkspaceName,
               assignee.FullName AS AssigneeName,
               creator.FullName AS CreatorName,
               team.Name AS TeamName,
               (SELECT COUNT(*) FROM dbo.tblTasks st WHERE st.ParentTaskId = t.Id) AS SubTaskCount,
               (SELECT COUNT(*) FROM dbo.tblTaskDependencies d
                 WHERE d.TaskId = t.Id AND d.Type = 'blocks') AS BlockerCount,
               (SELECT COUNT(*) FROM dbo.tblTaskChecklist c WHERE c.TaskId = t.Id) AS ChecklistTotal,
               (SELECT COUNT(*) FROM dbo.tblTaskChecklist c
                 WHERE c.TaskId = t.Id AND c.IsCompleted = 1) AS ChecklistDone
          FROM dbo.tblTasks t
          LEFT JOIN dbo.tblKanbanColumns col ON col.Id = t.ColumnId
          LEFT JOIN dbo.tblWorkspaces    w   ON w.Id   = t.WorkspaceId
          LEFT JOIN dbo.tblProjects      p   ON p.Id   = t.ProjectId
          INNER JOIN dbo.tblUser creator     ON creator.Id = t.CreatedByUserId
          LEFT  JOIN dbo.tblUser assignee    ON assignee.Id = t.AssignedToUserId
          LEFT  JOIN dbo.tblTeams team       ON team.Id = t.TeamId
         WHERE t.Id = @Id;
        RETURN;
    END

    SET @Offset = (@PageNumber - 1) * @PageSize;

    ;WITH visible_ws AS (
        SELECT Id FROM dbo.tblWorkspaces w
         WHERE w.CompId = @CompId
           AND ((w.Type = 'personal' AND w.OwnerUserId = @UserId)
             OR (w.Type IN ('shared','project')
                 AND (@IsAdmin = 1
                      OR EXISTS (SELECT 1 FROM dbo.tblWorkspaceMembers m
                                  WHERE m.WorkspaceId = w.Id AND m.UserId = @UserId AND m.IsActive = 1))))
    )
    SELECT @TotalRecords = COUNT(*)
      FROM dbo.tblTasks t
      LEFT JOIN dbo.tblWorkspaces w ON w.Id = t.WorkspaceId
      LEFT JOIN dbo.tblProjects   p ON p.Id = t.ProjectId
      LEFT JOIN dbo.tblUser assignee ON assignee.Id = t.AssignedToUserId
      LEFT JOIN dbo.tblTeams team     ON team.Id = t.TeamId
     WHERE (@WorkspaceId IS NULL OR t.WorkspaceId = @WorkspaceId)
       AND (@ProjectId   IS NULL OR t.ProjectId   = @ProjectId)
       AND ((@UseScope = 0)
            OR (w.BranchId IN (SELECT BranchId FROM @BranchIds))
            OR (p.BranchId IN (SELECT BranchId FROM @BranchIds)))
       AND (
             t.WorkspaceId IN (SELECT Id FROM visible_ws)
          OR (t.WorkspaceId IS NULL
              AND (@IsAdmin = 1
                   OR t.AssignedToUserId = @UserId
                   OR t.CreatedByUserId  = @UserId
                   OR p.ManagerUserId    = @UserId))
           )
       AND (@SearchTerm IS NULL
            OR t.Title LIKE '%' + @SearchTerm + '%'
            OR t.Description LIKE '%' + @SearchTerm + '%'
            OR assignee.FullName LIKE '%' + @SearchTerm + '%'
            OR team.Name LIKE '%' + @SearchTerm + '%');

    SET @TotalPages = CASE WHEN @PageSize > 0
                           THEN CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize)
                           ELSE 0 END;

    IF (@TotalRecords = 0)
    BEGIN
        SET @ResponseCode = 200; SET @ResponseMess = 'No tasks found';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
               @PageNumber AS CurrentPage, @PageSize AS PageSize,
               NULL AS Id, NULL AS Title, NULL AS Description,
               NULL AS WorkspaceId, NULL AS ColumnId, NULL AS ColumnTitle,
               NULL AS IsCompleted,
               NULL AS ProjectId, NULL AS ParentTaskId,
               NULL AS AssignedToUserId, NULL AS CreatedByUserId, NULL AS TeamId,
               NULL AS Priority, NULL AS Type, NULL AS DueDate,
               NULL AS EstimatedHours, NULL AS LoggedHours, NULL AS Progress,
               NULL AS IsBlocked, NULL AS Labels, NULL AS Watchers,
               NULL AS CompletedDate, NULL AS CompletedByUserId, NULL AS UpdatedDate,
               NULL AS BranchId, NULL AS ProjectName, NULL AS WorkspaceName, NULL AS AssigneeName,
               NULL AS CreatorName, NULL AS TeamName,
               NULL AS SubTaskCount, NULL AS BlockerCount,
               NULL AS ChecklistTotal, NULL AS ChecklistDone;
        RETURN;
    END

    SET @ResponseCode = 200; SET @ResponseMess = 'Tasks retrieved';
    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
           @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
           @PageNumber AS CurrentPage, @PageSize AS PageSize,
           t.Id, t.Title, t.Description, t.WorkspaceId, t.ColumnId,
           col.Title AS ColumnTitle,
           ISNULL(t.IsCompleted, 0) AS IsCompleted,
           t.ProjectId, t.ParentTaskId,
           t.AssignedToUserId, t.CreatedByUserId, t.TeamId,
           t.Priority, t.Type, t.DueDate,
           t.EstimatedHours, t.LoggedHours, t.Progress,
           CAST(CASE WHEN EXISTS (
               SELECT 1 FROM dbo.tblTaskDependencies d
               JOIN dbo.tblTasks b ON b.Id = d.DependsOnTaskId
               WHERE d.TaskId = t.Id AND d.Type = 'blocks'
                 AND ISNULL(b.IsCompleted, 0) = 0
           ) THEN 1 ELSE 0 END AS BIT) AS IsBlocked,
           t.Labels, t.Watchers,
           t.CompletedDate, t.CompletedByUserId, t.UpdatedDate,
           ISNULL(p.BranchId, w.BranchId) AS BranchId,
           p.Name AS ProjectName, w.Name AS WorkspaceName,
           assignee.FullName AS AssigneeName,
           creator.FullName AS CreatorName,
           team.Name AS TeamName,
           (SELECT COUNT(*) FROM dbo.tblTasks st WHERE st.ParentTaskId = t.Id) AS SubTaskCount,
           (SELECT COUNT(*) FROM dbo.tblTaskDependencies d
             WHERE d.TaskId = t.Id AND d.Type = 'blocks') AS BlockerCount,
           (SELECT COUNT(*) FROM dbo.tblTaskChecklist c WHERE c.TaskId = t.Id) AS ChecklistTotal,
           (SELECT COUNT(*) FROM dbo.tblTaskChecklist c
             WHERE c.TaskId = t.Id AND c.IsCompleted = 1) AS ChecklistDone
      FROM dbo.tblTasks t
      LEFT JOIN dbo.tblKanbanColumns col ON col.Id = t.ColumnId
      LEFT JOIN dbo.tblWorkspaces    w   ON w.Id   = t.WorkspaceId
      LEFT JOIN dbo.tblProjects      p   ON p.Id   = t.ProjectId
      INNER JOIN dbo.tblUser creator     ON creator.Id = t.CreatedByUserId
      LEFT  JOIN dbo.tblUser assignee    ON assignee.Id = t.AssignedToUserId
      LEFT  JOIN dbo.tblTeams team       ON team.Id = t.TeamId
     WHERE (@WorkspaceId IS NULL OR t.WorkspaceId = @WorkspaceId)
       AND (@ProjectId   IS NULL OR t.ProjectId   = @ProjectId)
       AND ((@UseScope = 0)
            OR (w.BranchId IN (SELECT BranchId FROM @BranchIds))
            OR (p.BranchId IN (SELECT BranchId FROM @BranchIds)))
       AND (
             t.WorkspaceId IN (SELECT Id FROM dbo.tblWorkspaces ww
                                WHERE ww.CompId = @CompId
                                  AND (
                                        (ww.Type = 'personal' AND ww.OwnerUserId = @UserId)
                                     OR (ww.Type IN ('shared','project')
                                         AND (@IsAdmin = 1
                                              OR EXISTS (SELECT 1 FROM dbo.tblWorkspaceMembers mm
                                                          WHERE mm.WorkspaceId = ww.Id AND mm.UserId = @UserId AND mm.IsActive = 1)))))
          OR (t.WorkspaceId IS NULL
              AND (@IsAdmin = 1
                   OR t.AssignedToUserId = @UserId
                   OR t.CreatedByUserId  = @UserId
                   OR p.ManagerUserId    = @UserId))
           )
       AND (@SearchTerm IS NULL
            OR t.Title LIKE '%' + @SearchTerm + '%'
            OR t.Description LIKE '%' + @SearchTerm + '%'
            OR assignee.FullName LIKE '%' + @SearchTerm + '%'
            OR team.Name LIKE '%' + @SearchTerm + '%')
     ORDER BY ISNULL(t.IsCompleted, 0) ASC,
              CASE t.Priority
                   WHEN 'critical' THEN 1 WHEN 'high' THEN 2
                   WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END,
              t.DueDate ASC, t.Id DESC
     OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
END
GO

-- ===== Dependency SPs use IsCompleted =====
IF OBJECT_ID('dbo.sp_FetchTaskDependencies', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_FetchTaskDependencies;
GO

CREATE PROCEDURE dbo.sp_FetchTaskDependencies
    @TaskId   BIGINT,
    @UserId   INT,
    @IsAdmin  BIT = 0,
    @CompId   BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);

    DECLARE @Perm TABLE (Allowed BIT, Reason VARCHAR(400));
    INSERT INTO @Perm
    EXEC dbo.sp_CheckTaskPermission
        @TaskId = @TaskId, @WorkspaceId = NULL, @CommentId = NULL,
        @UserId = @UserId, @Action = 'view_task',
        @IsAdmin = @IsAdmin, @CompId = @CompId;

    IF NOT EXISTS (SELECT 1 FROM @Perm WHERE Allowed = 1)
    BEGIN
        SET @ResponseCode = 403; SET @ResponseMess = 'Permission denied';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               NULL AS Direction, NULL AS TaskId, NULL AS Title,
               NULL AS ColumnTitle, NULL AS IsCompleted, NULL AS Type;
        RETURN;
    END

    SET @ResponseCode = 200; SET @ResponseMess = 'Dependencies retrieved';

    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
           'blocker' AS Direction, b.Id AS TaskId, b.Title,
           bc.Title AS ColumnTitle, ISNULL(b.IsCompleted,0) AS IsCompleted, d.Type
      FROM dbo.tblTaskDependencies d
      JOIN dbo.tblTasks b ON b.Id = d.DependsOnTaskId
      LEFT JOIN dbo.tblKanbanColumns bc ON bc.Id = b.ColumnId
     WHERE d.TaskId = @TaskId
    UNION ALL
    SELECT @ResponseCode, @ResponseMess,
           'dependent', dep.Id, dep.Title,
           dc.Title, ISNULL(dep.IsCompleted,0), d.Type
      FROM dbo.tblTaskDependencies d
      JOIN dbo.tblTasks dep ON dep.Id = d.TaskId
      LEFT JOIN dbo.tblKanbanColumns dc ON dc.Id = dep.ColumnId
     WHERE d.DependsOnTaskId = @TaskId
     ORDER BY Direction, TaskId;
END
GO

IF OBJECT_ID('dbo.sp_AddTaskDependency', 'P') IS NOT NULL DROP PROCEDURE dbo.sp_AddTaskDependency;
GO

CREATE PROCEDURE dbo.sp_AddTaskDependency
    @TaskId           BIGINT,
    @DependsOnTaskId  BIGINT,
    @Type             VARCHAR(20) = 'blocks',
    @ActingUserId     INT,
    @IsAdmin          BIT = 0,
    @CompId           BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);

    IF (@TaskId IS NULL OR @TaskId <= 0 OR @DependsOnTaskId IS NULL OR @DependsOnTaskId <= 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'TaskId and DependsOnTaskId are required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@TaskId = @DependsOnTaskId)
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'A task cannot depend on itself';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM dbo.tblTasks WHERE Id = @TaskId)
       OR NOT EXISTS (SELECT 1 FROM dbo.tblTasks WHERE Id = @DependsOnTaskId)
    BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Task(s) not found';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    DECLARE @Perm TABLE (Allowed BIT, Reason VARCHAR(400));
    INSERT INTO @Perm
    EXEC dbo.sp_CheckTaskPermission
        @TaskId = @TaskId, @WorkspaceId = NULL, @CommentId = NULL,
        @UserId = @ActingUserId, @Action = 'add_dependency',
        @IsAdmin = @IsAdmin, @CompId = @CompId;
    IF NOT EXISTS (SELECT 1 FROM @Perm WHERE Allowed = 1)
    BEGIN SET @ResponseCode = 403;
          SET @ResponseMess = 'Permission denied: ' + ISNULL((SELECT TOP 1 Reason FROM @Perm), 'no reason');
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF EXISTS (SELECT 1 FROM dbo.tblTaskDependencies
                WHERE TaskId = @TaskId AND DependsOnTaskId = @DependsOnTaskId)
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Dependency already exists';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    DECLARE @Visited TABLE (TaskId BIGINT PRIMARY KEY);
    DECLARE @Frontier TABLE (TaskId BIGINT);
    INSERT INTO @Frontier VALUES (@DependsOnTaskId);
    DECLARE @Cycle BIT = 0;

    WHILE EXISTS (SELECT 1 FROM @Frontier) AND @Cycle = 0
    BEGIN
        DECLARE @Next TABLE (TaskId BIGINT);
        INSERT INTO @Next
        SELECT DISTINCT d.DependsOnTaskId
          FROM dbo.tblTaskDependencies d
         WHERE d.TaskId IN (SELECT TaskId FROM @Frontier)
           AND d.DependsOnTaskId NOT IN (SELECT TaskId FROM @Visited);

        IF EXISTS (SELECT 1 FROM @Next WHERE TaskId = @TaskId) SET @Cycle = 1;

        INSERT INTO @Visited SELECT TaskId FROM @Frontier;
        DELETE FROM @Frontier;
        INSERT INTO @Frontier SELECT TaskId FROM @Next;
        DELETE FROM @Next;
    END

    IF (@Cycle = 1)
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Dependency would create a cycle';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    INSERT INTO dbo.tblTaskDependencies (TaskId, DependsOnTaskId, Type, CreatedByUserId)
    VALUES (@TaskId, @DependsOnTaskId, @Type, @ActingUserId);

    IF (@Type = 'blocks')
        UPDATE dbo.tblTasks
           SET IsBlocked = 1, UpdatedDate = GETDATE()
         WHERE Id = @TaskId
           AND EXISTS (
               SELECT 1 FROM dbo.tblTaskDependencies d
               JOIN dbo.tblTasks b ON b.Id = d.DependsOnTaskId
              WHERE d.TaskId = @TaskId AND d.Type = 'blocks'
                AND ISNULL(b.IsCompleted, 0) = 0
           );

    SET @ResponseCode = 201; SET @ResponseMess = 'Dependency added';
    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
           @TaskId AS TaskId, @DependsOnTaskId AS DependsOnTaskId, @Type AS Type;
END
GO

IF OBJECT_ID('dbo.sp_RemoveTaskDependency', 'P') IS NOT NULL DROP PROCEDURE dbo.sp_RemoveTaskDependency;
GO

CREATE PROCEDURE dbo.sp_RemoveTaskDependency
    @TaskId           BIGINT,
    @DependsOnTaskId  BIGINT,
    @ActingUserId     INT,
    @IsAdmin          BIT = 0,
    @CompId           BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);

    IF NOT EXISTS (SELECT 1 FROM dbo.tblTaskDependencies
                    WHERE TaskId = @TaskId AND DependsOnTaskId = @DependsOnTaskId)
    BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Dependency not found';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    DECLARE @Perm TABLE (Allowed BIT, Reason VARCHAR(400));
    INSERT INTO @Perm
    EXEC dbo.sp_CheckTaskPermission
        @TaskId = @TaskId, @WorkspaceId = NULL, @CommentId = NULL,
        @UserId = @ActingUserId, @Action = 'add_dependency',
        @IsAdmin = @IsAdmin, @CompId = @CompId;
    IF NOT EXISTS (SELECT 1 FROM @Perm WHERE Allowed = 1)
    BEGIN SET @ResponseCode = 403;
          SET @ResponseMess = 'Permission denied: ' + ISNULL((SELECT TOP 1 Reason FROM @Perm), 'no reason');
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    DELETE FROM dbo.tblTaskDependencies
     WHERE TaskId = @TaskId AND DependsOnTaskId = @DependsOnTaskId;

    UPDATE dbo.tblTasks
       SET IsBlocked = CASE WHEN EXISTS (
                           SELECT 1 FROM dbo.tblTaskDependencies d
                           JOIN dbo.tblTasks b ON b.Id = d.DependsOnTaskId
                           WHERE d.TaskId = @TaskId AND d.Type = 'blocks'
                             AND ISNULL(b.IsCompleted, 0) = 0
                       ) THEN 1 ELSE 0 END,
           UpdatedDate = GETDATE()
     WHERE Id = @TaskId;

    SET @ResponseCode = 200; SET @ResponseMess = 'Dependency removed';
    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
           @TaskId AS TaskId, @DependsOnTaskId AS DependsOnTaskId;
END
GO

IF OBJECT_ID('dbo.sp_ResolveDependencies', 'P') IS NOT NULL DROP PROCEDURE dbo.sp_ResolveDependencies;
GO

CREATE PROCEDURE dbo.sp_ResolveDependencies
    @ResolvedTaskId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Unblocked TABLE (TaskId BIGINT);

    UPDATE t
       SET IsBlocked = 0, UpdatedDate = GETDATE()
      OUTPUT inserted.Id INTO @Unblocked (TaskId)
      FROM dbo.tblTasks t
     WHERE t.IsBlocked = 1
       AND EXISTS (SELECT 1 FROM dbo.tblTaskDependencies d
                    WHERE d.TaskId = t.Id AND d.DependsOnTaskId = @ResolvedTaskId
                      AND d.Type = 'blocks')
       AND NOT EXISTS (
           SELECT 1 FROM dbo.tblTaskDependencies d2
           JOIN dbo.tblTasks b ON b.Id = d2.DependsOnTaskId
           WHERE d2.TaskId = t.Id AND d2.Type = 'blocks'
             AND ISNULL(b.IsCompleted, 0) = 0
       );

    SELECT 200 AS ResponseCode, 'Dependencies resolved' AS ResponseMess,
           TaskId FROM @Unblocked;
END
GO

PRINT 'Migration 030 complete — checklist-driven completion active.';
GO
