-- 100_task_tat.sql — P3 of docs/superpowers/specs/2026-10-07-task-tat-presence-design.md:
-- task TAT clocks (one per task + assignee), holds, events, policy; sp_SaveTask /
-- sp_FetchTask gain DueTime + TatMinutes; sp_FetchWorkSettings RS4 = the policy.
-- Needs 099_presence.sql applied first (tblCompanySetting.GoLiveDate, tblPresenceDay).
-- Additive and backward compatible: safe to apply while the old Node is running
-- (new params are optional, new result columns are appended to every branch).
-- Apply (both DBs): sqlcmd ... -C -b -I -i sql/100_task_tat.sql
-- Idempotent (safe to apply twice). Verify-after-apply block at the end.
--
-- Division of work: SQL decides WHICH clocks exist (sp_TatReconcile) and stamps
-- warn/breach (sp_TatSweep); Node (tatService) computes every DueAt/WarnAt with
-- workCalendar.js and writes them back through sp_TatApplyDue.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO

-- 1. Schema ---------------------------------------------------------------
IF COL_LENGTH('dbo.tblTasks', 'DueTime') IS NULL    ALTER TABLE dbo.tblTasks ADD DueTime TIME(0) NULL;
IF COL_LENGTH('dbo.tblTasks', 'TatMinutes') IS NULL ALTER TABLE dbo.tblTasks ADD TatMinutes INT NULL;  -- NULL = policy, 0 = no clock

IF OBJECT_ID('dbo.tblTaskTatPolicy') IS NULL
CREATE TABLE dbo.tblTaskTatPolicy (
    CompId   BIGINT      NOT NULL,
    Priority VARCHAR(20) NOT NULL,
    Minutes  INT         NOT NULL,
    CONSTRAINT PK_tblTaskTatPolicy PRIMARY KEY (CompId, Priority)
);

IF OBJECT_ID('dbo.tblTaskTat') IS NULL
CREATE TABLE dbo.tblTaskTat (
    Id             BIGINT IDENTITY(1,1) PRIMARY KEY,
    CompId         BIGINT        NOT NULL,
    TaskId         BIGINT        NOT NULL,
    UserId         INT           NOT NULL,
    AssignedAt     DATETIME      NOT NULL,
    AnchorAt       DATETIME      NOT NULL,
    TargetMinutes  INT           NULL,         -- NULL = due-date target
    HeldMinutes    INT           NOT NULL CONSTRAINT DF_tblTaskTat_Held  DEFAULT 0,
    DueAt          DATETIME      NULL,
    WarnAt         DATETIME      NULL,
    DueStale       BIT           NOT NULL CONSTRAINT DF_tblTaskTat_Stale DEFAULT 1,
    StaleKind      VARCHAR(10)   NOT NULL CONSTRAINT DF_tblTaskTat_Kind  DEFAULT 'assign',
    StaleSeq       INT           NOT NULL CONSTRAINT DF_tblTaskTat_Seq   DEFAULT 0,  -- bumped with every DueStale=1
    AcknowledgedAt DATETIME      NULL,
    WarnedAt       DATETIME      NULL,
    BreachedAt     DATETIME      NULL,
    ReopenedAt     DATETIME      NULL,
    LastClosedAt   DATETIME      NULL,
    ClosedAt       DATETIME      NULL,
    CloseReason    VARCHAR(15)   NULL,  -- completed | my_part_done | unassigned | deleted | user_left | no_clock
    BreachReasonId INT           NULL,
    BreachRemarks  NVARCHAR(500) NULL,
    ReasonAt       DATETIME      NULL,
    Verdict        VARCHAR(12)   NULL,  -- excused | not_excused
    VerdictBy      INT           NULL,  -- NULL with a verdict = the system
    VerdictRemarks NVARCHAR(500) NULL,
    VerdictAt      DATETIME      NULL,
    TaskTitle      NVARCHAR(500) NOT NULL,
    ManagerId      INT           NULL,
    BranchId       BIGINT        NULL
);
-- Fix round 1: guarded ADD too, for a DB where tblTaskTat predates StaleSeq.
IF COL_LENGTH('dbo.tblTaskTat', 'StaleSeq') IS NULL
    ALTER TABLE dbo.tblTaskTat ADD StaleSeq INT NOT NULL CONSTRAINT DF_tblTaskTat_Seq DEFAULT 0;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_tblTaskTat_Open')
CREATE UNIQUE INDEX UX_tblTaskTat_Open ON dbo.tblTaskTat (TaskId, UserId) WHERE ClosedAt IS NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tblTaskTat_Sweep')
CREATE INDEX IX_tblTaskTat_Sweep ON dbo.tblTaskTat (CompId, ClosedAt) INCLUDE (DueAt, WarnAt, WarnedAt, BreachedAt, DueStale);

IF OBJECT_ID('dbo.tblTaskTatHold') IS NULL
CREATE TABLE dbo.tblTaskTatHold (
    Id            BIGINT IDENTITY(1,1) PRIMARY KEY,
    TatId         BIGINT        NOT NULL,
    Kind          VARCHAR(8)    NOT NULL,   -- blocked | manual
    ReasonId      INT           NULL,
    Remarks       NVARCHAR(500) NULL,
    StartedAt     DATETIME      NOT NULL CONSTRAINT DF_tblTaskTatHold_At DEFAULT GETDATE(),
    StartedBy     INT           NULL,
    AutoReleaseAt DATETIME      NULL,
    EndedAt       DATETIME      NULL,
    EndedBy       INT           NULL,
    HeldMinutes   INT           NULL,
    AppliedAt     DATETIME      NULL
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tblTaskTatHold_Tat')
CREATE INDEX IX_tblTaskTatHold_Tat ON dbo.tblTaskTatHold (TatId, EndedAt);

IF OBJECT_ID('dbo.tblTaskTatEvent') IS NULL
CREATE TABLE dbo.tblTaskTatEvent (
    Id          BIGINT IDENTITY(1,1) PRIMARY KEY,
    TatId       BIGINT        NOT NULL,
    Kind        VARCHAR(12)   NOT NULL,   -- assign | reopen | resume | change | hold | release | acknowledge | my_part_done | reason | verdict
    OldValue    NVARCHAR(200) NULL,
    NewValue    NVARCHAR(200) NULL,
    ActorUserId INT           NULL,
    At          DATETIME      NOT NULL CONSTRAINT DF_tblTaskTatEvent_At DEFAULT GETDATE()
);
GO

-- 2. Seeds, per company, never overwriting an admin's edits -----------------
--    tblLookup.Kind has no CHECK constraint (checked live 2026-10-08): nothing to widen.
INSERT INTO dbo.tblTaskTatPolicy (CompId, Priority, Minutes)
SELECT c.CompId, p.Priority, p.Minutes
FROM (SELECT DISTINCT CompId FROM dbo.tblUser WHERE CompId IS NOT NULL) c
CROSS JOIN (VALUES ('critical', 120), ('high', 240), ('medium', 480), ('low', 1440)) p (Priority, Minutes)
WHERE NOT EXISTS (SELECT 1 FROM dbo.tblTaskTatPolicy x WHERE x.CompId = c.CompId AND x.Priority = p.Priority);

INSERT INTO dbo.tblLookup (CompId, Kind, Code, Value, SortOrder, IsActive)
SELECT c.CompId, v.Kind, v.Code, v.Value, v.SortOrder, 1
FROM (SELECT DISTINCT CompId FROM dbo.tblUser WHERE CompId IS NOT NULL) c
CROSS JOIN (VALUES
    ('task_hold_reason',   'waiting_client',    N'Waiting on client',      1),
    ('task_hold_reason',   'waiting_colleague', N'Waiting on a colleague', 2),
    ('task_hold_reason',   'other',             N'Other',                  3),
    ('task_breach_reason', 'waiting',           N'Waiting on someone',     1),
    ('task_breach_reason', 'scope',             N'Scope grew',             2),
    ('task_breach_reason', 'technical',         N'Technical issue',        3),
    ('task_breach_reason', 'other',             N'Other',                  4)
) v (Kind, Code, Value, SortOrder)
WHERE NOT EXISTS (SELECT 1 FROM dbo.tblLookup l
                   WHERE l.CompId = c.CompId AND l.Kind = v.Kind AND l.Code = v.Code);
GO

-- ===========================================================================
-- 3a. sp_SaveTask — live text (094/095, verified byte-identical 2026-10-08) with:
--     + @DueTime / @TatMinutes / @CanSetTarget / @HasDueTime (optional; old Node unaffected)
--     + DueTime: written from @DueTime only when @HasDueTime = 1, else the stored one is
--       kept; always cleared when @DueDate is NULL
--     + TatMinutes written only when @CanSetTarget = 1
--     + RS3 gains 'DueTime' and 'TatMinutes' change rows (Node marks clocks stale on them)
--     Everything else is byte-for-byte the live procedure.
-- ===========================================================================
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
    @BranchId           BIGINT,
    -- 100: optional, so the old Node keeps working unchanged.
    @DueTime            TIME(0)         = NULL,   -- used when @HasDueTime = 1; always cleared when @DueDate is NULL
    @TatMinutes         INT             = NULL,   -- NULL = company policy, 0 = no clock
    @CanSetTarget       BIT             = NULL,   -- 1 = caller may set @TatMinutes; else it is ignored
    @HasDueTime         BIT             = NULL    -- 1 = write @DueTime (NULL clears); NULL = keep the stored one
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

    IF (@CanSetTarget = 1 AND @TatMinutes IS NOT NULL AND @TatMinutes NOT BETWEEN 0 AND 100000)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Target must be 0 to 100000 minutes';
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
    DECLARE @OldDueTime TIME(0), @OldTatMinutes INT;
    DECLARE @NewDueTime TIME(0);   -- set once @OldDueTime is known
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
               @OldDescription = Description,
               @OldDueTime = DueTime, @OldTatMinutes = TatMinutes
          FROM dbo.tblTasks WHERE Id = @Id;
        INSERT INTO @OldAssignees (UserId) SELECT UserId FROM dbo.tblTaskAssignee WHERE TaskId = @Id;

        INSERT INTO @PermTable
        EXEC dbo.sp_CheckTaskPermission
            @TaskId = @Id, @WorkspaceId = NULL, @CommentId = NULL,
            @UserId = @CreatedByUserId, @Action = 'edit_fields',
            @IsAdmin = @IsAdmin, @CompId = @CompId;
    END

    -- 100: a caller that does not send the time keeps the stored one; no date, no time.
    SET @NewDueTime = CASE WHEN @DueDate IS NULL THEN NULL
                           WHEN @HasDueTime = 1 THEN @DueTime
                           ELSE @OldDueTime END;

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
                 CompletedDate, CompletedByUserId, UpdatedDate,
                 DueTime, TatMinutes)
            VALUES
                (@Title, @Description, @WorkspaceId, @ColumnId, @ProjectId, @ParentTaskId,
                 @PrimaryAssignee, @CreatedByUserId, @TeamId, @Priority, @Type,
                 @DueDate, @EstimatedHours, @LoggedHours, @Progress, @IsBlocked,
                 0, @Labels, @Watchers,
                 NULL, NULL, GETDATE(),
                 @NewDueTime, CASE WHEN @CanSetTarget = 1 THEN @TatMinutes ELSE NULL END);

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
                   DueTime = @NewDueTime,
                   TatMinutes = CASE WHEN @CanSetTarget = 1 THEN @TatMinutes ELSE TatMinutes END,
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
                SELECT 'DueTime',
                       ISNULL(CONVERT(NVARCHAR(5), @OldDueTime, 108), N'none'),
                       ISNULL(CONVERT(NVARCHAR(5), @NewDueTime, 108), N'none')
                 WHERE EXISTS (SELECT @OldDueTime EXCEPT SELECT @NewDueTime)
                UNION ALL
                SELECT 'TatMinutes',
                       CASE WHEN @OldTatMinutes IS NULL THEN N'default' WHEN @OldTatMinutes = 0 THEN N'no clock'
                            ELSE CAST(@OldTatMinutes AS NVARCHAR(10)) + N' min' END,
                       CASE WHEN @TatMinutes IS NULL THEN N'default' WHEN @TatMinutes = 0 THEN N'no clock'
                            ELSE CAST(@TatMinutes AS NVARCHAR(10)) + N' min' END
                 WHERE @CanSetTarget = 1
                   AND EXISTS (SELECT @OldTatMinutes EXCEPT SELECT @TatMinutes)
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
-- 3b. sp_FetchTask — live text (094/095, verified byte-identical 2026-10-08) with
--     8 columns appended to EVERY task result set, NULL-shaped ones included:
--     DueTime, TatMinutes, TatDueAt, TatWarnAt, TatBreachedAt, TatHeldSince,
--     TatHoldReason, TatOpenClocks — from the caller's own open clock, else the
--     open clock due first. (A blocked hold has no reason row: Node shows
--     "Blocked" when TatHeldSince is set and TatHoldReason is NULL.)
-- ===========================================================================
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
                   NULL AS AssigneesJson, NULL AS AssigneeCount,
                   CAST(NULL AS CHAR(5)) AS DueTime, CAST(NULL AS INT) AS TatMinutes,
                   CAST(NULL AS DATETIME) AS TatDueAt, CAST(NULL AS DATETIME) AS TatWarnAt,
                   CAST(NULL AS DATETIME) AS TatBreachedAt, CAST(NULL AS DATETIME) AS TatHeldSince,
                   CAST(NULL AS NVARCHAR(400)) AS TatHoldReason, CAST(NULL AS INT) AS TatOpenClocks;
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
               (SELECT COUNT(*) FROM dbo.tblTaskAssignee ta WHERE ta.TaskId = t.Id) AS AssigneeCount,
           CONVERT(CHAR(5), t.DueTime, 108) AS DueTime, t.TatMinutes,
           tat.TatDueAt, tat.TatWarnAt, tat.TatBreachedAt, tat.TatHeldSince, tat.TatHoldReason,
           ISNULL(tat.TatOpenClocks, 0) AS TatOpenClocks
          FROM dbo.tblTasks t
          LEFT JOIN dbo.tblKanbanColumns col ON col.Id = t.ColumnId
          LEFT JOIN dbo.tblWorkspaces    w   ON w.Id   = t.WorkspaceId
          LEFT JOIN dbo.tblProjects      p   ON p.Id   = t.ProjectId
          INNER JOIN dbo.tblUser creator     ON creator.Id = t.CreatedByUserId
          LEFT  JOIN dbo.tblUser assignee    ON assignee.Id = t.AssignedToUserId
          LEFT  JOIN dbo.tblTeams team       ON team.Id = t.TeamId
      -- 100: the caller's own open clock, else the open clock due first.
      OUTER APPLY (
          SELECT TOP 1 tt.DueAt AS TatDueAt, tt.WarnAt AS TatWarnAt, tt.BreachedAt AS TatBreachedAt,
                 h.StartedAt AS TatHeldSince, hl.Value AS TatHoldReason,
                 (SELECT COUNT(*) FROM dbo.tblTaskTat c WHERE c.TaskId = t.Id AND c.ClosedAt IS NULL) AS TatOpenClocks
          FROM dbo.tblTaskTat tt
          OUTER APPLY (SELECT TOP 1 StartedAt, ReasonId, Kind FROM dbo.tblTaskTatHold
                        WHERE TatId = tt.Id AND EndedAt IS NULL ORDER BY StartedAt) h
          LEFT JOIN dbo.tblLookup hl ON hl.Id = h.ReasonId
          WHERE tt.TaskId = t.Id AND tt.ClosedAt IS NULL
          ORDER BY CASE WHEN tt.UserId = @UserId THEN 0 ELSE 1 END,
                   CASE WHEN tt.DueAt IS NULL THEN 1 ELSE 0 END, tt.DueAt
      ) tat
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
               NULL AS AssigneesJson, NULL AS AssigneeCount,
                   CAST(NULL AS CHAR(5)) AS DueTime, CAST(NULL AS INT) AS TatMinutes,
                   CAST(NULL AS DATETIME) AS TatDueAt, CAST(NULL AS DATETIME) AS TatWarnAt,
                   CAST(NULL AS DATETIME) AS TatBreachedAt, CAST(NULL AS DATETIME) AS TatHeldSince,
                   CAST(NULL AS NVARCHAR(400)) AS TatHoldReason, CAST(NULL AS INT) AS TatOpenClocks;
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
           (SELECT COUNT(*) FROM dbo.tblTaskAssignee ta WHERE ta.TaskId = t.Id) AS AssigneeCount,
           CONVERT(CHAR(5), t.DueTime, 108) AS DueTime, t.TatMinutes,
           tat.TatDueAt, tat.TatWarnAt, tat.TatBreachedAt, tat.TatHeldSince, tat.TatHoldReason,
           ISNULL(tat.TatOpenClocks, 0) AS TatOpenClocks
      FROM dbo.tblTasks t
      LEFT JOIN dbo.tblKanbanColumns col ON col.Id = t.ColumnId
      LEFT JOIN dbo.tblWorkspaces    w   ON w.Id   = t.WorkspaceId
      LEFT JOIN dbo.tblProjects      p   ON p.Id   = t.ProjectId
      INNER JOIN dbo.tblUser creator     ON creator.Id = t.CreatedByUserId
      LEFT  JOIN dbo.tblUser assignee    ON assignee.Id = t.AssignedToUserId
      LEFT  JOIN dbo.tblTeams team       ON team.Id = t.TeamId
      -- 100: the caller's own open clock, else the open clock due first.
      OUTER APPLY (
          SELECT TOP 1 tt.DueAt AS TatDueAt, tt.WarnAt AS TatWarnAt, tt.BreachedAt AS TatBreachedAt,
                 h.StartedAt AS TatHeldSince, hl.Value AS TatHoldReason,
                 (SELECT COUNT(*) FROM dbo.tblTaskTat c WHERE c.TaskId = t.Id AND c.ClosedAt IS NULL) AS TatOpenClocks
          FROM dbo.tblTaskTat tt
          OUTER APPLY (SELECT TOP 1 StartedAt, ReasonId, Kind FROM dbo.tblTaskTatHold
                        WHERE TatId = tt.Id AND EndedAt IS NULL ORDER BY StartedAt) h
          LEFT JOIN dbo.tblLookup hl ON hl.Id = h.ReasonId
          WHERE tt.TaskId = t.Id AND tt.ClosedAt IS NULL
          ORDER BY CASE WHEN tt.UserId = @UserId THEN 0 ELSE 1 END,
                   CASE WHEN tt.DueAt IS NULL THEN 1 ELSE 0 END, tt.DueAt
      ) tat
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
-- 4. Policy (minutes per priority) + sp_FetchWorkSettings RS4
-- ===========================================================================
CREATE OR ALTER PROCEDURE dbo.sp_FetchTatPolicy
    @CompId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT Priority, Minutes
    FROM dbo.tblTaskTatPolicy
    WHERE CompId = @CompId
    ORDER BY CASE Priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END;
END
GO

-- Replaces the company's whole set. @ItemsJson = [{"Priority":"high","Minutes":240}, ...]
CREATE OR ALTER PROCEDURE dbo.sp_SaveTatPolicy
    @CompId    BIGINT,
    @ItemsJson NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Items TABLE (Priority VARCHAR(20), Minutes INT);

    IF ISJSON(ISNULL(@ItemsJson, N'')) = 0
    BEGIN SELECT 400 AS ResponseCode, 'Invalid policy' AS ResponseMess; RETURN; END

    INSERT INTO @Items (Priority, Minutes)
    SELECT LOWER(LTRIM(RTRIM(Priority))), Minutes
    FROM OPENJSON(@ItemsJson) WITH (Priority VARCHAR(20) '$.Priority', Minutes INT '$.Minutes');

    IF EXISTS (SELECT 1 FROM @Items WHERE ISNULL(Priority, '') NOT IN ('critical','high','medium','low'))
    BEGIN SELECT 400 AS ResponseCode, 'Priority must be critical, high, medium or low' AS ResponseMess; RETURN; END
    IF EXISTS (SELECT 1 FROM @Items WHERE Minutes IS NULL OR Minutes < 1 OR Minutes > 100000)
    BEGIN SELECT 400 AS ResponseCode, 'Minutes must be 1 to 100000' AS ResponseMess; RETURN; END
    IF EXISTS (SELECT Priority FROM @Items GROUP BY Priority HAVING COUNT(*) > 1)
    BEGIN SELECT 400 AS ResponseCode, 'Each priority may appear once' AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRAN;
        DELETE FROM dbo.tblTaskTatPolicy WHERE CompId = @CompId;
        INSERT INTO dbo.tblTaskTatPolicy (CompId, Priority, Minutes)
        SELECT @CompId, Priority, Minutes FROM @Items;
        COMMIT;
        SELECT 200 AS ResponseCode, 'Policy saved' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT 500 AS ResponseCode, CAST(ERROR_MESSAGE() AS VARCHAR(400)) AS ResponseMess;
    END CATCH
END
GO

-- RS1–RS3 exactly as 099; RS4 now reads the policy.
CREATE OR ALTER PROCEDURE dbo.sp_FetchWorkSettings
    @CompId BIGINT
AS
BEGIN
    SET NOCOUNT ON;

    -- RS1 always one row (defaults when the company has no settings row yet).
    SELECT ISNULL(s.LateGraceMin, 10)                   AS LateGraceMin,
           ISNULL(s.SessionBufferMin, 120)              AS SessionBufferMin,
           ISNULL(s.WarnPct, 80)                        AS WarnPct,
           ISNULL(s.NotifyNotSignedIn, CAST(1 AS BIT))  AS NotifyNotSignedIn,
           s.GoLiveDate
    FROM (SELECT 1 AS x) d
    LEFT JOIN dbo.tblCompanySetting s ON s.CompId = @CompId;

    -- RS2 shifts. The default also counts users with no shift of their own.
    SELECT w.Id, w.Name, w.IsDefault, w.DaysJson,
           (SELECT COUNT(*) FROM dbo.tblUser u
             WHERE u.CompId = @CompId AND u.IsActive = 1
               AND (u.WorkCalendarId = w.Id OR (w.IsDefault = 1 AND u.WorkCalendarId IS NULL))) AS UserCount
    FROM dbo.tblWorkCalendar w
    WHERE w.CompId = @CompId
    ORDER BY w.IsDefault DESC, w.Name;

    -- RS3 holidays from a year ago onward.
    SELECT h.Id, h.HolidayDate, h.Name, h.BranchId, b.BranchName
    FROM dbo.tblHoliday h
    LEFT JOIN dbo.tblBranch b ON b.Id = h.BranchId
    WHERE h.CompId = @CompId
      AND h.HolidayDate >= DATEADD(YEAR, -1, CAST(GETDATE() AS DATE))
    ORDER BY h.HolidayDate;

    -- RS4 TAT policy (100).
    SELECT CAST(Priority AS VARCHAR(30)) AS Priority, Minutes
    FROM dbo.tblTaskTatPolicy
    WHERE CompId = @CompId
    ORDER BY CASE Priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END;
END
GO

-- ===========================================================================
-- 5. Reconcile: make the open clocks match the eligible assignments.
--    RS1 clocks needing a due time; RS2 ended holds not yet applied.
--    Node computes both (workCalendar.js) and writes back via sp_TatApplyDue.
-- ===========================================================================
CREATE OR ALTER PROCEDURE dbo.sp_TatReconcile
    @CompId BIGINT,
    @TaskId BIGINT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Now DATETIME = GETDATE();
    DECLARE @GoLive DATE = (SELECT GoLiveDate FROM dbo.tblCompanySetting WHERE CompId = @CompId);

    DECLARE @Elig TABLE (TaskId BIGINT, UserId INT, AssignedAt DATETIME, AssignedBy INT,
                         BranchId BIGINT, Title NVARCHAR(500), PRIMARY KEY (TaskId, UserId));
    DECLARE @Closed TABLE (TatId BIGINT PRIMARY KEY);
    DECLARE @Pick   TABLE (TatId BIGINT PRIMARY KEY);
    DECLARE @Ids    TABLE (TatId BIGINT PRIMARY KEY);
    DECLARE @Mgr    TABLE (UserId INT PRIMARY KEY, ManagerId INT);
    DECLARE @Ended  TABLE (TatId BIGINT);

    -- GoLiveDate NULL = feature off for the company: touch nothing.
    IF @GoLive IS NOT NULL
    BEGIN
        BEGIN TRY
            BEGIN TRAN;
            -- One reconcile per company at a time (the save hook and the sweep can overlap);
            -- otherwise two runs could both open the same clock and trip UX_tblTaskTat_Open.
            DECLARE @Lock NVARCHAR(64) = N'tat_reconcile_' + CAST(@CompId AS NVARCHAR(20)), @LockRc INT;
            EXEC @LockRc = sp_getapplock @Resource = @Lock, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 30000;
            IF @LockRc < 0 THROW 50001, 'TAT reconcile is busy for this company; retry', 1;

            INSERT INTO @Elig (TaskId, UserId, AssignedAt, AssignedBy, BranchId, Title)
            SELECT ta.TaskId, ta.UserId, ta.AssignedAt, ta.AssignedByUserId, w.BranchId, t.Title
            FROM dbo.tblTaskAssignee ta
            JOIN dbo.tblTasks      t ON t.Id = ta.TaskId
            JOIN dbo.tblWorkspaces w ON w.Id = t.WorkspaceId
            JOIN dbo.tblUser       u ON u.Id = ta.UserId
            WHERE w.CompId = @CompId
              AND (@TaskId IS NULL OR ta.TaskId = @TaskId)
              AND t.IsDeleted = 0 AND t.IsCompleted = 0
              AND ISNULL(t.TatMinutes, -1) <> 0
              AND w.Type IN ('shared','project') AND w.IsArchived = 0
              AND u.IsActive = 1 AND u.CompId = @CompId
              AND ta.AssignedAt >= CAST(@GoLive AS DATETIME);

            -- 1. Close open clocks with no eligible assignment.
            UPDATE tt
               SET ClosedAt = @Now, LastClosedAt = @Now,
                   CloseReason = CASE
                       WHEN t.IsCompleted = 1                       THEN 'completed'
                       WHEN t.Id IS NULL OR t.IsDeleted = 1         THEN 'deleted'
                       WHEN ISNULL(u.IsActive, 0) = 0               THEN 'user_left'
                       WHEN t.TatMinutes = 0 OR w.Id IS NULL OR w.IsArchived = 1
                            OR w.Type NOT IN ('shared','project')   THEN 'no_clock'
                       ELSE 'unassigned' END
            OUTPUT inserted.Id INTO @Closed (TatId)
            FROM dbo.tblTaskTat tt
            LEFT JOIN dbo.tblTasks      t ON t.Id = tt.TaskId
            LEFT JOIN dbo.tblWorkspaces w ON w.Id = t.WorkspaceId
            LEFT JOIN dbo.tblUser       u ON u.Id = tt.UserId
            WHERE tt.CompId = @CompId AND tt.ClosedAt IS NULL
              AND (@TaskId IS NULL OR tt.TaskId = @TaskId)
              AND NOT EXISTS (SELECT 1 FROM @Elig e WHERE e.TaskId = tt.TaskId AND e.UserId = tt.UserId);

            -- Their open holds end with them. The minutes are applied if the clock
            -- ever reopens/resumes (RS2 lists holds of open clocks only).
            UPDATE h SET EndedAt = @Now
            FROM dbo.tblTaskTatHold h JOIN @Closed c ON c.TatId = h.TatId
            WHERE h.EndedAt IS NULL;

            -- The latest clock per (task, user), for steps 2–4.
            DECLARE @Latest TABLE (TatId BIGINT PRIMARY KEY, TaskId BIGINT, UserId INT,
                                   ClosedAt DATETIME, CloseReason VARCHAR(15));
            INSERT INTO @Latest
            SELECT Id, TaskId, UserId, ClosedAt, CloseReason
            FROM (SELECT tt.Id, tt.TaskId, tt.UserId, tt.ClosedAt, tt.CloseReason,
                         ROW_NUMBER() OVER (PARTITION BY tt.TaskId, tt.UserId
                                            ORDER BY CASE WHEN tt.ClosedAt IS NULL THEN 0 ELSE 1 END,
                                                     tt.ClosedAt DESC, tt.Id DESC) AS rn
                    FROM dbo.tblTaskTat tt
                    JOIN @Elig e ON e.TaskId = tt.TaskId AND e.UserId = tt.UserId
                   WHERE tt.CompId = @CompId) x
            WHERE rn = 1 AND ClosedAt IS NOT NULL;   -- pairs that already have an open clock drop out

            -- 2. Reopen: closed 'completed' within 30 days and eligible again.
            INSERT INTO @Pick (TatId)
            SELECT TatId FROM @Latest
            WHERE CloseReason = 'completed' AND ClosedAt >= DATEADD(DAY, -30, @Now);

            UPDATE tt
               SET ClosedAt = NULL, CloseReason = NULL, ReopenedAt = @Now,
                   DueStale = 1, StaleKind = 'reopen', StaleSeq = tt.StaleSeq + 1, WarnedAt = NULL
            FROM dbo.tblTaskTat tt JOIN @Pick p ON p.TatId = tt.Id;

            INSERT INTO dbo.tblTaskTatEvent (TatId, Kind, At)
            SELECT TatId, 'reopen', @Now FROM @Pick;
            DELETE FROM @Pick;

            -- 3. Resume: closed 'unassigned' less than 7 days ago (re-adding someone cannot reset their clock).
            INSERT INTO @Pick (TatId)
            SELECT TatId FROM @Latest
            WHERE CloseReason = 'unassigned' AND ClosedAt > DATEADD(DAY, -7, @Now);

            UPDATE tt
               SET ClosedAt = NULL, CloseReason = NULL, DueStale = 1, StaleKind = 'change',
                   StaleSeq = tt.StaleSeq + 1, WarnedAt = NULL
            FROM dbo.tblTaskTat tt JOIN @Pick p ON p.TatId = tt.Id;

            INSERT INTO dbo.tblTaskTatEvent (TatId, Kind, At)
            SELECT TatId, 'resume', @Now FROM @Pick;
            DELETE FROM @Pick;

            -- 4. Open a clock for every eligible assignment still without one.
            --    ManagerId = first ACTIVE ReportsTo ancestor (sp_FetchPersonManagers' 'manager' row).
            ;WITH chain AS (
                SELECT e.UserId AS PersonId, u.ReportsTo AS AncId, 1 AS Depth
                  FROM (SELECT DISTINCT UserId FROM @Elig) e
                  JOIN dbo.tblUser u ON u.Id = e.UserId
                 WHERE u.CompId = @CompId AND u.ReportsTo IS NOT NULL
                UNION ALL
                SELECT c.PersonId, m.ReportsTo, c.Depth + 1
                  FROM chain c JOIN dbo.tblUser m ON m.Id = c.AncId
                 WHERE m.CompId = @CompId AND m.ReportsTo IS NOT NULL AND c.Depth < 20
            )
            INSERT INTO @Mgr (UserId, ManagerId)
            SELECT PersonId, AncId
            FROM (SELECT c.PersonId, c.AncId,
                         ROW_NUMBER() OVER (PARTITION BY c.PersonId ORDER BY c.Depth) AS rn
                    FROM chain c
                    JOIN dbo.tblUser a ON a.Id = c.AncId AND a.CompId = @CompId AND a.IsActive = 1
                   WHERE a.Id <> c.PersonId) x
            WHERE rn = 1
            OPTION (MAXRECURSION 32);

            INSERT INTO dbo.tblTaskTat (CompId, TaskId, UserId, AssignedAt, AnchorAt, DueStale, StaleSeq, StaleKind,
                                        TaskTitle, ManagerId, BranchId)
            OUTPUT inserted.Id INTO @Ids (TatId)
            SELECT @CompId, e.TaskId, e.UserId, e.AssignedAt, e.AssignedAt, 1, 1,
                   -- A pair that had a clock closed since this assignment (user reactivated,
                   -- task back from no-clock, reopened after 30 days) must not open already
                   -- overdue: 'change' makes the due time never retroactive.
                   CASE WHEN EXISTS (SELECT 1 FROM dbo.tblTaskTat p
                                      WHERE p.TaskId = e.TaskId AND p.UserId = e.UserId
                                        AND p.ClosedAt >= e.AssignedAt) THEN 'change' ELSE 'assign' END,
                   e.Title, m.ManagerId, e.BranchId
            FROM @Elig e
            LEFT JOIN @Mgr m ON m.UserId = e.UserId
            WHERE NOT EXISTS (SELECT 1 FROM dbo.tblTaskTat o
                               WHERE o.TaskId = e.TaskId AND o.UserId = e.UserId AND o.ClosedAt IS NULL)
              -- "My part done" stays done until the person is assigned afresh.
              AND NOT EXISTS (SELECT 1 FROM @Latest l
                               WHERE l.TaskId = e.TaskId AND l.UserId = e.UserId
                                 AND l.CloseReason = 'my_part_done' AND l.ClosedAt >= e.AssignedAt);

            INSERT INTO dbo.tblTaskTatEvent (TatId, Kind, ActorUserId, At)
            SELECT i.TatId, 'assign', e.AssignedBy, @Now
            FROM @Ids i
            JOIN dbo.tblTaskTat tt ON tt.Id = i.TatId
            JOIN @Elig e ON e.TaskId = tt.TaskId AND e.UserId = tt.UserId;

            -- 5. Blocked holds: a clock is held while its task waits on an open blocker.
            DECLARE @Blocked TABLE (TaskId BIGINT PRIMARY KEY);
            INSERT INTO @Blocked (TaskId)
            SELECT DISTINCT d.TaskId
            FROM dbo.tblTaskDependencies d
            JOIN dbo.tblTasks b ON b.Id = d.DependsOnTaskId
            JOIN dbo.tblTaskTat tt ON tt.TaskId = d.TaskId AND tt.CompId = @CompId AND tt.ClosedAt IS NULL
            WHERE d.Type = 'blocks' AND b.IsCompleted = 0 AND b.IsDeleted = 0
              AND (@TaskId IS NULL OR d.TaskId = @TaskId);

            DELETE FROM @Ids;
            INSERT INTO dbo.tblTaskTatHold (TatId, Kind, StartedAt)
            OUTPUT inserted.TatId INTO @Ids (TatId)
            SELECT tt.Id, 'blocked', @Now
            FROM dbo.tblTaskTat tt
            JOIN @Blocked bl ON bl.TaskId = tt.TaskId
            WHERE tt.CompId = @CompId AND tt.ClosedAt IS NULL
              AND NOT EXISTS (SELECT 1 FROM dbo.tblTaskTatHold h
                               WHERE h.TatId = tt.Id AND h.EndedAt IS NULL);   -- one open hold per clock, any kind

            INSERT INTO dbo.tblTaskTatEvent (TatId, Kind, NewValue, At)
            SELECT TatId, 'hold', N'blocked', @Now FROM @Ids;

            UPDATE h SET EndedAt = @Now
            OUTPUT inserted.TatId INTO @Ended (TatId)
            FROM dbo.tblTaskTatHold h
            JOIN dbo.tblTaskTat tt ON tt.Id = h.TatId
            WHERE tt.CompId = @CompId AND tt.ClosedAt IS NULL
              AND (@TaskId IS NULL OR tt.TaskId = @TaskId)
              AND h.Kind = 'blocked' AND h.EndedAt IS NULL
              AND NOT EXISTS (SELECT 1 FROM @Blocked bl WHERE bl.TaskId = tt.TaskId);

            INSERT INTO dbo.tblTaskTatEvent (TatId, Kind, NewValue, At)
            SELECT TatId, 'release', N'blocked', @Now FROM @Ended;

            -- A hold that ends makes the due time stale, so processPending applies its minutes.
            UPDATE tt
               SET DueStale = 1, StaleKind = CASE WHEN tt.DueStale = 1 THEN tt.StaleKind ELSE 'hold' END,
                   StaleSeq = tt.StaleSeq + 1
            FROM dbo.tblTaskTat tt
            WHERE tt.Id IN (SELECT TatId FROM @Ended);

            COMMIT;
        END TRY
        BEGIN CATCH
            IF @@TRANCOUNT > 0 ROLLBACK;
            THROW;
        END CATCH
    END

    -- RS1 open clocks needing a due time.
    SELECT tt.Id, tt.UserId, tt.AssignedAt, tt.AnchorAt, tt.TargetMinutes, tt.HeldMinutes,
           tt.DueAt, tt.BreachedAt, tt.StaleKind, tt.ReopenedAt, tt.LastClosedAt,
           t.Priority, t.DueDate, t.DueTime, t.TatMinutes AS TaskTatMinutes,
           COALESCE(pp.Minutes, pm.Minutes, 480) AS PolicyMinutes,
           tt.StaleSeq   -- echoed back to sp_TatApplyDue
    FROM dbo.tblTaskTat tt
    JOIN dbo.tblTasks t ON t.Id = tt.TaskId
    LEFT JOIN dbo.tblTaskTatPolicy pp ON pp.CompId = @CompId AND pp.Priority = t.Priority
    LEFT JOIN dbo.tblTaskTatPolicy pm ON pm.CompId = @CompId AND pm.Priority = 'medium'
    WHERE tt.CompId = @CompId AND tt.ClosedAt IS NULL AND tt.DueStale = 1
      AND (@TaskId IS NULL OR tt.TaskId = @TaskId);

    -- RS2 ended holds not yet applied (of open clocks: a closed clock's holds wait for it to reopen).
    SELECT h.Id AS HoldId, h.TatId, tt.UserId, h.StartedAt, h.EndedAt
    FROM dbo.tblTaskTatHold h
    JOIN dbo.tblTaskTat tt ON tt.Id = h.TatId
    WHERE tt.CompId = @CompId AND tt.ClosedAt IS NULL
      AND (@TaskId IS NULL OR tt.TaskId = @TaskId)
      AND h.EndedAt IS NOT NULL AND h.AppliedAt IS NULL;
END
GO

-- items [{Id, DueAt, WarnAt, AnchorAt, TargetMinutes, HeldMinutes, Kind, StaleSeq}], holds [{HoldId, HeldMinutes}].
-- Values are always written; DueStale clears only when StaleSeq is still the one reconcile read
-- (a stale mark that landed in between keeps the clock stale for the next pass).
-- Datetimes are IST wall-clock strings 'YYYY-MM-DD HH:mm:ss' (style 120).
CREATE OR ALTER PROCEDURE dbo.sp_TatApplyDue
    @CompId    BIGINT,
    @ItemsJson NVARCHAR(MAX),
    @HoldsJson NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Raw TABLE (Id BIGINT, DueAt VARCHAR(30), WarnAt VARCHAR(30), AnchorAt VARCHAR(30),
                        TargetMinutes INT, HeldMinutes INT, Kind VARCHAR(12), StaleSeq INT);
    DECLARE @Items TABLE (Id BIGINT PRIMARY KEY, DueAt DATETIME, WarnAt DATETIME, AnchorAt DATETIME,
                          TargetMinutes INT, HeldMinutes INT, Kind VARCHAR(12), StaleSeq INT);
    DECLARE @Chg TABLE (TatId BIGINT, OldDueAt DATETIME, NewDueAt DATETIME);
    DECLARE @Updated INT = 0;

    IF ISJSON(ISNULL(@ItemsJson, N'[]')) = 0 OR ISJSON(ISNULL(@HoldsJson, N'[]')) = 0
    BEGIN SELECT 400 AS ResponseCode, 'Invalid JSON' AS ResponseMess, 0 AS Updated; RETURN; END

    INSERT INTO @Raw
    SELECT Id, DueAt, WarnAt, AnchorAt, TargetMinutes, HeldMinutes, Kind, StaleSeq
    FROM OPENJSON(ISNULL(@ItemsJson, N'[]')) WITH (
        Id BIGINT '$.Id', DueAt VARCHAR(30) '$.DueAt', WarnAt VARCHAR(30) '$.WarnAt',
        AnchorAt VARCHAR(30) '$.AnchorAt', TargetMinutes INT '$.TargetMinutes',
        HeldMinutes INT '$.HeldMinutes', Kind VARCHAR(12) '$.Kind', StaleSeq INT '$.StaleSeq');

    IF EXISTS (SELECT 1 FROM @Raw
                WHERE Id IS NULL
                   OR (DueAt    IS NOT NULL AND TRY_CONVERT(DATETIME, DueAt, 120)    IS NULL)
                   OR (WarnAt   IS NOT NULL AND TRY_CONVERT(DATETIME, WarnAt, 120)   IS NULL)
                   OR (AnchorAt IS NOT NULL AND TRY_CONVERT(DATETIME, AnchorAt, 120) IS NULL))
    BEGIN SELECT 400 AS ResponseCode, 'Invalid item' AS ResponseMess, 0 AS Updated; RETURN; END

    INSERT INTO @Items
    SELECT Id, TRY_CONVERT(DATETIME, DueAt, 120), TRY_CONVERT(DATETIME, WarnAt, 120),
           TRY_CONVERT(DATETIME, AnchorAt, 120), TargetMinutes, HeldMinutes, Kind, StaleSeq
    FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY Id ORDER BY (SELECT 0)) AS rn FROM @Raw) r
    WHERE rn = 1;

    BEGIN TRY
        BEGIN TRAN;
        UPDATE tt
           SET DueAt = i.DueAt, WarnAt = i.WarnAt,
               AnchorAt = ISNULL(i.AnchorAt, tt.AnchorAt),
               TargetMinutes = i.TargetMinutes,
               HeldMinutes = ISNULL(i.HeldMinutes, tt.HeldMinutes),
               DueStale = CASE WHEN tt.StaleSeq = i.StaleSeq THEN 0 ELSE tt.DueStale END
        OUTPUT inserted.Id, deleted.DueAt, inserted.DueAt INTO @Chg (TatId, OldDueAt, NewDueAt)
        FROM dbo.tblTaskTat tt
        JOIN @Items i ON i.Id = tt.Id
        WHERE tt.CompId = @CompId;
        SET @Updated = @@ROWCOUNT;

        INSERT INTO dbo.tblTaskTatEvent (TatId, Kind, OldValue, NewValue)
        SELECT c.TatId, ISNULL(i.Kind, 'change'),
               CONVERT(NVARCHAR(19), c.OldDueAt, 120), CONVERT(NVARCHAR(19), c.NewDueAt, 120)
        FROM @Chg c JOIN @Items i ON i.Id = c.TatId
        WHERE EXISTS (SELECT c.OldDueAt EXCEPT SELECT c.NewDueAt);

        UPDATE h SET HeldMinutes = j.HeldMinutes, AppliedAt = GETDATE()
        FROM dbo.tblTaskTatHold h
        JOIN OPENJSON(ISNULL(@HoldsJson, N'[]')) WITH (HoldId BIGINT '$.HoldId', HeldMinutes INT '$.HeldMinutes') j
          ON j.HoldId = h.Id
        JOIN dbo.tblTaskTat tt ON tt.Id = h.TatId AND tt.CompId = @CompId
        WHERE h.AppliedAt IS NULL;
        COMMIT;
        SELECT 200 AS ResponseCode, 'Due times applied' AS ResponseMess, @Updated AS Updated;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT 500 AS ResponseCode, CAST(ERROR_MESSAGE() AS VARCHAR(400)) AS ResponseMess, 0 AS Updated;
    END CATCH
END
GO

-- Open, unbreached clocks of the task / user / whole company (policy change) get recomputed.
CREATE OR ALTER PROCEDURE dbo.sp_TatMarkStale
    @CompId BIGINT,
    @TaskId BIGINT      = NULL,
    @UserId INT         = NULL,
    @Kind   VARCHAR(10)
AS
BEGIN
    SET NOCOUNT ON;
    IF ISNULL(@Kind, '') NOT IN ('assign','change','reopen','hold')
    BEGIN SELECT 400 AS ResponseCode, 'Invalid kind' AS ResponseMess, 0 AS Marked; RETURN; END

    UPDATE dbo.tblTaskTat
       SET StaleKind = CASE WHEN DueStale = 1 THEN StaleKind ELSE @Kind END,
           DueStale = 1,
           StaleSeq = StaleSeq + 1
     WHERE CompId = @CompId AND ClosedAt IS NULL AND BreachedAt IS NULL
       AND (@TaskId IS NULL OR TaskId = @TaskId)
       AND (@UserId IS NULL OR UserId = @UserId);
    SELECT 200 AS ResponseCode, 'Marked' AS ResponseMess, @@ROWCOUNT AS Marked;
END
GO

-- ===========================================================================
-- 6. Assignee / manager actions
-- ===========================================================================
CREATE OR ALTER PROCEDURE dbo.sp_TatAcknowledge
    @CompId BIGINT,
    @TaskId BIGINT,
    @UserId INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Ack TABLE (TatId BIGINT);
    BEGIN TRY
        BEGIN TRAN;
        UPDATE dbo.tblTaskTat SET AcknowledgedAt = GETDATE()
        OUTPUT inserted.Id INTO @Ack (TatId)
         WHERE CompId = @CompId AND TaskId = @TaskId AND UserId = @UserId
           AND ClosedAt IS NULL AND AcknowledgedAt IS NULL;

        INSERT INTO dbo.tblTaskTatEvent (TatId, Kind, ActorUserId)
        SELECT TatId, 'acknowledge', @UserId FROM @Ack;
        COMMIT;
        SELECT 200 AS ResponseCode, 'Acknowledged' AS ResponseMess,
               CAST(CASE WHEN EXISTS (SELECT 1 FROM @Ack) THEN 1 ELSE 0 END AS BIT) AS Acknowledged;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT 500 AS ResponseCode, CAST(ERROR_MESSAGE() AS VARCHAR(400)) AS ResponseMess, CAST(0 AS BIT) AS Acknowledged;
    END CATCH
END
GO

-- @UserId NULL = every open clock of the task; a clock already on hold (manual or blocked)
-- is left alone. RS1 status; RS2 notified UserId rows.
CREATE OR ALTER PROCEDURE dbo.sp_TatHold
    @CompId        BIGINT,
    @TaskId        BIGINT,
    @UserId        INT           = NULL,
    @ReasonId      INT,
    @Remarks       NVARCHAR(500) = NULL,
    @ActorUserId   INT,
    @AutoReleaseAt DATETIME      = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Reason NVARCHAR(200), @Title VARCHAR(200), @Body NVARCHAR(1000),
            @BranchId BIGINT, @RecipientId INT;
    DECLARE @Held TABLE (TatId BIGINT);
    DECLARE @Mgr TABLE (UserId INT, Source VARCHAR(10));
    DECLARE @Notified TABLE (UserId INT);
    DECLARE @ntf TABLE (ResponseCode INT, ResponseMess VARCHAR(400), NotificationId BIGINT, UserId INT, Type VARCHAR(40));

    SELECT @Reason = Value FROM dbo.tblLookup
     WHERE Id = @ReasonId AND CompId = @CompId AND Kind = 'task_hold_reason' AND IsActive = 1;
    IF @Reason IS NULL
    BEGIN
        SELECT 400 AS ResponseCode, 'Pick a reason for the hold' AS ResponseMess, 0 AS Held;
        SELECT UserId FROM @Notified; RETURN;
    END
    IF NOT EXISTS (SELECT 1 FROM dbo.tblTaskTat
                    WHERE CompId = @CompId AND TaskId = @TaskId AND ClosedAt IS NULL
                      AND (@UserId IS NULL OR UserId = @UserId))
    BEGIN
        SELECT 404 AS ResponseCode, 'No running clock on this task' AS ResponseMess, 0 AS Held;
        SELECT UserId FROM @Notified; RETURN;
    END

    BEGIN TRY
        BEGIN TRAN;
        INSERT INTO dbo.tblTaskTatHold (TatId, Kind, ReasonId, Remarks, StartedBy, AutoReleaseAt)
        OUTPUT inserted.TatId INTO @Held (TatId)
        SELECT tt.Id, 'manual', @ReasonId, NULLIF(LTRIM(RTRIM(@Remarks)), N''), @ActorUserId, @AutoReleaseAt
        FROM dbo.tblTaskTat tt
        WHERE tt.CompId = @CompId AND tt.TaskId = @TaskId AND tt.ClosedAt IS NULL
          AND (@UserId IS NULL OR tt.UserId = @UserId)
          AND NOT EXISTS (SELECT 1 FROM dbo.tblTaskTatHold h
                           WHERE h.TatId = tt.Id AND h.EndedAt IS NULL);   -- one open hold per clock, any kind

        IF NOT EXISTS (SELECT 1 FROM @Held)
        BEGIN
            ROLLBACK;
            SELECT 409 AS ResponseCode, 'Already on hold' AS ResponseMess, 0 AS Held;
            SELECT UserId FROM @Notified; RETURN;
        END

        INSERT INTO dbo.tblTaskTatEvent (TatId, Kind, NewValue, ActorUserId)
        SELECT TatId, 'hold', LEFT(@Reason, 200), @ActorUserId FROM @Held;

        -- Holding your own clock tells your manager (else the admins).
        IF @UserId = @ActorUserId
        BEGIN
            SELECT TOP 1 @BranchId = tt.BranchId,
                         @Title = LEFT(ISNULL(u.FullName, u.Username) + ' put a task on hold', 200),
                         @Body  = LEFT(tt.TaskTitle + N' — ' + @Reason
                                       + ISNULL(N': ' + NULLIF(LTRIM(RTRIM(@Remarks)), N''), N''), 1000)
              FROM dbo.tblTaskTat tt
              JOIN @Held hd ON hd.TatId = tt.Id
              JOIN dbo.tblUser u ON u.Id = tt.UserId;

            INSERT INTO @Mgr (UserId, Source) EXEC dbo.sp_FetchPersonManagers @UserId = @UserId, @CompId = @CompId;

            DECLARE rcp CURSOR LOCAL FAST_FORWARD FOR SELECT UserId FROM @Mgr;
            OPEN rcp;
            FETCH NEXT FROM rcp INTO @RecipientId;
            WHILE @@FETCH_STATUS = 0
            BEGIN
                INSERT INTO @ntf EXEC dbo.sp_CreateNotification
                    @UserId = @RecipientId, @Type = 'tat_hold', @EntityType = 'task',
                    @EntityId = @TaskId, @ActorUserId = @ActorUserId, @Title = @Title, @Body = @Body,
                    @CompId = @CompId, @BranchId = @BranchId, @SkipSelf = 1;
                FETCH NEXT FROM rcp INTO @RecipientId;
            END
            CLOSE rcp; DEALLOCATE rcp;

            INSERT INTO @Notified (UserId)
            SELECT DISTINCT UserId FROM @ntf WHERE NotificationId IS NOT NULL;
        END
        COMMIT;
        SELECT 200 AS ResponseCode, 'On hold' AS ResponseMess, (SELECT COUNT(*) FROM @Held) AS Held;
        SELECT UserId FROM @Notified;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT 500 AS ResponseCode, CAST(ERROR_MESSAGE() AS VARCHAR(400)) AS ResponseMess, 0 AS Held;
        SELECT CAST(NULL AS INT) AS UserId WHERE 1 = 0;
    END CATCH
END
GO

-- Ends open MANUAL holds (blocked holds end only when the blocker does).
CREATE OR ALTER PROCEDURE dbo.sp_TatRelease
    @CompId      BIGINT,
    @TaskId      BIGINT,
    @UserId      INT = NULL,
    @ActorUserId INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Ended TABLE (TatId BIGINT);
    BEGIN TRY
        BEGIN TRAN;
        UPDATE h SET EndedAt = GETDATE(), EndedBy = @ActorUserId
        OUTPUT inserted.TatId INTO @Ended (TatId)
        FROM dbo.tblTaskTatHold h
        JOIN dbo.tblTaskTat tt ON tt.Id = h.TatId
        WHERE tt.CompId = @CompId AND tt.TaskId = @TaskId AND tt.ClosedAt IS NULL
          AND (@UserId IS NULL OR tt.UserId = @UserId)
          AND h.Kind = 'manual' AND h.EndedAt IS NULL;

        IF NOT EXISTS (SELECT 1 FROM @Ended)
        BEGIN
            ROLLBACK;
            SELECT 404 AS ResponseCode, 'Nothing on hold' AS ResponseMess, 0 AS Released;
            RETURN;
        END

        INSERT INTO dbo.tblTaskTatEvent (TatId, Kind, ActorUserId)
        SELECT TatId, 'release', @ActorUserId FROM @Ended;

        UPDATE tt
           SET DueStale = 1, StaleKind = CASE WHEN tt.DueStale = 1 THEN tt.StaleKind ELSE 'hold' END,
               StaleSeq = tt.StaleSeq + 1
        FROM dbo.tblTaskTat tt
        WHERE tt.Id IN (SELECT TatId FROM @Ended);
        COMMIT;
        SELECT 200 AS ResponseCode, 'Released' AS ResponseMess, (SELECT COUNT(*) FROM @Ended) AS Released;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT 500 AS ResponseCode, CAST(ERROR_MESSAGE() AS VARCHAR(400)) AS ResponseMess, 0 AS Released;
    END CATCH
END
GO

CREATE OR ALTER PROCEDURE dbo.sp_TatMyPartDone
    @CompId BIGINT,
    @TaskId BIGINT,
    @UserId INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @TatId BIGINT, @Others INT, @Now DATETIME = GETDATE();

    BEGIN TRY
        BEGIN TRAN;
        -- Locks the task's open clocks, so two simultaneous presses cannot both close
        -- and leave the task with no clock at all.
        SELECT @TatId  = MAX(CASE WHEN UserId = @UserId THEN Id END),
               @Others = COUNT(CASE WHEN UserId <> @UserId THEN 1 END)
          FROM dbo.tblTaskTat WITH (UPDLOCK, HOLDLOCK)
         WHERE CompId = @CompId AND TaskId = @TaskId AND ClosedAt IS NULL;

        IF @TatId IS NULL
        BEGIN
            ROLLBACK;
            SELECT 404 AS ResponseCode, 'You have no running clock on this task' AS ResponseMess; RETURN;
        END
        IF @Others = 0
        BEGIN
            ROLLBACK;
            SELECT 409 AS ResponseCode, 'You are the only one on this task; complete the task instead' AS ResponseMess; RETURN;
        END

        UPDATE dbo.tblTaskTat
           SET ClosedAt = @Now, LastClosedAt = @Now, CloseReason = 'my_part_done'
         WHERE Id = @TatId AND ClosedAt IS NULL;
        UPDATE dbo.tblTaskTatHold SET EndedAt = @Now, EndedBy = @UserId
         WHERE TatId = @TatId AND EndedAt IS NULL;
        INSERT INTO dbo.tblTaskTatEvent (TatId, Kind, ActorUserId) VALUES (@TatId, 'my_part_done', @UserId);
        COMMIT;
        SELECT 200 AS ResponseCode, 'Your part is done' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT 500 AS ResponseCode, CAST(ERROR_MESSAGE() AS VARCHAR(400)) AS ResponseMess;
    END CATCH
END
GO

-- The person's own reason for running over.
CREATE OR ALTER PROCEDURE dbo.sp_TatSaveReason
    @CompId   BIGINT,
    @TatId    BIGINT,
    @UserId   INT,
    @ReasonId INT,
    @Remarks  NVARCHAR(500) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Owner INT, @Breached DATETIME, @Code VARCHAR(30), @Value NVARCHAR(200);
    SET @Remarks = NULLIF(LTRIM(RTRIM(@Remarks)), N'');

    SELECT @Owner = UserId, @Breached = BreachedAt FROM dbo.tblTaskTat WHERE Id = @TatId AND CompId = @CompId;
    IF @Owner IS NULL
    BEGIN SELECT 404 AS ResponseCode, 'Clock not found' AS ResponseMess; RETURN; END
    IF @Owner <> @UserId
    BEGIN SELECT 403 AS ResponseCode, 'Only the person on this clock can give the reason' AS ResponseMess; RETURN; END
    IF @Breached IS NULL
    BEGIN SELECT 409 AS ResponseCode, 'This task has not run over' AS ResponseMess; RETURN; END

    SELECT @Code = Code, @Value = Value FROM dbo.tblLookup
     WHERE Id = @ReasonId AND CompId = @CompId AND Kind = 'task_breach_reason' AND IsActive = 1;
    IF @Value IS NULL
    BEGIN SELECT 400 AS ResponseCode, 'Pick a reason' AS ResponseMess; RETURN; END
    IF @Code = 'other' AND @Remarks IS NULL
    BEGIN SELECT 400 AS ResponseCode, 'Add a few words for "Other"' AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRAN;
        UPDATE dbo.tblTaskTat
           SET BreachReasonId = @ReasonId, BreachRemarks = @Remarks, ReasonAt = GETDATE()
         WHERE Id = @TatId;
        INSERT INTO dbo.tblTaskTatEvent (TatId, Kind, NewValue, ActorUserId)
        VALUES (@TatId, 'reason', LEFT(@Value, 200), @UserId);
        COMMIT;
        SELECT 200 AS ResponseCode, 'Reason saved' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT 500 AS ResponseCode, CAST(ERROR_MESSAGE() AS VARCHAR(400)) AS ResponseMess;
    END CATCH
END
GO

-- A manager's call on a breach: an active ReportsTo ancestor, or someone who manages the workspace.
CREATE OR ALTER PROCEDURE dbo.sp_TatSaveVerdict
    @CompId                BIGINT,
    @TatId                 BIGINT,
    @ActorUserId           INT,
    @Verdict               VARCHAR(12),
    @Remarks               NVARCHAR(500) = NULL,
    @ActorManagesWorkspace BIT           = 0
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Owner INT, @Breached DATETIME, @Allowed BIT = ISNULL(@ActorManagesWorkspace, 0);
    SET @Remarks = NULLIF(LTRIM(RTRIM(@Remarks)), N'');

    SELECT @Owner = UserId, @Breached = BreachedAt FROM dbo.tblTaskTat WHERE Id = @TatId AND CompId = @CompId;
    IF @Owner IS NULL
    BEGIN SELECT 404 AS ResponseCode, 'Clock not found' AS ResponseMess; RETURN; END
    IF @Owner = @ActorUserId
    BEGIN SELECT 403 AS ResponseCode, 'You cannot judge your own clock' AS ResponseMess; RETURN; END

    IF @Allowed = 0
    BEGIN
        ;WITH chain AS (
            SELECT u.Id, u.ReportsTo, 0 AS Depth
              FROM dbo.tblUser u WHERE u.Id = @Owner AND u.CompId = @CompId
            UNION ALL
            SELECT m.Id, m.ReportsTo, c.Depth + 1
              FROM dbo.tblUser m JOIN chain c ON m.Id = c.ReportsTo
             WHERE m.CompId = @CompId AND c.Depth < 20
        )
        SELECT @Allowed = 1
          FROM chain c JOIN dbo.tblUser u ON u.Id = c.Id
         WHERE c.Depth > 0 AND u.Id = @ActorUserId AND u.IsActive = 1
        OPTION (MAXRECURSION 32);
    END
    IF @Allowed = 0
    BEGIN SELECT 403 AS ResponseCode, 'Only their manager or a workspace manager can decide this' AS ResponseMess; RETURN; END

    IF ISNULL(@Verdict, '') NOT IN ('excused','not_excused')
    BEGIN SELECT 400 AS ResponseCode, 'Invalid verdict' AS ResponseMess; RETURN; END
    IF @Verdict = 'excused' AND @Remarks IS NULL
    BEGIN SELECT 400 AS ResponseCode, 'Say why it is excused' AS ResponseMess; RETURN; END
    IF @Breached IS NULL
    BEGIN SELECT 409 AS ResponseCode, 'This task has not run over' AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRAN;
        UPDATE dbo.tblTaskTat
           SET Verdict = @Verdict, VerdictBy = @ActorUserId, VerdictRemarks = @Remarks, VerdictAt = GETDATE()
         WHERE Id = @TatId;
        INSERT INTO dbo.tblTaskTatEvent (TatId, Kind, NewValue, ActorUserId)
        VALUES (@TatId, 'verdict', @Verdict, @ActorUserId);
        COMMIT;
        SELECT 200 AS ResponseCode, 'Saved' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT 500 AS ResponseCode, CAST(ERROR_MESSAGE() AS VARCHAR(400)) AS ResponseMess;
    END CATCH
END
GO

-- System excuse for days that turned out off (holiday / leave marked late).
-- @BranchId (controller ruling 2026-10-08): only people whose CURRENT office is
-- that one, so a one-office holiday does not excuse other offices' breaches.
CREATE OR ALTER PROCEDURE dbo.sp_TatExcuseForDays
    @CompId   BIGINT,
    @UserId   INT           = NULL,
    @FromAt   DATETIME,
    @ToAt     DATETIME,
    @Why      NVARCHAR(100),
    @BranchId BIGINT        = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Done TABLE (TatId BIGINT);
    BEGIN TRY
        BEGIN TRAN;
        UPDATE tt
           SET Verdict = 'excused', VerdictBy = NULL, VerdictRemarks = @Why, VerdictAt = GETDATE()
        OUTPUT inserted.Id INTO @Done (TatId)
        FROM dbo.tblTaskTat tt
        JOIN dbo.tblUser u ON u.Id = tt.UserId
        WHERE tt.CompId = @CompId
          AND (@UserId IS NULL OR tt.UserId = @UserId)
          AND (@BranchId IS NULL OR u.BranchId = @BranchId)
          AND tt.BreachedAt BETWEEN @FromAt AND @ToAt
          AND tt.Verdict IS NULL;

        INSERT INTO dbo.tblTaskTatEvent (TatId, Kind, NewValue)
        SELECT TatId, 'verdict', N'excused' FROM @Done;
        COMMIT;
        SELECT 200 AS ResponseCode, 'Excused' AS ResponseMess, (SELECT COUNT(*) FROM @Done) AS Excused;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        SELECT 500 AS ResponseCode, CAST(ERROR_MESSAGE() AS VARCHAR(400)) AS ResponseMess, 0 AS Excused;
    END CATCH
END
GO

-- ===========================================================================
-- 7. Reads
-- ===========================================================================
CREATE OR ALTER PROCEDURE dbo.sp_FetchTaskTat
    @CompId BIGINT,
    @TaskId BIGINT
AS
BEGIN
    SET NOCOUNT ON;

    -- RS1 clocks: open first, then newest.
    SELECT tt.Id, tt.TaskId, tt.UserId, u.FullName,
           tt.AssignedAt, tt.AnchorAt, tt.TargetMinutes, tt.HeldMinutes, tt.DueAt, tt.WarnAt,
           tt.DueStale, tt.StaleKind, tt.AcknowledgedAt, tt.WarnedAt, tt.BreachedAt,
           tt.ReopenedAt, tt.LastClosedAt, tt.ClosedAt, tt.CloseReason,
           tt.BreachReasonId, br.Value AS BreachReason, tt.BreachRemarks, tt.ReasonAt,
           tt.Verdict, tt.VerdictBy, ISNULL(vb.FullName, vb.Username) AS VerdictByName,
           tt.VerdictRemarks, tt.VerdictAt, tt.TaskTitle, tt.ManagerId, tt.BranchId,
           r.FirstSeenAt, r.LastSeenAt
    FROM dbo.tblTaskTat tt
    JOIN dbo.tblUser u ON u.Id = tt.UserId
    LEFT JOIN dbo.tblLookup br ON br.Id = tt.BreachReasonId
    LEFT JOIN dbo.tblUser vb ON vb.Id = tt.VerdictBy
    LEFT JOIN dbo.tblTaskReads r ON r.TaskId = tt.TaskId AND r.UserId = tt.UserId
    WHERE tt.CompId = @CompId AND tt.TaskId = @TaskId
    ORDER BY CASE WHEN tt.ClosedAt IS NULL THEN 0 ELSE 1 END, tt.AssignedAt DESC, tt.Id DESC;

    -- RS2 holds (a blocked hold has no reason row).
    SELECT h.Id AS HoldId, h.TatId, tt.UserId, h.Kind, h.ReasonId, hl.Value AS Reason, h.Remarks,
           h.StartedAt, h.StartedBy, ISNULL(sb.FullName, sb.Username) AS StartedByName,
           h.AutoReleaseAt, h.EndedAt, h.EndedBy, h.HeldMinutes
    FROM dbo.tblTaskTatHold h
    JOIN dbo.tblTaskTat tt ON tt.Id = h.TatId
    LEFT JOIN dbo.tblLookup hl ON hl.Id = h.ReasonId
    LEFT JOIN dbo.tblUser sb ON sb.Id = h.StartedBy
    WHERE tt.CompId = @CompId AND tt.TaskId = @TaskId
    ORDER BY h.StartedAt, h.Id;

    -- RS3 events, oldest first.
    SELECT e.Id, e.TatId, tt.UserId, e.Kind, e.OldValue, e.NewValue, e.ActorUserId,
           ISNULL(a.FullName, a.Username) AS ActorName, e.At
    FROM dbo.tblTaskTatEvent e
    JOIN dbo.tblTaskTat tt ON tt.Id = e.TatId
    LEFT JOIN dbo.tblUser a ON a.Id = e.ActorUserId
    WHERE tt.CompId = @CompId AND tt.TaskId = @TaskId
    ORDER BY e.At, e.Id;
END
GO

-- ===========================================================================
-- 8. Sweep (every 60 s per live company, after processPending).
--    One notification per recipient per kind per run, from rows stamped in THIS run.
--    RS1 = notified UserId rows.
-- ===========================================================================
CREATE OR ALTER PROCEDURE dbo.sp_TatSweep
    @CompId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Released TABLE (TatId BIGINT);
    DECLARE @warn   TABLE (TatId BIGINT, TaskId BIGINT, UserId INT, BranchId BIGINT);
    DECLARE @breach TABLE (TatId BIGINT, TaskId BIGINT, UserId INT, BranchId BIGINT);
    DECLARE @Mgr TABLE (UserId INT, Source VARCHAR(10));
    DECLARE @Rcpt TABLE (Kind VARCHAR(12), RecipientId INT, TaskId BIGINT, BranchId BIGINT);
    DECLARE @ntf TABLE (ResponseCode INT, ResponseMess VARCHAR(400), NotificationId BIGINT, UserId INT, Type VARCHAR(40));
    DECLARE @PersonId INT, @RecipientId INT, @Kind VARCHAR(12), @Cnt INT, @EntityId BIGINT,
            @BranchId BIGINT, @Title VARCHAR(200);

    BEGIN TRY
        BEGIN TRAN;

        -- 1. Auto-release manual holds past their AutoReleaseAt.
        UPDATE h SET EndedAt = GETDATE()
        OUTPUT inserted.TatId INTO @Released (TatId)
        FROM dbo.tblTaskTatHold h
        JOIN dbo.tblTaskTat tt ON tt.Id = h.TatId
        WHERE tt.CompId = @CompId AND tt.ClosedAt IS NULL
          AND h.Kind = 'manual' AND h.EndedAt IS NULL AND h.AutoReleaseAt < GETDATE();

        INSERT INTO dbo.tblTaskTatEvent (TatId, Kind, NewValue)
        SELECT TatId, 'release', N'auto' FROM @Released;

        UPDATE tt
           SET DueStale = 1, StaleKind = CASE WHEN tt.DueStale = 1 THEN tt.StaleKind ELSE 'hold' END,
               StaleSeq = tt.StaleSeq + 1
        FROM dbo.tblTaskTat tt
        WHERE tt.Id IN (SELECT TatId FROM @Released);

        -- 2. Warn.
        UPDATE tt SET WarnedAt = GETDATE()
        OUTPUT inserted.Id, inserted.TaskId, inserted.UserId, inserted.BranchId INTO @warn
        FROM dbo.tblTaskTat tt
        WHERE tt.CompId = @CompId AND tt.ClosedAt IS NULL AND tt.DueStale = 0 AND tt.WarnedAt IS NULL
          AND tt.WarnAt <= GETDATE()
          AND NOT EXISTS (SELECT 1 FROM dbo.tblTaskTatHold h WHERE h.TatId = tt.Id AND h.EndedAt IS NULL);

        -- 3. Breach.
        UPDATE tt SET BreachedAt = GETDATE()
        OUTPUT inserted.Id, inserted.TaskId, inserted.UserId, inserted.BranchId INTO @breach
        FROM dbo.tblTaskTat tt
        WHERE tt.CompId = @CompId AND tt.ClosedAt IS NULL AND tt.DueStale = 0 AND tt.BreachedAt IS NULL
          AND tt.DueAt <= GETDATE()
          AND NOT EXISTS (SELECT 1 FROM dbo.tblTaskTatHold h WHERE h.TatId = tt.Id AND h.EndedAt IS NULL);

        -- Recipients. A clock warned and breached in the same run only says "ran over".
        INSERT INTO @Rcpt (Kind, RecipientId, TaskId, BranchId)
        SELECT 'tat_warning', w.UserId, w.TaskId, w.BranchId
        FROM @warn w WHERE NOT EXISTS (SELECT 1 FROM @breach b WHERE b.TatId = w.TatId);

        INSERT INTO @Rcpt (Kind, RecipientId, TaskId, BranchId)
        SELECT 'tat_breach', UserId, TaskId, BranchId FROM @breach;

        DECLARE ppl CURSOR LOCAL FAST_FORWARD FOR SELECT DISTINCT UserId FROM @breach;
        OPEN ppl;
        FETCH NEXT FROM ppl INTO @PersonId;
        WHILE @@FETCH_STATUS = 0
        BEGIN
            DELETE FROM @Mgr;
            INSERT INTO @Mgr (UserId, Source) EXEC dbo.sp_FetchPersonManagers @UserId = @PersonId, @CompId = @CompId;
            INSERT INTO @Rcpt (Kind, RecipientId, TaskId, BranchId)
            SELECT 'tat_breach', m.UserId, b.TaskId, b.BranchId
            FROM @Mgr m CROSS JOIN @breach b
            WHERE b.UserId = @PersonId;
            FETCH NEXT FROM ppl INTO @PersonId;
        END
        CLOSE ppl; DEALLOCATE ppl;

        -- One notification per recipient per kind.
        DECLARE rcp CURSOR LOCAL FAST_FORWARD FOR
            SELECT Kind, RecipientId, COUNT(DISTINCT TaskId), MIN(TaskId), MIN(BranchId)
            FROM @Rcpt GROUP BY Kind, RecipientId;
        OPEN rcp;
        FETCH NEXT FROM rcp INTO @Kind, @RecipientId, @Cnt, @EntityId, @BranchId;
        WHILE @@FETCH_STATUS = 0
        BEGIN
            SET @Title = CASE
                WHEN @Kind = 'tat_warning' AND @Cnt = 1 THEN '1 task is about to run over'
                WHEN @Kind = 'tat_warning'              THEN CAST(@Cnt AS VARCHAR(10)) + ' tasks are about to run over'
                WHEN @Cnt = 1                           THEN '1 task ran over'
                ELSE CAST(@Cnt AS VARCHAR(10)) + ' tasks ran over' END;

            -- EXEC arguments cannot be expressions; several tasks link nowhere.
            IF @Cnt <> 1 SET @EntityId = 0;
            INSERT INTO @ntf EXEC dbo.sp_CreateNotification
                @UserId = @RecipientId, @Type = @Kind, @EntityType = 'task',
                @EntityId = @EntityId,
                @ActorUserId = NULL, @Title = @Title, @Body = NULL,
                @CompId = @CompId, @BranchId = @BranchId, @SkipSelf = 1;
            FETCH NEXT FROM rcp INTO @Kind, @RecipientId, @Cnt, @EntityId, @BranchId;
        END
        CLOSE rcp; DEALLOCATE rcp;

        COMMIT;
        SELECT DISTINCT UserId FROM @ntf WHERE NotificationId IS NOT NULL;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;
    END CATCH
END
GO

-- The person's own day: presence, open clocks, reasons owed.
CREATE OR ALTER PROCEDURE dbo.sp_FetchToday
    @CompId BIGINT,
    @UserId INT
AS
BEGIN
    SET NOCOUNT ON;

    -- RS1 presence today (no row = not signed in yet / no shift / before go-live).
    SELECT FirstSignInAt, LateMinutes, ShiftStart, ShiftEnd
    FROM dbo.tblPresenceDay
    WHERE CompId = @CompId AND UserId = @UserId AND WorkDate = CAST(GETDATE() AS DATE);

    -- RS2 open clocks, due first.
    SELECT tt.Id AS TatId, tt.TaskId, ISNULL(CAST(t.Title AS NVARCHAR(500)), tt.TaskTitle) AS TaskTitle,
           t.WorkspaceId, tt.DueAt, tt.WarnedAt, tt.BreachedAt,
           h.StartedAt AS HeldSince, hl.Value AS HoldReason
    FROM dbo.tblTaskTat tt
    LEFT JOIN dbo.tblTasks t ON t.Id = tt.TaskId
    OUTER APPLY (SELECT TOP 1 StartedAt, ReasonId FROM dbo.tblTaskTatHold
                  WHERE TatId = tt.Id AND EndedAt IS NULL ORDER BY StartedAt) h
    LEFT JOIN dbo.tblLookup hl ON hl.Id = h.ReasonId
    WHERE tt.CompId = @CompId AND tt.UserId = @UserId AND tt.ClosedAt IS NULL
    ORDER BY CASE WHEN tt.DueAt IS NULL THEN 1 ELSE 0 END, tt.DueAt;

    -- RS3 reason pending: own breached clocks with no reason and no verdict yet.
    SELECT tt.Id AS TatId, tt.TaskId, ISNULL(CAST(t.Title AS NVARCHAR(500)), tt.TaskTitle) AS TaskTitle,
           t.WorkspaceId, tt.DueAt, tt.BreachedAt, tt.ClosedAt
    FROM dbo.tblTaskTat tt
    LEFT JOIN dbo.tblTasks t ON t.Id = tt.TaskId
    WHERE tt.CompId = @CompId AND tt.UserId = @UserId
      AND tt.BreachedAt IS NOT NULL AND tt.BreachReasonId IS NULL AND tt.Verdict IS NULL
    ORDER BY tt.BreachedAt DESC;
END
GO

-- Per person: Open, AtRisk (warned, not breached), Over (breached), ReasonPending.
-- Counts are as of now; @WorkDate is accepted for the caller's symmetry with sp_FetchPresence.
CREATE OR ALTER PROCEDURE dbo.sp_FetchTeamToday
    @CompId      BIGINT,
    @WorkDate    DATE = NULL,
    @UserIdsJson NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT u.Id AS UserId,
           COUNT(CASE WHEN tt.ClosedAt IS NULL THEN 1 END) AS [Open],
           COUNT(CASE WHEN tt.ClosedAt IS NULL AND tt.WarnedAt IS NOT NULL AND tt.BreachedAt IS NULL THEN 1 END) AS AtRisk,
           COUNT(CASE WHEN tt.ClosedAt IS NULL AND tt.BreachedAt IS NOT NULL THEN 1 END) AS [Over],
           COUNT(CASE WHEN tt.BreachedAt IS NOT NULL AND tt.BreachReasonId IS NULL AND tt.Verdict IS NULL THEN 1 END) AS ReasonPending
    FROM dbo.tblUser u
    LEFT JOIN dbo.tblTaskTat tt ON tt.UserId = u.Id AND tt.CompId = @CompId
    WHERE u.CompId = @CompId
      AND u.Id IN (SELECT TRY_CAST(value AS INT) FROM OPENJSON(ISNULL(@UserIdsJson, N'[]')))
    GROUP BY u.Id;
END
GO

-- ===========================================================================
-- sp_FetchUser: live text (099/100) plus ONE column, RoleIsAdmin, last in every
-- user SELECT: the role-derived admin flag, decided exactly as sp_FetchUserAccess
-- does (an active membership in an active IsAdmin group). tblUser.IsAdmin is a
-- mirror that can lag; fetchUsers' CanEdit reads this first.
-- ===========================================================================
CREATE OR ALTER PROCEDURE dbo.sp_FetchUser
    @Id INT,
    @CompId BIGINT,
    @BranchId BIGINT,
    @IsAdmin BIT,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @PageNumber INT = 1,
    @PageSize INT = 10,
    @SearchTerm NVARCHAR(100) = NULL,
    -- 098: 0 = the caller may not see contact details, so search must not match on them.
    -- 099: that includes Username.
    @SearchSensitive BIT = 1
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
               (@SearchSensitive = 1 AND u.Username LIKE '%' + @SearchTerm + '%') OR
               u.FullName LIKE '%' + @SearchTerm + '%' OR
               (@SearchSensitive = 1 AND u.Email  LIKE '%' + @SearchTerm + '%') OR
               (@SearchSensitive = 1 AND u.Mobile LIKE '%' + @SearchTerm + '%') OR
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
                   NULL AS CompId, NULL AS BranchId, NULL AS CreatedDate,
                   NULL AS WorkCalendarId, NULL AS PresenceExempt,
                   CAST(NULL AS BIT) AS RoleIsAdmin;
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
                   u.CompId, u.BranchId, u.CreatedDate,
                   u.WorkCalendarId, u.PresenceExempt,
                   CAST(CASE WHEN EXISTS (SELECT 1 FROM tblUserGroupMap rm
                                            JOIN tblUserGroups rg ON rg.Id = rm.GroupId AND rg.IsActive = 1
                                                                 AND rg.CompId = @CompId AND rg.IsAdmin = 1
                                           WHERE rm.UserId = u.Id)
                             THEN 1 ELSE 0 END AS BIT) AS RoleIsAdmin
            FROM tblUser u
            LEFT JOIN tblBranch b ON b.Id = u.BranchId
            WHERE u.CompId = @CompId
              AND ((@UseScope = 1 AND u.BranchId IN (SELECT BranchId FROM @BranchIds))
                OR (@UseScope = 0 AND (@IsAdmin = 1 OR u.BranchId = @BranchId)))
              AND (@SearchTerm IS NULL OR
                   (@SearchSensitive = 1 AND u.Username LIKE '%' + @SearchTerm + '%') OR
                   u.FullName LIKE '%' + @SearchTerm + '%' OR
                   (@SearchSensitive = 1 AND u.Email  LIKE '%' + @SearchTerm + '%') OR
                   (@SearchSensitive = 1 AND u.Mobile LIKE '%' + @SearchTerm + '%') OR
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
                   u.CompId, u.BranchId, u.CreatedDate,
                   u.WorkCalendarId, u.PresenceExempt,
                   CAST(CASE WHEN EXISTS (SELECT 1 FROM tblUserGroupMap rm
                                            JOIN tblUserGroups rg ON rg.Id = rm.GroupId AND rg.IsActive = 1
                                                                 AND rg.CompId = @CompId AND rg.IsAdmin = 1
                                           WHERE rm.UserId = u.Id)
                             THEN 1 ELSE 0 END AS BIT) AS RoleIsAdmin
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
                   NULL AS CompId, NULL AS BranchId, NULL AS CreatedDate,
                   NULL AS WorkCalendarId, NULL AS PresenceExempt,
                   CAST(NULL AS BIT) AS RoleIsAdmin;
        END
    END
END
GO

/* ===========================================================================
   VERIFY AFTER APPLY (read-only; run on both DBs)
   ===========================================================================
-- tables + columns
SELECT name FROM sys.tables WHERE name IN ('tblTaskTatPolicy','tblTaskTat','tblTaskTatHold','tblTaskTatEvent');  -- expect 4
SELECT COL_LENGTH('dbo.tblTasks','DueTime') AS DueTime, COL_LENGTH('dbo.tblTasks','TatMinutes') AS TatMinutes,
       COL_LENGTH('dbo.tblTaskTat','StaleSeq') AS StaleSeq;                         -- all three non-NULL
SELECT name, filter_definition FROM sys.indexes WHERE name IN ('UX_tblTaskTat_Open','IX_tblTaskTat_Sweep','IX_tblTaskTatHold_Tat');  -- 3 rows

-- procs, all with QUOTED_IDENTIFIER ON (every uses_quoted_identifier = 1)
SELECT OBJECT_NAME(object_id) AS proc_name, uses_quoted_identifier FROM sys.sql_modules
WHERE OBJECT_NAME(object_id) IN ('sp_SaveTask','sp_FetchTask','sp_FetchTatPolicy','sp_SaveTatPolicy',
  'sp_FetchWorkSettings','sp_TatReconcile','sp_TatApplyDue','sp_TatMarkStale','sp_TatAcknowledge','sp_TatHold',
  'sp_TatRelease','sp_TatMyPartDone','sp_TatSaveReason','sp_TatSaveVerdict','sp_TatExcuseForDays',
  'sp_FetchTaskTat','sp_TatSweep','sp_FetchToday','sp_FetchTeamToday')
ORDER BY 1;   -- (19 names listed; expect 19 rows, all 1)

-- seeds per company: 4 policy rows, 3 hold reasons, 4 breach reasons
SELECT c.CompId,
       (SELECT COUNT(*) FROM dbo.tblTaskTatPolicy p WHERE p.CompId = c.CompId) AS Policy,
       (SELECT COUNT(*) FROM dbo.tblLookup l WHERE l.CompId = c.CompId AND l.Kind = 'task_hold_reason')   AS HoldReasons,
       (SELECT COUNT(*) FROM dbo.tblLookup l WHERE l.CompId = c.CompId AND l.Kind = 'task_breach_reason') AS BreachReasons
FROM (SELECT DISTINCT CompId FROM dbo.tblUser) c;                                  -- expect 4 / 3 / 4 per row

-- sp_FetchTask: the last 8 columns are DueTime .. TatOpenClocks (detail, list and the empty list)
DECLARE @t BIGINT = (SELECT TOP 1 t.Id FROM dbo.tblTasks t JOIN dbo.tblWorkspaces w ON w.Id = t.WorkspaceId
                      WHERE w.CompId = 1 AND t.IsDeleted = 0 ORDER BY t.Id DESC);
EXEC dbo.sp_FetchTask @Id = @t, @UserId = 1, @CompId = 1, @IsAdmin = 1;
EXEC dbo.sp_FetchTask @Id = 0, @UserId = 1, @CompId = 1, @IsAdmin = 1, @PageSize = 5;
EXEC dbo.sp_FetchTask @Id = 0, @UserId = 1, @CompId = 1, @IsAdmin = 1, @SearchTerm = N'zz-no-such-task-zz';

-- 4 result sets, RS4 = the policy
EXEC dbo.sp_FetchWorkSettings @CompId = 1;

-- sp_FetchUser: RoleIsAdmin is the last column; 1 for every user in an active IsAdmin role
EXEC dbo.sp_FetchUser @Id = 0, @CompId = 1, @BranchId = 1, @IsAdmin = 1, @PageSize = 50;

-- reconcile is a no-op before go-live and returns its two result sets
EXEC dbo.sp_TatReconcile @CompId = 1;
EXEC dbo.sp_FetchTeamToday @CompId = 1, @WorkDate = NULL, @UserIdsJson = N'[1]';
*/
