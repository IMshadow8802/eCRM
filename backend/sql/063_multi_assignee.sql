-- =============================================================================
-- 063_multi_assignee.sql
--
-- Workstream 4 of docs/superpowers/specs/2026-07-29-workspace-permission-model-design.md
--
-- A task gets a SET of assignees instead of one, and assignment — not workspace
-- role — becomes what grants the right to do the work.
--
-- The problem being solved: on a 5-member shared board, exactly three people
-- could touch a given task (owner, manager, and the single assignee — and in
-- every live task the creator IS the owner). The other members could read and
-- comment. A "shared board" was a one-person board with an audience.
--
-- WHAT THIS SCRIPT DOES
--   1. tblTaskAssignee — the new source of truth. Backfilled from the column.
--   2. sp_CheckTaskPermission — resolves assignment from the set; adds
--      manage_checklist and manage_attachments; change_status/log_time consult
--      the set; delete_task gains the "untouched" rule.
--   3. sp_SaveTask — accepts a set, validates every assignee is an active
--      member, replaces the set atomically, seeds delivery receipts for all.
--   4. sp_FetchTask — visibility and search go set-based; adds AssigneesJson +
--      AssigneeCount while KEEPING the scalar columns.
--   5. sp_NotifyCommentAdded / sp_NotifyTaskAssigned — fan out to the set.
--   6. sp_DeleteUser — guard and cleanup point at the new table.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--   tblTasks.AssignedToUserId is NOT dropped. It is demoted to a mirror of the
--   first assignee, written by sp_SaveTask, read by nothing that makes a
--   decision. Reasons, from a full inventory of every reference:
--     * sp_FetchTask's scalar AssignedToUserId/AssigneeName are contractual —
--       the whole web tree reads them. Changing storage and row shape together
--       means everything breaks at once with nothing to bisect.
--     * LEFT JOIN tblUser assignee ON assignee.Id = t.AssignedToUserId fans out
--       under M2M: a 2-assignee task returns twice. The join is in BOTH the
--       count and page queries, so pagination would quietly disagree with
--       itself rather than fail loudly.
--     * IX_tblTasks_WorkspaceId_ColumnId INCLUDEs the column (the drop fails
--       until it is rebuilt) and the FK name is system-generated, so it differs
--       per environment — a hardcoded drop passes on dev and fails on prod.
--   The column, its FK and IX_tblTasks_AssignedToUserId go in a follow-up once
--   the web side no longer reads them. Verify query 6 below asserts the mirror
--   matches the set, so drift is detectable rather than silent.
--
-- sp_SoftDeleteTask also reads the column, but is already dead code: its
-- INNER JOIN tblProjects can never match a workspace task (ProjectId is NULL on
-- all 19). Left alone deliberately — migrating a proc nothing can reach adds
-- risk for no benefit. Delete it in the follow-up.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.tblTaskAssignee', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.tblTaskAssignee (
        Id               BIGINT IDENTITY(1,1) PRIMARY KEY,
        TaskId           BIGINT NOT NULL,
        UserId           INT    NOT NULL,
        AssignedAt       DATETIME NOT NULL CONSTRAINT DF_tblTaskAssignee_AssignedAt DEFAULT (GETDATE()),
        AssignedByUserId INT    NULL,
        CONSTRAINT UQ_tblTaskAssignee_TaskUser UNIQUE (TaskId, UserId),
        CONSTRAINT FK_tblTaskAssignee_Task FOREIGN KEY (TaskId)
            REFERENCES dbo.tblTasks (Id) ON DELETE CASCADE,
        CONSTRAINT FK_tblTaskAssignee_User FOREIGN KEY (UserId)
            REFERENCES dbo.tblUser (Id)
    );

    -- "who is on this task" (the hot path: permission checks)
    CREATE NONCLUSTERED INDEX IX_tblTaskAssignee_TaskId
        ON dbo.tblTaskAssignee (TaskId) INCLUDE (UserId);
    -- "what is assigned to me" (visibility + future my-work views)
    CREATE NONCLUSTERED INDEX IX_tblTaskAssignee_UserId
        ON dbo.tblTaskAssignee (UserId) INCLUDE (TaskId);
END
GO

-- ---------------------------------------------------------------------------
-- 2. Backfill. Idempotent — re-running inserts nothing new.
-- ---------------------------------------------------------------------------
INSERT INTO dbo.tblTaskAssignee (TaskId, UserId, AssignedAt, AssignedByUserId)
SELECT t.Id, t.AssignedToUserId, ISNULL(t.UpdatedDate, GETDATE()), t.CreatedByUserId
  FROM dbo.tblTasks t
 WHERE t.AssignedToUserId IS NOT NULL
   AND t.AssignedToUserId > 0
   AND EXISTS (SELECT 1 FROM dbo.tblUser u WHERE u.Id = t.AssignedToUserId)
   AND NOT EXISTS (SELECT 1 FROM dbo.tblTaskAssignee a
                    WHERE a.TaskId = t.Id AND a.UserId = t.AssignedToUserId);
GO


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
ALTER PROCEDURE dbo.sp_CheckTaskPermission
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


-- ---------------------------------------------------------------------------
-- 4. sp_SaveTask
--
--    @AssigneeIdsJson is the new input: a JSON array of user ids, e.g. '[2,11]'.
--    @AssignedToUserId is kept as a legacy single-assignee alias so older
--    clients (and the untracked mobile app) keep working — when the JSON is
--    absent it is treated as a one-element set.
--
--    NULL @AssigneeIdsJson AND NULL @AssignedToUserId on an UPDATE means "leave
--    assignees alone". Passing '[]' explicitly clears them. This matters
--    because the drag-and-drop path re-sends the whole task; without the
--    distinction, dragging a card would silently unassign everyone.
-- ---------------------------------------------------------------------------
ALTER PROCEDURE dbo.sp_SaveTask
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
    DECLARE @WsTypeChk VARCHAR(20);
    DECLARE @WsIdChk BIGINT = COALESCE(@WorkspaceId,
                                       (SELECT WorkspaceId FROM dbo.tblTasks WHERE Id = @Id));
    SELECT @WsTypeChk = Type FROM dbo.tblWorkspaces WHERE Id = @WsIdChk;

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
        IF NOT EXISTS (SELECT 1 FROM dbo.tblTasks WHERE Id = @Id)
        BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Task not found';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

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
ALTER PROCEDURE dbo.sp_FetchTask
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
    @SearchTerm              NVARCHAR(200) = NULL
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
            IF NOT EXISTS (SELECT 1 FROM dbo.tblTaskReads WHERE TaskId = @Id AND UserId = @UserId)
                INSERT INTO dbo.tblTaskReads (TaskId, UserId, DeliveredAt)
                VALUES (@Id, @UserId, GETDATE());

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
               (SELECT COUNT(*) FROM dbo.tblTasks st WHERE st.ParentTaskId = t.Id) AS SubTaskCount,
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
            OR team.Name LIKE '%' + @SearchTerm + '%');

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
           (SELECT COUNT(*) FROM dbo.tblTasks st WHERE st.ParentTaskId = t.Id) AS SubTaskCount,
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
     ORDER BY ISNULL(t.IsCompleted, 0) ASC,
              CASE t.Priority
                   WHEN 'critical' THEN 1 WHEN 'high' THEN 2
                   WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END,
              t.DueDate ASC, t.Id DESC
     OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
END
GO


-- ---------------------------------------------------------------------------
-- 6. sp_NotifyTaskAssigned — notify ONE named assignee.
--
--    Was: read the scalar column and notify whoever it pointed at, on every
--    save. That re-notified the same person each time the task was touched, and
--    under a set it has no way to know which assignee is NEW.
--
--    Now the caller names the recipient, so taskController can notify exactly
--    the people it just added. @AssigneeUserId falls back to the mirror column
--    when omitted, so any existing caller keeps its old behaviour.
-- ---------------------------------------------------------------------------
ALTER PROCEDURE dbo.sp_NotifyTaskAssigned
    @TaskId          BIGINT,
    @ActorUserId     INT,
    @AssigneeUserId  INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @AssigneeId INT, @Title VARCHAR(500), @CompId BIGINT, @BranchId BIGINT;
    DECLARE @ActorName VARCHAR(200), @WsType VARCHAR(20), @OwnerId INT;

    SELECT @AssigneeId = COALESCE(@AssigneeUserId, t.AssignedToUserId),
           @Title      = t.Title,
           @CompId     = ISNULL(w.CompId, p.CompId),
           @BranchId   = ISNULL(w.BranchId, p.BranchId),
           @WsType     = w.Type,
           @OwnerId    = w.OwnerUserId
      FROM dbo.tblTasks t
      LEFT JOIN dbo.tblWorkspaces w ON w.Id = t.WorkspaceId
      LEFT JOIN dbo.tblProjects   p ON p.Id = t.ProjectId
     WHERE t.Id = @TaskId;

    IF (@AssigneeId IS NULL OR @AssigneeId <= 0) RETURN;
    IF (@WsType = 'personal' AND @AssigneeId = @OwnerId) RETURN;

    SELECT @ActorName = FullName FROM dbo.tblUser WHERE Id = @ActorUserId;

    DECLARE @NotifTitle VARCHAR(200) = 'New task assigned';
    DECLARE @NotifBody  NVARCHAR(1000) =
        ISNULL(@ActorName, 'Someone') + ' assigned you: ' + ISNULL(@Title, '');

    EXEC dbo.sp_CreateNotification
        @UserId       = @AssigneeId,
        @Type         = 'task_assigned',
        @EntityType   = 'task',
        @EntityId     = @TaskId,
        @ActorUserId  = @ActorUserId,
        @Title        = @NotifTitle,
        @Body         = @NotifBody,
        @CompId       = @CompId,
        @BranchId     = @BranchId,
        @SkipSelf     = 1;
END
GO


-- ---------------------------------------------------------------------------
-- 7. sp_DeleteUser
--
--    MANDATORY with this migration: FK_tblTaskAssignee_User means the DELETE
--    would now fail outright for anyone who has ever been assigned a task, and
--    the "has assigned tasks" guard pointed at the mirror column so it would
--    miss a co-assignee entirely.
-- ---------------------------------------------------------------------------
ALTER PROC dbo.sp_DeleteUser
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

    -- Checks the SET, not the mirror: a co-assignee was invisible to the old
    -- guard, which only saw whoever the column happened to point at. (063)
    IF EXISTS (SELECT 1 FROM tblTaskAssignee WHERE UserId = @Id)
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Cannot delete user - has assigned tasks';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF EXISTS (SELECT 1 FROM tblProjects WHERE ManagerUserId = @Id)
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Cannot delete user - is project manager';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF EXISTS (SELECT 1 FROM tblTeams WHERE LeadUserId = @Id)
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Cannot delete user - is team lead';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;
        -- Belt and braces: the guard above should make this a no-op, but the FK
        -- would block the delete if any row survived.
        DELETE FROM tblTaskAssignee WHERE UserId = @Id;
        DELETE FROM tblUserGroupMap WHERE UserId = @Id;
        DELETE FROM tblTeamMembers  WHERE UserId = @Id;
        DELETE FROM tblTimeEntries  WHERE UserId = @Id;
        DELETE FROM tblTaskComments WHERE UserId = @Id;
        DELETE FROM tblUser         WHERE Id = @Id;
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


-- ---------------------------------------------------------------------------
-- 8. sp_NotifyCommentAdded — fan out to EVERY assignee.
--    One-line swap in the UNION; @Recipients' PK and the cursor already handle
--    dedupe and iteration.
-- ---------------------------------------------------------------------------
ALTER PROCEDURE dbo.sp_NotifyCommentAdded
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
            @EntityType  = 'comment',
            @EntityId    = @CommentId,
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


-- =============================================================================
-- Verify after apply
-- =============================================================================
-- 1. Table exists, backfilled 1:1 with the old column (expect Mismatch = 0):
--
-- SELECT (SELECT COUNT(*) FROM tblTasks WHERE AssignedToUserId IS NOT NULL) AS OldAssigned,
--        (SELECT COUNT(*) FROM tblTaskAssignee)                             AS NewRows,
--        (SELECT COUNT(*) FROM tblTasks t
--          WHERE t.AssignedToUserId IS NOT NULL
--            AND NOT EXISTS (SELECT 1 FROM tblTaskAssignee a
--                             WHERE a.TaskId = t.Id AND a.UserId = t.AssignedToUserId)) AS Mismatch;
--
-- 2. All eight procs carry the change:
--
-- SELECT o.name,
--        CASE WHEN m.definition LIKE '%tblTaskAssignee%' THEN 'OK' ELSE 'NOT APPLIED' END AS Status
-- FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
-- WHERE o.name IN ('sp_CheckTaskPermission','sp_SaveTask','sp_FetchTask',
--                  'sp_NotifyTaskAssigned','sp_NotifyCommentAdded','sp_DeleteUser')
-- ORDER BY o.name;   -- sp_NotifyTaskAssigned is the one exception (uses @AssigneeUserId)
--
-- 3. THE POINT OF ALL THIS — a second assignee can now progress the work.
--    Task 10030 (workspace 10011) is created by Raaj(3), assigned to Ayush(2).
--    Vikash(11) is an active member who could previously do nothing.
--
-- BEGIN TRAN;
--   INSERT INTO tblTaskAssignee (TaskId, UserId, AssignedByUserId) VALUES (10030, 11, 3);
--   EXEC sp_CheckTaskPermission @TaskId=10030, @UserId=11, @Action='change_status',      @IsAdmin=0, @CompId=1;
--   -- expect Allowed = 1, reason '... (assignee)'   [was 0 before]
--   EXEC sp_CheckTaskPermission @TaskId=10030, @UserId=11, @Action='manage_checklist',   @IsAdmin=0, @CompId=1;
--   EXEC sp_CheckTaskPermission @TaskId=10030, @UserId=11, @Action='manage_attachments', @IsAdmin=0, @CompId=1;
--   -- expect Allowed = 1 for both
--   EXEC sp_CheckTaskPermission @TaskId=10030, @UserId=11, @Action='edit_fields',        @IsAdmin=0, @CompId=1;
--   -- expect Allowed = 0 — being assigned does NOT let you redefine the task
-- ROLLBACK TRAN;
--
-- 4. A non-assigned member still cannot progress (Vikash without the row above):
--
-- EXEC sp_CheckTaskPermission @TaskId=10030, @UserId=11, @Action='change_status', @IsAdmin=0, @CompId=1;
-- -- expect Allowed = 0
--
-- 5. Assigning a non-member is refused:
--
-- EXEC sp_SaveTask @Id=10030, @Title='x', @AssigneeIdsJson='[1]', @CreatedByUserId=3,
--      @WorkspaceId=10011, @CompId=1, @BranchId=1, @IsAdmin=0;
-- -- expect 400 'Every assignee must be an active member of this workspace'
-- --   (UserId 1 'Super' is not a member of 10011)
--
-- 6. THE MIRROR MATCHES THE SET. Run this after any assignment change; a
--    non-zero result means something wrote the column directly, which nothing
--    should. Keep this handy until the column is dropped.
--
-- SELECT t.Id, t.AssignedToUserId AS Mirror,
--        (SELECT MIN(UserId) FROM tblTaskAssignee a WHERE a.TaskId = t.Id) AS FirstAssignee
--   FROM tblTasks t
--  WHERE ISNULL(t.AssignedToUserId, -1)
--        <> ISNULL((SELECT MIN(UserId) FROM tblTaskAssignee a WHERE a.TaskId = t.Id), -1);
-- -- expect zero rows
--
-- 7. Drag-and-drop must NOT unassign. It re-sends the whole task with no
--    assignee fields, which must mean "leave them alone":
--
-- BEGIN TRAN;
--   EXEC sp_SaveTask @Id=10030, @Title='Same title', @ColumnId=NULL, @CreatedByUserId=3,
--        @WorkspaceId=10011, @CompId=1, @BranchId=1, @IsAdmin=0;
--   SELECT COUNT(*) FROM tblTaskAssignee WHERE TaskId = 10030;  -- expect unchanged, not 0
-- ROLLBACK TRAN;
--
-- 8. Explicit clear still works:
--
-- BEGIN TRAN;
--   EXEC sp_SaveTask @Id=10030, @Title='x', @AssigneeIdsJson='[]', @CreatedByUserId=3,
--        @WorkspaceId=10011, @CompId=1, @BranchId=1, @IsAdmin=0;
--   SELECT COUNT(*) FROM tblTaskAssignee WHERE TaskId = 10030;  -- expect 0
-- ROLLBACK TRAN;
-- =============================================================================
