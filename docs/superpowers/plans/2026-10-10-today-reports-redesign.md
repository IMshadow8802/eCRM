# Today + Team Reports redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Today (Mine / My team) and the Task-deadlines + Attendance reports so every number is correct, defined once, and opens the list behind it.

**Architecture:** Two read-only SQL procs feed *all* of Today (`sp_FetchDayTasks` task rows, `sp_FetchSessionsRange` raw sessions); Node turns rows into buckets and counts in pure, tested utils (`utils/dayBuckets.js`, `utils/sessionDay.js`) so Mine, My team and the drawer can never disagree. The TAT report moves to one inline function (`fn_TatReportRows`) shared by the KPI proc and the drill-down proc. Web gets its own page layouts built from `ui/` components.

**Tech Stack:** SQL Server procs · Node/Express 5 + Jest/Supertest · React 19 + MUI 9 + TanStack Query + Vitest/RTL/MSW.

**Spec:** `docs/superpowers/specs/2026-10-10-today-reports-redesign-design.md` (mockups: https://claude.ai/artifact/98FSVxVH6AnS2kMQ98vBSF). Read it first — §1 is the only definition of every word.

## Global Constraints

- pnpm only. Never npm.
- No git mutations (add/commit/branch…) — leave all changes uncommitted for the user. Branch `feat/today-reports-redesign` already exists and is checked out.
- SQL is never applied by an agent. `backend/sql/108_today_reports.sql` is written, then the user applies it to TestCRM. Reads via `mcp__sqlserver-ecrm__read_query` against `[TestCRM]` are fine.
- Every query filtered by `CompId`. Personal workspaces only in **Mine** (never in team, drawer for others, or reports).
- Times are IST naive datetimes; Node runs `TZ=Asia/Kolkata`; day keys via `workCalendar.dateKey` / `at`.
- Working-time maths only in `utils/workCalendar.js` (`workingMinutesBetween`, `endOfShift`).
- Every new route declares access (`open()` + scope check in controller); `tests/unit/routes/routeAccess.test.js` must stay green.
- Web: shared `ui/` components only; MUI v9 `slotProps`; sizes in rem (`calc(Nrem / 15)` or `rem()` from `utils/rem.js`); lucide icons.
- Tests first; ≥80% line/branch on every touched file; never `.skip`/`.only`.
- Status words are fixed (spec §1/§2): On time · Late Nm · Not signed in · Not signed in yet · On leave · On duty · Holiday · Not tracked · Signed out.

## Review Focus

1. **A person with zero tasks and zero sessions** (new hire, PresenceExempt) — card renders with zeros greyed and "Not tracked"/"Not signed in", no crash, no NaN. Pinned in Task 2 (`describeTasks([])`) and Task 9.
2. **Picking a past day** — live counts (Open, Working on, Overdue, Close to deadline, waiting-for) are `null`, not today's numbers; UI shows "Live counts only for today". Pinned in Task 4 and Task 9.
3. **Overlapping sessions** (web + mobile at the same time, or a session crossing midnight) — online minutes counted once and clipped to the day. Pinned in Task 3.
4. **Drawer for someone outside my reach / personal tasks of others** — 403, and personal tasks never appear for anyone but their owner. Pinned in Task 4.
5. **Empty report range / no finished clocks** — `OnTimePct` null shown as "—" with "0 finished", never "0%" or "100%". Pinned in Task 5 and Task 10.

---

## Phase 1 — SQL (one script; user applies to TestCRM, then we continue)

### Task 1: `backend/sql/108_today_reports.sql`

**Files:**
- Create: `backend/sql/108_today_reports.sql`

**Interfaces — Produces:**
- `sp_FetchDayTasks(@CompId BIGINT, @WorkDate DATE, @UserIdsJson NVARCHAR(MAX), @ViewerId INT, @IncludePersonal BIT)` → one RS, columns: `UserId, TaskId, Title, WorkspaceId, WorkspaceName, WorkspaceType, AssignedAt, AssignedByName, Priority, DueDate, DueTime ('HH:MM'|NULL), IsCompleted, CompletedDate, StepsTotal, StepsDone, TatId, DueAt, WarnedAt, BreachedAt, AcknowledgedAt, ClosedAt, CloseReason, BreachReasonId, Verdict, HeldSince, HoldReason, ViewerCanRule (bit)`.
- `sp_FetchSessionsRange(@CompId, @FromDate DATE, @ToDate DATE, @UserIdsJson)` → `UserId, Device, StartedAt, LastSeenAt, EndedAt`.
- `fn_TatReportRows(@CompId, @From DATETIME, @To DATETIME, @BranchId, @OwnerId, @UserIdsJson)` → one row per clock with flags `IsFinished, IsOnTime, IsMissed, IsNotExcused, IsExcused, IsNoDecision, IsReasonPending, IsOverdueNow` (INT 0/1), `UsedPct` (DECIMAL or NULL) + identity columns.
- `sp_RptTat` (altered, same params; `@GroupBy` ∈ person|priority|workspace) → RS1 KPIs `Finished, OnTime, OnTimePct, Missed, NotExcused, Excused, NoDecision, ReasonPending, OverdueNow, OldestOverdueAt, MedianUsedPct, P90UsedPct`; RS2 per group `GroupKey, GroupLabel` + same counts (no OldestOverdueAt); RS3 trend `Bucket, Finished, OnTime` by finish day (weekly Monday buckets when range > 14 days); RS4 previous period `Finished, OnTime`.
- `sp_RptTatClocks(@CompId, @FromDate, @ToDate, @GroupBy, @GroupKey NVARCHAR(50) NULL, @Metric VARCHAR(20), @BranchId, @OwnerId, @UserIdsJson)` → TOP 500 rows `TatId, TaskId, TaskTitle, UserId, FullName, WorkspaceName, AssignedAt, DueAt, ClosedAt, BreachedAt, Reason, BreachRemarks, Verdict, VerdictByName, VerdictRemarks, WorkMinutes, TargetMinutes`.

- [ ] **Step 1: Check how personal tasks record their assignee** (read-only):

```sql
SELECT w.Type, COUNT(*) AS Tasks,
       SUM(CASE WHEN EXISTS (SELECT 1 FROM [TestCRM].dbo.tblTaskAssignee a WHERE a.TaskId = t.Id) THEN 1 ELSE 0 END) AS WithAssigneeRow,
       SUM(CASE WHEN t.AssignedToUserId IS NOT NULL THEN 1 ELSE 0 END) AS WithLegacyAssignee
FROM [TestCRM].dbo.tblTasks t JOIN [TestCRM].dbo.tblWorkspaces w ON w.Id = t.WorkspaceId
WHERE t.IsDeleted = 0 GROUP BY w.Type;
```
If personal tasks lack `tblTaskAssignee` rows, keep the `personal_owner` arm of the `asg` CTE below (the owner counts as assignee); if they all have rows, still keep it — it is harmless (`NOT EXISTS` guard).

- [ ] **Step 2: Write the script** (exact content):

```sql
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
    @IncludePersonal BIT = 0
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
                                         AND ISNULL(m.InviteStatus, 'accepted') = 'accepted'))
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
-- EXEC dbo.sp_FetchDayTasks @CompId = <comp>, @WorkDate = NULL, @UserIdsJson = N'[80,78]', @ViewerId = 1, @IncludePersonal = 0;
-- EXEC dbo.sp_FetchSessionsRange @CompId = <comp>, @FromDate = '2026-10-08', @ToDate = '2026-10-10', @UserIdsJson = N'[78]';
-- EXEC dbo.sp_RptTat @CompId = <comp>, @FromDate = '2026-09-10', @ToDate = '2026-10-10';
-- EXEC dbo.sp_RptTatClocks @CompId = <comp>, @FromDate = '2026-09-10', @ToDate = '2026-10-10', @Metric = 'overdue_now';
-- Expect: Kavya's 4 clocks present with #11 reason-pending; OverdueNow equals
-- SELECT COUNT(*) FROM tblTaskTat WHERE CompId = <comp> AND ClosedAt IS NULL AND BreachedAt IS NOT NULL.
```

- [ ] **Step 3: Fill `<comp>`** in the verify block with the TestCRM CompId (`SELECT DISTINCT CompId FROM [TestCRM].dbo.tblUser WHERE Id IN (78,80)`).

- [ ] **Step 4: Hand off.** Stop and tell the user: "108 written — apply to TestCRM with `sqlcmd -I …`, then run the verify block." Phase 2 waits for "applied".

---

## Phase 2 — Backend

### Task 2: `utils/dayBuckets.js` — one task row → what Today shows

**Files:**
- Create: `backend/src/utils/dayBuckets.js`
- Test: `backend/tests/unit/utils/dayBuckets.test.js`

**Interfaces:**
- Consumes: `workCalendar.{dateKey, at, endOfShift, workingMinutesBetween}`; rows of `sp_FetchDayTasks`.
- Produces:
  - `BUCKETS = ["given","open","working","notStarted","dueToday","done","overdue","atRisk","onHold","reasonOwed","toRule"]`
  - `describeTask(row, { key, now, ctx, live })` → `{ ...row(minimal), due: Date|null, timeLeftMin: number|null, timer: "clock"|"none", flags: {given, open, working, notStarted, dueToday, done, doneLate, overdue, atRisk, onHold, reasonOwed, toRule} }` (live-only flags are `false` when `live` is false; `timeLeftMin` null).
  - `countTasks(described, { live })` → `{ given, open, working, notStarted, dueToday, done, doneLate, overdue, atRisk, onHold, reasonOwed, toRule }` — live-only keys (`open, working, notStarted, dueToday, overdue, atRisk, onHold, reasonOwed, toRule`) are `null` when `!live`.
  - `rankPeople(people)` → sorted copy: key order overdue>0, toRule>0, notSignedIn, late, atRisk>0, then `FullName`.

- [ ] **Step 1: Write the failing tests**

```js
const { describeTask, countTasks, rankPeople } = require("../../../src/utils/dayBuckets");
const { DEFAULT_DAYS, at } = require("../../../src/utils/workCalendar");

const ctx = { days: DEFAULT_DAYS, holidays: new Set(), marks: new Map() };
const key = "2026-10-12"; // a Monday
const now = at(key, 12 * 60); // 12:00 IST
const base = { TaskId: 1, Title: "T", AssignedAt: at(key, 9 * 60), IsCompleted: false, StepsTotal: 2, StepsDone: 0 };
const d = (row, o = {}) => describeTask({ ...base, ...row }, { key, now, ctx, live: true, ...o });

describe("describeTask", () => {
  it("given today, not started, no timer", () => {
    const r = d({});
    expect(r.flags).toMatchObject({ given: true, open: true, working: false, notStarted: true, overdue: false });
    expect(r.timer).toBe("none");
  });
  it("working when accepted or one step ticked", () => {
    expect(d({ StepsDone: 1 }).flags.working).toBe(true);
    expect(d({ TatId: 5, DueAt: at(key, 16 * 60), AcknowledgedAt: now }).flags.working).toBe(true);
  });
  it("clock overdue = breached, with negative working time left", () => {
    const r = d({ TatId: 5, DueAt: at(key, 10 * 60), BreachedAt: at(key, 10 * 60) });
    expect(r.flags.overdue).toBe(true);
    expect(r.timeLeftMin).toBeLessThan(0);
  });
  it("no clock: overdue when DueDate+DueTime passed", () => {
    expect(d({ DueDate: new Date(at(key, 0)), DueTime: "11:00" }).flags.overdue).toBe(true);
    expect(d({ DueDate: new Date(at(key, 0)), DueTime: "15:00" }).flags).toMatchObject({ overdue: false, dueToday: true });
  });
  it("no clock and no time: due at end of shift", () => {
    expect(d({ DueDate: new Date(at(key, 0)) }).flags).toMatchObject({ overdue: false, dueToday: true });
  });
  it("close to deadline = warned, not breached", () => {
    expect(d({ TatId: 5, DueAt: at(key, 13 * 60), WarnedAt: now }).flags.atRisk).toBe(true);
  });
  it("on hold shows when the open clock has a hold", () => {
    expect(d({ TatId: 5, DueAt: at(key, 18 * 60), HeldSince: now, HoldReason: "Client" }).flags.onHold).toBe(true);
  });
  it("done today, late when breached", () => {
    const r = d({ IsCompleted: true, CompletedDate: now, TatId: 5, ClosedAt: now, BreachedAt: at(key, 10 * 60) });
    expect(r.flags).toMatchObject({ open: false, done: true, doneLate: true, overdue: false });
  });
  it("my part done counts as done and not open", () => {
    expect(d({ TatId: 5, ClosedAt: now, CloseReason: "my_part_done" }).flags).toMatchObject({ open: false, done: true });
  });
  it("reason owed vs to rule", () => {
    expect(d({ TatId: 5, BreachedAt: now, BreachReasonId: null }).flags.reasonOwed).toBe(true);
    expect(d({ TatId: 5, BreachedAt: now, BreachReasonId: 3, ViewerCanRule: true }).flags.toRule).toBe(true);
    expect(d({ TatId: 5, BreachedAt: now, BreachReasonId: 3, ViewerCanRule: false }).flags.toRule).toBe(false);
  });
  it("past day: live flags off, given/done kept", () => {
    const r = d({ IsCompleted: true, CompletedDate: now }, { live: false });
    expect(r.flags).toMatchObject({ given: true, done: true, open: false, overdue: false, working: false });
    expect(r.timeLeftMin).toBeNull();
  });
});

describe("countTasks", () => {
  it("zeros for nobody, nulls for live keys on a past day", () => {
    expect(countTasks([], { live: true })).toMatchObject({ open: 0, overdue: 0, done: 0 });
    expect(countTasks([], { live: false })).toMatchObject({ open: null, overdue: null, done: 0, given: 0 });
  });
  it("sums flags", () => {
    const rows = [d({ StepsDone: 1 }), d({ DueDate: new Date(at(key, 0)), DueTime: "11:00" })];
    expect(countTasks(rows, { live: true })).toMatchObject({ open: 2, working: 1, overdue: 1, given: 2 });
  });
});

describe("rankPeople", () => {
  const p = (FullName, counts, status = "online") => ({ FullName, counts, status: { code: status } });
  it("overdue, then to-rule, then not signed in, then late, then at risk, then name", () => {
    const out = rankPeople([
      p("Zed", { overdue: 0, toRule: 0, atRisk: 0 }),
      p("Amy", { overdue: 0, toRule: 0, atRisk: 2 }),
      p("Bob", { overdue: 0, toRule: 0, atRisk: 0 }, "late"),
      p("Cat", { overdue: 0, toRule: 0, atRisk: 0 }, "not_signed_in"),
      p("Dan", { overdue: 0, toRule: 1, atRisk: 0 }),
      p("Eve", { overdue: 3, toRule: 0, atRisk: 0 }),
    ]).map((x) => x.FullName);
    expect(out).toEqual(["Eve", "Dan", "Cat", "Bob", "Amy", "Zed"]);
  });
  it("null counts (past day) rank by presence then name", () => {
    expect(rankPeople([p("B", { overdue: null }), p("A", { overdue: null })]).map((x) => x.FullName)).toEqual(["A", "B"]);
  });
});
```

Before writing `rankPeople`, read `presenceController.presenceStatus` and use its real codes for "not signed in" and "late" (adjust the two strings in the test to match).

- [ ] **Step 2: Run** `cd backend && pnpm exec jest tests/unit/utils/dayBuckets.test.js` — expect FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// src/utils/dayBuckets.js
//
// Today (spec §1): one sp_FetchDayTasks row → the flags every Today number counts.
// Mine, My team and the drawer all go through describeTask, so they cannot disagree.

const { dateKey, at, endOfShift, workingMinutesBetween } = require("./workCalendar");

const LIVE = ["open", "working", "notStarted", "dueToday", "overdue", "atRisk", "onHold", "reasonOwed", "toRule"];
const BUCKETS = ["given", "done", "doneLate", ...LIVE];
const asDate = (v) => (v == null ? null : v instanceof Date ? v : new Date(v));
const inDay = (v, key) => v != null && dateKey(asDate(v)) === key;
const hm = (s) => { const [h, m] = String(s).split(":").map(Number); return h * 60 + m; };

/** The moment a task is due: the open clock's DueAt, else DueDate + DueTime / end of shift / 23:59. */
function dueMoment(row, ctx) {
  if (row.TatId && !row.ClosedAt && row.DueAt) return asDate(row.DueAt);
  if (!row.DueDate) return null;
  const key = dateKey(asDate(row.DueDate));
  if (row.DueTime) return at(key, hm(row.DueTime));
  return endOfShift(key, ctx) || at(key, 23 * 60 + 59);
}

function minutesLeft(due, now, clock, ctx) {
  if (!due) return null;
  if (!clock) return Math.round((due - now) / 60000);
  return due >= now ? workingMinutesBetween(now, due, ctx) : -workingMinutesBetween(due, now, ctx);
}

function describeTask(row, { key, now, ctx, live }) {
  const clockOpen = Boolean(row.TatId) && !row.ClosedAt;
  const partDone = row.CloseReason === "my_part_done" && Boolean(row.ClosedAt);
  const open = !row.IsCompleted && !partDone;
  const due = dueMoment(row, ctx);
  const done = inDay(row.CompletedDate, key) || (partDone && inDay(row.ClosedAt, key));
  const liveFlag = (v) => Boolean(live && v);
  const working = open && (Boolean(row.AcknowledgedAt) || Number(row.StepsDone) > 0);
  const flags = {
    given: inDay(row.AssignedAt, key),
    done,
    doneLate: done && Boolean(row.BreachedAt),
    open: liveFlag(open),
    working: liveFlag(working),
    notStarted: liveFlag(open && !working),
    dueToday: liveFlag(open && due && dateKey(due) === key),
    overdue: liveFlag(open && (clockOpen ? Boolean(row.BreachedAt) : Boolean(due) && due < now)),
    atRisk: liveFlag(open && clockOpen && row.WarnedAt && !row.BreachedAt),
    onHold: liveFlag(open && clockOpen && row.HeldSince),
    reasonOwed: liveFlag(row.BreachedAt && row.BreachReasonId == null && row.Verdict == null),
    toRule: liveFlag(row.BreachedAt && row.BreachReasonId != null && row.Verdict == null && row.ViewerCanRule),
  };
  return {
    TaskId: row.TaskId, TatId: row.TatId ?? null, Title: row.Title, WorkspaceId: row.WorkspaceId,
    WorkspaceName: row.WorkspaceName, AssignedByName: row.AssignedByName ?? null, Priority: row.Priority ?? null,
    StepsTotal: Number(row.StepsTotal) || 0, StepsDone: Number(row.StepsDone) || 0,
    HoldReason: row.HoldReason ?? null, CompletedDate: row.CompletedDate ?? null, BreachedAt: row.BreachedAt ?? null,
    due, timer: row.TatId ? "clock" : "none",
    timeLeftMin: live && open ? minutesLeft(due, now, clockOpen, ctx) : null,
    flags,
  };
}

function countTasks(described, { live }) {
  const out = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
  for (const t of described) for (const b of BUCKETS) if (t.flags[b]) out[b] += 1;
  if (!live) for (const b of LIVE) out[b] = null;
  return out;
}

const NOT_IN = new Set(["not_signed_in"]); // ponytail: match presenceStatus codes
const LATE = new Set(["late"]);
function rankPeople(people) {
  const score = (p) => [
    (p.counts?.overdue ?? 0) > 0 ? 0 : 1,
    (p.counts?.toRule ?? 0) > 0 ? 0 : 1,
    NOT_IN.has(p.status?.code) ? 0 : 1,
    LATE.has(p.status?.code) || p.status?.late ? 0 : 1,
    (p.counts?.atRisk ?? 0) > 0 ? 0 : 1,
  ];
  return [...people].sort((a, b) => {
    const x = score(a), y = score(b);
    for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
    return String(a.FullName).localeCompare(String(b.FullName));
  });
}

module.exports = { BUCKETS, LIVE, dueMoment, describeTask, countTasks, rankPeople };
```

- [ ] **Step 4: Run** the test + `pnpm exec jest tests/unit/utils/dayBuckets.test.js --coverage --collectCoverageFrom='src/utils/dayBuckets.js'` — PASS, ≥80%.

### Task 3: `utils/sessionDay.js` — online time per day

**Files:**
- Create: `backend/src/utils/sessionDay.js`
- Test: `backend/tests/unit/utils/sessionDay.test.js`

**Interfaces — Produces:** `sessionDay(sessions, key, now)` → `{ onlineMinutes, signIns, devices: string[], lastSeenAt: Date|null, open: boolean }`; `sessionsByUserDay(sessions, fromKey, toKey, now)` → `Map<"userId|key", sessionDay>`.

- [ ] **Step 1: Failing tests**

```js
const { sessionDay, sessionsByUserDay } = require("../../../src/utils/sessionDay");
const { at } = require("../../../src/utils/workCalendar");
const key = "2026-10-08";
const s = (from, to, extra = {}) => ({ UserId: 78, Device: "web", StartedAt: at(key, from), LastSeenAt: at(key, to), EndedAt: at(key, to), ...extra });

describe("sessionDay", () => {
  it("sums separate sessions", () => {
    expect(sessionDay([s(600, 630), s(700, 730)], key, at(key, 1200)).onlineMinutes).toBe(60);
  });
  it("counts overlap once (web + mobile together)", () => {
    const r = sessionDay([s(600, 660), s(630, 690, { Device: "mobile" })], key, at(key, 1200));
    expect(r.onlineMinutes).toBe(90);
    expect(r.devices.sort()).toEqual(["mobile", "web"]);
    expect(r.signIns).toBe(2);
  });
  it("clips a session that started yesterday; it is not a sign-in today", () => {
    const r = sessionDay([{ UserId: 78, Device: "web", StartedAt: at("2026-10-07", 1380), LastSeenAt: at(key, 30), EndedAt: at(key, 30) }], key, at(key, 1200));
    expect(r).toMatchObject({ onlineMinutes: 30, signIns: 0 });
  });
  it("an open session runs to its last heartbeat, not to now", () => {
    const r = sessionDay([s(600, 640, { EndedAt: null })], key, at(key, 900));
    expect(r).toMatchObject({ onlineMinutes: 40, open: true });
  });
  it("nothing → zeros", () => {
    expect(sessionDay([], key, at(key, 600))).toEqual({ onlineMinutes: 0, signIns: 0, devices: [], lastSeenAt: null, open: false });
  });
});

describe("sessionsByUserDay", () => {
  it("groups by user and day across a range", () => {
    const m = sessionsByUserDay([s(600, 630), { ...s(600, 620), StartedAt: at("2026-10-09", 600), LastSeenAt: at("2026-10-09", 620), EndedAt: at("2026-10-09", 620) }], key, "2026-10-09", at("2026-10-09", 1200));
    expect(m.get("78|2026-10-08").onlineMinutes).toBe(30);
    expect(m.get("78|2026-10-09").onlineMinutes).toBe(20);
  });
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**

```js
// src/utils/sessionDay.js
//
// "Online today" (spec §1): sessions clipped to the day, overlaps merged, each
// session ending at EndedAt or its last heartbeat. Approximate by design
// (heartbeat every 2 min) — the UI calls it "online", never "worked".

const { at, addDays, dateKey } = require("./workCalendar");

const t = (v) => (v == null ? null : new Date(v).getTime());

function sessionDay(sessions, key, now) {
  const start = at(key, 0).getTime();
  const end = Math.min(at(addDays(key, 1), 0).getTime(), now.getTime());
  const spans = [];
  const devices = new Set();
  let signIns = 0, last = null, open = false;
  for (const s of sessions) {
    const a = t(s.StartedAt);
    const b = Math.min(t(s.EndedAt) ?? Infinity, t(s.LastSeenAt) ?? a);
    if (b < start || a >= at(addDays(key, 1), 0).getTime()) continue;
    if (a >= start) signIns += 1;
    if (s.Device) devices.add(String(s.Device));
    if (!s.EndedAt) open = true;
    const seen = t(s.LastSeenAt);
    if (seen != null && (last == null || seen > last)) last = seen;
    const lo = Math.max(a, start), hi = Math.min(b, end);
    if (hi > lo) spans.push([lo, hi]);
  }
  spans.sort((x, y) => x[0] - y[0]);
  let ms = 0, curA = null, curB = null;
  for (const [a, b] of spans) {
    if (curB == null || a > curB) { if (curB != null) ms += curB - curA; curA = a; curB = b; }
    else curB = Math.max(curB, b);
  }
  if (curB != null) ms += curB - curA;
  return { onlineMinutes: Math.round(ms / 60000), signIns, devices: [...devices], lastSeenAt: last == null ? null : new Date(last), open };
}

function sessionsByUserDay(sessions, fromKey, toKey, now) {
  const byUser = new Map();
  for (const s of sessions) {
    const id = Number(s.UserId);
    if (!byUser.has(id)) byUser.set(id, []);
    byUser.get(id).push(s);
  }
  const out = new Map();
  for (const [id, list] of byUser) {
    for (let key = fromKey; key <= toKey; key = addDays(key, 1)) out.set(`${id}|${key}`, sessionDay(list, key, now));
  }
  return out;
}

module.exports = { sessionDay, sessionsByUserDay, dateKey };
```

- [ ] **Step 4: Run** with coverage on `src/utils/sessionDay.js` → PASS ≥80%.

### Task 4: Today endpoints — `services/todayData.js`, `todayController.js`, `todayRoutes.js`

**Files:**
- Create: `backend/src/services/todayData.js`, `backend/src/controllers/todayController.js`, `backend/src/routes/todayRoutes.js`
- Modify: `backend/src/config/routes.js` (register `/api/today`), `backend/src/controllers/tatController.js` (move `presenceFor` + the team-id lookup into `todayData`, import back; delete `fetchToday`/`fetchTeamToday` and their routes in Task 12 once the web stops calling them)
- Test: `backend/tests/unit/services/todayData.test.js`, `backend/tests/unit/controllers/todayController.test.js`, `backend/tests/unit/routes/todayRoutes.test.js`; `routeAccess.test.js` must pass unchanged.

**Interfaces:**
- Consumes: Task 2 `describeTask/countTasks/rankPeople`, Task 3 `sessionsByUserDay`, procs from Task 1, existing `presenceFor` logic, `visibleUserIds`, `calendarContext.load`.
- Produces (`services/todayData.js`):
  - `presenceFor(CompId, ids, key, now)` (moved verbatim from tatController)
  - `teamIds(req)` → `Promise<number[]>` — the caller's attendance reach, **excluding** the caller (moved from `fetchTeamToday`)
  - `loadDay({ CompId, ids, key, now, viewerId, includePersonal })` → `Promise<{ live, people: [{ ...presenceRow(with status), session: sessionDay, tasks: described[], counts }] }>` — `live = key === dateKey(now)`; calls `sp_FetchDayTasks`, `sp_FetchSessionsRange(key,key)`, `presenceFor`, `calendarContext.load(CompId, ids, key, key)` in parallel; PresenceExempt → `status = { code: "not_tracked", label: "Not tracked" }`.
- Produces (HTTP, all `POST`, `verifyToken, loadScope, open()`):
  - `/api/today/mine` `{ WorkDate? }` → `data: { day: { key, live }, me: person }` (personal tasks included)
  - `/api/today/team` `{ WorkDate? }` → `data: { day, people: person[] }` — `people[0]` is the caller (`isMe: true`), the rest `rankPeople`-ordered; tasks stripped from each person (counts only) to keep payload small
  - `/api/today/teamSize` `{}` → `data: { count }`
  - `/api/today/personTasks` `{ UserId, WorkDate?, Bucket }` → `data: { tasks: described[] }` filtered by `flags[Bucket]`; `Bucket` ∉ `BUCKETS` → 400; `UserId` neither caller nor in `teamIds` → 403; personal tasks only when `UserId` is the caller.
  - Bad `WorkDate` (not `YYYY-MM-DD`) → 400 "Date must be YYYY-MM-DD"; future date → 400 "Pick today or an earlier day".

- [ ] **Step 1: Failing controller tests** (DB mocked like `tatController.test.js`; copy its `jest.mock` setup for `database`, `calendarContext`, `workSettingsController`). Cases, each its own `it`:
  1. `mine` today: response `day.live === true`, `me.counts.open` equals described open rows, personal workspace row included (`sp_FetchDayTasks` called with `IncludePersonal: 1`, `UserIdsJson: "[<me>]"`, `ViewerId: <me>`).
  2. `mine` past day: `day.live === false`, `me.counts.overdue === null`, `me.counts.done` is a number.
  3. `team`: caller first with `isMe`, others ranked (overdue person before a clean one), `IncludePersonal: 0`, no `tasks` key on people.
  4. `team` with nobody in reach: `people` has only the caller.
  5. `teamSize`: `{ count: 2 }` when `visibleUserIds` allows two others.
  6. `personTasks` bucket `overdue` returns only overdue rows; bucket `bogus` → 400; out-of-reach user → 403; caller's own → includes personal; another user → `IncludePersonal: 0`.
  7. `WorkDate: "10-10-2026"` → 400; tomorrow → 400.
  8. PresenceExempt person → `status.code === "not_tracked"`.
  9. DB throws → 500 with code `TODAY_FETCH_ERROR`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `todayData.js` (move `presenceFor` + team lookup; add `loadDay` per the interface), `todayController.js` (four handlers via `asyncRoute`, messages "Your day fetched" / "Team day fetched" / "Team size fetched" / "Tasks fetched"), `todayRoutes.js`:

```js
const express = require("express");
const { verifyToken } = require("../middleware/auth");
const { loadScope, open } = require("../middleware/permission");
const { allowEmptyPayload, requirePayload } = require("../middleware/payloadValidation");
const c = require("../controllers/todayController");

const router = express.Router();
router.use(verifyToken, loadScope);
router.post("/mine", allowEmptyPayload, open(), c.mine);
router.post("/team", allowEmptyPayload, open(), c.team);
router.post("/teamSize", allowEmptyPayload, open(), c.teamSize);
router.post("/personTasks", requirePayload, open(), c.personTasks);
module.exports = router;
```
(check the real import paths of `verifyToken`/`open`/payload middlewares in `routes/tatRoutes.js` and copy them exactly). Register in `config/routes.js` next to `/api/tat`.
- [ ] **Step 4: Run** the three suites + `routeAccess.test.js`; coverage ≥80% on the three new files and `tatController.js`.

### Task 5: TAT report v2 + drill-down

**Files:**
- Modify: `backend/src/controllers/reportController.js` (the `tat` handler ~L151-172; add `tatClocks`), `backend/src/utils/reportKit.js` (GroupBy whitelist for `tat`: person|priority|workspace; new `TAT_METRICS`), `backend/src/routes/reportRoutes.js` (`/tatClocks`, same access declaration as `/tat`)
- Test: `backend/tests/unit/controllers/reportController.test.js`, `backend/tests/unit/utils/reportKit.test.js`, `backend/tests/unit/routes/reportRoutes.test.js`

**Interfaces — Produces:**
- `POST /api/reports/tat` → `data: { kpis: RS1, rows: RS2, trend: RS3, previous: RS4 }` (numbers as numbers; `OnTimePct`, `MedianUsedPct`, `P90UsedPct` `null` when the SP returns NULL).
- `POST /api/reports/tatClocks` `{ ...same filters, GroupBy, GroupKey?, Metric }` → `data: { clocks }`; `Metric` ∉ `TAT_METRICS` → 400; scope = same `visibleUserIds` list as `tat`.
- `TAT_METRICS = ["finished","ontime","missed","not_excused","excused","no_decision","reason_pending","overdue_now"]`.

- [ ] **Step 1: Failing tests:** (a) `tat` maps four recordsets to `{kpis, rows, trend, previous}`; (b) GroupBy `verdict_by` → 400; (c) empty result → `kpis.OnTimePct === null`, `kpis.Finished === 0`; (d) `tatClocks` passes `Metric`, `GroupKey`, scoped `UserIdsJson`; (e) bad Metric → 400; (f) out-of-scope `OwnerId` → `clocks: []` (same rule as `tat`: an out-of-scope owner yields no rows, never 403).
- [ ] **Step 2: Run** → FAIL. **Step 3:** implement (reuse the existing `tat` argument parsing; add `Metric`/`GroupKey` for `tatClocks`). **Step 4:** run, coverage ≥80% on touched files.

### Task 6: Attendance report v2

**Files:**
- Modify: `backend/src/controllers/attendanceReport.js`
- Test: `backend/tests/unit/controllers/attendanceReport.test.js`

**Interfaces — Produces:** `POST /api/reports/attendance` `{ FromDate, ToDate, BranchId?, OwnerId? }` (range ≤ 62 days else 400) →
`data: { kpis: { PresentPct, PresentDays, WorkingDays, LateCount, LateMinutesTotal, LateMinutesMedian, Absent, AbsentTop: [{FullName, days}], OnlineMedianMin, ShiftMedianMin }, days: ["YYYY-MM-DD"...], rows: [{ UserId, FullName, Present, WorkingDays, Late, LateMinutes, Absent, Leave, LeftEarly, OnlineMedianMin, ShiftMedianMin, LateStreak (bool), cells: [{ date, code, lateMin, onlineMin }] }] }`
`code` ∈ `on_time | late | absent | leave | half | on_duty | holiday | off | future | before_start`.

Rules (spec §2.4): today counts only after its shift end or once signed in; ½ leave = 0.5 working day and a late on a half day counts 1 late (late minutes as is) but never makes the day "absent"; `LeftEarly` = `SignedOutAt < ShiftEnd` and no open session that day (use `sessionDay(...).open`); `LateStreak` = 3 consecutive *working* days with `late`; online from `sp_FetchSessionsRange` + `sessionsByUserDay`.

- [ ] **Step 1: Failing tests** for the pure `summarise` (extend its input with `sessions`, `now`): one person, five days covering on_time / late 14 / absent / half / holiday; asserts each `cells[i].code`, `Present` = 3.5, `WorkingDays` = 4.5, `Late` = 1, `Absent` = 1; today before shift end is `future`-like (not counted); overlap sessions give the right `onlineMin`; three lates in a row → `LateStreak: true`; range 63 days → 400.
- [ ] **Step 2: Run** → FAIL. **Step 3:** implement; drop the old `trend` output (no longer drawn). **Step 4:** run, ≥80% on `attendanceReport.js`.

---

## Phase 3 — Web (Tasks 7 first; then 8–11 in parallel; 12 last)

Common: queries via `useApiQuery`; MSW handlers in each test; dates shown IST `HH:MM`; numbers zero → grey; every count is a `<button>` (accessible name e.g. "Overdue: 3") that opens `PersonTasksDrawer` / `ClocksDrawer`.

### Task 7: shared Today pieces — `api/todayQueries.js`, `todayWords.js`, `PersonTasksDrawer.jsx`

**Files:**
- Create: `web/src/api/todayQueries.js`, `web/src/pages/Today/todayWords.js`, `web/src/pages/Today/PersonTasksDrawer.jsx`
- Test: `web/src/api/todayQueries.test.js`, `web/src/pages/Today/todayWords.test.js`, `web/src/pages/Today/PersonTasksDrawer.test.jsx`

**Interfaces — Produces:**
- `TODAY = { mine: "/api/today/mine", team: "/api/today/team", teamSize: "/api/today/teamSize", personTasks: "/api/today/personTasks" }`.
- `todayWords.js`: `timeLeftText(min)` → `"1h 20m left" | "Overdue 2h 10m" | "Due now"`; `null` → `"No timer"`. `durationText(min)` → `"4h 10m" | "25m" | "0m"`. `taskChip(task)` → `{ label, tone: "red"|"amber"|"grey"|"blue"|"green" }` (missed+reason owed → red "Missed · 8 Oct"; overdue → red; atRisk → amber; onHold → blue "On hold · <reason>"; done → green "On time · HH:MM" or amber "Late · HH:MM"; else grey time-left). `presenceLine(person)` → the card line per spec §2.2. `BUCKET_LABELS` (given → "Given today", open → "Open", working → "Working on", done → "Done today", overdue → "Overdue", atRisk → "Close to deadline", toRule → "Waiting for your ruling", reasonOwed → "Waiting for reason", dueToday → "Due today", notStarted → "Not started", onHold → "On hold"). `TILES` = 7 tile defs `{ key, label, test(person) }` (in now / not signed in / late / leave-duty / overdue / atRisk / toRule).
- `<PersonTasksDrawer open userId name workDate bucket onClose />` → fetches `personTasks`, lists rows (title link `/tasks?taskId=`, board, `taskChip`, steps "3 of 5"), `EmptyState` "Nothing here".

- [ ] Steps: failing tests (each helper: all branches incl. null/0; drawer: loads, renders rows, empty state, close button) → run FAIL → implement with `ui/Drawer`, `ui/Chip`, `ui/EmptyState` → run PASS ≥80%.

### Task 8: Mine — `Today.jsx` shell + `MyDay.jsx`

**Files:**
- Create: `web/src/pages/Today/MyDay.jsx`; Modify: `web/src/pages/Today/Today.jsx` (tabs Mine / My team in URL `?tab=`, team tab shown when `teamSize.count > 0`; drop the full-team fetch)
- Test: `web/src/pages/Today/MyDay.test.jsx`, update `web/src/pages/Today/Today.test.jsx`

**Interfaces:** consumes Task 7; existing `BreachReasonDialog` (task detail) for *Explain delay*, `/api/tat/acknowledge` for *Accept*.

Layout = mockup artboard 1 (spec §2.1): greeting, strip of 5 cells, "Needs you now" (hidden when empty), two-column Due today | Working on, two-column Not started | Done today.

- [ ] Steps: failing tests — strip shows "Late 12m" chip and "4h 10m" online; Needs-you-now orders reason-owed > overdue > atRisk; Explain delay opens dialog; Accept posts `acknowledge` with `TatId` and refetches; Accept hidden for a task without a clock; a personal task with an overdue due date appears (regression for "Nothing due"); empty day shows each section's empty line and no Needs-you-now box; Today hides My team tab when `count: 0`. → FAIL → implement → PASS ≥80%.

### Task 9: My team — `TeamDay.jsx`, `TeamTiles.jsx`, `PersonCard.jsx`

**Files:**
- Create: `web/src/pages/Today/TeamDay.jsx`, `TeamTiles.jsx`, `PersonCard.jsx`; Delete: `web/src/pages/Today/TeamToday.jsx` (after its row actions move into `PersonCard`)
- Test: `TeamDay.test.jsx`, `TeamTiles.test.jsx`, `PersonCard.test.jsx`

Layout = mockup artboard 2 (spec §2.2). Day picker (`ui/DateField`, max today). Tiles filter (click again clears). Cards / Table switch (localStorage key `today.teamView`, wrapped in try/catch; default table when > 24 people; table = `ReportTable` with the same columns as the card numbers). Card: avatar + dot, name, job · office, status pill, presence line, six number buttons, red missed box with **Rule** (opens the existing verdict UI for that clock — reuse the task detail's verdict dialog component; if it is inline-only, open the task at its Deadline tab `/tasks?taskId=&tab=tat`), row actions Leave/on duty (DayMarkDialog) + Sign-ins (admin, not own card). Own card first with "You".

- [ ] Steps: failing tests — caller card first labelled You; tile "Overdue" filters to people with overdue > 0, second click restores; number click opens drawer with that bucket; past day shows "Live counts only for today" and greys live numbers as "—"; PresenceExempt shows "Not tracked"; Cards/Table switch persists and survives `localStorage` throwing; DayMarkDialog/SessionsDialog still open from a card. → FAIL → implement → PASS ≥80%.

### Task 10: Task deadlines report page

**Files:**
- Modify (rewrite): `web/src/pages/Reports/TatReport.jsx`; Create: `web/src/pages/Reports/ClocksDrawer.jsx`
- Test: `web/src/pages/Reports/TatReport.test.jsx`, `ClocksDrawer.test.jsx`; adjust `TeamReports.test.jsx` for the TAT parts

Layout = mockup artboard 3 (spec §2.3). Reuse ReportPage's filter bar pieces (presets, office, person, group by person/priority/board) — extract the filter bar from `ReportPage.jsx` into `ReportFilters.jsx` if it is not already separable, keeping `ReportPage` behaviour and its tests green. KPI cards, weekly/daily bars (div bars like the mockup, numeric heights in rem), table with bar + %, every number → `ClocksDrawer` (`/api/reports/tatClocks` with Metric + GroupKey). Export CSV kept.

- [ ] Steps: failing tests — "87%" + "40 of 46 finished"; `OnTimePct: null` → "—" and "0 finished"; missed split three lines; previous-period line; table sorted as returned; clicking Not excused for a row calls tatClocks with `Metric: "not_excused", GroupKey`; drawer lists reason + decision. → FAIL → implement → PASS ≥80%.

### Task 11: Attendance report page

**Files:**
- Modify (rewrite): `web/src/pages/Reports/AttendanceReport.jsx`; Create: `web/src/pages/Reports/AttendanceGrid.jsx`
- Test: `AttendanceReport.test.jsx`, `AttendanceGrid.test.jsx`; adjust `TeamReports.test.jsx`

Layout = mockup artboard 4 (spec §2.4). Month picker (default current month) + custom ≤ 62 days, office, person. KPI cards; legend; grid with sticky name column in an `overflow-x: auto` box; codes → cell words (✓, minutes, A, LV, ½, OD, HO, –, blank); totals; red dot on name when `LateStreak`; cell click opens `SessionsDialog` for that user and date (extend `SessionsDialog` with an optional `date` prop that filters rows client-side).

- [ ] Steps: failing tests — each code renders its word and accessible label ("Late 14 minutes"); totals; streak dot; cell click opens sessions for that date; 63-day custom range shows the validation message and does not fetch. → FAIL → implement → PASS ≥80%.

### Task 12: Clean-up, help text, full verification

**Files:**
- Modify: `web/src/data/helpGuides.js` (`today`, `tat`, attendance guides to the new words, EN + HI), `backend/src/controllers/tatController.js` + `routes/tatRoutes.js` (delete `fetchToday`, `fetchTeamToday` and their tests), `CLAUDE.md` §6 Presence/TAT reports paragraph (one line: Today = `/api/today/*`, buckets defined in `utils/dayBuckets.js`).
- [ ] `grep -rn "fetchToday\|fetchTeamToday" web/src backend/src mobile/src` → nothing left.
- [ ] `cd backend && pnpm exec jest --silent --coverage` → green; touched files ≥80%.
- [ ] `cd web && pnpm exec vitest run --coverage` → green; touched files ≥80%.
- [ ] Live check on TestCRM (dev server against `https://shadowcodes.in/TestCRM` after the backend is deployed by the user): Mine and My team for Kavya Nair / Priya Singh match hand counts from `sp_FetchDayTasks`.
- [ ] Leave everything uncommitted; report to the user.
