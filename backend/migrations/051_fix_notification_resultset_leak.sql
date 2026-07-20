-- 051_fix_notification_resultset_leak.sql
-- ============================================================================
-- Bug: clicking Re-invite toasted "Notification created" at the user. The
-- workspace SPs from 049 called sp_CreateNotification BARE, so the nested
-- procedure's own status SELECT arrived as the FIRST result set and the
-- controller (recordset[0]) served internal plumbing as the user-facing
-- message. Repo convention (INSERT INTO @tbl EXEC — see every activity-logger
-- call) was not followed. This script supersedes 049's four notifying SPs.
--
--   1. sp_CreateNotification — uniform 5-column result on EVERY path
--      (INSERT INTO ... EXEC requires a consistent shape; the old SP returned
--      3 columns on early returns and 5 on success)
--   2-5. sp_RemoveWorkspaceMember / sp_RespondWorkspaceInvite /
--        sp_AddWorkspaceMember / sp_TransferWorkspaceOwnership — nested
--        notification calls captured into a table variable
-- ============================================================================
USE [eCRM+];
GO

CREATE OR ALTER PROCEDURE dbo.sp_CreateNotification
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
        SELECT 200 AS ResponseCode, 'Skipped self-notification' AS ResponseMess,
               CAST(NULL AS BIGINT) AS NotificationId, @UserId AS UserId, @Type AS Type;
        RETURN;
    END

    IF NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Id = @UserId AND IsActive = 1)
    BEGIN
        SELECT 400 AS ResponseCode, 'Invalid recipient' AS ResponseMess,
               CAST(NULL AS BIGINT) AS NotificationId, @UserId AS UserId, @Type AS Type;
        RETURN;
    END

    -- Check opt-out (tblNotificationPreferences). Absence = enabled by default.
    IF EXISTS (SELECT 1 FROM dbo.tblNotificationPreferences
                WHERE UserId = @UserId AND Type = @Type
                  AND Channel = 'inapp' AND IsEnabled = 0)
    BEGIN
        SELECT 200 AS ResponseCode, 'Recipient opted out' AS ResponseMess,
               CAST(NULL AS BIGINT) AS NotificationId, @UserId AS UserId, @Type AS Type;
        RETURN;
    END

    INSERT INTO dbo.tblNotifications
        (UserId, Type, EntityType, EntityId, ActorUserId, Title, Body, CompId, BranchId)
    VALUES
        (@UserId, @Type, @EntityType, @EntityId, @ActorUserId, @Title, @Body, @CompId, @BranchId);

    SET @NotificationId = SCOPE_IDENTITY();

    SELECT 201 AS ResponseCode, 'Notification created' AS ResponseMess,
           @NotificationId AS NotificationId, @UserId AS UserId, @Type AS Type;
END
GO

-- ---------------------------------------------------------------------------
-- 2. sp_RemoveWorkspaceMember — + owner notification on self-leave
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_RemoveWorkspaceMember
    @WorkspaceId    BIGINT,
    @UserId         INT,
    @ActingUserId   INT,
    @IsAdmin        BIT = 0,
    @CompId         BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);
    DECLARE @WsType VARCHAR(20), @WsOwner INT, @WsCompId BIGINT, @WsTeamId INT,
            @WsName VARCHAR(200), @WsBranchId BIGINT, @ActingRole VARCHAR(20);

    SELECT @WsType = Type, @WsOwner = OwnerUserId, @WsCompId = CompId,
           @WsTeamId = TeamId, @WsName = Name, @WsBranchId = BranchId
      FROM dbo.tblWorkspaces WHERE Id = @WorkspaceId;
    IF (@WsType IS NULL)
    BEGIN SELECT 404 AS ResponseCode, 'Workspace not found' AS ResponseMess; RETURN; END
    IF (@WsCompId <> @CompId)
    BEGIN SELECT 403 AS ResponseCode, 'Cross-company access denied' AS ResponseMess; RETURN; END

    IF (@UserId = @WsOwner)
    BEGIN SELECT 400 AS ResponseCode, 'Cannot remove the workspace owner' AS ResponseMess; RETURN; END

    SELECT @ActingRole = Role
      FROM dbo.tblWorkspaceMembers
     WHERE WorkspaceId = @WorkspaceId AND UserId = @ActingUserId
       AND IsActive = 1 AND InviteStatus = 'active';

    IF (@IsAdmin <> 1 AND @ActingRole NOT IN ('owner','manager') AND @ActingUserId <> @UserId)
    BEGIN SELECT 403 AS ResponseCode, 'Not allowed' AS ResponseMess; RETURN; END

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

        -- Self-leave: the owner deserves to know, not to discover it by
        -- counting heads. (@SkipSelf guards the owner-leaves-somehow case.)
        IF (@ActingUserId = @UserId)
        BEGIN
            DECLARE @LeaverName VARCHAR(200) =
                ISNULL((SELECT FullName FROM dbo.tblUser WHERE Id = @UserId),
                       (SELECT Username FROM dbo.tblUser WHERE Id = @UserId));
            DECLARE @Notif TABLE (ResponseCode INT, ResponseMess VARCHAR(400),
                                  NotificationId BIGINT, UserId INT, Type VARCHAR(40));
            INSERT INTO @Notif
            EXEC dbo.sp_CreateNotification
                 @UserId      = @WsOwner,
                 @Type        = 'workspace_left',
                 @EntityType  = 'Workspace',
                 @EntityId    = @WorkspaceId,
                 @ActorUserId = @ActingUserId,
                 @Title       = 'Member left workspace',
                 @Body        = @LeaverName,
                 @CompId      = @CompId,
                 @BranchId    = @WsBranchId,
                 @SkipSelf    = 1;
        END

        COMMIT TRANSACTION;
        SELECT 200 AS ResponseCode, 'Member removed' AS ResponseMess,
               @WorkspaceId AS WorkspaceId, @UserId AS UserId;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT 500 AS ResponseCode, 'Error removing member: ' + ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

-- ---------------------------------------------------------------------------
-- 3. sp_RespondWorkspaceInvite — + inviter notification on accept/decline
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_RespondWorkspaceInvite
    @WorkspaceId  BIGINT,
    @UserId       INT,
    @Action       VARCHAR(10),   -- 'accept' | 'decline'
    @CompId       BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);
    DECLARE @CurrentStatus VARCHAR(20), @WsCompId BIGINT, @WsOwner INT,
            @InvitedBy INT, @WsName VARCHAR(200), @WsBranchId BIGINT;

    IF (@Action NOT IN ('accept','decline'))
    BEGIN SELECT 400 AS ResponseCode, 'Action must be accept or decline' AS ResponseMess; RETURN; END

    SELECT @WsCompId = CompId, @WsOwner = OwnerUserId, @WsName = Name,
           @WsBranchId = BranchId
      FROM dbo.tblWorkspaces WHERE Id = @WorkspaceId;
    IF (@WsCompId IS NULL OR @WsCompId <> @CompId)
    BEGIN SELECT 404 AS ResponseCode, 'Workspace not found' AS ResponseMess; RETURN; END

    SELECT @CurrentStatus = InviteStatus, @InvitedBy = AddedByUserId
      FROM dbo.tblWorkspaceMembers
     WHERE WorkspaceId = @WorkspaceId AND UserId = @UserId AND IsActive = 1;

    IF (@CurrentStatus IS NULL)
    BEGIN SELECT 404 AS ResponseCode, 'No invite found' AS ResponseMess; RETURN; END

    IF (@CurrentStatus <> 'pending')
    BEGIN SELECT 409 AS ResponseCode,
                 'Invite has already been ' + @CurrentStatus AS ResponseMess; RETURN; END

    DECLARE @NewStatus VARCHAR(20) = CASE WHEN @Action = 'accept' THEN 'active' ELSE 'declined' END;

    UPDATE dbo.tblWorkspaceMembers
       SET InviteStatus  = @NewStatus,
           RespondedDate = GETDATE(),
           JoinedDate    = CASE WHEN @Action = 'accept' THEN GETDATE() ELSE JoinedDate END
     WHERE WorkspaceId = @WorkspaceId AND UserId = @UserId;

    -- Tell whoever invited them (fallback: the owner) what happened.
    DECLARE @NotifyUser INT = ISNULL(@InvitedBy, @WsOwner);
    DECLARE @ResponderName VARCHAR(200) =
        ISNULL((SELECT FullName FROM dbo.tblUser WHERE Id = @UserId),
               (SELECT Username FROM dbo.tblUser WHERE Id = @UserId));
    -- EXEC args must be variables/literals — no inline CASE.
    DECLARE @NotifType  VARCHAR(50)  = CASE WHEN @Action = 'accept'
                                            THEN 'workspace_invite_accepted'
                                            ELSE 'workspace_invite_declined' END;
    DECLARE @NotifTitle VARCHAR(100) = CASE WHEN @Action = 'accept'
                                            THEN 'Invite accepted' ELSE 'Invite declined' END;
    DECLARE @Notif TABLE (ResponseCode INT, ResponseMess VARCHAR(400),
                          NotificationId BIGINT, UserId INT, Type VARCHAR(40));
    INSERT INTO @Notif
    EXEC dbo.sp_CreateNotification
         @UserId      = @NotifyUser,
         @Type        = @NotifType,
         @EntityType  = 'Workspace',
         @EntityId    = @WorkspaceId,
         @ActorUserId = @UserId,
         @Title       = @NotifTitle,
         @Body        = @ResponderName,
         @CompId      = @CompId,
         @BranchId    = @WsBranchId,
         @SkipSelf    = 1;

    SELECT 200 AS ResponseCode,
           CASE WHEN @Action = 'accept' THEN 'Invite accepted' ELSE 'Invite declined' END AS ResponseMess,
           @WorkspaceId AS WorkspaceId, @NewStatus AS InviteStatus;
END
GO

-- ---------------------------------------------------------------------------
-- 4. sp_AddWorkspaceMember — + invitee notification
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_AddWorkspaceMember
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
    DECLARE @WsType VARCHAR(20), @WsOwner INT, @WsCompId BIGINT,
            @WsName VARCHAR(200), @WsBranchId BIGINT, @ActingRole VARCHAR(20);
    DECLARE @TargetInviteStatus VARCHAR(20);

    IF (@Role NOT IN ('owner','manager','member','viewer'))
    BEGIN SELECT 400 AS ResponseCode, 'Invalid role' AS ResponseMess; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Id = @UserId AND IsActive = 1)
    BEGIN SELECT 400 AS ResponseCode, 'Invalid user' AS ResponseMess; RETURN; END

    SELECT @WsType = Type, @WsOwner = OwnerUserId, @WsCompId = CompId,
           @WsName = Name, @WsBranchId = BranchId
      FROM dbo.tblWorkspaces WHERE Id = @WorkspaceId;
    IF (@WsType IS NULL)
    BEGIN SELECT 404 AS ResponseCode, 'Workspace not found' AS ResponseMess; RETURN; END
    IF (@WsCompId <> @CompId)
    BEGIN SELECT 403 AS ResponseCode, 'Cross-company access denied' AS ResponseMess; RETURN; END

    IF (@WsType = 'personal')
    BEGIN SELECT 403 AS ResponseCode, 'Personal workspaces cannot have extra members' AS ResponseMess; RETURN; END

    SELECT @ActingRole = Role
      FROM dbo.tblWorkspaceMembers
     WHERE WorkspaceId = @WorkspaceId AND UserId = @ActingUserId
       AND IsActive = 1 AND InviteStatus = 'active';

    IF (@IsAdmin <> 1 AND @ActingRole NOT IN ('owner','manager'))
    BEGIN SELECT 403 AS ResponseCode, 'Only workspace owner/manager (or admin) can add members' AS ResponseMess; RETURN; END

    IF (@Role = 'owner')
    BEGIN SELECT 400 AS ResponseCode, 'Ownership transfer must use a separate flow' AS ResponseMess; RETURN; END

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

    -- Ping the invitee — the Tasks-page popup asks on next visit; the bell
    -- tells them there is something to visit.
    -- EXEC args must be variables/literals — no inline CASE.
    DECLARE @NotifType  VARCHAR(50)  = CASE WHEN @TargetInviteStatus = 'pending'
                                            THEN 'workspace_invite' ELSE 'workspace_added' END;
    DECLARE @NotifTitle VARCHAR(100) = CASE WHEN @TargetInviteStatus = 'pending'
                                            THEN 'Workspace invite' ELSE 'Added to workspace' END;
    DECLARE @Notif TABLE (ResponseCode INT, ResponseMess VARCHAR(400),
                          NotificationId BIGINT, UserId INT, Type VARCHAR(40));
    INSERT INTO @Notif
    EXEC dbo.sp_CreateNotification
         @UserId      = @UserId,
         @Type        = @NotifType,
         @EntityType  = 'Workspace',
         @EntityId    = @WorkspaceId,
         @ActorUserId = @ActingUserId,
         @Title       = @NotifTitle,
         @Body        = @WsName,
         @CompId      = @CompId,
         @BranchId    = @WsBranchId,
         @SkipSelf    = 1;

    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
           @WorkspaceId AS WorkspaceId, @UserId AS UserId,
           @Role AS Role, @TargetInviteStatus AS InviteStatus;
END
GO

-- ---------------------------------------------------------------------------
-- 5. sp_TransferWorkspaceOwnership — + new-owner notification
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_TransferWorkspaceOwnership
    @WorkspaceId    BIGINT,
    @NewOwnerUserId INT,
    @ActingUserId   INT,
    @IsAdmin        BIT = 0,
    @CompId         BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @WsType VARCHAR(20), @WsOwner INT, @WsCompId BIGINT,
            @WsName VARCHAR(200), @WsBranchId BIGINT;

    SELECT @WsType = Type, @WsOwner = OwnerUserId, @WsCompId = CompId,
           @WsName = Name, @WsBranchId = BranchId
      FROM dbo.tblWorkspaces WHERE Id = @WorkspaceId;

    IF (@WsType IS NULL)
    BEGIN SELECT 404 AS ResponseCode, 'Workspace not found' AS ResponseMess; RETURN; END
    IF (@WsCompId <> @CompId)
    BEGIN SELECT 403 AS ResponseCode, 'Cross-company access denied' AS ResponseMess; RETURN; END
    IF (@WsType = 'personal')
    BEGIN SELECT 400 AS ResponseCode, 'Personal workspaces cannot change owner' AS ResponseMess; RETURN; END
    IF (@IsAdmin <> 1 AND @WsOwner <> @ActingUserId)
    BEGIN SELECT 403 AS ResponseCode, 'Only the owner or an admin can transfer ownership' AS ResponseMess; RETURN; END
    IF (@NewOwnerUserId = @WsOwner)
    BEGIN SELECT 400 AS ResponseCode, 'User is already the owner' AS ResponseMess; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Id = @NewOwnerUserId AND IsActive = 1)
    BEGIN SELECT 400 AS ResponseCode, 'New owner is not an active user' AS ResponseMess; RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.tblWorkspaceMembers
                    WHERE WorkspaceId = @WorkspaceId AND UserId = @NewOwnerUserId
                      AND IsActive = 1 AND InviteStatus = 'active')
    BEGIN SELECT 400 AS ResponseCode, 'New owner must be an active member of the workspace' AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;

        UPDATE dbo.tblWorkspaces
           SET OwnerUserId = @NewOwnerUserId, UpdatedDate = GETDATE()
         WHERE Id = @WorkspaceId;

        UPDATE dbo.tblWorkspaceMembers
           SET Role = 'owner'
         WHERE WorkspaceId = @WorkspaceId AND UserId = @NewOwnerUserId;

        UPDATE dbo.tblWorkspaceMembers
           SET Role = 'manager'
         WHERE WorkspaceId = @WorkspaceId AND UserId = @WsOwner;

        DECLARE @Notif TABLE (ResponseCode INT, ResponseMess VARCHAR(400),
                              NotificationId BIGINT, UserId INT, Type VARCHAR(40));
        INSERT INTO @Notif
        EXEC dbo.sp_CreateNotification
             @UserId      = @NewOwnerUserId,
             @Type        = 'workspace_ownership',
             @EntityType  = 'Workspace',
             @EntityId    = @WorkspaceId,
             @ActorUserId = @ActingUserId,
             @Title       = 'You are now the workspace owner',
             @Body        = @WsName,
             @CompId      = @CompId,
             @BranchId    = @WsBranchId,
             @SkipSelf    = 1;

        COMMIT TRANSACTION;
        SELECT 200 AS ResponseCode, 'Ownership transferred' AS ResponseMess,
               @WorkspaceId AS WorkspaceId, @NewOwnerUserId AS NewOwnerUserId;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT 500 AS ResponseCode, 'Transfer failed: ' + ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

-- ============================================================================
-- VERIFY AFTER APPLY
-- ============================================================================
-- Exercise the re-invite path FOR REAL in a rollback transaction. Success now
-- means: FIRST result set says 'Invite resent' / 'Member reactivated' — NOT
-- 'Notification created' — and the notification row still lands.
BEGIN TRANSACTION;
    EXEC dbo.sp_AddWorkspaceMember @WorkspaceId = 10006, @UserId = 2,
         @Role = 'member', @ActingUserId = 3, @IsAdmin = 0, @CompId = 1;
    SELECT TOP 3 Id, UserId, Type, Title, Body, CompId, BranchId
      FROM dbo.tblNotifications ORDER BY Id DESC;
ROLLBACK TRANSACTION;
