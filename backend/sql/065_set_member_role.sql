-- =============================================================================
-- 065_set_member_role.sql
--
-- Lets an owner/manager change an existing member's role on a board — the
-- missing half of making `viewer` a real role rather than dead code.
--
-- WHY NOT REUSE sp_AddWorkspaceMember
--   It takes @Role and upserts, so it looks like it would do the job. But its
--   UPDATE branch also does:
--       InviteStatus = @TargetInviteStatus,   -- 'pending' on a shared board
--       RespondedDate = NULL,
--       JoinedDate = GETDATE()
--   i.e. it RE-INVITES. Using it to demote someone to viewer would knock an
--   active member back to pending and lock them out of the board until they
--   accepted again — and, per 061, a pending member has no access at all. A
--   role change must not touch invite state.
--
-- RULES
--   * only owner/manager (or a company admin) may change a role
--   * the workspace OWNER's role cannot be changed here — ownership moves via
--     sp_TransferWorkspaceOwnership, which also demotes the outgoing owner
--   * nobody can be promoted TO owner here, same reason
--   * the target must be an active member; you cannot pre-set the role of a
--     pending invitee (accepting would be ambiguous) or of someone who declined
--
-- No schema changes.
-- =============================================================================

IF OBJECT_ID('dbo.sp_SetWorkspaceMemberRole', 'P') IS NULL
    EXEC('CREATE PROC dbo.sp_SetWorkspaceMemberRole AS SET NOCOUNT ON;');
GO

ALTER PROC dbo.sp_SetWorkspaceMemberRole
    @WorkspaceId  BIGINT,
    @UserId       INT,
    @Role         VARCHAR(20),
    @ActingUserId INT,
    @IsAdmin      BIT = 0,
    @CompId       BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @WsType VARCHAR(20), @WsOwner INT, @WsCompId BIGINT, @ActingRole VARCHAR(20);

    IF (@Role NOT IN ('manager','member','viewer'))
    BEGIN SELECT 400 AS ResponseCode,
                 'Role must be manager, member or viewer' AS ResponseMess; RETURN; END

    SELECT @WsType = Type, @WsOwner = OwnerUserId, @WsCompId = CompId
      FROM dbo.tblWorkspaces WHERE Id = @WorkspaceId;

    IF (@WsType IS NULL)
    BEGIN SELECT 404 AS ResponseCode, 'Workspace not found' AS ResponseMess; RETURN; END

    IF (@WsCompId <> @CompId)
    BEGIN SELECT 403 AS ResponseCode, 'Cross-company access denied' AS ResponseMess; RETURN; END

    IF (@WsType = 'personal')
    BEGIN SELECT 403 AS ResponseCode,
                 'Personal workspaces have no members' AS ResponseMess; RETURN; END

    SELECT @ActingRole = Role
      FROM dbo.tblWorkspaceMembers
     WHERE WorkspaceId = @WorkspaceId AND UserId = @ActingUserId
       AND IsActive = 1 AND InviteStatus = 'active';

    IF (@IsAdmin <> 1 AND @ActingRole NOT IN ('owner','manager'))
    BEGIN SELECT 403 AS ResponseCode,
                 'Only workspace owner/manager (or admin) can change roles' AS ResponseMess; RETURN; END

    -- The owner's role is not editable here; demoting them would leave the
    -- board ownerless, and tblWorkspaces.OwnerUserId would disagree with the
    -- member row. sp_TransferWorkspaceOwnership handles that properly.
    IF (@UserId = @WsOwner)
    BEGIN SELECT 400 AS ResponseCode,
                 'Use ownership transfer to change the workspace owner' AS ResponseMess; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM dbo.tblWorkspaceMembers
                    WHERE WorkspaceId = @WorkspaceId AND UserId = @UserId
                      AND IsActive = 1 AND InviteStatus = 'active')
    BEGIN SELECT 404 AS ResponseCode,
                 'That person is not an active member of this workspace' AS ResponseMess; RETURN; END

    -- Role ONLY. Invite state is deliberately untouched (see header).
    UPDATE dbo.tblWorkspaceMembers
       SET Role = @Role
     WHERE WorkspaceId = @WorkspaceId AND UserId = @UserId;

    SELECT 200 AS ResponseCode, 'Role updated' AS ResponseMess,
           @WorkspaceId AS WorkspaceId, @UserId AS UserId, @Role AS Role;
END
GO

-- =============================================================================
-- Verify after apply
-- =============================================================================
-- 1. Proc exists:
--
-- SELECT CASE WHEN COUNT(*) = 1 THEN 'OK - 065 applied' ELSE 'NOT APPLIED' END AS Status
-- FROM sys.objects WHERE name = 'sp_SetWorkspaceMemberRole' AND type = 'P';
--
-- 2. Demote a member to viewer WITHOUT re-inviting them — the whole point.
--    Workspace 10011: Raaj(3) is owner, Vikash(11) is a member.
--
-- BEGIN TRAN;
--   EXEC sp_SetWorkspaceMemberRole @WorkspaceId=10011, @UserId=11,
--        @Role='viewer', @ActingUserId=3, @IsAdmin=0, @CompId=1;
--   -- expect 200 'Role updated'
--   SELECT Role, InviteStatus, IsActive, RespondedDate
--     FROM tblWorkspaceMembers WHERE WorkspaceId=10011 AND UserId=11;
--   -- expect viewer / active / 1 / RespondedDate unchanged (NOT reset to pending)
-- ROLLBACK TRAN;
--
-- 3. A viewer really is read-only on tasks:
--
-- BEGIN TRAN;
--   EXEC sp_SetWorkspaceMemberRole @WorkspaceId=10011, @UserId=11,
--        @Role='viewer', @ActingUserId=3, @IsAdmin=0, @CompId=1;
--   EXEC sp_CheckTaskPermission @TaskId=10030, @UserId=11, @Action='view_task',   @IsAdmin=0, @CompId=1;
--   -- expect Allowed = 1
--   EXEC sp_CheckTaskPermission @TaskId=10030, @UserId=11, @Action='create_task', @IsAdmin=0, @CompId=1;
--   EXEC sp_CheckTaskPermission @TaskId=10030, @UserId=11, @Action='manage_checklist', @IsAdmin=0, @CompId=1;
--   -- expect Allowed = 0 for both
-- ROLLBACK TRAN;
--
-- 4. Guards:
--
-- EXEC sp_SetWorkspaceMemberRole @WorkspaceId=10011, @UserId=3,  @Role='member', @ActingUserId=3, @IsAdmin=0, @CompId=1;
-- -- expect 400 'Use ownership transfer...' (3 is the owner)
-- EXEC sp_SetWorkspaceMemberRole @WorkspaceId=10011, @UserId=11, @Role='owner',  @ActingUserId=3, @IsAdmin=0, @CompId=1;
-- -- expect 400 'Role must be manager, member or viewer'
-- EXEC sp_SetWorkspaceMemberRole @WorkspaceId=10011, @UserId=11, @Role='viewer', @ActingUserId=11, @IsAdmin=0, @CompId=1;
-- -- expect 403 (a member cannot change roles)
-- =============================================================================
