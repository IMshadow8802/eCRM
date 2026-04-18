-- ============================================================
-- Migration 012 — Retire tblTaskActivity, canonicalize on tblActivityLog
--
-- Background:
--   * Migration 007 repointed sp_FetchTaskActivity at tblActivityLog.
--   * Controller-side logActivity() already writes audit rows via
--     sp_SaveActivityLog → tblActivityLog (see activityLogger.js).
--   * 8 SPs still INSERT/DELETE rows in tblTaskActivity as duplicates:
--       sp_SaveTask, sp_SaveTaskComment, sp_DeleteTaskComment,
--       sp_DeleteTimeEntry, sp_SoftDeleteTask, sp_DeleteTask,
--       sp_BulkDeleteTasks, sp_DeleteUser.
--   * Row count currently 0, so dropping is safe.
--
-- This migration:
--   1) ALTER PROC each of the 8 SPs to remove tblTaskActivity refs.
--      INSERTs are simply removed (central log via controller covers them).
--      DELETE FROM tblTaskActivity WHERE ... cascade cleanups are removed
--      (the central log is not task-keyed for cascade; retention is handled
--      separately by ops policy).
--   2) DROP TABLE tblTaskActivity.
--
-- Note: sp_SaveTask and sp_SaveTaskComment are heavy SPs that will be
-- rewritten end-to-end in migrations 014/015 (Phase 1.6 / 1.8). The
-- edits here are minimal — just the tblTaskActivity removal — to keep
-- the diff reviewable.
--
-- Run in [eCRM+]. Each ALTER PROC in its own GO batch.
-- ============================================================

USE [eCRM+]
GO

SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- ============================================================
-- 1) sp_SaveTask — drop 3 activity inserts (created / status_changed / updated)
-- ============================================================
ALTER PROC dbo.sp_SaveTask
    @Id BIGINT,
    @Title VARCHAR(500),
    @Description NVARCHAR(MAX),
    @ProjectId INT,
    @ParentTaskId BIGINT,
    @AssignedToUserId INT,
    @CreatedByUserId INT,
    @TeamId INT,
    @Priority VARCHAR(20),
    @Type VARCHAR(50),
    @Status VARCHAR(50),
    @DueDate DATE,
    @EstimatedHours DECIMAL(10,2),
    @LoggedHours DECIMAL(10,2),
    @Progress DECIMAL(5,2),
    @IsBlocked BIT,
    @Labels NVARCHAR(MAX),
    @Watchers NVARCHAR(MAX),
    @Dependencies NVARCHAR(MAX) = NULL,  -- legacy JSON, ignored. Real dependencies live in tblTaskDependencies (Phase 1.7).
    @CompId BIGINT,
    @BranchId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);

    IF (@Title IS NULL OR LTRIM(RTRIM(@Title)) = '')
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Task title is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@ProjectId IS NULL OR @ProjectId <= 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Project is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@CreatedByUserId IS NULL OR @CreatedByUserId <= 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Created by user is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM tblProjects WHERE Id = @ProjectId)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid project selected';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@AssignedToUserId IS NOT NULL AND @AssignedToUserId > 0)
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM tblUser WHERE Id = @AssignedToUserId AND IsActive = 1)
        BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid assigned user selected';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    END

    IF (@TeamId IS NOT NULL AND @TeamId > 0)
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM tblTeams WHERE Id = @TeamId AND IsActive = 1)
        BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid team selected';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    END

    IF (@ParentTaskId IS NOT NULL AND @ParentTaskId > 0)
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM tblTasks WHERE Id = @ParentTaskId)
        BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid parent task selected';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    END

    IF (@Id = 0)
    BEGIN
        INSERT INTO tblTasks (Title, Description, ProjectId, ParentTaskId, AssignedToUserId, CreatedByUserId,
                             TeamId, Priority, Type, Status, DueDate, EstimatedHours, LoggedHours,
                             Progress, IsBlocked, Labels, Watchers)
        VALUES (@Title, @Description, @ProjectId, @ParentTaskId, @AssignedToUserId, @CreatedByUserId,
                @TeamId, @Priority, @Type, @Status, @DueDate, @EstimatedHours, @LoggedHours,
                @Progress, @IsBlocked, @Labels, @Watchers);

        SET @Id = SCOPE_IDENTITY();

        SET @ResponseCode = 201; SET @ResponseMess = 'Task created successfully';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, @Id AS TaskId;
    END
    ELSE
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM tblTasks WHERE Id = @Id)
        BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Task not found';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

        UPDATE tblTasks
        SET Title = @Title, Description = @Description, ProjectId = @ProjectId,
            ParentTaskId = @ParentTaskId, AssignedToUserId = @AssignedToUserId, TeamId = @TeamId,
            Priority = @Priority, Type = @Type, Status = @Status, DueDate = @DueDate,
            EstimatedHours = @EstimatedHours, LoggedHours = @LoggedHours, Progress = @Progress,
            IsBlocked = @IsBlocked, Labels = @Labels, Watchers = @Watchers,
            UpdatedDate = GETDATE()
        WHERE Id = @Id;

        SET @ResponseCode = 200; SET @ResponseMess = 'Task updated successfully';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, @Id AS TaskId;
    END
END
GO

-- ============================================================
-- 2) sp_SaveTaskComment — drop activity insert
-- ============================================================
ALTER PROC dbo.sp_SaveTaskComment
    @Id BIGINT,
    @TaskId BIGINT,
    @UserId INT,
    @Comment NVARCHAR(MAX),
    @IsEdited BIT,
    @CompId BIGINT,
    @BranchId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);

    IF (@TaskId IS NULL OR @TaskId <= 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Task ID is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    IF (@UserId IS NULL OR @UserId <= 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'User ID is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    IF (@Comment IS NULL OR LTRIM(RTRIM(@Comment)) = '')
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Comment cannot be blank';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM tblTasks WHERE Id = @TaskId)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid task selected';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM tblUser WHERE Id = @UserId AND IsActive = 1)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid user selected';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@Id = 0)
    BEGIN
        INSERT INTO tblTaskComments (TaskId, UserId, Comment, IsEdited)
        VALUES (@TaskId, @UserId, @Comment, 0);
        SET @Id = SCOPE_IDENTITY();

        SET @ResponseCode = 201; SET @ResponseMess = 'Comment added successfully';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, @Id AS CommentId;
    END
    ELSE
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM tblTaskComments WHERE Id = @Id AND UserId = @UserId)
        BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Comment not found or access denied';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

        UPDATE tblTaskComments
            SET Comment = @Comment, IsEdited = 1, UpdatedDate = GETDATE()
            WHERE Id = @Id AND UserId = @UserId;
        SET @ResponseCode = 200; SET @ResponseMess = 'Comment updated successfully';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, @Id AS CommentId;
    END
END
GO

-- ============================================================
-- 3) sp_DeleteTaskComment — drop activity insert
--    (soft delete behavior is introduced in migration 015 / Phase 1.8;
--    this ALTER retains hard-delete semantics to match current callers.)
-- ============================================================
ALTER PROC dbo.sp_DeleteTaskComment
    @Id BIGINT,
    @UserId INT,
    @CompId BIGINT,
    @BranchId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);

    IF (@Id IS NULL OR @Id <= 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Comment ID is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM tblTaskComments WHERE Id = @Id AND UserId = @UserId)
    BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Comment not found or access denied';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    DELETE FROM tblTaskComments WHERE Id = @Id;

    SET @ResponseCode = 200; SET @ResponseMess = 'Comment deleted successfully';
    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
END
GO

-- ============================================================
-- 4) sp_DeleteTimeEntry — drop activity insert
-- ============================================================
ALTER PROC dbo.sp_DeleteTimeEntry
    @Id BIGINT,
    @UserId INT,
    @CompId BIGINT,
    @BranchId BIGINT,
    @IsAdmin BIT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);
    DECLARE @TaskId BIGINT;
    DECLARE @Hours DECIMAL(10,2);

    IF (@Id IS NULL OR @Id <= 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Time entry ID is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM tblTimeEntries WHERE Id = @Id AND (@IsAdmin = 1 OR UserId = @UserId))
    BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Time entry not found or access denied';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    SELECT @TaskId = TaskId, @Hours = Hours FROM tblTimeEntries WHERE Id = @Id;

    BEGIN TRY
        BEGIN TRANSACTION;

        DELETE FROM tblTimeEntries WHERE Id = @Id;

        UPDATE tblTasks
            SET LoggedHours = LoggedHours - @Hours
            WHERE Id = @TaskId;

        COMMIT TRANSACTION;

        SET @ResponseCode = 200; SET @ResponseMess = 'Time entry deleted successfully';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SET @ResponseCode = 500;
        SET @ResponseMess = 'Failed to delete time entry: ' + ERROR_MESSAGE();
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END CATCH
END
GO

-- ============================================================
-- 5) sp_SoftDeleteTask — drop activity insert
-- ============================================================
ALTER PROC dbo.sp_SoftDeleteTask
    @Id BIGINT,
    @UserId INT,
    @CompId BIGINT,
    @BranchId BIGINT,
    @IsAdmin BIT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);

    IF (@Id IS NULL OR @Id <= 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Task ID is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF NOT EXISTS (
        SELECT 1 FROM tblTasks t
        INNER JOIN tblProjects p ON t.ProjectId = p.Id
        LEFT JOIN tblTeamMembers tm ON tm.TeamId = t.TeamId AND tm.UserId = @UserId
        WHERE t.Id = @Id
          AND (@IsAdmin = 1 OR t.AssignedToUserId = @UserId OR t.CreatedByUserId = @UserId OR
               tm.UserId IS NOT NULL OR p.ManagerUserId = @UserId OR
               JSON_VALUE(p.Members, '$') LIKE '%' + CAST(@UserId AS VARCHAR) + '%' OR
               JSON_VALUE(t.Watchers, '$') LIKE '%' + CAST(@UserId AS VARCHAR) + '%')
    )
    BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Task not found or access denied';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    UPDATE tblTasks SET Status = 'deleted', UpdatedDate = GETDATE() WHERE Id = @Id;

    SET @ResponseCode = 200; SET @ResponseMess = 'Task deleted successfully';
    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
END
GO

-- ============================================================
-- 6) sp_DeleteTask — drop cascade DELETE from tblTaskActivity
-- ============================================================
ALTER PROC dbo.sp_DeleteTask
    @Id BIGINT,
    @UserId INT,
    @CompId BIGINT,
    @BranchId BIGINT,
    @IsAdmin BIT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);

    IF (@Id IS NULL OR @Id <= 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Task ID is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF NOT EXISTS (
        SELECT 1 FROM tblTasks t
        INNER JOIN tblProjects p ON t.ProjectId = p.Id
        LEFT JOIN tblTeamMembers tm ON tm.TeamId = t.TeamId AND tm.UserId = @UserId
        WHERE t.Id = @Id
          AND (@IsAdmin = 1 OR t.AssignedToUserId = @UserId OR t.CreatedByUserId = @UserId OR
               tm.UserId IS NOT NULL OR p.ManagerUserId = @UserId OR
               JSON_VALUE(p.Members, '$') LIKE '%' + CAST(@UserId AS VARCHAR) + '%' OR
               JSON_VALUE(t.Watchers, '$') LIKE '%' + CAST(@UserId AS VARCHAR) + '%')
    )
    BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Task not found or access denied';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF EXISTS (SELECT 1 FROM tblTasks WHERE ParentTaskId = @Id)
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Cannot delete task - has subtasks. Please delete subtasks first';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;

        DELETE FROM tblTaskChecklist    WHERE TaskId = @Id;
        DELETE FROM tblTimeEntries      WHERE TaskId = @Id;
        DELETE FROM tblTaskComments     WHERE TaskId = @Id;
        DELETE FROM tblTaskDependencies WHERE TaskId = @Id OR DependsOnTaskId = @Id;
        DELETE FROM tblTaskReads        WHERE TaskId = @Id;
        DELETE FROM tblTasks            WHERE Id = @Id;

        COMMIT TRANSACTION;

        SET @ResponseCode = 200; SET @ResponseMess = 'Task deleted successfully';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SET @ResponseCode = 500; SET @ResponseMess = 'Failed to delete task: ' + ERROR_MESSAGE();
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END CATCH
END
GO

-- ============================================================
-- 7) sp_BulkDeleteTasks — drop cascade DELETE from tblTaskActivity
-- ============================================================
ALTER PROC dbo.sp_BulkDeleteTasks
    @TaskIds NVARCHAR(MAX),
    @UserId INT,
    @CompId BIGINT,
    @BranchId BIGINT,
    @IsAdmin BIT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);
    DECLARE @DeletedCount INT = 0;
    DECLARE @FailedCount INT = 0;

    IF (@TaskIds IS NULL OR LTRIM(RTRIM(@TaskIds)) = '')
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Task IDs are required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    CREATE TABLE #TempTaskIds (TaskId BIGINT);

    INSERT INTO #TempTaskIds (TaskId)
    SELECT CAST(value AS BIGINT)
    FROM STRING_SPLIT(@TaskIds, ',')
    WHERE ISNUMERIC(value) = 1;

    IF EXISTS (
        SELECT 1 FROM #TempTaskIds temp
        WHERE NOT EXISTS (
            SELECT 1 FROM tblTasks t
            INNER JOIN tblProjects p ON t.ProjectId = p.Id
            LEFT JOIN tblTeamMembers tm ON tm.TeamId = t.TeamId AND tm.UserId = @UserId
            WHERE t.Id = temp.TaskId
              AND (@IsAdmin = 1 OR t.AssignedToUserId = @UserId OR t.CreatedByUserId = @UserId OR
                   tm.UserId IS NOT NULL OR p.ManagerUserId = @UserId OR
                   JSON_VALUE(p.Members, '$') LIKE '%' + CAST(@UserId AS VARCHAR) + '%' OR
                   JSON_VALUE(t.Watchers, '$') LIKE '%' + CAST(@UserId AS VARCHAR) + '%')
        )
    )
    BEGIN SET @ResponseCode = 403; SET @ResponseMess = 'Access denied to one or more tasks';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF EXISTS (
        SELECT 1 FROM tblTasks t INNER JOIN #TempTaskIds temp ON t.ParentTaskId = temp.TaskId
    )
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'One or more tasks have subtasks. Please delete subtasks first';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;

        DELETE tc FROM tblTaskChecklist tc
            INNER JOIN #TempTaskIds temp ON tc.TaskId = temp.TaskId;

        DELETE te FROM tblTimeEntries te
            INNER JOIN #TempTaskIds temp ON te.TaskId = temp.TaskId;

        DELETE tcm FROM tblTaskComments tcm
            INNER JOIN #TempTaskIds temp ON tcm.TaskId = temp.TaskId;

        DELETE td FROM tblTaskDependencies td
            INNER JOIN #TempTaskIds temp
            ON td.TaskId = temp.TaskId OR td.DependsOnTaskId = temp.TaskId;

        DELETE tr FROM tblTaskReads tr
            INNER JOIN #TempTaskIds temp ON tr.TaskId = temp.TaskId;

        DELETE t FROM tblTasks t INNER JOIN #TempTaskIds temp ON t.Id = temp.TaskId;
        SET @DeletedCount = @@ROWCOUNT;

        COMMIT TRANSACTION;

        SET @ResponseCode = 200;
        SET @ResponseMess = CAST(@DeletedCount AS VARCHAR) + ' tasks deleted successfully';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               @DeletedCount AS DeletedCount, @FailedCount AS FailedCount;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SET @ResponseCode = 500;
        SET @ResponseMess = 'Failed to delete tasks: ' + ERROR_MESSAGE();
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               @DeletedCount AS DeletedCount, @FailedCount AS FailedCount;
    END CATCH

    DROP TABLE #TempTaskIds;
END
GO

-- ============================================================
-- 8) sp_DeleteUser — drop cascade DELETE from tblTaskActivity
-- ============================================================
ALTER PROC dbo.sp_DeleteUser
    @Id INT,
    @CompId BIGINT,
    @BranchId BIGINT,
    @IsAdmin BIT,
    @RequestingUserId INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);

    IF (@Id IS NULL OR @Id <= 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'User ID is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM tblUser WHERE Id = @Id AND CompId = @CompId AND (@IsAdmin = 1 OR BranchId = @BranchId))
    BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'User not found or access denied';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@Id = @RequestingUserId)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Cannot delete your own account';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF EXISTS (SELECT 1 FROM tblTasks WHERE AssignedToUserId = @Id)
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Cannot delete user - has assigned tasks';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF EXISTS (SELECT 1 FROM tblProjects WHERE ManagerUserId = @Id)
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Cannot delete user - is project manager';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF EXISTS (SELECT 1 FROM tblTeams WHERE LeadUserId = @Id)
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Cannot delete user - is team lead';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;
        DELETE FROM tblUserGroupMap WHERE UserId = @Id;
        DELETE FROM tblTeamMembers  WHERE UserId = @Id;
        DELETE FROM tblTimeEntries  WHERE UserId = @Id;
        DELETE FROM tblTaskComments WHERE UserId = @Id;
        DELETE FROM tblUser         WHERE Id = @Id;
        COMMIT TRANSACTION;

        SET @ResponseCode = 200; SET @ResponseMess = 'User deleted successfully';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SET @ResponseCode = 500;
        SET @ResponseMess = 'Failed to delete user: ' + ERROR_MESSAGE();
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END CATCH
END
GO

-- ============================================================
-- 9) Drop tblTaskActivity
-- ============================================================
IF OBJECT_ID('dbo.tblTaskActivity', 'U') IS NOT NULL
    DROP TABLE dbo.tblTaskActivity;
GO

-- ============================================================
-- 10) Sanity check
-- ============================================================
PRINT '----- migration 012 sanity -----';

SELECT 'tblTaskActivity (should be gone)' AS chk,
       CASE WHEN OBJECT_ID('dbo.tblTaskActivity','U') IS NOT NULL
            THEN 'STILL PRESENT' ELSE 'OK' END AS status
UNION ALL SELECT 'sp_SaveTask',           CASE WHEN OBJECT_ID('dbo.sp_SaveTask','P')           IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'sp_SaveTaskComment',    CASE WHEN OBJECT_ID('dbo.sp_SaveTaskComment','P')    IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'sp_DeleteTaskComment',  CASE WHEN OBJECT_ID('dbo.sp_DeleteTaskComment','P')  IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'sp_DeleteTimeEntry',    CASE WHEN OBJECT_ID('dbo.sp_DeleteTimeEntry','P')    IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'sp_SoftDeleteTask',     CASE WHEN OBJECT_ID('dbo.sp_SoftDeleteTask','P')     IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'sp_DeleteTask',         CASE WHEN OBJECT_ID('dbo.sp_DeleteTask','P')         IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'sp_BulkDeleteTasks',    CASE WHEN OBJECT_ID('dbo.sp_BulkDeleteTasks','P')    IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'sp_DeleteUser',         CASE WHEN OBJECT_ID('dbo.sp_DeleteUser','P')         IS NOT NULL THEN 'OK' ELSE 'MISSING' END;
GO

-- Verify no remaining SP references tblTaskActivity
PRINT '----- remaining tblTaskActivity references (should be 0) -----';
SELECT name AS SpReferencingTaskActivity
FROM sys.procedures
WHERE OBJECT_DEFINITION(object_id) LIKE '%tblTaskActivity%';
GO
