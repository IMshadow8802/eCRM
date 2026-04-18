-- ============================================================
-- Migration 026 — Workspace invite lifecycle SPs.
--
-- Rewrites (depends on migration 025):
--   sp_SaveWorkspace              accepts @MembersJson;
--                                  personal seeds owner; shared invites
--                                  each user as 'pending'; project
--                                  snapshots team members as 'active'.
--   sp_AddWorkspaceMember         inserts NEW members as 'pending' on
--                                  shared workspaces (invite flow).
--                                  Projects stay direct-add 'active'.
--   sp_RespondWorkspaceInvite     NEW. Caller accepts or declines their
--                                  own pending invite.
--   sp_FetchWorkspaces            returns MyInviteStatus; pending
--                                  invitees see the workspace row so
--                                  they can respond.
-- ============================================================

USE [eCRM+];
GO

-- ============================================================
-- sp_SaveWorkspace (WITH member seed)
-- ============================================================
IF OBJECT_ID('dbo.sp_SaveWorkspace', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_SaveWorkspace;
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
    @MembersJson   NVARCHAR(MAX) = NULL,  -- JSON array of UserIds for shared
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
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Project workspace requires a ProjectId';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@ProjectId IS NOT NULL AND @ProjectId > 0
        AND NOT EXISTS (SELECT 1 FROM dbo.tblProjects WHERE Id = @ProjectId))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid project reference';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- For project workspaces, pull the team from the linked project
    IF (@Type = 'project')
        SELECT @TeamId = TeamId FROM dbo.tblProjects WHERE Id = @ProjectId;

    IF (@TeamId IS NOT NULL AND @TeamId > 0
        AND NOT EXISTS (SELECT 1 FROM dbo.tblTeams WHERE Id = @TeamId AND IsActive = 1))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid team reference';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;

        IF (@Id = 0)
        BEGIN
            -- Users may own many personal workspaces (hobbies vs work vs
            -- reading). sp_SeedDefaultWorkspace still guarantees one
            -- auto-seeded on first login; creating extras via the modal
            -- is allowed.

            INSERT INTO dbo.tblWorkspaces
                (Name, Type, OwnerUserId, TeamId, ProjectId, IsArchived,
                 Color, Icon, CompId, BranchId)
            VALUES
                (@Name, @Type, @OwnerUserId, @TeamId, @ProjectId, 0,
                 @Color, @Icon, @CompId, @BranchId);

            DECLARE @NewId BIGINT = SCOPE_IDENTITY();

            -- Owner always lands as active member.
            INSERT INTO dbo.tblWorkspaceMembers
                (WorkspaceId, UserId, Role, AddedByUserId, IsActive, InviteStatus)
            VALUES
                (@NewId, @OwnerUserId, 'owner', @OwnerUserId, 1, 'active');

            IF (@Type = 'shared' AND @MembersJson IS NOT NULL AND @MembersJson <> '')
            BEGIN
                -- Each invited user except the owner and duplicates.
                ;WITH ids AS (
                    SELECT DISTINCT CAST(value AS INT) AS UserId
                      FROM OPENJSON(@MembersJson)
                )
                INSERT INTO dbo.tblWorkspaceMembers
                    (WorkspaceId, UserId, Role, AddedByUserId, IsActive,
                     InviteStatus, InvitedDate)
                SELECT @NewId, i.UserId, 'member', @OwnerUserId, 1, 'pending', GETDATE()
                  FROM ids i
                 WHERE i.UserId <> @OwnerUserId
                   AND EXISTS (SELECT 1 FROM dbo.tblUser u WHERE u.Id = i.UserId AND u.IsActive = 1);
            END
            ELSE IF (@Type = 'project' AND @TeamId IS NOT NULL AND @TeamId > 0)
            BEGIN
                -- Snapshot team members as active. Project manager becomes
                -- 'manager', all other team members 'member'.
                DECLARE @ProjectManagerId INT =
                    (SELECT ManagerUserId FROM dbo.tblProjects WHERE Id = @ProjectId);

                ;WITH teamUsers AS (
                    SELECT DISTINCT tm.UserId
                      FROM dbo.tblTeamMembers tm
                     WHERE tm.TeamId = @TeamId
                    UNION
                    SELECT @ProjectManagerId
                     WHERE @ProjectManagerId IS NOT NULL
                )
                INSERT INTO dbo.tblWorkspaceMembers
                    (WorkspaceId, UserId, Role, AddedByUserId, IsActive, InviteStatus)
                SELECT @NewId,
                       u.UserId,
                       CASE WHEN u.UserId = @ProjectManagerId THEN 'manager' ELSE 'member' END,
                       @OwnerUserId,
                       1,
                       'active'
                  FROM teamUsers u
                 WHERE u.UserId <> @OwnerUserId
                   AND EXISTS (SELECT 1 FROM dbo.tblUser uu WHERE uu.Id = u.UserId AND uu.IsActive = 1);
            END

            COMMIT TRANSACTION;
            SET @ResponseCode = 201;
            SET @ResponseMess = 'Workspace created';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @NewId AS WorkspaceId;
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
-- sp_AddWorkspaceMember — invite on shared, direct on project
-- ============================================================
IF OBJECT_ID('dbo.sp_AddWorkspaceMember', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_AddWorkspaceMember;
GO

CREATE PROCEDURE dbo.sp_AddWorkspaceMember
    @WorkspaceId    BIGINT,
    @UserId         INT,
    @Role           VARCHAR(20),
    @ActingUserId   INT,
    @IsAdmin        BIT = 0,
    @CompId         BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);
    DECLARE @WsType VARCHAR(20), @WsOwner INT, @WsCompId BIGINT, @ActingRole VARCHAR(20);
    DECLARE @TargetInviteStatus VARCHAR(20);

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

    IF (@WsType = 'personal')
    BEGIN SET @ResponseCode = 403; SET @ResponseMess = 'Personal workspaces cannot have extra members';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    SELECT @ActingRole = Role
      FROM dbo.tblWorkspaceMembers
     WHERE WorkspaceId = @WorkspaceId AND UserId = @ActingUserId
       AND IsActive = 1 AND InviteStatus = 'active';

    IF (@IsAdmin <> 1 AND @ActingRole NOT IN ('owner','manager'))
    BEGIN SET @ResponseCode = 403; SET @ResponseMess = 'Only workspace owner/manager (or admin) can add members';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@Role = 'owner')
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Ownership transfer must use a separate flow';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- Shared workspaces require an invite; project workspaces are direct-add.
    SET @TargetInviteStatus = CASE WHEN @WsType = 'shared' THEN 'pending' ELSE 'active' END;

    IF EXISTS (SELECT 1 FROM dbo.tblWorkspaceMembers
                WHERE WorkspaceId = @WorkspaceId AND UserId = @UserId)
    BEGIN
        UPDATE dbo.tblWorkspaceMembers
           SET Role = @Role,
               IsActive = 1,
               AddedByUserId = @ActingUserId,
               JoinedDate = GETDATE(),
               InviteStatus = @TargetInviteStatus,
               InvitedDate = CASE WHEN @TargetInviteStatus = 'pending' THEN GETDATE() ELSE InvitedDate END,
               RespondedDate = NULL
         WHERE WorkspaceId = @WorkspaceId AND UserId = @UserId;
        SET @ResponseCode = 200;
        SET @ResponseMess = CASE WHEN @TargetInviteStatus = 'pending'
                                  THEN 'Invite resent' ELSE 'Member reactivated' END;
    END
    ELSE
    BEGIN
        INSERT INTO dbo.tblWorkspaceMembers
            (WorkspaceId, UserId, Role, AddedByUserId, IsActive,
             InviteStatus, InvitedDate)
        VALUES (@WorkspaceId, @UserId, @Role, @ActingUserId, 1,
                @TargetInviteStatus,
                CASE WHEN @TargetInviteStatus = 'pending' THEN GETDATE() ELSE NULL END);
        SET @ResponseCode = 201;
        SET @ResponseMess = CASE WHEN @TargetInviteStatus = 'pending'
                                  THEN 'Invite sent' ELSE 'Member added' END;
    END

    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
           @WorkspaceId AS WorkspaceId, @UserId AS UserId,
           @Role AS Role, @TargetInviteStatus AS InviteStatus;
END
GO

-- ============================================================
-- sp_RespondWorkspaceInvite — accept/decline
-- ============================================================
IF OBJECT_ID('dbo.sp_RespondWorkspaceInvite', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_RespondWorkspaceInvite;
GO

CREATE PROCEDURE dbo.sp_RespondWorkspaceInvite
    @WorkspaceId  BIGINT,
    @UserId       INT,
    @Action       VARCHAR(10),   -- 'accept' | 'decline'
    @CompId       BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);
    DECLARE @CurrentStatus VARCHAR(20), @WsCompId BIGINT;

    IF (@Action NOT IN ('accept','decline'))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Action must be accept or decline';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    SELECT @WsCompId = CompId FROM dbo.tblWorkspaces WHERE Id = @WorkspaceId;
    IF (@WsCompId IS NULL OR @WsCompId <> @CompId)
    BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Workspace not found';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    SELECT @CurrentStatus = InviteStatus
      FROM dbo.tblWorkspaceMembers
     WHERE WorkspaceId = @WorkspaceId AND UserId = @UserId AND IsActive = 1;

    IF (@CurrentStatus IS NULL)
    BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'No invite found';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@CurrentStatus <> 'pending')
    BEGIN SET @ResponseCode = 409;
          SET @ResponseMess = 'Invite has already been ' + @CurrentStatus;
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    DECLARE @NewStatus VARCHAR(20) = CASE WHEN @Action = 'accept' THEN 'active' ELSE 'declined' END;

    UPDATE dbo.tblWorkspaceMembers
       SET InviteStatus  = @NewStatus,
           RespondedDate = GETDATE(),
           JoinedDate    = CASE WHEN @Action = 'accept' THEN GETDATE() ELSE JoinedDate END
     WHERE WorkspaceId = @WorkspaceId AND UserId = @UserId;

    SET @ResponseCode = 200;
    SET @ResponseMess = CASE WHEN @Action = 'accept' THEN 'Invite accepted' ELSE 'Invite declined' END;
    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
           @WorkspaceId AS WorkspaceId, @NewStatus AS InviteStatus;
END
GO

-- ============================================================
-- sp_FetchWorkspaces — expose MyInviteStatus + show pending invites
-- ============================================================
IF OBJECT_ID('dbo.sp_FetchWorkspaces', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_FetchWorkspaces;
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

    -- Visibility rule:
    --   personal   → owner only
    --   shared/project →
    --      admin sees every non-personal in their company (MyRole NULL)
    --      member (InviteStatus IN 'active','pending') sees it
    --      non-member (no row) does not
    SET @Offset = (@PageNumber - 1) * @PageSize;

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
                                     WHERE m.WorkspaceId = w.Id AND m.UserId = @UserId
                                       AND m.IsActive = 1
                                       AND m.InviteStatus IN ('active','pending'))))
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
                   NULL AS MemberCount, NULL AS MyRole, NULL AS MyInviteStatus;
            RETURN;
        END

        SET @ResponseCode = 200; SET @ResponseMess = 'Workspace retrieved';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
               w.Id, w.Name, w.Type, w.OwnerUserId, w.TeamId, w.ProjectId, w.IsArchived,
               w.Color, w.Icon, w.CompId, w.BranchId, w.CreatedDate, w.UpdatedDate,
               (SELECT COUNT(*) FROM dbo.tblWorkspaceMembers m
                 WHERE m.WorkspaceId = w.Id AND m.IsActive = 1
                   AND m.InviteStatus = 'active') AS MemberCount,
               (SELECT TOP 1 m.Role FROM dbo.tblWorkspaceMembers m
                 WHERE m.WorkspaceId = w.Id AND m.UserId = @UserId
                   AND m.IsActive = 1 AND m.InviteStatus = 'active') AS MyRole,
               (SELECT TOP 1 m.InviteStatus FROM dbo.tblWorkspaceMembers m
                 WHERE m.WorkspaceId = w.Id AND m.UserId = @UserId
                   AND m.IsActive = 1) AS MyInviteStatus
          FROM dbo.tblWorkspaces w
         WHERE w.Id = @Id;
        RETURN;
    END

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
                                   WHERE m.WorkspaceId = w.Id AND m.UserId = @UserId
                                     AND m.IsActive = 1
                                     AND m.InviteStatus IN ('active','pending'))))
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
               NULL AS MemberCount, NULL AS MyRole, NULL AS MyInviteStatus;
        RETURN;
    END

    SET @ResponseCode = 200; SET @ResponseMess = 'Workspaces retrieved';
    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
           @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
           @PageNumber AS CurrentPage, @PageSize AS PageSize,
           w.Id, w.Name, w.Type, w.OwnerUserId, w.TeamId, w.ProjectId, w.IsArchived,
           w.Color, w.Icon, w.CompId, w.BranchId, w.CreatedDate, w.UpdatedDate,
           (SELECT COUNT(*) FROM dbo.tblWorkspaceMembers m
             WHERE m.WorkspaceId = w.Id AND m.IsActive = 1
               AND m.InviteStatus = 'active') AS MemberCount,
           (SELECT TOP 1 m.Role FROM dbo.tblWorkspaceMembers m
             WHERE m.WorkspaceId = w.Id AND m.UserId = @UserId
               AND m.IsActive = 1 AND m.InviteStatus = 'active') AS MyRole,
           (SELECT TOP 1 m.InviteStatus FROM dbo.tblWorkspaceMembers m
             WHERE m.WorkspaceId = w.Id AND m.UserId = @UserId
               AND m.IsActive = 1) AS MyInviteStatus
      FROM dbo.tblWorkspaces w
     WHERE w.CompId = @CompId
       AND (@IncludeArchived = 1 OR w.IsArchived = 0)
       AND (@Type IS NULL OR w.Type = @Type)
       AND (
             (w.Type = 'personal' AND w.OwnerUserId = @UserId)
          OR (w.Type IN ('shared','project')
              AND (@IsAdmin = 1
                   OR EXISTS (SELECT 1 FROM dbo.tblWorkspaceMembers m
                               WHERE m.WorkspaceId = w.Id AND m.UserId = @UserId
                                 AND m.IsActive = 1
                                 AND m.InviteStatus IN ('active','pending'))))
           )
       AND ((@UseScope = 1 AND w.BranchId IN (SELECT BranchId FROM @BranchIds))
            OR (@UseScope = 0 AND (@IsAdmin = 1 OR w.BranchId = @BranchId)))
       AND (@SearchTerm IS NULL OR w.Name LIKE '%' + @SearchTerm + '%')
     ORDER BY CASE w.Type WHEN 'personal' THEN 0 WHEN 'shared' THEN 1 ELSE 2 END,
              w.UpdatedDate DESC, w.CreatedDate DESC
     OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
END
GO

PRINT 'Migration 026 complete.';
GO
