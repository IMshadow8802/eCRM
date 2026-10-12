-- 108_today_reports.sql — Today (Mine / My team) + TAT report v2 + drill-downs.
-- Read-only procs only; no table or data changes. Spec:
-- docs/superpowers/specs/2026-10-10-today-reports-redesign-design.md
-- Apply on TestCRM first, then eCRM+ and SolarCRM once checked.
-- Apply: sqlcmd -I -S <server> -d TestCRM -i 108_today_reports.sql
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

-- ===========================================================================
-- 1. sp_FetchDayTasks — every task row Today needs, one per (task, assignee).
--    Open tasks, plus tasks finished / my-part-done on @WorkDate, plus tasks
--    whose missed deadline still waits for a reason or a decision.
--    Shared + project always; personal only when @IncludePersonal = 1 (Mine).
--    The person's clock = their open clock, else their latest one.
-- ===========================================================================
CREATE OR ALTER PROCEDURE dbo.sp_FetchDayTasks
    @CompId          BIGINT,
    @WorkDate        DATE,
    @UserIdsJson     NVARCHAR(MAX),
    @ViewerId        INT,
    @IncludePersonal BIT = 0,
    @ViewerIsAdmin   BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    IF @WorkDate IS NULL SET @WorkDate = CAST(GETDATE() AS DATE);
    DECLARE @DayStart DATETIME = CAST(@WorkDate AS DATETIME);
    DECLARE @DayEnd   DATETIME = DATEADD(DAY, 1, @DayStart);

    DECLARE @Users TABLE (UserId INT PRIMARY KEY);
    INSERT INTO @Users (UserId)
    SELECT DISTINCT TRY_CAST(value AS INT) FROM OPENJSON(ISNULL(@UserIdsJson, N'[]'))
    WHERE TRY_CAST(value AS INT) IS NOT NULL;

    -- Everyone below the viewer in ReportsTo: the viewer may rule on their delays.
    ;WITH sub AS (
        SELECT u.Id, 1 AS Depth FROM dbo.tblUser u WHERE u.CompId = @CompId AND u.ReportsTo = @ViewerId
        UNION ALL
        SELECT u.Id, s.Depth + 1 FROM dbo.tblUser u JOIN sub s ON u.ReportsTo = s.Id
        WHERE u.CompId = @CompId AND s.Depth < 20
    )
    SELECT DISTINCT Id INTO #Sub FROM sub;

    ;WITH asg AS (
        SELECT a.TaskId, a.UserId, a.AssignedAt, a.AssignedByUserId
        FROM dbo.tblTaskAssignee a JOIN @Users us ON us.UserId = a.UserId
        UNION ALL
        -- personal_owner: a personal task with no assignee row belongs to the workspace owner
        SELECT t.Id, w.OwnerUserId, t.CreatedDate, t.CreatedByUserId
        FROM dbo.tblTasks t
        JOIN dbo.tblWorkspaces w ON w.Id = t.WorkspaceId AND w.Type = 'personal'
        JOIN @Users us ON us.UserId = w.OwnerUserId
        WHERE @IncludePersonal = 1
          AND NOT EXISTS (SELECT 1 FROM dbo.tblTaskAssignee a2 WHERE a2.TaskId = t.Id)
    )
    SELECT a.UserId,
           t.Id                                   AS TaskId,
           CAST(t.Title AS NVARCHAR(500))         AS Title,
           t.WorkspaceId,
           CAST(w.Name AS NVARCHAR(200))          AS WorkspaceName,
           w.Type                                 AS WorkspaceType,
           a.AssignedAt,
           ab.FullName                            AS AssignedByName,
           t.Priority,
           t.DueDate,
           CONVERT(VARCHAR(5), t.DueTime, 108)    AS DueTime,
           t.IsCompleted,
           t.CompletedDate,
           ISNULL(ck.Total, 0)                    AS StepsTotal,
           ISNULL(ck.Done, 0)                     AS StepsDone,
           c.Id AS TatId, c.DueAt, c.WarnedAt, c.BreachedAt, c.AcknowledgedAt,
           c.ClosedAt, c.CloseReason, c.BreachReasonId, c.Verdict,
           h.StartedAt                            AS HeldSince,
           hl.Value                               AS HoldReason,
           CAST(CASE WHEN c.Id IS NOT NULL AND a.UserId <> @ViewerId
                      AND (   a.UserId IN (SELECT Id FROM #Sub)
                           OR w.OwnerUserId = @ViewerId
                           OR EXISTS (SELECT 1 FROM dbo.tblWorkspaceMembers m
                                       WHERE m.WorkspaceId = w.Id AND m.UserId = @ViewerId AND m.IsActive = 1
                                         AND m.Role IN ('owner','manager')
                                         AND m.InviteStatus = 'active')
                           OR (@ViewerIsAdmin = 1 AND w.Type <> 'personal'))
                     THEN 1 ELSE 0 END AS BIT)    AS ViewerCanRule
    FROM asg a
    JOIN dbo.tblTasks      t ON t.Id = a.TaskId AND t.IsDeleted = 0
    JOIN dbo.tblWorkspaces w ON w.Id = t.WorkspaceId AND w.CompId = @CompId AND w.IsArchived = 0
    LEFT JOIN dbo.tblUser  ab ON ab.Id = a.AssignedByUserId
    OUTER APPLY (SELECT COUNT(*) AS Total, SUM(CASE WHEN IsCompleted = 1 THEN 1 ELSE 0 END) AS Done
                   FROM dbo.tblTaskChecklist WHERE TaskId = t.Id) ck
    OUTER APPLY (SELECT TOP 1 tt.* FROM dbo.tblTaskTat tt
                  WHERE tt.TaskId = t.Id AND tt.UserId = a.UserId AND tt.CompId = @CompId
                  ORDER BY CASE WHEN tt.ClosedAt IS NULL THEN 0 ELSE 1 END, tt.AssignedAt DESC) c
    OUTER APPLY (SELECT TOP 1 StartedAt, ReasonId FROM dbo.tblTaskTatHold
                  WHERE TatId = c.Id AND EndedAt IS NULL ORDER BY StartedAt) h
    LEFT JOIN dbo.tblLookup hl ON hl.Id = h.ReasonId
    WHERE (w.Type IN ('shared','project') OR (@IncludePersonal = 1 AND w.Type = 'personal'))
      AND (a.AssignedAt IS NULL OR a.AssignedAt < @DayEnd)
      AND (   t.IsCompleted = 0
           OR (t.CompletedDate >= @DayStart AND t.CompletedDate < @DayEnd)
           OR (c.CloseReason = 'my_part_done' AND c.ClosedAt >= @DayStart AND c.ClosedAt < @DayEnd)
           OR (a.AssignedAt >= @DayStart AND a.AssignedAt < @DayEnd)
           OR (c.BreachedAt >= @DayStart AND c.BreachedAt < @DayEnd)
           OR (c.BreachedAt IS NOT NULL AND c.Verdict IS NULL))
    ORDER BY a.UserId, t.Id;
END
GO

-- ===========================================================================
-- 2. sp_FetchSessionsRange — raw sessions touching [@FromDate, @ToDate].
--    Node merges overlaps and clips to each day (utils/sessionDay.js).
-- ===========================================================================
CREATE OR ALTER PROCEDURE dbo.sp_FetchSessionsRange
    @CompId      BIGINT,
    @FromDate    DATE,
    @ToDate      DATE,
    @UserIdsJson NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @From DATETIME = CAST(@FromDate AS DATETIME);
    DECLARE @To   DATETIME = DATEADD(DAY, 1, CAST(@ToDate AS DATETIME));
    SELECT s.UserId, s.Device, s.StartedAt, s.LastSeenAt, s.EndedAt
    FROM dbo.tblUserSession s
    WHERE s.CompId = @CompId
      AND s.UserId IN (SELECT TRY_CAST(value AS INT) FROM OPENJSON(ISNULL(@UserIdsJson, N'[]')))
      AND s.StartedAt < @To
      AND COALESCE(s.EndedAt, s.LastSeenAt, s.StartedAt) >= @From
    ORDER BY s.UserId, s.StartedAt;
END
GO

-- ===========================================================================
-- 3. fn_TatReportRows — the one population for the TAT report and its drill-down.
--    A clock is in range when it finished in range, missed its deadline in
--    range, or is overdue right now (live, range-independent).
-- ===========================================================================
CREATE OR ALTER FUNCTION dbo.fn_TatReportRows
(
    @CompId      BIGINT,
    @From        DATETIME,
    @To          DATETIME,
    @BranchId    INT,
    @OwnerId     INT,
    @UserIdsJson NVARCHAR(MAX)
)
RETURNS TABLE
AS
RETURN
SELECT tt.Id AS TatId, tt.TaskId, tt.UserId, u.FullName,
       ISNULL(CAST(t.Title AS NVARCHAR(500)), tt.TaskTitle) AS TaskTitle,
       t.Priority, t.WorkspaceId, CAST(w.Name AS NVARCHAR(200)) AS WorkspaceName,
       tt.AssignedAt, tt.DueAt, tt.ClosedAt, tt.BreachedAt, tt.BreachReasonId, tt.BreachRemarks,
       tt.Verdict, tt.VerdictBy, tt.VerdictRemarks, tt.WorkMinutes, tt.TargetMinutes,
       f.IsFinished,
       CASE WHEN f.IsFinished = 1 AND tt.BreachedAt IS NULL THEN 1 ELSE 0 END                         AS IsOnTime,
       f.IsMissed,
       CASE WHEN f.IsMissed = 1 AND tt.Verdict = 'not_excused' THEN 1 ELSE 0 END                      AS IsNotExcused,
       CASE WHEN f.IsMissed = 1 AND tt.Verdict = 'excused' THEN 1 ELSE 0 END                          AS IsExcused,
       CASE WHEN f.IsMissed = 1 AND tt.Verdict IS NULL THEN 1 ELSE 0 END                              AS IsNoDecision,
       CASE WHEN f.IsMissed = 1 AND tt.Verdict IS NULL AND tt.BreachReasonId IS NULL THEN 1 ELSE 0 END AS IsReasonPending,
       f.IsOverdueNow,
       CASE WHEN f.IsFinished = 1 AND tt.WorkMinutes IS NOT NULL AND tt.TargetMinutes > 0
            THEN CAST(tt.WorkMinutes * 100.0 / tt.TargetMinutes AS DECIMAL(9,1)) END                  AS UsedPct
FROM dbo.tblTaskTat tt
LEFT JOIN dbo.tblTasks      t ON t.Id = tt.TaskId
LEFT JOIN dbo.tblWorkspaces w ON w.Id = t.WorkspaceId
LEFT JOIN dbo.tblUser       u ON u.Id = tt.UserId
CROSS APPLY (SELECT
    CASE WHEN tt.CloseReason IN ('completed','my_part_done') AND tt.ClosedAt >= @From AND tt.ClosedAt < @To THEN 1 ELSE 0 END AS IsFinished,
    CASE WHEN tt.BreachedAt >= @From AND tt.BreachedAt < @To THEN 1 ELSE 0 END AS IsMissed,
    CASE WHEN tt.ClosedAt IS NULL AND tt.BreachedAt IS NOT NULL THEN 1 ELSE 0 END AS IsOverdueNow) f
WHERE tt.CompId = @CompId
  AND (@BranchId IS NULL OR tt.BranchId = @BranchId)
  AND (@OwnerId  IS NULL OR tt.UserId   = @OwnerId)
  AND (@UserIdsJson IS NULL OR tt.UserId IN (SELECT TRY_CAST(value AS INT) FROM OPENJSON(@UserIdsJson)))
  AND (f.IsFinished = 1 OR f.IsMissed = 1 OR f.IsOverdueNow = 1);
GO

-- ===========================================================================
-- 4. sp_RptTat v2 — finish-day basis. Same params as before; GroupBy
--    verdict_by is gone (person | priority | workspace).
-- ===========================================================================
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
    IF ISNULL(@GroupBy, '') NOT IN ('person','priority','workspace')
    BEGIN RAISERROR('sp_RptTat: unknown GroupBy', 16, 1); RETURN; END
    IF @FromDate IS NULL OR @ToDate IS NULL OR @ToDate < @FromDate
    BEGIN RAISERROR('sp_RptTat: FromDate and ToDate are required', 16, 1); RETURN; END
    IF @UserIdsJson IS NOT NULL AND ISJSON(@UserIdsJson) = 0
    BEGIN RAISERROR('sp_RptTat: invalid UserIdsJson', 16, 1); RETURN; END

    DECLARE @From DATETIME = CAST(@FromDate AS DATETIME);
    DECLARE @To   DATETIME = DATEADD(DAY, 1, CAST(@ToDate AS DATETIME));
    DECLARE @Len  INT = DATEDIFF(DAY, @From, @To);
    DECLARE @Weekly BIT = CASE WHEN @Len > 14 THEN 1 ELSE 0 END;

    SELECT r.*,
           ISNULL(CASE @GroupBy WHEN 'person'    THEN CAST(r.UserId AS NVARCHAR(50))
                                WHEN 'priority'  THEN CAST(r.Priority AS NVARCHAR(50))
                                WHEN 'workspace' THEN CAST(r.WorkspaceId AS NVARCHAR(50)) END, N'') AS GroupKey,
           CAST(CASE @GroupBy WHEN 'person'    THEN ISNULL(r.FullName, 'Unknown')
                              WHEN 'priority'  THEN ISNULL(r.Priority, 'No priority')
                              WHEN 'workspace' THEN ISNULL(r.WorkspaceName, 'No board') END AS NVARCHAR(200)) AS GroupLabel,
           CAST(CASE WHEN @Weekly = 1 THEN DATEADD(DAY, -(DATEDIFF(DAY, 0, r.ClosedAt) % 7), r.ClosedAt)
                     ELSE r.ClosedAt END AS DATE) AS Bucket
    INTO #T
    FROM dbo.fn_TatReportRows(@CompId, @From, @To, @BranchId, @OwnerId, @UserIdsJson) r;

    -- RS1 KPIs (one row)
    SELECT ISNULL(SUM(IsFinished), 0)      AS Finished,
           ISNULL(SUM(IsOnTime), 0)        AS OnTime,
           CAST(SUM(IsOnTime) * 100.0 / NULLIF(SUM(IsFinished), 0) AS DECIMAL(5,1)) AS OnTimePct,
           ISNULL(SUM(IsMissed), 0)        AS Missed,
           ISNULL(SUM(IsNotExcused), 0)    AS NotExcused,
           ISNULL(SUM(IsExcused), 0)       AS Excused,
           ISNULL(SUM(IsNoDecision), 0)    AS NoDecision,
           ISNULL(SUM(IsReasonPending), 0) AS ReasonPending,
           ISNULL(SUM(IsOverdueNow), 0)    AS OverdueNow,
           MIN(CASE WHEN IsOverdueNow = 1 THEN BreachedAt END) AS OldestOverdueAt,
           (SELECT TOP 1 CAST(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY UsedPct) OVER () AS DECIMAL(9,1)) FROM #T WHERE UsedPct IS NOT NULL) AS MedianUsedPct,
           (SELECT TOP 1 CAST(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY UsedPct) OVER () AS DECIMAL(9,1)) FROM #T WHERE UsedPct IS NOT NULL) AS P90UsedPct
    FROM #T;

    -- RS2 per group
    ;WITH p AS (
        SELECT DISTINCT GroupKey,
               PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY UsedPct) OVER (PARTITION BY GroupKey) AS Med
        FROM #T WHERE UsedPct IS NOT NULL
    )
    SELECT g.GroupKey, MAX(g.GroupLabel) AS GroupLabel,
           SUM(g.IsFinished) AS Finished, SUM(g.IsOnTime) AS OnTime,
           CAST(SUM(g.IsOnTime) * 100.0 / NULLIF(SUM(g.IsFinished), 0) AS DECIMAL(5,1)) AS OnTimePct,
           SUM(g.IsMissed) AS Missed, SUM(g.IsNotExcused) AS NotExcused, SUM(g.IsExcused) AS Excused,
           SUM(g.IsNoDecision) AS NoDecision, SUM(g.IsReasonPending) AS ReasonPending,
           SUM(g.IsOverdueNow) AS OverdueNow,
           CAST(MAX(p.Med) AS DECIMAL(9,1)) AS MedianUsedPct
    FROM #T g LEFT JOIN p ON p.GroupKey = g.GroupKey
    GROUP BY g.GroupKey
    ORDER BY SUM(g.IsNotExcused) DESC, SUM(g.IsMissed) DESC, MAX(g.GroupLabel);

    -- RS3 trend by finish day / week
    SELECT Bucket, SUM(IsFinished) AS Finished, SUM(IsOnTime) AS OnTime
    FROM #T WHERE IsFinished = 1
    GROUP BY Bucket ORDER BY Bucket;

    -- RS4 the same-length period just before
    SELECT ISNULL(SUM(IsFinished), 0) AS Finished, ISNULL(SUM(IsOnTime), 0) AS OnTime
    FROM dbo.fn_TatReportRows(@CompId, DATEADD(DAY, -@Len, @From), @From, @BranchId, @OwnerId, @UserIdsJson);
END
GO

-- ===========================================================================
-- 5. sp_RptTatClocks — the clocks behind one number of the TAT report.
--    @Metric: finished | ontime | missed | not_excused | excused | no_decision
--             | reason_pending | overdue_now.  @GroupKey NULL = all groups.
-- ===========================================================================
CREATE OR ALTER PROCEDURE dbo.sp_RptTatClocks
    @CompId      BIGINT,
    @FromDate    DATE,
    @ToDate      DATE,
    @GroupBy     VARCHAR(20)   = 'person',
    @GroupKey    NVARCHAR(50)  = NULL,
    @Metric      VARCHAR(20),
    @BranchId    INT           = NULL,
    @OwnerId     INT           = NULL,
    @UserIdsJson NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF ISNULL(@Metric, '') NOT IN ('finished','ontime','missed','not_excused','excused','no_decision','reason_pending','overdue_now')
    BEGIN RAISERROR('sp_RptTatClocks: unknown Metric', 16, 1); RETURN; END
    IF ISNULL(@GroupBy, '') NOT IN ('person','priority','workspace')
    BEGIN RAISERROR('sp_RptTatClocks: unknown GroupBy', 16, 1); RETURN; END

    DECLARE @From DATETIME = CAST(@FromDate AS DATETIME);
    DECLARE @To   DATETIME = DATEADD(DAY, 1, CAST(@ToDate AS DATETIME));

    SELECT TOP 500 r.TatId, r.TaskId, r.TaskTitle, r.UserId, r.FullName, r.WorkspaceName,
           r.AssignedAt, r.DueAt, r.ClosedAt, r.BreachedAt,
           rl.Value AS Reason, r.BreachRemarks, r.Verdict, vb.FullName AS VerdictByName, r.VerdictRemarks,
           r.WorkMinutes, r.TargetMinutes
    FROM dbo.fn_TatReportRows(@CompId, @From, @To, @BranchId, @OwnerId, @UserIdsJson) r
    LEFT JOIN dbo.tblLookup rl ON rl.Id = r.BreachReasonId
    LEFT JOIN dbo.tblUser   vb ON vb.Id = r.VerdictBy
    WHERE (@GroupKey IS NULL OR ISNULL(CASE @GroupBy WHEN 'person'    THEN CAST(r.UserId AS NVARCHAR(50))
                                                     WHEN 'priority'  THEN CAST(r.Priority AS NVARCHAR(50))
                                                     WHEN 'workspace' THEN CAST(r.WorkspaceId AS NVARCHAR(50)) END, N'') = @GroupKey)
      AND 1 = CASE @Metric WHEN 'finished'       THEN r.IsFinished
                           WHEN 'ontime'         THEN r.IsOnTime
                           WHEN 'missed'         THEN r.IsMissed
                           WHEN 'not_excused'    THEN r.IsNotExcused
                           WHEN 'excused'        THEN r.IsExcused
                           WHEN 'no_decision'    THEN r.IsNoDecision
                           WHEN 'reason_pending' THEN r.IsReasonPending
                           WHEN 'overdue_now'    THEN r.IsOverdueNow END
    ORDER BY COALESCE(r.BreachedAt, r.ClosedAt) DESC;
END
GO

-- ===========================================================================
-- Verify after apply (TestCRM; Kavya Nair = 80, Priya Singh = 78)
-- ===========================================================================
-- EXEC dbo.sp_FetchDayTasks @CompId = 1, @WorkDate = NULL, @UserIdsJson = N'[80,78]', @ViewerId = 1, @IncludePersonal = 0, @ViewerIsAdmin = 0;
-- EXEC dbo.sp_FetchSessionsRange @CompId = 1, @FromDate = '2026-10-08', @ToDate = '2026-10-10', @UserIdsJson = N'[78]';
-- EXEC dbo.sp_RptTat @CompId = 1, @FromDate = '2026-09-10', @ToDate = '2026-10-10';
-- EXEC dbo.sp_RptTatClocks @CompId = 1, @FromDate = '2026-09-10', @ToDate = '2026-10-10', @Metric = 'overdue_now';
-- Expect: Kavya's 4 clocks present with #11 reason-pending; OverdueNow equals
-- SELECT COUNT(*) FROM tblTaskTat WHERE CompId = 1 AND ClosedAt IS NULL AND BreachedAt IS NOT NULL.
