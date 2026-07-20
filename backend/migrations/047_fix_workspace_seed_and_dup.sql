-- 047_fix_workspace_seed_and_dup.sql
-- ============================================================================
-- 1. Fix sp_SeedDefaultWorkspace: an ARCHIVED personal workspace still exists.
--    The login seeder checked `IsArchived = 0`, so a user whose personal
--    workspace was archived got a brand-new empty twin seeded on next login
--    (exactly what happened to Raaj: 10007 archived -> login 19-Jul seeded
--    10008 -> unarchive 10007 -> two "Raaj's Tasks").
-- 2. Remove the empty duplicate (10008) that the bug created.
-- ============================================================================
USE [eCRM+];
GO

CREATE OR ALTER PROCEDURE dbo.sp_SeedDefaultWorkspace
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

    -- Archived counts as existing: seeding must never create a sibling for a
    -- workspace the user merely hid. (No IsArchived filter — that was the bug.)
    SELECT TOP 1 @WorkspaceId = Id FROM dbo.tblWorkspaces
     WHERE Type = 'personal' AND OwnerUserId = @UserId
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

-- ---------------------------------------------------------------------------
-- Cleanup: delete the empty duplicate (10008). Guarded — refuses if any tasks
-- somehow landed in it since.
-- ---------------------------------------------------------------------------
IF EXISTS (SELECT 1 FROM dbo.tblTasks WHERE WorkspaceId = 10008)
    PRINT 'ABORT: workspace 10008 has tasks — do not delete blindly.';
ELSE
BEGIN
    DELETE FROM dbo.tblKanbanColumns    WHERE WorkspaceId = 10008;
    DELETE FROM dbo.tblWorkspaceMembers WHERE WorkspaceId = 10008;
    DELETE FROM dbo.tblWorkspaces       WHERE Id = 10008;
    PRINT 'Duplicate workspace 10008 removed.';
END
GO

-- verify after apply
-- expect exactly ONE "Raaj's Tasks" (10007, 7 tasks) and no 10008
SELECT Id, Name, Type, IsArchived,
       (SELECT COUNT(*) FROM dbo.tblTasks t WHERE t.WorkspaceId = w.Id) AS Tasks
  FROM dbo.tblWorkspaces w WHERE OwnerUserId = 3;
