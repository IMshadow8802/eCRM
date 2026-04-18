-- ============================================================
-- Migration 007 — Workstream D Phase 2
--
-- Repoints sp_FetchTaskActivity at tblActivityLog so the
-- per-task activity feed shows the same rows the new central
-- log records (controller-side logActivity calls).
--
-- Output columns are kept backward-compatible with the
-- existing UI (Id, TaskId, UserId, Action, OldValue, NewValue,
-- Description, CreatedDate, UserName).
--
-- The legacy tblTaskActivity table is left in place but is
-- no longer the source of truth for fetches. SP-side INSERTs
-- in sp_SaveTask / sp_SaveTaskComment continue writing to it
-- (harmless duplicate, will be removed in a follow-up).
-- ============================================================

USE [eCRM+]
GO

ALTER PROC sp_FetchTaskActivity
    @Id BIGINT,
    @TaskId BIGINT,
    @UserId INT,
    @CompId BIGINT,
    @BranchId BIGINT,
    @PageNumber INT = 1,
    @PageSize INT = 50
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);
    DECLARE @TotalRecords INT;
    DECLARE @TotalPages INT;
    DECLARE @Offset INT;

    IF (@Id = 0)
    BEGIN
        SET @Offset = (@PageNumber - 1) * @PageSize;

        SELECT @TotalRecords = COUNT(*)
        FROM tblActivityLog al
        WHERE al.EntityType IN ('Task', 'TaskComment', 'TaskChecklist', 'TimeEntry')
          AND (@TaskId IS NULL OR (al.EntityType = 'Task' AND al.EntityId = @TaskId))
          AND (@UserId IS NULL OR al.UserId = @UserId)
          AND al.CompId = @CompId;

        SET @TotalPages = CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize);

        IF @TotalRecords = 0
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'No activities found';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   NULL AS Id, NULL AS TaskId, NULL AS UserId, NULL AS Action,
                   NULL AS OldValue, NULL AS NewValue, NULL AS Description, NULL AS CreatedDate,
                   NULL AS UserName;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'Activities retrieved successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   al.Id, al.EntityId AS TaskId, al.UserId, al.Action,
                   al.OldValue, al.NewValue, al.Description, al.CreatedDate,
                   u.FullName AS UserName
            FROM tblActivityLog al
            LEFT JOIN tblUser u ON al.UserId = u.Id
            WHERE al.EntityType IN ('Task', 'TaskComment', 'TaskChecklist', 'TimeEntry')
              AND (@TaskId IS NULL OR (al.EntityType = 'Task' AND al.EntityId = @TaskId))
              AND (@UserId IS NULL OR al.UserId = @UserId)
              AND al.CompId = @CompId
            ORDER BY al.CreatedDate DESC
            OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
        END
    END
    ELSE
    BEGIN
        IF EXISTS (SELECT 1 FROM tblActivityLog WHERE Id = @Id)
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'Activity retrieved successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   al.Id, al.EntityId AS TaskId, al.UserId, al.Action,
                   al.OldValue, al.NewValue, al.Description, al.CreatedDate,
                   u.FullName AS UserName
            FROM tblActivityLog al
            LEFT JOIN tblUser u ON al.UserId = u.Id
            WHERE al.Id = @Id;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 404; SET @ResponseMess = 'Activity not found';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   NULL AS Id, NULL AS TaskId, NULL AS UserId, NULL AS Action,
                   NULL AS OldValue, NULL AS NewValue, NULL AS Description, NULL AS CreatedDate,
                   NULL AS UserName;
        END
    END
END
GO

PRINT '✓ sp_FetchTaskActivity now sources from tblActivityLog';
GO
