-- ============================================================
-- Migration 024 — Dependency SPs use column.IsDone instead of Status.
--
-- Migration 022 dropped tblTasks.Status; three dependency SPs still
-- referenced it and would break once the column is gone:
--   sp_AddTaskDependency       (IsBlocked recompute)
--   sp_RemoveTaskDependency    (IsBlocked recompute)
--   sp_FetchTaskDependencies   (Status in result set)
--   sp_ResolveDependencies     (done-detection)
--
-- All "blocker task is done" checks now read column.IsDone = 1
-- (LEFT JOIN on tblKanbanColumns via ColumnId). The fetch SP replaces
-- Status in the projection with ColumnTitle + ColumnIsDone.
-- ============================================================

USE [eCRM+];
GO

-- ----- sp_AddTaskDependency -----------------------------------
IF OBJECT_ID('dbo.sp_AddTaskDependency', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_AddTaskDependency;
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

    -- Permission: caller must be able to edit the dependent task
    DECLARE @Perm TABLE (Allowed BIT, Reason VARCHAR(400));
    INSERT INTO @Perm
    EXEC dbo.sp_CheckTaskPermission
        @TaskId = @TaskId, @WorkspaceId = NULL, @CommentId = NULL,
        @UserId = @ActingUserId, @Action = 'add_dependency',
        @IsAdmin = @IsAdmin, @CompId = @CompId;
    IF NOT EXISTS (SELECT 1 FROM @Perm WHERE Allowed = 1)
    BEGIN
        SET @ResponseCode = 403;
        SET @ResponseMess = 'Permission denied: ' + ISNULL((SELECT TOP 1 Reason FROM @Perm), 'no reason');
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
    END

    IF EXISTS (SELECT 1 FROM dbo.tblTaskDependencies
                WHERE TaskId = @TaskId AND DependsOnTaskId = @DependsOnTaskId)
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Dependency already exists';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- Cycle check via BFS
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

        IF EXISTS (SELECT 1 FROM @Next WHERE TaskId = @TaskId)
            SET @Cycle = 1;

        INSERT INTO @Visited SELECT TaskId FROM @Frontier;
        DELETE FROM @Frontier;
        INSERT INTO @Frontier SELECT TaskId FROM @Next;
        DELETE FROM @Next;
    END

    IF (@Cycle = 1)
    BEGIN SET @ResponseCode = 409;
          SET @ResponseMess = 'Dependency would create a cycle';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    INSERT INTO dbo.tblTaskDependencies (TaskId, DependsOnTaskId, Type, CreatedByUserId)
    VALUES (@TaskId, @DependsOnTaskId, @Type, @ActingUserId);

    -- Recompute IsBlocked via column.IsDone rather than Status.
    IF (@Type = 'blocks')
    BEGIN
        UPDATE dbo.tblTasks
           SET IsBlocked = 1,
               UpdatedDate = GETDATE()
         WHERE Id = @TaskId
           AND EXISTS (
               SELECT 1 FROM dbo.tblTaskDependencies d
               JOIN dbo.tblTasks b               ON b.Id  = d.DependsOnTaskId
               LEFT JOIN dbo.tblKanbanColumns bc ON bc.Id = b.ColumnId
              WHERE d.TaskId = @TaskId
                AND d.Type = 'blocks'
                AND (bc.IsDone IS NULL OR bc.IsDone = 0)
           );
    END

    SET @ResponseCode = 201; SET @ResponseMess = 'Dependency added';
    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
           @TaskId AS TaskId, @DependsOnTaskId AS DependsOnTaskId, @Type AS Type;
END
GO

-- ----- sp_RemoveTaskDependency --------------------------------
IF OBJECT_ID('dbo.sp_RemoveTaskDependency', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_RemoveTaskDependency;
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
    BEGIN
        SET @ResponseCode = 403;
        SET @ResponseMess = 'Permission denied: ' + ISNULL((SELECT TOP 1 Reason FROM @Perm), 'no reason');
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
    END

    DELETE FROM dbo.tblTaskDependencies
     WHERE TaskId = @TaskId AND DependsOnTaskId = @DependsOnTaskId;

    UPDATE dbo.tblTasks
       SET IsBlocked = CASE WHEN EXISTS (
                           SELECT 1 FROM dbo.tblTaskDependencies d
                           JOIN dbo.tblTasks b               ON b.Id  = d.DependsOnTaskId
                           LEFT JOIN dbo.tblKanbanColumns bc ON bc.Id = b.ColumnId
                           WHERE d.TaskId = @TaskId
                             AND d.Type = 'blocks'
                             AND (bc.IsDone IS NULL OR bc.IsDone = 0)
                       ) THEN 1 ELSE 0 END,
           UpdatedDate = GETDATE()
     WHERE Id = @TaskId;

    SET @ResponseCode = 200; SET @ResponseMess = 'Dependency removed';
    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
           @TaskId AS TaskId, @DependsOnTaskId AS DependsOnTaskId;
END
GO

-- ----- sp_FetchTaskDependencies -------------------------------
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
        SET @ResponseCode = 403;
        SET @ResponseMess = 'Permission denied';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               NULL AS Direction, NULL AS TaskId, NULL AS Title,
               NULL AS ColumnTitle, NULL AS ColumnIsDone, NULL AS Type;
        RETURN;
    END

    SET @ResponseCode = 200; SET @ResponseMess = 'Dependencies retrieved';

    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
           'blocker'   AS Direction,
           b.Id        AS TaskId,
           b.Title,
           bc.Title    AS ColumnTitle,
           ISNULL(bc.IsDone, 0) AS ColumnIsDone,
           d.Type
      FROM dbo.tblTaskDependencies d
      JOIN dbo.tblTasks b ON b.Id = d.DependsOnTaskId
      LEFT JOIN dbo.tblKanbanColumns bc ON bc.Id = b.ColumnId
     WHERE d.TaskId = @TaskId
    UNION ALL
    SELECT @ResponseCode, @ResponseMess,
           'dependent' AS Direction,
           dep.Id      AS TaskId,
           dep.Title,
           dc.Title    AS ColumnTitle,
           ISNULL(dc.IsDone, 0) AS ColumnIsDone,
           d.Type
      FROM dbo.tblTaskDependencies d
      JOIN dbo.tblTasks dep ON dep.Id = d.TaskId
      LEFT JOIN dbo.tblKanbanColumns dc ON dc.Id = dep.ColumnId
     WHERE d.DependsOnTaskId = @TaskId
     ORDER BY Direction, TaskId;
END
GO

-- ----- sp_ResolveDependencies ---------------------------------
IF OBJECT_ID('dbo.sp_ResolveDependencies', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_ResolveDependencies;
GO

CREATE PROCEDURE dbo.sp_ResolveDependencies
    @ResolvedTaskId BIGINT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Unblocked TABLE (TaskId BIGINT);

    UPDATE t
       SET IsBlocked = 0,
           UpdatedDate = GETDATE()
      OUTPUT inserted.Id INTO @Unblocked (TaskId)
      FROM dbo.tblTasks t
     WHERE t.IsBlocked = 1
       AND EXISTS (SELECT 1 FROM dbo.tblTaskDependencies d
                    WHERE d.TaskId = t.Id AND d.DependsOnTaskId = @ResolvedTaskId
                      AND d.Type = 'blocks')
       AND NOT EXISTS (
           SELECT 1 FROM dbo.tblTaskDependencies d2
           JOIN dbo.tblTasks b               ON b.Id  = d2.DependsOnTaskId
           LEFT JOIN dbo.tblKanbanColumns bc ON bc.Id = b.ColumnId
           WHERE d2.TaskId = t.Id AND d2.Type = 'blocks'
             AND (bc.IsDone IS NULL OR bc.IsDone = 0)
       );

    SELECT 200 AS ResponseCode, 'Dependencies resolved' AS ResponseMess,
           TaskId FROM @Unblocked;
END
GO

PRINT 'Migration 024 complete — dependency SPs use column.IsDone.';
GO
