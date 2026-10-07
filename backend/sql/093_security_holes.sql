-- ===========================================================================
-- 093_security_holes.sql                                         2026-10-07
--
-- Closes live permission holes found by the 2026-10-07 audit
-- (docs/superpowers/specs/2026-10-07-tat-audit/00-findings.md §2).
-- Apply to BOTH clients: eCRM+ and SolarCRM. Then deploy the backend from the
-- fix/security-holes branch — see the notes under each section for which
-- procedure changes its signature.
--
--   1. sp_SaveTaskChecklist   — an item id must belong to the TaskId the
--                               caller was authorised for (S1).
--   2. sp_DeleteTaskChecklist — same; takes @TaskId now (S1).
--   3. sp_ApplyKanbanTemplate — company + role check, no duplicate columns (S3).
--   4. sp_AddTaskDependency   — the blocking task must be in the same
--                               workspace (S4).
--   5. sp_SaveTask            — an edit uses the task's own workspace, never
--                               the client's; personal-workspace tasks can be
--                               assigned only to the owner (S5).
--   6. sp_ValidateUser        — IsAdmin in the login token comes from the
--                               user's active group, not tblUser.IsAdmin (S6).
--   7. sp_FetchAccessibleBranchIds — a deactivated group grants nothing (S7).
--   8. sp_CheckMenuRight      — NEW: server-side menu right check, used by the
--                               Teams and Projects write endpoints (S2).
--   9. sp_FetchTaskChecklist  — the read side of S1: a single item is returned
--                               only from the authorised task.
--
-- DEPLOY: apply this, then deploy the backend IMMEDIATELY. In between, new
-- workspaces get no board columns and checklist deletes fail (see the query
-- at the end of the file).
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
    @ActingUserId INT = NULL
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

        UPDATE dbo.tblTaskChecklist
           SET ItemText    = @ItemText,
               IsCompleted = @IsCompleted,
               SortOrder   = @SortOrder
         WHERE Id = @Id AND TaskId = @TaskId;

        SET @ResponseCode = 200; SET @ResponseMess = 'Checklist item updated';
    END

    EXEC dbo.sp_RecomputeTaskCompletion @TaskId = @TaskId, @ActingUserId = @ActingUserId;

    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
           @Id AS ChecklistId;
END
GO

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

    DELETE FROM dbo.tblTaskChecklist WHERE Id = @Id AND TaskId = @TaskId;

    EXEC dbo.sp_RecomputeTaskCompletion @TaskId = @TaskId, @ActingUserId = @ActingUserId;

    SELECT 200 AS ResponseCode, 'Checklist item deleted' AS ResponseMess,
           @Id AS ChecklistId, @TaskId AS TaskId;
END
GO

-- ---------------------------------------------------------------------------
-- 3. sp_ApplyKanbanTemplate — had no company or role check: any signed-in
--    user could add columns to any workspace id. Same gate as
--    sp_SaveKanbanColumn (plus an accepted invite), and titles that already
--    exist are skipped instead of duplicated. @UserId NULL = refused.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_ApplyKanbanTemplate
    @WorkspaceId  BIGINT,
    @TemplateKey  VARCHAR(40) = 'basic',
    @CompId       BIGINT,
    @BranchId     BIGINT,
    @UserId       INT = NULL,
    @IsAdmin      BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);

    DECLARE @WsType VARCHAR(20), @WsOwner INT;
    SELECT @WsType = Type, @WsOwner = OwnerUserId
      FROM dbo.tblWorkspaces
     WHERE Id = @WorkspaceId AND CompId = @CompId;

    IF (@WsType IS NULL)
    BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Workspace not found';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    DECLARE @CanManage BIT = 0;
    IF (@UserId IS NULL) SET @CanManage = 0;
    ELSE IF (@WsType = 'personal') SET @CanManage = CASE WHEN @WsOwner = @UserId THEN 1 ELSE 0 END;
    ELSE IF (@IsAdmin = 1) SET @CanManage = 1;
    ELSE IF EXISTS (SELECT 1 FROM dbo.tblWorkspaceMembers m
                     WHERE m.WorkspaceId = @WorkspaceId AND m.UserId = @UserId
                       AND m.IsActive = 1 AND m.InviteStatus = 'active'
                       AND m.Role IN ('owner','manager'))
        SET @CanManage = 1;

    IF (@CanManage = 0)
    BEGIN SET @ResponseCode = 403; SET @ResponseMess = 'Permission denied';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

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
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Unknown template key';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    INSERT INTO dbo.tblKanbanColumns
        (WorkspaceId, Title, Color, SortOrder, MaxTasks, IsActive,
         CompId, BranchId, IsCompanyWide)
    SELECT @WorkspaceId, c.Title, c.Color, c.SortOrder, NULL, 1,
           @CompId, @BranchId, 0
      FROM @Cols c
     WHERE NOT EXISTS (SELECT 1 FROM dbo.tblKanbanColumns k
                        WHERE k.WorkspaceId = @WorkspaceId AND k.Title = c.Title
                          AND k.IsActive = 1);

    DECLARE @Created INT = @@ROWCOUNT;

    SET @ResponseCode = 201; SET @ResponseMess = 'Template applied';
    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
           @WorkspaceId AS WorkspaceId, @TemplateKey AS TemplateKey,
           @Created AS ColumnsCreated;
END
GO

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
    SELECT @BlockerWs = WorkspaceId FROM dbo.tblTasks WHERE Id = @DependsOnTaskId;

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

    -- (b) A personal workspace is private to its owner, so only they can hold
    --     its tasks.
    IF (@WsTypeChk = 'personal'
        AND EXISTS (SELECT 1 FROM @Assignees a WHERE a.UserId <> @WsOwnerChk))
    BEGIN SET @ResponseCode = 400;
          SET @ResponseMess = 'A personal task can only be assigned to its owner';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@TeamId IS NOT NULL AND @TeamId > 0
        AND NOT EXISTS (SELECT 1 FROM dbo.tblTeams WHERE Id = @TeamId AND IsActive = 1))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid team selected';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@ParentTaskId IS NOT NULL AND @ParentTaskId > 0
        AND NOT EXISTS (SELECT 1 FROM dbo.tblTasks WHERE Id = @ParentTaskId))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid parent task selected';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    DECLARE @PermTable TABLE (Allowed BIT, Reason VARCHAR(400));
    DECLARE @OldColumnId INT;
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
        SELECT @OldColumnId = ColumnId FROM dbo.tblTasks WHERE Id = @Id;

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
            IF (@ColumnId IS NULL AND @WorkspaceId IS NOT NULL)
                SELECT TOP 1 @ColumnId = Id FROM dbo.tblKanbanColumns
                 WHERE WorkspaceId = @WorkspaceId AND IsActive = 1
                 ORDER BY SortOrder ASC, Id ASC;

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
                   ColumnId = COALESCE(@ColumnId, ColumnId),
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

-- ---------------------------------------------------------------------------
-- 6. sp_ValidateUser — IsAdmin now comes from the user's ACTIVE group(s),
--    the same flag requireAdmin and sp_CheckTaskPermission already use. The
--    tblUser.IsAdmin column (set by a checkbox on the Users form) used to go
--    into the token and from there into user/team/project fetches, deletes
--    and socket rooms, so ticking that box made anyone a partial admin.
--    Live effect on 2026-10-07: exactly one user changes (Admin group, column
--    0) and gains admin, which is what their role already says.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_ValidateUser
    @identifier VARCHAR(150) = NULL,
    @UserId     INT          = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);
    DECLARE @FoundId INT;
    DECLARE @IsActive BIT;

    IF (@UserId IS NOT NULL)
        SELECT TOP 1 @FoundId = Id, @IsActive = IsActive
        FROM tblUser WHERE Id = @UserId;
    ELSE
        SELECT TOP 1 @FoundId = Id, @IsActive = IsActive
        FROM tblUser
        WHERE Username = @identifier OR Email = @identifier OR Mobile = @identifier;

    IF @FoundId IS NULL
    BEGIN
        SET @ResponseCode = 404;
        SET @ResponseMess = 'Username does not exist';

        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               NULL AS UserId, NULL AS UserName, NULL AS Password, NULL AS UserActive, NULL AS IsAdmin,
               NULL AS FullName, NULL AS Email, NULL AS JobTitle, NULL AS HourlyRate,
               NULL AS Mobile, NULL AS Avatar,
               NULL AS CompId, NULL AS BranchId,
               NULL AS CompName, NULL AS CompAddress, NULL AS CompPhone, NULL AS CompState,
               NULL AS CompStateCode, NULL AS CompEmail, NULL AS CompWebSite, NULL AS CompGSTIN;

        SELECT NULL AS MenuId, NULL AS ParentId, NULL AS Description, NULL AS Image,
               NULL AS FormId, NULL AS MenuType, NULL AS ActualId, NULL AS IsAllowed,
               NULL AS FormName, NULL AS FormClass, NULL AS OpenStyle, NULL AS Route,
               NULL AS CanAdd, NULL AS CanEdit, NULL AS CanDelete, NULL AS CanView,
               NULL AS GroupName
        WHERE 1 = 0;
        RETURN;
    END

    IF @IsActive = 0
    BEGIN
        SET @ResponseCode = 403;
        SET @ResponseMess = 'Account is inactive';

        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               NULL AS UserId, NULL AS UserName, NULL AS Password, NULL AS UserActive, NULL AS IsAdmin,
               NULL AS FullName, NULL AS Email, NULL AS JobTitle, NULL AS HourlyRate,
               NULL AS Mobile, NULL AS Avatar,
               NULL AS CompId, NULL AS BranchId,
               NULL AS CompName, NULL AS CompAddress, NULL AS CompPhone, NULL AS CompState,
               NULL AS CompStateCode, NULL AS CompEmail, NULL AS CompWebSite, NULL AS CompGSTIN;

        SELECT NULL AS MenuId, NULL AS ParentId, NULL AS Description, NULL AS Image,
               NULL AS FormId, NULL AS MenuType, NULL AS ActualId, NULL AS IsAllowed,
               NULL AS FormName, NULL AS FormClass, NULL AS OpenStyle, NULL AS Route,
               NULL AS CanAdd, NULL AS CanEdit, NULL AS CanDelete, NULL AS CanView,
               NULL AS GroupName
        WHERE 1 = 0;
        RETURN;
    END

    SET @ResponseCode = 200;
    SET @ResponseMess = 'User found successfully';

    SELECT @ResponseCode AS ResponseCode,
           @ResponseMess AS ResponseMess,
           u.Id       AS UserId,
           u.Username AS UserName,
           u.Password AS Password,
           u.IsActive AS UserActive,
           CAST(CASE WHEN EXISTS (SELECT 1 FROM tblUserGroupMap ugm
                                   JOIN tblUserGroups ug ON ug.Id = ugm.GroupId
                                  WHERE ugm.UserId = u.Id AND ug.IsActive = 1 AND ug.IsAdmin = 1)
                     THEN 1 ELSE 0 END AS BIT) AS IsAdmin,
           u.FullName, u.Email, u.JobTitle, u.HourlyRate,
           u.Mobile, u.Avatar,
           u.CompId, u.BranchId,
           'Your Company Name'  AS CompName,
           'Company Address'    AS CompAddress,
           'Company Phone'      AS CompPhone,
           'State'              AS CompState,
           'ST'                 AS CompStateCode,
           'company@email.com'  AS CompEmail,
           'www.company.com'    AS CompWebSite,
           'GSTIN123456789'     AS CompGSTIN
    FROM tblUser u
    WHERE u.Id = @FoundId;

    SELECT DISTINCT
           m.Id          AS MenuId,
           m.ParentId, m.Description, m.Image, m.FormId, m.MenuType, m.ActualId,
           m.IsAllowed, m.FormName, m.FormClass, m.OpenStyle, m.Route,
           ga.CanAdd, ga.CanEdit, ga.CanDelete, ga.CanView,
           ug.Name AS GroupName
    FROM tblMenu m
    INNER JOIN tblGroupAccess ga    ON m.Id = ga.MenuId
    INNER JOIN tblUserGroupMap ugm  ON ga.GroupId = ugm.GroupId
    INNER JOIN tblUserGroups ug     ON ugm.GroupId = ug.Id
    WHERE ugm.UserId = @FoundId
      AND m.IsAllowed = 1
      AND ga.CanView = 1
      AND ug.IsActive = 1
    ORDER BY m.ParentId, m.Id;
END
GO

-- ---------------------------------------------------------------------------
-- 7. sp_FetchAccessibleBranchIds — a deactivated group used to keep granting
--    its DataScope and IsAdmin (menus already ignored it). Only the group
--    join changes: an inactive group is treated as no group (least privilege).
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchAccessibleBranchIds
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
        @IsAdmin         = ug.IsAdmin,
        @PrimaryBranchId = u.BranchId,
        @IsActive        = u.IsActive
    FROM dbo.tblUser u
    LEFT JOIN dbo.tblUserGroupMap ugm ON ugm.UserId = u.Id
    LEFT JOIN dbo.tblUserGroups   ug  ON ug.Id = ugm.GroupId AND ug.IsActive = 1
    WHERE u.Id = @UserId AND u.CompId = @CompId
    ORDER BY CASE WHEN ug.Id IS NULL THEN 1 ELSE 0 END, ug.HierarchyLevel ASC;

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

-- ---------------------------------------------------------------------------
-- 8. sp_CheckMenuRight — NEW. Menu rights have only ever been enforced by the
--    sidebar. This answers "may this user do <right> on the screen at
--    <route>?" from the same grants the sidebar uses (active groups only).
--    @Right: 'view' | 'add' | 'edit' | 'delete'.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_CheckMenuRight
    @UserId INT,
    @CompId BIGINT,
    @Route  VARCHAR(200),
    @Right  VARCHAR(10)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT CAST(CASE WHEN EXISTS (
        SELECT 1
          FROM dbo.tblUser u
          JOIN dbo.tblUserGroupMap ugm ON ugm.UserId = u.Id
          JOIN dbo.tblUserGroups   ug  ON ug.Id = ugm.GroupId AND ug.IsActive = 1
          JOIN dbo.tblGroupAccess  ga  ON ga.GroupId = ug.Id
          JOIN dbo.tblMenu         m   ON m.Id = ga.MenuId AND m.IsAllowed = 1
         WHERE u.Id = @UserId AND u.CompId = @CompId AND u.IsActive = 1
           AND m.Route = @Route
           AND ga.CanView = 1
           AND CASE @Right
                   WHEN 'view'   THEN ga.CanView
                   WHEN 'add'    THEN ga.CanAdd
                   WHEN 'edit'   THEN ga.CanEdit
                   WHEN 'delete' THEN ga.CanDelete
               END = 1
    ) THEN 1 ELSE 0 END AS BIT) AS Allowed;
END
GO

-- ---------------------------------------------------------------------------
-- 9. sp_FetchTaskChecklist — the read side of S1. The controller authorises
--    @TaskId, but a non-zero @Id was selected by Id alone, returning any
--    item of any task in any company. The single-item branch now requires
--    the item to sit on @TaskId. The list branch is unchanged.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchTaskChecklist
    @Id BIGINT,
    @TaskId BIGINT,
    @CompId BIGINT,
    @BranchId BIGINT,
    @PageNumber INT = 1,
    @PageSize INT = 25,
    @SearchTerm NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @TotalRecords INT, @TotalPages INT, @Offset INT;

    IF (@Id <> 0)
    BEGIN
        IF EXISTS (SELECT 1 FROM tblTaskChecklist WHERE Id = @Id AND TaskId = @TaskId)
            SELECT 200 AS ResponseCode, 'OK' AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   Id, TaskId, ItemText, IsCompleted, SortOrder
            FROM tblTaskChecklist WHERE Id = @Id AND TaskId = @TaskId;
        ELSE
            SELECT 404 AS ResponseCode, 'Checklist item not found' AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   NULL AS Id, NULL AS TaskId, NULL AS ItemText, NULL AS IsCompleted, NULL AS SortOrder;
        RETURN;
    END

    SET @Offset = (@PageNumber - 1) * @PageSize;

    SELECT @TotalRecords = COUNT(*)
    FROM tblTaskChecklist
    WHERE TaskId = @TaskId
      AND (@SearchTerm IS NULL OR ItemText LIKE '%' + @SearchTerm + '%');

    SET @TotalPages = CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize);

    SELECT 200 AS ResponseCode, 'Checklist items retrieved successfully' AS ResponseMess,
           @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
           @PageNumber AS CurrentPage, @PageSize AS PageSize,
           Id, TaskId, ItemText, IsCompleted, SortOrder
    FROM tblTaskChecklist
    WHERE TaskId = @TaskId
      AND (@SearchTerm IS NULL OR ItemText LIKE '%' + @SearchTerm + '%')
    ORDER BY SortOrder, Id
    OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
END
GO

-- ---------------------------------------------------------------------------
-- Verify after apply (each client). Expected values in comments.
-- ---------------------------------------------------------------------------
-- -- 1/2: an item id paired with the wrong task is refused
-- DECLARE @i BIGINT, @t BIGINT, @other BIGINT;
-- SELECT TOP 1 @i = Id, @t = TaskId FROM dbo.tblTaskChecklist;
-- SELECT TOP 1 @other = Id FROM dbo.tblTasks WHERE Id <> @t;
-- BEGIN TRAN;
--   EXEC dbo.sp_SaveTaskChecklist @Id=@i, @TaskId=@other, @ItemText='x', @IsCompleted=0,
--        @SortOrder=1, @CompId=1, @BranchId=1;                 -- 404
--   EXEC dbo.sp_DeleteTaskChecklist @Id=@i, @TaskId=@other, @CompId=1, @BranchId=1; -- 404
-- ROLLBACK;
--
-- -- 3: refused without a caller
-- EXEC dbo.sp_ApplyKanbanTemplate @WorkspaceId=1, @TemplateKey='basic', @CompId=1, @BranchId=1; -- 403 (or 404)
--
-- -- 6: the token's admin flag now follows the group (eCRM+: user 4 → IsAdmin 1)
-- EXEC dbo.sp_ValidateUser @UserId = 4;
--
-- -- 8: HR Manager may add/edit Teams but not delete
-- SELECT u.Id FROM tblUser u JOIN tblUserGroupMap m ON m.UserId=u.Id
--   JOIN tblUserGroups g ON g.Id=m.GroupId WHERE g.Name='HR Manager';  -- pick one, then:
-- EXEC dbo.sp_CheckMenuRight @UserId=<id>, @CompId=1, @Route='/teams', @Right='edit';   -- 1
-- EXEC dbo.sp_CheckMenuRight @UserId=<id>, @CompId=1, @Route='/teams', @Right='delete'; -- 0
--
-- -- 9: an item read through the wrong task is refused
-- DECLARE @ri BIGINT, @rt BIGINT;
-- SELECT TOP 1 @ri = Id, @rt = TaskId FROM dbo.tblTaskChecklist;
-- EXEC dbo.sp_FetchTaskChecklist @Id=@ri, @TaskId=@rt,   @CompId=1, @BranchId=1;  -- 200
-- EXEC dbo.sp_FetchTaskChecklist @Id=@ri, @TaskId=@rt+1, @CompId=1, @BranchId=1;  -- 404
--
-- -- 4: a blocker from another workspace is refused (pick two tasks in different workspaces)
-- DECLARE @a BIGINT, @b BIGINT;
-- SELECT TOP 1 @a = Id FROM dbo.tblTasks ORDER BY Id;
-- SELECT TOP 1 @b = Id FROM dbo.tblTasks WHERE WorkspaceId <> (SELECT WorkspaceId FROM dbo.tblTasks WHERE Id=@a);
-- EXEC dbo.sp_AddTaskDependency @TaskId=@a, @DependsOnTaskId=@b, @ActingUserId=1, @IsAdmin=1, @CompId=1; -- 404
--
-- -- 5b: a personal task cannot be handed to someone else (rolled back)
-- DECLARE @pw BIGINT, @po INT, @other INT;
-- SELECT TOP 1 @pw = Id, @po = OwnerUserId FROM dbo.tblWorkspaces WHERE Type='personal';
-- SELECT TOP 1 @other = Id FROM dbo.tblUser WHERE Id <> @po AND IsActive = 1;
-- BEGIN TRAN;
--   EXEC dbo.sp_SaveTask @Id=0, @Title='093 check', @WorkspaceId=@pw, @CreatedByUserId=@po,
--        @AssigneeIdsJson=N'[' + CAST(@other AS NVARCHAR) + N']', @ChecklistItemsJson=N'["x"]',
--        @CompId=1, @BranchId=1;                                          -- 400
-- ROLLBACK;
--
-- -- 7: nobody resolves to a scope through an inactive group (0 rows)
-- SELECT u.Id FROM tblUser u JOIN tblUserGroupMap m ON m.UserId=u.Id
--   JOIN tblUserGroups g ON g.Id=m.GroupId WHERE g.IsActive = 0;  -- these users now get Self
--
-- ---------------------------------------------------------------------------
-- AFTER the backend deploy: workspaces created between applying this script
-- and the deploy got no board columns (the old backend called the template
-- without a caller and the save does not fail on that). List them, then
-- re-apply a template from the web (Board → columns) or ask for a fix script.
-- ---------------------------------------------------------------------------
-- SELECT w.Id, w.Name, w.Type, w.CreatedDate
--   FROM dbo.tblWorkspaces w
--  WHERE NOT EXISTS (SELECT 1 FROM dbo.tblKanbanColumns k WHERE k.WorkspaceId = w.Id AND k.IsActive = 1)
--    AND w.CreatedDate > DATEADD(DAY, -1, GETDATE());                    -- expect 0 rows
