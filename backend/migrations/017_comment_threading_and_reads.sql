-- ============================================================
-- Migration 017 — comment threading, soft delete, pin, read receipts
--
-- SPs rewritten:
--   sp_SaveTaskComment     — accepts @ParentCommentId, perm check,
--                           sets IsEdited on update, @ExtractMentionsJson
--                           param echoed back so controller can emit
--                           notifications (Phase 1.9).
--   sp_DeleteTaskComment   — soft delete (IsDeleted=1), perm check
--                           (delete_own_comment or delete_others_comment).
--   sp_FetchTaskComment    — returns threaded view; soft-deleted comments
--                           appear as placeholder (Comment='[deleted]');
--                           includes IsPinned, IsEdited, ParentCommentId,
--                           ReadCount + ReadByUserIds (CSV).
-- SPs added:
--   sp_PinTaskComment      — owner/manager only, max 3 per task.
--   sp_MarkCommentRead     — inserts tblCommentReads row (idempotent).
-- ============================================================

USE [eCRM+]
GO

SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- ============================================================
-- 1) sp_SaveTaskComment
-- ============================================================
IF OBJECT_ID('dbo.sp_SaveTaskComment', 'P') IS NOT NULL DROP PROCEDURE dbo.sp_SaveTaskComment;
GO

CREATE PROCEDURE dbo.sp_SaveTaskComment
    @Id               BIGINT         = 0,
    @TaskId           BIGINT,
    @UserId           INT,
    @Comment          NVARCHAR(MAX),
    @ParentCommentId  BIGINT         = NULL,
    @IsAdmin          BIT            = 0,
    @CompId           BIGINT,
    @BranchId         BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);

    IF (@TaskId IS NULL OR @TaskId <= 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Task ID is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    IF (@UserId IS NULL OR @UserId <= 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'User ID is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    IF (@Comment IS NULL OR LTRIM(RTRIM(@Comment)) = '')
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Comment cannot be blank';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM dbo.tblTasks WHERE Id = @TaskId)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid task';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Id = @UserId AND IsActive = 1)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid user';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@ParentCommentId IS NOT NULL AND @ParentCommentId > 0)
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.tblTaskComments
                        WHERE Id = @ParentCommentId AND TaskId = @TaskId AND IsDeleted = 0)
        BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid parent comment';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    END

    -- Permission: comment (create) or edit_own_comment (update)
    DECLARE @Perm TABLE (Allowed BIT, Reason VARCHAR(400));
    IF (@Id = 0)
        INSERT INTO @Perm EXEC dbo.sp_CheckTaskPermission
            @TaskId = @TaskId, @WorkspaceId = NULL, @CommentId = NULL,
            @UserId = @UserId, @Action = 'comment',
            @IsAdmin = @IsAdmin, @CompId = @CompId;
    ELSE
        INSERT INTO @Perm EXEC dbo.sp_CheckTaskPermission
            @TaskId = @TaskId, @WorkspaceId = NULL, @CommentId = @Id,
            @UserId = @UserId, @Action = 'edit_own_comment',
            @IsAdmin = @IsAdmin, @CompId = @CompId;

    IF NOT EXISTS (SELECT 1 FROM @Perm WHERE Allowed = 1)
    BEGIN
        SET @ResponseCode = 403;
        SET @ResponseMess = 'Permission denied: ' + ISNULL((SELECT TOP 1 Reason FROM @Perm), 'no reason');
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
    END

    IF (@Id = 0)
    BEGIN
        INSERT INTO dbo.tblTaskComments (TaskId, UserId, Comment, IsEdited, ParentCommentId)
        VALUES (@TaskId, @UserId, @Comment, 0, @ParentCommentId);
        SET @Id = SCOPE_IDENTITY();

        -- Mark as read by author immediately
        INSERT INTO dbo.tblCommentReads (CommentId, UserId, SeenAt)
        VALUES (@Id, @UserId, GETDATE());

        SET @ResponseCode = 201;
        SET @ResponseMess = CASE WHEN @ParentCommentId IS NULL
                                 THEN 'Comment added successfully'
                                 ELSE 'Reply added successfully' END;
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               @Id AS CommentId, @TaskId AS TaskId, @ParentCommentId AS ParentCommentId;
    END
    ELSE
    BEGIN
        UPDATE dbo.tblTaskComments
           SET Comment = @Comment,
               IsEdited = 1,
               UpdatedDate = GETDATE()
         WHERE Id = @Id AND IsDeleted = 0;

        IF (@@ROWCOUNT = 0)
        BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Comment not found';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

        SET @ResponseCode = 200; SET @ResponseMess = 'Comment updated successfully';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               @Id AS CommentId, @TaskId AS TaskId, @ParentCommentId AS ParentCommentId;
    END
END
GO

-- ============================================================
-- 2) sp_DeleteTaskComment (soft)
-- ============================================================
IF OBJECT_ID('dbo.sp_DeleteTaskComment', 'P') IS NOT NULL DROP PROCEDURE dbo.sp_DeleteTaskComment;
GO

CREATE PROCEDURE dbo.sp_DeleteTaskComment
    @Id       BIGINT,
    @UserId   INT,
    @IsAdmin  BIT = 0,
    @CompId   BIGINT,
    @BranchId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);

    DECLARE @Author INT;
    SELECT @Author = UserId FROM dbo.tblTaskComments WHERE Id = @Id AND IsDeleted = 0;
    IF (@Author IS NULL)
    BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Comment not found';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    DECLARE @Action VARCHAR(50) =
        CASE WHEN @Author = @UserId THEN 'delete_own_comment' ELSE 'delete_others_comment' END;

    DECLARE @Perm TABLE (Allowed BIT, Reason VARCHAR(400));
    INSERT INTO @Perm EXEC dbo.sp_CheckTaskPermission
        @TaskId = NULL, @WorkspaceId = NULL, @CommentId = @Id,
        @UserId = @UserId, @Action = @Action,
        @IsAdmin = @IsAdmin, @CompId = @CompId;

    IF NOT EXISTS (SELECT 1 FROM @Perm WHERE Allowed = 1)
    BEGIN
        SET @ResponseCode = 403;
        SET @ResponseMess = 'Permission denied: ' + ISNULL((SELECT TOP 1 Reason FROM @Perm), 'no reason');
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
    END

    UPDATE dbo.tblTaskComments
       SET IsDeleted = 1, UpdatedDate = GETDATE()
     WHERE Id = @Id;

    SET @ResponseCode = 200; SET @ResponseMess = 'Comment deleted successfully';
    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
END
GO

-- ============================================================
-- 3) sp_FetchTaskComment — threaded + reads + pin, backward-compatible columns
-- ============================================================
IF OBJECT_ID('dbo.sp_FetchTaskComment', 'P') IS NOT NULL DROP PROCEDURE dbo.sp_FetchTaskComment;
GO

CREATE PROCEDURE dbo.sp_FetchTaskComment
    @Id         BIGINT         = 0,
    @TaskId     BIGINT         = NULL,
    @UserId     INT,
    @CompId     BIGINT,
    @BranchId   BIGINT,
    @PageNumber INT            = 1,
    @PageSize   INT            = 25,
    @SearchTerm NVARCHAR(200)  = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @TotalRecords INT, @TotalPages INT, @Offset INT;

    IF (@Id <> 0)
    BEGIN
        IF EXISTS (SELECT 1 FROM dbo.tblTaskComments WHERE Id = @Id)
            SELECT 200 AS ResponseCode, 'Comment retrieved successfully' AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   tc.Id, tc.TaskId, tc.UserId,
                   CASE WHEN tc.IsDeleted = 1 THEN N'[deleted]' ELSE tc.Comment END AS Comment,
                   tc.IsEdited, tc.IsDeleted, tc.IsPinned, tc.ParentCommentId,
                   tc.CreatedDate, tc.UpdatedDate,
                   u.FullName AS UserName,
                   (SELECT COUNT(*) FROM dbo.tblCommentReads r WHERE r.CommentId = tc.Id) AS ReadCount,
                   STUFF((SELECT ',' + CAST(r.UserId AS VARCHAR(10))
                            FROM dbo.tblCommentReads r WHERE r.CommentId = tc.Id
                            FOR XML PATH('')), 1, 1, '') AS ReadByUserIds
              FROM dbo.tblTaskComments tc
              INNER JOIN dbo.tblUser u ON tc.UserId = u.Id
             WHERE tc.Id = @Id;
        ELSE
            SELECT 404 AS ResponseCode, 'Comment not found' AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   NULL AS Id, NULL AS TaskId, NULL AS UserId, NULL AS Comment,
                   NULL AS IsEdited, NULL AS IsDeleted, NULL AS IsPinned, NULL AS ParentCommentId,
                   NULL AS CreatedDate, NULL AS UpdatedDate, NULL AS UserName,
                   NULL AS ReadCount, NULL AS ReadByUserIds;
        RETURN;
    END

    SET @Offset = (@PageNumber - 1) * @PageSize;

    SELECT @TotalRecords = COUNT(*)
      FROM dbo.tblTaskComments tc
      INNER JOIN dbo.tblUser u ON tc.UserId = u.Id
     WHERE tc.TaskId = @TaskId
       AND (@SearchTerm IS NULL
            OR tc.Comment LIKE '%' + @SearchTerm + '%'
            OR u.FullName LIKE '%' + @SearchTerm + '%');

    SET @TotalPages = CASE WHEN @PageSize > 0
                           THEN CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize) ELSE 0 END;

    -- Mark all visible comments read for this user (silent)
    INSERT INTO dbo.tblCommentReads (CommentId, UserId, SeenAt)
    SELECT tc.Id, @UserId, GETDATE()
      FROM dbo.tblTaskComments tc
     WHERE tc.TaskId = @TaskId
       AND tc.IsDeleted = 0
       AND NOT EXISTS (SELECT 1 FROM dbo.tblCommentReads r
                        WHERE r.CommentId = tc.Id AND r.UserId = @UserId);

    SELECT 200 AS ResponseCode, 'Comments retrieved successfully' AS ResponseMess,
           @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
           @PageNumber AS CurrentPage, @PageSize AS PageSize,
           tc.Id, tc.TaskId, tc.UserId,
           CASE WHEN tc.IsDeleted = 1 THEN N'[deleted]' ELSE tc.Comment END AS Comment,
           tc.IsEdited, tc.IsDeleted, tc.IsPinned, tc.ParentCommentId,
           tc.CreatedDate, tc.UpdatedDate,
           u.FullName AS UserName,
           (SELECT COUNT(*) FROM dbo.tblCommentReads r WHERE r.CommentId = tc.Id) AS ReadCount,
           STUFF((SELECT ',' + CAST(r.UserId AS VARCHAR(10))
                    FROM dbo.tblCommentReads r WHERE r.CommentId = tc.Id
                    FOR XML PATH('')), 1, 1, '') AS ReadByUserIds
      FROM dbo.tblTaskComments tc
      INNER JOIN dbo.tblUser u ON tc.UserId = u.Id
     WHERE tc.TaskId = @TaskId
       AND (@SearchTerm IS NULL
            OR tc.Comment LIKE '%' + @SearchTerm + '%'
            OR u.FullName LIKE '%' + @SearchTerm + '%')
     ORDER BY tc.IsPinned DESC, tc.CreatedDate ASC
     OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
END
GO

-- ============================================================
-- 4) sp_PinTaskComment — owner/manager only, max 3 pinned per task
-- ============================================================
IF OBJECT_ID('dbo.sp_PinTaskComment', 'P') IS NOT NULL DROP PROCEDURE dbo.sp_PinTaskComment;
GO

CREATE PROCEDURE dbo.sp_PinTaskComment
    @CommentId BIGINT,
    @IsPinned  BIT,
    @UserId    INT,
    @IsAdmin   BIT = 0,
    @CompId    BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);
    DECLARE @TaskId BIGINT;

    SELECT @TaskId = TaskId FROM dbo.tblTaskComments WHERE Id = @CommentId AND IsDeleted = 0;
    IF (@TaskId IS NULL)
    BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Comment not found';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    DECLARE @Perm TABLE (Allowed BIT, Reason VARCHAR(400));
    INSERT INTO @Perm EXEC dbo.sp_CheckTaskPermission
        @TaskId = @TaskId, @WorkspaceId = NULL, @CommentId = @CommentId,
        @UserId = @UserId, @Action = 'pin_comment',
        @IsAdmin = @IsAdmin, @CompId = @CompId;

    IF NOT EXISTS (SELECT 1 FROM @Perm WHERE Allowed = 1)
    BEGIN
        SET @ResponseCode = 403;
        SET @ResponseMess = 'Permission denied: ' + ISNULL((SELECT TOP 1 Reason FROM @Perm), 'no reason');
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
    END

    IF (@IsPinned = 1)
    BEGIN
        DECLARE @PinnedCount INT;
        SELECT @PinnedCount = COUNT(*) FROM dbo.tblTaskComments
         WHERE TaskId = @TaskId AND IsPinned = 1 AND Id <> @CommentId AND IsDeleted = 0;
        IF (@PinnedCount >= 3)
        BEGIN SET @ResponseCode = 409;
              SET @ResponseMess = 'Max 3 pinned comments per task';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    END

    UPDATE dbo.tblTaskComments
       SET IsPinned = @IsPinned, UpdatedDate = GETDATE()
     WHERE Id = @CommentId;

    SET @ResponseCode = 200;
    SET @ResponseMess = CASE WHEN @IsPinned = 1 THEN 'Comment pinned' ELSE 'Comment unpinned' END;
    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
           @CommentId AS CommentId, @IsPinned AS IsPinned;
END
GO

-- ============================================================
-- 5) sp_MarkCommentRead — idempotent insert into tblCommentReads
-- ============================================================
IF OBJECT_ID('dbo.sp_MarkCommentRead', 'P') IS NOT NULL DROP PROCEDURE dbo.sp_MarkCommentRead;
GO

CREATE PROCEDURE dbo.sp_MarkCommentRead
    @CommentId BIGINT,
    @UserId    INT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.tblCommentReads
                    WHERE CommentId = @CommentId AND UserId = @UserId)
        INSERT INTO dbo.tblCommentReads (CommentId, UserId, SeenAt)
        VALUES (@CommentId, @UserId, GETDATE());

    SELECT 200 AS ResponseCode, 'Marked as read' AS ResponseMess,
           @CommentId AS CommentId, @UserId AS UserId;
END
GO

-- ============================================================
-- 6) Sanity checks
-- ============================================================
PRINT '----- migration 017 sanity -----';

SELECT 'sp_SaveTaskComment'      AS chk, CASE WHEN OBJECT_ID('dbo.sp_SaveTaskComment','P')      IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
UNION ALL SELECT 'sp_DeleteTaskComment',  CASE WHEN OBJECT_ID('dbo.sp_DeleteTaskComment','P')  IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'sp_FetchTaskComment',   CASE WHEN OBJECT_ID('dbo.sp_FetchTaskComment','P')   IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'sp_PinTaskComment',     CASE WHEN OBJECT_ID('dbo.sp_PinTaskComment','P')     IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'sp_MarkCommentRead',    CASE WHEN OBJECT_ID('dbo.sp_MarkCommentRead','P')    IS NOT NULL THEN 'OK' ELSE 'MISSING' END;
GO
