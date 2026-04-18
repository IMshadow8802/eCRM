-- ============================================================
-- Migration 018 — notification stored procedures
--
-- SPs created:
--   sp_CreateNotification         single insert, actor-skip option
--   sp_FetchNotifications         paginated bell feed w/ unread filter
--   sp_MarkNotificationRead       single row mark-as-read
--   sp_MarkAllNotificationsRead   bulk mark for a user
--   sp_NotifyTaskAssigned         helper: wraps recipient lookup + insert
--   sp_NotifyCommentAdded         helper: fan-out to watchers + assignee + creator
-- ============================================================

USE [eCRM+]
GO

SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- ============================================================
-- 1) sp_CreateNotification
-- ============================================================
IF OBJECT_ID('dbo.sp_CreateNotification', 'P') IS NOT NULL DROP PROCEDURE dbo.sp_CreateNotification;
GO

CREATE PROCEDURE dbo.sp_CreateNotification
    @UserId       INT,
    @Type         VARCHAR(40),
    @EntityType   VARCHAR(20),
    @EntityId     BIGINT,
    @ActorUserId  INT            = NULL,
    @Title        VARCHAR(200),
    @Body         NVARCHAR(1000) = NULL,
    @CompId       BIGINT,
    @BranchId     BIGINT,
    @SkipSelf     BIT            = 1     -- don't notify actor about their own action
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400), @NotificationId BIGINT;

    IF (@SkipSelf = 1 AND @ActorUserId IS NOT NULL AND @ActorUserId = @UserId)
    BEGIN
        SET @ResponseCode = 200;
        SET @ResponseMess = 'Skipped self-notification';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               NULL AS NotificationId; RETURN;
    END

    IF NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Id = @UserId AND IsActive = 1)
    BEGIN
        SET @ResponseCode = 400; SET @ResponseMess = 'Invalid recipient';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               NULL AS NotificationId; RETURN;
    END

    -- Check opt-out (tblNotificationPreferences). Absence = enabled by default.
    IF EXISTS (SELECT 1 FROM dbo.tblNotificationPreferences
                WHERE UserId = @UserId AND Type = @Type
                  AND Channel = 'inapp' AND IsEnabled = 0)
    BEGIN
        SET @ResponseCode = 200; SET @ResponseMess = 'Recipient opted out';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               NULL AS NotificationId; RETURN;
    END

    INSERT INTO dbo.tblNotifications
        (UserId, Type, EntityType, EntityId, ActorUserId, Title, Body, CompId, BranchId)
    VALUES
        (@UserId, @Type, @EntityType, @EntityId, @ActorUserId, @Title, @Body, @CompId, @BranchId);

    SET @NotificationId = SCOPE_IDENTITY();
    SET @ResponseCode = 201;
    SET @ResponseMess = 'Notification created';

    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
           @NotificationId AS NotificationId, @UserId AS UserId, @Type AS Type;
END
GO

-- ============================================================
-- 2) sp_FetchNotifications
-- ============================================================
IF OBJECT_ID('dbo.sp_FetchNotifications', 'P') IS NOT NULL DROP PROCEDURE dbo.sp_FetchNotifications;
GO

CREATE PROCEDURE dbo.sp_FetchNotifications
    @UserId         INT,
    @UnreadOnly     BIT           = 0,
    @PageNumber     INT           = 1,
    @PageSize       INT           = 25,
    @SearchTerm     NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @TotalRecords INT, @TotalPages INT, @Offset INT, @UnreadCount INT;

    SET @Offset = (@PageNumber - 1) * @PageSize;

    SELECT @TotalRecords = COUNT(*)
      FROM dbo.tblNotifications n
     WHERE n.UserId = @UserId
       AND (@UnreadOnly = 0 OR n.IsRead = 0)
       AND (@SearchTerm IS NULL
            OR n.Title LIKE '%' + @SearchTerm + '%'
            OR n.Body  LIKE '%' + @SearchTerm + '%');

    SELECT @UnreadCount = COUNT(*)
      FROM dbo.tblNotifications
     WHERE UserId = @UserId AND IsRead = 0;

    SET @TotalPages = CASE WHEN @PageSize > 0
                           THEN CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize) ELSE 0 END;

    IF (@TotalRecords = 0)
    BEGIN
        SELECT 200 AS ResponseCode, 'No notifications' AS ResponseMess,
               @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
               @PageNumber AS CurrentPage, @PageSize AS PageSize,
               @UnreadCount AS UnreadCount,
               NULL AS Id, NULL AS UserId, NULL AS Type, NULL AS EntityType,
               NULL AS EntityId, NULL AS ActorUserId, NULL AS ActorName,
               NULL AS Title, NULL AS Body,
               NULL AS IsRead, NULL AS ReadAt, NULL AS CreatedDate;
        RETURN;
    END

    SELECT 200 AS ResponseCode, 'Notifications retrieved' AS ResponseMess,
           @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
           @PageNumber AS CurrentPage, @PageSize AS PageSize,
           @UnreadCount AS UnreadCount,
           n.Id, n.UserId, n.Type, n.EntityType, n.EntityId,
           n.ActorUserId, u.FullName AS ActorName,
           n.Title, n.Body, n.IsRead, n.ReadAt, n.CreatedDate
      FROM dbo.tblNotifications n
      LEFT JOIN dbo.tblUser u ON u.Id = n.ActorUserId
     WHERE n.UserId = @UserId
       AND (@UnreadOnly = 0 OR n.IsRead = 0)
       AND (@SearchTerm IS NULL
            OR n.Title LIKE '%' + @SearchTerm + '%'
            OR n.Body  LIKE '%' + @SearchTerm + '%')
     ORDER BY n.CreatedDate DESC, n.Id DESC
     OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
END
GO

-- ============================================================
-- 3) sp_MarkNotificationRead
-- ============================================================
IF OBJECT_ID('dbo.sp_MarkNotificationRead', 'P') IS NOT NULL DROP PROCEDURE dbo.sp_MarkNotificationRead;
GO

CREATE PROCEDURE dbo.sp_MarkNotificationRead
    @Id     BIGINT,
    @UserId INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);

    IF NOT EXISTS (SELECT 1 FROM dbo.tblNotifications WHERE Id = @Id AND UserId = @UserId)
    BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Notification not found';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    UPDATE dbo.tblNotifications
       SET IsRead = 1, ReadAt = GETDATE()
     WHERE Id = @Id AND UserId = @UserId AND IsRead = 0;

    SET @ResponseCode = 200; SET @ResponseMess = 'Marked as read';
    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, @Id AS NotificationId;
END
GO

-- ============================================================
-- 4) sp_MarkAllNotificationsRead
-- ============================================================
IF OBJECT_ID('dbo.sp_MarkAllNotificationsRead', 'P') IS NOT NULL DROP PROCEDURE dbo.sp_MarkAllNotificationsRead;
GO

CREATE PROCEDURE dbo.sp_MarkAllNotificationsRead
    @UserId INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Count INT;

    UPDATE dbo.tblNotifications
       SET IsRead = 1, ReadAt = GETDATE()
     WHERE UserId = @UserId AND IsRead = 0;

    SET @Count = @@ROWCOUNT;

    SELECT 200 AS ResponseCode,
           'Marked ' + CAST(@Count AS VARCHAR) + ' as read' AS ResponseMess,
           @Count AS UpdatedCount;
END
GO

-- ============================================================
-- 5) sp_NotifyTaskAssigned — helper for assignment notifications
-- Call from taskController when assignee changes.
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

    -- Skip notifications in personal workspaces (you assigning yourself)
    IF (@WsType = 'personal' AND @AssigneeId = @OwnerId) RETURN;

    SELECT @ActorName = FullName FROM dbo.tblUser WHERE Id = @ActorUserId;

    EXEC dbo.sp_CreateNotification
        @UserId       = @AssigneeId,
        @Type         = 'task_assigned',
        @EntityType   = 'task',
        @EntityId     = @TaskId,
        @ActorUserId  = @ActorUserId,
        @Title        = 'New task assigned',
        @Body         = ISNULL(@ActorName,'Someone') + ' assigned you: ' + ISNULL(@Title,''),
        @CompId       = @CompId,
        @BranchId     = @BranchId,
        @SkipSelf     = 1;
END
GO

-- ============================================================
-- 6) sp_NotifyCommentAdded — helper: fan out to creator + assignee + watchers
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

    -- Skip personal boards (no one else to notify)
    IF (@WsType = 'personal') RETURN;

    SELECT @ActorName = FullName FROM dbo.tblUser WHERE Id = @ActorUserId;

    -- Build recipient set: creator + assignee + parent comment author (for replies)
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
    DECLARE cur CURSOR FAST_FORWARD LOCAL FOR
        SELECT UserId, IsReply FROM @Recipients;
    OPEN cur;
    FETCH NEXT FROM cur INTO @UserId, @IsReply;
    WHILE (@@FETCH_STATUS = 0)
    BEGIN
        EXEC dbo.sp_CreateNotification
            @UserId      = @UserId,
            @Type        = CASE WHEN @IsReply = 1 THEN 'reply' ELSE 'comment_added' END,
            @EntityType  = 'comment',
            @EntityId    = @CommentId,
            @ActorUserId = @ActorUserId,
            @Title       = CASE WHEN @IsReply = 1 THEN 'New reply' ELSE 'New comment' END,
            @Body        = ISNULL(@ActorName,'Someone') + ' commented on: ' + ISNULL(@TaskTitle,''),
            @CompId      = @CompId,
            @BranchId    = @BranchId,
            @SkipSelf    = 1;
        FETCH NEXT FROM cur INTO @UserId, @IsReply;
    END
    CLOSE cur; DEALLOCATE cur;
END
GO

-- ============================================================
-- 7) Sanity checks
-- ============================================================
PRINT '----- migration 018 sanity -----';

SELECT 'sp_CreateNotification'        AS chk, CASE WHEN OBJECT_ID('dbo.sp_CreateNotification','P')        IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
UNION ALL SELECT 'sp_FetchNotifications',       CASE WHEN OBJECT_ID('dbo.sp_FetchNotifications','P')       IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'sp_MarkNotificationRead',     CASE WHEN OBJECT_ID('dbo.sp_MarkNotificationRead','P')     IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'sp_MarkAllNotificationsRead', CASE WHEN OBJECT_ID('dbo.sp_MarkAllNotificationsRead','P') IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'sp_NotifyTaskAssigned',       CASE WHEN OBJECT_ID('dbo.sp_NotifyTaskAssigned','P')       IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'sp_NotifyCommentAdded',       CASE WHEN OBJECT_ID('dbo.sp_NotifyCommentAdded','P')       IS NOT NULL THEN 'OK' ELSE 'MISSING' END;
GO
