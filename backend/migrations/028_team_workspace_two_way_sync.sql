-- ============================================================
-- Migration 028 — Two-way sync between team and project workspace.
--
-- Rule:
--   Team member added     → all project workspaces linked to that
--                            team gain the user as an 'active' member.
--   Team member removed   → removed from those workspaces (soft).
--   Workspace member added to a project workspace → also inserted
--                            into tblTeamMembers for the linked team.
--   Workspace member removed → also removed from tblTeamMembers.
--
-- No new tables. sp_SaveTeam, sp_AddWorkspaceMember,
-- sp_RemoveWorkspaceMember, sp_RespondWorkspaceInvite rewritten.
-- ============================================================

USE [eCRM+];
GO

-- ============================================================
-- sp_SaveTeam — propagate member list to linked project workspaces
-- ============================================================
IF OBJECT_ID('dbo.sp_SaveTeam', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_SaveTeam;
GO

CREATE PROCEDURE dbo.sp_SaveTeam
    @Id           INT,
    @Name         VARCHAR(200),
    @Description  VARCHAR(500),
    @LeadUserId   INT,
    @Color        VARCHAR(10),
    @Members      NVARCHAR(MAX),
    @IsActive     BIT,
    @CompId       BIGINT,
    @BranchId     BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);
    DECLARE @MemberCount INT = 0;

    IF (@Name IS NULL OR LTRIM(RTRIM(@Name)) = '')
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Team name is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@LeadUserId IS NOT NULL AND @LeadUserId > 0)
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM tblUser WHERE Id = @LeadUserId AND IsActive = 1)
        BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid team lead selected';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    END

    BEGIN TRY
        BEGIN TRANSACTION;

        IF (@Id = 0)
        BEGIN
            INSERT INTO tblTeams (Name, Description, LeadUserId, Color, IsActive, CompId, BranchId)
            VALUES (@Name, @Description, @LeadUserId, @Color, @IsActive, @CompId, @BranchId);
            SET @Id = SCOPE_IDENTITY();
            SET @ResponseCode = 201; SET @ResponseMess = 'Team created successfully';
        END
        ELSE
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM tblTeams WHERE Id = @Id AND CompId = @CompId)
            BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Team not found';
                  SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
                  ROLLBACK TRANSACTION; RETURN; END
            UPDATE tblTeams
               SET Name = @Name, Description = @Description, LeadUserId = @LeadUserId,
                   Color = @Color, IsActive = @IsActive
             WHERE Id = @Id AND CompId = @CompId;
            SET @ResponseCode = 200; SET @ResponseMess = 'Team updated successfully';
            DELETE FROM tblTeamMembers WHERE TeamId = @Id;
        END

        -- New membership set parsed from the JSON payload
        DECLARE @NewMembers TABLE (UserId INT PRIMARY KEY);
        IF (@Members IS NOT NULL AND @Members <> '')
            INSERT INTO @NewMembers (UserId)
            SELECT DISTINCT CAST(value AS INT)
              FROM OPENJSON(@Members)
             WHERE CAST(value AS INT) IN (SELECT Id FROM tblUser WHERE IsActive = 1);

        INSERT INTO tblTeamMembers (TeamId, UserId, JoinedDate, IsActive)
        SELECT @Id, UserId, GETDATE(), 1 FROM @NewMembers;
        SET @MemberCount = @@ROWCOUNT;

        -- Cascade: every project workspace linked to this team now mirrors
        -- the new member list. Owner + manager keep their roles; everyone
        -- else becomes 'member'. Users dropped from the team are soft-
        -- removed from those workspaces too.
        DECLARE @LinkedWorkspaces TABLE (Id BIGINT PRIMARY KEY);
        INSERT INTO @LinkedWorkspaces (Id)
        SELECT Id FROM dbo.tblWorkspaces
         WHERE TeamId = @Id AND Type = 'project' AND IsArchived = 0;

        -- Remove absent members from each workspace
        UPDATE wm
           SET IsActive = 0,
               InviteStatus = 'removed',
               RespondedDate = GETDATE()
          FROM dbo.tblWorkspaceMembers wm
         WHERE wm.WorkspaceId IN (SELECT Id FROM @LinkedWorkspaces)
           AND wm.UserId NOT IN (SELECT UserId FROM @NewMembers)
           AND wm.Role <> 'owner'
           AND wm.UserId <>
               ISNULL((SELECT OwnerUserId FROM dbo.tblWorkspaces
                        WHERE Id = wm.WorkspaceId), -1);

        -- Insert newcomers + reactivate anyone who had been removed
        MERGE dbo.tblWorkspaceMembers AS tgt
        USING (
            SELECT lw.Id AS WorkspaceId, nm.UserId
              FROM @LinkedWorkspaces lw
              CROSS JOIN @NewMembers nm
        ) AS src
        ON (tgt.WorkspaceId = src.WorkspaceId AND tgt.UserId = src.UserId)
        WHEN MATCHED THEN
            UPDATE SET IsActive = 1,
                       InviteStatus = 'active',
                       RespondedDate = GETDATE()
        WHEN NOT MATCHED BY TARGET THEN
            INSERT (WorkspaceId, UserId, Role, AddedByUserId, IsActive, InviteStatus)
            VALUES (src.WorkspaceId, src.UserId, 'member', @LeadUserId, 1, 'active');

        COMMIT TRANSACTION;
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               @Id AS TeamId, @MemberCount AS MemberCount;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SET @ResponseCode = 500;
        SET @ResponseMess = 'Error saving team: ' + ERROR_MESSAGE();
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END CATCH
END
GO

-- ============================================================
-- sp_AddWorkspaceMember — cascade to team for project workspaces
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
    DECLARE @WsType VARCHAR(20), @WsOwner INT, @WsCompId BIGINT, @WsTeamId INT, @ActingRole VARCHAR(20);
    DECLARE @TargetInviteStatus VARCHAR(20);

    IF (@Role NOT IN ('owner','manager','member','viewer'))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid role';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Id = @UserId AND IsActive = 1)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid user';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    SELECT @WsType = Type, @WsOwner = OwnerUserId,
           @WsCompId = CompId, @WsTeamId = TeamId
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

    SET @TargetInviteStatus = CASE WHEN @WsType = 'shared' THEN 'pending' ELSE 'active' END;

    BEGIN TRY
        BEGIN TRANSACTION;

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

        -- Project workspaces: cascade into the team roster so team
        -- membership stays the source of truth for everyone on it.
        IF (@WsType = 'project' AND @WsTeamId IS NOT NULL AND @WsTeamId > 0
            AND @TargetInviteStatus = 'active')
        BEGIN
            IF EXISTS (SELECT 1 FROM dbo.tblTeamMembers
                        WHERE TeamId = @WsTeamId AND UserId = @UserId)
                UPDATE dbo.tblTeamMembers SET IsActive = 1
                 WHERE TeamId = @WsTeamId AND UserId = @UserId;
            ELSE
                INSERT INTO dbo.tblTeamMembers (TeamId, UserId, JoinedDate, IsActive)
                VALUES (@WsTeamId, @UserId, GETDATE(), 1);
        END

        COMMIT TRANSACTION;
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               @WorkspaceId AS WorkspaceId, @UserId AS UserId,
               @Role AS Role, @TargetInviteStatus AS InviteStatus;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SET @ResponseCode = 500;
        SET @ResponseMess = 'Error adding member: ' + ERROR_MESSAGE();
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END CATCH
END
GO

-- ============================================================
-- sp_RemoveWorkspaceMember — cascade to team for project workspaces
-- ============================================================
IF OBJECT_ID('dbo.sp_RemoveWorkspaceMember', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_RemoveWorkspaceMember;
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
    DECLARE @WsType VARCHAR(20), @WsOwner INT, @WsCompId BIGINT, @WsTeamId INT, @ActingRole VARCHAR(20);

    SELECT @WsType = Type, @WsOwner = OwnerUserId,
           @WsCompId = CompId, @WsTeamId = TeamId
      FROM dbo.tblWorkspaces WHERE Id = @WorkspaceId;
    IF (@WsType IS NULL)
    BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Workspace not found';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    IF (@WsCompId <> @CompId)
    BEGIN SET @ResponseCode = 403; SET @ResponseMess = 'Cross-company access denied';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@UserId = @WsOwner)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Cannot remove the workspace owner';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    SELECT @ActingRole = Role
      FROM dbo.tblWorkspaceMembers
     WHERE WorkspaceId = @WorkspaceId AND UserId = @ActingUserId
       AND IsActive = 1 AND InviteStatus = 'active';

    IF (@IsAdmin <> 1 AND @ActingRole NOT IN ('owner','manager') AND @ActingUserId <> @UserId)
    BEGIN SET @ResponseCode = 403; SET @ResponseMess = 'Not allowed';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;

        UPDATE dbo.tblWorkspaceMembers
           SET IsActive = 0,
               InviteStatus = 'removed',
               RespondedDate = GETDATE()
         WHERE WorkspaceId = @WorkspaceId AND UserId = @UserId;

        IF (@WsType = 'project' AND @WsTeamId IS NOT NULL AND @WsTeamId > 0)
        BEGIN
            UPDATE dbo.tblTeamMembers
               SET IsActive = 0
             WHERE TeamId = @WsTeamId AND UserId = @UserId;
        END

        COMMIT TRANSACTION;
        SET @ResponseCode = 200; SET @ResponseMess = 'Member removed';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               @WorkspaceId AS WorkspaceId, @UserId AS UserId;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SET @ResponseCode = 500;
        SET @ResponseMess = 'Error removing member: ' + ERROR_MESSAGE();
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END CATCH
END
GO

-- ============================================================
-- sp_RespondWorkspaceInvite — on project accept, mirror to team
-- ============================================================
IF OBJECT_ID('dbo.sp_RespondWorkspaceInvite', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_RespondWorkspaceInvite;
GO

CREATE PROCEDURE dbo.sp_RespondWorkspaceInvite
    @WorkspaceId  BIGINT,
    @UserId       INT,
    @Action       VARCHAR(10),
    @CompId       BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);
    DECLARE @CurrentStatus VARCHAR(20), @WsCompId BIGINT, @WsType VARCHAR(20), @WsTeamId INT;

    IF (@Action NOT IN ('accept','decline'))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Action must be accept or decline';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    SELECT @WsCompId = CompId, @WsType = Type, @WsTeamId = TeamId
      FROM dbo.tblWorkspaces WHERE Id = @WorkspaceId;
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

    BEGIN TRY
        BEGIN TRANSACTION;

        UPDATE dbo.tblWorkspaceMembers
           SET InviteStatus  = @NewStatus,
               RespondedDate = GETDATE(),
               JoinedDate    = CASE WHEN @Action = 'accept' THEN GETDATE() ELSE JoinedDate END
         WHERE WorkspaceId = @WorkspaceId AND UserId = @UserId;

        IF (@Action = 'accept' AND @WsType = 'project' AND @WsTeamId IS NOT NULL AND @WsTeamId > 0)
        BEGIN
            IF EXISTS (SELECT 1 FROM dbo.tblTeamMembers
                        WHERE TeamId = @WsTeamId AND UserId = @UserId)
                UPDATE dbo.tblTeamMembers SET IsActive = 1
                 WHERE TeamId = @WsTeamId AND UserId = @UserId;
            ELSE
                INSERT INTO dbo.tblTeamMembers (TeamId, UserId, JoinedDate, IsActive)
                VALUES (@WsTeamId, @UserId, GETDATE(), 1);
        END

        COMMIT TRANSACTION;
        SET @ResponseCode = 200;
        SET @ResponseMess = CASE WHEN @Action = 'accept' THEN 'Invite accepted' ELSE 'Invite declined' END;
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               @WorkspaceId AS WorkspaceId, @NewStatus AS InviteStatus;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SET @ResponseCode = 500;
        SET @ResponseMess = 'Error responding to invite: ' + ERROR_MESSAGE();
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END CATCH
END
GO

PRINT 'Migration 028 complete — team ↔ project workspace sync installed.';
GO
