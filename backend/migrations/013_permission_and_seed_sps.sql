-- ============================================================
-- Migration 013 — sp_CheckTaskPermission + sp_ApplyKanbanTemplate
--                 + sp_SeedDefaultWorkspace
--
-- Single source of truth for task/workspace/comment-level permission
-- decisions. All write SPs and controllers will route permission checks
-- through sp_CheckTaskPermission going forward.
--
-- Supporting SPs:
--   * sp_ApplyKanbanTemplate — seed kanban columns on a workspace from
--     a named template ('basic','scrum','bug','content').
--   * sp_SeedDefaultWorkspace — create a user's personal workspace +
--     owner membership + basic columns on first login (idempotent).
--
-- Permission matrix (locked via approved plan):
--   workspace.Type = 'personal'  → only OwnerUserId allowed (admin blocked)
--   workspace.Type ∈ ('shared','project') + user IsAdmin → bypass
--   otherwise → member role + action mapping (below)
--
-- Action codes:
--   view_task            — any member
--   create_task          — any member (not viewer)
--   edit_fields          — owner | manager | (member AND creator)
--   change_status        — owner | manager | (member AND (creator OR assignee))
--   reassign             — owner | manager | (member AND creator)
--   delete_task          — owner | manager | (member AND creator)
--   comment / reply      — any member
--   edit_own_comment     — comment author only
--   delete_own_comment   — comment author only
--   delete_others_comment— owner | manager
--   pin_comment          — owner | manager
--   log_time             — owner | manager | member (not viewer)
--   add_dependency       — owner | manager | (member AND creator)
--   manage_members       — owner only (admin bypass for non-personal)
-- ============================================================

USE [eCRM+]
GO

SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- ============================================================
-- 1) sp_CheckTaskPermission
-- ============================================================
IF OBJECT_ID('dbo.sp_CheckTaskPermission', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_CheckTaskPermission;
GO

CREATE PROCEDURE dbo.sp_CheckTaskPermission
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
    DECLARE @TaskAssignedTo    INT;
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
               @TaskCreatedBy   = CreatedByUserId,
               @TaskAssignedTo  = AssignedToUserId
          FROM dbo.tblTasks
         WHERE Id = @TaskId;

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
                   @TaskCreatedBy   = CreatedByUserId,
                   @TaskAssignedTo  = AssignedToUserId
              FROM dbo.tblTasks
             WHERE Id = @TaskId;
            IF (@WorkspaceId IS NULL) SET @WorkspaceId = @TaskWorkspaceId;
        END
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

    -- Resolve member role (NULL = not a member)
    SELECT @Role = Role
      FROM dbo.tblWorkspaceMembers
     WHERE WorkspaceId = @WorkspaceId
       AND UserId = @UserId
       AND IsActive = 1;

    IF (@Role IS NULL)
    BEGIN
        SELECT 0 AS Allowed, 'not a workspace member' AS Reason; RETURN;
    END

    -- Per-action rules
    IF (@Action IN ('view_task', 'comment', 'reply'))
        SET @Allowed = 1;

    ELSE IF (@Action = 'create_task'
          OR @Action = 'log_time')
        SET @Allowed = CASE WHEN @Role IN ('owner','manager','member') THEN 1 ELSE 0 END;

    ELSE IF (@Action IN ('edit_fields', 'reassign', 'add_dependency'))
    BEGIN
        IF (@Role IN ('owner','manager')) SET @Allowed = 1;
        ELSE IF (@Role = 'member' AND @TaskCreatedBy = @UserId) SET @Allowed = 1;
    END

    ELSE IF (@Action = 'change_status')
    BEGIN
        IF (@Role IN ('owner','manager')) SET @Allowed = 1;
        ELSE IF (@Role = 'member'
              AND (@TaskCreatedBy = @UserId OR @TaskAssignedTo = @UserId)) SET @Allowed = 1;
    END

    ELSE IF (@Action = 'delete_task')
    BEGIN
        IF (@Role IN ('owner','manager')) SET @Allowed = 1;
        ELSE IF (@Role = 'member' AND @TaskCreatedBy = @UserId) SET @Allowed = 1;
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
        SET @Reason = 'role=' + @Role + ' action=' + @Action;
    ELSE
        SET @Reason = 'role=' + @Role + ' not permitted for ' + @Action;

    SELECT @Allowed AS Allowed, @Reason AS Reason;
END
GO

-- ============================================================
-- 2) sp_ApplyKanbanTemplate
-- ============================================================
IF OBJECT_ID('dbo.sp_ApplyKanbanTemplate', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_ApplyKanbanTemplate;
GO

CREATE PROCEDURE dbo.sp_ApplyKanbanTemplate
    @WorkspaceId  BIGINT,
    @TemplateKey  VARCHAR(40) = 'basic',
    @CompId       BIGINT,
    @BranchId     BIGINT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);

    IF NOT EXISTS (SELECT 1 FROM dbo.tblWorkspaces WHERE Id = @WorkspaceId)
    BEGIN
        SET @ResponseCode = 404;
        SET @ResponseMess = 'Workspace not found';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
    END

    DECLARE @Cols TABLE (SortOrder INT, Title VARCHAR(100), Color VARCHAR(20));

    IF (@TemplateKey = 'basic')
        INSERT INTO @Cols VALUES
            (1,'To Do','#94A3B8'),
            (2,'In Progress','#3B82F6'),
            (3,'Done','#10B981');
    ELSE IF (@TemplateKey = 'scrum')
        INSERT INTO @Cols VALUES
            (1,'Backlog','#94A3B8'),
            (2,'Sprint','#8B5CF6'),
            (3,'In Progress','#3B82F6'),
            (4,'Review','#F59E0B'),
            (5,'Done','#10B981');
    ELSE IF (@TemplateKey = 'bug')
        INSERT INTO @Cols VALUES
            (1,'New','#EF4444'),
            (2,'Triaged','#F59E0B'),
            (3,'In Progress','#3B82F6'),
            (4,'Fixed','#10B981'),
            (5,'Verified','#6366F1');
    ELSE IF (@TemplateKey = 'content')
        INSERT INTO @Cols VALUES
            (1,'Idea','#94A3B8'),
            (2,'Draft','#F59E0B'),
            (3,'Review','#3B82F6'),
            (4,'Published','#10B981');
    ELSE
    BEGIN
        SET @ResponseCode = 400;
        SET @ResponseMess = 'Unknown template key';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
    END

    INSERT INTO dbo.tblKanbanColumns
        (WorkspaceId, Title, Color, SortOrder, MaxTasks, IsActive, CompId, BranchId, IsCompanyWide)
    SELECT @WorkspaceId, c.Title, c.Color, c.SortOrder, NULL, 1, @CompId, @BranchId, 0
      FROM @Cols c;

    SET @ResponseCode = 201;
    SET @ResponseMess = 'Template applied';

    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
           @WorkspaceId AS WorkspaceId, @TemplateKey AS TemplateKey,
           @@ROWCOUNT AS ColumnsCreated;
END
GO

-- ============================================================
-- 3) sp_SeedDefaultWorkspace
-- Creates personal workspace + owner membership + basic columns.
-- Idempotent: if user already has a personal workspace, returns that.
-- ============================================================
IF OBJECT_ID('dbo.sp_SeedDefaultWorkspace', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_SeedDefaultWorkspace;
GO

CREATE PROCEDURE dbo.sp_SeedDefaultWorkspace
    @UserId   INT,
    @CompId   BIGINT,
    @BranchId BIGINT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);
    DECLARE @WorkspaceId BIGINT;
    DECLARE @Seeded BIT = 0;
    DECLARE @FullName VARCHAR(200);

    IF NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Id = @UserId AND IsActive = 1)
    BEGIN
        SET @ResponseCode = 404;
        SET @ResponseMess = 'User not found or inactive';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
    END

    SELECT @FullName = FullName FROM dbo.tblUser WHERE Id = @UserId;

    -- Return existing personal workspace if present
    SELECT TOP 1 @WorkspaceId = Id
      FROM dbo.tblWorkspaces
     WHERE OwnerUserId = @UserId
       AND Type = 'personal'
       AND IsArchived = 0
     ORDER BY Id;

    IF (@WorkspaceId IS NOT NULL)
    BEGIN
        SET @ResponseCode = 200;
        SET @ResponseMess = 'Personal workspace already exists';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               @WorkspaceId AS WorkspaceId, @Seeded AS Seeded;
        RETURN;
    END

    BEGIN TRY
        BEGIN TRANSACTION;

        INSERT INTO dbo.tblWorkspaces
            (Name, Type, OwnerUserId, TeamId, ProjectId, IsArchived,
             Color, Icon, CompId, BranchId)
        VALUES
            (ISNULL(@FullName,'My') + '''s Tasks', 'personal', @UserId, NULL, NULL, 0,
             '#6366F1', 'inbox', @CompId, @BranchId);

        SET @WorkspaceId = SCOPE_IDENTITY();

        INSERT INTO dbo.tblWorkspaceMembers
            (WorkspaceId, UserId, Role, AddedByUserId, IsActive)
        VALUES
            (@WorkspaceId, @UserId, 'owner', @UserId, 1);

        -- Seed basic columns
        INSERT INTO dbo.tblKanbanColumns
            (WorkspaceId, Title, Color, SortOrder, MaxTasks, IsActive, CompId, BranchId, IsCompanyWide)
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

-- ============================================================
-- 4) Sanity checks + smoke probes
-- ============================================================
PRINT '----- migration 013 sanity -----';

SELECT 'sp_CheckTaskPermission' AS chk,
       CASE WHEN OBJECT_ID('dbo.sp_CheckTaskPermission','P') IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
UNION ALL SELECT 'sp_ApplyKanbanTemplate',
       CASE WHEN OBJECT_ID('dbo.sp_ApplyKanbanTemplate','P') IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'sp_SeedDefaultWorkspace',
       CASE WHEN OBJECT_ID('dbo.sp_SeedDefaultWorkspace','P') IS NOT NULL THEN 'OK' ELSE 'MISSING' END;

-- Probe: seed personal workspace for user 2 (Ayush)
PRINT '----- probe: sp_SeedDefaultWorkspace UserId=2 -----';
EXEC dbo.sp_SeedDefaultWorkspace @UserId = 2, @CompId = 1, @BranchId = 1;

-- Re-run should be idempotent (returns existing, Seeded=0)
PRINT '----- probe: sp_SeedDefaultWorkspace UserId=2 (second call, idempotent) -----';
EXEC dbo.sp_SeedDefaultWorkspace @UserId = 2, @CompId = 1, @BranchId = 1;

-- Probe: personal workspace privacy — owner allowed, other user denied (even admin)
PRINT '----- probe: personal privacy (owner=2, viewer=3 admin=1, action=view_task) -----';
DECLARE @PersonalWs BIGINT;
SELECT TOP 1 @PersonalWs = Id FROM dbo.tblWorkspaces WHERE OwnerUserId = 2 AND Type = 'personal';

PRINT 'Expect Allowed=1 for owner:';
EXEC dbo.sp_CheckTaskPermission @WorkspaceId = @PersonalWs, @UserId = 2,
                                @Action = 'view_task', @IsAdmin = 0, @CompId = 1;

PRINT 'Expect Allowed=0 for non-owner even when admin:';
EXEC dbo.sp_CheckTaskPermission @WorkspaceId = @PersonalWs, @UserId = 3,
                                @Action = 'view_task', @IsAdmin = 1, @CompId = 1;
GO
