-- ============================================================
-- Migration 018b — fixup for sp_NotifyTaskAssigned + sp_NotifyCommentAdded
--
-- Both procs failed to CREATE in 018:
--   * sp_NotifyTaskAssigned  — EXEC param passed ISNULL(...) + literal
--                              concatenation; SQL Server rejects expressions
--                              as EXEC arguments.
--   * sp_NotifyCommentAdded  — same: CASE expression as EXEC arg.
--
-- Fix: pre-compute @Title/@Body/@Type into local variables, pass variables.
-- ============================================================

USE [eCRM+]
GO

SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- ============================================================
-- 1) sp_NotifyTaskAssigned (rebuilt)
-- ============================================================
IF OBJECT_ID('dbo.sp_NotifyTaskAssigned', 'P') IS NOT NULL DROP PROCEDURE dbo.sp_NotifyTaskAssigned;
GO

CREATE PROCEDURE dbo.sp_NotifyTaskAssigned
    @TaskId        BIGINT,
    @ActorUserId   INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @AssigneeId INT, @Title VARCHAR(500), @CompId BIGINT, @BranchId BIGINT;
    DECLARE @ActorName VARCHAR(200), @WsType VARCHAR(20), @OwnerId INT;

    SELECT @AssigneeId = t.AssignedToUserId,
           @Title      = t.Title,
           @CompId     = ISNULL(w.CompId, p.CompId),
           @BranchId   = ISNULL(w.BranchId, p.BranchId),
           @WsType     = w.Type,
           @OwnerId    = w.OwnerUserId
      FROM dbo.tblTasks t
      LEFT JOIN dbo.tblWorkspaces w ON w.Id = t.WorkspaceId
      LEFT JOIN dbo.tblProjects   p ON p.Id = t.ProjectId
     WHERE t.Id = @TaskId;

    IF (@AssigneeId IS NULL OR @AssigneeId <= 0) RETURN;
    IF (@WsType = 'personal' AND @AssigneeId = @OwnerId) RETURN;

    SELECT @ActorName = FullName FROM dbo.tblUser WHERE Id = @ActorUserId;

    DECLARE @NotifTitle VARCHAR(200) = 'New task assigned';
    DECLARE @NotifBody  NVARCHAR(1000) =
        ISNULL(@ActorName, 'Someone') + ' assigned you: ' + ISNULL(@Title, '');

    EXEC dbo.sp_CreateNotification
        @UserId       = @AssigneeId,
        @Type         = 'task_assigned',
        @EntityType   = 'task',
        @EntityId     = @TaskId,
        @ActorUserId  = @ActorUserId,
        @Title        = @NotifTitle,
        @Body         = @NotifBody,
        @CompId       = @CompId,
        @BranchId     = @BranchId,
        @SkipSelf     = 1;
END
GO

-- ============================================================
-- 2) sp_NotifyCommentAdded (rebuilt)
-- ============================================================
IF OBJECT_ID('dbo.sp_NotifyCommentAdded', 'P') IS NOT NULL DROP PROCEDURE dbo.sp_NotifyCommentAdded;
GO

CREATE PROCEDURE dbo.sp_NotifyCommentAdded
    @CommentId    BIGINT,
    @ActorUserId  INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @TaskId BIGINT, @Parent BIGINT, @CompId BIGINT, @BranchId BIGINT;
    DECLARE @TaskTitle VARCHAR(500), @ActorName VARCHAR(200), @WsType VARCHAR(20);

    SELECT @TaskId = c.TaskId, @Parent = c.ParentCommentId
      FROM dbo.tblTaskComments c
     WHERE c.Id = @CommentId;

    IF (@TaskId IS NULL) RETURN;

    SELECT @TaskTitle = t.Title,
           @CompId    = ISNULL(w.CompId, p.CompId),
           @BranchId  = ISNULL(w.BranchId, p.BranchId),
           @WsType    = w.Type
      FROM dbo.tblTasks t
      LEFT JOIN dbo.tblWorkspaces w ON w.Id = t.WorkspaceId
      LEFT JOIN dbo.tblProjects   p ON p.Id = t.ProjectId
     WHERE t.Id = @TaskId;

    IF (@WsType = 'personal') RETURN;

    SELECT @ActorName = FullName FROM dbo.tblUser WHERE Id = @ActorUserId;

    DECLARE @NotifBody NVARCHAR(1000) =
        ISNULL(@ActorName, 'Someone') + ' commented on: ' + ISNULL(@TaskTitle, '');

    DECLARE @Recipients TABLE (UserId INT PRIMARY KEY, IsReply BIT);

    INSERT INTO @Recipients (UserId, IsReply)
    SELECT DISTINCT UserId, 0 FROM (
        SELECT CreatedByUserId AS UserId FROM dbo.tblTasks WHERE Id = @TaskId
        UNION
        SELECT AssignedToUserId FROM dbo.tblTasks WHERE Id = @TaskId
    ) s
    WHERE UserId IS NOT NULL AND UserId <> @ActorUserId;

    IF (@Parent IS NOT NULL AND @Parent > 0)
    BEGIN
        DECLARE @ParentAuthor INT;
        SELECT @ParentAuthor = UserId FROM dbo.tblTaskComments WHERE Id = @Parent;
        IF (@ParentAuthor IS NOT NULL AND @ParentAuthor <> @ActorUserId)
        BEGIN
            IF EXISTS (SELECT 1 FROM @Recipients WHERE UserId = @ParentAuthor)
                UPDATE @Recipients SET IsReply = 1 WHERE UserId = @ParentAuthor;
            ELSE
                INSERT INTO @Recipients (UserId, IsReply) VALUES (@ParentAuthor, 1);
        END
    END

    DECLARE @UserId INT, @IsReply BIT;
    DECLARE @NotifType VARCHAR(40), @NotifTitle VARCHAR(200);
    DECLARE cur CURSOR FAST_FORWARD LOCAL FOR
        SELECT UserId, IsReply FROM @Recipients;
    OPEN cur;
    FETCH NEXT FROM cur INTO @UserId, @IsReply;
    WHILE (@@FETCH_STATUS = 0)
    BEGIN
        SET @NotifType  = CASE WHEN @IsReply = 1 THEN 'reply'     ELSE 'comment_added' END;
        SET @NotifTitle = CASE WHEN @IsReply = 1 THEN 'New reply' ELSE 'New comment'   END;

        EXEC dbo.sp_CreateNotification
            @UserId      = @UserId,
            @Type        = @NotifType,
            @EntityType  = 'comment',
            @EntityId    = @CommentId,
            @ActorUserId = @ActorUserId,
            @Title       = @NotifTitle,
            @Body        = @NotifBody,
            @CompId      = @CompId,
            @BranchId    = @BranchId,
            @SkipSelf    = 1;
        FETCH NEXT FROM cur INTO @UserId, @IsReply;
    END
    CLOSE cur; DEALLOCATE cur;
END
GO

-- ============================================================
-- 3) Sanity
-- ============================================================
PRINT '----- migration 018b sanity -----';
SELECT 'sp_NotifyTaskAssigned' AS chk,
       CASE WHEN OBJECT_ID('dbo.sp_NotifyTaskAssigned','P') IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
UNION ALL SELECT 'sp_NotifyCommentAdded',
       CASE WHEN OBJECT_ID('dbo.sp_NotifyCommentAdded','P') IS NOT NULL THEN 'OK' ELSE 'MISSING' END;
GO
