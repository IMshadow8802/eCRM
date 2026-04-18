-- ============================================================
-- Migration 015 — sp_SaveTask + sp_FetchTask rewritten for WorkspaceId
--
-- Changes:
--   sp_SaveTask
--     * New @WorkspaceId BIGINT param (required on create).
--     * Permission check routed through sp_CheckTaskPermission.
--     * Hard-block on Status='done' transition — refuses unless every
--       entry in tblTaskDependencies (Type='blocks') is resolved.
--     * Sets CompletedDate + CompletedByUserId on Done transition,
--       clears them on move back.
--     * Initializes tblTaskReads row for assignee on create (DeliveredAt).
--     * Bumps UpdatedDate on update.
--     * @Dependencies param retained as no-op for caller compatibility.
--
--   sp_FetchTask
--     * Returns WorkspaceId + IsBlocked computed from tblTaskDependencies.
--     * Visibility rule:
--         - Personal workspace → owner only (admin blocked).
--         - Shared/project → admin bypass OR member of workspace.
--     * Legacy JSON Watchers + p.Members fallback kept so tasks created
--       before migration 015 (none exist) still fetchable via project path.
--     * Writes tblTaskReads.DeliveredAt on list hydration for non-personal
--       workspaces (silent audit; skipped for personal to preserve privacy).
-- ============================================================

USE [eCRM+]
GO

SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

-- ============================================================
-- 1) sp_SaveTask
-- ============================================================
IF OBJECT_ID('dbo.sp_SaveTask', 'P') IS NOT NULL DROP PROCEDURE dbo.sp_SaveTask;
GO

CREATE PROCEDURE dbo.sp_SaveTask
    @Id                BIGINT          = 0,
    @Title             VARCHAR(500),
    @Description       NVARCHAR(MAX)   = NULL,
    @WorkspaceId       BIGINT          = NULL,
    @ProjectId         INT             = NULL,
    @ParentTaskId      BIGINT          = NULL,
    @AssignedToUserId  INT             = NULL,
    @CreatedByUserId   INT,
    @TeamId            INT             = NULL,
    @Priority          VARCHAR(20)     = 'medium',
    @Type              VARCHAR(50)     = 'task',
    @Status            VARCHAR(50)     = 'todo',
    @DueDate           DATE            = NULL,
    @EstimatedHours    DECIMAL(10,2)   = 0,
    @LoggedHours       DECIMAL(10,2)   = 0,
    @Progress          DECIMAL(5,2)    = 0,
    @IsBlocked         BIT             = 0,
    @Labels            NVARCHAR(MAX)   = NULL,
    @Watchers          NVARCHAR(MAX)   = NULL,
    @Dependencies      NVARCHAR(MAX)   = NULL,  -- legacy, ignored. Use tblTaskDependencies.
    @IsAdmin           BIT             = 0,
    @CompId            BIGINT,
    @BranchId          BIGINT
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

    -- Validate references
    IF (@WorkspaceId IS NOT NULL AND @WorkspaceId > 0)
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.tblWorkspaces WHERE Id = @WorkspaceId AND CompId = @CompId)
        BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid workspace';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    END

    IF (@ProjectId IS NOT NULL AND @ProjectId > 0
        AND NOT EXISTS (SELECT 1 FROM dbo.tblProjects WHERE Id = @ProjectId))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid project selected';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@AssignedToUserId IS NOT NULL AND @AssignedToUserId > 0
        AND NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Id = @AssignedToUserId AND IsActive = 1))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid assigned user selected';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@TeamId IS NOT NULL AND @TeamId > 0
        AND NOT EXISTS (SELECT 1 FROM dbo.tblTeams WHERE Id = @TeamId AND IsActive = 1))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid team selected';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@ParentTaskId IS NOT NULL AND @ParentTaskId > 0
        AND NOT EXISTS (SELECT 1 FROM dbo.tblTasks WHERE Id = @ParentTaskId))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid parent task selected';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- ---- Permission check via sp_CheckTaskPermission ----
    DECLARE @PermTable TABLE (Allowed BIT, Reason VARCHAR(400));

    IF (@Id = 0)
    BEGIN
        IF (@WorkspaceId IS NULL OR @WorkspaceId <= 0)
        BEGIN
            SET @ResponseCode = 400; SET @ResponseMess = 'WorkspaceId is required to create a task';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
        END
        INSERT INTO @PermTable
        EXEC dbo.sp_CheckTaskPermission
            @TaskId = NULL, @WorkspaceId = @WorkspaceId, @CommentId = NULL,
            @UserId = @CreatedByUserId, @Action = 'create_task',
            @IsAdmin = @IsAdmin, @CompId = @CompId;
    END
    ELSE
    BEGIN
        -- For edit, derive action from whether status is changing (best-effort)
        DECLARE @OldStatus VARCHAR(50);
        SELECT @OldStatus = Status FROM dbo.tblTasks WHERE Id = @Id;
        IF (@OldStatus IS NULL)
        BEGIN SET @ResponseCode = 404; SET @ResponseMess = 'Task not found';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

        DECLARE @EditAction VARCHAR(50) =
            CASE WHEN @OldStatus <> @Status THEN 'change_status' ELSE 'edit_fields' END;

        INSERT INTO @PermTable
        EXEC dbo.sp_CheckTaskPermission
            @TaskId = @Id, @WorkspaceId = NULL, @CommentId = NULL,
            @UserId = @CreatedByUserId, @Action = @EditAction,
            @IsAdmin = @IsAdmin, @CompId = @CompId;
    END

    IF NOT EXISTS (SELECT 1 FROM @PermTable WHERE Allowed = 1)
    BEGIN
        DECLARE @Reason VARCHAR(400) = (SELECT TOP 1 Reason FROM @PermTable);
        SET @ResponseCode = 403;
        SET @ResponseMess = 'Permission denied: ' + ISNULL(@Reason, 'no reason');
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
    END

    -- ---- Hard-block enforcement on Done transition ----
    IF (@Status = 'done' AND @Id > 0)
    BEGIN
        IF EXISTS (
            SELECT 1
              FROM dbo.tblTaskDependencies d
              JOIN dbo.tblTasks b ON b.Id = d.DependsOnTaskId
             WHERE d.TaskId = @Id
               AND d.Type = 'blocks'
               AND (b.Status IS NULL OR b.Status <> 'done')
        )
        BEGIN
            SET @ResponseCode = 409;
            SET @ResponseMess = 'Cannot move to Done — blocked by unfinished dependencies';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
        END
    END

    BEGIN TRY
        BEGIN TRANSACTION;

        IF (@Id = 0)
        BEGIN
            INSERT INTO dbo.tblTasks
                (Title, Description, WorkspaceId, ProjectId, ParentTaskId,
                 AssignedToUserId, CreatedByUserId, TeamId, Priority, Type, Status,
                 DueDate, EstimatedHours, LoggedHours, Progress, IsBlocked,
                 Labels, Watchers,
                 CompletedDate, CompletedByUserId,
                 UpdatedDate)
            VALUES
                (@Title, @Description, @WorkspaceId, @ProjectId, @ParentTaskId,
                 @AssignedToUserId, @CreatedByUserId, @TeamId, @Priority, @Type, @Status,
                 @DueDate, @EstimatedHours, @LoggedHours, @Progress, @IsBlocked,
                 @Labels, @Watchers,
                 CASE WHEN @Status = 'done' THEN GETDATE() ELSE NULL END,
                 CASE WHEN @Status = 'done' THEN @CreatedByUserId ELSE NULL END,
                 GETDATE());

            SET @Id = SCOPE_IDENTITY();

            -- Seed assignee read receipt for non-personal workspaces
            IF (@AssignedToUserId IS NOT NULL AND @AssignedToUserId > 0)
            BEGIN
                DECLARE @WsTypeForSeed VARCHAR(20);
                SELECT @WsTypeForSeed = Type FROM dbo.tblWorkspaces WHERE Id = @WorkspaceId;
                IF (@WsTypeForSeed IN ('shared','project'))
                BEGIN
                    IF NOT EXISTS (SELECT 1 FROM dbo.tblTaskReads
                                    WHERE TaskId = @Id AND UserId = @AssignedToUserId)
                        INSERT INTO dbo.tblTaskReads (TaskId, UserId, DeliveredAt)
                        VALUES (@Id, @AssignedToUserId, GETDATE());
                END
            END

            COMMIT TRANSACTION;

            SET @ResponseCode = 201; SET @ResponseMess = 'Task created successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, @Id AS TaskId;
        END
        ELSE
        BEGIN
            UPDATE dbo.tblTasks
               SET Title = @Title,
                   Description = @Description,
                   ProjectId = @ProjectId,
                   ParentTaskId = @ParentTaskId,
                   AssignedToUserId = @AssignedToUserId,
                   TeamId = @TeamId,
                   Priority = @Priority,
                   Type = @Type,
                   Status = @Status,
                   DueDate = @DueDate,
                   EstimatedHours = @EstimatedHours,
                   LoggedHours = @LoggedHours,
                   Progress = @Progress,
                   IsBlocked = @IsBlocked,
                   Labels = @Labels,
                   Watchers = @Watchers,
                   CompletedDate = CASE WHEN @Status = 'done' AND CompletedDate IS NULL
                                        THEN GETDATE()
                                        WHEN @Status <> 'done' THEN NULL
                                        ELSE CompletedDate END,
                   CompletedByUserId = CASE WHEN @Status = 'done' AND CompletedByUserId IS NULL
                                            THEN @CreatedByUserId
                                            WHEN @Status <> 'done' THEN NULL
                                            ELSE CompletedByUserId END,
                   UpdatedDate = GETDATE()
             WHERE Id = @Id;

            COMMIT TRANSACTION;

            SET @ResponseCode = 200; SET @ResponseMess = 'Task updated successfully';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, @Id AS TaskId;
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
-- 2) sp_FetchTask
-- ============================================================
IF OBJECT_ID('dbo.sp_FetchTask', 'P') IS NOT NULL DROP PROCEDURE dbo.sp_FetchTask;
GO

CREATE PROCEDURE dbo.sp_FetchTask
    @Id                      BIGINT        = 0,
    @WorkspaceId             BIGINT        = NULL,
    @ProjectId               INT           = NULL,
    @UserId                  INT,
    @CompId                  BIGINT,
    @BranchId                BIGINT,
    @IsAdmin                 BIT           = 0,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @PageNumber              INT           = 1,
    @PageSize                INT           = 25,
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

    IF (@Id > 0)
    BEGIN
        -- Single task path: enforce view permission via sp_CheckTaskPermission
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
                   NULL AS Id, NULL AS Title, NULL AS Description, NULL AS WorkspaceId,
                   NULL AS ProjectId, NULL AS ParentTaskId,
                   NULL AS AssignedToUserId, NULL AS CreatedByUserId, NULL AS TeamId,
                   NULL AS Priority, NULL AS Type, NULL AS Status, NULL AS DueDate,
                   NULL AS EstimatedHours, NULL AS LoggedHours, NULL AS Progress,
                   NULL AS IsBlocked, NULL AS Labels, NULL AS Watchers,
                   NULL AS CompletedDate, NULL AS CompletedByUserId, NULL AS UpdatedDate,
                   NULL AS BranchId, NULL AS ProjectName, NULL AS WorkspaceName, NULL AS AssigneeName,
                   NULL AS CreatorName, NULL AS TeamName, NULL AS SubTaskCount, NULL AS BlockerCount;
            RETURN;
        END

        -- Track delivery in shared/project workspaces (silent)
        DECLARE @WsTypeOne VARCHAR(20);
        SELECT @WsTypeOne = w.Type
          FROM dbo.tblTasks t LEFT JOIN dbo.tblWorkspaces w ON w.Id = t.WorkspaceId
         WHERE t.Id = @Id;

        IF (@WsTypeOne IN ('shared','project'))
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM dbo.tblTaskReads
                            WHERE TaskId = @Id AND UserId = @UserId)
                INSERT INTO dbo.tblTaskReads (TaskId, UserId, DeliveredAt)
                VALUES (@Id, @UserId, GETDATE());
        END

        SET @ResponseCode = 200; SET @ResponseMess = 'Task retrieved successfully';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
               t.Id, t.Title, t.Description, t.WorkspaceId, t.ProjectId, t.ParentTaskId,
               t.AssignedToUserId, t.CreatedByUserId, t.TeamId,
               t.Priority, t.Type, t.Status, t.DueDate,
               t.EstimatedHours, t.LoggedHours, t.Progress,
               CAST(CASE WHEN EXISTS (
                   SELECT 1 FROM dbo.tblTaskDependencies d
                   JOIN dbo.tblTasks b ON b.Id = d.DependsOnTaskId
                   WHERE d.TaskId = t.Id AND d.Type = 'blocks'
                     AND (b.Status IS NULL OR b.Status <> 'done')
               ) THEN 1 ELSE 0 END AS BIT) AS IsBlocked,
               t.Labels, t.Watchers,
               t.CompletedDate, t.CompletedByUserId, t.UpdatedDate,
               ISNULL(p.BranchId, w.BranchId) AS BranchId,
               p.Name AS ProjectName,
               w.Name AS WorkspaceName,
               assignee.FullName AS AssigneeName,
               creator.FullName AS CreatorName,
               team.Name AS TeamName,
               (SELECT COUNT(*) FROM dbo.tblTasks st WHERE st.ParentTaskId = t.Id) AS SubTaskCount,
               (SELECT COUNT(*) FROM dbo.tblTaskDependencies d
                 WHERE d.TaskId = t.Id AND d.Type = 'blocks') AS BlockerCount
          FROM dbo.tblTasks t
          LEFT JOIN dbo.tblWorkspaces w ON w.Id = t.WorkspaceId
          LEFT JOIN dbo.tblProjects   p ON p.Id = t.ProjectId
          INNER JOIN dbo.tblUser creator  ON creator.Id = t.CreatedByUserId
          LEFT  JOIN dbo.tblUser assignee ON assignee.Id = t.AssignedToUserId
          LEFT  JOIN dbo.tblTeams team    ON team.Id = t.TeamId
         WHERE t.Id = @Id;
        RETURN;
    END

    -- ---- List path ----
    SET @Offset = (@PageNumber - 1) * @PageSize;

    ;WITH visible_ws AS (
        SELECT Id FROM dbo.tblWorkspaces w
         WHERE w.CompId = @CompId
           AND (
                 (w.Type = 'personal' AND w.OwnerUserId = @UserId)
              OR (w.Type IN ('shared','project')
                  AND (@IsAdmin = 1
                       OR EXISTS (SELECT 1 FROM dbo.tblWorkspaceMembers m
                                   WHERE m.WorkspaceId = w.Id AND m.UserId = @UserId AND m.IsActive = 1)))
               )
    ),
    matching AS (
        SELECT t.Id
          FROM dbo.tblTasks t
          LEFT JOIN dbo.tblWorkspaces w ON w.Id = t.WorkspaceId
          LEFT JOIN dbo.tblProjects   p ON p.Id = t.ProjectId
          LEFT JOIN dbo.tblUser  assignee ON assignee.Id = t.AssignedToUserId
          LEFT JOIN dbo.tblTeams team     ON team.Id = t.TeamId
         WHERE (@WorkspaceId IS NULL OR t.WorkspaceId = @WorkspaceId)
           AND (@ProjectId   IS NULL OR t.ProjectId   = @ProjectId)
           AND ((@UseScope = 0)
                OR (w.BranchId IN (SELECT BranchId FROM @BranchIds))
                OR (p.BranchId IN (SELECT BranchId FROM @BranchIds)))
           AND (
                 -- Workspace-scoped visibility (new path)
                 t.WorkspaceId IN (SELECT Id FROM visible_ws)
                 -- Legacy fallback for tasks without WorkspaceId (null)
              OR (t.WorkspaceId IS NULL
                  AND (@IsAdmin = 1
                       OR t.AssignedToUserId = @UserId
                       OR t.CreatedByUserId  = @UserId
                       OR p.ManagerUserId    = @UserId
                       OR EXISTS (SELECT value FROM OPENJSON(p.Members)
                                   WHERE value = CAST(@UserId AS VARCHAR))
                       OR EXISTS (SELECT value FROM OPENJSON(t.Watchers)
                                   WHERE value = CAST(@UserId AS VARCHAR))))
               )
           AND (@SearchTerm IS NULL
                OR t.Title LIKE '%' + @SearchTerm + '%'
                OR t.Description LIKE '%' + @SearchTerm + '%'
                OR assignee.FullName LIKE '%' + @SearchTerm + '%'
                OR team.Name LIKE '%' + @SearchTerm + '%')
    )
    SELECT @TotalRecords = COUNT(*) FROM matching;

    SET @TotalPages = CASE WHEN @PageSize > 0
                           THEN CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize) ELSE 0 END;

    IF (@TotalRecords = 0)
    BEGIN
        SET @ResponseCode = 200; SET @ResponseMess = 'No tasks found';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
               @PageNumber AS CurrentPage, @PageSize AS PageSize,
               NULL AS Id, NULL AS Title, NULL AS Description, NULL AS WorkspaceId,
               NULL AS ProjectId, NULL AS ParentTaskId,
               NULL AS AssignedToUserId, NULL AS CreatedByUserId, NULL AS TeamId,
               NULL AS Priority, NULL AS Type, NULL AS Status, NULL AS DueDate,
               NULL AS EstimatedHours, NULL AS LoggedHours, NULL AS Progress,
               NULL AS IsBlocked, NULL AS Labels, NULL AS Watchers,
               NULL AS CompletedDate, NULL AS CompletedByUserId, NULL AS UpdatedDate,
               NULL AS BranchId, NULL AS ProjectName, NULL AS WorkspaceName, NULL AS AssigneeName,
               NULL AS CreatorName, NULL AS TeamName, NULL AS SubTaskCount, NULL AS BlockerCount;
        RETURN;
    END

    -- Stamp DeliveredAt for non-personal visible tasks returned to this page
    ;WITH visible_ws AS (
        SELECT Id, Type FROM dbo.tblWorkspaces w
         WHERE w.CompId = @CompId
           AND (
                 (w.Type = 'personal' AND w.OwnerUserId = @UserId)
              OR (w.Type IN ('shared','project')
                  AND (@IsAdmin = 1
                       OR EXISTS (SELECT 1 FROM dbo.tblWorkspaceMembers m
                                   WHERE m.WorkspaceId = w.Id AND m.UserId = @UserId AND m.IsActive = 1)))
               )
    )
    INSERT INTO dbo.tblTaskReads (TaskId, UserId, DeliveredAt)
    SELECT t.Id, @UserId, GETDATE()
      FROM dbo.tblTasks t
      INNER JOIN visible_ws v ON v.Id = t.WorkspaceId AND v.Type IN ('shared','project')
     WHERE NOT EXISTS (SELECT 1 FROM dbo.tblTaskReads r
                        WHERE r.TaskId = t.Id AND r.UserId = @UserId)
       AND (@WorkspaceId IS NULL OR t.WorkspaceId = @WorkspaceId);

    SET @ResponseCode = 200; SET @ResponseMess = 'Tasks retrieved successfully';

    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
           @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
           @PageNumber AS CurrentPage, @PageSize AS PageSize,
           t.Id, t.Title, t.Description, t.WorkspaceId, t.ProjectId, t.ParentTaskId,
           t.AssignedToUserId, t.CreatedByUserId, t.TeamId,
           t.Priority, t.Type, t.Status, t.DueDate,
           t.EstimatedHours, t.LoggedHours, t.Progress,
           CAST(CASE WHEN EXISTS (
               SELECT 1 FROM dbo.tblTaskDependencies d
               JOIN dbo.tblTasks b ON b.Id = d.DependsOnTaskId
               WHERE d.TaskId = t.Id AND d.Type = 'blocks'
                 AND (b.Status IS NULL OR b.Status <> 'done')
           ) THEN 1 ELSE 0 END AS BIT) AS IsBlocked,
           t.Labels, t.Watchers,
           t.CompletedDate, t.CompletedByUserId, t.UpdatedDate,
           ISNULL(p.BranchId, w.BranchId) AS BranchId,
           p.Name AS ProjectName,
           w.Name AS WorkspaceName,
           assignee.FullName AS AssigneeName,
           creator.FullName AS CreatorName,
           team.Name AS TeamName,
           (SELECT COUNT(*) FROM dbo.tblTasks st WHERE st.ParentTaskId = t.Id) AS SubTaskCount,
           (SELECT COUNT(*) FROM dbo.tblTaskDependencies d
             WHERE d.TaskId = t.Id AND d.Type = 'blocks') AS BlockerCount
      FROM dbo.tblTasks t
      LEFT  JOIN dbo.tblWorkspaces w ON w.Id = t.WorkspaceId
      LEFT  JOIN dbo.tblProjects   p ON p.Id = t.ProjectId
      INNER JOIN dbo.tblUser creator  ON creator.Id = t.CreatedByUserId
      LEFT  JOIN dbo.tblUser assignee ON assignee.Id = t.AssignedToUserId
      LEFT  JOIN dbo.tblTeams team    ON team.Id = t.TeamId
     WHERE t.Id IN (
        SELECT Id FROM (
            SELECT t2.Id,
                   ROW_NUMBER() OVER (
                       ORDER BY
                         CASE t2.Priority
                              WHEN 'critical' THEN 1
                              WHEN 'high' THEN 2
                              WHEN 'medium' THEN 3
                              WHEN 'low' THEN 4
                              ELSE 5 END,
                         t2.DueDate ASC,
                         t2.Id DESC
                   ) AS rn
              FROM dbo.tblTasks t2
              LEFT JOIN dbo.tblWorkspaces w2 ON w2.Id = t2.WorkspaceId
              LEFT JOIN dbo.tblProjects   p2 ON p2.Id = t2.ProjectId
              LEFT JOIN dbo.tblUser  assignee2 ON assignee2.Id = t2.AssignedToUserId
              LEFT JOIN dbo.tblTeams team2     ON team2.Id = t2.TeamId
             WHERE (@WorkspaceId IS NULL OR t2.WorkspaceId = @WorkspaceId)
               AND (@ProjectId   IS NULL OR t2.ProjectId   = @ProjectId)
               AND ((@UseScope = 0)
                    OR (w2.BranchId IN (SELECT BranchId FROM @BranchIds))
                    OR (p2.BranchId IN (SELECT BranchId FROM @BranchIds)))
               AND (
                     t2.WorkspaceId IN (SELECT Id FROM dbo.tblWorkspaces ww
                                         WHERE ww.CompId = @CompId
                                           AND (
                                                 (ww.Type = 'personal' AND ww.OwnerUserId = @UserId)
                                              OR (ww.Type IN ('shared','project')
                                                  AND (@IsAdmin = 1
                                                       OR EXISTS (SELECT 1 FROM dbo.tblWorkspaceMembers mm
                                                                   WHERE mm.WorkspaceId = ww.Id AND mm.UserId = @UserId AND mm.IsActive = 1)))))
                  OR (t2.WorkspaceId IS NULL
                      AND (@IsAdmin = 1
                           OR t2.AssignedToUserId = @UserId
                           OR t2.CreatedByUserId  = @UserId
                           OR p2.ManagerUserId    = @UserId
                           OR EXISTS (SELECT value FROM OPENJSON(p2.Members)
                                       WHERE value = CAST(@UserId AS VARCHAR))
                           OR EXISTS (SELECT value FROM OPENJSON(t2.Watchers)
                                       WHERE value = CAST(@UserId AS VARCHAR))))
                   )
               AND (@SearchTerm IS NULL
                    OR t2.Title LIKE '%' + @SearchTerm + '%'
                    OR t2.Description LIKE '%' + @SearchTerm + '%'
                    OR assignee2.FullName LIKE '%' + @SearchTerm + '%'
                    OR team2.Name LIKE '%' + @SearchTerm + '%')
        ) ranked
        WHERE ranked.rn BETWEEN (@Offset + 1) AND (@Offset + @PageSize)
     )
     ORDER BY CASE t.Priority
                   WHEN 'critical' THEN 1 WHEN 'high' THEN 2
                   WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END,
              t.DueDate ASC, t.Id DESC;
END
GO

-- ============================================================
-- 3) Sanity checks
-- ============================================================
PRINT '----- migration 015 sanity -----';

SELECT 'sp_SaveTask'  AS chk, CASE WHEN OBJECT_ID('dbo.sp_SaveTask','P')  IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
UNION ALL SELECT 'sp_FetchTask',  CASE WHEN OBJECT_ID('dbo.sp_FetchTask','P') IS NOT NULL THEN 'OK' ELSE 'MISSING' END;
GO

-- Probe: create task in user 2's personal workspace
PRINT '----- probe: create task in personal workspace (UserId=2) -----';
DECLARE @PersonalWs BIGINT;
SELECT TOP 1 @PersonalWs = Id FROM dbo.tblWorkspaces WHERE OwnerUserId = 2 AND Type='personal';
EXEC dbo.sp_SaveTask
    @Id=0, @Title='Buy groceries', @Description='milk, eggs, bread',
    @WorkspaceId=@PersonalWs, @ProjectId=NULL, @ParentTaskId=NULL,
    @AssignedToUserId=2, @CreatedByUserId=2, @TeamId=NULL,
    @Priority='medium', @Type='task', @Status='todo',
    @DueDate=NULL, @EstimatedHours=0, @LoggedHours=0, @Progress=0, @IsBlocked=0,
    @Labels=NULL, @Watchers=NULL, @Dependencies=NULL,
    @IsAdmin=1, @CompId=1, @BranchId=1;

-- Probe: user 3 (not owner) tries to view personal task — should 404
PRINT '----- probe: non-owner views personal task (expect 404) -----';
DECLARE @MyTaskId BIGINT;
SELECT TOP 1 @MyTaskId = Id FROM dbo.tblTasks WHERE CreatedByUserId = 2 ORDER BY Id DESC;
EXEC dbo.sp_FetchTask @Id=@MyTaskId, @UserId=3, @CompId=1, @BranchId=1, @IsAdmin=0;

-- Probe: owner fetches list — should include the new task
PRINT '----- probe: owner fetches list (expect 1 task) -----';
EXEC dbo.sp_FetchTask @Id=0, @UserId=2, @CompId=1, @BranchId=1, @IsAdmin=1,
                     @AccessibleBranchIdsJson=NULL, @PageNumber=1, @PageSize=25;
GO
