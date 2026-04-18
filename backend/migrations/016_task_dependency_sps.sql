-- ============================================================
-- Migration 016 — task dependency stored procedures
--
-- SPs created:
--   sp_AddTaskDependency       enforces manage_deps perm + cycle detection (BFS)
--   sp_RemoveTaskDependency    same perm check
--   sp_FetchTaskDependencies   list blockers + blocked-by for a task
--   sp_ResolveDependencies     called when blocker flips to Done — recomputes
--                              IsBlocked for dependents (notifications deferred
--                              until Phase 1.9)
-- ============================================================

USE [eCRM+]
GO

SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- ============================================================
-- 1) sp_AddTaskDependency
-- ============================================================
IF OBJECT_ID('dbo.sp_AddTaskDependency', 'P') IS NOT NULL DROP PROCEDURE dbo.sp_AddTaskDependency;
GO

CREATE PROCEDURE dbo.sp_AddTaskDependency
    @TaskId           BIGINT,         -- the dependent
    @DependsOnTaskId  BIGINT,         -- the blocker
    @Type             VARCHAR(20) = 'blocks',
    @ActingUserId     INT,
    @IsAdmin          BIT         = 0,
    @CompId           BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);

    IF (@TaskId = @DependsOnTaskId)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'A task cannot depend on itself';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@Type NOT IN ('blocks','related'))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid dependency type';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM dbo.tblTasks WHERE Id = @TaskId)
       OR NOT EXISTS (SELECT 1 FROM dbo.tblTasks WHERE Id = @DependsOnTaskId)
    BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Task(s) not found';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- Permission: add_dependency on the dependent task
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

    -- Duplicate guard
    IF EXISTS (SELECT 1 FROM dbo.tblTaskDependencies
                WHERE TaskId = @TaskId AND DependsOnTaskId = @DependsOnTaskId)
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Dependency already exists';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- Cycle detection via recursive CTE walking outbound edges
    -- Starting at @DependsOnTaskId — if we can reach @TaskId, adding
    -- (TaskId → DependsOnTaskId) would close a cycle.
    DECLARE @Cycle BIT = 0;
    ;WITH reachable AS (
        SELECT DependsOnTaskId AS Node, 1 AS depth
          FROM dbo.tblTaskDependencies
         WHERE TaskId = @DependsOnTaskId
        UNION ALL
        SELECT d.DependsOnTaskId, r.depth + 1
          FROM dbo.tblTaskDependencies d
          JOIN reachable r ON d.TaskId = r.Node
         WHERE r.depth < 100
    )
    SELECT @Cycle = CASE WHEN EXISTS (SELECT 1 FROM reachable WHERE Node = @TaskId) THEN 1 ELSE 0 END
    OPTION (MAXRECURSION 0);

    IF (@Cycle = 1)
    BEGIN SET @ResponseCode = 409;
          SET @ResponseMess = 'Dependency would create a cycle';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    INSERT INTO dbo.tblTaskDependencies (TaskId, DependsOnTaskId, Type, CreatedByUserId)
    VALUES (@TaskId, @DependsOnTaskId, @Type, @ActingUserId);

    -- Recompute IsBlocked on the dependent
    IF (@Type = 'blocks')
    BEGIN
        UPDATE dbo.tblTasks
           SET IsBlocked = 1,
               UpdatedDate = GETDATE()
         WHERE Id = @TaskId
           AND EXISTS (
               SELECT 1 FROM dbo.tblTaskDependencies d
               JOIN dbo.tblTasks b ON b.Id = d.DependsOnTaskId
               WHERE d.TaskId = @TaskId AND d.Type = 'blocks'
                 AND (b.Status IS NULL OR b.Status <> 'done')
           );
    END

    SET @ResponseCode = 201; SET @ResponseMess = 'Dependency added';
    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
           @TaskId AS TaskId, @DependsOnTaskId AS DependsOnTaskId, @Type AS Type;
END
GO

-- ============================================================
-- 2) sp_RemoveTaskDependency
-- ============================================================
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
    BEGIN
        SET @ResponseCode = 403;
        SET @ResponseMess = 'Permission denied: ' + ISNULL((SELECT TOP 1 Reason FROM @Perm), 'no reason');
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
    END

    DELETE FROM dbo.tblTaskDependencies
     WHERE TaskId = @TaskId AND DependsOnTaskId = @DependsOnTaskId;

    -- Recompute IsBlocked
    UPDATE dbo.tblTasks
       SET IsBlocked = CASE WHEN EXISTS (
                           SELECT 1 FROM dbo.tblTaskDependencies d
                           JOIN dbo.tblTasks b ON b.Id = d.DependsOnTaskId
                           WHERE d.TaskId = @TaskId AND d.Type = 'blocks'
                             AND (b.Status IS NULL OR b.Status <> 'done')
                       ) THEN 1 ELSE 0 END,
           UpdatedDate = GETDATE()
     WHERE Id = @TaskId;

    SET @ResponseCode = 200; SET @ResponseMess = 'Dependency removed';
    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
           @TaskId AS TaskId, @DependsOnTaskId AS DependsOnTaskId;
END
GO

-- ============================================================
-- 3) sp_FetchTaskDependencies
-- ============================================================
IF OBJECT_ID('dbo.sp_FetchTaskDependencies', 'P') IS NOT NULL DROP PROCEDURE dbo.sp_FetchTaskDependencies;
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

    -- Permission: view_task
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
               NULL AS Direction, NULL AS TaskId, NULL AS Title, NULL AS Status, NULL AS Type;
        RETURN;
    END

    SET @ResponseCode = 200; SET @ResponseMess = 'Dependencies retrieved';

    -- Two directions:
    --   'blocker'   — tasks this one depends on (what we're waiting for)
    --   'dependent' — tasks that depend on this one (what's waiting for us)
    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
           'blocker'   AS Direction,
           b.Id        AS TaskId,
           b.Title,
           b.Status,
           d.Type
      FROM dbo.tblTaskDependencies d
      JOIN dbo.tblTasks b ON b.Id = d.DependsOnTaskId
     WHERE d.TaskId = @TaskId
    UNION ALL
    SELECT @ResponseCode, @ResponseMess,
           'dependent' AS Direction,
           dep.Id      AS TaskId,
           dep.Title,
           dep.Status,
           d.Type
      FROM dbo.tblTaskDependencies d
      JOIN dbo.tblTasks dep ON dep.Id = d.TaskId
     WHERE d.DependsOnTaskId = @TaskId
     ORDER BY Direction, TaskId;
END
GO

-- ============================================================
-- 4) sp_ResolveDependencies
-- Called after a task's Status flips to 'done' — unblocks dependents.
-- Notification emission is deferred to Phase 1.9 (tblNotifications).
-- Returns a result set of TaskIds that got unblocked for the caller
-- to act on.
-- ============================================================
IF OBJECT_ID('dbo.sp_ResolveDependencies', 'P') IS NOT NULL DROP PROCEDURE dbo.sp_ResolveDependencies;
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
           JOIN dbo.tblTasks b ON b.Id = d2.DependsOnTaskId
           WHERE d2.TaskId = t.Id AND d2.Type = 'blocks'
             AND (b.Status IS NULL OR b.Status <> 'done')
       );

    SELECT 200 AS ResponseCode, 'Dependencies resolved' AS ResponseMess,
           TaskId FROM @Unblocked;
END
GO

-- ============================================================
-- 5) Sanity checks
-- ============================================================
PRINT '----- migration 016 sanity -----';

SELECT 'sp_AddTaskDependency'     AS chk, CASE WHEN OBJECT_ID('dbo.sp_AddTaskDependency','P')     IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
UNION ALL SELECT 'sp_RemoveTaskDependency',  CASE WHEN OBJECT_ID('dbo.sp_RemoveTaskDependency','P')  IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'sp_FetchTaskDependencies', CASE WHEN OBJECT_ID('dbo.sp_FetchTaskDependencies','P') IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'sp_ResolveDependencies',   CASE WHEN OBJECT_ID('dbo.sp_ResolveDependencies','P')   IS NOT NULL THEN 'OK' ELSE 'MISSING' END;
GO
