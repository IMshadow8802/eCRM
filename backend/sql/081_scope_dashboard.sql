-- ===========================================================================
-- 081_scope_dashboard.sql
--
-- Closes the last cross-scope leak from the 2026-09-13 security audit — the
-- one 080 deliberately deferred (see its header).
--
-- SYMPTOM (measured against production, body literally `{}`)
--   sp_Dashboard takes (@CompId, @AccessibleBranchIdsJson): branch scope and
--   NO owner axis. A Self-scope rep therefore gets their whole branch on
--   every KPI, every chart.
--
--     se_se_pooja     (21, Self, branch 2)  TotalLeads 222  -> should be 133
--     se_ho_amit      (17, Self, branch 1)  TotalLeads 269  -> should be 125
--     demo_se_ip_isha (25, Self, branch 3)  TotalLeads 128  -> should be  43
--
--   222 is exactly `SELECT COUNT(*) FROM tblLeads WHERE CompId=1 AND
--   BranchId=2` — the branch total. /api/reports/funnel, which carries the
--   full scope contract, already returns 133 for the same user, so the
--   dashboard and the report on the next tab disagree about the same rep.
--
-- FIX
--   Gain @UserId + @OwnerIdsJson and apply the owner axis per entity. Every
--   predicate is copied verbatim from the live proc that owns that entity,
--   so a dashboard number equals the list it drills into:
--     leads      -> sp_FetchLeads             (owner axis l.OwnerId)
--     follow-ups -> sp_RptFollowUpCompliance  (lead scope, widened by
--                                              f.AssignedTo — a rep's own
--                                              follow-up on someone else's
--                                              lead is still his work)
--     tickets    -> sp_FetchTickets           (owner axis t.AssignedTo)
--   The assigned-or-created escape hatch stays OR-ed, never AND-ed.
--
-- WHAT DOES NOT CHANGE
--   * The result-set contract: RS0 KPIs, RS1 7-day trend, RS2 sources,
--     RS3 funnel, RS4 team load, RS5 quarterly. Same columns, same order.
--   * The counting logic — active = status Code in (open, qualified),
--     follow-up KPIs read tblFollowUp, RS5 calls = done call follow-ups plus
--     ticket calls. Only the visibility predicate moved.
--   * TASKS. sp_Dashboard counts no tasks at all (tblTask is not referenced;
--     it reads tblLeads, tblFollowUp, tblTicket, tblCall, tblLookup, tblUser)
--     so there is nothing here to scope. That is the correct outcome anyway:
--     CLAUDE.md section 6 — tasks are membership-governed, not scope-governed,
--     and AND-ing branch scope onto membership is the bug that once blinded
--     cross-branch workspace members in sp_FetchTask. If a task KPI is ever
--     added to this proc it must go through workspace membership, NOT through
--     @BranchIds/@OwnerIds.
--   * Company/All scopes. They pass @OwnerIdsJson = NULL, which leaves
--     @UseOwnerScope = 0 and every predicate exactly as it is today.
--
-- `[]` vs NULL is load-bearing and preserved: NULL/'' = no filter on that
-- dimension; '[]' = an empty allow-list = match nothing (fail closed). The
-- controller serialises it that way on purpose (permission.js scopeJson).
--
-- DEPLOY ORDER: apply this script FIRST, then deploy the backend. The
-- matching reportController.getDashboard change sends the two new params;
-- a backend that ships ahead of this script makes every dashboard call fail
-- with "procedure has too many arguments specified".
-- ===========================================================================
SET NOCOUNT ON;
GO

CREATE OR ALTER PROCEDURE dbo.sp_Dashboard
    @CompId                  BIGINT,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @UserId                  INT           = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @BranchIds TABLE (BranchId BIGINT PRIMARY KEY);
    DECLARE @OwnerIds  TABLE (OwnerId  BIGINT PRIMARY KEY);
    DECLARE @UseBranchScope BIT = 0, @UseOwnerScope BIT = 0;

    IF (@AccessibleBranchIdsJson IS NOT NULL AND LTRIM(RTRIM(@AccessibleBranchIdsJson)) <> '')
    BEGIN
        INSERT INTO @BranchIds (BranchId)
        SELECT DISTINCT CAST(value AS BIGINT) FROM OPENJSON(@AccessibleBranchIdsJson);
        SET @UseBranchScope = 1;
    END

    IF (@OwnerIdsJson IS NOT NULL AND LTRIM(RTRIM(@OwnerIdsJson)) <> '')
    BEGIN
        INSERT INTO @OwnerIds (OwnerId)
        SELECT DISTINCT CAST(value AS BIGINT) FROM OPENJSON(@OwnerIdsJson);
        SET @UseOwnerScope = 1;
    END

    DECLARE @Today DATETIME = CAST(CAST(GETDATE() AS DATE) AS DATETIME);

    /* RS0 — KPI rows */
    SELECT 'TotalLeads' AS Type, COUNT(*) AS Number
    FROM tblLeads l
    WHERE l.CompId = @CompId
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))
          )

    UNION ALL

    SELECT 'TodayNewLeads', COUNT(*)
    FROM tblLeads l
    WHERE l.CompId = @CompId
      AND CAST(l.CreatedAt AS DATE) = CAST(GETDATE() AS DATE)
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))
          )

    UNION ALL

    SELECT 'TodayFollowups', COUNT(*)
    FROM tblFollowUp f
    JOIN tblLeads l ON l.Id = f.LeadId AND l.CompId = f.CompId
    JOIN tblLookup st ON st.Id = l.StatusId
    WHERE f.CompId = @CompId AND f.Status = 'open'
      AND CAST(f.DueAt AS DATE) = CAST(GETDATE() AS DATE)
      AND st.Code IN ('open','qualified')
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId IN (SELECT OwnerId FROM @OwnerIds) OR f.AssignedTo IN (SELECT OwnerId FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId OR f.AssignedTo = @UserId))
          )

    UNION ALL

    SELECT 'MissedFollowups', COUNT(*)
    FROM tblFollowUp f
    JOIN tblLeads l ON l.Id = f.LeadId AND l.CompId = f.CompId
    JOIN tblLookup st ON st.Id = l.StatusId
    WHERE f.CompId = @CompId AND f.Status = 'open'
      AND f.DueAt < @Today
      AND st.Code IN ('open','qualified')
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId IN (SELECT OwnerId FROM @OwnerIds) OR f.AssignedTo IN (SELECT OwnerId FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId OR f.AssignedTo = @UserId))
          );

    /* RS1 — leads per day, last 7 days */
    ;WITH days AS (
        SELECT DATEADD(DAY, -v.n, CAST(GETDATE() AS DATE)) AS D
        FROM (VALUES (6),(5),(4),(3),(2),(1),(0)) v(n)
    )
    SELECT LEFT(DATENAME(WEEKDAY, d.D), 3) AS Name,
           d.D AS [Date],
           (SELECT COUNT(*) FROM tblLeads l
             WHERE l.CompId = @CompId
               AND CAST(l.CreatedAt AS DATE) = d.D
               AND (
                     (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
                      AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
                  OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))
                   )) AS Leads,
           (SELECT COUNT(*) FROM tblLeads l
             WHERE l.CompId = @CompId
               AND CAST(l.WonAt AS DATE) = d.D
               AND (
                     (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
                      AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
                  OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))
                   )) AS Converted
    FROM days d
    ORDER BY d.D;

    /* RS2 — leads by source, top 5 + Other */
    ;WITH src AS (
        SELECT ISNULL(lk.Value, N'Unknown') AS Name,
               COUNT(*) AS Value,
               ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC) AS rn
        FROM tblLeads l
        LEFT JOIN tblLookup lk ON lk.Id = l.SourceId AND lk.CompId = l.CompId
        WHERE l.CompId = @CompId
          AND (
                (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
                 AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
             OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))
              )
        GROUP BY ISNULL(lk.Value, N'Unknown')
    )
    SELECT x.Name, x.Value
    FROM (
        SELECT Name, Value, rn FROM src WHERE rn <= 5
        UNION ALL
        SELECT N'Other', SUM(Value), 6 FROM src WHERE rn > 5 HAVING SUM(Value) > 0
    ) x
    ORDER BY x.rn;

    /* RS3 — funnel: leads per status (scope lives in the LEFT JOIN's ON, so
       an out-of-scope lead drops out without dropping the status row) */
    SELECT st.Value AS Name, COUNT(l.Id) AS Value, st.SortOrder
    FROM tblLookup st
    LEFT JOIN tblLeads l
           ON l.StatusId = st.Id AND l.CompId = @CompId
          AND (
                (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
                 AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
             OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))
              )
    WHERE st.CompId = @CompId AND st.Kind = 'lead_status' AND st.IsActive = 1
    GROUP BY st.Id, st.Value, st.SortOrder
    ORDER BY st.SortOrder;

    /* RS4 — team load: active leads per owner, top 5 */
    SELECT TOP 5 u.FullName AS Name, COUNT(*) AS Value
    FROM tblLeads l
    JOIN tblUser u ON u.Id = l.OwnerId AND u.IsActive = 1
    JOIN tblLookup st ON st.Id = l.StatusId
    WHERE l.CompId = @CompId
      AND st.Code IN ('open','qualified')
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))
          )
    GROUP BY u.Id, u.FullName
    ORDER BY Value DESC;

    /* RS5 — activity per quarter, current year */
    ;WITH q AS (SELECT v.n FROM (VALUES (1),(2),(3),(4)) v(n))
    SELECT 'Q' + CAST(q.n AS VARCHAR(1)) AS Name,
           (SELECT COUNT(*) FROM tblLeads l
             WHERE l.CompId = @CompId
               AND YEAR(l.CreatedAt) = YEAR(GETDATE())
               AND DATEPART(QUARTER, l.CreatedAt) = q.n
               AND (
                     (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
                      AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
                  OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))
                   )) AS Leads,
           (SELECT COUNT(*) FROM tblFollowUp f
              JOIN tblLeads bl ON bl.Id = f.LeadId AND bl.CompId = f.CompId
             WHERE f.CompId = @CompId AND f.Type = 'call' AND f.Status = 'done'
               AND YEAR(f.DoneAt) = YEAR(GETDATE())
               AND DATEPART(QUARTER, f.DoneAt) = q.n
               AND (
                     (    (@UseBranchScope = 0 OR bl.BranchId IN (SELECT BranchId FROM @BranchIds))
                      AND (@UseOwnerScope  = 0 OR bl.OwnerId IN (SELECT OwnerId FROM @OwnerIds) OR f.AssignedTo IN (SELECT OwnerId FROM @OwnerIds)) )
                  OR (@UserId IS NOT NULL AND (bl.OwnerId = @UserId OR bl.CreatedBy = @UserId OR f.AssignedTo = @UserId))
                   ))
           + (SELECT COUNT(*) FROM tblCall c
               JOIN tblTicket bt ON bt.Id = c.TicketId AND bt.CompId = c.CompId
              WHERE c.CompId = @CompId
                AND YEAR(c.CalledAt) = YEAR(GETDATE())
                AND DATEPART(QUARTER, c.CalledAt) = q.n
                AND (
                      (    (@UseBranchScope = 0 OR bt.BranchId   IN (SELECT BranchId FROM @BranchIds))
                       AND (@UseOwnerScope  = 0 OR bt.AssignedTo IN (SELECT OwnerId  FROM @OwnerIds)) )
                   OR (@UserId IS NOT NULL AND (bt.AssignedTo = @UserId OR bt.CreatedBy = @UserId))
                    )) AS Calls,
           (SELECT COUNT(*) FROM tblTicket t
             WHERE t.CompId = @CompId
               AND YEAR(t.CreatedAt) = YEAR(GETDATE())
               AND DATEPART(QUARTER, t.CreatedAt) = q.n
               AND (
                     (    (@UseBranchScope = 0 OR t.BranchId   IN (SELECT BranchId FROM @BranchIds))
                      AND (@UseOwnerScope  = 0 OR t.AssignedTo IN (SELECT OwnerId  FROM @OwnerIds)) )
                  OR (@UserId IS NOT NULL AND (t.AssignedTo = @UserId OR t.CreatedBy = @UserId))
                   )) AS Tickets
    FROM q
    ORDER BY q.n;
END
GO

-- ===========================================================================
-- VERIFY AFTER APPLY  (read-only; safe to re-run)
--
--   1. se_se_pooja (21, Self, branch 2) — RS0 TotalLeads must read 133.
--      Before this script she saw 222, the whole of branch 2. 133 is what
--      /api/reports/funnel already returns for her, and equals
--        SELECT COUNT(*) FROM tblLeads WHERE CompId=1
--          AND ((BranchId IN (2) AND OwnerId IN (21)) OR OwnerId=21 OR CreatedBy=21)
--
--   2. sh_priya (13, Company, @OwnerIdsJson = NULL) — TotalLeads must read
--      619, i.e. unchanged. This is the @UseOwnerScope = 0 proof: a NULL
--      owner list must leave the wide scopes exactly as they were.
--
--   3. Fail-closed proof: '[]' is an empty allow-list, not "no filter".
--      TotalLeads must be 0, NOT 619.
-- ===========================================================================
PRINT 'Pooja (21, Self, branch 2) -- expect RS0 TotalLeads = 133 (was 222):';
EXEC dbo.sp_Dashboard @CompId = 1, @UserId = 21,
     @AccessibleBranchIdsJson = N'[2]', @OwnerIdsJson = N'[21]';

PRINT 'Priya (13, Company) -- expect RS0 TotalLeads = 619, unchanged:';
EXEC dbo.sp_Dashboard @CompId = 1, @UserId = 13,
     @AccessibleBranchIdsJson = N'[1,2,3,4,5]', @OwnerIdsJson = NULL;

PRINT 'Empty allow-list, no user -- expect RS0 TotalLeads = 0 (fail closed):';
EXEC dbo.sp_Dashboard @CompId = 1, @UserId = NULL,
     @AccessibleBranchIdsJson = N'[]', @OwnerIdsJson = N'[]';
GO
