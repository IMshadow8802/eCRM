-- 101_p4_reports.sql — P4 of docs/superpowers/specs/2026-10-07-task-tat-presence-design.md:
-- the TAT and Attendance team reports, worked minutes on closed task clocks, and
-- complaint DueAt computed by Node on the working calendar (optional override).
-- Needs 099_presence.sql and 100_task_tat.sql applied first.
-- Additive and backward compatible: safe to apply while the old Node is running.
--   * sp_SaveTicket / sp_SetTicketStatus / sp_ReopenTicket gain a trailing
--     @DueAtOverride = NULL; without it they behave exactly as before (plus
--     TatAnchorAt is stamped on create and reopen, a new column nobody reads yet).
--   * sp_TatReconcile only additionally clears WorkMinutes when a clock reopens/resumes.
-- Apply (both DBs): sqlcmd ... -C -b -I -i sql/101_p4_reports.sql
-- Idempotent (safe to apply twice). Verify-after-apply block at the end.
--
-- Division of work (same as 100): SQL lists closed clocks without worked minutes
-- (sp_TatPendingWork); Node computes WorkMinutes with workCalendar.js and writes
-- them back through sp_TatApplyWork. Complaint due times: Node reads
-- sp_FetchTicketDue + sp_FetchDefaultCalendar and passes @DueAtOverride.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO

-- 1. Schema ---------------------------------------------------------------
-- Worked minutes of a closed clock: working minutes AnchorAt (or AssignedAt) -> ClosedAt
-- minus HeldMinutes, never negative. NULL = not computed yet (or the clock is open again).
IF COL_LENGTH('dbo.tblTaskTat', 'WorkMinutes') IS NULL ALTER TABLE dbo.tblTaskTat ADD WorkMinutes INT NULL;
-- When the current complaint clock started (create / reopen). NULL on old rows = CreatedAt.
-- A priority change re-stamps DueAt from it and keeps it; a transfer never touches it.
IF COL_LENGTH('dbo.tblTicket', 'TatAnchorAt') IS NULL ALTER TABLE dbo.tblTicket ADD TatAnchorAt DATETIME NULL;
GO

-- One-time backfill (idempotent by the IS NULL guard): the anchor the current DueAt
-- was computed from (CreatedAt, or the reopen time). No DueAt / no TatHours stays NULL
-- and falls back to CreatedAt.
UPDATE t SET TatAnchorAt = DATEADD(HOUR, -l.TatHours, t.DueAt)
FROM dbo.tblTicket t
JOIN dbo.tblLookup l ON l.Id = t.Priority
WHERE t.TatAnchorAt IS NULL AND t.DueAt IS NOT NULL AND l.TatHours IS NOT NULL;
GO

-- 2. Menus: "Team Reports" (parent, like "Sales Reports") with TAT + Attendance.
--    Module 'tasks': everyone with tasks sees them; the data is scoped in Node.
IF NOT EXISTS (SELECT 1 FROM dbo.tblMenu WHERE ParentId = 0 AND Description = 'Team Reports')
    INSERT INTO dbo.tblMenu (ParentId, Description, IsAllowed, Route, Module)
    VALUES (0, 'Team Reports', 1, NULL, NULL);

DECLARE @TeamReports INT = (SELECT TOP 1 Id FROM dbo.tblMenu
                             WHERE ParentId = 0 AND Description = 'Team Reports' ORDER BY Id);

IF NOT EXISTS (SELECT 1 FROM dbo.tblMenu WHERE Route = '/reports/tat')
    INSERT INTO dbo.tblMenu (ParentId, Description, IsAllowed, Route, Module)
    VALUES (@TeamReports, 'TAT', 1, '/reports/tat', 'tasks');

IF NOT EXISTS (SELECT 1 FROM dbo.tblMenu WHERE Route = '/reports/attendance')
    INSERT INTO dbo.tblMenu (ParentId, Description, IsAllowed, Route, Module)
    VALUES (@TeamReports, 'Attendance', 1, '/reports/attendance', 'tasks');
GO

-- ===========================================================================
-- 3. Task clocks: worked minutes
-- ===========================================================================

-- ===========================================================================
-- 5. Reconcile: make the open clocks match the eligible assignments.
--    RS1 clocks needing a due time; RS2 ended holds not yet applied.
--    Node computes both (workCalendar.js) and writes back via sp_TatApplyDue.
-- ===========================================================================
-- 101: the live 100 body (hash-checked); only WorkMinutes = NULL on reopen and resume is new.
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
                   DueStale = 1, StaleKind = 'reopen', StaleSeq = tt.StaleSeq + 1, WarnedAt = NULL,
                   WorkMinutes = NULL   -- 101: recomputed when it closes again
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
                   StaleSeq = tt.StaleSeq + 1, WarnedAt = NULL,
                   WorkMinutes = NULL   -- 101: recomputed when it closes again
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

-- Closed clocks still without worked minutes (newly closed, or backfill of rows
-- closed before 101). Node computes WorkMinutes and writes them via sp_TatApplyWork.
-- RS1 the clocks; RS2 their ended holds not yet in HeldMinutes (a hold that ended
-- with the clock) — Node subtracts their working minutes too.
CREATE OR ALTER PROCEDURE dbo.sp_TatPendingWork
    @CompId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @P TABLE (Id BIGINT PRIMARY KEY, UserId INT, AssignedAt DATETIME, AnchorAt DATETIME,
                      ClosedAt DATETIME, HeldMinutes INT);
    INSERT INTO @P (Id, UserId, AssignedAt, AnchorAt, ClosedAt, HeldMinutes)
    SELECT TOP 500 Id, UserId, AssignedAt, AnchorAt, ClosedAt, HeldMinutes
    FROM dbo.tblTaskTat
    WHERE CompId = @CompId AND ClosedAt IS NOT NULL AND WorkMinutes IS NULL
    ORDER BY Id;

    SELECT Id, UserId, AssignedAt, AnchorAt, ClosedAt, HeldMinutes FROM @P ORDER BY Id;

    SELECT h.TatId, h.StartedAt, h.EndedAt
    FROM dbo.tblTaskTatHold h
    JOIN @P p ON p.Id = h.TatId
    WHERE h.EndedAt IS NOT NULL AND h.AppliedAt IS NULL
    ORDER BY h.TatId, h.StartedAt;
END
GO

-- items [{Id, WorkMinutes}]. Writes only where WorkMinutes is still NULL and the
-- clock is still closed (a clock reopened in between keeps NULL). Negative -> 0.
CREATE OR ALTER PROCEDURE dbo.sp_TatApplyWork
    @CompId    BIGINT,
    @ItemsJson NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    IF ISJSON(ISNULL(@ItemsJson, N'[]')) = 0
    BEGIN SELECT 400 AS ResponseCode, 'Invalid JSON' AS ResponseMess, 0 AS Updated; RETURN; END

    DECLARE @Items TABLE (Id BIGINT PRIMARY KEY, WorkMinutes INT);
    INSERT INTO @Items (Id, WorkMinutes)
    SELECT Id, WorkMinutes
    FROM (SELECT j.Id, j.WorkMinutes, ROW_NUMBER() OVER (PARTITION BY j.Id ORDER BY (SELECT 0)) AS rn
            FROM OPENJSON(ISNULL(@ItemsJson, N'[]')) WITH (Id BIGINT '$.Id', WorkMinutes INT '$.WorkMinutes') j
           WHERE j.Id IS NOT NULL AND j.WorkMinutes IS NOT NULL) x
    WHERE rn = 1;

    UPDATE tt
       SET WorkMinutes = CASE WHEN i.WorkMinutes < 0 THEN 0 ELSE i.WorkMinutes END
    FROM dbo.tblTaskTat tt
    JOIN @Items i ON i.Id = tt.Id
    WHERE tt.CompId = @CompId AND tt.WorkMinutes IS NULL AND tt.ClosedAt IS NOT NULL;

    SELECT 200 AS ResponseCode, 'Work minutes applied' AS ResponseMess, @@ROWCOUNT AS Updated;
END
GO

-- ===========================================================================
-- 4. Reports
-- ===========================================================================

-- TAT report. Basis: the clock's AssignedAt in [@FromDate, @ToDate + 1 day).
-- @UserIdsJson: NULL = no user filter, '[]' = nobody (Node passes the caller's reach).
-- @BranchId / @OwnerId only narrow. Closed / OnTime / OnTimePct / Median / P90 count
-- finished clocks only (CloseReason completed | my_part_done); RanOver, Excused,
-- OpenOverdue count every clock in range. RS1 KPIs, RS2 per group, RS3 trend
-- (Bucket = day, or ISO week start (Monday) when the range spans more than 31 days).
CREATE OR ALTER PROCEDURE dbo.sp_RptTat
    @CompId      BIGINT,
    @FromDate    DATE,
    @ToDate      DATE,
    @GroupBy     VARCHAR(20)   = 'person',
    @BranchId    INT           = NULL,
    @OwnerId     INT           = NULL,
    @UserIdsJson NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF ISNULL(@GroupBy, '') NOT IN ('person','priority','workspace','verdict_by')
    BEGIN RAISERROR('sp_RptTat: unknown GroupBy', 16, 1); RETURN; END
    IF @FromDate IS NULL OR @ToDate IS NULL
    BEGIN RAISERROR('sp_RptTat: FromDate and ToDate are required', 16, 1); RETURN; END
    IF @UserIdsJson IS NOT NULL AND ISJSON(@UserIdsJson) = 0
    BEGIN RAISERROR('sp_RptTat: invalid UserIdsJson', 16, 1); RETURN; END

    DECLARE @From DATETIME = CAST(@FromDate AS DATETIME);
    DECLARE @To   DATETIME = DATEADD(DAY, 1, CAST(@ToDate AS DATETIME));
    DECLARE @Weekly BIT = CASE WHEN DATEDIFF(DAY, @FromDate, @ToDate) >= 31 THEN 1 ELSE 0 END;

    DECLARE @Users TABLE (UserId INT PRIMARY KEY);
    INSERT INTO @Users (UserId)
    SELECT DISTINCT TRY_CAST(value AS INT) FROM OPENJSON(ISNULL(@UserIdsJson, N'[]'))
    WHERE TRY_CAST(value AS INT) IS NOT NULL;

    SELECT tt.Id,
           CASE WHEN tt.ClosedAt IS NOT NULL AND tt.CloseReason IN ('completed','my_part_done') THEN 1 ELSE 0 END AS IsClosed,
           CASE WHEN tt.ClosedAt IS NOT NULL AND tt.CloseReason IN ('completed','my_part_done') AND tt.BreachedAt IS NULL THEN 1 ELSE 0 END AS IsOnTime,
           CASE WHEN tt.BreachedAt IS NOT NULL THEN 1 ELSE 0 END                             AS IsRanOver,
           CASE WHEN tt.BreachedAt IS NOT NULL
                 AND ISNULL(tt.Verdict, 'not_excused') = 'not_excused' THEN 1 ELSE 0 END     AS IsNotExcused,
           CASE WHEN tt.Verdict = 'excused' THEN 1 ELSE 0 END                                AS IsExcused,
           CASE WHEN tt.ClosedAt IS NULL AND tt.BreachedAt IS NOT NULL THEN 1 ELSE 0 END     AS IsOpenOverdue,
           CASE WHEN tt.ClosedAt IS NOT NULL AND tt.CloseReason IN ('completed','my_part_done') THEN tt.WorkMinutes END AS WM,
           tt.Verdict,
           ISNULL(CASE @GroupBy
                      WHEN 'person'     THEN CAST(tt.UserId AS NVARCHAR(50))
                      WHEN 'priority'   THEN CAST(t.Priority AS NVARCHAR(50))
                      WHEN 'workspace'  THEN CAST(t.WorkspaceId AS NVARCHAR(50))
                      WHEN 'verdict_by' THEN CAST(ISNULL(tt.VerdictBy, 0) AS NVARCHAR(50)) END, N'') AS GroupKey,
           CAST(CASE @GroupBy
                    WHEN 'person'     THEN ISNULL(u.FullName, 'Unknown')
                    WHEN 'priority'   THEN ISNULL(t.Priority, 'No priority')
                    WHEN 'workspace'  THEN ISNULL(w.Name, 'No workspace')
                    WHEN 'verdict_by' THEN CASE WHEN tt.VerdictBy IS NULL THEN 'System'
                                                ELSE ISNULL(vb.FullName, 'Unknown') END END AS NVARCHAR(200)) AS GroupLabel,
           CAST(CASE WHEN @Weekly = 1
                     THEN DATEADD(DAY, -(DATEDIFF(DAY, 0, tt.AssignedAt) % 7), tt.AssignedAt)  -- day 0 = Monday
                     ELSE tt.AssignedAt END AS DATE) AS Bucket
    INTO #T
    FROM dbo.tblTaskTat tt
    LEFT JOIN dbo.tblTasks      t  ON t.Id  = tt.TaskId
    LEFT JOIN dbo.tblWorkspaces w  ON w.Id  = t.WorkspaceId
    LEFT JOIN dbo.tblUser       u  ON u.Id  = tt.UserId
    LEFT JOIN dbo.tblUser       vb ON vb.Id = tt.VerdictBy
    WHERE tt.CompId = @CompId
      AND tt.AssignedAt >= @From AND tt.AssignedAt < @To
      AND (@BranchId IS NULL OR tt.BranchId = @BranchId)
      AND (@OwnerId  IS NULL OR tt.UserId   = @OwnerId)
      AND (@UserIdsJson IS NULL OR tt.UserId IN (SELECT UserId FROM @Users));

    -- RS1 KPIs (always one row)
    SELECT COUNT(*)                         AS Clocks,
           ISNULL(SUM(IsClosed), 0)         AS Closed,
           ISNULL(SUM(IsOnTime), 0)         AS OnTime,
           CAST(ISNULL(SUM(IsOnTime), 0) * 100.0 / NULLIF(SUM(IsClosed), 0) AS DECIMAL(5,1)) AS OnTimePct,
           ISNULL(SUM(IsRanOver), 0)        AS RanOver,
           ISNULL(SUM(IsNotExcused), 0)     AS RanOverNotExcused,
           ISNULL(SUM(IsExcused), 0)        AS Excused,
           ISNULL(SUM(IsOpenOverdue), 0)    AS OpenOverdue,
           (SELECT TOP 1 CAST(ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY WM) OVER (), 0) AS INT) FROM #T) AS MedianWorkMin,
           (SELECT TOP 1 CAST(ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY WM) OVER (), 0) AS INT) FROM #T) AS P90WorkMin
    FROM #T;

    -- RS2 per group (verdict_by: only clocks with a verdict)
    ;WITH g AS (
        SELECT * FROM #T WHERE @GroupBy <> 'verdict_by' OR Verdict IS NOT NULL
    ), p AS (
        SELECT DISTINCT GroupKey,
               PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY WM) OVER (PARTITION BY GroupKey) AS Med,
               PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY WM) OVER (PARTITION BY GroupKey) AS P90
        FROM g
    )
    SELECT g.GroupKey,
           MAX(g.GroupLabel)        AS GroupLabel,
           COUNT(*)                 AS Clocks,
           SUM(g.IsClosed)          AS Closed,
           SUM(g.IsOnTime)          AS OnTime,
           CAST(SUM(g.IsOnTime) * 100.0 / NULLIF(SUM(g.IsClosed), 0) AS DECIMAL(5,1)) AS OnTimePct,
           SUM(g.IsRanOver)         AS RanOver,
           SUM(g.IsNotExcused)      AS RanOverNotExcused,
           SUM(g.IsExcused)         AS Excused,
           CAST(ROUND(MAX(p.Med), 0) AS INT) AS MedianWorkMin,
           CAST(ROUND(MAX(p.P90), 0) AS INT) AS P90WorkMin
    FROM g
    JOIN p ON p.GroupKey = g.GroupKey
    GROUP BY g.GroupKey
    ORDER BY Clocks DESC, GroupLabel;

    -- RS3 trend
    SELECT Bucket, SUM(IsClosed) AS Closed, SUM(IsOnTime) AS OnTime, SUM(IsRanOver) AS RanOver
    FROM #T
    GROUP BY Bucket
    ORDER BY Bucket;
END
GO

-- Attendance report inputs. Node counts working days (calendar, holidays, leave,
-- go-live) with workCalendar.js. @UserIdsJson: NULL = everyone, '[]' = nobody.
-- RS1 people (active, not presence-exempt), RS2 their presence rows in range,
-- RS3 one row of settings.
CREATE OR ALTER PROCEDURE dbo.sp_FetchAttendanceRange
    @CompId      BIGINT,
    @FromDate    DATE,
    @ToDate      DATE,
    @UserIdsJson NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @UserIdsJson IS NOT NULL AND ISJSON(@UserIdsJson) = 0
    BEGIN RAISERROR('sp_FetchAttendanceRange: invalid UserIdsJson', 16, 1); RETURN; END

    DECLARE @Ids TABLE (UserId INT PRIMARY KEY);
    INSERT INTO @Ids (UserId)
    SELECT DISTINCT TRY_CAST(value AS INT) FROM OPENJSON(ISNULL(@UserIdsJson, N'[]'))
    WHERE TRY_CAST(value AS INT) IS NOT NULL;

    DECLARE @U TABLE (UserId INT PRIMARY KEY, FullName NVARCHAR(200), BranchId BIGINT, ManagerId INT, CreatedDate DATETIME);
    INSERT INTO @U (UserId, FullName, BranchId, ManagerId, CreatedDate)
    SELECT u.Id, u.FullName, u.BranchId, u.ReportsTo, u.CreatedDate
    FROM dbo.tblUser u
    WHERE u.CompId = @CompId AND u.IsActive = 1 AND ISNULL(u.PresenceExempt, 0) = 0
      AND (@UserIdsJson IS NULL OR u.Id IN (SELECT UserId FROM @Ids));

    SELECT UserId, FullName, BranchId, ManagerId, CreatedDate FROM @U ORDER BY FullName;

    SELECT p.UserId, p.WorkDate, p.FirstSignInAt, p.LateMinutes, p.NotSignedInAt
    FROM dbo.tblPresenceDay p
    JOIN @U x ON x.UserId = p.UserId
    WHERE p.CompId = @CompId AND p.WorkDate >= @FromDate AND p.WorkDate <= @ToDate
    ORDER BY p.UserId, p.WorkDate;

    SELECT s.GoLiveDate, ISNULL(s.LateGraceMin, 10) AS LateGraceMin
    FROM (SELECT 1 AS x) d
    LEFT JOIN dbo.tblCompanySetting s ON s.CompId = @CompId;
END
GO

-- ===========================================================================
-- 5. Complaint due times (Node computes DueAt on the working calendar)
-- ===========================================================================

-- What Node needs to compute a complaint's DueAt. No row = not this company's ticket.
CREATE OR ALTER PROCEDURE dbo.sp_FetchTicketDue
    @CompId   BIGINT,
    @TicketId INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT t.AssignedTo, t.Priority, p.TatHours, t.CreatedAt, t.TatAnchorAt
    FROM dbo.tblTicket t
    LEFT JOIN dbo.tblLookup p ON p.Id = t.Priority AND p.CompId = @CompId
    WHERE t.Id = @TicketId AND t.CompId = @CompId;
END
GO

-- The company default calendar (an unassigned complaint is due on it).
-- RS1 one row, or none when the company has no default; RS2 company-wide holidays
-- (BranchId NULL) from a year ago onward.
CREATE OR ALTER PROCEDURE dbo.sp_FetchDefaultCalendar
    @CompId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP 1 c.Id AS CalendarId, c.DaysJson
    FROM dbo.tblWorkCalendar c
    WHERE c.CompId = @CompId AND c.IsDefault = 1
    ORDER BY c.Id;

    SELECT h.HolidayDate
    FROM dbo.tblHoliday h
    WHERE h.CompId = @CompId AND h.BranchId IS NULL
      AND h.HolidayDate >= DATEADD(YEAR, -1, CAST(GETDATE() AS DATE))
    ORDER BY h.HolidayDate;
END
GO

-- ===========================================================================
-- 6. Complaints: optional @DueAtOverride + TatAnchorAt. Live bodies (dumped from
--    sys.sql_modules 2026-10-08, hash-checked); only the lines marked 101 change.
-- ===========================================================================
-- ===== 6. Procedures — tickets read/write (sp_SaveTicket, sp_FetchTickets, sp_FetchTicketDetail, sp_DeleteTicket, sp_SaveLookup, sp_FetchLookups)
-- ---------------------------------------------------------------------------
-- 6.1 sp_SaveTicket
--   Insert : CustomerId (active, same company) + Subject required; status =
--            first 'open' by SortOrder; DueAt = now + TatHours(priority);
--            AssignedAt when assigned; history opening row; assignment
--            opening row; activity 'created'; ticket_assigned notification.
--   Update : IGNORES @AssignedTo (sp_TransferTicket only) and never touches
--            StatusId / ResolvedAt / ClosedAt (sp_SetTicketStatus only).
--            CustomerId may change. A priority change re-stamps DueAt from
--            the same anchor the old due date was computed from, so a
--            reopened clock is not reset to creation.
--   TicketNo generation and the CustomJSON MERGE are verbatim from the
--   previous body (050 / 067).
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_SaveTicket
    @Id            INT           = 0,
    @CompId        INT,
    @BranchId      INT,
    @UserId        INT,
    @CustomerId    INT           = NULL,
    @Subject       NVARCHAR(200) = NULL,
    @ContactPerson NVARCHAR(200) = NULL,
    @Contact       VARCHAR(100)  = NULL,
    @ChannelId     INT           = NULL,
    @CategoryId    INT           = NULL,
    @Priority      INT           = NULL,
    @ProductId     INT           = NULL,
    @AssignedTo    INT           = NULL,
    @LinkedLeadId  INT           = NULL,
    @Description   NVARCHAR(MAX) = NULL,
    @CustomJSON    NVARCHAR(MAX) = NULL,
    @DueAtOverride DATETIME      = NULL   -- 101: Node's working-calendar due time; NULL = the old wall-clock rule
AS
BEGIN
    SET NOCOUNT ON;
    SET @Id = ISNULL(@Id, 0);

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT 0 AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT 0 AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 400 AS ResponseCode, 'UserId is required' AS ResponseMess; RETURN; END
    IF @Id = 0 AND (@BranchId IS NULL OR @BranchId <= 0)
    BEGIN SELECT 0 AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 400 AS ResponseCode, 'BranchId is required' AS ResponseMess; RETURN; END

    -- 0 / negative ids mean "none"
    IF @CustomerId   <= 0 SET @CustomerId   = NULL;
    IF @ChannelId    <= 0 SET @ChannelId    = NULL;
    IF @CategoryId   <= 0 SET @CategoryId   = NULL;
    IF @Priority     <= 0 SET @Priority     = NULL;
    IF @ProductId    <= 0 SET @ProductId    = NULL;
    IF @AssignedTo   <= 0 SET @AssignedTo   = NULL;
    IF @LinkedLeadId <= 0 SET @LinkedLeadId = NULL;
    SET @Subject       = NULLIF(LTRIM(RTRIM(@Subject)), N'');
    SET @ContactPerson = NULLIF(LTRIM(RTRIM(@ContactPerson)), N'');
    SET @Contact       = NULLIF(LTRIM(RTRIM(@Contact)), '');

    IF @Id > 0 AND NOT EXISTS (SELECT 1 FROM dbo.tblTicket WHERE Id = @Id AND CompId = @CompId)
    BEGIN SELECT @Id AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 404 AS ResponseCode, 'Ticket not found' AS ResponseMess; RETURN; END
    IF @CustomerId IS NULL
    BEGIN SELECT @Id AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 400 AS ResponseCode, 'CustomerId is required' AS ResponseMess; RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.tblCustomer WHERE Id = @CustomerId AND CompId = @CompId AND IsActive = 1)
    BEGIN SELECT @Id AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 404 AS ResponseCode, 'Customer not found' AS ResponseMess; RETURN; END
    IF @Subject IS NULL
    BEGIN SELECT @Id AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 400 AS ResponseCode, 'Subject is required' AS ResponseMess; RETURN; END
    IF @Priority IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.tblLookup WHERE Id = @Priority AND CompId = @CompId AND Kind = 'priority')
    BEGIN SELECT @Id AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 400 AS ResponseCode, 'Invalid priority' AS ResponseMess; RETURN; END
    IF @CategoryId IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.tblLookup WHERE Id = @CategoryId AND CompId = @CompId AND Kind = 'ticket_category')
    BEGIN SELECT @Id AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 400 AS ResponseCode, 'Invalid category' AS ResponseMess; RETURN; END
    IF @ChannelId IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.tblLookup WHERE Id = @ChannelId AND CompId = @CompId AND Kind = 'ticket_channel')
    BEGIN SELECT @Id AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 400 AS ResponseCode, 'Invalid channel' AS ResponseMess; RETURN; END
    IF @ProductId IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.tblProduct WHERE Id = @ProductId AND CompId = @CompId)
    BEGIN SELECT @Id AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 400 AS ResponseCode, 'Invalid product' AS ResponseMess; RETURN; END
    IF @Id = 0 AND @AssignedTo IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Id = @AssignedTo AND CompId = @CompId AND IsActive = 1)
    BEGIN SELECT @Id AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 400 AS ResponseCode, 'Invalid assignee' AS ResponseMess; RETURN; END
    IF @LinkedLeadId IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.tblLeads WHERE Id = @LinkedLeadId AND CompId = @CompId)
    BEGIN SELECT @Id AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 400 AS ResponseCode, 'Invalid linked lead' AS ResponseMess; RETURN; END

    DECLARE @Now DATETIME = GETDATE();
    DECLARE @Tat INT = (SELECT TatHours FROM dbo.tblLookup WHERE Id = @Priority);

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));
        DECLARE @TicketId INT = @Id;
        DECLARE @TicketNo VARCHAR(30);
        DECLARE @ActType VARCHAR(30), @ActSummary NVARCHAR(500);

        IF @Id > 0
        BEGIN
            DECLARE @OldPriority INT, @OldDueAt DATETIME, @CreatedAt DATETIME;
            SELECT @OldPriority = Priority, @OldDueAt = DueAt, @CreatedAt = CreatedAt, @TicketNo = TicketNo
            FROM dbo.tblTicket WHERE Id = @Id AND CompId = @CompId;

            -- Priority change: anchor = when the current clock started
            -- (DueAt - OldTat when both are known, else CreatedAt), so a
            -- reopened ticket keeps its reopen anchor.
            DECLARE @NewDueAt DATETIME = @OldDueAt;
            IF ISNULL(@OldPriority, -1) <> ISNULL(@Priority, -1)
            BEGIN
                DECLARE @OldTat INT = (SELECT TatHours FROM dbo.tblLookup WHERE Id = @OldPriority);
                DECLARE @Anchor DATETIME = CASE WHEN @OldTat IS NOT NULL AND @OldDueAt IS NOT NULL
                                                THEN DATEADD(HOUR, -@OldTat, @OldDueAt)
                                                ELSE @CreatedAt END;
                SET @NewDueAt = ISNULL(@DueAtOverride, CASE WHEN @Tat IS NULL THEN NULL ELSE DATEADD(HOUR, @Tat, @Anchor) END);
            END

            UPDATE dbo.tblTicket
            SET CustomerId = @CustomerId, Subject = @Subject,
                ContactPerson = @ContactPerson, Contact = @Contact,
                ChannelId = @ChannelId, CategoryId = @CategoryId,
                Priority = @Priority, ProductId = @ProductId,
                -- Guarded: a client that does not know about the lead link
                -- must not be able to sever it by omitting the field.
                LinkedLeadId = ISNULL(@LinkedLeadId, LinkedLeadId),
                DueAt = @NewDueAt,
                Description = @Description,
                EditBy = @UserId, UpdatedAt = @Now
            WHERE Id = @Id AND CompId = @CompId;

            SET @ActType = 'updated';
            SET @ActSummary = N'Complaint details updated';
        END
        ELSE
        BEGIN
            DECLARE @StatusId INT = (SELECT TOP 1 Id FROM dbo.tblLookup
                                     WHERE CompId = @CompId AND Kind = 'ticket_status' AND Code = 'open' AND IsActive = 1
                                     ORDER BY SortOrder, Id);
            IF @StatusId IS NULL
            BEGIN
                ROLLBACK TRANSACTION;
                SELECT 0 AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 500 AS ResponseCode, 'No ticket_status lookups configured for this company' AS ResponseMess;
                RETURN;
            END

            -- Highest number issued so far, not the row count. sp_DeleteTicket
            -- hard-deletes, so COUNT(*) walks back over the gap and re-issues a
            -- TicketNo a surviving ticket already owns — UQ_tblTicket_CompId_TicketNo
            -- then throws on an ordinary create.
            -- ponytail: two concurrent inserts can still pick the same number;
            -- swap to a sequence table if that ever actually collides.
            DECLARE @Seq INT = (
                SELECT ISNULL(MAX(TRY_CONVERT(INT, SUBSTRING(TicketNo, 5, 10))), 0) + 1
                FROM dbo.tblTicket
                WHERE CompId = @CompId AND TicketNo LIKE 'TKT-%'
            );
            SET @TicketNo = 'TKT-' + RIGHT('000000' + CAST(@Seq AS VARCHAR(10)), 6);

            INSERT INTO dbo.tblTicket
                (CompId, BranchId, TicketNo, CustomerId, Subject, ContactPerson, Contact,
                 ChannelId, CategoryId, Priority, ProductId, StatusId,
                 AssignedTo, AssignedAt, LinkedLeadId, DueAt,
                 Description, CreatedBy, EditBy, CreatedAt, TatAnchorAt)
            VALUES
                (@CompId, @BranchId, @TicketNo, @CustomerId, @Subject, @ContactPerson, @Contact,
                 @ChannelId, @CategoryId, @Priority, @ProductId, @StatusId,
                 @AssignedTo, CASE WHEN @AssignedTo IS NULL THEN NULL ELSE @Now END, @LinkedLeadId,
                 ISNULL(@DueAtOverride, CASE WHEN @Tat IS NULL THEN NULL ELSE DATEADD(HOUR, @Tat, @Now) END),
                 @Description, @UserId, @UserId, @Now, @Now);

            SET @TicketId = CAST(SCOPE_IDENTITY() AS INT);

            -- Opening row of the status history (NULL -> first status).
            INSERT INTO dbo.tblTicketStatusHistory (CompId, TicketId, FromStatusId, ToStatusId, ChangedBy, ChangedAt)
            VALUES (@CompId, @TicketId, NULL, @StatusId, @UserId, @Now);

            -- Opening assignment, so RS4 shows who it landed on first.
            IF @AssignedTo IS NOT NULL
                INSERT INTO dbo.tblTicketAssignment
                    (CompId, TicketId, FromUserId, ToUserId, FromBranchId, ToBranchId, ReasonId, Remarks, AssignedBy, AssignedAt)
                VALUES
                    (@CompId, @TicketId, NULL, @AssignedTo, NULL, @BranchId, NULL, N'Assigned on creation', @UserId, @Now);

            SET @ActType = 'created';
            SET @ActSummary = N'Complaint created';
        END

        -- custom-field values (shared engine, Entity='ticket')
        IF @CustomJSON IS NOT NULL AND LTRIM(RTRIM(@CustomJSON)) NOT IN ('', '[]')
        BEGIN
            ;WITH src AS (
                SELECT j.fieldId,
                       CASE WHEN j.type IN ('dropdown','text') THEN j.val END AS ValueText,
                       CASE WHEN j.type = 'number'  THEN TRY_CONVERT(DECIMAL(18,2), j.val)
                            WHEN j.type = 'checkbox' THEN CASE WHEN j.val='true' THEN 1 ELSE 0 END END AS ValueNumber,
                       CASE WHEN j.type = 'date' THEN TRY_CONVERT(DATETIME, j.val) END AS ValueDate
                FROM OPENJSON(@CustomJSON)
                     WITH (fieldId INT '$.fieldId', type VARCHAR(20) '$.type', val NVARCHAR(MAX) '$.value') j
                WHERE j.fieldId IS NOT NULL
            )
            MERGE dbo.tblCustomFieldValue AS tgt
            USING src ON tgt.CompId=@CompId AND tgt.Entity='ticket'
                      AND tgt.EntityId=@TicketId AND tgt.FieldId=src.fieldId
            WHEN MATCHED THEN UPDATE SET ValueText=src.ValueText, ValueNumber=src.ValueNumber, ValueDate=src.ValueDate
            WHEN NOT MATCHED THEN INSERT (CompId, Entity, EntityId, FieldId, ValueText, ValueNumber, ValueDate)
                 VALUES (@CompId, 'ticket', @TicketId, src.fieldId, src.ValueText, src.ValueNumber, src.ValueDate);
        END

        INSERT INTO @actLog EXEC dbo.sp_LogTicketActivity
            @CompId = @CompId, @TicketId = @TicketId, @UserId = @UserId,
            @Type = @ActType, @Summary = @ActSummary, @MetaJSON = NULL;

        IF @Id = 0 AND @AssignedTo IS NOT NULL
        BEGIN
            -- The creation assignment on the timeline, then the in-app ping
            -- (sp_CreateNotification skips the actor assigning to themself).
            DECLARE @AssigneeName NVARCHAR(200) = ISNULL((SELECT FullName FROM dbo.tblUser WHERE Id = @AssignedTo), N'');
            DECLARE @AssignSummary NVARCHAR(500) = N'Assigned to ' + @AssigneeName + N' on creation';
            DECLARE @AssignMeta NVARCHAR(MAX) = (SELECT CAST(NULL AS INT) AS fromUserId, @AssignedTo AS toUserId,
                                                        CAST(NULL AS INT) AS fromBranchId, @BranchId AS toBranchId,
                                                        CAST(NULL AS INT) AS reasonId, N'Assigned on creation' AS remarks
                                                 FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES);
            INSERT INTO @actLog EXEC dbo.sp_LogTicketActivity
                @CompId = @CompId, @TicketId = @TicketId, @UserId = @UserId,
                @Type = 'assigned', @Summary = @AssignSummary, @MetaJSON = @AssignMeta;

            DECLARE @ntf TABLE (ResponseCode INT, ResponseMess VARCHAR(400), NotificationId BIGINT, UserId INT, Type VARCHAR(40));
            DECLARE @NtfBody NVARCHAR(1000) = LEFT(@TicketNo + N' — ' + @Subject, 1000);
            INSERT INTO @ntf EXEC dbo.sp_CreateNotification
                @UserId = @AssignedTo, @Type = 'ticket_assigned', @EntityType = 'ticket', @EntityId = @TicketId,
                @ActorUserId = @UserId, @Title = 'Complaint assigned to you', @Body = @NtfBody,
                @CompId = @CompId, @BranchId = @BranchId;
        END

        COMMIT TRANSACTION;
        SELECT @TicketId AS Id, @TicketNo AS TicketNo, 200 AS ResponseCode, 'Ticket saved successfully' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT ISNULL(@Id,0) AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

-- ===== 7. Procedures — lifecycle (sp_SetTicketStatus, sp_ResolveTicket, sp_CloseTicket, sp_RejectTicket, sp_ReopenTicket, sp_TransferTicket, sp_BulkTransferTickets, sp_EscalateTicket, sp_FetchEscalationTargets)
-- ---------------------------------------------------------------------------
-- 7.1 sp_SetTicketStatus — the one lifecycle engine
--
--   Everything about a complaint's lifecycle is written here and nowhere else:
--   StatusId, ResolvedAt, ClosedAt, ResolutionId, the reopen DueAt, and the
--   tblTicketStatusHistory row. sp_SaveTicket writes the opening history row
--   on insert; nothing else touches these columns.
--
--   Rules, by the TARGET status's Code (labels are the company's, codes are
--   ours — never match on a label):
--     open / onhold  from open / onhold      free, remarks optional
--     open / onhold  from a terminal status  REOPEN: needs @AllowReopen = 1
--                                            (Node's canReopen gate) else 403,
--                                            remarks required; clears
--                                            ResolvedAt / ClosedAt /
--                                            ResolutionId and re-stamps DueAt
--                                            from the priority's TatHours
--     resolved       resolution (parameter or the stored one) + remarks
--     closed         from resolved: remarks optional
--                    otherwise: resolution + remarks (straight to closed),
--                    and ResolvedAt is stamped if it was never set
--     rejected       remarks required; ResolvedAt / ResolutionId cleared —
--                    rejected means never solved
--     same status    200, nothing written
--
--   The history row's FROM comes from the UPDATE's own OUTPUT, not the value
--   read before the transaction: two concurrent changes would otherwise both
--   record the same source (the 075 pattern, copied from sp_SetLeadStatus).
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_SetTicketStatus
    @CompId       INT,
    @TicketId     INT,
    @StatusId     INT,
    @UserId       INT,
    @ResolutionId INT            = NULL,
    @Remarks      NVARCHAR(1000) = NULL,
    @AllowReopen  BIT            = 0,
    @DueAtOverride DATETIME      = NULL   -- 101: Node's working-calendar due time on reopen; NULL = the old rule
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF @TicketId IS NULL OR @TicketId <= 0
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'TicketId is required' AS ResponseMess; RETURN; END
    IF @StatusId IS NULL OR @StatusId <= 0
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'StatusId is required' AS ResponseMess; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess; RETURN; END

    SET @Remarks = NULLIF(LTRIM(RTRIM(@Remarks)), N'');
    IF @ResolutionId IS NOT NULL AND @ResolutionId <= 0 SET @ResolutionId = NULL;

    -- where it is now (the join doubles as the tenancy check)
    DECLARE @FromStatusId INT, @FromCode VARCHAR(30), @FromName NVARCHAR(200),
            @StoredResolution INT, @Priority INT;
    SELECT @FromStatusId    = t.StatusId,
           @FromCode        = st.Code,
           @FromName        = st.Value,
           @StoredResolution = t.ResolutionId,
           @Priority        = t.Priority
    FROM dbo.tblTicket t
    JOIN dbo.tblLookup st ON st.Id = t.StatusId
    WHERE t.Id = @TicketId AND t.CompId = @CompId;
    IF @FromStatusId IS NULL
    BEGIN SELECT @TicketId AS Id, 404 AS ResponseCode, 'Ticket not found' AS ResponseMess; RETURN; END

    -- where it is being sent (must be a live ticket_status of this company)
    DECLARE @ToCode VARCHAR(30), @ToName NVARCHAR(200);
    SELECT @ToCode = Code, @ToName = Value
    FROM dbo.tblLookup
    WHERE Id = @StatusId AND CompId = @CompId AND Kind = 'ticket_status' AND IsActive = 1;
    IF @ToCode IS NULL
    BEGIN SELECT @TicketId AS Id, 404 AS ResponseCode, 'Status not found' AS ResponseMess; RETURN; END

    IF @FromStatusId = @StatusId
    BEGIN SELECT @TicketId AS Id, 200 AS ResponseCode, 'Complaint already in this status' AS ResponseMess; RETURN; END

    DECLARE @WasTerminal BIT = CASE WHEN @FromCode IN ('resolved', 'closed', 'rejected') THEN 1 ELSE 0 END;
    DECLARE @IsReopen   BIT = CASE WHEN @WasTerminal = 1 AND @ToCode IN ('open', 'onhold') THEN 1 ELSE 0 END;
    -- "resolution (param or existing)": the parameter wins, the stored one carries over
    DECLARE @EffResolution INT = COALESCE(@ResolutionId, @StoredResolution);

    IF @ResolutionId IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.tblLookup
                       WHERE Id = @ResolutionId AND CompId = @CompId AND Kind = 'resolution')
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'Invalid resolution' AS ResponseMess; RETURN; END

    IF @IsReopen = 1
    BEGIN
        -- Node passes @AllowReopen = 1 only when canReopen() passed; the SP
        -- alone decides whether the requested move IS a reopen.
        IF ISNULL(@AllowReopen, 0) <> 1
        BEGIN SELECT @TicketId AS Id, 403 AS ResponseCode, 'Reopening requires a manager' AS ResponseMess; RETURN; END
        IF @Remarks IS NULL
        BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'Remarks are required to reopen a complaint' AS ResponseMess; RETURN; END
    END
    ELSE IF @ToCode = 'resolved'
    BEGIN
        IF @EffResolution IS NULL
        BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'Resolution is required' AS ResponseMess; RETURN; END
        IF @Remarks IS NULL
        BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'Remarks are required to resolve a complaint' AS ResponseMess; RETURN; END
    END
    ELSE IF @ToCode = 'closed' AND @FromCode <> 'resolved'
    BEGIN
        -- Straight to closed: nobody ever recorded how it was fixed.
        IF @EffResolution IS NULL
        BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'Resolution is required' AS ResponseMess; RETURN; END
        IF @Remarks IS NULL
        BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'Remarks are required to close a complaint that was never resolved' AS ResponseMess; RETURN; END
    END
    ELSE IF @ToCode = 'rejected'
    BEGIN
        IF @Remarks IS NULL
        BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'Remarks are required to reject a complaint' AS ResponseMess; RETURN; END
    END

    DECLARE @Now DATETIME = GETDATE();
    -- The reopened clock starts now, not at creation.
    DECLARE @Tat INT = (SELECT TatHours FROM dbo.tblLookup WHERE Id = @Priority);
    DECLARE @ActType VARCHAR(30) =
        CASE WHEN @IsReopen = 1        THEN 'reopened'
             WHEN @ToCode = 'resolved' THEN 'resolved'
             WHEN @ToCode = 'closed'   THEN 'closed'
             WHEN @ToCode = 'rejected' THEN 'rejected'
             ELSE 'status' END;

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));
        DECLARE @hist   TABLE (FromStatusId INT);

        UPDATE dbo.tblTicket
        SET StatusId     = @StatusId,
            ResolvedAt   = CASE WHEN @ToCode IN ('resolved', 'closed') THEN ISNULL(ResolvedAt, @Now) ELSE NULL END,
            ClosedAt     = CASE WHEN @ToCode IN ('closed', 'rejected') THEN ISNULL(ClosedAt, @Now)   ELSE NULL END,
            ResolutionId = CASE WHEN @ToCode IN ('resolved', 'closed') THEN @EffResolution           ELSE NULL END,
            DueAt        = CASE WHEN @IsReopen = 1
                                THEN ISNULL(@DueAtOverride, CASE WHEN @Tat IS NULL THEN NULL ELSE DATEADD(HOUR, @Tat, @Now) END)
                                ELSE DueAt END,
            TatAnchorAt  = CASE WHEN @IsReopen = 1 THEN @Now ELSE TatAnchorAt END,
            EditBy = @UserId, UpdatedAt = @Now
        OUTPUT deleted.StatusId INTO @hist (FromStatusId)
        WHERE Id = @TicketId AND CompId = @CompId;

        INSERT INTO dbo.tblTicketStatusHistory (CompId, TicketId, FromStatusId, ToStatusId, ChangedBy, ChangedAt)
        SELECT @CompId, @TicketId, h.FromStatusId, @StatusId, @UserId, @Now FROM @hist h;

        DECLARE @Summary NVARCHAR(500) = LEFT(N'Status: ' + @FromName + N' → ' + @ToName
                                              + CASE WHEN @Remarks IS NULL THEN N'' ELSE N' — ' + @Remarks END, 500);
        DECLARE @Meta NVARCHAR(MAX) = (SELECT @FromStatusId AS fromStatusId, @StatusId AS toStatusId,
                                              @FromCode AS fromCode, @ToCode AS toCode,
                                              CASE WHEN @ToCode IN ('resolved', 'closed') THEN @EffResolution END AS resolutionId,
                                              @Remarks AS remarks
                                       FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES);
        INSERT INTO @actLog
        EXEC dbo.sp_LogTicketActivity
            @CompId = @CompId, @TicketId = @TicketId, @UserId = @UserId,
            @Type = @ActType, @Summary = @Summary, @MetaJSON = @Meta;

        COMMIT TRANSACTION;

        SELECT @TicketId AS Id, 200 AS ResponseCode, 'Complaint status updated successfully' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT @TicketId AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

CREATE OR ALTER PROC dbo.sp_ReopenTicket
    @CompId      INT,
    @TicketId    INT,
    @Remarks     NVARCHAR(1000),
    @UserId      INT,
    @AllowReopen BIT = 0,
    @DueAtOverride DATETIME = NULL   -- 101: forwarded to sp_SetTicketStatus
AS
BEGIN
    SET NOCOUNT ON;

    -- The first OPEN status by SortOrder — 'New' on a seeded company.
    DECLARE @StatusId INT = (SELECT TOP 1 Id FROM dbo.tblLookup
                             WHERE CompId = @CompId AND Kind = 'ticket_status'
                               AND Code = 'open' AND IsActive = 1
                             ORDER BY SortOrder, Id);
    IF @StatusId IS NULL
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'This company has no open status configured' AS ResponseMess; RETURN; END

    EXEC dbo.sp_SetTicketStatus
        @CompId = @CompId, @TicketId = @TicketId, @StatusId = @StatusId, @UserId = @UserId,
        @ResolutionId = NULL, @Remarks = @Remarks, @AllowReopen = @AllowReopen,
        @DueAtOverride = @DueAtOverride;
END
GO

/* ===========================================================================
   VERIFY AFTER APPLY (read-only; run on both DBs)
   ===========================================================================
-- columns
SELECT COL_LENGTH('dbo.tblTaskTat','WorkMinutes') AS WorkMinutes,
       COL_LENGTH('dbo.tblTicket','TatAnchorAt')  AS TatAnchorAt;                 -- both non-NULL

-- backfill: expect 0 (every ticket with a DueAt and a TAT priority has its anchor)
SELECT COUNT(*) AS MissingAnchor FROM dbo.tblTicket t JOIN dbo.tblLookup l ON l.Id = t.Priority
WHERE t.TatAnchorAt IS NULL AND t.DueAt IS NOT NULL AND l.TatHours IS NOT NULL;

-- procs, all with QUOTED_IDENTIFIER ON (every uses_quoted_identifier = 1)
SELECT OBJECT_NAME(object_id) AS proc_name, uses_quoted_identifier FROM sys.sql_modules
WHERE OBJECT_NAME(object_id) IN ('sp_TatReconcile','sp_TatPendingWork','sp_TatApplyWork','sp_RptTat',
  'sp_FetchAttendanceRange','sp_FetchTicketDue','sp_FetchDefaultCalendar',
  'sp_SaveTicket','sp_SetTicketStatus','sp_ReopenTicket')
ORDER BY 1;   -- (10 names listed; expect 10 rows, all 1)

-- the trailing optional param on the three ticket procs
SELECT OBJECT_NAME(object_id) AS proc_name, name, has_default_value FROM sys.parameters
WHERE name = '@DueAtOverride'
  AND OBJECT_NAME(object_id) IN ('sp_SaveTicket','sp_SetTicketStatus','sp_ReopenTicket');  -- 3 rows

-- reconcile clears WorkMinutes on reopen and resume (expect 2)
SELECT (LEN(definition) - LEN(REPLACE(definition, 'WorkMinutes = NULL', ''))) / LEN('WorkMinutes = NULL') AS Clears
FROM sys.sql_modules WHERE OBJECT_NAME(object_id) = 'sp_TatReconcile';

-- menus: parent + 2 children under it
SELECT m.Id, m.ParentId, m.Description, m.Route, m.Module FROM dbo.tblMenu m
WHERE m.Description = 'Team Reports' OR m.Route IN ('/reports/tat','/reports/attendance');  -- 3 rows

-- report + inputs smoke (3 result sets each, except sp_FetchTicketDue = 1, sp_FetchDefaultCalendar = 2)
EXEC dbo.sp_RptTat @CompId=1, @FromDate='2026-10-01', @ToDate='2026-10-31';
EXEC dbo.sp_RptTat @CompId=1, @FromDate='2026-07-01', @ToDate='2026-10-31', @GroupBy='verdict_by';   -- weekly buckets
EXEC dbo.sp_RptTat @CompId=1, @FromDate='2026-10-01', @ToDate='2026-10-31', @UserIdsJson=N'[]';       -- RS1 Clocks = 0, RS2/RS3 empty
EXEC dbo.sp_FetchAttendanceRange @CompId=1, @FromDate='2026-10-01', @ToDate='2026-10-31', @UserIdsJson=NULL;
EXEC dbo.sp_TatPendingWork @CompId=1;                                          -- 2 result sets
EXEC dbo.sp_FetchDefaultCalendar @CompId=1;
DECLARE @tk INT = (SELECT TOP 1 Id FROM dbo.tblTicket WHERE CompId = 1 ORDER BY Id DESC);
EXEC dbo.sp_FetchTicketDue @CompId=1, @TicketId=@tk;
-- (expect: unknown GroupBy raises)  EXEC dbo.sp_RptTat @CompId=1, @FromDate='2026-10-01', @ToDate='2026-10-31', @GroupBy='nope';
*/
