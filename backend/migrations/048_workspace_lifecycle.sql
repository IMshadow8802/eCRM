-- 048_workspace_lifecycle.sql
-- ============================================================================
-- Workspace lifecycle, complete: convert personal->shared, archive rules,
-- delete with full cascade, save gating, ownership transfer, project sync.
-- CRM is pre-production: NO backward-compat shims — new required params break
-- old callers on purpose; backend deploys together with this script.
--
-- INVARIANT (tested backend-side): no admin ever reads or mutates another
-- user's personal workspace while its owner is an ACTIVE user. The single
-- carve-out: owner deactivated -> admin may archive, then delete (no immortal
-- workspaces of departed users).
--
-- Contents
--   1. sp_ConvertWorkspaceToShared      (NEW)  sharing IS the conversion
--   2. sp_ArchiveWorkspace              (CHG)  owner-or-admin, personal=owner-only
--   3. sp_DeleteWorkspace               (NEW)  archived-only, dry-run, cascade
--   4. sp_SaveWorkspace                 (CHG)  update path now permission-gated
--   5. sp_TransferWorkspaceOwnership    (NEW)  shared/project only
--   6. sp_SyncProjectWorkspaceMembers   (NEW)  manual snapshot refresh
--
-- (Self-leave needs no SP change — sp_RemoveWorkspaceMember already allows
-- acting==target; the web just never offered the button.)
-- ============================================================================
USE [eCRM+];
GO

-- ---------------------------------------------------------------------------
-- 1. sp_ConvertWorkspaceToShared — one-way personal -> shared
-- ---------------------------------------------------------------------------
-- Owner-only (strictly: not even admin — it is their private space until THEY
-- open it). Flips Type and invites colleagues in one transaction. After this
-- the admin bypass in sp_CheckTaskPermission applies — the confirm dialog in
-- the web must state both exposures (invitees + admins).
CREATE OR ALTER PROCEDURE dbo.sp_ConvertWorkspaceToShared
    @WorkspaceId  BIGINT,
    @ActingUserId INT,
    @MembersJson  NVARCHAR(MAX) = NULL,  -- JSON array of UserIds to invite
    @CompId       BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);
    DECLARE @WsType VARCHAR(20), @WsOwner INT, @WsCompId BIGINT, @WsArchived BIT;

    SELECT @WsType = Type, @WsOwner = OwnerUserId,
           @WsCompId = CompId, @WsArchived = IsArchived
      FROM dbo.tblWorkspaces WHERE Id = @WorkspaceId;

    IF (@WsType IS NULL)
    BEGIN SELECT 404 AS ResponseCode, 'Workspace not found' AS ResponseMess; RETURN; END
    IF (@WsCompId <> @CompId)
    BEGIN SELECT 403 AS ResponseCode, 'Cross-company access denied' AS ResponseMess; RETURN; END
    IF (@WsType <> 'personal')
    BEGIN SELECT 400 AS ResponseCode, 'Only a personal workspace can be shared' AS ResponseMess; RETURN; END
    IF (@WsOwner <> @ActingUserId)
    BEGIN SELECT 403 AS ResponseCode, 'Only the owner can share their personal workspace' AS ResponseMess; RETURN; END
    IF (@WsArchived = 1)
    BEGIN SELECT 400 AS ResponseCode, 'Unarchive the workspace before sharing it' AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;

        UPDATE dbo.tblWorkspaces
           SET Type = 'shared', UpdatedDate = GETDATE()
         WHERE Id = @WorkspaceId;

        IF (@MembersJson IS NOT NULL AND @MembersJson <> '')
        BEGIN
            ;WITH ids AS (
                SELECT DISTINCT CAST(value AS INT) AS UserId FROM OPENJSON(@MembersJson)
            )
            INSERT INTO dbo.tblWorkspaceMembers
                (WorkspaceId, UserId, Role, AddedByUserId, IsActive, InviteStatus, InvitedDate)
            SELECT @WorkspaceId, i.UserId, 'member', @ActingUserId, 1, 'pending', GETDATE()
              FROM ids i
             WHERE i.UserId <> @ActingUserId
               AND EXISTS (SELECT 1 FROM dbo.tblUser u WHERE u.Id = i.UserId AND u.IsActive = 1)
               AND NOT EXISTS (SELECT 1 FROM dbo.tblWorkspaceMembers m
                                WHERE m.WorkspaceId = @WorkspaceId AND m.UserId = i.UserId);
        END

        COMMIT TRANSACTION;
        SELECT 200 AS ResponseCode, 'Workspace shared' AS ResponseMess,
               @WorkspaceId AS WorkspaceId;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT 500 AS ResponseCode, 'Share failed: ' + ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

-- ---------------------------------------------------------------------------
-- 2. sp_ArchiveWorkspace — owner-or-admin; personal = owner-only (carve-out:
--    owner deactivated -> admin may act)
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_ArchiveWorkspace
    @WorkspaceId    BIGINT,
    @IsArchived     BIT,
    @ActingUserId   INT,
    @IsAdmin        BIT = 0,
    @CompId         BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @WsType VARCHAR(20), @WsOwner INT, @WsCompId BIGINT, @OwnerActive BIT;

    SELECT @WsType = w.Type, @WsOwner = w.OwnerUserId, @WsCompId = w.CompId,
           @OwnerActive = u.IsActive
      FROM dbo.tblWorkspaces w
      LEFT JOIN dbo.tblUser u ON u.Id = w.OwnerUserId
     WHERE w.Id = @WorkspaceId;

    IF (@WsOwner IS NULL)
    BEGIN SELECT 404 AS ResponseCode, 'Workspace not found' AS ResponseMess; RETURN; END
    IF (@WsCompId <> @CompId)
    BEGIN SELECT 403 AS ResponseCode, 'Cross-company access denied' AS ResponseMess; RETURN; END

    -- Personal stays private from admins while its owner is active.
    IF (@WsType = 'personal')
    BEGIN
        IF (@WsOwner <> @ActingUserId AND NOT (@IsAdmin = 1 AND ISNULL(@OwnerActive, 0) = 0))
        BEGIN SELECT 403 AS ResponseCode, 'Personal workspaces can only be archived by their owner' AS ResponseMess; RETURN; END
    END
    ELSE IF (@IsAdmin <> 1 AND @WsOwner <> @ActingUserId)
    BEGIN SELECT 403 AS ResponseCode, 'Only owner or admin can archive/unarchive' AS ResponseMess; RETURN; END

    UPDATE dbo.tblWorkspaces
       SET IsArchived = @IsArchived, UpdatedDate = GETDATE()
     WHERE Id = @WorkspaceId;

    SELECT 200 AS ResponseCode,
           CASE WHEN @IsArchived = 1 THEN 'Workspace archived' ELSE 'Workspace unarchived' END AS ResponseMess,
           @WorkspaceId AS WorkspaceId, @IsArchived AS IsArchived;
END
GO

-- ---------------------------------------------------------------------------
-- 3. sp_DeleteWorkspace — archived-only, dry-run for blast radius, full
--    cascade in one transaction
-- ---------------------------------------------------------------------------
-- @DryRun = 1: counts only (the confirm dialog's blast radius), no writes.
-- @DryRun = 0: cascade delete. Result set 1 = status + counts. Result set 2 =
-- (Entity, StoredName) of deleted attachments — SQL cannot unlink files, the
-- controller does that AFTER commit, best-effort (DB is the source of truth).
CREATE OR ALTER PROCEDURE dbo.sp_DeleteWorkspace
    @WorkspaceId  BIGINT,
    @ActingUserId INT,
    @IsAdmin      BIT = 0,
    @CompId       BIGINT,
    @DryRun       BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @WsType VARCHAR(20), @WsOwner INT, @WsCompId BIGINT,
            @WsArchived BIT, @OwnerActive BIT;

    SELECT @WsType = w.Type, @WsOwner = w.OwnerUserId, @WsCompId = w.CompId,
           @WsArchived = w.IsArchived, @OwnerActive = u.IsActive
      FROM dbo.tblWorkspaces w
      LEFT JOIN dbo.tblUser u ON u.Id = w.OwnerUserId
     WHERE w.Id = @WorkspaceId;

    IF (@WsOwner IS NULL)
    BEGIN SELECT 404 AS ResponseCode, 'Workspace not found' AS ResponseMess; RETURN; END
    IF (@WsCompId <> @CompId)
    BEGIN SELECT 403 AS ResponseCode, 'Cross-company access denied' AS ResponseMess; RETURN; END

    -- Two-step rule: only an archived workspace can be deleted. The archive
    -- step IS the cooling-off period.
    IF (@WsArchived <> 1)
    BEGIN SELECT 400 AS ResponseCode, 'Archive the workspace before deleting it' AS ResponseMess; RETURN; END

    IF (@WsType = 'personal')
    BEGIN
        IF (@WsOwner <> @ActingUserId AND NOT (@IsAdmin = 1 AND ISNULL(@OwnerActive, 0) = 0))
        BEGIN SELECT 403 AS ResponseCode, 'Personal workspaces can only be deleted by their owner' AS ResponseMess; RETURN; END
    END
    ELSE IF (@IsAdmin <> 1 AND @WsOwner <> @ActingUserId)
    BEGIN SELECT 403 AS ResponseCode, 'Only owner or admin can delete a workspace' AS ResponseMess; RETURN; END

    -- Blast radius, computed here (never trusted from the client).
    DECLARE @TaskIds TABLE (Id BIGINT PRIMARY KEY);
    INSERT INTO @TaskIds SELECT Id FROM dbo.tblTasks WHERE WorkspaceId = @WorkspaceId;

    DECLARE @TaskCount INT = (SELECT COUNT(*) FROM @TaskIds);
    DECLARE @CommentCount INT =
        (SELECT COUNT(*) FROM dbo.tblTaskComments WHERE TaskId IN (SELECT Id FROM @TaskIds));
    DECLARE @AttachmentCount INT =
        (SELECT COUNT(*) FROM dbo.tblAttachment
          WHERE CompId = @CompId AND Entity = 'task'
            AND EntityId IN (SELECT Id FROM @TaskIds));
    DECLARE @MemberCount INT =
        (SELECT COUNT(*) FROM dbo.tblWorkspaceMembers WHERE WorkspaceId = @WorkspaceId);

    IF (@DryRun = 1)
    BEGIN
        SELECT 200 AS ResponseCode, 'Dry run' AS ResponseMess,
               @WorkspaceId AS WorkspaceId,
               @TaskCount AS TaskCount, @CommentCount AS CommentCount,
               @AttachmentCount AS AttachmentCount, @MemberCount AS MemberCount;
        -- Empty file list keeps the result-set shape identical in both modes.
        SELECT Entity, StoredName FROM dbo.tblAttachment WHERE 1 = 0;
        RETURN;
    END

    BEGIN TRY
        BEGIN TRANSACTION;

        -- Capture the files BEFORE their rows die (result set 2, post-commit).
        DECLARE @Files TABLE (Entity VARCHAR(20), StoredName VARCHAR(300));
        INSERT INTO @Files
        SELECT Entity, StoredName FROM dbo.tblAttachment
         WHERE CompId = @CompId AND Entity = 'task'
           AND EntityId IN (SELECT Id FROM @TaskIds);

        -- Children first, then tasks, then workspace fixtures, then the row.
        DELETE FROM dbo.tblTaskReads        WHERE TaskId IN (SELECT Id FROM @TaskIds);
        DELETE FROM dbo.tblTaskComments     WHERE TaskId IN (SELECT Id FROM @TaskIds);
        DELETE FROM dbo.tblTaskChecklist    WHERE TaskId IN (SELECT Id FROM @TaskIds);
        DELETE FROM dbo.tblTaskDependencies WHERE TaskId       IN (SELECT Id FROM @TaskIds)
                                               OR DependsOnTaskId IN (SELECT Id FROM @TaskIds);
        DELETE FROM dbo.tblTimeEntries      WHERE TaskId IN (SELECT Id FROM @TaskIds);
        DELETE FROM dbo.tblAttachment       WHERE CompId = @CompId AND Entity = 'task'
                                              AND EntityId IN (SELECT Id FROM @TaskIds);
        DELETE FROM dbo.tblTasks            WHERE Id IN (SELECT Id FROM @TaskIds);
        DELETE FROM dbo.tblKanbanColumns    WHERE WorkspaceId = @WorkspaceId;
        DELETE FROM dbo.tblWorkspaceMembers WHERE WorkspaceId = @WorkspaceId;
        DELETE FROM dbo.tblWorkspaces       WHERE Id = @WorkspaceId;

        COMMIT TRANSACTION;

        SELECT 200 AS ResponseCode, 'Workspace deleted' AS ResponseMess,
               @WorkspaceId AS WorkspaceId,
               @TaskCount AS TaskCount, @CommentCount AS CommentCount,
               @AttachmentCount AS AttachmentCount, @MemberCount AS MemberCount;
        SELECT Entity, StoredName FROM @Files;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT 500 AS ResponseCode, 'Delete failed: ' + ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

-- ---------------------------------------------------------------------------
-- 4. sp_SaveWorkspace — update path permission-gated (create path unchanged)
-- ---------------------------------------------------------------------------
-- Pre-production: @ActingUserId is REQUIRED, no compat default. Update allowed
-- for: admin, workspace owner, or an active 'owner'/'manager' member —
-- except personal, which only its owner may edit.
CREATE OR ALTER PROCEDURE dbo.sp_SaveWorkspace
    @Id            BIGINT       = 0,
    @Name          VARCHAR(200),
    @Type          VARCHAR(20),
    @OwnerUserId   INT,
    @TeamId        INT          = NULL,
    @ProjectId     INT          = NULL,
    @Color         VARCHAR(20)  = NULL,
    @Icon          VARCHAR(40)  = NULL,
    @MembersJson   NVARCHAR(MAX) = NULL,
    @CompId        BIGINT,
    @BranchId      BIGINT,
    @ActingUserId  INT,
    @IsAdmin       BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);

    IF (@Name IS NULL OR LTRIM(RTRIM(@Name)) = '')
    BEGIN SELECT 400 AS ResponseCode, 'Workspace name is required' AS ResponseMess; RETURN; END

    IF (@Type NOT IN ('personal','shared','project'))
    BEGIN SELECT 400 AS ResponseCode, 'Invalid workspace type' AS ResponseMess; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Id = @OwnerUserId AND IsActive = 1)
    BEGIN SELECT 400 AS ResponseCode, 'Invalid owner user' AS ResponseMess; RETURN; END

    IF (@Type = 'project' AND (@ProjectId IS NULL OR @ProjectId <= 0))
    BEGIN SELECT 400 AS ResponseCode, 'Project workspace requires a ProjectId' AS ResponseMess; RETURN; END

    IF (@ProjectId IS NOT NULL AND @ProjectId > 0
        AND NOT EXISTS (SELECT 1 FROM dbo.tblProjects WHERE Id = @ProjectId))
    BEGIN SELECT 400 AS ResponseCode, 'Invalid project reference' AS ResponseMess; RETURN; END

    IF (@Type = 'project')
        SELECT @TeamId = TeamId FROM dbo.tblProjects WHERE Id = @ProjectId;

    IF (@TeamId IS NOT NULL AND @TeamId > 0
        AND NOT EXISTS (SELECT 1 FROM dbo.tblTeams WHERE Id = @TeamId AND IsActive = 1))
    BEGIN SELECT 400 AS ResponseCode, 'Invalid team reference' AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;

        IF (@Id = 0)
        BEGIN
            INSERT INTO dbo.tblWorkspaces
                (Name, Type, OwnerUserId, TeamId, ProjectId, IsArchived,
                 Color, Icon, CompId, BranchId)
            VALUES
                (@Name, @Type, @OwnerUserId, @TeamId, @ProjectId, 0,
                 @Color, @Icon, @CompId, @BranchId);

            DECLARE @NewId BIGINT = SCOPE_IDENTITY();

            INSERT INTO dbo.tblWorkspaceMembers
                (WorkspaceId, UserId, Role, AddedByUserId, IsActive, InviteStatus)
            VALUES
                (@NewId, @OwnerUserId, 'owner', @OwnerUserId, 1, 'active');

            IF (@Type = 'shared' AND @MembersJson IS NOT NULL AND @MembersJson <> '')
            BEGIN
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
                       @OwnerUserId, 1, 'active'
                  FROM teamUsers u
                 WHERE u.UserId <> @OwnerUserId
                   AND EXISTS (SELECT 1 FROM dbo.tblUser uu WHERE uu.Id = u.UserId AND uu.IsActive = 1);
            END

            COMMIT TRANSACTION;
            SELECT 201 AS ResponseCode, 'Workspace created' AS ResponseMess,
                   @NewId AS WorkspaceId;
        END
        ELSE
        BEGIN
            DECLARE @WsType VARCHAR(20), @WsOwner INT, @ActingRole VARCHAR(20);
            SELECT @WsType = Type, @WsOwner = OwnerUserId
              FROM dbo.tblWorkspaces WHERE Id = @Id AND CompId = @CompId;

            IF (@WsType IS NULL)
            BEGIN
                ROLLBACK TRANSACTION;
                SELECT 404 AS ResponseCode, 'Workspace not found' AS ResponseMess; RETURN;
            END

            SELECT @ActingRole = Role
              FROM dbo.tblWorkspaceMembers
             WHERE WorkspaceId = @Id AND UserId = @ActingUserId
               AND IsActive = 1 AND InviteStatus = 'active';

            -- Personal: owner only, admin excluded. Others: admin/owner/manager.
            IF (@WsType = 'personal' AND @WsOwner <> @ActingUserId)
            BEGIN
                ROLLBACK TRANSACTION;
                SELECT 403 AS ResponseCode, 'Only the owner can edit a personal workspace' AS ResponseMess; RETURN;
            END
            IF (@WsType <> 'personal' AND @IsAdmin <> 1 AND @WsOwner <> @ActingUserId
                AND ISNULL(@ActingRole, '') NOT IN ('owner','manager'))
            BEGIN
                ROLLBACK TRANSACTION;
                SELECT 403 AS ResponseCode, 'Not allowed to edit this workspace' AS ResponseMess; RETURN;
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
            SELECT 200 AS ResponseCode, 'Workspace updated' AS ResponseMess,
                   @Id AS WorkspaceId;
        END
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT 500 AS ResponseCode, 'Save failed: ' + ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

-- ---------------------------------------------------------------------------
-- 5. sp_TransferWorkspaceOwnership — shared/project only
-- ---------------------------------------------------------------------------
-- Acting must be current owner or admin. New owner must be an ACTIVE member
-- and an active user. Roles swap: new owner -> 'owner', old owner -> 'manager'
-- (they stay in the workspace; leaving afterwards is their choice).
CREATE OR ALTER PROCEDURE dbo.sp_TransferWorkspaceOwnership
    @WorkspaceId    BIGINT,
    @NewOwnerUserId INT,
    @ActingUserId   INT,
    @IsAdmin        BIT = 0,
    @CompId         BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @WsType VARCHAR(20), @WsOwner INT, @WsCompId BIGINT;

    SELECT @WsType = Type, @WsOwner = OwnerUserId, @WsCompId = CompId
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

-- ---------------------------------------------------------------------------
-- 6. sp_SyncProjectWorkspaceMembers — manual snapshot refresh
-- ---------------------------------------------------------------------------
-- Project workspaces snapshot the team at creation; team changes never flow
-- in automatically (predictability over spookiness). This is the explicit
-- "Sync from team" button: adds active team members that are missing,
-- deactivates plain members who left the team. Owner and manager rows are
-- never touched. Acting must be admin, owner, or manager.
CREATE OR ALTER PROCEDURE dbo.sp_SyncProjectWorkspaceMembers
    @WorkspaceId  BIGINT,
    @ActingUserId INT,
    @IsAdmin      BIT = 0,
    @CompId       BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @WsType VARCHAR(20), @WsOwner INT, @WsCompId BIGINT,
            @WsTeamId INT, @ActingRole VARCHAR(20);

    SELECT @WsType = Type, @WsOwner = OwnerUserId, @WsCompId = CompId, @WsTeamId = TeamId
      FROM dbo.tblWorkspaces WHERE Id = @WorkspaceId;

    IF (@WsType IS NULL)
    BEGIN SELECT 404 AS ResponseCode, 'Workspace not found' AS ResponseMess; RETURN; END
    IF (@WsCompId <> @CompId)
    BEGIN SELECT 403 AS ResponseCode, 'Cross-company access denied' AS ResponseMess; RETURN; END
    IF (@WsType <> 'project')
    BEGIN SELECT 400 AS ResponseCode, 'Only project workspaces sync from a team' AS ResponseMess; RETURN; END
    IF (@WsTeamId IS NULL OR @WsTeamId <= 0)
    BEGIN SELECT 400 AS ResponseCode, 'Workspace has no linked team' AS ResponseMess; RETURN; END

    SELECT @ActingRole = Role
      FROM dbo.tblWorkspaceMembers
     WHERE WorkspaceId = @WorkspaceId AND UserId = @ActingUserId
       AND IsActive = 1 AND InviteStatus = 'active';

    IF (@IsAdmin <> 1 AND @WsOwner <> @ActingUserId AND ISNULL(@ActingRole,'') <> 'manager')
    BEGIN SELECT 403 AS ResponseCode, 'Only owner, manager or admin can sync members' AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @Added INT = 0, @Deactivated INT = 0;

        -- Team members missing from the workspace: add (or reactivate).
        ;WITH team AS (
            SELECT tm.UserId FROM dbo.tblTeamMembers tm
             WHERE tm.TeamId = @WsTeamId AND tm.IsActive = 1
        )
        MERGE dbo.tblWorkspaceMembers AS tgt
        USING (SELECT t.UserId FROM team t
                WHERE EXISTS (SELECT 1 FROM dbo.tblUser u WHERE u.Id = t.UserId AND u.IsActive = 1)
              ) AS src
           ON tgt.WorkspaceId = @WorkspaceId AND tgt.UserId = src.UserId
        WHEN MATCHED AND tgt.IsActive = 0 THEN
            UPDATE SET IsActive = 1, InviteStatus = 'active', RespondedDate = GETDATE()
        WHEN NOT MATCHED THEN
            INSERT (WorkspaceId, UserId, Role, AddedByUserId, IsActive, InviteStatus)
            VALUES (@WorkspaceId, src.UserId, 'member', @ActingUserId, 1, 'active');
        SET @Added = @@ROWCOUNT;

        -- Plain members no longer on the team: deactivate. Owner/manager kept.
        UPDATE m
           SET m.IsActive = 0, m.InviteStatus = 'removed', m.RespondedDate = GETDATE()
          FROM dbo.tblWorkspaceMembers m
         WHERE m.WorkspaceId = @WorkspaceId
           AND m.IsActive = 1
           AND m.Role = 'member'
           AND NOT EXISTS (SELECT 1 FROM dbo.tblTeamMembers tm
                            WHERE tm.TeamId = @WsTeamId AND tm.UserId = m.UserId AND tm.IsActive = 1);
        SET @Deactivated = @@ROWCOUNT;

        COMMIT TRANSACTION;
        SELECT 200 AS ResponseCode, 'Members synced' AS ResponseMess,
               @WorkspaceId AS WorkspaceId, @Added AS MembersAddedOrRestored,
               @Deactivated AS MembersDeactivated;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT 500 AS ResponseCode, 'Sync failed: ' + ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

-- ============================================================================
-- VERIFY AFTER APPLY
-- ============================================================================
-- 1. All six SPs present with the expected params.
SELECT p.name, STRING_AGG(par.name, ', ') WITHIN GROUP (ORDER BY par.parameter_id) AS Params
  FROM sys.procedures p LEFT JOIN sys.parameters par ON par.object_id = p.object_id
 WHERE p.name IN ('sp_ConvertWorkspaceToShared','sp_ArchiveWorkspace','sp_DeleteWorkspace',
                  'sp_SaveWorkspace','sp_TransferWorkspaceOwnership','sp_SyncProjectWorkspaceMembers')
 GROUP BY p.name ORDER BY p.name;

-- 2. Personal privacy: admin (UserId 1) must be refused on Raaj's personal
--    workspace (10007, owner 3 active) — expect 403.
EXEC dbo.sp_ArchiveWorkspace @WorkspaceId = 10007, @IsArchived = 1,
     @ActingUserId = 1, @IsAdmin = 1, @CompId = 1;

-- 3. Delete refuses a non-archived workspace — expect 400.
EXEC dbo.sp_DeleteWorkspace @WorkspaceId = 10007, @ActingUserId = 3,
     @IsAdmin = 0, @CompId = 1, @DryRun = 0;

-- 4. Dry-run blast radius on the shared PRD workspace (10006) as admin —
--    expect 200 + counts (1 task) + empty file list.
EXEC dbo.sp_DeleteWorkspace @WorkspaceId = 10006, @ActingUserId = 2,
     @IsAdmin = 1, @CompId = 1, @DryRun = 1;
-- NOTE: 10006 is NOT archived, so this returns 400 — which also proves the
-- archived-only rule. Archive it first if you want to see real counts.

-- 5. Convert refuses non-owners — expect 403 (Ayush is not the owner of 10007).
EXEC dbo.sp_ConvertWorkspaceToShared @WorkspaceId = 10007, @ActingUserId = 2, @CompId = 1;
