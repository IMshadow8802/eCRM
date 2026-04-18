-- ============================================================
-- Migration 014 — Workspace CRUD stored procedures
--
-- SPs created:
--   sp_SaveWorkspace          create/update; on create inserts owner membership
--   sp_FetchWorkspaces        list workspaces user can see (personal = owner only)
--   sp_AddWorkspaceMember     add member with role; enforces manage_members
--   sp_RemoveWorkspaceMember  soft-deactivate membership; never drops owner
--   sp_ArchiveWorkspace       owner archives; admin unarchives
--
-- Permission model follows approved plan — personal workspaces are
-- invisible to everyone except the owner (admin included).
-- ============================================================

USE [eCRM+]
GO

SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- ============================================================
-- 1) sp_SaveWorkspace
-- ============================================================
IF OBJECT_ID('dbo.sp_SaveWorkspace', 'P') IS NOT NULL DROP PROCEDURE dbo.sp_SaveWorkspace;
GO

CREATE PROCEDURE dbo.sp_SaveWorkspace
    @Id            BIGINT       = 0,
    @Name          VARCHAR(200),
    @Type          VARCHAR(20),
    @OwnerUserId   INT,
    @TeamId        INT          = NULL,
    @ProjectId     INT          = NULL,
    @Color         VARCHAR(20)  = NULL,
    @Icon          VARCHAR(40)  = NULL,
    @CompId        BIGINT,
    @BranchId      BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);

    IF (@Name IS NULL OR LTRIM(RTRIM(@Name)) = '')
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Workspace name is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@Type NOT IN ('personal','shared','project'))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid workspace type';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Id = @OwnerUserId AND IsActive = 1)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid owner user';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@Type = 'project' AND (@ProjectId IS NULL OR @ProjectId <= 0))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Project workspace requires a project ID';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@ProjectId IS NOT NULL AND @ProjectId > 0
        AND NOT EXISTS (SELECT 1 FROM dbo.tblProjects WHERE Id = @ProjectId))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid project reference';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@TeamId IS NOT NULL AND @TeamId > 0
        AND NOT EXISTS (SELECT 1 FROM dbo.tblTeams WHERE Id = @TeamId AND IsActive = 1))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid team reference';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;

        IF (@Id = 0)
        BEGIN
            -- Enforce single personal workspace per user
            IF (@Type = 'personal'
                AND EXISTS (SELECT 1 FROM dbo.tblWorkspaces
                             WHERE OwnerUserId = @OwnerUserId AND Type = 'personal' AND IsArchived = 0))
            BEGIN
                ROLLBACK TRANSACTION;
                SET @ResponseCode = 409;
                SET @ResponseMess = 'Personal workspace already exists for this user';
                SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
            END

            INSERT INTO dbo.tblWorkspaces
                (Name, Type, OwnerUserId, TeamId, ProjectId, IsArchived,
                 Color, Icon, CompId, BranchId)
            VALUES
                (@Name, @Type, @OwnerUserId, @TeamId, @ProjectId, 0,
                 @Color, @Icon, @CompId, @BranchId);

            SET @Id = SCOPE_IDENTITY();

            INSERT INTO dbo.tblWorkspaceMembers
                (WorkspaceId, UserId, Role, AddedByUserId, IsActive)
            VALUES
                (@Id, @OwnerUserId, 'owner', @OwnerUserId, 1);

            COMMIT TRANSACTION;
            SET @ResponseCode = 201;
            SET @ResponseMess = 'Workspace created';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @Id AS WorkspaceId;
        END
        ELSE
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM dbo.tblWorkspaces WHERE Id = @Id AND CompId = @CompId)
            BEGIN
                ROLLBACK TRANSACTION;
                SET @ResponseCode = 404;
                SET @ResponseMess = 'Workspace not found';
                SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
            END

            UPDATE dbo.tblWorkspaces
               SET Name = @Name,
                   TeamId = @TeamId,
                   ProjectId = @ProjectId,
                   Color = @Color,
                   Icon = @Icon,
                   UpdatedDate = GETDATE()
             WHERE Id = @Id;
            -- Type and OwnerUserId are intentionally immutable post-creation.

            COMMIT TRANSACTION;
            SET @ResponseCode = 200;
            SET @ResponseMess = 'Workspace updated';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @Id AS WorkspaceId;
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

-- ============================================================
-- 2) sp_FetchWorkspaces
-- ============================================================
IF OBJECT_ID('dbo.sp_FetchWorkspaces', 'P') IS NOT NULL DROP PROCEDURE dbo.sp_FetchWorkspaces;
GO

CREATE PROCEDURE dbo.sp_FetchWorkspaces
    @Id                      BIGINT = 0,
    @UserId                  INT,
    @CompId                  BIGINT,
    @BranchId                BIGINT,
    @IsAdmin                 BIT    = 0,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @Type                    VARCHAR(20) = NULL,
    @IncludeArchived         BIT    = 0,
    @PageNumber              INT    = 1,
    @PageSize                INT    = 25,
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
        IF NOT EXISTS (
            SELECT 1 FROM dbo.tblWorkspaces w
            WHERE w.Id = @Id AND w.CompId = @CompId
              AND (
                    (w.Type = 'personal' AND w.OwnerUserId = @UserId)
                 OR (w.Type IN ('shared','project')
                     AND (@IsAdmin = 1
                          OR EXISTS (SELECT 1 FROM dbo.tblWorkspaceMembers m
                                     WHERE m.WorkspaceId = w.Id AND m.UserId = @UserId AND m.IsActive = 1)))
                  )
        )
        BEGIN
            SET @ResponseCode = 404; SET @ResponseMess = 'Workspace not found or access denied';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   NULL AS Id, NULL AS Name, NULL AS Type, NULL AS OwnerUserId,
                   NULL AS TeamId, NULL AS ProjectId, NULL AS IsArchived,
                   NULL AS Color, NULL AS Icon, NULL AS CompId, NULL AS BranchId,
                   NULL AS CreatedDate, NULL AS UpdatedDate,
                   NULL AS MemberCount, NULL AS MyRole;
            RETURN;
        END

        SET @ResponseCode = 200; SET @ResponseMess = 'Workspace retrieved';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
               w.Id, w.Name, w.Type, w.OwnerUserId, w.TeamId, w.ProjectId, w.IsArchived,
               w.Color, w.Icon, w.CompId, w.BranchId, w.CreatedDate, w.UpdatedDate,
               (SELECT COUNT(*) FROM dbo.tblWorkspaceMembers m
                 WHERE m.WorkspaceId = w.Id AND m.IsActive = 1) AS MemberCount,
               (SELECT TOP 1 m.Role FROM dbo.tblWorkspaceMembers m
                 WHERE m.WorkspaceId = w.Id AND m.UserId = @UserId AND m.IsActive = 1) AS MyRole
          FROM dbo.tblWorkspaces w
         WHERE w.Id = @Id;
        RETURN;
    END

    -- List: user sees own personal + shared/project boards where they're a member
    --       admin additionally sees all non-personal in their company
    SET @Offset = (@PageNumber - 1) * @PageSize;

    ;WITH visible AS (
        SELECT w.Id
          FROM dbo.tblWorkspaces w
         WHERE w.CompId = @CompId
           AND (@IncludeArchived = 1 OR w.IsArchived = 0)
           AND (@Type IS NULL OR w.Type = @Type)
           AND (
                 (w.Type = 'personal' AND w.OwnerUserId = @UserId)
              OR (w.Type IN ('shared','project')
                  AND (@IsAdmin = 1
                       OR EXISTS (SELECT 1 FROM dbo.tblWorkspaceMembers m
                                   WHERE m.WorkspaceId = w.Id AND m.UserId = @UserId AND m.IsActive = 1)))
               )
           AND ((@UseScope = 1 AND w.BranchId IN (SELECT BranchId FROM @BranchIds))
                OR (@UseScope = 0 AND (@IsAdmin = 1 OR w.BranchId = @BranchId)))
           AND (@SearchTerm IS NULL OR w.Name LIKE '%' + @SearchTerm + '%')
    )
    SELECT @TotalRecords = COUNT(*) FROM visible;

    SET @TotalPages = CASE WHEN @PageSize > 0 THEN CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize) ELSE 0 END;

    IF (@TotalRecords = 0)
    BEGIN
        SET @ResponseCode = 200; SET @ResponseMess = 'No workspaces found';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
               @PageNumber AS CurrentPage, @PageSize AS PageSize,
               NULL AS Id, NULL AS Name, NULL AS Type, NULL AS OwnerUserId,
               NULL AS TeamId, NULL AS ProjectId, NULL AS IsArchived,
               NULL AS Color, NULL AS Icon, NULL AS CompId, NULL AS BranchId,
               NULL AS CreatedDate, NULL AS UpdatedDate,
               NULL AS MemberCount, NULL AS MyRole;
        RETURN;
    END

    SET @ResponseCode = 200; SET @ResponseMess = 'Workspaces retrieved';
    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
           @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
           @PageNumber AS CurrentPage, @PageSize AS PageSize,
           w.Id, w.Name, w.Type, w.OwnerUserId, w.TeamId, w.ProjectId, w.IsArchived,
           w.Color, w.Icon, w.CompId, w.BranchId, w.CreatedDate, w.UpdatedDate,
           (SELECT COUNT(*) FROM dbo.tblWorkspaceMembers m
             WHERE m.WorkspaceId = w.Id AND m.IsActive = 1) AS MemberCount,
           (SELECT TOP 1 m.Role FROM dbo.tblWorkspaceMembers m
             WHERE m.WorkspaceId = w.Id AND m.UserId = @UserId AND m.IsActive = 1) AS MyRole
      FROM dbo.tblWorkspaces w
     WHERE w.CompId = @CompId
       AND (@IncludeArchived = 1 OR w.IsArchived = 0)
       AND (@Type IS NULL OR w.Type = @Type)
       AND (
             (w.Type = 'personal' AND w.OwnerUserId = @UserId)
          OR (w.Type IN ('shared','project')
              AND (@IsAdmin = 1
                   OR EXISTS (SELECT 1 FROM dbo.tblWorkspaceMembers m
                               WHERE m.WorkspaceId = w.Id AND m.UserId = @UserId AND m.IsActive = 1)))
           )
       AND ((@UseScope = 1 AND w.BranchId IN (SELECT BranchId FROM @BranchIds))
            OR (@UseScope = 0 AND (@IsAdmin = 1 OR w.BranchId = @BranchId)))
       AND (@SearchTerm IS NULL OR w.Name LIKE '%' + @SearchTerm + '%')
     ORDER BY CASE w.Type WHEN 'personal' THEN 0 WHEN 'shared' THEN 1 ELSE 2 END,
              w.UpdatedDate DESC, w.CreatedDate DESC
     OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
END
GO

-- ============================================================
-- 3) sp_AddWorkspaceMember
-- ============================================================
IF OBJECT_ID('dbo.sp_AddWorkspaceMember', 'P') IS NOT NULL DROP PROCEDURE dbo.sp_AddWorkspaceMember;
GO

CREATE PROCEDURE dbo.sp_AddWorkspaceMember
    @WorkspaceId    BIGINT,
    @UserId         INT,          -- user to add
    @Role           VARCHAR(20),
    @ActingUserId   INT,          -- who is adding
    @IsAdmin        BIT = 0,
    @CompId         BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);
    DECLARE @WsType VARCHAR(20), @WsOwner INT, @WsCompId BIGINT, @ActingRole VARCHAR(20);

    IF (@Role NOT IN ('owner','manager','member','viewer'))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid role';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Id = @UserId AND IsActive = 1)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid user';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    SELECT @WsType = Type, @WsOwner = OwnerUserId, @WsCompId = CompId
      FROM dbo.tblWorkspaces WHERE Id = @WorkspaceId;
    IF (@WsType IS NULL)
    BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Workspace not found';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    IF (@WsCompId <> @CompId)
    BEGIN SET @ResponseCode = 403; SET @ResponseMess = 'Cross-company access denied';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- Personal workspaces cannot have additional members
    IF (@WsType = 'personal')
    BEGIN SET @ResponseCode = 403; SET @ResponseMess = 'Personal workspaces cannot have extra members';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- Permission: acting user must be owner, or admin (non-personal enforced above)
    SELECT @ActingRole = Role
      FROM dbo.tblWorkspaceMembers
     WHERE WorkspaceId = @WorkspaceId AND UserId = @ActingUserId AND IsActive = 1;

    IF (@IsAdmin <> 1 AND @ActingRole <> 'owner')
    BEGIN SET @ResponseCode = 403; SET @ResponseMess = 'Only workspace owner (or admin) can add members';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- Cannot add another owner (single-owner model)
    IF (@Role = 'owner')
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Ownership transfer must use a separate flow';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF EXISTS (SELECT 1 FROM dbo.tblWorkspaceMembers
                WHERE WorkspaceId = @WorkspaceId AND UserId = @UserId)
    BEGIN
        UPDATE dbo.tblWorkspaceMembers
           SET Role = @Role, IsActive = 1, AddedByUserId = @ActingUserId, JoinedDate = GETDATE()
         WHERE WorkspaceId = @WorkspaceId AND UserId = @UserId;
        SET @ResponseCode = 200; SET @ResponseMess = 'Member reactivated';
    END
    ELSE
    BEGIN
        INSERT INTO dbo.tblWorkspaceMembers
            (WorkspaceId, UserId, Role, AddedByUserId, IsActive)
        VALUES (@WorkspaceId, @UserId, @Role, @ActingUserId, 1);
        SET @ResponseCode = 201; SET @ResponseMess = 'Member added';
    END

    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
           @WorkspaceId AS WorkspaceId, @UserId AS UserId, @Role AS Role;
END
GO

-- ============================================================
-- 4) sp_RemoveWorkspaceMember (soft)
-- ============================================================
IF OBJECT_ID('dbo.sp_RemoveWorkspaceMember', 'P') IS NOT NULL DROP PROCEDURE dbo.sp_RemoveWorkspaceMember;
GO

CREATE PROCEDURE dbo.sp_RemoveWorkspaceMember
    @WorkspaceId    BIGINT,
    @UserId         INT,
    @ActingUserId   INT,
    @IsAdmin        BIT = 0,
    @CompId         BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);
    DECLARE @WsType VARCHAR(20), @WsOwner INT, @WsCompId BIGINT, @ActingRole VARCHAR(20);

    SELECT @WsType = Type, @WsOwner = OwnerUserId, @WsCompId = CompId
      FROM dbo.tblWorkspaces WHERE Id = @WorkspaceId;
    IF (@WsType IS NULL)
    BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Workspace not found';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    IF (@WsCompId <> @CompId)
    BEGIN SET @ResponseCode = 403; SET @ResponseMess = 'Cross-company access denied';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@UserId = @WsOwner)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Cannot remove owner. Transfer ownership first';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    SELECT @ActingRole = Role
      FROM dbo.tblWorkspaceMembers
     WHERE WorkspaceId = @WorkspaceId AND UserId = @ActingUserId AND IsActive = 1;

    -- Self-leave OR owner/admin remove
    IF (@UserId <> @ActingUserId AND @IsAdmin <> 1 AND @ActingRole <> 'owner')
    BEGIN SET @ResponseCode = 403; SET @ResponseMess = 'Only owner, admin, or self can remove';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM dbo.tblWorkspaceMembers
                    WHERE WorkspaceId = @WorkspaceId AND UserId = @UserId AND IsActive = 1)
    BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Member not found';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    UPDATE dbo.tblWorkspaceMembers
       SET IsActive = 0
     WHERE WorkspaceId = @WorkspaceId AND UserId = @UserId;

    SET @ResponseCode = 200; SET @ResponseMess = 'Member removed';
    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
           @WorkspaceId AS WorkspaceId, @UserId AS UserId;
END
GO

-- ============================================================
-- 5) sp_ArchiveWorkspace
-- ============================================================
IF OBJECT_ID('dbo.sp_ArchiveWorkspace', 'P') IS NOT NULL DROP PROCEDURE dbo.sp_ArchiveWorkspace;
GO

CREATE PROCEDURE dbo.sp_ArchiveWorkspace
    @WorkspaceId    BIGINT,
    @IsArchived     BIT,
    @ActingUserId   INT,
    @IsAdmin        BIT = 0,
    @CompId         BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);
    DECLARE @WsOwner INT, @WsCompId BIGINT;

    SELECT @WsOwner = OwnerUserId, @WsCompId = CompId
      FROM dbo.tblWorkspaces WHERE Id = @WorkspaceId;
    IF (@WsOwner IS NULL)
    BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Workspace not found';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    IF (@WsCompId <> @CompId)
    BEGIN SET @ResponseCode = 403; SET @ResponseMess = 'Cross-company access denied';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- Archive: owner or admin. Unarchive: admin only.
    IF (@IsArchived = 1)
    BEGIN
        IF (@IsAdmin <> 1 AND @WsOwner <> @ActingUserId)
        BEGIN SET @ResponseCode = 403; SET @ResponseMess = 'Only owner or admin can archive';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    END
    ELSE
    BEGIN
        IF (@IsAdmin <> 1)
        BEGIN SET @ResponseCode = 403; SET @ResponseMess = 'Only admin can unarchive';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    END

    UPDATE dbo.tblWorkspaces
       SET IsArchived = @IsArchived,
           UpdatedDate = GETDATE()
     WHERE Id = @WorkspaceId;

    SET @ResponseCode = 200;
    SET @ResponseMess = CASE WHEN @IsArchived = 1 THEN 'Workspace archived' ELSE 'Workspace unarchived' END;
    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
           @WorkspaceId AS WorkspaceId, @IsArchived AS IsArchived;
END
GO

-- ============================================================
-- 6) Sanity checks
-- ============================================================
PRINT '----- migration 014 sanity -----';

SELECT 'sp_SaveWorkspace'          AS chk, CASE WHEN OBJECT_ID('dbo.sp_SaveWorkspace','P')         IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
UNION ALL SELECT 'sp_FetchWorkspaces',       CASE WHEN OBJECT_ID('dbo.sp_FetchWorkspaces','P')       IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'sp_AddWorkspaceMember',    CASE WHEN OBJECT_ID('dbo.sp_AddWorkspaceMember','P')    IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'sp_RemoveWorkspaceMember', CASE WHEN OBJECT_ID('dbo.sp_RemoveWorkspaceMember','P') IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'sp_ArchiveWorkspace',      CASE WHEN OBJECT_ID('dbo.sp_ArchiveWorkspace','P')      IS NOT NULL THEN 'OK' ELSE 'MISSING' END;
GO

-- Probe: user 2 (Ayush, owner) fetches workspaces — expect 1 personal
PRINT '----- probe: fetchWorkspaces UserId=2 -----';
EXEC dbo.sp_FetchWorkspaces @Id=0, @UserId=2, @CompId=1, @BranchId=1, @IsAdmin=1,
                            @AccessibleBranchIdsJson=NULL, @Type=NULL,
                            @IncludeArchived=0, @PageNumber=1, @PageSize=25, @SearchTerm=NULL;

-- Probe: user 3 (Raaj) fetches — expect 0 rows (not owner of any, no memberships yet)
PRINT '----- probe: fetchWorkspaces UserId=3 (should be empty) -----';
EXEC dbo.sp_FetchWorkspaces @Id=0, @UserId=3, @CompId=1, @BranchId=1, @IsAdmin=0,
                            @AccessibleBranchIdsJson=NULL, @Type=NULL,
                            @IncludeArchived=0, @PageNumber=1, @PageSize=25, @SearchTerm=NULL;

-- Probe: create shared workspace owned by user 3 (Raaj)
PRINT '----- probe: create shared workspace owned by user 3 -----';
EXEC dbo.sp_SaveWorkspace @Id=0, @Name='Raaj and Aman', @Type='shared',
                          @OwnerUserId=3, @TeamId=NULL, @ProjectId=NULL,
                          @Color='#F59E0B', @Icon='users', @CompId=1, @BranchId=2;

-- Probe: add user 4 (Aman) as member
PRINT '----- probe: add user 4 to the shared workspace -----';
DECLARE @SharedWs BIGINT;
SELECT TOP 1 @SharedWs = Id FROM dbo.tblWorkspaces WHERE OwnerUserId = 3 AND Type='shared' ORDER BY Id DESC;
EXEC dbo.sp_AddWorkspaceMember @WorkspaceId=@SharedWs, @UserId=4, @Role='member',
                               @ActingUserId=3, @IsAdmin=0, @CompId=1;

-- Probe: non-member (user 5) tries to add — should 403
PRINT '----- probe: non-member tries to add (expect 403) -----';
EXEC dbo.sp_AddWorkspaceMember @WorkspaceId=@SharedWs, @UserId=6, @Role='member',
                               @ActingUserId=5, @IsAdmin=0, @CompId=1;

-- Probe: user 4 (Aman) now sees the workspace
PRINT '----- probe: user 4 fetches workspaces (expect shared row) -----';
EXEC dbo.sp_FetchWorkspaces @Id=0, @UserId=4, @CompId=1, @BranchId=2, @IsAdmin=0,
                            @AccessibleBranchIdsJson=NULL, @Type=NULL,
                            @IncludeArchived=0, @PageNumber=1, @PageSize=25, @SearchTerm=NULL;
GO
