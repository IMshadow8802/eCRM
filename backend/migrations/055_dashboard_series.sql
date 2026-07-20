-- 055_dashboard_series.sql
-- Extend sp_Dashboard with the chart series the Dashboard page needs, so the
-- big charts stop rendering their demo fallbacks when real data exists.
--
-- Result set 0 (UNCHANGED contract): KPI rows of Type / Number
--   (TotalLeads, TodayNewLeads, TodayFollowups, MissedFollowups).
-- New result sets (all filtered by @CompId + the same branch-scope JSON the
-- KPIs already use):
--   RS1  LeadsTrend        : Name (Mon..Sun), Date, Leads, Converted — last 7 days incl. today
--   RS2  LeadsBySource     : Name, Value — top 5 sources by lead count + 'Other'
--   RS3  Funnel            : Name, Value, SortOrder — live lead count per active
--                            stage of the default 'lead' pipeline
--   RS4  TeamLoad          : Name, Value — open (not won/lost) leads per active
--                            owner, top 5 busiest
--   RS5  QuarterlyActivity : Name (Q1..Q4), Leads, Calls, Tickets — created this year
--                            (calls scoped via their linked lead/ticket branch,
--                            mirroring sp_CallsPerUser; tblCall has no BranchId)
--
-- APPLY BY HAND (CREATE OR ALTER — idempotent). Verify snippet at the bottom.

CREATE OR ALTER PROCEDURE sp_Dashboard
    @CompId BIGINT,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @BranchIds TABLE (BranchId BIGINT);
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
        INSERT INTO @BranchIds (BranchId)
        SELECT CAST(value AS BIGINT) FROM OPENJSON(@AccessibleBranchIdsJson);
    DECLARE @UseScope BIT = CASE WHEN @AccessibleBranchIdsJson IS NULL OR @AccessibleBranchIdsJson = '' THEN 0 ELSE 1 END;

    /* ------------------------------------------------------------------ */
    /* RS0 — KPI rows (existing contract, unchanged)                       */
    /* ------------------------------------------------------------------ */
    SELECT 'TotalLeads' AS Type, COUNT(*) AS Number
    FROM tblLeads
    WHERE CompId = @CompId
      AND (@UseScope = 0 OR BranchId IN (SELECT BranchId FROM @BranchIds))

    UNION ALL

    SELECT 'TodayNewLeads' AS Type, COUNT(*) AS Number
    FROM tblLeads
    WHERE CompId = @CompId
      AND (@UseScope = 0 OR BranchId IN (SELECT BranchId FROM @BranchIds))
      AND CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE)

    UNION ALL

    SELECT 'TodayFollowups' AS Type, COUNT(*) AS Number
    FROM tblLeads
    WHERE CompId = @CompId
      AND (@UseScope = 0 OR BranchId IN (SELECT BranchId FROM @BranchIds))
      AND CAST(NextFollowupDate AS DATE) = CAST(GETDATE() AS DATE)
      AND WonAt IS NULL

    UNION ALL

    SELECT 'MissedFollowups' AS Type, COUNT(*) AS Number
    FROM tblLeads
    WHERE CompId = @CompId
      AND (@UseScope = 0 OR BranchId IN (SELECT BranchId FROM @BranchIds))
      AND NextFollowupDate < CAST(GETDATE() AS DATE)
      AND NextFollowupDate IS NOT NULL
      AND WonAt IS NULL
      AND LostAt IS NULL;

    /* ------------------------------------------------------------------ */
    /* RS1 — leads per day, last 7 days (new leads + conversions per day)  */
    /* ------------------------------------------------------------------ */
    ;WITH days AS (
        SELECT DATEADD(DAY, -v.n, CAST(GETDATE() AS DATE)) AS D
        FROM (VALUES (6),(5),(4),(3),(2),(1),(0)) v(n)
    )
    SELECT LEFT(DATENAME(WEEKDAY, d.D), 3) AS Name,
           d.D AS [Date],
           (SELECT COUNT(*) FROM tblLeads l
             WHERE l.CompId = @CompId
               AND (@UseScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
               AND CAST(l.CreatedAt AS DATE) = d.D) AS Leads,
           (SELECT COUNT(*) FROM tblLeads l
             WHERE l.CompId = @CompId
               AND (@UseScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
               AND CAST(l.WonAt AS DATE) = d.D) AS Converted
    FROM days d
    ORDER BY d.D;

    /* ------------------------------------------------------------------ */
    /* RS2 — leads by source, top 5 + 'Other'                              */
    /* ------------------------------------------------------------------ */
    ;WITH src AS (
        SELECT ISNULL(lk.Value, N'Unknown') AS Name,
               COUNT(*) AS Value,
               ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC) AS rn
        FROM tblLeads l
        LEFT JOIN tblLookup lk ON lk.Id = l.SourceId AND lk.CompId = l.CompId
        WHERE l.CompId = @CompId
          AND (@UseScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
        GROUP BY ISNULL(lk.Value, N'Unknown')
    )
    SELECT x.Name, x.Value
    FROM (
        SELECT Name, Value, rn FROM src WHERE rn <= 5
        UNION ALL
        SELECT N'Other', SUM(Value), 6 FROM src WHERE rn > 5 HAVING SUM(Value) > 0
    ) x
    ORDER BY x.rn;

    /* ------------------------------------------------------------------ */
    /* RS3 — funnel: live lead count per stage of the default lead pipeline */
    /* ------------------------------------------------------------------ */
    DECLARE @LeadPipelineId INT = (
        SELECT TOP 1 Id FROM tblPipeline
        WHERE CompId = @CompId AND Entity = 'lead' AND IsActive = 1
        ORDER BY IsDefault DESC, Id);

    SELECT s.Name AS Name,
           COUNT(l.Id) AS Value,
           s.SortOrder
    FROM tblPipelineStage s
    LEFT JOIN tblLeads l
           ON l.StageId = s.Id AND l.CompId = @CompId
          AND (@UseScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
    WHERE s.CompId = @CompId AND s.PipelineId = @LeadPipelineId AND s.IsActive = 1
    GROUP BY s.Id, s.Name, s.SortOrder
    ORDER BY s.SortOrder;

    /* ------------------------------------------------------------------ */
    /* RS4 — team load: open leads per active owner (top 5 busiest)        */
    /* ------------------------------------------------------------------ */
    SELECT TOP 5 u.FullName AS Name, COUNT(*) AS Value
    FROM tblLeads l
    JOIN tblUser u ON u.Id = l.OwnerId AND u.IsActive = 1
    WHERE l.CompId = @CompId
      AND l.WonAt IS NULL AND l.LostAt IS NULL
      AND (@UseScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
    GROUP BY u.Id, u.FullName
    ORDER BY Value DESC;

    /* ------------------------------------------------------------------ */
    /* RS5 — activity per quarter, current year (leads/calls/tickets made) */
    /* ------------------------------------------------------------------ */
    ;WITH q AS (SELECT v.n FROM (VALUES (1),(2),(3),(4)) v(n))
    SELECT 'Q' + CAST(q.n AS VARCHAR(1)) AS Name,
           (SELECT COUNT(*) FROM tblLeads l
             WHERE l.CompId = @CompId
               AND (@UseScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
               AND YEAR(l.CreatedAt) = YEAR(GETDATE())
               AND DATEPART(QUARTER, l.CreatedAt) = q.n) AS Leads,
           (SELECT COUNT(*) FROM tblCall c
             WHERE c.CompId = @CompId
               AND YEAR(c.CalledAt) = YEAR(GETDATE())
               AND DATEPART(QUARTER, c.CalledAt) = q.n
               AND (@UseScope = 0
                    OR EXISTS (SELECT 1 FROM tblLeads bl
                               WHERE bl.Id = c.LeadId
                                 AND bl.BranchId IN (SELECT BranchId FROM @BranchIds))
                    OR EXISTS (SELECT 1 FROM tblTicket bt
                               WHERE bt.Id = c.TicketId
                                 AND bt.BranchId IN (SELECT BranchId FROM @BranchIds)))) AS Calls,
           (SELECT COUNT(*) FROM tblTicket t
             WHERE t.CompId = @CompId
               AND (@UseScope = 0 OR t.BranchId IN (SELECT BranchId FROM @BranchIds))
               AND YEAR(t.CreatedAt) = YEAR(GETDATE())
               AND DATEPART(QUARTER, t.CreatedAt) = q.n) AS Tickets
    FROM q
    ORDER BY q.n;
END
GO

/* ---------------------------------------------------------------------- */
/* VERIFY AFTER APPLY — expect 6 result sets: KPI rows, 7 trend rows,      */
/* source rows, funnel stage rows, up to 5 team-load rows, 4 quarter rows. */
/* ---------------------------------------------------------------------- */
BEGIN TRAN;
EXEC sp_Dashboard @CompId = 1, @AccessibleBranchIdsJson = NULL;
ROLLBACK;
