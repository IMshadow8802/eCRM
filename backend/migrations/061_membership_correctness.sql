-- =============================================================================
-- 061_membership_correctness.sql
--
-- Workstream 2 of docs/superpowers/specs/2026-07-29-workspace-permission-model-design.md
--
-- Two live bugs, both about what "is a member" means.
--
-- BUG 1 — a declined invite revokes nothing.
--   sp_AddWorkspaceMember writes IsActive = 1 at INVITE time, and
--   sp_RespondWorkspaceInvite never clears it on decline (it only sets
--   InviteStatus). The two gates that matter check IsActive alone, so a user
--   who declined — or who never answered — keeps full read AND write on every
--   task in the workspace, indefinitely. The board is hidden from their
--   switcher, so it looks revoked while it isn't. The socket join gate is
--   strict, which makes the inversion worse: realtime is locked down, the REST
--   data path is wide open.
--   Fix: sp_CheckTaskPermission's role lookup and sp_FetchTask's two EXISTS
--   clauses gain AND InviteStatus = 'active'.
--
-- BUG 2 — cross-branch members see orphan tasks.
--   sp_FetchTask correctly treats branch as an optional FILTER (its header
--   documents why: "a project deliberately spans branches and departments").
--   sp_FetchWorkspaces was never given the same treatment and still ANDs branch
--   scope onto membership. Live today: Raaj (BranchId 1) is an active member of
--   workspace 10006 (BranchId 2) — he receives its 3 tasks but the board never
--   appears in his switcher. And a cross-branch invite is unacceptable through
--   the UI, because the workspace is filtered out before the accept prompt can
--   render.
--   Fix: drop the branch predicate from sp_FetchWorkspaces' visibility rule.
--   @BranchId and @AccessibleBranchIdsJson stay in the signature so the
--   controller keeps working, but are no longer visibility gates — exactly the
--   shape sp_FetchTask already uses.
--
-- NOT changed: sp_FetchWorkspaces deliberately includes InviteStatus 'pending'
-- in its visibility rule so the invite prompt can render. That is correct and
-- must stay — do not "tidy" it to match the others.
--
-- No schema changes. No data migration: all 14 live membership rows are
-- already InviteStatus='active'/IsActive=1, so nothing changes for anyone
-- today; this closes the door before it is walked through.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. sp_CheckTaskPermission — only an ACTIVE member has a role.
--    Single-line change in the role lookup; every task write and single-task
--    read routes through here, so this one edit closes the write half of BUG 1
--    for every caller at once.
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

    -- Resolve member role (NULL = not a member).
    -- InviteStatus matters: IsActive is set to 1 when the invite is SENT, and a
    -- decline never clears it, so IsActive alone let pending and declined users
    -- keep full access. Only 'active' is a member. (061)
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


-- ---------------------------------------------------------------------------
-- 2. sp_FetchTask — the list gate gets the same InviteStatus filter.
--    Two identical EXISTS clauses (count query + page query); both change.
--    Nothing else in this proc is touched.
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
                   NULL AS ChecklistTotal, NULL AS ChecklistDone;
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
                 WHERE c.TaskId = t.Id AND c.IsCompleted = 1) AS ChecklistDone
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
                   OR t.AssignedToUserId = @UserId
                   OR t.CreatedByUserId  = @UserId
                   OR p.ManagerUserId    = @UserId))
           )
       AND (@SearchTerm IS NULL
            OR t.Title LIKE '%' + @SearchTerm + '%'
            OR t.Description LIKE '%' + @SearchTerm + '%'
            OR assignee.FullName LIKE '%' + @SearchTerm + '%'
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
               NULL AS ChecklistTotal, NULL AS ChecklistDone;
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
             WHERE c.TaskId = t.Id AND c.IsCompleted = 1) AS ChecklistDone
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
                   OR t.AssignedToUserId = @UserId
                   OR t.CreatedByUserId  = @UserId
                   OR p.ManagerUserId    = @UserId))
           )
       AND (@SearchTerm IS NULL
            OR t.Title LIKE '%' + @SearchTerm + '%'
            OR t.Description LIKE '%' + @SearchTerm + '%'
            OR assignee.FullName LIKE '%' + @SearchTerm + '%'
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
-- 3. sp_FetchWorkspaces — branch stops gating visibility.
--    Membership is the gate; a workspace deliberately spans branches. Both the
--    `visible` CTE and the page query drop the branch predicate. @BranchId and
--    @AccessibleBranchIdsJson remain in the signature (the controller still
--    sends them) but no longer decide who sees what — same shape sp_FetchTask
--    settled on.
--
--    InviteStatus IN ('active','pending') is KEPT here on purpose: a pending
--    invitee must see the workspace so the accept prompt can render. Visibility
--    here does not grant task access — that is sp_CheckTaskPermission's job,
--    and section 1 above now requires 'active' there.
-- ---------------------------------------------------------------------------
ALTER PROCEDURE dbo.sp_FetchWorkspaces
    @Id                      BIGINT = 0,
    @UserId                  INT,
    @CompId                  BIGINT,
    @BranchId                BIGINT,
    @IsAdmin                 BIT    = 0,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,   -- accepted, intentionally unused
    @Type                    VARCHAR(20) = NULL,
    @IncludeArchived         BIT    = 0,
    @PageNumber              INT    = 1,
    @PageSize                INT    = 25,
    @SearchTerm              NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);
    DECLARE @TotalRecords INT, @TotalPages INT, @Offset INT;

    -- Visibility rule:
    --   personal   -> owner only
    --   shared/project ->
    --      admin sees every non-personal in their company (MyRole NULL)
    --      member (InviteStatus IN 'active','pending') sees it
    --      non-member (no row) does not
    --   branch is NOT part of this rule (061)
    SET @Offset = (@PageNumber - 1) * @PageSize;

    IF (@Id > 0)
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM dbo.tblWorkspaces w
            WHERE w.Id = @Id AND w.CompId = @CompId
              AND (
                    (w.Type = 'personal' AND w.OwnerUserId = @UserId)
                 OR (w.Type IN ('shared','project')
                     AND (@IsAdmin = 1
                          OR EXISTS (SELECT 1 FROM dbo.tblWorkspaceMembers m
                                     WHERE m.WorkspaceId = w.Id AND m.UserId = @UserId
                                       AND m.IsActive = 1
                                       AND m.InviteStatus IN ('active','pending'))))
                  )
        )
        BEGIN
            SET @ResponseCode = 404; SET @ResponseMess = 'Workspace not found or access denied';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
                   NULL AS Id, NULL AS Name, NULL AS Type, NULL AS OwnerUserId,
                   NULL AS TeamId, NULL AS ProjectId, NULL AS IsArchived,
                   NULL AS Color, NULL AS Icon, NULL AS CompId, NULL AS BranchId,
                   NULL AS CreatedDate, NULL AS UpdatedDate,
                   NULL AS MemberCount, NULL AS MyRole, NULL AS MyInviteStatus;
            RETURN;
        END

        SET @ResponseCode = 200; SET @ResponseMess = 'Workspace retrieved';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               NULL AS TotalRecords, NULL AS TotalPages, NULL AS CurrentPage, NULL AS PageSize,
               w.Id, w.Name, w.Type, w.OwnerUserId, w.TeamId, w.ProjectId, w.IsArchived,
               w.Color, w.Icon, w.CompId, w.BranchId, w.CreatedDate, w.UpdatedDate,
               (SELECT COUNT(*) FROM dbo.tblWorkspaceMembers m
                 WHERE m.WorkspaceId = w.Id AND m.IsActive = 1
                   AND m.InviteStatus = 'active') AS MemberCount,
               (SELECT TOP 1 m.Role FROM dbo.tblWorkspaceMembers m
                 WHERE m.WorkspaceId = w.Id AND m.UserId = @UserId
                   AND m.IsActive = 1 AND m.InviteStatus = 'active') AS MyRole,
               (SELECT TOP 1 m.InviteStatus FROM dbo.tblWorkspaceMembers m
                 WHERE m.WorkspaceId = w.Id AND m.UserId = @UserId
                   AND m.IsActive = 1) AS MyInviteStatus
          FROM dbo.tblWorkspaces w
         WHERE w.Id = @Id;
        RETURN;
    END

    ;WITH visible AS (
        SELECT w.Id
          FROM dbo.tblWorkspaces w
         WHERE w.CompId = @CompId
           AND (@IncludeArchived = 1 OR w.IsArchived = 0)
           AND (@Type IS NULL OR w.Type = @Type)
           AND (
                 (w.Type = 'personal' AND w.OwnerUserId = @UserId)
              OR (w.Type IN ('shared','project')
                  AND (@IsAdmin = 1
                       OR EXISTS (SELECT 1 FROM dbo.tblWorkspaceMembers m
                                   WHERE m.WorkspaceId = w.Id AND m.UserId = @UserId
                                     AND m.IsActive = 1
                                     AND m.InviteStatus IN ('active','pending'))))
               )
           AND (@SearchTerm IS NULL OR w.Name LIKE '%' + @SearchTerm + '%')
    )
    SELECT @TotalRecords = COUNT(*) FROM visible;

    SET @TotalPages = CASE WHEN @PageSize > 0 THEN CEILING(CAST(@TotalRecords AS FLOAT) / @PageSize) ELSE 0 END;

    IF (@TotalRecords = 0)
    BEGIN
        SET @ResponseCode = 200; SET @ResponseMess = 'No workspaces found';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
               @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
               @PageNumber AS CurrentPage, @PageSize AS PageSize,
               NULL AS Id, NULL AS Name, NULL AS Type, NULL AS OwnerUserId,
               NULL AS TeamId, NULL AS ProjectId, NULL AS IsArchived,
               NULL AS Color, NULL AS Icon, NULL AS CompId, NULL AS BranchId,
               NULL AS CreatedDate, NULL AS UpdatedDate,
               NULL AS MemberCount, NULL AS MyRole, NULL AS MyInviteStatus;
        RETURN;
    END

    SET @ResponseCode = 200; SET @ResponseMess = 'Workspaces retrieved';
    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
           @TotalRecords AS TotalRecords, @TotalPages AS TotalPages,
           @PageNumber AS CurrentPage, @PageSize AS PageSize,
           w.Id, w.Name, w.Type, w.OwnerUserId, w.TeamId, w.ProjectId, w.IsArchived,
           w.Color, w.Icon, w.CompId, w.BranchId, w.CreatedDate, w.UpdatedDate,
           (SELECT COUNT(*) FROM dbo.tblWorkspaceMembers m
             WHERE m.WorkspaceId = w.Id AND m.IsActive = 1
               AND m.InviteStatus = 'active') AS MemberCount,
           (SELECT TOP 1 m.Role FROM dbo.tblWorkspaceMembers m
             WHERE m.WorkspaceId = w.Id AND m.UserId = @UserId
               AND m.IsActive = 1 AND m.InviteStatus = 'active') AS MyRole,
           (SELECT TOP 1 m.InviteStatus FROM dbo.tblWorkspaceMembers m
             WHERE m.WorkspaceId = w.Id AND m.UserId = @UserId
               AND m.IsActive = 1) AS MyInviteStatus
      FROM dbo.tblWorkspaces w
     WHERE w.CompId = @CompId
       AND (@IncludeArchived = 1 OR w.IsArchived = 0)
       AND (@Type IS NULL OR w.Type = @Type)
       AND (
             (w.Type = 'personal' AND w.OwnerUserId = @UserId)
          OR (w.Type IN ('shared','project')
              AND (@IsAdmin = 1
                   OR EXISTS (SELECT 1 FROM dbo.tblWorkspaceMembers m
                               WHERE m.WorkspaceId = w.Id AND m.UserId = @UserId
                                 AND m.IsActive = 1
                                 AND m.InviteStatus IN ('active','pending'))))
           )
       AND (@SearchTerm IS NULL OR w.Name LIKE '%' + @SearchTerm + '%')
     ORDER BY CASE w.Type WHEN 'personal' THEN 0 WHEN 'shared' THEN 1 ELSE 2 END,
              w.UpdatedDate DESC, w.CreatedDate DESC
     OFFSET @Offset ROWS FETCH NEXT @PageSize ROWS ONLY;
END
GO


-- =============================================================================
-- Verify after apply
-- =============================================================================
-- 1. All three procs carry the change:
--
-- SELECT o.name,
--        CASE WHEN o.name = 'sp_FetchWorkspaces'
--                  THEN CASE WHEN m.definition LIKE '%@UseScope%' THEN 'NOT APPLIED' ELSE 'OK' END
--             ELSE CASE WHEN m.definition LIKE '%InviteStatus = ''active''%' THEN 'OK' ELSE 'NOT APPLIED' END
--        END AS Status
-- FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
-- WHERE o.name IN ('sp_CheckTaskPermission','sp_FetchTask','sp_FetchWorkspaces');
--
-- 2. BUG 2 gone — Raaj (UserId 3, BranchId 1) should now see workspace 10006
--    (BranchId 2), which he is an active member of:
--
-- EXEC sp_FetchWorkspaces @Id=0, @UserId=3, @CompId=1, @BranchId=1,
--      @IsAdmin=0, @PageNumber=1, @PageSize=50;
-- -- expect workspace 10006 in the result set
--
-- 3. BUG 1 gone — a declined member is refused. Run inside a transaction you
--    roll back so no real membership is harmed:
--
-- BEGIN TRAN;
--   UPDATE tblWorkspaceMembers SET InviteStatus = 'declined'
--    WHERE WorkspaceId = 10011 AND UserId = 11;
--   EXEC sp_CheckTaskPermission @TaskId = 10030, @UserId = 11,
--        @Action = 'view_task', @IsAdmin = 0, @CompId = 1;
--   -- expect Allowed = 0, Reason = 'not a workspace member'
--   EXEC sp_FetchTask @Id = 0, @UserId = 11, @CompId = 1, @PageNumber = 1, @PageSize = 50;
--   -- expect no tasks from workspace 10011
-- ROLLBACK TRAN;
--
-- 4. Nothing changed for a healthy active member:
--
-- EXEC sp_CheckTaskPermission @TaskId = 10030, @UserId = 2,
--      @Action = 'change_status', @IsAdmin = 0, @CompId = 1;
-- -- expect Allowed = 1
-- =============================================================================
