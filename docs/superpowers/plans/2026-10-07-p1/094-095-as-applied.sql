-- =============================================================================
-- 094-095-as-applied.sql
--
-- Record of 094_task_people_foundation.sql + 095_time_logging_live.sql as
-- applied to eCRM+ and SolarCRM on 2026-10-07, rebuilt from the live
-- definitions because the script files were deleted before commit; procedure
-- bodies are byte-exact from OBJECT_DEFINITION; schema/data steps are
-- described, not replayed.
--
-- Rebuilt 2026-10-07 from eCRM+ (read-only). Every body below was hash-checked
-- against the live definition (SHA-256, CR removed, UTF-16LE): 34/34 match
-- except for the CREATE -> CREATE OR ALTER substitution on the first line of
-- each CREATE statement.
-- 34 procedures: 33 from 094 (5 of them NEW: sp_UnassignInvalidAssignees,
-- sp_ClaimTask, sp_NotifyTaskCompletion, sp_FetchUserHandover,
-- sp_FetchPersonManagers) and sp_SaveTimeEntry from 095.
-- =============================================================================
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- =============================================================================
-- Schema and data steps (not replayable from this file)
-- Sources: p1-ledger-final.md, p1-A-tasks.md (A1, A2), p1-B-notify.md (B4, B7).
-- "Live" = checked against eCRM+ on 2026-10-07 after the apply.
--
-- A1. tblTasks soft delete (094)
--     Columns added: IsDeleted BIT NOT NULL DEFAULT 0, DeletedAt DATETIME NULL,
--     DeletedBy INT NULL.
--     Live: all three present with exactly those types/nullability/default.
--     0 soft-deleted tasks at apply time.
--
-- A2. Step backfill + board/completion card backfill (094)
--     (a) Every task that had no checklist step got one step, so completion
--         ("all steps done", sp_RecomputeTaskCompletion) is always reachable.
--         Live: 0 non-deleted tasks without a step.
--     (b) Board = completion (ruling R7): completed cards moved to their
--         board's last active column, open cards out of the last column
--         (multi-column boards only). Not safely re-runnable after go-live.
--         Live: 22 completed tasks; ledger check "board = completion (0/0)".
--
-- B4. Comment-notification backfill (094)
--     Existing comment_added / reply notifications re-pointed to
--     EntityType = 'task' (EntityId = the task), so a click opens the task.
--     Live: 0 comment_added/reply rows with EntityType <> 'task'; 22 with 'task'.
--
-- B7. "Seen" stamps (094)
--     tblTaskReads gained FirstSeenAt / LastSeenAt (written by sp_FetchTask).
--     Live: both columns present.
--
-- My Work menu (094)
--     tblMenu row Id 49: ParentId 0, Description 'My Work', MenuType 1,
--     OpenStyle 1, Route '/my-work', IsAllowed 1.
--     tblGroupAccess: CanView = 1 (Add/Edit/Delete = 0) for every group.
--     Live: 12 grants (Ids 816-827, GroupIds 1,2,9-17,27) = all 12 groups.
--     Menu rights load at login: users re-login to see it.
--
-- 095. sp_SaveTimeEntry only (the proc from backend/migrations/062, which had
--     never been applied: live proc lacked @IsAdmin, logTaskTime 500'd).
--     No schema/data change. tblTimeEntries had 0 rows before.
-- =============================================================================


-- ===========================================================================
-- A3. sp_CheckTaskPermission — a deleted task permits nothing (item 1)
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- 3. sp_CheckTaskPermission
--
--    * assignment resolves from the SET, not the column
--    * new actions manage_checklist / manage_attachments — the "work artifacts"
--      class: the person doing the work decides the steps and holds the
--      evidence, but that confers no definition rights
--    * change_status and log_time consult the set
--    * an assigned viewer may progress but not manage artifacts
--    * delete_task: a creator may only delete an UNTOUCHED task (no other
--      assignee, no comments by anyone else) — once others have contributed it
--      is an owner/manager decision
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_CheckTaskPermission
    @TaskId       BIGINT        = NULL,
    @WorkspaceId  BIGINT        = NULL,
    @CommentId    BIGINT        = NULL,
    @UserId       INT,
    @Action       VARCHAR(50),
    @IsAdmin      BIT           = 0,
    @CompId       BIGINT        = 1
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Allowed BIT = 0;
    DECLARE @Reason VARCHAR(400) = 'denied';

    DECLARE @TaskWorkspaceId   BIGINT;
    DECLARE @TaskCreatedBy     INT;
    DECLARE @IsAssignee        BIT = 0;
    DECLARE @CommentAuthorId   INT;
    DECLARE @CommentTaskId     BIGINT;
    DECLARE @WsType            VARCHAR(20);
    DECLARE @WsOwner           INT;
    DECLARE @WsCompId          BIGINT;
    DECLARE @Role              VARCHAR(20);

    -- Resolve task context, if any
    IF (@TaskId IS NOT NULL AND @TaskId > 0)
    BEGIN
        SELECT @TaskWorkspaceId = WorkspaceId,
               @TaskCreatedBy   = CreatedByUserId
          FROM dbo.tblTasks
         WHERE Id = @TaskId;

        IF EXISTS (SELECT 1 FROM dbo.tblTaskAssignee
                    WHERE TaskId = @TaskId AND UserId = @UserId)
            SET @IsAssignee = 1;

        IF (@TaskWorkspaceId IS NOT NULL AND @WorkspaceId IS NULL)
            SET @WorkspaceId = @TaskWorkspaceId;
    END

    -- Resolve comment context, if any
    IF (@CommentId IS NOT NULL AND @CommentId > 0)
    BEGIN
        SELECT @CommentAuthorId = UserId,
               @CommentTaskId   = TaskId
          FROM dbo.tblTaskComments
         WHERE Id = @CommentId;

        IF (@TaskId IS NULL AND @CommentTaskId IS NOT NULL)
        BEGIN
            SET @TaskId = @CommentTaskId;
            SELECT @TaskWorkspaceId = WorkspaceId,
                   @TaskCreatedBy   = CreatedByUserId
              FROM dbo.tblTasks
             WHERE Id = @TaskId;

            IF EXISTS (SELECT 1 FROM dbo.tblTaskAssignee
                        WHERE TaskId = @TaskId AND UserId = @UserId)
                SET @IsAssignee = 1;

            IF (@WorkspaceId IS NULL) SET @WorkspaceId = @TaskWorkspaceId;
        END
    END

    -- A soft-deleted task is gone for every action (094).
    IF (@TaskId IS NOT NULL AND @TaskId > 0
        AND EXISTS (SELECT 1 FROM dbo.tblTasks WHERE Id = @TaskId AND IsDeleted = 1))
    BEGIN
        SELECT 0 AS Allowed, 'task deleted' AS Reason;
        RETURN;
    END

    -- Workspace must be present for any decision
    IF (@WorkspaceId IS NULL OR @WorkspaceId <= 0)
    BEGIN
        SELECT 0 AS Allowed, 'workspace context required' AS Reason;
        RETURN;
    END

    SELECT @WsType   = Type,
           @WsOwner  = OwnerUserId,
           @WsCompId = CompId
      FROM dbo.tblWorkspaces
     WHERE Id = @WorkspaceId;

    IF (@WsType IS NULL)
    BEGIN
        SELECT 0 AS Allowed, 'workspace not found' AS Reason;
        RETURN;
    END

    -- Company isolation
    IF (@WsCompId <> @CompId)
    BEGIN
        SELECT 0 AS Allowed, 'cross-company access denied' AS Reason;
        RETURN;
    END

    -- Personal workspaces: owner-only, admin is explicitly blocked
    IF (@WsType = 'personal')
    BEGIN
        IF (@WsOwner = @UserId)
        BEGIN SET @Allowed = 1; SET @Reason = 'personal owner'; END
        ELSE
        BEGIN SET @Allowed = 0; SET @Reason = 'personal workspaces are private'; END

        SELECT @Allowed AS Allowed, @Reason AS Reason; RETURN;
    END

    -- Admin bypass for non-personal workspaces (same company)
    IF (@IsAdmin = 1)
    BEGIN
        SELECT 1 AS Allowed, 'admin bypass' AS Reason; RETURN;
    END

    -- Resolve member role (NULL = not a member). Only 'active' counts: IsActive
    -- is set when the invite is SENT and a decline never clears it. (061)
    SELECT @Role = Role
      FROM dbo.tblWorkspaceMembers
     WHERE WorkspaceId = @WorkspaceId
       AND UserId = @UserId
       AND IsActive = 1
       AND InviteStatus = 'active';

    IF (@Role IS NULL)
    BEGIN
        SELECT 0 AS Allowed, 'not a workspace member' AS Reason; RETURN;
    END

    -- Per-action rules
    IF (@Action IN ('view_task', 'comment', 'reply'))
        SET @Allowed = 1;

    ELSE IF (@Action = 'create_task')
        SET @Allowed = CASE WHEN @Role IN ('owner','manager','member') THEN 1 ELSE 0 END;

    -- Progress: doing the work you were handed. Assignment grants it, so any
    -- member OR viewer who is on the task can move it along. (063)
    ELSE IF (@Action IN ('change_status', 'log_time'))
    BEGIN
        IF (@Role IN ('owner','manager')) SET @Allowed = 1;
        ELSE IF (@IsAssignee = 1) SET @Allowed = 1;
        ELSE IF (@Role = 'member' AND @TaskCreatedBy = @UserId) SET @Allowed = 1;
    END

    -- Work artifacts: the checklist steps and the documents that evidence them.
    -- Assignees own these — a step routinely needs a file against it. A viewer
    -- does NOT, even when assigned: viewer stays genuinely limited, which is
    -- the role an external client gets. (063)
    ELSE IF (@Action IN ('manage_checklist', 'manage_attachments'))
    BEGIN
        IF (@Role IN ('owner','manager')) SET @Allowed = 1;
        ELSE IF (@Role = 'member' AND (@IsAssignee = 1 OR @TaskCreatedBy = @UserId))
            SET @Allowed = 1;
    END

    -- Definition: deciding what the work IS. Creator or owner/manager only —
    -- being assigned does not let you redefine the task.
    ELSE IF (@Action IN ('edit_fields', 'reassign', 'add_dependency'))
    BEGIN
        IF (@Role IN ('owner','manager')) SET @Allowed = 1;
        ELSE IF (@Role = 'member' AND @TaskCreatedBy = @UserId) SET @Allowed = 1;
    END

    -- Claiming an UNASSIGNED task needs no permission beyond membership — that
    -- is what stops assignment becoming the new bottleneck. Claiming one that
    -- already has assignees is a reassignment and routes to edit_fields above.
    ELSE IF (@Action = 'claim_task')
    BEGIN
        IF (@Role IN ('owner','manager','member')
            AND NOT EXISTS (SELECT 1 FROM dbo.tblTaskAssignee WHERE TaskId = @TaskId))
            SET @Allowed = 1;
    END

    -- A creator may delete only while the task is still just theirs. Once
    -- someone else is assigned or has commented it carries other people's work,
    -- and deleting becomes an owner/manager call. (063)
    ELSE IF (@Action = 'delete_task')
    BEGIN
        IF (@Role IN ('owner','manager')) SET @Allowed = 1;
        ELSE IF (@Role = 'member' AND @TaskCreatedBy = @UserId)
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM dbo.tblTaskAssignee
                            WHERE TaskId = @TaskId AND UserId <> @UserId)
               AND NOT EXISTS (SELECT 1 FROM dbo.tblTaskComments
                                WHERE TaskId = @TaskId AND UserId <> @UserId
                                  AND ISNULL(IsDeleted, 0) = 0)
                SET @Allowed = 1;
            ELSE
                SET @Reason = 'others have contributed to this task';
        END
    END

    ELSE IF (@Action IN ('edit_own_comment', 'delete_own_comment'))
    BEGIN
        IF (@CommentAuthorId IS NOT NULL AND @CommentAuthorId = @UserId) SET @Allowed = 1;
    END

    ELSE IF (@Action IN ('delete_others_comment', 'pin_comment'))
        SET @Allowed = CASE WHEN @Role IN ('owner','manager') THEN 1 ELSE 0 END;

    ELSE IF (@Action = 'manage_members')
        SET @Allowed = CASE WHEN @Role = 'owner' THEN 1 ELSE 0 END;

    ELSE
    BEGIN
        SET @Allowed = 0;
        SET @Reason  = 'unknown action';
        SELECT @Allowed AS Allowed, @Reason AS Reason; RETURN;
    END

    IF (@Allowed = 1)
        SET @Reason = 'role=' + @Role + ' action=' + @Action
                    + CASE WHEN @IsAssignee = 1 THEN ' (assignee)' ELSE '' END;
    ELSE IF (@Reason = 'denied')
        SET @Reason = 'role=' + @Role + ' not permitted for ' + @Action;

    SELECT @Allowed AS Allowed, @Reason AS Reason;
END
GO


-- ===========================================================================
-- A4. sp_UnassignInvalidAssignees — NEW, the one unassign rule (items 4, 5, 16)
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- A4. sp_UnassignInvalidAssignees (NEW, 094) — the ONE unassign rule.
--    An open, non-deleted task's assignee must be an active user AND an
--    active (InviteStatus = 'active'), non-viewer member of the board. Anyone
--    else is taken off the task. Personal boards are skipped (only the owner
--    can hold those).
--    Called inside the caller's transaction by sp_RemoveWorkspaceMember,
--    sp_SyncProjectWorkspaceMembers, sp_SaveTeam, sp_SetWorkspaceMemberRole
--    (-> viewer) and sp_SaveUser (deactivation, once per board).
--    Tells the board owner ONCE per call how many tasks were left with nobody
--    (skipped when the owner is the actor). Emits NO result set, so callers
--    keep their status row first. It uses INSERT ... EXEC itself, so it must
--    never be called through INSERT ... EXEC — always a plain EXEC.
--    P3 closes the TAT clock right after the DELETE — this is the one place.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_UnassignInvalidAssignees
    @WorkspaceId  BIGINT,
    @ActorUserId  INT    = NULL,
    @CompId       BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @WsType VARCHAR(20), @WsOwner INT, @WsBranchId BIGINT, @WsName VARCHAR(200);

    SELECT @WsType = Type, @WsOwner = OwnerUserId, @WsBranchId = BranchId, @WsName = Name
      FROM dbo.tblWorkspaces
     WHERE Id = @WorkspaceId AND CompId = @CompId;

    IF (@WsType IS NULL OR @WsType = 'personal') RETURN;

    DECLARE @Gone TABLE (TaskId BIGINT, UserId INT);

    DELETE ta
    OUTPUT deleted.TaskId, deleted.UserId INTO @Gone (TaskId, UserId)
      FROM dbo.tblTaskAssignee ta
      JOIN dbo.tblTasks t ON t.Id = ta.TaskId
     WHERE t.WorkspaceId = @WorkspaceId
       AND t.IsCompleted = 0
       AND t.IsDeleted = 0
       AND NOT EXISTS (SELECT 1
                         FROM dbo.tblWorkspaceMembers m
                         JOIN dbo.tblUser u ON u.Id = m.UserId AND u.IsActive = 1
                        WHERE m.WorkspaceId = @WorkspaceId
                          AND m.UserId = ta.UserId
                          AND m.IsActive = 1
                          AND m.InviteStatus = 'active'
                          AND m.Role <> 'viewer');

    IF NOT EXISTS (SELECT 1 FROM @Gone) RETURN;

    -- Legacy mirror, same rule sp_SaveTask uses.
    UPDATE t
       SET AssignedToUserId = (SELECT MIN(UserId) FROM dbo.tblTaskAssignee WHERE TaskId = t.Id),
           UpdatedDate = GETDATE()
      FROM dbo.tblTasks t
     WHERE t.Id IN (SELECT TaskId FROM @Gone);

    -- Only tasks now held by nobody are news; a task that kept a co-assignee
    -- is still someone's.
    DECLARE @Orphaned INT =
        (SELECT COUNT(DISTINCT g.TaskId) FROM @Gone g
          WHERE NOT EXISTS (SELECT 1 FROM dbo.tblTaskAssignee ta WHERE ta.TaskId = g.TaskId));

    IF (@WsOwner IS NULL OR @Orphaned = 0) RETURN;

    -- One notification per board, with the count (not one per task: a busy
    -- person leaving would flood the owner). @SkipSelf: no ping when the owner
    -- did it. Opens the board (EntityType 'Workspace').
    DECLARE @NBody NVARCHAR(1000) =
        LEFT(CONCAT(@Orphaned, N' open task(s) on ', ISNULL(@WsName, N'this board'),
                    N' now have nobody assigned'), 1000);
    DECLARE @Notif TABLE (ResponseCode INT, ResponseMess VARCHAR(400),
                          NotificationId BIGINT, UserId INT, Type VARCHAR(40));
    INSERT INTO @Notif
    EXEC dbo.sp_CreateNotification
         @UserId      = @WsOwner,
         @Type        = 'task_unassigned',
         @EntityType  = 'Workspace',
         @EntityId    = @WorkspaceId,
         @ActorUserId = @ActorUserId,
         @Title       = 'Tasks left unassigned',
         @Body        = @NBody,
         @CompId      = @CompId,
         @BranchId    = @WsBranchId,
         @SkipSelf    = 1;
END
GO


-- ===========================================================================
-- A5. sp_RemoveWorkspaceMember — leaving takes you off open tasks (item 5)
-- ===========================================================================
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

        -- Leaving the board means leaving its open tasks; the owner hears how
        -- many tasks are now left with nobody (094).
        EXEC dbo.sp_UnassignInvalidAssignees
             @WorkspaceId = @WorkspaceId, @ActorUserId = @ActingUserId, @CompId = @CompId;

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


-- ===========================================================================
-- A6. sp_SyncProjectWorkspaceMembers — synced out = off open tasks (item 5)
-- ===========================================================================
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

        -- People synced out leave the board's open tasks (094).
        EXEC dbo.sp_UnassignInvalidAssignees
             @WorkspaceId = @WorkspaceId, @ActorUserId = @ActingUserId, @CompId = @CompId;

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


-- ===========================================================================
-- A7. sp_SaveTeam — dropped from the team = off linked boards' open tasks (item 5)
-- ===========================================================================
-- ============================================================================
-- 070_team_roster_guard.sql
--
-- Two fixes to the team procedures, both found by the test suite written for
-- teamController on 2026-08-04 (which had none before).
--
-- 1. A NAME-ONLY TEAM SAVE WIPES THE ROSTER.
--
--    sp_SaveTeam's update path does this, unconditionally:
--
--        DELETE FROM tblTeamMembers WHERE TeamId = @Id;
--        ...
--        IF (@Members IS NOT NULL AND @Members <> '')   <- re-insert only then
--
--    and teamController sends NULL whenever Members is absent or `[]`. So a
--    request that changes only the team name deletes every member. Worse, the
--    workspace cascade below it then reads the (now empty) @NewMembers table
--    and soft-removes those same users from every linked project workspace.
--    Silent, and the blast radius reaches well past tblTeamMembers.
--
--    The web form happens to be safe because it reloads the roster and posts
--    the whole array back every time — but that is luck, not design, and any
--    partial client walks straight into it.
--
--    This is the same "no opinion" vs "clear it" conflation sp_SaveTask already
--    solved with @HasAssigneeInput, and it is fixed the same way:
--
--        @Members NULL  -> leave the roster alone
--        @Members '[]'  -> clear it deliberately
--        @Members '[..]'-> replace it
--
--    The controller change lands with this: `[]` now serialises to '[]' rather
--    than NULL, so removing everyone from a team still works. Apply this script
--    and deploy together — until the backend deploys, an explicit "remove all"
--    from the web form silently does nothing (the safe direction).
--
-- 2. sp_FetchTeam LEAKS ACROSS BRANCHES WITHIN A COMPANY.
--
--    The @Id > 0 branch gates existence on CompId but then selects
--    `WHERE t.Id = @Id` with no branch predicate at all — while the list branch
--    right above it applies the full @UseScope filter. So a Branch- or
--    Self-scoped user cannot SEE a team from another branch in the list, but
--    can read it in full by asking for its id.
--
--    Not cross-company: the EXISTS check blocks that. Intra-company scope only.
--
-- Author: Claude  Date: 2026-08-04
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. sp_SaveTeam — the whole membership block becomes conditional
--
--    The DELETE moves INSIDE the block rather than staying in the @Id > 0
--    branch. On create @Id is already SCOPE_IDENTITY() by that point and the
--    table has no rows for it, so the delete is a harmless no-op there and the
--    two paths stop needing to differ.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_SaveTeam
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
        END

        -- ------------------------------------------------------------------
        -- Membership. Touched ONLY when the caller expressed an opinion.
        --
        -- NULL means "I am not editing the roster" — a rename, a colour
        -- change, a deactivate. '[]' means "remove everyone", and still works.
        -- ------------------------------------------------------------------
        IF (@Members IS NOT NULL)
        BEGIN
            DELETE FROM tblTeamMembers WHERE TeamId = @Id;

            DECLARE @NewMembers TABLE (UserId INT PRIMARY KEY);
            IF (@Members <> '')
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
            --
            -- Inside the guard for the same reason as the DELETE: with @Members
            -- NULL, @NewMembers is empty and this removed every member of every
            -- linked workspace on a rename.
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

            -- People dropped from the team leave the linked boards' open tasks (094).
            DECLARE @LwId BIGINT;
            DECLARE lw CURSOR LOCAL FAST_FORWARD FOR SELECT Id FROM @LinkedWorkspaces;
            OPEN lw; FETCH NEXT FROM lw INTO @LwId;
            WHILE @@FETCH_STATUS = 0
            BEGIN
                EXEC dbo.sp_UnassignInvalidAssignees
                     @WorkspaceId = @LwId, @ActorUserId = NULL, @CompId = @CompId;
                FETCH NEXT FROM lw INTO @LwId;
            END
            CLOSE lw; DEALLOCATE lw;
        END
        ELSE
        BEGIN
            -- Roster untouched. Report what is actually there, so the caller's
            -- "(N members)" audit line does not claim the team was emptied.
            SET @MemberCount = (SELECT COUNT(*) FROM tblTeamMembers
                                 WHERE TeamId = @Id AND IsActive = 1);
        END

        COMMIT TRANSACTION;
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               @Id AS TeamId, @MemberCount AS MemberCount;
        -- 2nd result set (094): the linked project boards the roster cascade
        -- touched (empty when @Members was NULL), so the caller can refresh them.
        SELECT Id AS WorkspaceId FROM @LinkedWorkspaces;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SET @ResponseCode = 500;
        SET @ResponseMess = 'Error saving team: ' + ERROR_MESSAGE();
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END CATCH
END
GO


-- ===========================================================================
-- A8. sp_SetWorkspaceMemberRole — demotion to viewer unassigns (item 4)
-- ===========================================================================
CREATE OR ALTER PROCEDURE dbo.sp_SetWorkspaceMemberRole
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
    -- A viewer cannot hold a task (094): demotion takes them off open tasks.
    BEGIN TRY
        BEGIN TRANSACTION;
        UPDATE dbo.tblWorkspaceMembers
           SET Role = @Role
         WHERE WorkspaceId = @WorkspaceId AND UserId = @UserId;

        IF (@Role = 'viewer')
            EXEC dbo.sp_UnassignInvalidAssignees
                 @WorkspaceId = @WorkspaceId, @ActorUserId = @ActingUserId, @CompId = @CompId;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT 500 AS ResponseCode, 'Role change failed: ' + ERROR_MESSAGE() AS ResponseMess;
        RETURN;
    END CATCH

    SELECT 200 AS ResponseCode, 'Role updated' AS ResponseMess,
           @WorkspaceId AS WorkspaceId, @UserId AS UserId, @Role AS Role;
END
GO


-- ===========================================================================
-- A10. sp_DeleteTask — soft delete (item 1)
-- ===========================================================================
CREATE OR ALTER PROCEDURE dbo.sp_DeleteTask
    @Id       BIGINT,
    @UserId   INT,
    @IsAdmin  BIT     = 0,
    @CompId   BIGINT,
    @BranchId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);

    IF (@Id IS NULL OR @Id <= 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Task Id is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM dbo.tblTasks WHERE Id = @Id AND IsDeleted = 0)
    BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Task not found';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    DECLARE @Perm TABLE (Allowed BIT, Reason VARCHAR(400));
    INSERT INTO @Perm
    EXEC dbo.sp_CheckTaskPermission
        @TaskId = @Id, @WorkspaceId = NULL, @CommentId = NULL,
        @UserId = @UserId, @Action = 'delete_task',
        @IsAdmin = @IsAdmin, @CompId = @CompId;

    IF NOT EXISTS (SELECT 1 FROM @Perm WHERE Allowed = 1)
    BEGIN
        SET @ResponseCode = 403;
        SET @ResponseMess = 'Permission denied: ' + ISNULL((SELECT TOP 1 Reason FROM @Perm), 'no reason');
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
    END

    IF EXISTS (SELECT 1 FROM dbo.tblTasks WHERE ParentTaskId = @Id AND IsDeleted = 0)
    BEGIN SET @ResponseCode = 409;
          SET @ResponseMess = 'Task has subtasks. Delete or reparent them first.';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;

        -- Soft delete (094): the task, its steps, comments, time and reads stay
        -- for history (TAT reports need them). Only dependency links go, so a
        -- deleted task never blocks a live one.
        DELETE FROM dbo.tblTaskDependencies
         WHERE TaskId = @Id OR DependsOnTaskId = @Id;

        UPDATE dbo.tblTasks
           SET IsDeleted = 1, DeletedAt = GETDATE(), DeletedBy = @UserId,
               UpdatedDate = GETDATE()
         WHERE Id = @Id;

        COMMIT TRANSACTION;
        SET @ResponseCode = 200; SET @ResponseMess = 'Task deleted';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, @Id AS TaskId,
               (SELECT WorkspaceId FROM dbo.tblTasks WHERE Id = @Id) AS WorkspaceId;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SET @ResponseCode = 500;
        SET @ResponseMess = 'Delete failed: ' + ERROR_MESSAGE();
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END CATCH
END
GO


-- ===========================================================================
-- A11. sp_BulkDeleteTasks — soft delete (item 1)
-- ===========================================================================
CREATE OR ALTER PROCEDURE dbo.sp_BulkDeleteTasks
    @TaskIds  NVARCHAR(MAX),
    @UserId   INT,
    @CompId   BIGINT,
    @BranchId BIGINT,
    @IsAdmin  BIT     = 0
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);
    DECLARE @DeletedCount INT = 0;

    IF (@TaskIds IS NULL OR LTRIM(RTRIM(@TaskIds)) = '')
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Task IDs are required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    DECLARE @Targets TABLE (TaskId BIGINT PRIMARY KEY);
    INSERT INTO @Targets (TaskId)
    SELECT DISTINCT CAST(value AS BIGINT)
      FROM STRING_SPLIT(@TaskIds, ',')
     WHERE ISNUMERIC(value) = 1;

    IF EXISTS (
        SELECT 1 FROM dbo.tblTasks t
        INNER JOIN @Targets tgt ON t.ParentTaskId = tgt.TaskId
         WHERE t.IsDeleted = 0
    )
    BEGIN
        SET @ResponseCode = 409;
        SET @ResponseMess = 'One or more tasks have subtasks. Delete subtasks first.';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
    END

    DECLARE @FailedId BIGINT = NULL, @CurrentId BIGINT;
    DECLARE cur CURSOR LOCAL FAST_FORWARD FOR SELECT TaskId FROM @Targets;
    OPEN cur; FETCH NEXT FROM cur INTO @CurrentId;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        DECLARE @Perm TABLE (Allowed BIT, Reason VARCHAR(400));
        INSERT INTO @Perm
        EXEC dbo.sp_CheckTaskPermission
            @TaskId = @CurrentId, @WorkspaceId = NULL, @CommentId = NULL,
            @UserId = @UserId, @Action = 'delete_task',
            @IsAdmin = @IsAdmin, @CompId = @CompId;

        IF NOT EXISTS (SELECT 1 FROM @Perm WHERE Allowed = 1)
        BEGIN SET @FailedId = @CurrentId; BREAK; END
        DELETE FROM @Perm;
        FETCH NEXT FROM cur INTO @CurrentId;
    END
    CLOSE cur; DEALLOCATE cur;

    IF (@FailedId IS NOT NULL)
    BEGIN
        SET @ResponseCode = 403;
        SET @ResponseMess = CONCAT('Permission denied for task #', @FailedId);
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
    END

    BEGIN TRY
        BEGIN TRANSACTION;

        -- Soft delete (094): history stays; only dependency links go.
        DELETE FROM dbo.tblTaskDependencies
         WHERE TaskId IN (SELECT TaskId FROM @Targets)
            OR DependsOnTaskId IN (SELECT TaskId FROM @Targets);

        UPDATE dbo.tblTasks
           SET IsDeleted = 1, DeletedAt = GETDATE(), DeletedBy = @UserId,
               UpdatedDate = GETDATE()
         WHERE Id IN (SELECT TaskId FROM @Targets) AND IsDeleted = 0;
        SET @DeletedCount = @@ROWCOUNT;

        COMMIT TRANSACTION;
        SET @ResponseCode = 200;
        SET @ResponseMess = CONCAT('Deleted ', @DeletedCount, ' task(s)');
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               @DeletedCount AS DeletedCount, 0 AS FailedCount;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SET @ResponseCode = 500;
        SET @ResponseMess = 'Bulk delete failed: ' + ERROR_MESSAGE();
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END CATCH
END
GO


-- ===========================================================================
-- A12 + B5. sp_FetchTask — hide deleted, "Seen" stamp; My Work filters, archived skipped (items 1, 8, 9)
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- 5. sp_FetchTask
--
--    Three changes, everything else byte-identical to 061:
--      (a) the orphan-task visibility clause resolves assignment from the SET
--          (twice — count query AND page query, or pagination lies)
--      (b) @SearchTerm matches ANY assignee, not just the mirrored one
--      (c) new AssigneesJson + AssigneeCount columns, added to EVERY branch
--          including the two NULL-shaped ones, or mssql throws on recordset
--          merge
--
--    The LEFT JOIN tblUser assignee stays: it joins on the scalar mirror, so it
--    still yields exactly one row per task. That is the whole reason the mirror
--    is worth keeping through this migration — a join on the set would fan a
--    2-assignee task into 2 rows in both the count and the page query.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_FetchTask
    @Id                      BIGINT        = 0,
    @WorkspaceId             BIGINT        = NULL,
    @ProjectId               INT           = NULL,
    @UserId                  INT,
    @CompId                  BIGINT,
    @BranchId                BIGINT        = NULL,   -- optional filter
    @IsAdmin                 BIT           = 0,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,   -- accepted, intentionally unused
    @PageNumber              INT           = 1,
    @PageSize                INT           = 25,
    @SearchTerm              NVARCHAR(200) = NULL,
    @AssigneeUserId          INT           = NULL,   -- narrows; never widens (094)
    @OnlyOpen                BIT           = 0,
    @Overdue                 BIT           = 0
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);
    DECLARE @TotalRecords INT, @TotalPages INT, @Offset INT;

    IF (@Id > 0)
    BEGIN
        DECLARE @PermTable TABLE (Allowed BIT, Reason VARCHAR(400));
        INSERT INTO @PermTable
        EXEC dbo.sp_CheckTaskPermission
            @TaskId = @Id, @WorkspaceId = NULL, @CommentId = NULL,
            @UserId = @UserId, @Action = 'view_task',
            @IsAdmin = @IsAdmin, @CompId = @CompId;

        IF NOT EXISTS (SELECT 1 FROM @PermTable WHERE Allowed = 1)
        BEGIN
            SET @ResponseCode = 404; SET @ResponseMess = 'Task not found or access denied';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   NULL AS Id, NULL AS Title, NULL AS Description,
                   NULL AS WorkspaceId, NULL AS ColumnId, NULL AS ColumnTitle,
                   NULL AS IsCompleted,
                   NULL AS ProjectId, NULL AS ParentTaskId,
                   NULL AS AssignedToUserId, NULL AS CreatedByUserId, NULL AS TeamId,
                   NULL AS Priority, NULL AS Type, NULL AS DueDate,
                   NULL AS EstimatedHours, NULL AS LoggedHours, NULL AS Progress,
                   NULL AS IsBlocked, NULL AS Labels, NULL AS Watchers,
                   NULL AS CompletedDate, NULL AS CompletedByUserId, NULL AS UpdatedDate,
                   NULL AS BranchId, NULL AS ProjectName, NULL AS WorkspaceName, NULL AS AssigneeName,
                   NULL AS CreatorName, NULL AS TeamName,
                   NULL AS SubTaskCount, NULL AS BlockerCount,
                   NULL AS ChecklistTotal, NULL AS ChecklistDone,
                   NULL AS AssigneesJson, NULL AS AssigneeCount;
            RETURN;
        END

        DECLARE @WsTypeOne VARCHAR(20);
        SELECT @WsTypeOne = w.Type
          FROM dbo.tblTasks t LEFT JOIN dbo.tblWorkspaces w ON w.Id = t.WorkspaceId
         WHERE t.Id = @Id;

        IF (@WsTypeOne IN ('shared','project'))
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM dbo.tblTaskReads WHERE TaskId = @Id AND UserId = @UserId)
                INSERT INTO dbo.tblTaskReads (TaskId, UserId, DeliveredAt)
                VALUES (@Id, @UserId, GETDATE());

            -- "Seen" (094): stamped only for the people the task is handed to.
            -- A manager opening it is not the assignee seeing it.
            UPDATE dbo.tblTaskReads
               SET FirstSeenAt = ISNULL(FirstSeenAt, GETDATE()),
                   LastSeenAt  = GETDATE()
             WHERE TaskId = @Id AND UserId = @UserId
               AND EXISTS (SELECT 1 FROM dbo.tblTaskAssignee
                            WHERE TaskId = @Id AND UserId = @UserId);
        END

        SET @ResponseCode = 200; SET @ResponseMess = 'Task retrieved';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
               t.Id, t.Title, t.Description, t.WorkspaceId, t.ColumnId,
               col.Title AS ColumnTitle,
               ISNULL(t.IsCompleted, 0) AS IsCompleted,
               t.ProjectId, t.ParentTaskId,
               t.AssignedToUserId, t.CreatedByUserId, t.TeamId,
               t.Priority, t.Type, t.DueDate,
               t.EstimatedHours, t.LoggedHours, t.Progress,
               CAST(CASE WHEN EXISTS (
                   SELECT 1 FROM dbo.tblTaskDependencies d
                   JOIN dbo.tblTasks b ON b.Id = d.DependsOnTaskId
                   WHERE d.TaskId = t.Id AND d.Type = 'blocks'
                     AND ISNULL(b.IsCompleted, 0) = 0
               ) THEN 1 ELSE 0 END AS BIT) AS IsBlocked,
               t.Labels, t.Watchers,
               t.CompletedDate, t.CompletedByUserId, t.UpdatedDate,
               ISNULL(p.BranchId, w.BranchId) AS BranchId,
               p.Name AS ProjectName, w.Name AS WorkspaceName,
               assignee.FullName AS AssigneeName,
               creator.FullName AS CreatorName,
               team.Name AS TeamName,
               (SELECT COUNT(*) FROM dbo.tblTasks st WHERE st.ParentTaskId = t.Id AND st.IsDeleted = 0) AS SubTaskCount,
               (SELECT COUNT(*) FROM dbo.tblTaskDependencies d
                 WHERE d.TaskId = t.Id AND d.Type = 'blocks') AS BlockerCount,
               (SELECT COUNT(*) FROM dbo.tblTaskChecklist c WHERE c.TaskId = t.Id) AS ChecklistTotal,
               (SELECT COUNT(*) FROM dbo.tblTaskChecklist c
                 WHERE c.TaskId = t.Id AND c.IsCompleted = 1) AS ChecklistDone,
               (SELECT ta.UserId, u2.FullName, u2.Avatar
                  FROM dbo.tblTaskAssignee ta
                  INNER JOIN dbo.tblUser u2 ON u2.Id = ta.UserId
                 WHERE ta.TaskId = t.Id
                 ORDER BY ta.UserId
                 FOR JSON PATH) AS AssigneesJson,
               (SELECT COUNT(*) FROM dbo.tblTaskAssignee ta WHERE ta.TaskId = t.Id) AS AssigneeCount
          FROM dbo.tblTasks t
          LEFT JOIN dbo.tblKanbanColumns col ON col.Id = t.ColumnId
          LEFT JOIN dbo.tblWorkspaces    w   ON w.Id   = t.WorkspaceId
          LEFT JOIN dbo.tblProjects      p   ON p.Id   = t.ProjectId
          INNER JOIN dbo.tblUser creator     ON creator.Id = t.CreatedByUserId
          LEFT  JOIN dbo.tblUser assignee    ON assignee.Id = t.AssignedToUserId
          LEFT  JOIN dbo.tblTeams team       ON team.Id = t.TeamId
         WHERE t.Id = @Id;
        RETURN;
    END

    SET @Offset = (@PageNumber - 1) * @PageSize;

    SELECT @TotalRecords = COUNT(*)
      FROM dbo.tblTasks t
      LEFT JOIN dbo.tblWorkspaces w ON w.Id = t.WorkspaceId
      LEFT JOIN dbo.tblProjects   p ON p.Id = t.ProjectId
      LEFT JOIN dbo.tblUser assignee ON assignee.Id = t.AssignedToUserId
      LEFT JOIN dbo.tblTeams team     ON team.Id = t.TeamId
     WHERE (@WorkspaceId IS NULL OR t.WorkspaceId = @WorkspaceId)
       AND t.IsDeleted = 0
       AND (@ProjectId   IS NULL OR t.ProjectId   = @ProjectId)
       AND (@BranchId    IS NULL OR ISNULL(p.BranchId, w.BranchId) = @BranchId)
       AND (
             t.WorkspaceId IN (SELECT Id FROM dbo.tblWorkspaces ww
                                WHERE ww.CompId = @CompId
                                  AND (
                                        (ww.Type = 'personal' AND ww.OwnerUserId = @UserId)
                                     OR (ww.Type IN ('shared','project')
                                         AND (@IsAdmin = 1
                                              OR EXISTS (SELECT 1 FROM dbo.tblWorkspaceMembers mm
                                                          WHERE mm.WorkspaceId = ww.Id AND mm.UserId = @UserId
                                                            AND mm.IsActive = 1
                                                            AND mm.InviteStatus = 'active')))))
          OR (t.WorkspaceId IS NULL
              AND (@IsAdmin = 1
                   OR EXISTS (SELECT 1 FROM dbo.tblTaskAssignee ta
                               WHERE ta.TaskId = t.Id AND ta.UserId = @UserId)
                   OR t.CreatedByUserId  = @UserId
                   OR p.ManagerUserId    = @UserId))
           )
       AND (@SearchTerm IS NULL
            OR t.Title LIKE '%' + @SearchTerm + '%'
            OR t.Description LIKE '%' + @SearchTerm + '%'
            OR EXISTS (SELECT 1 FROM dbo.tblTaskAssignee ta
                        INNER JOIN dbo.tblUser au ON au.Id = ta.UserId
                        WHERE ta.TaskId = t.Id AND au.FullName LIKE '%' + @SearchTerm + '%')
            OR team.Name LIKE '%' + @SearchTerm + '%')
       AND (@AssigneeUserId IS NULL
            OR EXISTS (SELECT 1 FROM dbo.tblTaskAssignee fa
                        WHERE fa.TaskId = t.Id AND fa.UserId = @AssigneeUserId))
       AND (@OnlyOpen = 0 OR ISNULL(t.IsCompleted, 0) = 0)
       AND (@Overdue  = 0 OR (ISNULL(t.IsCompleted, 0) = 0
                              AND t.DueDate < CAST(GETDATE() AS DATE)))
       -- Cross-workspace lists (My Work, mobile, Today) skip archived boards.
       -- An explicit @WorkspaceId still opens an archived board read-only.
       AND (@WorkspaceId IS NOT NULL OR ISNULL(w.IsArchived, 0) = 0);

    SET @TotalPages = CASE WHEN @PageSize > 0
                           THEN CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize)
                           ELSE 0 END;

    IF (@TotalRecords = 0)
    BEGIN
        SET @ResponseCode = 200; SET @ResponseMess = 'No tasks found';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
               @PageNumber AS CurrentPage, @PageSize AS PageSize,
               NULL AS Id, NULL AS Title, NULL AS Description,
               NULL AS WorkspaceId, NULL AS ColumnId, NULL AS ColumnTitle,
               NULL AS IsCompleted,
               NULL AS ProjectId, NULL AS ParentTaskId,
               NULL AS AssignedToUserId, NULL AS CreatedByUserId, NULL AS TeamId,
               NULL AS Priority, NULL AS Type, NULL AS DueDate,
               NULL AS EstimatedHours, NULL AS LoggedHours, NULL AS Progress,
               NULL AS IsBlocked, NULL AS Labels, NULL AS Watchers,
               NULL AS CompletedDate, NULL AS CompletedByUserId, NULL AS UpdatedDate,
               NULL AS BranchId, NULL AS ProjectName, NULL AS WorkspaceName, NULL AS AssigneeName,
               NULL AS CreatorName, NULL AS TeamName,
               NULL AS SubTaskCount, NULL AS BlockerCount,
               NULL AS ChecklistTotal, NULL AS ChecklistDone,
               NULL AS AssigneesJson, NULL AS AssigneeCount;
        RETURN;
    END

    SET @ResponseCode = 200; SET @ResponseMess = 'Tasks retrieved';
    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
           @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
           @PageNumber AS CurrentPage, @PageSize AS PageSize,
           t.Id, t.Title, t.Description, t.WorkspaceId, t.ColumnId,
           col.Title AS ColumnTitle,
           ISNULL(t.IsCompleted, 0) AS IsCompleted,
           t.ProjectId, t.ParentTaskId,
           t.AssignedToUserId, t.CreatedByUserId, t.TeamId,
           t.Priority, t.Type, t.DueDate,
           t.EstimatedHours, t.LoggedHours, t.Progress,
           CAST(CASE WHEN EXISTS (
               SELECT 1 FROM dbo.tblTaskDependencies d
               JOIN dbo.tblTasks b ON b.Id = d.DependsOnTaskId
               WHERE d.TaskId = t.Id AND d.Type = 'blocks'
                 AND ISNULL(b.IsCompleted, 0) = 0
           ) THEN 1 ELSE 0 END AS BIT) AS IsBlocked,
           t.Labels, t.Watchers,
           t.CompletedDate, t.CompletedByUserId, t.UpdatedDate,
           ISNULL(p.BranchId, w.BranchId) AS BranchId,
           p.Name AS ProjectName, w.Name AS WorkspaceName,
           assignee.FullName AS AssigneeName,
           creator.FullName AS CreatorName,
           team.Name AS TeamName,
           (SELECT COUNT(*) FROM dbo.tblTasks st WHERE st.ParentTaskId = t.Id AND st.IsDeleted = 0) AS SubTaskCount,
           (SELECT COUNT(*) FROM dbo.tblTaskDependencies d
             WHERE d.TaskId = t.Id AND d.Type = 'blocks') AS BlockerCount,
           (SELECT COUNT(*) FROM dbo.tblTaskChecklist c WHERE c.TaskId = t.Id) AS ChecklistTotal,
           (SELECT COUNT(*) FROM dbo.tblTaskChecklist c
             WHERE c.TaskId = t.Id AND c.IsCompleted = 1) AS ChecklistDone,
           (SELECT ta.UserId, u2.FullName, u2.Avatar
              FROM dbo.tblTaskAssignee ta
              INNER JOIN dbo.tblUser u2 ON u2.Id = ta.UserId
             WHERE ta.TaskId = t.Id
             ORDER BY ta.UserId
             FOR JSON PATH) AS AssigneesJson,
           (SELECT COUNT(*) FROM dbo.tblTaskAssignee ta WHERE ta.TaskId = t.Id) AS AssigneeCount
      FROM dbo.tblTasks t
      LEFT JOIN dbo.tblKanbanColumns col ON col.Id = t.ColumnId
      LEFT JOIN dbo.tblWorkspaces    w   ON w.Id   = t.WorkspaceId
      LEFT JOIN dbo.tblProjects      p   ON p.Id   = t.ProjectId
      INNER JOIN dbo.tblUser creator     ON creator.Id = t.CreatedByUserId
      LEFT  JOIN dbo.tblUser assignee    ON assignee.Id = t.AssignedToUserId
      LEFT  JOIN dbo.tblTeams team       ON team.Id = t.TeamId
     WHERE (@WorkspaceId IS NULL OR t.WorkspaceId = @WorkspaceId)
       AND t.IsDeleted = 0
       AND (@ProjectId   IS NULL OR t.ProjectId   = @ProjectId)
       AND (@BranchId    IS NULL OR ISNULL(p.BranchId, w.BranchId) = @BranchId)
       AND (
             t.WorkspaceId IN (SELECT Id FROM dbo.tblWorkspaces ww
                                WHERE ww.CompId = @CompId
                                  AND (
                                        (ww.Type = 'personal' AND ww.OwnerUserId = @UserId)
                                     OR (ww.Type IN ('shared','project')
                                         AND (@IsAdmin = 1
                                              OR EXISTS (SELECT 1 FROM dbo.tblWorkspaceMembers mm
                                                          WHERE mm.WorkspaceId = ww.Id AND mm.UserId = @UserId
                                                            AND mm.IsActive = 1
                                                            AND mm.InviteStatus = 'active')))))
          OR (t.WorkspaceId IS NULL
              AND (@IsAdmin = 1
                   OR EXISTS (SELECT 1 FROM dbo.tblTaskAssignee ta
                               WHERE ta.TaskId = t.Id AND ta.UserId = @UserId)
                   OR t.CreatedByUserId  = @UserId
                   OR p.ManagerUserId    = @UserId))
           )
       AND (@SearchTerm IS NULL
            OR t.Title LIKE '%' + @SearchTerm + '%'
            OR t.Description LIKE '%' + @SearchTerm + '%'
            OR EXISTS (SELECT 1 FROM dbo.tblTaskAssignee ta
                        INNER JOIN dbo.tblUser au ON au.Id = ta.UserId
                        WHERE ta.TaskId = t.Id AND au.FullName LIKE '%' + @SearchTerm + '%')
            OR team.Name LIKE '%' + @SearchTerm + '%')
       AND (@AssigneeUserId IS NULL
            OR EXISTS (SELECT 1 FROM dbo.tblTaskAssignee fa
                        WHERE fa.TaskId = t.Id AND fa.UserId = @AssigneeUserId))
       AND (@OnlyOpen = 0 OR ISNULL(t.IsCompleted, 0) = 0)
       AND (@Overdue  = 0 OR (ISNULL(t.IsCompleted, 0) = 0
                              AND t.DueDate < CAST(GETDATE() AS DATE)))
       -- Cross-workspace lists (My Work, mobile, Today) skip archived boards.
       -- An explicit @WorkspaceId still opens an archived board read-only.
       AND (@WorkspaceId IS NOT NULL OR ISNULL(w.IsArchived, 0) = 0)
     ORDER BY ISNULL(t.IsCompleted, 0) ASC,
              CASE t.Priority
                   WHEN 'critical' THEN 1 WHEN 'high' THEN 2
                   WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END,
              t.DueDate ASC, t.Id DESC
     OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
END
GO


-- ===========================================================================
-- A13 + B1. sp_RecomputeTaskCompletion — board follows completion; @Transition OUTPUT (items 11, 7)
-- ===========================================================================
CREATE OR ALTER PROCEDURE dbo.sp_RecomputeTaskCompletion
    @TaskId       BIGINT,
    @ActingUserId INT = NULL,
    @Transition   VARCHAR(10) = NULL OUTPUT   -- 'completed' | 'reopened' | NULL (no change)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Total INT, @Open INT, @Was BIT;

    SELECT @Was = ISNULL(IsCompleted, 0) FROM dbo.tblTasks WHERE Id = @TaskId;
    SELECT @Total = COUNT(*),
           @Open  = SUM(CASE WHEN ISNULL(IsCompleted,0) = 0 THEN 1 ELSE 0 END)
      FROM dbo.tblTaskChecklist WHERE TaskId = @TaskId;

    DECLARE @Now BIT = CASE WHEN @Total > 0 AND @Open = 0 THEN 1 ELSE 0 END;

    -- The board follows completion (094): completing moves the card to the
    -- board's last column, reopening moves it to the first. Only on a change of
    -- state — a tick that leaves the task as it was never moves the card.
    DECLARE @MoveTo INT = NULL;
    IF (@Now <> ISNULL(@Was, 0))
        SELECT TOP 1 @MoveTo = k.Id
          FROM dbo.tblKanbanColumns k
          JOIN dbo.tblTasks t ON t.WorkspaceId = k.WorkspaceId
         WHERE t.Id = @TaskId AND k.IsActive = 1
         ORDER BY CASE WHEN @Now = 1 THEN k.SortOrder END DESC,
                  CASE WHEN @Now = 1 THEN k.Id END DESC,
                  CASE WHEN @Now = 0 THEN k.SortOrder END ASC,
                  CASE WHEN @Now = 0 THEN k.Id END ASC;

    UPDATE dbo.tblTasks
       SET IsCompleted = @Now,
           ColumnId = COALESCE(@MoveTo, ColumnId),
           CompletedDate = CASE
               WHEN @Now = 1 AND CompletedDate IS NULL THEN GETDATE()
               WHEN @Now = 0 THEN NULL
               ELSE CompletedDate END,
           CompletedByUserId = CASE
               WHEN @Now = 1 AND CompletedByUserId IS NULL
               THEN ISNULL(@ActingUserId, CreatedByUserId)
               WHEN @Now = 0 THEN NULL
               ELSE CompletedByUserId END,
           UpdatedDate = GETDATE()
     WHERE Id = @TaskId;

    -- An OUTPUT parameter, never a result set: a SELECT here would leak into
    -- sp_SaveTaskChecklist/sp_DeleteTaskChecklist and displace their status row.
    SET @Transition = CASE WHEN @Now = 1 AND @Was = 0 THEN 'completed'
                           WHEN @Now = 0 AND @Was = 1 THEN 'reopened' END;

    -- sp_ResolveDependencies no longer returns a result set, so a plain EXEC
    -- is safe — nothing leaks out to this proc's caller.
    IF (@Now = 1 AND @Was = 0)
        EXEC dbo.sp_ResolveDependencies @ResolvedTaskId = @TaskId;
END
GO


-- ===========================================================================
-- A14 + B2. sp_SaveTaskChecklist — tick never renames; CompletionChange (items 3, 7)
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- 1. sp_SaveTaskChecklist
--    The controller authorises the caller against @TaskId; this procedure then
--    acted on @Id alone, so an item of ANY task in ANY company could be
--    renamed or ticked (and the wrong task's completion recomputed). An
--    update now requires the item to belong to @TaskId.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_SaveTaskChecklist
    @Id           BIGINT,
    @TaskId       BIGINT,
    @ItemText     VARCHAR(500),
    @IsCompleted  BIT,
    @SortOrder    INT,
    @CompId       BIGINT,
    @BranchId     BIGINT,
    @ActingUserId INT = NULL,
    @CanEdit      BIT = 1     -- 0 = the caller may only tick (change_status) (094)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);

    IF (@TaskId IS NULL OR @TaskId <= 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'TaskId is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@ItemText IS NULL OR LTRIM(RTRIM(@ItemText)) = '')
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Checklist item text cannot be blank';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM dbo.tblTasks WHERE Id = @TaskId)
    BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Task not found';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@Id = 0)
    BEGIN
        IF (@SortOrder IS NULL OR @SortOrder = 0)
            SELECT @SortOrder = ISNULL(MAX(SortOrder), 0) + 1
              FROM dbo.tblTaskChecklist WHERE TaskId = @TaskId;

        INSERT INTO dbo.tblTaskChecklist (TaskId, ItemText, IsCompleted, SortOrder)
        VALUES (@TaskId, @ItemText, ISNULL(@IsCompleted, 0), @SortOrder);

        SET @Id = SCOPE_IDENTITY();
        SET @ResponseCode = 201; SET @ResponseMess = 'Checklist item created';
    END
    ELSE
    BEGIN
        -- The item must belong to the task the caller was authorised for.
        IF NOT EXISTS (SELECT 1 FROM dbo.tblTaskChecklist WHERE Id = @Id AND TaskId = @TaskId)
        BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Checklist item not found';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

        -- Ticking is change_status; renaming/reordering is manage_checklist.
        -- A tick-only caller (e.g. an assigned viewer) changes IsCompleted and
        -- nothing else, whatever text it sends (094).
        UPDATE dbo.tblTaskChecklist
           SET ItemText    = CASE WHEN @CanEdit = 1 THEN @ItemText  ELSE ItemText  END,
               IsCompleted = @IsCompleted,
               SortOrder   = CASE WHEN @CanEdit = 1 THEN @SortOrder ELSE SortOrder END
         WHERE Id = @Id AND TaskId = @TaskId;

        SET @ResponseCode = 200; SET @ResponseMess = 'Checklist item updated';
    END

    DECLARE @Transition VARCHAR(10);
    EXEC dbo.sp_RecomputeTaskCompletion @TaskId = @TaskId, @ActingUserId = @ActingUserId,
         @Transition = @Transition OUTPUT;

    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
           @Id AS ChecklistId, @Transition AS CompletionChange;
END
GO


-- ===========================================================================
-- A15 + B2. sp_DeleteTaskChecklist — never the last step; CompletionChange (items 2, 7)
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- 2. sp_DeleteTaskChecklist — now takes @TaskId and refuses an item of any
--    other task. @TaskId defaults to NULL only so the backend still deployed
--    when this is applied gets a clean 400 rather than a parameter error;
--    checklist deletes fail until the new backend is up, which is the safe
--    direction.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_DeleteTaskChecklist
    @Id           BIGINT,
    @TaskId       BIGINT = NULL,
    @CompId       BIGINT,
    @BranchId     BIGINT,
    @ActingUserId INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF (@TaskId IS NULL OR @TaskId <= 0)
    BEGIN SELECT 400 AS ResponseCode, 'TaskId is required' AS ResponseMess; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM dbo.tblTaskChecklist WHERE Id = @Id AND TaskId = @TaskId)
    BEGIN SELECT 404 AS ResponseCode, 'Checklist item not found' AS ResponseMess; RETURN; END

    -- Every task keeps at least one step (094) — completion is "all steps done",
    -- so deleting the last one would make a task that can never complete.
    IF NOT EXISTS (SELECT 1 FROM dbo.tblTaskChecklist WHERE TaskId = @TaskId AND Id <> @Id)
    BEGIN SELECT 409 AS ResponseCode,
                 'A task needs at least one step. Add another step before removing this one.' AS ResponseMess;
          RETURN; END

    DELETE FROM dbo.tblTaskChecklist WHERE Id = @Id AND TaskId = @TaskId;

    DECLARE @Transition VARCHAR(10);
    EXEC dbo.sp_RecomputeTaskCompletion @TaskId = @TaskId, @ActingUserId = @ActingUserId,
         @Transition = @Transition OUTPUT;

    SELECT 200 AS ResponseCode, 'Checklist item deleted' AS ResponseMess,
           @Id AS ChecklistId, @TaskId AS TaskId, @Transition AS CompletionChange;
END
GO


-- ===========================================================================
-- A16 + B6. sp_SaveTask — viewers not assignees, team/parent/project checks; RS3 field diffs (items 4, 15, 12)
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- 5. sp_SaveTask
--    (a) On an edit, @WorkspaceId came from the client and drove the member
--        and column checks, while the row's own workspace was never re-read:
--        passing your personal workspace skipped the member check, passing
--        another workspace's id parked the card in its column. An edit now
--        uses the task's own workspace. (The UPDATE never changed
--        WorkspaceId, so nothing legitimate depended on the client value.)
--    (b) A personal-workspace task may be assigned only to its owner —
--        anyone else gets notified about a task they can never open.
--    (c) Board = completion (R7). A new task is open, so a create aimed at
--        the board's last active column lands in the first one instead (no
--        error — the user just added a task). An edit never moves the card:
--        @ColumnId stays declared for old callers but is ignored on update;
--        column moves go only through sp_MoveTaskColumn. RS3 therefore no
--        longer carries a 'Column' row.
--    Everything else is byte-for-byte the live procedure.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_SaveTask
    @Id                 BIGINT          = 0,
    @Title              VARCHAR(500),
    @Description        NVARCHAR(MAX)   = NULL,
    @WorkspaceId        BIGINT          = NULL,
    @ColumnId           INT             = NULL,
    @ProjectId          INT             = NULL,
    @ParentTaskId       BIGINT          = NULL,
    @AssignedToUserId   INT             = NULL,   -- legacy single-assignee alias
    @AssigneeIdsJson    NVARCHAR(MAX)   = NULL,   -- '[2,11]' — the real input
    @CreatedByUserId    INT,
    @TeamId             INT             = NULL,
    @Priority           VARCHAR(20)     = 'medium',
    @Type               VARCHAR(50)     = 'task',
    @DueDate            DATE            = NULL,
    @EstimatedHours     DECIMAL(10,2)   = 0,
    @LoggedHours        DECIMAL(10,2)   = 0,
    @Progress           DECIMAL(5,2)    = 0,
    @IsBlocked          BIT             = 0,
    @Labels             NVARCHAR(MAX)   = NULL,
    @Watchers           NVARCHAR(MAX)   = NULL,
    @Dependencies       NVARCHAR(MAX)   = NULL,
    @ChecklistItemsJson NVARCHAR(MAX)   = NULL,
    @IsAdmin            BIT             = 0,
    @CompId             BIGINT,
    @BranchId           BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);

    IF (@Title IS NULL OR LTRIM(RTRIM(@Title)) = '')
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Task title is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@CreatedByUserId IS NULL OR @CreatedByUserId <= 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Created by user is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- (a) An edit is judged against the task's own workspace, never the client's.
    IF (@Id > 0)
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.tblTasks WHERE Id = @Id)
        BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Task not found';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
        SELECT @WorkspaceId = WorkspaceId FROM dbo.tblTasks WHERE Id = @Id;
        -- (c) Ignored on edit, so a stale ColumnId from an old client can't 400.
        SET @ColumnId = NULL;
    END

    IF (@WorkspaceId IS NOT NULL AND @WorkspaceId > 0)
        IF NOT EXISTS (SELECT 1 FROM dbo.tblWorkspaces WHERE Id = @WorkspaceId AND CompId = @CompId)
        BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid workspace';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@ColumnId IS NOT NULL AND @ColumnId > 0)
        IF NOT EXISTS (
            SELECT 1 FROM dbo.tblKanbanColumns
             WHERE Id = @ColumnId AND WorkspaceId = @WorkspaceId AND IsActive = 1
        )
        BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Column does not belong to this workspace';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- ----- Resolve the requested assignee set -------------------------------
    -- @HasAssigneeInput distinguishes "no opinion, leave them" from "clear them".
    DECLARE @Assignees TABLE (UserId INT PRIMARY KEY);
    DECLARE @HasAssigneeInput BIT = 0;

    IF (@AssigneeIdsJson IS NOT NULL AND LTRIM(RTRIM(@AssigneeIdsJson)) <> '')
    BEGIN
        SET @HasAssigneeInput = 1;
        INSERT INTO @Assignees (UserId)
        SELECT DISTINCT TRY_CAST(value AS INT)
          FROM OPENJSON(@AssigneeIdsJson)
         WHERE TRY_CAST(value AS INT) IS NOT NULL
           AND TRY_CAST(value AS INT) > 0;
    END
    ELSE IF (@AssignedToUserId IS NOT NULL AND @AssignedToUserId > 0)
    BEGIN
        SET @HasAssigneeInput = 1;
        INSERT INTO @Assignees (UserId) VALUES (@AssignedToUserId);
    END

    -- Every assignee must be a real, active user.
    IF EXISTS (SELECT 1 FROM @Assignees a
                WHERE NOT EXISTS (SELECT 1 FROM dbo.tblUser u
                                   WHERE u.Id = a.UserId AND u.IsActive = 1))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid assigned user selected';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- ...and an ACTIVE member of the workspace. Assigning an outsider used to
    -- notify them and then 404 them on every action, including opening it.
    DECLARE @WsTypeChk VARCHAR(20), @WsOwnerChk INT;
    DECLARE @WsIdChk BIGINT = @WorkspaceId;
    SELECT @WsTypeChk = Type, @WsOwnerChk = OwnerUserId FROM dbo.tblWorkspaces WHERE Id = @WsIdChk;

    IF (@WsTypeChk IN ('shared','project')
        AND EXISTS (SELECT 1 FROM @Assignees a
                     WHERE NOT EXISTS (SELECT 1 FROM dbo.tblWorkspaceMembers m
                                        WHERE m.WorkspaceId = @WsIdChk
                                          AND m.UserId = a.UserId
                                          AND m.IsActive = 1
                                          AND m.InviteStatus = 'active')))
    BEGIN SET @ResponseCode = 400;
          SET @ResponseMess = 'Every assignee must be an active member of this workspace';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- A viewer can't complete a task, so it can't be theirs (094).
    IF (@WsTypeChk IN ('shared','project')
        AND EXISTS (SELECT 1 FROM @Assignees a
                      JOIN dbo.tblWorkspaceMembers m
                        ON m.WorkspaceId = @WsIdChk AND m.UserId = a.UserId
                     WHERE m.IsActive = 1 AND m.InviteStatus = 'active' AND m.Role = 'viewer'))
    BEGIN SET @ResponseCode = 400;
          SET @ResponseMess = 'A viewer cannot be assigned a task. Make them a member first.';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- (b) A personal workspace is private to its owner, so only they can hold
    --     its tasks.
    IF (@WsTypeChk = 'personal'
        AND EXISTS (SELECT 1 FROM @Assignees a WHERE a.UserId <> @WsOwnerChk))
    BEGIN SET @ResponseCode = 400;
          SET @ResponseMess = 'A personal task can only be assigned to its owner';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@TeamId IS NOT NULL AND @TeamId > 0
        AND NOT EXISTS (SELECT 1 FROM dbo.tblTeams
                         WHERE Id = @TeamId AND IsActive = 1 AND CompId = @CompId))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid team selected';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@ParentTaskId IS NOT NULL AND @ParentTaskId > 0
        AND NOT EXISTS (SELECT 1 FROM dbo.tblTasks
                         WHERE Id = @ParentTaskId AND WorkspaceId = @WorkspaceId
                           AND IsDeleted = 0 AND Id <> ISNULL(@Id, 0)))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid parent task selected';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@ProjectId IS NOT NULL AND @ProjectId > 0
        AND NOT EXISTS (SELECT 1 FROM dbo.tblProjects WHERE Id = @ProjectId AND CompId = @CompId))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid project selected';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    DECLARE @PermTable TABLE (Allowed BIT, Reason VARCHAR(400));
    DECLARE @OldTitle VARCHAR(500), @OldPriority VARCHAR(20), @OldDueDate DATE,
            @OldDescription NVARCHAR(MAX);
    DECLARE @OldAssignees TABLE (UserId INT PRIMARY KEY);
    -- Which assignees this save actually ADDED. Returned as a second result set
    -- so the controller notifies exactly those people — the old code re-notified
    -- the assignee on every single save, including a drag-and-drop.
    DECLARE @NewAssignees TABLE (UserId INT PRIMARY KEY);

    IF (@Id = 0)
    BEGIN
        IF (@WorkspaceId IS NULL OR @WorkspaceId <= 0)
        BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'WorkspaceId is required to create a task';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

        -- Enforce >=1 checklist item on create.
        DECLARE @ItemCount INT = 0;
        IF (@ChecklistItemsJson IS NOT NULL AND @ChecklistItemsJson <> '')
            SELECT @ItemCount = COUNT(*) FROM OPENJSON(@ChecklistItemsJson)
             WHERE LTRIM(RTRIM(CAST(value AS NVARCHAR(500)))) <> '';

        IF (@ItemCount = 0)
        BEGIN SET @ResponseCode = 400;
              SET @ResponseMess = 'At least one checklist item is required';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

        INSERT INTO @PermTable
        EXEC dbo.sp_CheckTaskPermission
            @TaskId = NULL, @WorkspaceId = @WorkspaceId, @CommentId = NULL,
            @UserId = @CreatedByUserId, @Action = 'create_task',
            @IsAdmin = @IsAdmin, @CompId = @CompId;
    END
    ELSE
    BEGIN
        SELECT @OldTitle = Title, @OldPriority = Priority, @OldDueDate = DueDate,
               @OldDescription = Description
          FROM dbo.tblTasks WHERE Id = @Id;
        INSERT INTO @OldAssignees (UserId) SELECT UserId FROM dbo.tblTaskAssignee WHERE TaskId = @Id;

        INSERT INTO @PermTable
        EXEC dbo.sp_CheckTaskPermission
            @TaskId = @Id, @WorkspaceId = NULL, @CommentId = NULL,
            @UserId = @CreatedByUserId, @Action = 'edit_fields',
            @IsAdmin = @IsAdmin, @CompId = @CompId;
    END

    IF NOT EXISTS (SELECT 1 FROM @PermTable WHERE Allowed = 1)
    BEGIN
        DECLARE @Reason VARCHAR(400) = (SELECT TOP 1 Reason FROM @PermTable);
        SET @ResponseCode = 403;
        SET @ResponseMess = 'Permission denied: ' + ISNULL(@Reason, 'no reason');
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
    END

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @PrimaryAssignee INT = (SELECT MIN(UserId) FROM @Assignees);

        IF (@Id = 0)
        BEGIN
            -- (c) Same first/last rule as sp_MoveTaskColumn. No column, or the
            -- "done" column on a 2+ column board, means the first column.
            DECLARE @FirstCol INT, @LastCol INT;
            SELECT TOP 1 @FirstCol = Id FROM dbo.tblKanbanColumns
             WHERE WorkspaceId = @WorkspaceId AND IsActive = 1 ORDER BY SortOrder ASC, Id ASC;
            SELECT TOP 1 @LastCol = Id FROM dbo.tblKanbanColumns
             WHERE WorkspaceId = @WorkspaceId AND IsActive = 1 ORDER BY SortOrder DESC, Id DESC;
            IF (@ColumnId IS NULL OR @ColumnId <= 0
                OR (@ColumnId = @LastCol AND @FirstCol <> @LastCol))
                SET @ColumnId = @FirstCol;

            INSERT INTO dbo.tblTasks
                (Title, Description, WorkspaceId, ColumnId, ProjectId, ParentTaskId,
                 AssignedToUserId, CreatedByUserId, TeamId, Priority, Type,
                 DueDate, EstimatedHours, LoggedHours, Progress, IsBlocked,
                 IsCompleted, Labels, Watchers,
                 CompletedDate, CompletedByUserId, UpdatedDate)
            VALUES
                (@Title, @Description, @WorkspaceId, @ColumnId, @ProjectId, @ParentTaskId,
                 @PrimaryAssignee, @CreatedByUserId, @TeamId, @Priority, @Type,
                 @DueDate, @EstimatedHours, @LoggedHours, @Progress, @IsBlocked,
                 0, @Labels, @Watchers,
                 NULL, NULL, GETDATE());

            SET @Id = SCOPE_IDENTITY();

            INSERT INTO dbo.tblTaskAssignee (TaskId, UserId, AssignedByUserId)
            OUTPUT inserted.UserId INTO @NewAssignees (UserId)
            SELECT @Id, UserId, @CreatedByUserId FROM @Assignees;

            -- Insert checklist items from JSON payload.
            IF (@ChecklistItemsJson IS NOT NULL AND @ChecklistItemsJson <> '')
            BEGIN
                ;WITH items AS (
                    SELECT LTRIM(RTRIM(CAST(value AS NVARCHAR(500)))) AS ItemText,
                           ROW_NUMBER() OVER (ORDER BY [key]) AS SortOrder
                      FROM OPENJSON(@ChecklistItemsJson)
                )
                INSERT INTO dbo.tblTaskChecklist (TaskId, ItemText, IsCompleted, SortOrder)
                SELECT @Id, ItemText, 0, SortOrder
                  FROM items
                 WHERE ItemText <> '';
            END

            -- Delivery receipts for EVERY assignee (shared/project only).
            IF (@WsTypeChk IN ('shared','project'))
                INSERT INTO dbo.tblTaskReads (TaskId, UserId, DeliveredAt)
                SELECT @Id, a.UserId, GETDATE()
                  FROM @Assignees a
                 WHERE NOT EXISTS (SELECT 1 FROM dbo.tblTaskReads r
                                    WHERE r.TaskId = @Id AND r.UserId = a.UserId);

            COMMIT TRANSACTION;
            SET @ResponseCode = 201; SET @ResponseMess = 'Task created';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, @Id AS TaskId;

            -- 2nd result set: who was newly assigned, for the caller to notify.
            SELECT UserId AS NewAssigneeUserId FROM @NewAssignees;
        END
        ELSE
        BEGIN
            UPDATE dbo.tblTasks
               SET Title = @Title,
                   Description = @Description,
                   ProjectId = @ProjectId,
                   ParentTaskId = @ParentTaskId,
                   TeamId = @TeamId,
                   Priority = @Priority,
                   Type = @Type,
                   DueDate = @DueDate,
                   EstimatedHours = @EstimatedHours,
                   LoggedHours = @LoggedHours,
                   Progress = @Progress,
                   IsBlocked = @IsBlocked,
                   Labels = @Labels,
                   Watchers = @Watchers,
                   UpdatedDate = GETDATE()
             WHERE Id = @Id;

            -- Replace the assignee set only when the caller expressed an
            -- opinion. Drag-and-drop re-sends the whole task without assignee
            -- fields; without this guard it would unassign everyone.
            IF (@HasAssigneeInput = 1)
            BEGIN
                DELETE FROM dbo.tblTaskAssignee
                 WHERE TaskId = @Id
                   AND UserId NOT IN (SELECT UserId FROM @Assignees);

                INSERT INTO dbo.tblTaskAssignee (TaskId, UserId, AssignedByUserId)
                OUTPUT inserted.UserId INTO @NewAssignees (UserId)
                SELECT @Id, a.UserId, @CreatedByUserId
                  FROM @Assignees a
                 WHERE NOT EXISTS (SELECT 1 FROM dbo.tblTaskAssignee ta
                                    WHERE ta.TaskId = @Id AND ta.UserId = a.UserId);

                -- Reassignment now seeds receipts too; it never did before.
                IF (@WsTypeChk IN ('shared','project'))
                    INSERT INTO dbo.tblTaskReads (TaskId, UserId, DeliveredAt)
                    SELECT @Id, a.UserId, GETDATE()
                      FROM @Assignees a
                     WHERE NOT EXISTS (SELECT 1 FROM dbo.tblTaskReads r
                                        WHERE r.TaskId = @Id AND r.UserId = a.UserId);
            END

            -- Keep the legacy mirror in step with the set. Nothing reads this
            -- to make a decision; it exists so display code and older clients
            -- keep working until the column is dropped.
            UPDATE dbo.tblTasks
               SET AssignedToUserId = (SELECT MIN(UserId) FROM dbo.tblTaskAssignee WHERE TaskId = @Id)
             WHERE Id = @Id;

            COMMIT TRANSACTION;
            SET @ResponseCode = 200; SET @ResponseMess = 'Task updated';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, @Id AS TaskId;

            -- 2nd result set: who was newly assigned, for the caller to notify.
            SELECT UserId AS NewAssigneeUserId FROM @NewAssignees;

            -- 3rd result set: what this edit changed, display-ready, for task history (094).
            SELECT Field, OldValue, NewValue FROM (
                SELECT 'Title' AS Field, CAST(@OldTitle AS NVARCHAR(MAX)) AS OldValue,
                       CAST(@Title AS NVARCHAR(MAX)) AS NewValue
                 WHERE ISNULL(@OldTitle, '') <> ISNULL(@Title, '')
                UNION ALL
                SELECT 'Priority', @OldPriority, @Priority
                 WHERE ISNULL(@OldPriority, '') <> ISNULL(@Priority, '')
                UNION ALL
                SELECT 'DueDate',
                       ISNULL(CONVERT(NVARCHAR(10), @OldDueDate, 105), N'none'),
                       ISNULL(CONVERT(NVARCHAR(10), @DueDate, 105), N'none')
                 WHERE ISNULL(@OldDueDate, '19000101') <> ISNULL(@DueDate, '19000101')
                UNION ALL
                SELECT 'Description', NULL, NULL
                 WHERE ISNULL(@OldDescription, N'') <> ISNULL(@Description, N'')
                UNION ALL
                SELECT 'AssigneesAdded', NULL,
                       (SELECT STRING_AGG(u.FullName, ', ') FROM tblTaskAssignee ta
                          JOIN tblUser u ON u.Id = ta.UserId
                         WHERE ta.TaskId = @Id
                           AND ta.UserId NOT IN (SELECT UserId FROM @OldAssignees))
                 WHERE @HasAssigneeInput = 1
                   AND EXISTS (SELECT 1 FROM tblTaskAssignee ta WHERE ta.TaskId = @Id
                                AND ta.UserId NOT IN (SELECT UserId FROM @OldAssignees))
                UNION ALL
                SELECT 'AssigneesRemoved',
                       (SELECT STRING_AGG(u.FullName, ', ') FROM @OldAssignees o
                          JOIN tblUser u ON u.Id = o.UserId
                         WHERE o.UserId NOT IN (SELECT UserId FROM tblTaskAssignee WHERE TaskId = @Id)),
                       NULL
                 WHERE @HasAssigneeInput = 1
                   AND EXISTS (SELECT 1 FROM @OldAssignees o
                                WHERE o.UserId NOT IN (SELECT UserId FROM tblTaskAssignee WHERE TaskId = @Id))
            ) ch;
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


-- ===========================================================================
-- A17. sp_AddTaskDependency — a deleted task cannot be a blocker (item 1)
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- 4. sp_AddTaskDependency — only the dependent task was permission-checked;
--    the blocking task could be any id in any company, and
--    sp_FetchTaskDependencies then showed its title. Both must now sit in the
--    same workspace (which is all either client's picker ever offered).
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_AddTaskDependency
    @TaskId           BIGINT,
    @DependsOnTaskId  BIGINT,
    @Type             VARCHAR(20) = 'blocks',
    @ActingUserId     INT,
    @IsAdmin          BIT = 0,
    @CompId           BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);

    IF (@TaskId IS NULL OR @TaskId <= 0 OR @DependsOnTaskId IS NULL OR @DependsOnTaskId <= 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'TaskId and DependsOnTaskId are required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@TaskId = @DependsOnTaskId)
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'A task cannot depend on itself';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    DECLARE @TaskWs BIGINT, @BlockerWs BIGINT;
    SELECT @TaskWs    = WorkspaceId FROM dbo.tblTasks WHERE Id = @TaskId;
    SELECT @BlockerWs = WorkspaceId FROM dbo.tblTasks WHERE Id = @DependsOnTaskId AND IsDeleted = 0;

    -- One 404 for "missing" and "elsewhere": a different answer would tell the
    -- caller that a task id exists in someone else's workspace.
    IF (@TaskWs IS NULL OR @BlockerWs IS NULL OR @TaskWs <> @BlockerWs)
    BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Task(s) not found in this workspace';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    DECLARE @Perm TABLE (Allowed BIT, Reason VARCHAR(400));
    INSERT INTO @Perm
    EXEC dbo.sp_CheckTaskPermission
        @TaskId = @TaskId, @WorkspaceId = NULL, @CommentId = NULL,
        @UserId = @ActingUserId, @Action = 'add_dependency',
        @IsAdmin = @IsAdmin, @CompId = @CompId;
    IF NOT EXISTS (SELECT 1 FROM @Perm WHERE Allowed = 1)
    BEGIN SET @ResponseCode = 403;
          SET @ResponseMess = 'Permission denied: ' + ISNULL((SELECT TOP 1 Reason FROM @Perm), 'no reason');
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF EXISTS (SELECT 1 FROM dbo.tblTaskDependencies
                WHERE TaskId = @TaskId AND DependsOnTaskId = @DependsOnTaskId)
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Dependency already exists';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    DECLARE @Visited TABLE (TaskId BIGINT PRIMARY KEY);
    DECLARE @Frontier TABLE (TaskId BIGINT);
    INSERT INTO @Frontier VALUES (@DependsOnTaskId);
    DECLARE @Cycle BIT = 0;

    WHILE EXISTS (SELECT 1 FROM @Frontier) AND @Cycle = 0
    BEGIN
        DECLARE @Next TABLE (TaskId BIGINT);
        INSERT INTO @Next
        SELECT DISTINCT d.DependsOnTaskId
          FROM dbo.tblTaskDependencies d
         WHERE d.TaskId IN (SELECT TaskId FROM @Frontier)
           AND d.DependsOnTaskId NOT IN (SELECT TaskId FROM @Visited);

        IF EXISTS (SELECT 1 FROM @Next WHERE TaskId = @TaskId) SET @Cycle = 1;

        INSERT INTO @Visited SELECT TaskId FROM @Frontier;
        DELETE FROM @Frontier;
        INSERT INTO @Frontier SELECT TaskId FROM @Next;
        DELETE FROM @Next;
    END

    IF (@Cycle = 1)
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Dependency would create a cycle';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    INSERT INTO dbo.tblTaskDependencies (TaskId, DependsOnTaskId, Type, CreatedByUserId)
    VALUES (@TaskId, @DependsOnTaskId, @Type, @ActingUserId);

    IF (@Type = 'blocks')
        UPDATE dbo.tblTasks
           SET IsBlocked = 1, UpdatedDate = GETDATE()
         WHERE Id = @TaskId
           AND EXISTS (
               SELECT 1 FROM dbo.tblTaskDependencies d
               JOIN dbo.tblTasks b ON b.Id = d.DependsOnTaskId
              WHERE d.TaskId = @TaskId AND d.Type = 'blocks'
                AND ISNULL(b.IsCompleted, 0) = 0
           );

    SET @ResponseCode = 201; SET @ResponseMess = 'Dependency added';
    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
           @TaskId AS TaskId, @DependsOnTaskId AS DependsOnTaskId, @Type AS Type;
END
GO


-- ===========================================================================
-- A18. sp_FetchTimeEntry — company + personal-board privacy (item 15)
-- ===========================================================================
-- 066_time_entries_workspace_tasks.sql
--
-- Fix: sp_FetchTimeEntry returns nothing for a workspace task.
--
-- The list query joins tblProjects with an INNER JOIN:
--
--     INNER JOIN tblProjects p ON t.ProjectId = p.Id
--
-- tblTasks.ProjectId is NULLable and every task created in a workspace has it
-- NULL, so the join drops the row and the caller sees an empty time log even
-- though the entry was written. Logging time then reading it back is the
-- normal flow, so the feature is dead for workspace tasks.
--
-- The join exists only to reach p.BranchId for the branch-scope filter. That
-- makes it a filter, not a gate — the same rule already applied to
-- sp_FetchTask, where AND-ing branch scope with membership blinded
-- cross-branch workspace members (see ROLES.md). Workspace tasks are
-- membership-governed and carry no branch of their own; tblTasks has neither
-- CompId nor BranchId.
--
-- Fix: LEFT JOIN, and let a task with no project through the scope predicate.
-- A project task still filters exactly as before.
--
-- No schema change. Nothing else calls this procedure.

CREATE OR ALTER PROCEDURE sp_FetchTimeEntry
    @Id BIGINT,
    @TaskId BIGINT,
    @UserId INT,
    @CompId BIGINT,
    @BranchId BIGINT,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @PageNumber INT = 1,
    @PageSize INT = 25,
    @SearchTerm NVARCHAR(200) = NULL,
    @ViewerUserId INT = NULL     -- the caller; personal-board entries are theirs only (094)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @TotalRecords INT, @TotalPages INT, @Offset INT;

    DECLARE @BranchIds TABLE (BranchId BIGINT);
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
        INSERT INTO @BranchIds (BranchId)
        SELECT CAST(value AS BIGINT) FROM OPENJSON(@AccessibleBranchIdsJson);
    DECLARE @UseScope BIT = CASE WHEN @AccessibleBranchIdsJson IS NULL OR @AccessibleBranchIdsJson = '' THEN 0 ELSE 1 END;

    IF (@Id <> 0)
    BEGIN
        -- 094: the single fetch obeys the list's company + personal-privacy
        -- filter too; anything outside it is a 404, never a leak.
        IF EXISTS (SELECT 1 FROM tblTimeEntries te
                    INNER JOIN tblTasks t ON te.TaskId = t.Id
                    WHERE te.Id = @Id
                      AND EXISTS (SELECT 1 FROM dbo.tblWorkspaces w
                                   WHERE w.Id = t.WorkspaceId AND w.CompId = @CompId
                                     AND (w.Type <> 'personal' OR w.OwnerUserId = @ViewerUserId)))
            SELECT 200 AS ResponseCode, 'OK' AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   te.Id, te.TaskId, te.UserId, te.Hours, te.Description, te.WorkDate, te.CreatedDate,
                   t.Title AS TaskTitle, u.FullName AS UserName
            FROM tblTimeEntries te
            INNER JOIN tblTasks t ON te.TaskId = t.Id
            INNER JOIN tblUser u  ON te.UserId = u.Id
            WHERE te.Id = @Id
              AND EXISTS (SELECT 1 FROM dbo.tblWorkspaces w
                           WHERE w.Id = t.WorkspaceId AND w.CompId = @CompId
                             AND (w.Type <> 'personal' OR w.OwnerUserId = @ViewerUserId));
        ELSE
            SELECT 404 AS ResponseCode, 'Time entry not found' AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   NULL AS Id, NULL AS TaskId, NULL AS UserId, NULL AS Hours,
                   NULL AS Description, NULL AS WorkDate, NULL AS CreatedDate,
                   NULL AS TaskTitle, NULL AS UserName;
        RETURN;
    END

    SET @Offset = (@PageNumber - 1) * @PageSize;

    SELECT @TotalRecords = COUNT(*)
    FROM tblTimeEntries te
    INNER JOIN tblTasks t ON te.TaskId = t.Id
    LEFT  JOIN tblProjects p ON t.ProjectId = p.Id
    INNER JOIN tblUser u  ON te.UserId = u.Id
    WHERE (@TaskId IS NULL OR te.TaskId = @TaskId)
      AND (@UserId IS NULL OR te.UserId = @UserId)
      -- 094: never another company's entries, never someone else's personal board.
      AND EXISTS (SELECT 1 FROM dbo.tblWorkspaces w
                   WHERE w.Id = t.WorkspaceId AND w.CompId = @CompId
                     AND (w.Type <> 'personal' OR w.OwnerUserId = @ViewerUserId))
      -- p.Id IS NULL = a workspace task, which has no branch to scope by.
      AND (@UseScope = 0 OR p.Id IS NULL OR p.BranchId IN (SELECT BranchId FROM @BranchIds))
      AND (@SearchTerm IS NULL OR te.Description LIKE '%' + @SearchTerm + '%' OR t.Title LIKE '%' + @SearchTerm + '%' OR u.FullName LIKE '%' + @SearchTerm + '%');

    SET @TotalPages = CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize);

    SELECT 200 AS ResponseCode, 'Time entries retrieved successfully' AS ResponseMess,
           @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
           @PageNumber AS CurrentPage, @PageSize AS PageSize,
           te.Id, te.TaskId, te.UserId, te.Hours, te.Description, te.WorkDate, te.CreatedDate,
           t.Title AS TaskTitle, u.FullName AS UserName
    FROM tblTimeEntries te
    INNER JOIN tblTasks t ON te.TaskId = t.Id
    LEFT  JOIN tblProjects p ON t.ProjectId = p.Id
    INNER JOIN tblUser u  ON te.UserId = u.Id
    WHERE (@TaskId IS NULL OR te.TaskId = @TaskId)
      AND (@UserId IS NULL OR te.UserId = @UserId)
      AND EXISTS (SELECT 1 FROM dbo.tblWorkspaces w
                   WHERE w.Id = t.WorkspaceId AND w.CompId = @CompId
                     AND (w.Type <> 'personal' OR w.OwnerUserId = @ViewerUserId))
      AND (@UseScope = 0 OR p.Id IS NULL OR p.BranchId IN (SELECT BranchId FROM @BranchIds))
      AND (@SearchTerm IS NULL OR te.Description LIKE '%' + @SearchTerm + '%' OR t.Title LIKE '%' + @SearchTerm + '%' OR u.FullName LIKE '%' + @SearchTerm + '%')
    ORDER BY te.WorkDate DESC, te.CreatedDate DESC
    OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
END
GO


-- ===========================================================================
-- A19. sp_ClaimTask — NEW, "Take this task" (item 10)
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- A19. sp_ClaimTask (NEW) — "Take this task".
--    claim_task in sp_CheckTaskPermission: owner/manager/member of the board
--    (not a viewer) on a task with nobody assigned. An admin bypasses the
--    permission but must still be someone who can hold a task (A16 rule).
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_ClaimTask
    @TaskId  BIGINT,
    @UserId  INT,
    @IsAdmin BIT = 0,
    @CompId  BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @WsId BIGINT, @WsType VARCHAR(20), @Done BIT;

    SELECT @WsId = t.WorkspaceId, @WsType = w.Type, @Done = t.IsCompleted
      FROM dbo.tblTasks t
      JOIN dbo.tblWorkspaces w ON w.Id = t.WorkspaceId
     WHERE t.Id = @TaskId AND t.IsDeleted = 0 AND w.CompId = @CompId;

    IF (@WsId IS NULL)
    BEGIN SELECT 404 AS ResponseCode, 'Task not found' AS ResponseMess; RETURN; END

    IF EXISTS (SELECT 1 FROM dbo.tblTaskAssignee WHERE TaskId = @TaskId)
    BEGIN SELECT 409 AS ResponseCode, 'Someone already has this task' AS ResponseMess; RETURN; END

    IF (@Done = 1)
    BEGIN SELECT 409 AS ResponseCode, 'This task is already complete' AS ResponseMess; RETURN; END

    DECLARE @Perm TABLE (Allowed BIT, Reason VARCHAR(400));
    INSERT INTO @Perm
    EXEC dbo.sp_CheckTaskPermission
        @TaskId = @TaskId, @WorkspaceId = NULL, @CommentId = NULL,
        @UserId = @UserId, @Action = 'claim_task',
        @IsAdmin = @IsAdmin, @CompId = @CompId;
    IF NOT EXISTS (SELECT 1 FROM @Perm WHERE Allowed = 1)
    BEGIN SELECT 403 AS ResponseCode,
                 'Permission denied: ' + ISNULL((SELECT TOP 1 Reason FROM @Perm), 'no reason') AS ResponseMess;
          RETURN; END

    IF (@WsType IN ('shared','project')
        AND NOT EXISTS (SELECT 1 FROM dbo.tblWorkspaceMembers
                         WHERE WorkspaceId = @WsId AND UserId = @UserId
                           AND IsActive = 1 AND InviteStatus = 'active' AND Role <> 'viewer'))
    BEGIN SELECT 400 AS ResponseCode, 'Only a member of this board can take its tasks' AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;

        -- Two people pressing "Take" together: the lock makes the second see the first.
        IF EXISTS (SELECT 1 FROM dbo.tblTaskAssignee WITH (UPDLOCK, HOLDLOCK) WHERE TaskId = @TaskId)
        BEGIN
            ROLLBACK TRANSACTION;
            SELECT 409 AS ResponseCode, 'Someone already has this task' AS ResponseMess;
            RETURN;
        END

        INSERT INTO dbo.tblTaskAssignee (TaskId, UserId, AssignedByUserId)
        VALUES (@TaskId, @UserId, @UserId);

        UPDATE dbo.tblTasks
           SET AssignedToUserId = @UserId, UpdatedDate = GETDATE()
         WHERE Id = @TaskId;

        IF (@WsType IN ('shared','project')
            AND NOT EXISTS (SELECT 1 FROM dbo.tblTaskReads WHERE TaskId = @TaskId AND UserId = @UserId))
            INSERT INTO dbo.tblTaskReads (TaskId, UserId, DeliveredAt)
            VALUES (@TaskId, @UserId, GETDATE());

        COMMIT TRANSACTION;
        SELECT 200 AS ResponseCode, 'Task taken' AS ResponseMess,
               @TaskId AS TaskId, @WsId AS WorkspaceId;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT 500 AS ResponseCode, 'Claim failed: ' + ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO


-- ===========================================================================
-- B3. sp_NotifyTaskCompletion — NEW, completion/reopen/unblock notifications (item 7)
-- ===========================================================================
-- Notifies on a completion transition. Called by taskController AFTER the
-- checklist SP commits — same shape as sp_NotifyTaskAssigned / sp_NotifyCommentAdded.
-- Returns ONE result set: who was actually notified, for realtime emitToUser.
CREATE OR ALTER PROCEDURE dbo.sp_NotifyTaskCompletion
    @TaskId      BIGINT,
    @ActorUserId INT,
    @Event       VARCHAR(10)          -- 'completed' | 'reopened'
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Title VARCHAR(500), @CompId BIGINT, @BranchId BIGINT, @WsType VARCHAR(20);
    DECLARE @ActorName VARCHAR(200);
    DECLARE @Sent TABLE (ResponseCode INT, ResponseMess VARCHAR(400),
                         NotificationId BIGINT, UserId INT, Type VARCHAR(40));

    SELECT @Title = t.Title, @CompId = w.CompId, @BranchId = w.BranchId, @WsType = w.Type
      FROM dbo.tblTasks t
      JOIN dbo.tblWorkspaces w ON w.Id = t.WorkspaceId
     WHERE t.Id = @TaskId AND t.IsDeleted = 0;

    -- Personal = owner-only: nobody else to tell.
    IF (@WsType IS NULL OR @WsType = 'personal' OR @Event NOT IN ('completed','reopened'))
    BEGIN
        SELECT UserId, NotificationId, Type FROM @Sent;
        RETURN;
    END

    SELECT @ActorName = FullName FROM dbo.tblUser WHERE Id = @ActorUserId;

    DECLARE @Type VARCHAR(40) = CASE @Event WHEN 'completed' THEN 'task_completed' ELSE 'task_reopened' END;
    DECLARE @NTitle VARCHAR(200) = CASE @Event WHEN 'completed' THEN 'Task completed' ELSE 'Task reopened' END;
    DECLARE @NBody NVARCHAR(1000) = LEFT(ISNULL(@ActorName, 'Someone')
        + CASE @Event WHEN 'completed' THEN ' completed: ' ELSE ' reopened: ' END
        + ISNULL(@Title, ''), 1000);

    -- Creator + everyone who assigned a current assignee. Actor excluded
    -- (sp_CreateNotification also skips self; this keeps the cursor short).
    DECLARE @To TABLE (UserId INT PRIMARY KEY);
    INSERT INTO @To (UserId)
    SELECT DISTINCT UserId FROM (
        SELECT CreatedByUserId AS UserId FROM dbo.tblTasks WHERE Id = @TaskId
        UNION
        SELECT AssignedByUserId FROM dbo.tblTaskAssignee WHERE TaskId = @TaskId
    ) s
    WHERE UserId IS NOT NULL AND UserId <> @ActorUserId;

    DECLARE @U INT;
    DECLARE cur CURSOR FAST_FORWARD LOCAL FOR SELECT UserId FROM @To;
    OPEN cur; FETCH NEXT FROM cur INTO @U;
    WHILE (@@FETCH_STATUS = 0)
    BEGIN
        INSERT INTO @Sent
        EXEC dbo.sp_CreateNotification
             @UserId = @U, @Type = @Type, @EntityType = 'task', @EntityId = @TaskId,
             @ActorUserId = @ActorUserId, @Title = @NTitle, @Body = @NBody,
             @CompId = @CompId, @BranchId = @BranchId, @SkipSelf = 1;
        FETCH NEXT FROM cur INTO @U;
    END
    CLOSE cur; DEALLOCATE cur;

    -- A finished blocker frees its dependents: tell their assignees, but only
    -- for dependents with no OTHER open blocker left.
    IF (@Event = 'completed')
    BEGIN
        DECLARE @DepId BIGINT, @DepTitle VARCHAR(500), @DepComp BIGINT, @DepBranch BIGINT;
        DECLARE dcur CURSOR FAST_FORWARD LOCAL FOR
            SELECT DISTINCT d.TaskId, ta.UserId, dt.Title, dw.CompId, dw.BranchId
              FROM dbo.tblTaskDependencies d
              JOIN dbo.tblTasks dt       ON dt.Id = d.TaskId
                                        AND ISNULL(dt.IsCompleted, 0) = 0 AND dt.IsDeleted = 0
              JOIN dbo.tblWorkspaces dw  ON dw.Id = dt.WorkspaceId AND dw.IsArchived = 0
              JOIN dbo.tblTaskAssignee ta ON ta.TaskId = d.TaskId
             WHERE d.DependsOnTaskId = @TaskId AND d.Type = 'blocks'
               AND ta.UserId <> @ActorUserId
               AND NOT EXISTS (SELECT 1 FROM dbo.tblTaskDependencies d2
                                 JOIN dbo.tblTasks b ON b.Id = d2.DependsOnTaskId
                                WHERE d2.TaskId = d.TaskId AND d2.Type = 'blocks'
                                  AND ISNULL(b.IsCompleted, 0) = 0);
        OPEN dcur; FETCH NEXT FROM dcur INTO @DepId, @U, @DepTitle, @DepComp, @DepBranch;
        WHILE (@@FETCH_STATUS = 0)
        BEGIN
            DECLARE @UBody NVARCHAR(1000) =
                LEFT(ISNULL(@Title, '') + N' is done — you can start: ' + ISNULL(@DepTitle, ''), 1000);
            INSERT INTO @Sent
            EXEC dbo.sp_CreateNotification
                 @UserId = @U, @Type = 'task_unblocked', @EntityType = 'task', @EntityId = @DepId,
                 @ActorUserId = @ActorUserId, @Title = 'Task unblocked', @Body = @UBody,
                 @CompId = @DepComp, @BranchId = @DepBranch, @SkipSelf = 1;
            FETCH NEXT FROM dcur INTO @DepId, @U, @DepTitle, @DepComp, @DepBranch;
        END
        CLOSE dcur; DEALLOCATE dcur;
    END

    SELECT UserId, NotificationId, Type FROM @Sent WHERE NotificationId IS NOT NULL;
END
GO


-- ===========================================================================
-- B4. sp_NotifyCommentAdded — comment notifications open the task (item 6)
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- 8. sp_NotifyCommentAdded — fan out to EVERY assignee.
--    One-line swap in the UNION; @Recipients' PK and the cursor already handle
--    dedupe and iteration.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_NotifyCommentAdded
    @CommentId    BIGINT,
    @ActorUserId  INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @TaskId BIGINT, @Parent BIGINT, @CompId BIGINT, @BranchId BIGINT;
    DECLARE @TaskTitle VARCHAR(500), @ActorName VARCHAR(200), @WsType VARCHAR(20);

    SELECT @TaskId = c.TaskId, @Parent = c.ParentCommentId
      FROM dbo.tblTaskComments c
     WHERE c.Id = @CommentId;

    IF (@TaskId IS NULL) RETURN;

    SELECT @TaskTitle = t.Title,
           @CompId    = ISNULL(w.CompId, p.CompId),
           @BranchId  = ISNULL(w.BranchId, p.BranchId),
           @WsType    = w.Type
      FROM dbo.tblTasks t
      LEFT JOIN dbo.tblWorkspaces w ON w.Id = t.WorkspaceId
      LEFT JOIN dbo.tblProjects   p ON p.Id = t.ProjectId
     WHERE t.Id = @TaskId;

    IF (@WsType = 'personal') RETURN;

    SELECT @ActorName = FullName FROM dbo.tblUser WHERE Id = @ActorUserId;

    DECLARE @NotifBody NVARCHAR(1000) =
        ISNULL(@ActorName, 'Someone') + ' commented on: ' + ISNULL(@TaskTitle, '');

    DECLARE @Recipients TABLE (UserId INT PRIMARY KEY, IsReply BIT);

    INSERT INTO @Recipients (UserId, IsReply)
    SELECT DISTINCT UserId, 0 FROM (
        SELECT CreatedByUserId AS UserId FROM dbo.tblTasks WHERE Id = @TaskId
        UNION
        -- every assignee, not just the mirrored one (063)
        SELECT UserId FROM dbo.tblTaskAssignee WHERE TaskId = @TaskId
    ) s
    WHERE UserId IS NOT NULL AND UserId <> @ActorUserId;

    IF (@Parent IS NOT NULL AND @Parent > 0)
    BEGIN
        DECLARE @ParentAuthor INT;
        SELECT @ParentAuthor = UserId FROM dbo.tblTaskComments WHERE Id = @Parent;
        IF (@ParentAuthor IS NOT NULL AND @ParentAuthor <> @ActorUserId)
        BEGIN
            IF EXISTS (SELECT 1 FROM @Recipients WHERE UserId = @ParentAuthor)
                UPDATE @Recipients SET IsReply = 1 WHERE UserId = @ParentAuthor;
            ELSE
                INSERT INTO @Recipients (UserId, IsReply) VALUES (@ParentAuthor, 1);
        END
    END

    DECLARE @UserId INT, @IsReply BIT;
    DECLARE @NotifType VARCHAR(40), @NotifTitle VARCHAR(200);
    DECLARE cur CURSOR FAST_FORWARD LOCAL FOR
        SELECT UserId, IsReply FROM @Recipients;
    OPEN cur;
    FETCH NEXT FROM cur INTO @UserId, @IsReply;
    WHILE (@@FETCH_STATUS = 0)
    BEGIN
        SET @NotifType  = CASE WHEN @IsReply = 1 THEN 'reply'     ELSE 'comment_added' END;
        SET @NotifTitle = CASE WHEN @IsReply = 1 THEN 'New reply' ELSE 'New comment'   END;

        EXEC dbo.sp_CreateNotification
            @UserId      = @UserId,
            @Type        = @NotifType,
            @EntityType  = 'task',      -- a comment is opened BY opening its task (094)
            @EntityId    = @TaskId,
            @ActorUserId = @ActorUserId,
            @Title       = @NotifTitle,
            @Body        = @NotifBody,
            @CompId      = @CompId,
            @BranchId    = @BranchId,
            @SkipSelf    = 1;
        FETCH NEXT FROM cur INTO @UserId, @IsReply;
    END
    CLOSE cur; DEALLOCATE cur;
END
GO


-- ===========================================================================
-- C·S1. sp_FetchKanbanColumn — membership gate, branch scope gone, count skips deleted (item 14)
-- ===========================================================================
CREATE OR ALTER PROCEDURE dbo.sp_FetchKanbanColumn
    @Id                      INT           = 0,
    @WorkspaceId             BIGINT        = NULL,
    @CompId                  BIGINT,
    @BranchId                BIGINT,                 -- accepted, intentionally unused (094)
    @IsAdmin                 BIT           = 0,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,   -- accepted, intentionally unused (094)
    @PageNumber              INT           = 1,
    @PageSize                INT           = 200,
    @SearchTerm              NVARCHAR(200) = NULL,
    @UserId                  INT           = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @TotalRecords INT, @TotalPages INT, @Offset INT;

    SET @Offset = (@PageNumber - 1) * @PageSize;

    SELECT @TotalRecords = COUNT(*)
      FROM dbo.tblKanbanColumns kc
     WHERE (@Id = 0 OR kc.Id = @Id)
       AND (@WorkspaceId IS NULL OR kc.WorkspaceId = @WorkspaceId)
       AND kc.CompId = @CompId
       AND kc.IsActive = 1
       -- Same gate as sp_CheckTaskPermission 'view_task'. Branch is not part of it:
       -- a column carries its creator's branch, which hid whole boards from
       -- cross-branch members (B10, 094).
       AND EXISTS (SELECT 1 FROM dbo.tblWorkspaces w2
                    WHERE w2.Id = kc.WorkspaceId AND w2.CompId = @CompId
                      AND (   (w2.Type = 'personal' AND w2.OwnerUserId = @UserId)
                           OR (w2.Type <> 'personal'
                               AND (@IsAdmin = 1
                                    OR EXISTS (SELECT 1 FROM dbo.tblWorkspaceMembers m
                                                WHERE m.WorkspaceId = w2.Id AND m.UserId = @UserId
                                                  AND m.IsActive = 1 AND m.InviteStatus = 'active')))))
       AND (@SearchTerm IS NULL OR kc.Title LIKE '%' + @SearchTerm + '%');

    SET @TotalPages = CASE WHEN @PageSize > 0
                           THEN CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize)
                           ELSE 0 END;

    SELECT 200 AS ResponseCode, 'Kanban columns fetched' AS ResponseMess,
           @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
           @PageNumber AS CurrentPage, @PageSize AS PageSize,
           kc.Id, kc.WorkspaceId, w.Name AS WorkspaceName,
           kc.Title, kc.Color, kc.SortOrder, kc.MaxTasks,
           kc.IsActive, kc.IsCompanyWide, kc.CompId, kc.BranchId, kc.CreatedDate,
           (SELECT COUNT(*) FROM dbo.tblTasks t
             WHERE t.ColumnId = kc.Id AND t.IsDeleted = 0) AS TaskCount
      FROM dbo.tblKanbanColumns kc
      LEFT JOIN dbo.tblWorkspaces w ON w.Id = kc.WorkspaceId
     WHERE (@Id = 0 OR kc.Id = @Id)
       AND (@WorkspaceId IS NULL OR kc.WorkspaceId = @WorkspaceId)
       AND kc.CompId = @CompId
       AND kc.IsActive = 1
       -- Same gate as sp_CheckTaskPermission 'view_task'. Branch is not part of it:
       -- a column carries its creator's branch, which hid whole boards from
       -- cross-branch members (B10, 094).
       AND EXISTS (SELECT 1 FROM dbo.tblWorkspaces w2
                    WHERE w2.Id = kc.WorkspaceId AND w2.CompId = @CompId
                      AND (   (w2.Type = 'personal' AND w2.OwnerUserId = @UserId)
                           OR (w2.Type <> 'personal'
                               AND (@IsAdmin = 1
                                    OR EXISTS (SELECT 1 FROM dbo.tblWorkspaceMembers m
                                                WHERE m.WorkspaceId = w2.Id AND m.UserId = @UserId
                                                  AND m.IsActive = 1 AND m.InviteStatus = 'active')))))
       AND (@SearchTerm IS NULL OR kc.Title LIKE '%' + @SearchTerm + '%')
     ORDER BY kc.WorkspaceId, kc.SortOrder, kc.Id
     OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
END
GO


-- ===========================================================================
-- C·S2. sp_SaveKanbanColumn — invite state, no delete-by-IsActive, no resurrect (item 14)
-- ===========================================================================
CREATE OR ALTER PROCEDURE dbo.sp_SaveKanbanColumn
    @Id          INT          = 0,
    @WorkspaceId BIGINT,
    @Title       VARCHAR(100),
    @Color       VARCHAR(20)  = NULL,
    @SortOrder   INT          = 0,
    @MaxTasks    INT          = NULL,
    @IsActive    BIT          = 1,
    @UserId      INT,
    @IsAdmin     BIT          = 0,
    @CompId      BIGINT,
    @BranchId    BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);
    DECLARE @SavedId INT;

    IF (@WorkspaceId IS NULL OR @WorkspaceId <= 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'WorkspaceId is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@Title IS NULL OR LTRIM(RTRIM(@Title)) = '')
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Column title is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- Deleting is sp_DeleteKanbanColumn's job: it moves the column's tasks.
    -- IsActive = 0 here hid the column and orphaned its cards (B16, 094).
    IF (@IsActive = 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Use delete to remove a column';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    DECLARE @WsType VARCHAR(20), @WsOwner INT;
    SELECT @WsType = Type, @WsOwner = OwnerUserId
      FROM dbo.tblWorkspaces
     WHERE Id = @WorkspaceId AND CompId = @CompId;
    IF (@WsType IS NULL)
    BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Workspace not found';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    DECLARE @CanManage BIT = 0;
    IF (@IsAdmin = 1 AND @WsType <> 'personal') SET @CanManage = 1;
    ELSE IF (@WsType = 'personal' AND @WsOwner = @UserId) SET @CanManage = 1;
    ELSE IF (EXISTS (
        SELECT 1 FROM dbo.tblWorkspaceMembers m
         WHERE m.WorkspaceId = @WorkspaceId AND m.UserId = @UserId
           AND m.IsActive = 1 AND m.InviteStatus = 'active'
           AND m.Role IN ('owner','manager')))
        SET @CanManage = 1;

    IF (@CanManage = 0)
    BEGIN SET @ResponseCode = 403; SET @ResponseMess = 'Permission denied';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    BEGIN TRY
        IF (@Id = 0)
        BEGIN
            IF EXISTS (
                SELECT 1 FROM dbo.tblKanbanColumns
                 WHERE WorkspaceId = @WorkspaceId AND Title = @Title AND IsActive = 1
            )
            BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Column with this title already exists';
                  SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

            IF (@SortOrder IS NULL OR @SortOrder = 0)
                SELECT @SortOrder = ISNULL(MAX(SortOrder), 0) + 1
                  FROM dbo.tblKanbanColumns WHERE WorkspaceId = @WorkspaceId;

            INSERT INTO dbo.tblKanbanColumns
                (WorkspaceId, Title, Color, SortOrder, MaxTasks, IsActive,
                 CompId, BranchId, IsCompanyWide)
            VALUES
                (@WorkspaceId, @Title, @Color, @SortOrder, @MaxTasks, @IsActive,
                 @CompId, @BranchId, 0);

            SET @SavedId = SCOPE_IDENTITY();
            SET @ResponseCode = 201; SET @ResponseMess = 'Column created';
        END
        ELSE
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM dbo.tblKanbanColumns
                 WHERE Id = @Id AND WorkspaceId = @WorkspaceId AND IsActive = 1
            )
            BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Column not found';
                  SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

            IF EXISTS (
                SELECT 1 FROM dbo.tblKanbanColumns
                 WHERE WorkspaceId = @WorkspaceId AND Title = @Title
                   AND Id <> @Id AND IsActive = 1
            )
            BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Column with this title already exists';
                  SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

            UPDATE dbo.tblKanbanColumns
               SET Title = @Title, Color = @Color, SortOrder = @SortOrder,
                   MaxTasks = @MaxTasks
             WHERE Id = @Id;

            SET @SavedId = @Id;
            SET @ResponseCode = 200; SET @ResponseMess = 'Column updated';
        END

        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               @SavedId AS ColumnId;
    END TRY
    BEGIN CATCH
        SET @ResponseCode = 500;
        SET @ResponseMess = 'Failed to save column: ' + ERROR_MESSAGE();
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END CATCH
END
GO


-- ===========================================================================
-- C·S3. sp_DeleteKanbanColumn — invite state, last column refused (item 14)
-- ===========================================================================
CREATE OR ALTER PROCEDURE dbo.sp_DeleteKanbanColumn
    @Id                   INT,
    @ReassignToColumnId   INT    = NULL,
    @UserId               INT,
    @IsAdmin              BIT    = 0,
    @CompId               BIGINT,
    @BranchId             BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);
    DECLARE @WorkspaceId BIGINT, @WsType VARCHAR(20), @WsOwner INT;
    DECLARE @ReassignTargetId INT;
    DECLARE @MovedCount INT = 0;

    IF (@Id IS NULL OR @Id <= 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Column Id is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    SELECT @WorkspaceId = kc.WorkspaceId
      FROM dbo.tblKanbanColumns kc
     WHERE kc.Id = @Id AND kc.CompId = @CompId AND kc.IsActive = 1;

    IF (@WorkspaceId IS NULL)
    BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Column not found';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    SELECT @WsType = Type, @WsOwner = OwnerUserId
      FROM dbo.tblWorkspaces WHERE Id = @WorkspaceId;

    DECLARE @CanManage BIT = 0;
    IF (@IsAdmin = 1 AND @WsType <> 'personal') SET @CanManage = 1;
    ELSE IF (@WsType = 'personal' AND @WsOwner = @UserId) SET @CanManage = 1;
    ELSE IF (EXISTS (
        SELECT 1 FROM dbo.tblWorkspaceMembers m
         WHERE m.WorkspaceId = @WorkspaceId AND m.UserId = @UserId
           AND m.IsActive = 1 AND m.InviteStatus = 'active'
           AND m.Role IN ('owner','manager')))
        SET @CanManage = 1;

    IF (@CanManage = 0)
    BEGIN SET @ResponseCode = 403; SET @ResponseMess = 'Permission denied';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@ReassignToColumnId IS NOT NULL AND @ReassignToColumnId > 0)
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM dbo.tblKanbanColumns
             WHERE Id = @ReassignToColumnId AND WorkspaceId = @WorkspaceId
               AND IsActive = 1 AND Id <> @Id
        )
        BEGIN SET @ResponseCode = 400;
              SET @ResponseMess = 'Reassign target is not in this workspace';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
        SET @ReassignTargetId = @ReassignToColumnId;
    END
    ELSE
        SELECT TOP 1 @ReassignTargetId = Id
          FROM dbo.tblKanbanColumns
         WHERE WorkspaceId = @WorkspaceId AND IsActive = 1 AND Id <> @Id
         ORDER BY SortOrder ASC, Id ASC;

    -- The last column cannot go: its tasks would have nowhere to live and
    -- would be parked at ColumnId = NULL ("Uncategorized") (B16, 094).
    IF (@ReassignTargetId IS NULL)
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'A board needs at least one column';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;

        UPDATE dbo.tblTasks
           SET ColumnId = @ReassignTargetId, UpdatedDate = GETDATE()
         WHERE ColumnId = @Id;
        SET @MovedCount = @@ROWCOUNT;

        UPDATE dbo.tblKanbanColumns SET IsActive = 0 WHERE Id = @Id;

        -- Board = completion (item 11, ruling R7): the remaining columns may have
        -- a NEW last column. Completed cards sit there; open cards never do
        -- (unless the board is down to one column). Same rule as the A2 backfill.
        DECLARE @NewLast INT, @NewFirst INT;
        SELECT TOP 1 @NewLast = Id FROM dbo.tblKanbanColumns
         WHERE WorkspaceId = @WorkspaceId AND IsActive = 1 ORDER BY SortOrder DESC, Id DESC;
        SELECT TOP 1 @NewFirst = Id FROM dbo.tblKanbanColumns
         WHERE WorkspaceId = @WorkspaceId AND IsActive = 1 ORDER BY SortOrder ASC, Id ASC;

        UPDATE dbo.tblTasks
           SET ColumnId = CASE WHEN IsCompleted = 1 THEN @NewLast ELSE @NewFirst END,
               UpdatedDate = GETDATE()
         WHERE WorkspaceId = @WorkspaceId AND IsDeleted = 0
           AND (   (IsCompleted = 1 AND ISNULL(ColumnId, -1) <> @NewLast)
                OR (IsCompleted = 0 AND ColumnId = @NewLast AND @NewFirst <> @NewLast));

        COMMIT TRANSACTION;
        SET @ResponseCode = 200;
        SET @ResponseMess = 'Column deleted';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               @MovedCount AS TasksMoved,
               @ReassignTargetId AS ReassignedTo;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SET @ResponseCode = 500;
        SET @ResponseMess = 'Failed to delete column: ' + ERROR_MESSAGE();
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END CATCH
END
GO


-- ===========================================================================
-- C·S5. sp_MoveTaskColumn — board = completion, both ways (item 11, ruling R7)
-- ===========================================================================
-- Live body + one hunk: an OPEN task cannot be dropped into the board's last
-- column (ticking the steps does that), and a COMPLETED task cannot leave it
-- (unticking a step does that). Result shape unchanged.
CREATE OR ALTER PROCEDURE dbo.sp_MoveTaskColumn
    @TaskId    BIGINT,
    @ColumnId  INT,
    @UserId    INT,
    @IsAdmin   BIT    = 0,
    @CompId    BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);
    DECLARE @WorkspaceId BIGINT;

    IF (@TaskId IS NULL OR @TaskId <= 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Task ID is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    SELECT @WorkspaceId = WorkspaceId FROM dbo.tblTasks WHERE Id = @TaskId;

    IF (@WorkspaceId IS NULL AND NOT EXISTS (SELECT 1 FROM dbo.tblTasks WHERE Id = @TaskId))
    BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Task not found';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- Moving a card IS the status change. Assignees get this; it is the whole
    -- point of the action.
    DECLARE @PermTable TABLE (Allowed BIT, Reason VARCHAR(400));
    INSERT INTO @PermTable
    EXEC dbo.sp_CheckTaskPermission
        @TaskId = @TaskId, @WorkspaceId = NULL, @CommentId = NULL,
        @UserId = @UserId, @Action = 'change_status',
        @IsAdmin = @IsAdmin, @CompId = @CompId;

    IF NOT EXISTS (SELECT 1 FROM @PermTable WHERE Allowed = 1)
    BEGIN
        DECLARE @Reason VARCHAR(400) = (SELECT TOP 1 Reason FROM @PermTable);
        SET @ResponseCode = 403;
        SET @ResponseMess = 'Permission denied: ' + ISNULL(@Reason, 'no reason');
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
    END

    -- The column must belong to this task's workspace, or a caller could park a
    -- card on someone else's board.
    IF (@ColumnId IS NOT NULL AND @ColumnId > 0
        AND NOT EXISTS (SELECT 1 FROM dbo.tblKanbanColumns
                         WHERE Id = @ColumnId AND WorkspaceId = @WorkspaceId AND IsActive = 1))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Column does not belong to this workspace';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- Board = completion (094, R7). The last active column is "done".
    DECLARE @LastCol INT, @FirstCol INT, @Done BIT;
    SELECT @Done = ISNULL(IsCompleted, 0) FROM dbo.tblTasks WHERE Id = @TaskId;
    SELECT TOP 1 @LastCol = Id FROM dbo.tblKanbanColumns
     WHERE WorkspaceId = @WorkspaceId AND IsActive = 1 ORDER BY SortOrder DESC, Id DESC;
    SELECT TOP 1 @FirstCol = Id FROM dbo.tblKanbanColumns
     WHERE WorkspaceId = @WorkspaceId AND IsActive = 1 ORDER BY SortOrder ASC, Id ASC;

    IF (@Done = 0 AND @ColumnId = @LastCol AND @FirstCol <> @LastCol)
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Tick the remaining steps to finish this task';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@Done = 1 AND @LastCol IS NOT NULL AND ISNULL(@ColumnId, -1) <> @LastCol)
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Untick a step to reopen this task';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    UPDATE dbo.tblTasks
       SET ColumnId = @ColumnId,
           UpdatedDate = GETDATE()
     WHERE Id = @TaskId;

    SET @ResponseCode = 200; SET @ResponseMess = 'Task moved';
    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
           @TaskId AS TaskId, @WorkspaceId AS WorkspaceId;
END
GO


-- ===========================================================================
-- C·S4. sp_FetchTaskComment — newest page, shown oldest -> newest (item 13)
-- ===========================================================================
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

CREATE OR ALTER PROCEDURE dbo.sp_FetchTaskComment
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
      FROM ( -- page N counts back from the newest; pinned always make page 1 (B21, 094)
             SELECT tc0.Id
               FROM dbo.tblTaskComments tc0
               INNER JOIN dbo.tblUser u0 ON tc0.UserId = u0.Id
              WHERE tc0.TaskId = @TaskId
                AND (@SearchTerm IS NULL
                     OR tc0.Comment LIKE '%' + @SearchTerm + '%'
                     OR u0.FullName LIKE '%' + @SearchTerm + '%')
              ORDER BY tc0.IsPinned DESC, tc0.CreatedDate DESC, tc0.Id DESC
              OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY ) pg
      INNER JOIN dbo.tblTaskComments tc ON tc.Id = pg.Id
      INNER JOIN dbo.tblUser u ON tc.UserId = u.Id
     ORDER BY tc.IsPinned DESC, tc.CreatedDate ASC, tc.Id ASC;
END
GO


-- ===========================================================================
-- D·S2. sp_SaveUser — role required, branch, admin from group, deactivation releases tasks, last-admin guard (items 16-19)
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- 9.2 sp_SaveUser — +@ReportsTo (defaults NULL; old callers unaffected)
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_SaveUser
    @Id INT,
    @Username VARCHAR(100),
    @Password VARCHAR(500),
    @UserActive BIT,
    @IsAdmin BIT = NULL,             -- ignored since 094: admin comes from the group
    @UserIp VARCHAR(50),
    @AllowDay INT,
    @FullName VARCHAR(200),
    @Email VARCHAR(150),
    @JobTitle VARCHAR(100),
    @HourlyRate DECIMAL(10,2),
    @GroupId INT,
    @CompId BIGINT,
    @BranchId BIGINT = NULL,         -- NULL on edit = keep the current branch (094)
    @Mobile VARCHAR(20) = NULL,
    @ReportsTo INT = NULL,
    @ActorUserId INT = NULL          -- who is saving (094)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);

    IF (@Username IS NULL OR LTRIM(RTRIM(@Username)) = '')
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Username is required and cannot be blank';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- A new user needs a password. An edit may omit it to keep the current one.
    IF (@Id = 0 AND (@Password IS NULL OR LTRIM(RTRIM(@Password)) = ''))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Password is required and cannot be blank';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@FullName IS NULL OR LTRIM(RTRIM(@FullName)) = '')
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Full name is required and cannot be blank';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- Normalize blanks to NULL so filtered-unique indexes ignore them.
    IF (@Mobile IS NOT NULL AND LTRIM(RTRIM(@Mobile)) = '') SET @Mobile = NULL;
    IF (@Email  IS NOT NULL AND LTRIM(RTRIM(@Email))  = '') SET @Email  = NULL;
    IF (@ReportsTo IS NOT NULL AND @ReportsTo <= 0)         SET @ReportsTo = NULL;

    IF (@Id > 0 AND @UserActive = 0 AND @Id = @ActorUserId)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'You cannot deactivate your own account';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- No default group (094): the old ELSE SET @GroupId = 8 pointed at a group
    -- that does not exist. A role is required, and it must be this company's.
    IF (@GroupId IS NULL OR @GroupId <= 0
        OR NOT EXISTS (SELECT 1 FROM tblUserGroups WHERE Id = @GroupId AND CompId = @CompId AND IsActive = 1))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Pick an active role for this user';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@Id = 0 AND @BranchId IS NULL)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Branch is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    IF (@BranchId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tblBranch WHERE Id = @BranchId))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid branch';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- tblUser.IsAdmin is a mirror of the role, never taken from the form (094).
    DECLARE @GroupIsAdmin BIT = (SELECT IsAdmin FROM tblUserGroups WHERE Id = @GroupId);

    -- Never deactivate the last active admin, nor move them into a non-admin
    -- role: either way nobody would be left to undo it.
    IF (@Id > 0 AND (@UserActive = 0 OR ISNULL(@GroupIsAdmin, 0) = 0)
        AND EXISTS (SELECT 1 FROM tblUser u
                      JOIN tblUserGroupMap m ON m.UserId = u.Id
                      JOIN tblUserGroups g ON g.Id = m.GroupId AND g.IsActive = 1 AND g.IsAdmin = 1
                     WHERE u.Id = @Id AND u.CompId = @CompId AND u.IsActive = 1)
        AND NOT EXISTS (SELECT 1 FROM tblUser u
                          JOIN tblUserGroupMap m ON m.UserId = u.Id
                          JOIN tblUserGroups g ON g.Id = m.GroupId AND g.IsActive = 1 AND g.IsAdmin = 1
                         WHERE u.CompId = @CompId AND u.IsActive = 1 AND u.Id <> @Id))
    BEGIN SET @ResponseCode = 409;
          SET @ResponseMess = 'This is the last active admin. Make someone else an admin before deactivating them or changing their role.';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- Reporting line: must be a colleague, not self, and must not loop.
    IF @ReportsTo IS NOT NULL
    BEGIN
        IF @ReportsTo = @Id
        BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'A user cannot report to themselves';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
        IF NOT EXISTS (SELECT 1 FROM tblUser WHERE Id = @ReportsTo AND CompId = @CompId)
        BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Reports To must be a user in this company';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

        DECLARE @cur INT = @ReportsTo, @hops INT = 0;
        WHILE @cur IS NOT NULL AND @hops < 20
        BEGIN
            IF @cur = @Id
            BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Reporting line would loop back to this user';
                  SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
            SET @cur = (SELECT ReportsTo FROM tblUser WHERE Id = @cur AND CompId = @CompId);
            SET @hops += 1;
        END
    END

    -- Login keys are GLOBAL (not per-company) -- a friendly 409 before the
    -- unique index would throw a raw error.
    IF EXISTS (SELECT 1 FROM tblUser WHERE Username = @Username AND Id <> @Id)
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Username already exists';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    IF (@Email IS NOT NULL AND EXISTS (SELECT 1 FROM tblUser WHERE Email = @Email AND Id <> @Id))
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Email already in use';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    IF (@Mobile IS NOT NULL AND EXISTS (SELECT 1 FROM tblUser WHERE Mobile = @Mobile AND Id <> @Id))
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Mobile already in use';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    DECLARE @WasActive BIT;
    -- Boards where a deactivated user held open work (094): returned as the
    -- 2nd result set so the caller can refresh those boards and owners.
    DECLARE @Released TABLE (WorkspaceId BIGINT PRIMARY KEY, OwnerUserId INT, TaskCount INT);

    BEGIN TRY
        BEGIN TRANSACTION;

        IF (@Id = 0)
        BEGIN
            INSERT INTO tblUser
                (Username, Password, IsActive, IsAdmin, UserIp, AllowDay,
                 FullName, Email, JobTitle, HourlyRate, Mobile, CompId, BranchId, ReportsTo)
            VALUES
                (@Username, @Password, @UserActive, @GroupIsAdmin, @UserIp, @AllowDay,
                 @FullName, @Email, @JobTitle, @HourlyRate, @Mobile, @CompId, @BranchId, @ReportsTo);

            SET @Id = SCOPE_IDENTITY();

            INSERT INTO tblUserGroupMap (UserId, GroupId) VALUES (@Id, @GroupId);

            COMMIT TRANSACTION;

            SET @ResponseCode = 201;
            SET @ResponseMess = 'User created successfully';

            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @Id AS UserId, @GroupId AS AssignedGroupId;
        END
        ELSE
        BEGIN
            SELECT @WasActive = IsActive FROM tblUser WHERE Id = @Id AND CompId = @CompId;
            IF (@WasActive IS NULL)
            BEGIN
                ROLLBACK TRANSACTION;
                SET @ResponseCode = 404; SET @ResponseMess = 'User not found';
                SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
            END

            UPDATE tblUser
               SET Username = @Username, IsActive = @UserActive,
                   IsAdmin = @GroupIsAdmin, UserIp = @UserIp, AllowDay = @AllowDay,
                   FullName = @FullName, Email = @Email, JobTitle = @JobTitle,
                   HourlyRate = @HourlyRate, Mobile = @Mobile,
                   ReportsTo = @ReportsTo,
                   BranchId = ISNULL(@BranchId, BranchId),
                   -- Password only when a new hash is supplied; blank means
                   -- "keep current" (same contract as sp_UpdateOwnProfile).
                   Password = CASE WHEN @Password IS NOT NULL AND LEN(@Password) > 0
                                   THEN @Password ELSE Password END
             WHERE Id = @Id AND CompId = @CompId;

            DELETE FROM tblUserGroupMap WHERE UserId = @Id;
            INSERT INTO tblUserGroupMap (UserId, GroupId) VALUES (@Id, @GroupId);

            -- Deactivation releases their open tasks (spec items 5/16, 094): one
            -- rule in one place, sp_UnassignInvalidAssignees, run per board the
            -- user holds open work on. Plain EXEC — it uses INSERT...EXEC itself.
            IF (@WasActive = 1 AND @UserActive = 0)
            BEGIN
                INSERT INTO @Released (WorkspaceId, OwnerUserId, TaskCount)
                SELECT w.Id, w.OwnerUserId, COUNT(DISTINCT t.Id)
                  FROM dbo.tblTaskAssignee a
                  JOIN dbo.tblTasks      t ON t.Id = a.TaskId
                  JOIN dbo.tblWorkspaces w ON w.Id = t.WorkspaceId
                 WHERE a.UserId = @Id
                   AND w.CompId = @CompId
                   AND w.Type IN ('shared', 'project')
                   AND t.IsCompleted = 0
                   AND t.IsDeleted = 0
                 GROUP BY w.Id, w.OwnerUserId;

                DECLARE @RelWs BIGINT = (SELECT MIN(WorkspaceId) FROM @Released);
                WHILE (@RelWs IS NOT NULL)
                BEGIN
                    EXEC dbo.sp_UnassignInvalidAssignees
                         @WorkspaceId = @RelWs, @ActorUserId = @ActorUserId, @CompId = @CompId;
                    SET @RelWs = (SELECT MIN(WorkspaceId) FROM @Released WHERE WorkspaceId > @RelWs);
                END
            END

            COMMIT TRANSACTION;

            SET @ResponseCode = 200;
            SET @ResponseMess = 'User updated successfully';

            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @Id AS UserId, @GroupId AS AssignedGroupId;
            -- 2nd result set (094): boards whose open tasks this save released.
            SELECT WorkspaceId, OwnerUserId, TaskCount FROM @Released;
        END
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SET @ResponseCode = 500;
        SET @ResponseMess = ERROR_MESSAGE();
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END CATCH
END
GO


-- ===========================================================================
-- D·S3. sp_DeleteUser — refuse anyone with history; never wipe comments/time (item 17)
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- 7. sp_DeleteUser
--
--    MANDATORY with this migration: FK_tblTaskAssignee_User means the DELETE
--    would now fail outright for anyone who has ever been assigned a task, and
--    the "has assigned tasks" guard pointed at the mirror column so it would
--    miss a co-assignee entirely.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_DeleteUser
    @Id INT,
    @CompId BIGINT,
    @BranchId BIGINT,
    @IsAdmin BIT,
    @RequestingUserId INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);

    IF (@Id IS NULL OR @Id <= 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'User ID is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM tblUser WHERE Id = @Id AND CompId = @CompId AND (@IsAdmin = 1 OR BranchId = @BranchId))
    BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'User not found or access denied';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@Id = @RequestingUserId)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Cannot delete your own account';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- Delete is for a mistaken, never-used account only (094). Anyone with
    -- history is deactivated instead; deleting used to wipe their comments and
    -- time entries from other people's tasks.
    DECLARE @Has VARCHAR(60) =
      CASE
        WHEN EXISTS (SELECT 1 FROM tblTaskAssignee WHERE UserId = @Id)
          OR EXISTS (SELECT 1 FROM tblTasks WHERE CreatedByUserId = @Id OR AssignedToUserId = @Id OR CompletedByUserId = @Id)
             THEN 'tasks'
        WHEN EXISTS (SELECT 1 FROM tblTaskComments WHERE UserId = @Id) THEN 'task comments'
        WHEN EXISTS (SELECT 1 FROM tblTimeEntries  WHERE UserId = @Id) THEN 'time entries'
        WHEN EXISTS (SELECT 1 FROM tblLeads WHERE OwnerId = @Id OR CreatedBy = @Id) THEN 'leads'
        WHEN EXISTS (SELECT 1 FROM tblTicket WHERE AssignedTo = @Id OR CreatedBy = @Id OR EscalatedTo = @Id) THEN 'complaints'
        WHEN EXISTS (SELECT 1 FROM tblLeadActivity   WHERE UserId = @Id)
          OR EXISTS (SELECT 1 FROM tblTicketActivity WHERE UserId = @Id)
          OR EXISTS (SELECT 1 FROM tblCall           WHERE UserId = @Id)
          OR EXISTS (SELECT 1 FROM tblFollowUp       WHERE AssignedTo = @Id OR CreatedBy = @Id)
             THEN 'sales or support activity'
        WHEN EXISTS (SELECT 1 FROM tblUser WHERE ReportsTo = @Id) THEN 'people reporting to them'
        WHEN EXISTS (SELECT 1 FROM tblWorkspaces WHERE OwnerUserId = @Id AND Type <> 'personal') THEN 'workspaces they own'
        WHEN EXISTS (SELECT 1 FROM tblProjects WHERE ManagerUserId = @Id) THEN 'projects they manage'
        WHEN EXISTS (SELECT 1 FROM tblTeams    WHERE LeadUserId    = @Id) THEN 'teams they lead'
        WHEN EXISTS (SELECT 1 FROM tblActivityLog WHERE UserId = @Id) THEN 'activity history'
      END;
    IF @Has IS NOT NULL
    BEGIN SET @ResponseCode = 409;
          SET @ResponseMess = 'Cannot delete: this user has ' + @Has + '. Deactivate them instead.';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;
        -- Only rows with no history value: role map, roster, access, prefs,
        -- devices, their own inbox and receipts, and an empty personal workspace.
        DELETE FROM tblUserGroupMap            WHERE UserId = @Id;
        DELETE FROM tblTeamMembers             WHERE UserId = @Id;
        DELETE FROM tblUserBranchAccess        WHERE UserId = @Id;
        DELETE FROM tblNotificationPreferences WHERE UserId = @Id;
        DELETE FROM tblUserPushTokens          WHERE UserId = @Id;
        DELETE FROM tblNotifications           WHERE UserId = @Id;
        DELETE FROM tblTaskReads               WHERE UserId = @Id;
        DELETE FROM tblCommentReads            WHERE UserId = @Id;
        DELETE FROM tblWorkspaceMembers        WHERE UserId = @Id;
        DELETE k FROM tblKanbanColumns k JOIN tblWorkspaces w ON w.Id = k.WorkspaceId
         WHERE w.OwnerUserId = @Id AND w.Type = 'personal';   -- no tasks: guarded above
        DELETE FROM tblWorkspaces WHERE OwnerUserId = @Id AND Type = 'personal';
        DELETE FROM tblUser WHERE Id = @Id;
        COMMIT TRANSACTION;

        SET @ResponseCode = 200; SET @ResponseMess = 'User deleted successfully';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SET @ResponseCode = 500;
        SET @ResponseMess = 'Failed to delete user: ' + ERROR_MESSAGE();
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END CATCH
END
GO


-- ===========================================================================
-- D·S4. sp_FetchAccessibleBranchIds — admin = any active admin group (item 19)
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- 7. sp_FetchAccessibleBranchIds — a deactivated group used to keep granting
--    its DataScope and IsAdmin (menus already ignored it). Only the group
--    join changes: an inactive group is treated as no group (least privilege).
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_FetchAccessibleBranchIds
    @UserId INT,
    @CompId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @HierarchyLevel  TINYINT;
    DECLARE @DataScope       VARCHAR(20);
    DECLARE @PrimaryBranchId BIGINT;
    DECLARE @IsAdmin         BIT;
    DECLARE @IsActive        BIT;

    -- A user in several groups gets their strongest: lowest HierarchyLevel wins.
    SELECT TOP 1
        @HierarchyLevel  = ug.HierarchyLevel,
        @DataScope       = ug.DataScope,
        @PrimaryBranchId = u.BranchId,
        @IsActive        = u.IsActive
    FROM dbo.tblUser u
    LEFT JOIN dbo.tblUserGroupMap ugm ON ugm.UserId = u.Id
    LEFT JOIN dbo.tblUserGroups   ug  ON ug.Id = ugm.GroupId AND ug.IsActive = 1
    WHERE u.Id = @UserId AND u.CompId = @CompId
    ORDER BY CASE WHEN ug.Id IS NULL THEN 1 ELSE 0 END, ug.HierarchyLevel ASC, ug.IsAdmin DESC, ug.Id;

    -- Admin = ANY active group says so, exactly as sp_ValidateUser (093) does
    -- at login. Top-by-level alone let a level-2 Head tie with Admin and win (094).
    SET @IsAdmin = CASE WHEN EXISTS (
        SELECT 1 FROM dbo.tblUserGroupMap m
          JOIN dbo.tblUserGroups g ON g.Id = m.GroupId
          JOIN dbo.tblUser u2 ON u2.Id = m.UserId AND u2.CompId = @CompId
         WHERE m.UserId = @UserId AND g.IsActive = 1 AND g.IsAdmin = 1) THEN 1 ELSE 0 END;

    -- No group = least privilege. No user row = inactive (fail closed).
    IF @DataScope      IS NULL SET @DataScope      = 'Self';
    IF @HierarchyLevel IS NULL SET @HierarchyLevel = 4;
    IF @IsAdmin        IS NULL SET @IsAdmin        = 0;
    IF @IsActive       IS NULL SET @IsActive       = 0;

    DECLARE @Subtree TABLE (UserId INT PRIMARY KEY, BranchId BIGINT NULL);
    IF @DataScope = 'Team'
    BEGIN
        ;WITH chain AS (
            SELECT Id, BranchId FROM dbo.tblUser WHERE Id = @UserId AND CompId = @CompId
            UNION ALL
            SELECT u.Id, u.BranchId
            FROM dbo.tblUser u
            JOIN chain c ON u.ReportsTo = c.Id
            WHERE u.CompId = @CompId AND u.Id <> @UserId
        )
        INSERT INTO @Subtree (UserId, BranchId)
        SELECT DISTINCT Id, BranchId FROM chain
        OPTION (MAXRECURSION 32);
    END

    SELECT @HierarchyLevel  AS HierarchyLevel,
           @DataScope       AS DataScope,
           @PrimaryBranchId AS PrimaryBranchId,
           @IsAdmin         AS IsAdmin,
           @IsActive        AS IsActive;

    -- Result 2: branches
    IF @DataScope IN ('All', 'Company')
        SELECT b.Id AS BranchId, CAST(1 AS BIT) AS CanWrite FROM dbo.tblBranch b;
    ELSE IF @DataScope = 'MultiBranch'
        SELECT BranchId, CanWrite FROM (
            SELECT @PrimaryBranchId AS BranchId, CAST(1 AS BIT) AS CanWrite
            UNION
            SELECT BranchId, CanWrite FROM dbo.tblUserBranchAccess
             WHERE UserId = @UserId AND CanRead = 1
        ) merged GROUP BY BranchId, CanWrite;
    ELSE IF @DataScope = 'Team'
        SELECT BranchId, CAST(1 AS BIT) AS CanWrite FROM (
            SELECT @PrimaryBranchId AS BranchId
            UNION
            SELECT BranchId FROM @Subtree WHERE BranchId IS NOT NULL
        ) x GROUP BY BranchId;
    ELSE
        SELECT @PrimaryBranchId AS BranchId, CAST(1 AS BIT) AS CanWrite;

    -- Result 3: owners. Empty for the wide scopes = "no ownership filter".
    IF @DataScope = 'Self'
        SELECT @UserId AS OwnerId;
    ELSE IF @DataScope = 'Team'
        SELECT UserId AS OwnerId FROM @Subtree;
    ELSE
        SELECT CAST(NULL AS INT) AS OwnerId WHERE 1 = 0;  -- no rows
END
GO


-- ===========================================================================
-- D·S5. sp_FetchUser — BranchName + NoManager (items 18, 20)
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- 9.3 sp_FetchUser — +ReportsTo, ReportsToName (contract otherwise unchanged)
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_FetchUser
    @Id INT,
    @CompId BIGINT,
    @BranchId BIGINT,
    @IsAdmin BIT,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @PageNumber INT = 1,
    @PageSize INT = 10,
    @SearchTerm NVARCHAR(100) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);
    DECLARE @TotalRecords INT;
    DECLARE @TotalPages INT;
    DECLARE @Offset INT;

    DECLARE @BranchIds TABLE (BranchId BIGINT);
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
        INSERT INTO @BranchIds (BranchId)
        SELECT CAST(value AS BIGINT) FROM OPENJSON(@AccessibleBranchIdsJson);
    DECLARE @UseScope BIT = CASE WHEN @AccessibleBranchIdsJson IS NULL OR @AccessibleBranchIdsJson = '' THEN 0 ELSE 1 END;

    -- Users with an ACTIVE manager somewhere up the chain (094). The walk
    -- continues only through inactive managers, so it stops at the first active one.
    DECLARE @Managed TABLE (UserId INT PRIMARY KEY);
    ;WITH up AS (
        SELECT u.Id AS UserId, u.ReportsTo AS AncestorId, 1 AS Depth
          FROM tblUser u WHERE u.CompId = @CompId AND u.ReportsTo IS NOT NULL
        UNION ALL
        SELECT up.UserId, m.ReportsTo, up.Depth + 1
          FROM up JOIN tblUser m ON m.Id = up.AncestorId
         WHERE m.CompId = @CompId AND m.IsActive = 0 AND m.ReportsTo IS NOT NULL AND up.Depth < 20
    )
    INSERT INTO @Managed (UserId)
    SELECT DISTINCT up.UserId
      FROM up JOIN tblUser a ON a.Id = up.AncestorId AND a.CompId = @CompId AND a.IsActive = 1
     WHERE a.Id <> up.UserId
    OPTION (MAXRECURSION 32);

    IF (@Id = 0)
    BEGIN
        SET @Offset = (@PageNumber - 1) * @PageSize;

        SELECT @TotalRecords = COUNT(*)
        FROM tblUser u
        WHERE u.CompId = @CompId
          AND ((@UseScope = 1 AND u.BranchId IN (SELECT BranchId FROM @BranchIds))
            OR (@UseScope = 0 AND (@IsAdmin = 1 OR u.BranchId = @BranchId)))
          AND (@SearchTerm IS NULL OR
               u.Username LIKE '%' + @SearchTerm + '%' OR
               u.FullName LIKE '%' + @SearchTerm + '%' OR
               u.Email    LIKE '%' + @SearchTerm + '%' OR
               u.Mobile   LIKE '%' + @SearchTerm + '%' OR
               u.JobTitle LIKE '%' + @SearchTerm + '%');

        SET @TotalPages = CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize);

        IF @TotalRecords = 0
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'No users found';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   NULL AS Id, NULL AS Username, NULL AS IsActive, NULL AS IsAdmin,
                   NULL AS FullName, NULL AS Email, NULL AS JobTitle, NULL AS HourlyRate,
                   NULL AS Mobile, NULL AS Avatar,
                   NULL AS GroupId, NULL AS GroupName,
                   NULL AS ReportsTo, NULL AS ReportsToName,
                   NULL AS BranchName, NULL AS NoManager,
                   NULL AS CompId, NULL AS BranchId, NULL AS CreatedDate;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'Users retrieved successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   u.Id, u.Username, u.IsActive, u.IsAdmin, u.FullName, u.Email,
                   u.JobTitle, u.HourlyRate, u.Mobile, u.Avatar,
                   (SELECT TOP 1 m.GroupId
                      FROM tblUserGroupMap m
                      JOIN tblUserGroups g ON g.Id = m.GroupId AND g.IsActive = 1
                     WHERE m.UserId = u.Id
                     ORDER BY m.Id) AS GroupId,
                   (SELECT TOP 1 g.Name
                      FROM tblUserGroupMap m
                      JOIN tblUserGroups g ON g.Id = m.GroupId AND g.IsActive = 1
                     WHERE m.UserId = u.Id
                     ORDER BY m.Id) AS GroupName,
                   u.ReportsTo,
                   (SELECT r.FullName FROM tblUser r WHERE r.Id = u.ReportsTo) AS ReportsToName,
                   b.BranchName,
                   CAST(CASE WHEN u.IsActive = 1
                              AND NOT EXISTS (SELECT 1 FROM @Managed mg WHERE mg.UserId = u.Id)
                              AND NOT EXISTS (SELECT 1 FROM tblUserGroupMap am
                                                JOIN tblUserGroups ag ON ag.Id = am.GroupId AND ag.IsActive = 1 AND ag.IsAdmin = 1
                                               WHERE am.UserId = u.Id)
                             THEN 1 ELSE 0 END AS BIT) AS NoManager,
                   u.CompId, u.BranchId, u.CreatedDate
            FROM tblUser u
            LEFT JOIN tblBranch b ON b.Id = u.BranchId
            WHERE u.CompId = @CompId
              AND ((@UseScope = 1 AND u.BranchId IN (SELECT BranchId FROM @BranchIds))
                OR (@UseScope = 0 AND (@IsAdmin = 1 OR u.BranchId = @BranchId)))
              AND (@SearchTerm IS NULL OR
                   u.Username LIKE '%' + @SearchTerm + '%' OR
                   u.FullName LIKE '%' + @SearchTerm + '%' OR
                   u.Email    LIKE '%' + @SearchTerm + '%' OR
                   u.Mobile   LIKE '%' + @SearchTerm + '%' OR
                   u.JobTitle LIKE '%' + @SearchTerm + '%')
            ORDER BY u.FullName
            OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
        END
    END
    ELSE
    BEGIN
        IF EXISTS (SELECT 1 FROM tblUser
                   WHERE Id = @Id AND CompId = @CompId
                     AND ((@UseScope = 1 AND BranchId IN (SELECT BranchId FROM @BranchIds))
                       OR (@UseScope = 0 AND (@IsAdmin = 1 OR BranchId = @BranchId))))
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'User retrieved successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   u.Id, u.Username, u.IsActive, u.IsAdmin, u.FullName, u.Email,
                   u.JobTitle, u.HourlyRate, u.Mobile, u.Avatar,
                   (SELECT TOP 1 m.GroupId
                      FROM tblUserGroupMap m
                      JOIN tblUserGroups g ON g.Id = m.GroupId AND g.IsActive = 1
                     WHERE m.UserId = u.Id
                     ORDER BY m.Id) AS GroupId,
                   (SELECT TOP 1 g.Name
                      FROM tblUserGroupMap m
                      JOIN tblUserGroups g ON g.Id = m.GroupId AND g.IsActive = 1
                     WHERE m.UserId = u.Id
                     ORDER BY m.Id) AS GroupName,
                   u.ReportsTo,
                   (SELECT r.FullName FROM tblUser r WHERE r.Id = u.ReportsTo) AS ReportsToName,
                   b.BranchName,
                   CAST(CASE WHEN u.IsActive = 1
                              AND NOT EXISTS (SELECT 1 FROM @Managed mg WHERE mg.UserId = u.Id)
                              AND NOT EXISTS (SELECT 1 FROM tblUserGroupMap am
                                                JOIN tblUserGroups ag ON ag.Id = am.GroupId AND ag.IsActive = 1 AND ag.IsAdmin = 1
                                               WHERE am.UserId = u.Id)
                             THEN 1 ELSE 0 END AS BIT) AS NoManager,
                   u.CompId, u.BranchId, u.CreatedDate
            FROM tblUser u
            LEFT JOIN tblBranch b ON b.Id = u.BranchId
            WHERE u.Id = @Id AND u.CompId = @CompId;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 404; SET @ResponseMess = 'User not found or access denied';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   NULL AS Id, NULL AS Username, NULL AS IsActive, NULL AS IsAdmin,
                   NULL AS FullName, NULL AS Email, NULL AS JobTitle, NULL AS HourlyRate,
                   NULL AS Mobile, NULL AS Avatar,
                   NULL AS GroupId, NULL AS GroupName,
                   NULL AS ReportsTo, NULL AS ReportsToName,
                   NULL AS BranchName, NULL AS NoManager,
                   NULL AS CompId, NULL AS BranchId, NULL AS CreatedDate;
        END
    END
END
GO


-- ===========================================================================
-- D·S6. sp_FetchUserHandover — NEW (item 16)
-- ===========================================================================
-- What a user still holds, so an admin can hand it over before/after deactivating.
-- RS1: one row of counts + status. RS2: owned shared/project workspaces. RS3: direct reports.
CREATE OR ALTER PROCEDURE dbo.sp_FetchUserHandover
    @UserId INT,
    @CompId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Id = @UserId AND CompId = @CompId)
    BEGIN SELECT 404 AS ResponseCode, 'User not found' AS ResponseMess; RETURN; END

    SELECT 200 AS ResponseCode, 'Handover retrieved' AS ResponseMess,
      (SELECT COUNT(DISTINCT t.Id) FROM dbo.tblTaskAssignee a
         JOIN dbo.tblTasks t ON t.Id = a.TaskId
         JOIN dbo.tblWorkspaces w ON w.Id = t.WorkspaceId
        WHERE a.UserId = @UserId AND w.CompId = @CompId
          AND w.Type IN ('shared','project') AND t.IsCompleted = 0
          AND t.IsDeleted = 0)                                               AS OpenTasks,
      (SELECT COUNT(*) FROM dbo.tblLeads l
         LEFT JOIN dbo.tblLookup s ON s.Id = l.StatusId
        WHERE l.CompId = @CompId AND l.OwnerId = @UserId
          AND ISNULL(s.Code, '') NOT IN ('converted','lost','junk'))         AS OpenLeads,
      (SELECT COUNT(*) FROM dbo.tblTicket k
         JOIN dbo.tblLookup s ON s.Id = k.StatusId
        WHERE k.CompId = @CompId AND k.AssignedTo = @UserId
          AND s.Code IN ('open','onhold'))                                   AS OpenTickets,
      (SELECT COUNT(*) FROM dbo.tblWorkspaces
        WHERE CompId = @CompId AND OwnerUserId = @UserId
          AND Type IN ('shared','project') AND IsArchived = 0)               AS OwnedWorkspaces,
      (SELECT COUNT(*) FROM dbo.tblUser
        WHERE CompId = @CompId AND ReportsTo = @UserId AND IsActive = 1)     AS DirectReports;

    SELECT Id, Name, Type FROM dbo.tblWorkspaces
     WHERE CompId = @CompId AND OwnerUserId = @UserId
       AND Type IN ('shared','project') AND IsArchived = 0
     ORDER BY Name;

    SELECT Id, FullName FROM dbo.tblUser
     WHERE CompId = @CompId AND ReportsTo = @UserId AND IsActive = 1
     ORDER BY FullName;
END
GO


-- ===========================================================================
-- D·S7. sp_FetchPersonManagers — NEW (item 20)
-- ===========================================================================
-- Who gets told about a person: their first ACTIVE manager up ReportsTo
-- (walking through inactive ones, like sp_FetchEscalationTargets), else the
-- company's active admins (active user in an active IsAdmin group). A person
-- who is themselves an admin with no manager gets nobody (audit 02 §5.10).
-- Always exactly one result set: UserId, Source ('manager' | 'admin').
CREATE OR ALTER PROCEDURE dbo.sp_FetchPersonManagers
    @UserId INT,
    @CompId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ManagerId INT;

    ;WITH chain AS (
        SELECT u.Id, u.ReportsTo, 0 AS Depth
          FROM dbo.tblUser u WHERE u.Id = @UserId AND u.CompId = @CompId
        UNION ALL
        SELECT m.Id, m.ReportsTo, c.Depth + 1
          FROM dbo.tblUser m JOIN chain c ON m.Id = c.ReportsTo
         WHERE m.CompId = @CompId AND c.Depth < 20
    )
    SELECT TOP 1 @ManagerId = u.Id
      FROM chain c JOIN dbo.tblUser u ON u.Id = c.Id
     WHERE c.Depth > 0 AND u.IsActive = 1 AND u.Id <> @UserId
     ORDER BY c.Depth
    OPTION (MAXRECURSION 32);

    DECLARE @PersonIsAdmin BIT = CASE WHEN EXISTS (
        SELECT 1 FROM dbo.tblUserGroupMap m JOIN dbo.tblUserGroups g ON g.Id = m.GroupId
         WHERE m.UserId = @UserId AND g.IsActive = 1 AND g.IsAdmin = 1) THEN 1 ELSE 0 END;

    SELECT u.Id AS UserId,
           CASE WHEN u.Id = @ManagerId THEN 'manager' ELSE 'admin' END AS Source
      FROM dbo.tblUser u
     WHERE u.CompId = @CompId AND u.IsActive = 1 AND u.Id <> @UserId
       AND (u.Id = @ManagerId
            OR (@ManagerId IS NULL AND @PersonIsAdmin = 0
                AND EXISTS (SELECT 1 FROM dbo.tblUserGroupMap m
                              JOIN dbo.tblUserGroups g ON g.Id = m.GroupId
                             WHERE m.UserId = u.Id AND g.IsActive = 1 AND g.IsAdmin = 1)));
END
GO


-- ===========================================================================
-- E. Soft-deleted tasks drop out of counts and "has tasks" guards (item 1, R8)
--    Each procedure = LIVE body (OBJECT_DEFINITION, eCRM+, 2026-10-07) plus
--    only the IsDeleted hunk. sp_FetchTask's SubTaskCount is fixed in A12.
-- ===========================================================================

-- E1. sp_FetchProject — TaskCount ignores deleted tasks
-- ----- sp_FetchProject (scope-aware) -----
CREATE OR ALTER PROCEDURE sp_FetchProject
    @Id INT,
    @UserId INT,
    @CompId BIGINT,
    @BranchId BIGINT,
    @IsAdmin BIT,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @PageNumber INT = 1,
    @PageSize INT = 10,
    @SearchTerm NVARCHAR(100) = NULL
AS
BEGIN
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);
    DECLARE @TotalRecords INT;
    DECLARE @TotalPages INT;
    DECLARE @Offset INT;

    DECLARE @BranchIds TABLE (BranchId BIGINT);
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
        INSERT INTO @BranchIds (BranchId)
        SELECT CAST(value AS BIGINT) FROM OPENJSON(@AccessibleBranchIdsJson);
    DECLARE @UseScope BIT = CASE WHEN @AccessibleBranchIdsJson IS NULL OR @AccessibleBranchIdsJson = '' THEN 0 ELSE 1 END;

    IF (@Id = 0)
    BEGIN
        SET @Offset = (@PageNumber - 1) * @PageSize;

        SELECT @TotalRecords = COUNT(*)
        FROM tblProjects p
        INNER JOIN tblUser u ON p.ManagerUserId = u.Id
        LEFT JOIN tblTeams t ON p.TeamId = t.Id
        LEFT JOIN tblTeamMembers tm ON tm.TeamId = p.TeamId AND tm.UserId = @UserId
        WHERE p.CompId = @CompId
          AND ((@UseScope = 1 AND p.BranchId IN (SELECT BranchId FROM @BranchIds))
            OR (@UseScope = 0))
          AND (@IsAdmin = 1 OR p.ManagerUserId = @UserId OR tm.UserId IS NOT NULL OR
               JSON_VALUE(p.Members, '$') LIKE '%' + CAST(@UserId AS VARCHAR) + '%')
          AND (@SearchTerm IS NULL OR p.Name LIKE '%' + @SearchTerm + '%' OR p.Description LIKE '%' + @SearchTerm + '%' OR u.FullName LIKE '%' + @SearchTerm + '%' OR t.Name LIKE '%' + @SearchTerm + '%');

        SET @TotalPages = CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize);

        IF @TotalRecords = 0
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'No projects found';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   NULL AS Id, NULL AS Name, NULL AS Description, NULL AS ManagerUserId,
                   NULL AS TeamId, NULL AS Members, NULL AS Status, NULL AS Priority,
                   NULL AS StartDate, NULL AS EndDate, NULL AS Budget, NULL AS Progress,
                   NULL AS BranchId, NULL AS ManagerName, NULL AS TeamName, NULL AS TaskCount;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'Projects retrieved successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
                   @PageNumber AS CurrentPage, @PageSize AS PageSize,
                   p.Id, p.Name, p.Description, p.ManagerUserId, p.TeamId, p.Members,
                   p.Status, p.Priority, p.StartDate, p.EndDate, p.Budget, p.Progress,
                   p.BranchId,
                   u.FullName AS ManagerName, t.Name AS TeamName,
                   (SELECT COUNT(*) FROM tblTasks ts WHERE ts.ProjectId = p.Id AND ts.IsDeleted = 0) AS TaskCount
            FROM tblProjects p
            INNER JOIN tblUser u ON p.ManagerUserId = u.Id
            LEFT JOIN tblTeams t ON p.TeamId = t.Id
            LEFT JOIN tblTeamMembers tm ON tm.TeamId = p.TeamId AND tm.UserId = @UserId
            WHERE p.CompId = @CompId
              AND ((@UseScope = 1 AND p.BranchId IN (SELECT BranchId FROM @BranchIds))
                OR (@UseScope = 0))
              AND (@IsAdmin = 1 OR p.ManagerUserId = @UserId OR tm.UserId IS NOT NULL OR
                   JSON_VALUE(p.Members, '$') LIKE '%' + CAST(@UserId AS VARCHAR) + '%')
              AND (@SearchTerm IS NULL OR p.Name LIKE '%' + @SearchTerm + '%' OR p.Description LIKE '%' + @SearchTerm + '%' OR u.FullName LIKE '%' + @SearchTerm + '%' OR t.Name LIKE '%' + @SearchTerm + '%')
            ORDER BY p.Name
            OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
        END
    END
    ELSE
    BEGIN
        IF EXISTS (
            SELECT 1 FROM tblProjects p
            LEFT JOIN tblTeamMembers tm ON tm.TeamId = p.TeamId AND tm.UserId = @UserId
            WHERE p.Id = @Id AND p.CompId = @CompId
              AND ((@UseScope = 1 AND p.BranchId IN (SELECT BranchId FROM @BranchIds))
                OR (@UseScope = 0))
              AND (@IsAdmin = 1 OR p.ManagerUserId = @UserId OR tm.UserId IS NOT NULL OR
                   JSON_VALUE(p.Members, '$') LIKE '%' + CAST(@UserId AS VARCHAR) + '%')
        )
        BEGIN
            SET @ResponseCode = 200; SET @ResponseMess = 'Project retrieved successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   p.Id, p.Name, p.Description, p.ManagerUserId, p.TeamId, p.Members,
                   p.Status, p.Priority, p.StartDate, p.EndDate, p.Budget, p.Progress,
                   p.BranchId,
                   u.FullName AS ManagerName, t.Name AS TeamName,
                   (SELECT COUNT(*) FROM tblTasks ts WHERE ts.ProjectId = p.Id AND ts.IsDeleted = 0) AS TaskCount
            FROM tblProjects p
            INNER JOIN tblUser u ON p.ManagerUserId = u.Id
            LEFT JOIN tblTeams t ON p.TeamId = t.Id
            WHERE p.Id = @Id;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 404; SET @ResponseMess = 'Project not found or access denied';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   NULL AS Id, NULL AS Name, NULL AS Description, NULL AS ManagerUserId,
                   NULL AS TeamId, NULL AS Members, NULL AS Status, NULL AS Priority,
                   NULL AS StartDate, NULL AS EndDate, NULL AS Budget, NULL AS Progress,
                   NULL AS BranchId, NULL AS ManagerName, NULL AS TeamName, NULL AS TaskCount;
        END
    END
END
GO


-- E2. sp_DeleteWorkspace — the blast radius counts live tasks only (the cascade
--     still removes the soft-deleted ones with the board).
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

    -- 094: soft-deleted tasks go with the board but are not "your tasks" to warn about.
    DECLARE @TaskCount INT =
        (SELECT COUNT(*) FROM dbo.tblTasks WHERE WorkspaceId = @WorkspaceId AND IsDeleted = 0);
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


-- E3. sp_DeleteProject — a soft-deleted task does not keep a project alive.
--     tblTasks.ProjectId has no FK (checked 2026-10-07), so the delete itself
--     is unchanged; the deleted tasks keep their dangling ProjectId.
-- ================================
-- PROJECT MANAGEMENT DELETE PROCEDURES
-- ================================

-- Delete Project
CREATE OR ALTER PROCEDURE sp_DeleteProject
@Id INT,
@UserId INT,
@CompId BIGINT,
@BranchId BIGINT,
@IsAdmin BIT
AS
BEGIN 
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);
    
    -- Validation
    IF (@Id IS NULL OR @Id <= 0)
    BEGIN
        SET @ResponseCode = 400;
        SET @ResponseMess = 'Project ID is required';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
        RETURN;
    END
    
    -- Check if project exists and user has permission
    IF NOT EXISTS (
        SELECT 1 FROM tblProjects p
        LEFT JOIN tblTeamMembers tm ON tm.TeamId = p.TeamId AND tm.UserId = @UserId
        WHERE p.Id = @Id AND p.CompId = @CompId
        AND (@IsAdmin = 1 OR p.ManagerUserId = @UserId OR tm.UserId IS NOT NULL OR 
             JSON_VALUE(p.Members, '$') LIKE '%' + CAST(@UserId AS VARCHAR) + '%')
    )
    BEGIN
        SET @ResponseCode = 404;
        SET @ResponseMess = 'Project not found or access denied';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
        RETURN;
    END
    
    -- Check if project has tasks (094: live ones — a deleted task is gone)
    IF EXISTS (SELECT 1 FROM tblTasks WHERE ProjectId = @Id AND IsDeleted = 0)
    BEGIN
        SET @ResponseCode = 409;
        SET @ResponseMess = 'Cannot delete project - has tasks. Please delete all tasks first';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
        RETURN;
    END
    
    DELETE FROM tblProjects WHERE Id = @Id;
    
    SET @ResponseCode = 200;
    SET @ResponseMess = 'Project deleted successfully';
    
    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
END
GO


-- E4. sp_DeleteTeam — a soft-deleted task does not keep a team alive.
--     FK__tblTasks__TeamId__693CA210 would block the DELETE, so the deleted
--     tasks' TeamId is cleared inside the same transaction.
-- ================================
-- TEAM MANAGEMENT DELETE PROCEDURES
-- ================================

-- Delete Team
CREATE OR ALTER PROCEDURE sp_DeleteTeam
@Id INT,
@CompId BIGINT,
@BranchId BIGINT,
@IsAdmin BIT
AS
BEGIN 
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);
    
    -- Validation
    IF (@Id IS NULL OR @Id <= 0)
    BEGIN
        SET @ResponseCode = 400;
        SET @ResponseMess = 'Team ID is required';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
        RETURN;
    END
    
    -- Check if team exists
    IF NOT EXISTS (SELECT 1 FROM tblTeams WHERE Id = @Id AND CompId = @CompId AND (@IsAdmin = 1 OR BranchId = @BranchId))
    BEGIN
        SET @ResponseCode = 404;
        SET @ResponseMess = 'Team not found or access denied';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
        RETURN;
    END
    
    -- Check if team is assigned to projects
    IF EXISTS (SELECT 1 FROM tblProjects WHERE TeamId = @Id)
    BEGIN
        SET @ResponseCode = 409;
        SET @ResponseMess = 'Cannot delete team - assigned to projects. Please reassign projects first';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
        RETURN;
    END
    
    -- Check if team has tasks (094: live ones — a deleted task is gone)
    IF EXISTS (SELECT 1 FROM tblTasks WHERE TeamId = @Id AND IsDeleted = 0)
    BEGIN
        SET @ResponseCode = 409;
        SET @ResponseMess = 'Cannot delete team - has assigned tasks. Please reassign tasks first';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
        RETURN;
    END
    
    BEGIN TRY
        BEGIN TRANSACTION;
        
        -- 094: soft-deleted tasks still point here; the FK would refuse the delete.
        UPDATE tblTasks SET TeamId = NULL WHERE TeamId = @Id AND IsDeleted = 1;
        
        -- Delete team members first
        DELETE FROM tblTeamMembers WHERE TeamId = @Id;
        
        -- Delete the team
        DELETE FROM tblTeams WHERE Id = @Id;
        
        COMMIT TRANSACTION;
        
        SET @ResponseCode = 200;
        SET @ResponseMess = 'Team deleted successfully';
        
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END TRY
    BEGIN CATCH
        ROLLBACK TRANSACTION;
        
        SET @ResponseCode = 500;
        SET @ResponseMess = 'Failed to delete team: ' + ERROR_MESSAGE();
        
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END CATCH
END
GO


CREATE OR ALTER PROCEDURE dbo.sp_SaveTimeEntry
    @Id          BIGINT,
    @TaskId      BIGINT,
    @UserId      INT,
    @Hours       DECIMAL(10,2),
    @Description VARCHAR(500),
    @WorkDate    DATE,
    @CompId      BIGINT,
    @BranchId    BIGINT,
    @IsAdmin     BIT = 0
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);
    DECLARE @TimeEntryId BIGINT;

    -- Validation
    IF (@TaskId IS NULL OR @TaskId <= 0)
    BEGIN
        SET @ResponseCode = 400;
        SET @ResponseMess = 'Task ID is required';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
        RETURN;
    END

    IF (@Hours IS NULL OR @Hours <= 0)
    BEGIN
        SET @ResponseCode = 400;
        SET @ResponseMess = 'Hours must be greater than 0';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
        RETURN;
    END

    -- Authority lives in sp_CheckTaskPermission, same as every other task
    -- write. The old INNER JOIN tblProjects gate could never match a workspace
    -- task (ProjectId is NULL on all of them), so this always 404'd. (062)
    DECLARE @PermTable TABLE (Allowed BIT, Reason VARCHAR(400));
    INSERT INTO @PermTable
    EXEC dbo.sp_CheckTaskPermission
        @TaskId      = @TaskId,
        @WorkspaceId = NULL,
        @CommentId   = NULL,
        @UserId      = @UserId,
        @Action      = 'log_time',
        @IsAdmin     = @IsAdmin,
        @CompId      = @CompId;

    IF NOT EXISTS (SELECT 1 FROM @PermTable WHERE Allowed = 1)
    BEGIN
        SET @ResponseCode = 404;
        SET @ResponseMess = 'Task not found or access denied';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
        RETURN;
    END

    IF (@Id = 0) -- Create new time entry
    BEGIN
        INSERT INTO tblTimeEntries (TaskId, UserId, Hours, Description, WorkDate)
        VALUES (@TaskId, @UserId, @Hours, @Description, @WorkDate);

        SET @TimeEntryId = SCOPE_IDENTITY();
        SET @ResponseCode = 201;
        SET @ResponseMess = 'Time logged successfully';

        UPDATE tblTasks
           SET LoggedHours = ISNULL(LoggedHours, 0) + @Hours
         WHERE Id = @TaskId;
    END
    ELSE -- Update existing time entry
    BEGIN
        DECLARE @OldHours DECIMAL(10,2);

        -- Editing someone else's entry stays owner-only regardless of the
        -- task-level grant above: an admin may correct any entry.
        SELECT @OldHours = Hours
          FROM tblTimeEntries
         WHERE Id = @Id AND (@IsAdmin = 1 OR UserId = @UserId);

        IF (@OldHours IS NULL)
        BEGIN
            SET @ResponseCode = 404;
            SET @ResponseMess = 'Time entry not found or access denied';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
            RETURN;
        END

        UPDATE tblTimeEntries
           SET Hours = @Hours, Description = @Description, WorkDate = @WorkDate
         WHERE Id = @Id;

        SET @TimeEntryId = @Id;
        SET @ResponseCode = 200;
        SET @ResponseMess = 'Time entry updated successfully';

        UPDATE tblTasks
           SET LoggedHours = ISNULL(LoggedHours, 0) - @OldHours + @Hours
         WHERE Id = @TaskId;
    END

    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
           @TimeEntryId AS TimeEntryId;
END
GO

