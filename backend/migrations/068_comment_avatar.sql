-- 068_comment_avatar.sql
--
-- Fix: every task comment shows initials instead of the author's avatar.
--
-- sp_FetchTaskComment already INNER JOINs tblUser and already takes
-- u.FullName from it — it just never selects u.Avatar. So `Avatar` is absent
-- from the payload, arrives as null on both clients, and the avatar component
-- correctly falls back to initials. Nothing is wrong in the apps: web and
-- mobile both ask for the field, and the column simply is not there.
--
-- Everywhere an avatar DOES render, the procedure behind it selects the
-- column — sp_FetchTask (via AssigneesJson), sp_FetchWorkspaceMembers,
-- /api/users/directory. Comments were the one place the join was present and
-- the column was left off.
--
-- tblUser.Avatar holds a preset string, not a URL — "icon:ghost|violet",
-- "emoji:🚀", "color:violet" — parsed by web/src/utils/avatarPresets.js and
-- mobile/src/ui/avatarPresets.ts. Both already handle it; no client change is
-- needed with this script.
--
-- Two branches to patch: the @Id <> 0 single-comment fetch (including its
-- 404 shape, which must keep the same column list) and the paged list.
--
-- No schema change.

ALTER PROCEDURE dbo.sp_FetchTaskComment
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
                   u.Avatar,
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
                   NULL AS Avatar,
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
           u.Avatar,
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

-- ============================ verify after apply ============================
-- 1. The column is now selected in both branches:
--
--    SELECT CASE WHEN definition LIKE '%u.Avatar%' THEN 'ok' ELSE 'MISSING' END
--      FROM sys.sql_modules WHERE object_id = OBJECT_ID('sp_FetchTaskComment');
--
-- 2. It comes back populated. Pick a task whose commenter has an avatar set:
--
--    EXEC sp_FetchTaskComment @Id = 0, @TaskId = <task id>, @UserId = <you>,
--         @CompId = <your CompId>, @BranchId = <your BranchId>;
--    -- expect an Avatar column, e.g. 'icon:ghost|violet' or NULL for users
--    -- who never picked one (those correctly keep showing initials)
--
-- 3. In the apps: open a task's Comments tab. Authors who set an avatar on
--    their profile now show it instead of their initials, on web and mobile
--    both. No client change ships with this — both already read the field.
