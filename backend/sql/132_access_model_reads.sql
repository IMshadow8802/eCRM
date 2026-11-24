-- ===========================================================================
-- 132 - access model: the reads. Every list, detail, count and report
--       procedure re-pointed to the 131 definitions; the new Logged-by-me list.
--       (spec docs/superpowers/specs/2026-11-21-access-model/design.md
--        sections 2.5, 3.1-3.4, 3.6, 8, 9 F2/F3/F4/F6/F24, 10, 11 SQL 4/5/9;
--        plan 2026-11-22-access-model Task 4, Ruling 7 (N2);
--        pre-flight S4, S6, S13, S18; decision D8)
--
-- Apply by hand:  sqlcmd -I -b ... -i 132_access_model_reads.sql
--   -I = QUOTED_IDENTIFIER ON (093 lesson), -b = stop at the first error.
-- Needs 131 on the same database; 132 refuses otherwise (and SETs NOEXEC ON).
-- 131-134 are applied in one sitting (plan Ruling 1).
--
-- Every object below is first saved into dbo.tblAccessModelBackup through
-- dbo.sp_AccessModelBackup (first save wins; sp_FetchLoggedByMe is new, its
-- Definition is NULL, so 135 drops it). Each object is replaced whole from
-- its live text (TestCRM 2026-11-22; 129's two procs from the 129 text, which
-- 130 requires on the database), swapping only the visibility predicate for a
-- join to the matching 131 definition, worked out ONCE per call into a temp
-- table, plus the output changes listed here. Filters (@BranchId, @OwnerId,
-- @AssignedTo, status, dates, search) stay and only narrow.
--
-- The rule is not restated anywhere in this script:
--   lists / counts      -> fn_VisibleTickets / fn_VisibleLeads / fn_VisibleFollowUps
--   one record (detail) -> fn_RecordActions (CanEdit, CanReassign, CanReopen,
--                          SendBackToId; 0 rows = not visible; pre-flight S6;
--                          never used per row in a list - it builds the
--                          caller's whole visible set on every call)
--   report people       -> fn_ReportTree
--
-- Signatures after 132 (list parameters gone; @UserId has NO default, N1a;
-- every other parameter and output column unchanged unless noted):
--   sp_FetchTickets        - @AccessibleBranchIdsJson, @OwnerIdsJson, @EscalatedSubtreeJson
--                            gone. LinkedLeadId NULL unless the lead is visible.
--                            Escalated preset: in progress AND (EscalatedTo = me
--                            OR overdue AND AssignedTo IN fn_AccessPeople).
--   sp_FetchTicketDetail   @CompId, @TicketId, @UserId. No rows when not visible.
--                            RS1 + CanEdit, CanReassign, CanReopen, SendBackToId,
--                            SendBackToName; LinkedLeadId gated (and RS5);
--                            PreviousTickets counts visible complaints only.
--   sp_FetchLeads          - the two JSON lists gone.
--   sp_FetchLeadDetail     @CompId, @LeadId, @UserId. No rows when not visible.
--                            RS1 + CanEdit, CanReassign, SendBackToId, SendBackToName.
--   sp_FetchFollowUps      - the two JSON lists gone. + Via (last column before
--                            ResponseCode). Via 2: lead columns only name,
--                            company, mobile, OwnerName; Via 3 the same with
--                            mobile NULL. @LeadId > 0 needs the lead visible.
--   sp_FetchFollowUpLead   @CompId, @Id, @UserId. No rows unless in
--                            fn_VisibleFollowUps; + Via, CanAct.
--   sp_FetchQuotations     - the two JSON lists gone.
--   sp_FetchQuotationDetail @CompId, @QuotationId, @UserId. No rows unless its
--                            lead is visible; RS1 + CanEdit.
--   sp_FetchCustomers      keeps its customers lists; @UserId loses its
--                            default; Open / Total / LastTicketAt count
--                            fn_VisibleTickets only (F4).
--   sp_FetchCustomerDetail @CompId, @CustomerId, @UserId (the two lists were the
--                            complaints scope). RS1 counts + RS2 list from
--                            fn_VisibleTickets (F3, F4, F6).
--   sp_Dashboard           @CompId, @UserId. Lead figures fn_VisibleLeads,
--                            complaint figures fn_VisibleTickets, follow-up
--                            counts fn_VisibleFollowUps Via 1/2, lead calls by
--                            the 3.6 activity rule (F6).
--   sp_TicketsByCategory, sp_ResolutionSummary  @CompId, @BranchId, @UserId.
--   fn_SalesReportRows     (@CompId, @From, @ToEx, @UserId). Record families
--                            only on visible leads; activity families when the
--                            lead is visible OR the person credited is in
--                            fn_ReportTree; CanOpen = lead visible.
--   sp_RptSales            - the two JSON lists gone; Ruling 7 when @BranchId /
--                            @SourceId / @ProductId is set or @GroupBy = 'source'.
--   sp_RptSalesRows        - the two JSON lists gone; rows only where
--                            CanOpen = 1; Total still = the summary cell
--                            (rows + HiddenCount); money totals from returned
--                            rows only; a LAST recordset HiddenCount INT (only
--                            when @MaxRows > 0, so @MaxRows = 0 stays one set).
--   sp_FetchLoggedByMe     (new) @CompId BIGINT, @UserId INT,
--                            @SearchTerm NVARCHAR(100) = NULL, @PageNumber INT = 1,
--                            @PageSize INT = 25. RS1: Id (NULL when CanOpen = 0),
--                            TicketNo, CreatedAt, CustomerName, Subject,
--                            StatusName, StatusCode, AssignedToName, DueAt,
--                            IsOverdue, ClosedOn, CanOpen. RS2 pagination.
--
-- sqlcmd splits on GO even inside comments: every note is a `--` line comment.
-- ===========================================================================
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- ---------------------------------------------------------------------------
-- 1. Refuse unless 131 is applied (S18).
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.sp_AccessModelBackup', 'P') IS NULL
   OR OBJECT_ID('dbo.fn_AccessScope', 'IF') IS NULL
   OR OBJECT_ID('dbo.fn_AccessPeople', 'TF') IS NULL
   OR OBJECT_ID('dbo.fn_VisibleLeads', 'TF') IS NULL
   OR OBJECT_ID('dbo.fn_VisibleTickets', 'TF') IS NULL
   OR OBJECT_ID('dbo.fn_VisibleFollowUps', 'TF') IS NULL
   OR OBJECT_ID('dbo.fn_RecordActions', 'IF') IS NULL
   OR (SELECT COUNT(*) FROM sys.parameters
       WHERE object_id = OBJECT_ID('dbo.fn_ReportTree') AND parameter_id > 0) <> 2
BEGIN
    RAISERROR('132: script 131 is not applied to this database. Apply 131 first. Nothing was changed.', 16, 1);
    SET NOEXEC ON;
END
GO

-- ---------------------------------------------------------------------------
-- 2. Back up every object this script creates or replaces (first save wins).
-- ---------------------------------------------------------------------------
EXEC dbo.sp_AccessModelBackup 132, 'fn_SalesReportRows';
EXEC dbo.sp_AccessModelBackup 132, 'sp_RptSales';
EXEC dbo.sp_AccessModelBackup 132, 'sp_RptSalesRows';
EXEC dbo.sp_AccessModelBackup 132, 'sp_FetchTickets';
EXEC dbo.sp_AccessModelBackup 132, 'sp_FetchTicketDetail';
EXEC dbo.sp_AccessModelBackup 132, 'sp_FetchLeads';
EXEC dbo.sp_AccessModelBackup 132, 'sp_FetchLeadDetail';
EXEC dbo.sp_AccessModelBackup 132, 'sp_FetchFollowUps';
EXEC dbo.sp_AccessModelBackup 132, 'sp_FetchFollowUpLead';
EXEC dbo.sp_AccessModelBackup 132, 'sp_FetchQuotations';
EXEC dbo.sp_AccessModelBackup 132, 'sp_FetchQuotationDetail';
EXEC dbo.sp_AccessModelBackup 132, 'sp_FetchCustomers';
EXEC dbo.sp_AccessModelBackup 132, 'sp_FetchCustomerDetail';
EXEC dbo.sp_AccessModelBackup 132, 'sp_Dashboard';
EXEC dbo.sp_AccessModelBackup 132, 'sp_TicketsByCategory';
EXEC dbo.sp_AccessModelBackup 132, 'sp_ResolutionSummary';
EXEC dbo.sp_AccessModelBackup 132, 'sp_FetchLoggedByMe';
GO

-- ---------------------------------------------------------------------------
-- 3. fn_SalesReportRows (spec 3.6, D8). The 122 body; only the scope changes:
--    record families (Src 'L': new, won, lost, open) count only leads the
--    viewer can see (fn_VisibleLeads); activity families (Src 'F' / 'C':
--    done follow-ups, calls, follow-up states) count when the lead is visible
--    OR the person the row is credited to (PersonId) has a line in the
--    viewer's Team report (fn_ReportTree). CanOpen = the lead is visible.
--    Every number of sp_RptSales / sp_RptSalesRows is a count or sum of these
--    rows, so a cell still equals its drill by construction. Actor1 / Actor2
--    stay in the fact rows (unused now).
-- ---------------------------------------------------------------------------
CREATE OR ALTER FUNCTION dbo.fn_SalesReportRows
(
    @CompId        INT,
    @From          DATETIME,
    @ToEx          DATETIME,
    @UserId        INT
)
RETURNS TABLE
AS
RETURN
WITH V AS (SELECT LeadId FROM dbo.fn_VisibleLeads(@CompId, @UserId)),
P AS (SELECT PersonId FROM dbo.fn_ReportTree(@CompId, @UserId) WHERE Depth = 0),
L AS
(
    SELECT l.Id, l.BranchId, l.SourceId, l.ProductId, l.PartnerId, l.StatusId,
           st.Code AS StatusCode, l.LostReasonId, l.OwnerId, l.CreatedBy, l.CreatedAt,
           l.EstValue, l.WonValue, l.NextFollowupDate,
           la.LastActivityAt,
           DATEDIFF(DAY, l.CreatedAt, GETDATE()) AS AgeDays,
           CAST(CASE WHEN l.NextFollowupDate < CASE WHEN CAST(l.NextFollowupDate AS TIME) = '00:00' THEN CAST(CAST(GETDATE() AS DATE) AS DATETIME) ELSE GETDATE() END AND st.Code IN ('open','qualified') THEN 1 ELSE 0 END AS BIT) AS IsOverdue,
           CAST(CASE WHEN st.Code IN ('open','qualified') AND l.NextFollowupDate IS NULL THEN 1 ELSE 0 END AS BIT) AS NoNext,
           CAST(CASE WHEN st.Code IN ('open','qualified')
                      AND ISNULL(la.LastActivityAt, l.CreatedAt) < DATEADD(DAY, -7, GETDATE()) THEN 1 ELSE 0 END AS BIT) AS IsStale,
           CAST(CASE WHEN EXISTS (SELECT 1 FROM dbo.tblFollowUp f WHERE f.CompId = l.CompId AND f.LeadId = l.Id AND f.Status = 'done')
                       OR EXISTS (SELECT 1 FROM dbo.tblCall c WHERE c.CompId = l.CompId AND c.LeadId = l.Id)
                     THEN 1 ELSE 0 END AS BIT) AS Contacted,
           CAST(CASE WHEN l.Id IN (SELECT LeadId FROM V) THEN 1 ELSE 0 END AS BIT) AS CanOpen
    FROM dbo.tblLeads l
    JOIN dbo.tblLookup st ON st.Id = l.StatusId
    CROSS APPLY (
        SELECT CASE WHEN fd.MaxDone IS NULL THEN ac.MaxAct
                    WHEN ac.MaxAct  IS NULL OR fd.MaxDone >= ac.MaxAct THEN fd.MaxDone
                    ELSE ac.MaxAct END AS LastActivityAt
        FROM (SELECT MAX(f.DoneAt) AS MaxDone FROM dbo.tblFollowUp f
              WHERE f.CompId = l.CompId AND f.LeadId = l.Id AND f.Status = 'done') fd
        CROSS JOIN
             (SELECT MAX(a.CreatedAt) AS MaxAct FROM dbo.tblLeadActivity a
              WHERE a.CompId = l.CompId AND a.LeadId = l.Id
                AND a.Type IN ('call','followup','note','status','quotation','assigned')) ac
    ) la
    WHERE l.CompId = @CompId
),
Facts AS
(
    -- new
    SELECT CAST('new' AS VARCHAR(12)) AS Metric, CAST('L' AS CHAR(1)) AS Src, l.Id AS RefId, l.Id AS LeadId,
           l.OwnerId AS PersonId, l.CreatedAt AS EventAt, CAST(l.EstValue AS DECIMAL(18,2)) AS Amount,
           CAST(NULL AS NVARCHAR(200)) AS Detail1, CAST(NULL AS NVARCHAR(200)) AS Detail2,
           CAST(NULL AS INT) AS Actor1, CAST(NULL AS INT) AS Actor2
    FROM dbo.tblLeads l
    WHERE l.CompId = @CompId AND l.CreatedAt >= @From AND l.CreatedAt < @ToEx

    UNION ALL   -- done follow-ups, metric = Type
    SELECT CAST(f.Type AS VARCHAR(12)), 'F', f.Id, f.LeadId,
           f.DoneBy, f.DoneAt, CAST(f.Duration AS DECIMAL(18,2)),
           CAST(f.Type AS NVARCHAR(200)), LEFT(f.Remarks, 200),
           f.DoneBy, f.AssignedTo
    FROM dbo.tblFollowUp f
    WHERE f.CompId = @CompId AND f.Status = 'done' AND f.DoneAt >= @From AND f.DoneAt < @ToEx

    UNION ALL   -- calls logged on a lead (Ruling 1)
    SELECT 'call', 'C', c.Id, c.LeadId,
           c.UserId, c.CalledAt, CAST(c.Duration AS DECIMAL(18,2)),
           N'call', LEFT(c.Notes, 200),
           c.UserId, NULL
    FROM dbo.tblCall c
    WHERE c.CompId = @CompId AND c.LeadId IS NOT NULL AND c.CalledAt >= @From AND c.CalledAt < @ToEx

    UNION ALL   -- follow-ups that fell due, one state each (Rulings 4, 5)
    SELECT CAST(CASE
             WHEN f.Status = 'done' AND f.DoneAt <= CASE WHEN CAST(f.DueAt AS TIME) = '00:00'
                                                         THEN DATEADD(DAY, 1, f.DueAt) ELSE DATEADD(HOUR, 2, f.DueAt) END THEN 'fu_ontime'
             WHEN f.Status = 'done'    THEN 'fu_late'
             WHEN f.Status = 'skipped' THEN 'fu_skipped'
             WHEN f.Status = 'open' AND st.Code IN ('open','qualified')
                  AND f.DueAt < CASE WHEN CAST(f.DueAt AS TIME) = '00:00'
                                     THEN CAST(CAST(GETDATE() AS DATE) AS DATETIME) ELSE GETDATE() END THEN 'fu_missed'
             ELSE 'fu_open'
           END AS VARCHAR(12)), 'F', f.Id, f.LeadId,
           COALESCE(f.DoneBy, f.AssignedTo, l.OwnerId), f.DueAt, NULL,
           CAST(f.Type AS NVARCHAR(200)), LEFT(f.Remarks, 200),
           f.DoneBy, f.AssignedTo
    FROM dbo.tblFollowUp f
    JOIN dbo.tblLeads l    ON l.Id = f.LeadId AND l.CompId = f.CompId
    JOIN dbo.tblLookup st  ON st.Id = l.StatusId
    WHERE f.CompId = @CompId AND f.Status <> 'cancelled' AND f.DueAt >= @From AND f.DueAt < @ToEx
      -- an open follow-up on a lost / junk / converted lead is a leftover (119 cancels them now;
      -- older ones were never cancelled): nobody owes it, so it is neither fu_open nor fu_missed
      AND NOT (f.Status = 'open' AND st.Code IN ('lost','junk','converted'))

    UNION ALL   -- won
    SELECT 'won', 'L', l.Id, l.Id, l.OwnerId, l.WonAt, l.WonValue, NULL, NULL, NULL, NULL
    FROM dbo.tblLeads l
    JOIN dbo.tblLookup st ON st.Id = l.StatusId
    WHERE l.CompId = @CompId AND st.Code = 'converted' AND l.WonAt >= @From AND l.WonAt < @ToEx

    UNION ALL   -- lost
    SELECT 'lost', 'L', l.Id, l.Id, l.OwnerId, l.LostAt, l.EstValue, NULL, NULL, NULL, NULL
    FROM dbo.tblLeads l
    JOIN dbo.tblLookup st ON st.Id = l.StatusId
    WHERE l.CompId = @CompId AND st.Code = 'lost' AND l.LostAt >= @From AND l.LostAt < @ToEx

    UNION ALL   -- open now: ignores @From / @ToEx
    SELECT 'open', 'L', l.Id, l.Id, l.OwnerId, NULL, l.EstValue, NULL, NULL, NULL, NULL
    FROM dbo.tblLeads l
    JOIN dbo.tblLookup st ON st.Id = l.StatusId
    WHERE l.CompId = @CompId AND st.Code IN ('open','qualified')
)
SELECT x.Metric, x.Src, x.RefId, x.LeadId, x.PersonId, x.EventAt, x.Amount, x.Detail1, x.Detail2,
       L.BranchId, L.SourceId, L.ProductId, L.PartnerId, L.StatusId, L.StatusCode, L.LostReasonId,
       L.OwnerId, L.CreatedAt, L.EstValue, L.WonValue, L.NextFollowupDate, L.LastActivityAt,
       L.AgeDays, L.IsOverdue, L.NoNext, L.IsStale, L.Contacted, L.CanOpen
FROM Facts x
JOIN L ON L.Id = x.LeadId
WHERE
    -- record families: only leads the viewer can see (Rule 1)
    (x.Src = 'L' AND L.CanOpen = 1)
    -- activity families (spec 3.6): the lead is visible, or the person credited
    -- with the row has a line in the viewer's Team report
 OR (x.Src IN ('F','C') AND (L.CanOpen = 1 OR x.PersonId IN (SELECT PersonId FROM P)));
GO

-- ---------------------------------------------------------------------------
-- 4. sp_RptSales (122 body). The two lists are gone; the opening block reads
--    the definitions:
--    - "unassigned" line (owner axis off) = leads reach Office or wider, as the
--      old lists made it (Own and Team carried an owner list);
--    - Ruling 7 (N2): with @BranchId / @SourceId / @ProductId set, or grouped
--      by source, only rows on visible leads count (an activity on a hidden
--      lead would otherwise tell the viewer that lead's office / source /
--      product). Team / person lines are people; reason lines are lost rows.
--    The opening block is the same in sp_RptSalesRows; change both together.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_RptSales
    @CompId                  INT,
    @FromDate                DATE          = NULL,
    @ToDate                  DATE          = NULL,
    @GroupBy                 VARCHAR(12),
    @NodeId                  INT           = NULL,
    @BranchId                INT           = NULL,
    @SourceId                INT           = NULL,
    @ProductId               INT           = NULL,
    @UserId                  INT,
    @LinesOnly               BIT           = 0
AS
BEGIN
    SET NOCOUNT ON;
    IF @GroupBy IS NULL OR @GroupBy NOT IN ('team','source','person','reason')
    BEGIN RAISERROR('sp_RptSales: @GroupBy must be team, source, person or reason.', 16, 1); RETURN; END;

    -- opening block, same in sp_RptSalesRows -------------------------------
    DECLARE @ToEx DATE = DATEADD(DAY, 1, @ToDate);
    -- "unassigned" line only for leads reach Office or wider (owner axis off, as the old lists made it)
    DECLARE @OwnerOff BIT = CASE WHEN EXISTS (SELECT 1 FROM dbo.fn_AccessScope(@CompId, @UserId, 'leads')
                                              WHERE ReachLevel >= 3) THEN 1 ELSE 0 END;
    -- Ruling 7 (N2): filtered by office / source / product, or grouped by source (each
    -- line names a lead attribute) -> rows on visible leads only. Team / person lines are
    -- people; reason lines are lost rows (a record family, always visible).
    DECLARE @Filtered BIT = CASE WHEN @BranchId IS NULL AND @SourceId IS NULL AND @ProductId IS NULL
                                  AND @GroupBy <> 'source' THEN 0 ELSE 1 END;
    SELECT * INTO #T FROM dbo.fn_ReportTree(@CompId, @UserId);
    SELECT r.* INTO #R
    FROM dbo.fn_SalesReportRows(@CompId, @FromDate, @ToEx, @UserId) r
    WHERE (@Filtered = 0 OR r.CanOpen = 1)
      AND (@BranchId  IS NULL OR r.BranchId  = @BranchId)
      AND (@SourceId  IS NULL OR r.SourceId  = @SourceId)
      AND (@ProductId IS NULL OR r.ProductId = @ProductId)
      -- Open leads report: "Leads created in"
      AND NOT (@GroupBy = 'person' AND r.Metric = 'open'
               AND (   (@FromDate IS NOT NULL AND r.CreatedAt <  @FromDate)
                    OR (@ToEx     IS NOT NULL AND r.CreatedAt >= @ToEx)));
    -- end of the opening block ---------------------------------------------

    CREATE TABLE #Map (PersonId INT PRIMARY KEY, GroupKey INT NOT NULL);
    CREATE TABLE #L (GroupKey INT NULL, LineKind VARCHAR(10) NOT NULL, Ord INT NOT NULL,
                     NoManager BIT NOT NULL, TeamSize INT NOT NULL,
                     GroupLabel NVARCHAR(200) NULL, IsActive BIT NOT NULL DEFAULT 1);
    DECLARE @NodeOk BIT = 1, @Me INT, @Level INT;

    IF @GroupBy = 'team'
    BEGIN
        SELECT @Me = PersonId FROM #T WHERE Depth = 0 AND PersonId = @UserId;
        IF @NodeId IS NOT NULL
        BEGIN
            IF EXISTS (SELECT 1 FROM #T WHERE AncestorId = @NodeId AND Depth >= 1) SET @Level = @NodeId;
            ELSE SET @NodeOk = 0;
        END
        ELSE IF EXISTS (SELECT 1 FROM #T WHERE AncestorId = @Me AND Depth >= 1) SET @Level = @Me;

        -- the level: direct reports rolled up, the level person's own rows on ChildId = @Level
        INSERT INTO #Map (PersonId, GroupKey) SELECT PersonId, ChildId FROM #T WHERE AncestorId = @Level;

        IF @NodeId IS NULL
        BEGIN
            IF @Level IS NULL AND @Me IS NOT NULL INSERT INTO #Map (PersonId, GroupKey) VALUES (@Me, @Me);
            -- every other root, rolled up over its subtree
            INSERT INTO #Map (PersonId, GroupKey)
            SELECT t.PersonId, t.AncestorId
            FROM #T t
            WHERE t.AncestorId <> ISNULL(@Me, -1)
              AND NOT EXISTS (SELECT 1 FROM #T up WHERE up.PersonId = t.AncestorId AND up.Depth >= 1);
        END;

        INSERT INTO #L (GroupKey, LineKind, Ord, NoManager, TeamSize)
        SELECT k.GroupKey,
               CASE WHEN k.GroupKey = @Level THEN 'own'
                    WHEN s.TeamSize > 1      THEN 'team' ELSE 'person' END,
               CASE WHEN k.GroupKey = @Level THEN 3
                    WHEN lv.IsLevel = 1      THEN 1
                    WHEN k.GroupKey = @Me    THEN 3
                    WHEN t0.NoManager = 1    THEN 4 ELSE 2 END,
               CASE WHEN lv.IsLevel = 0 AND k.GroupKey <> ISNULL(@Me, -1) THEN t0.NoManager ELSE 0 END,
               s.TeamSize
        FROM (SELECT DISTINCT GroupKey FROM #Map) k
        JOIN #T t0 ON t0.AncestorId = k.GroupKey AND t0.PersonId = k.GroupKey
        CROSS APPLY (SELECT COUNT(*) AS TeamSize FROM #T s WHERE s.AncestorId = k.GroupKey) s
        CROSS APPLY (SELECT CASE WHEN EXISTS (SELECT 1 FROM #T c WHERE c.AncestorId = @Level AND c.ChildId = k.GroupKey)
                                 THEN 1 ELSE 0 END AS IsLevel) lv;

        IF @NodeId IS NULL AND @OwnerOff = 1
            INSERT INTO #L (GroupKey, LineKind, Ord, NoManager, TeamSize) VALUES (NULL, 'unassigned', 5, 0, 0);
    END
    ELSE IF @GroupBy = 'person'
    BEGIN
        INSERT INTO #Map (PersonId, GroupKey) SELECT PersonId, PersonId FROM #T WHERE Depth = 0;
        INSERT INTO #L (GroupKey, LineKind, Ord, NoManager, TeamSize)
        SELECT GroupKey, 'person', 1, 0, 1 FROM #Map;
        IF @OwnerOff = 1
            INSERT INTO #L (GroupKey, LineKind, Ord, NoManager, TeamSize) VALUES (NULL, 'unassigned', 5, 0, 0);
    END;

    -- every counted row with its line key
    -- source / reason lines take every #R row: they are NOT person-scoped through #T (those reports
    -- have no person axis), so a Lead sources total can differ from the Team report total by the rows
    -- credited to people out of view (V13) — the 'team' / 'person' lines drop those.
    SELECT CASE @GroupBy WHEN 'source' THEN r.SourceId WHEN 'reason' THEN r.LostReasonId ELSE m.GroupKey END AS GroupKey,
           r.*
    INTO #G
    FROM #R r
    LEFT JOIN #Map m ON m.PersonId = r.PersonId
    WHERE @GroupBy = 'source'
       OR (@GroupBy = 'reason' AND r.Metric = 'lost')
       OR (@GroupBy IN ('team','person')
           AND (   m.PersonId IS NOT NULL
                OR (r.PersonId IS NULL AND EXISTS (SELECT 1 FROM #L WHERE LineKind = 'unassigned'))));

    IF @GroupBy IN ('source','reason')
        INSERT INTO #L (GroupKey, LineKind, Ord, NoManager, TeamSize)
        SELECT DISTINCT GroupKey, 'group', 1, 0, 1 FROM #G;

    UPDATE l SET
        GroupLabel = CASE WHEN l.LineKind = 'unassigned' THEN N'Unassigned leads'
                          WHEN @GroupBy IN ('team','person') THEN CAST(COALESCE(NULLIF(u.FullName, ''), u.Username) AS NVARCHAR(200))
                          WHEN @GroupBy = 'source' THEN ISNULL(lk.Value, N'No source')
                          ELSE ISNULL(lk.Value, N'No reason given') END,
        IsActive   = CASE WHEN @GroupBy IN ('team','person') AND l.LineKind <> 'unassigned' THEN ISNULL(u.IsActive, 0) ELSE 1 END
    FROM #L l
    LEFT JOIN dbo.tblUser   u  ON u.Id  = l.GroupKey AND @GroupBy IN ('team','person')
    LEFT JOIN dbo.tblLookup lk ON lk.Id = l.GroupKey AND @GroupBy IN ('source','reason');

    -- RS1 lines
    SELECT l.GroupKey, l.GroupLabel, l.LineKind, l.TeamSize, l.IsActive, l.NoManager, l.Ord,
           SUM(CASE WHEN g.Metric = 'new'        THEN 1 ELSE 0 END) AS New,
           SUM(CASE WHEN g.Metric = 'call'       THEN 1 ELSE 0 END) AS Calls,
           SUM(CASE WHEN g.Metric = 'visit'      THEN 1 ELSE 0 END) AS Visits,
           SUM(CASE WHEN g.Metric = 'meeting'    THEN 1 ELSE 0 END) AS Meetings,
           SUM(CASE WHEN g.Metric = 'other'      THEN 1 ELSE 0 END) AS Other,
           SUM(CASE WHEN g.Metric = 'fu_ontime'  THEN 1 ELSE 0 END) AS FuOnTime,
           SUM(CASE WHEN g.Metric = 'fu_late'    THEN 1 ELSE 0 END) AS FuLate,
           SUM(CASE WHEN g.Metric = 'fu_skipped' THEN 1 ELSE 0 END) AS FuSkipped,
           SUM(CASE WHEN g.Metric = 'fu_missed'  THEN 1 ELSE 0 END) AS FuMissed,
           SUM(CASE WHEN g.Metric = 'fu_open'    THEN 1 ELSE 0 END) AS FuOpen,
           SUM(CASE WHEN g.Metric = 'won'        THEN 1 ELSE 0 END) AS Won,
           CAST(SUM(CASE WHEN g.Metric = 'won'   THEN ISNULL(g.Amount, 0) ELSE 0 END) AS DECIMAL(18,2)) AS WonValue,
           SUM(CASE WHEN g.Metric = 'lost'       THEN 1 ELSE 0 END) AS Lost,
           CAST(SUM(CASE WHEN g.Metric = 'lost'  THEN ISNULL(g.Amount, 0) ELSE 0 END) AS DECIMAL(18,2)) AS LostValue,
           SUM(CASE WHEN g.Metric = 'open'       THEN 1 ELSE 0 END) AS OpenNow,
           CAST(SUM(CASE WHEN g.Metric = 'open'  THEN ISNULL(g.Amount, 0) ELSE 0 END) AS DECIMAL(18,2)) AS OpenValue,
           SUM(CASE WHEN g.Metric = 'open' AND g.IsOverdue = 1 THEN 1 ELSE 0 END) AS OverdueNow,
           SUM(CASE WHEN g.Metric = 'open' AND g.NoNext    = 1 THEN 1 ELSE 0 END) AS NoNext,
           SUM(CASE WHEN g.Metric = 'open' AND g.IsStale   = 1 THEN 1 ELSE 0 END) AS Stale,
           SUM(CASE WHEN g.Metric = 'open' AND g.AgeDays <= 7              THEN 1 ELSE 0 END) AS Age0_7,
           SUM(CASE WHEN g.Metric = 'open' AND g.AgeDays BETWEEN 8  AND 30 THEN 1 ELSE 0 END) AS Age8_30,
           SUM(CASE WHEN g.Metric = 'open' AND g.AgeDays BETWEEN 31 AND 90 THEN 1 ELSE 0 END) AS Age31_90,
           SUM(CASE WHEN g.Metric = 'open' AND g.AgeDays > 90              THEN 1 ELSE 0 END) AS Age90Plus,
           SUM(CASE WHEN g.Metric = 'new' AND g.StatusCode IN ('open','qualified') THEN 1 ELSE 0 END) AS CohortOpen,
           SUM(CASE WHEN g.Metric = 'new' AND g.StatusCode = 'converted'           THEN 1 ELSE 0 END) AS CohortWon,
           CAST(SUM(CASE WHEN g.Metric = 'new' AND g.StatusCode = 'converted' THEN ISNULL(g.WonValue, 0) ELSE 0 END) AS DECIMAL(18,2)) AS CohortWonValue,
           SUM(CASE WHEN g.Metric = 'new' AND g.StatusCode = 'lost'                THEN 1 ELSE 0 END) AS CohortLost,
           SUM(CASE WHEN g.Metric = 'new' AND g.StatusCode = 'junk'                THEN 1 ELSE 0 END) AS CohortJunk,
           SUM(CASE WHEN g.Metric = 'new' AND g.StatusCode IN ('open','qualified') AND g.Contacted = 0 THEN 1 ELSE 0 END) AS CohortUntouched,
           SUM(CASE WHEN g.Metric = 'lost' THEN DATEDIFF(DAY, g.CreatedAt, g.EventAt) ELSE 0 END) AS DaysOpenSum,
           SUM(CASE WHEN g.Metric = 'lost' THEN 1 ELSE 0 END) AS DaysOpenN
    FROM #L l
    LEFT JOIN #G g ON ISNULL(g.GroupKey, -1) = ISNULL(l.GroupKey, -1)
    GROUP BY l.GroupKey, l.GroupLabel, l.LineKind, l.TeamSize, l.IsActive, l.NoManager, l.Ord
    HAVING COUNT(g.Metric) > 0
        OR (@GroupBy = 'team' AND l.LineKind <> 'unassigned' AND l.IsActive = 1)
    ORDER BY l.Ord, l.GroupLabel;

    IF @LinesOnly = 1 RETURN;

    -- RS2 path: the node's ancestors from the top down, the caller left out, then the node
    SELECT CAST(ROW_NUMBER() OVER (ORDER BY t.Depth DESC) AS INT) AS Ord, t.AncestorId AS Id,
           CAST(COALESCE(NULLIF(u.FullName, ''), u.Username) AS NVARCHAR(200)) AS Name
    FROM #T t
    JOIN dbo.tblUser u ON u.Id = t.AncestorId
    WHERE @GroupBy = 'team' AND @NodeOk = 1 AND t.PersonId = @NodeId
      AND t.AncestorId <> ISNULL(@UserId, -1)
    ORDER BY t.Depth DESC;

    -- RS3
    SELECT @NodeOk AS NodeOk;
END
GO

-- ---------------------------------------------------------------------------
-- 5. sp_RptSalesRows (122 body), same opening block. F2 / D8:
--    - rows are returned only where CanOpen = 1 (both shapes);
--    - RS2 Total still counts every matching row, so it equals the summary
--      cell (= returned rows + HiddenCount); AmountTotal (and WonValue in the
--      leads shape) only from rows on visible leads; in the leads shape Total
--      = every matching lead (listed + HiddenCount), the N* counts stay = the
--      summary cells;
--    - a last recordset HiddenCount INT = matching rows (leads shape: leads)
--      out of view ("N activities on leads no longer in your view"), only when
--      @MaxRows > 0 (@MaxRows = 0 stays one result set for INSERT ... EXEC).
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_RptSalesRows
    @CompId                  INT,
    @FromDate                DATE          = NULL,
    @ToDate                  DATE          = NULL,
    @GroupBy                 VARCHAR(12),
    @Metric                  VARCHAR(12),
    @Shape                   VARCHAR(6),
    @PersonId                INT           = NULL,
    @Rollup                  BIT           = 0,
    @Unassigned              BIT           = 0,
    @GroupKey                INT           = NULL,
    @GroupKeyIsNull          BIT           = 0,
    @State                   VARCHAR(10)   = NULL,
    @AgeBucket               VARCHAR(6)    = NULL,
    @Flag                    VARCHAR(8)    = NULL,
    @BranchId                INT           = NULL,
    @SourceId                INT           = NULL,
    @ProductId               INT           = NULL,
    @MaxRows                 INT           = 2000,
    @UserId                  INT
AS
BEGIN
    SET NOCOUNT ON;
    SET @Rollup         = ISNULL(@Rollup, 0);
    SET @Unassigned     = ISNULL(@Unassigned, 0);
    SET @GroupKeyIsNull = ISNULL(@GroupKeyIsNull, 0);
    SET @MaxRows        = CASE WHEN @MaxRows IS NULL THEN 2000 WHEN @MaxRows < 0 THEN 0 ELSE @MaxRows END;

    IF @GroupBy IS NULL OR @GroupBy NOT IN ('team','source','person','reason')
    BEGIN RAISERROR('sp_RptSalesRows: @GroupBy must be team, source, person or reason.', 16, 1); RETURN; END;
    IF @Shape IS NULL OR @Shape NOT IN ('events','leads')
    BEGIN RAISERROR('sp_RptSalesRows: @Shape must be events or leads.', 16, 1); RETURN; END;
    IF (@State IS NOT NULL AND @State NOT IN ('open','won','lost','junk','untouched'))
       OR (@AgeBucket IS NOT NULL AND @AgeBucket NOT IN ('0_7','8_30','31_90','90p'))
       OR (@Flag IS NOT NULL AND @Flag NOT IN ('overdue','nonext','stale'))
    BEGIN RAISERROR('sp_RptSalesRows: unknown @State, @AgeBucket or @Flag.', 16, 1); RETURN; END;
    IF @Shape = 'leads' AND (@Metric <> 'all' OR @PersonId IS NULL OR @Rollup = 1)
    BEGIN RAISERROR('sp_RptSalesRows: @Shape leads needs @Metric all and one @PersonId without @Rollup.', 16, 1); RETURN; END;

    DECLARE @M TABLE (Metric VARCHAR(12) PRIMARY KEY);
    INSERT INTO @M (Metric)
    SELECT v.m
    FROM (VALUES ('new'),('call'),('visit'),('meeting'),('other'),
                 ('fu_ontime'),('fu_late'),('fu_skipped'),('fu_missed'),('fu_open'),
                 ('won'),('lost'),('open')) v(m)
    WHERE v.m = @Metric
       OR (@Metric = 'visits' AND v.m IN ('visit','meeting'))
       OR (@Metric = 'fu_due' AND v.m LIKE 'fu[_]%')
       OR (@Metric = 'all'    AND v.m <> 'open');
    IF NOT EXISTS (SELECT 1 FROM @M)
    BEGIN RAISERROR('sp_RptSalesRows: unknown @Metric.', 16, 1); RETURN; END;

    -- opening block, same in sp_RptSales -----------------------------------
    DECLARE @ToEx DATE = DATEADD(DAY, 1, @ToDate);
    -- "unassigned" line only for leads reach Office or wider (owner axis off, as the old lists made it)
    DECLARE @OwnerOff BIT = CASE WHEN EXISTS (SELECT 1 FROM dbo.fn_AccessScope(@CompId, @UserId, 'leads')
                                              WHERE ReachLevel >= 3) THEN 1 ELSE 0 END;
    -- Ruling 7 (N2): filtered by office / source / product, or grouped by source (each
    -- line names a lead attribute) -> rows on visible leads only. Team / person lines are
    -- people; reason lines are lost rows (a record family, always visible).
    DECLARE @Filtered BIT = CASE WHEN @BranchId IS NULL AND @SourceId IS NULL AND @ProductId IS NULL
                                  AND @GroupBy <> 'source' THEN 0 ELSE 1 END;
    SELECT * INTO #T FROM dbo.fn_ReportTree(@CompId, @UserId);
    SELECT r.* INTO #R
    FROM dbo.fn_SalesReportRows(@CompId, @FromDate, @ToEx, @UserId) r
    WHERE (@Filtered = 0 OR r.CanOpen = 1)
      AND (@BranchId  IS NULL OR r.BranchId  = @BranchId)
      AND (@SourceId  IS NULL OR r.SourceId  = @SourceId)
      AND (@ProductId IS NULL OR r.ProductId = @ProductId)
      -- Open leads report: "Leads created in"
      AND NOT (@GroupBy = 'person' AND r.Metric = 'open'
               AND (   (@FromDate IS NOT NULL AND r.CreatedAt <  @FromDate)
                    OR (@ToEx     IS NOT NULL AND r.CreatedAt >= @ToEx)));
    -- end of the opening block ---------------------------------------------

    SELECT r.* INTO #F
    FROM #R r
    WHERE r.Metric IN (SELECT Metric FROM @M)
      -- person
      AND (   (@Unassigned = 1 AND r.PersonId IS NULL AND @OwnerOff = 1)
           OR (@Unassigned = 0 AND @PersonId IS NOT NULL
               AND r.PersonId IN (SELECT t.PersonId FROM #T t
                                  WHERE t.AncestorId = @PersonId AND (@Rollup = 1 OR t.Depth = 0)))
           OR (@Unassigned = 0 AND @PersonId IS NULL AND @GroupBy IN ('team','person')
               AND (   r.PersonId IN (SELECT t.PersonId FROM #T t WHERE t.Depth = 0)
                    OR (r.PersonId IS NULL AND @OwnerOff = 1)))
           OR (@Unassigned = 0 AND @PersonId IS NULL AND @GroupBy IN ('source','reason')))
      -- source / reason line
      AND (@GroupBy <> 'reason' OR r.Metric = 'lost')
      AND (   @GroupBy NOT IN ('source','reason')
           OR (@GroupKeyIsNull = 0 AND @GroupKey IS NULL)
           OR (@GroupKeyIsNull = 1 AND CASE WHEN @GroupBy = 'source' THEN r.SourceId ELSE r.LostReasonId END IS NULL)
           OR (@GroupKeyIsNull = 0 AND CASE WHEN @GroupBy = 'source' THEN r.SourceId ELSE r.LostReasonId END = @GroupKey))
      -- the summary's column expressions
      AND (   @State IS NULL
           OR (@State = 'open'      AND r.StatusCode IN ('open','qualified'))
           OR (@State = 'won'       AND r.StatusCode = 'converted')
           OR (@State = 'lost'      AND r.StatusCode = 'lost')
           OR (@State = 'junk'      AND r.StatusCode = 'junk')
           OR (@State = 'untouched' AND r.StatusCode IN ('open','qualified') AND r.Contacted = 0))
      AND (   @AgeBucket IS NULL
           OR (@AgeBucket = '0_7'   AND r.AgeDays <= 7)
           OR (@AgeBucket = '8_30'  AND r.AgeDays BETWEEN 8  AND 30)
           OR (@AgeBucket = '31_90' AND r.AgeDays BETWEEN 31 AND 90)
           OR (@AgeBucket = '90p'   AND r.AgeDays > 90))
      AND (   @Flag IS NULL
           OR (@Flag = 'overdue' AND r.IsOverdue = 1)
           OR (@Flag = 'nonext'  AND r.NoNext    = 1)
           OR (@Flag = 'stale'   AND r.IsStale   = 1));

    IF @Shape = 'events'
    BEGIN
        IF @MaxRows > 0
            SELECT TOP (@MaxRows)
                   f.EventAt, f.Metric, f.Src, f.RefId, f.LeadId, l.Name AS LeadName, f.CreatedAt,
                   CASE WHEN f.CanOpen = 1 THEN l.MobileNo END AS MobileNo, l.Company,
                   f.PersonId, CAST(COALESCE(NULLIF(p.FullName, ''), p.Username) AS NVARCHAR(200)) AS PersonName,
                   CAST(COALESCE(NULLIF(o.FullName, ''), o.Username) AS NVARCHAR(200)) AS OwnerName,
                   src.Value AS SourceName, st.Value AS StatusName, f.StatusCode, f.Amount, f.Detail1, f.Detail2, f.CanOpen,
                   lr.Value AS LostReason, l.Remarks, q.QuoteNo, f.LastActivityAt, f.NextFollowupDate,
                   f.AgeDays, f.IsOverdue, f.IsStale
            FROM #F f
            JOIN dbo.tblLeads l        ON l.Id = f.LeadId
            LEFT JOIN dbo.tblUser p    ON p.Id = f.PersonId
            LEFT JOIN dbo.tblUser o    ON o.Id = f.OwnerId
            LEFT JOIN dbo.tblLookup src ON src.Id = f.SourceId
            LEFT JOIN dbo.tblLookup st  ON st.Id = f.StatusId
            LEFT JOIN dbo.tblLookup lr  ON lr.Id = f.LostReasonId
            OUTER APPLY (SELECT TOP 1 qq.QuoteNo FROM dbo.tblQuotation qq
                         WHERE qq.CompId = @CompId AND qq.LeadId = f.LeadId AND qq.Status = 'accepted'
                         ORDER BY qq.Id DESC) q
            WHERE f.CanOpen = 1                     -- F2 / D8: no rows for leads out of view
            ORDER BY CASE WHEN @Metric = 'open' THEN f.AgeDays END DESC,
                     CASE WHEN @Metric = 'open' THEN f.LeadId  END DESC,
                     f.EventAt DESC, f.RefId DESC;

        -- Total = every matching row (= the summary cell); money only from visible leads
        SELECT COUNT(*) AS Total, CAST(ISNULL(SUM(CASE WHEN CanOpen = 1 THEN Amount END), 0) AS DECIMAL(18,2)) AS AmountTotal FROM #F;
    END
    ELSE
    BEGIN
        SELECT f.LeadId, f.StatusId, f.StatusCode, f.OwnerId, f.CreatedAt, f.EstValue, f.WonValue,
               f.LastActivityAt, f.NextFollowupDate, f.IsOverdue, f.IsStale, f.CanOpen,
               SUM(CASE WHEN f.Metric = 'new'                    THEN 1 ELSE 0 END) AS NNew,
               SUM(CASE WHEN f.Metric = 'call'                   THEN 1 ELSE 0 END) AS NCalls,
               SUM(CASE WHEN f.Metric IN ('visit','meeting')     THEN 1 ELSE 0 END) AS NVisits,
               SUM(CASE WHEN f.Metric = 'other'                  THEN 1 ELSE 0 END) AS NOther,
               SUM(CASE WHEN f.Metric LIKE 'fu[_]%'              THEN 1 ELSE 0 END) AS NDue,
               SUM(CASE WHEN f.Metric = 'fu_ontime'              THEN 1 ELSE 0 END) AS NOnTime,
               SUM(CASE WHEN f.Metric = 'fu_late'                THEN 1 ELSE 0 END) AS NLate,
               SUM(CASE WHEN f.Metric = 'fu_skipped'             THEN 1 ELSE 0 END) AS NSkipped,
               SUM(CASE WHEN f.Metric = 'fu_missed'              THEN 1 ELSE 0 END) AS NMissed,
               SUM(CASE WHEN f.Metric = 'won'                    THEN 1 ELSE 0 END) AS NWon,
               SUM(CASE WHEN f.Metric = 'won' THEN ISNULL(f.Amount, 0) ELSE 0 END)  AS WonAmount,
               SUM(CASE WHEN f.Metric = 'lost'                   THEN 1 ELSE 0 END) AS NLost
        INTO #LD
        FROM #F f
        GROUP BY f.LeadId, f.StatusId, f.StatusCode, f.OwnerId, f.CreatedAt, f.EstValue, f.WonValue,
                 f.LastActivityAt, f.NextFollowupDate, f.IsOverdue, f.IsStale, f.CanOpen;

        IF @MaxRows > 0
            SELECT TOP (@MaxRows)
                   d.LeadId, l.Name AS LeadName, d.CreatedAt,
                   CASE WHEN d.CanOpen = 1 THEN l.MobileNo END AS MobileNo, l.Company,
                   CAST(COALESCE(NULLIF(o.FullName, ''), o.Username) AS NVARCHAR(200)) AS OwnerName,
                   st.Value AS StatusName, d.StatusCode, d.EstValue, d.WonValue,
                   d.LastActivityAt, d.NextFollowupDate, d.IsOverdue, d.IsStale, d.CanOpen,
                   d.NNew, d.NCalls, d.NVisits, d.NOther, d.NDue, d.NOnTime, d.NLate, d.NSkipped, d.NMissed, d.NWon, d.NLost
            FROM #LD d
            JOIN dbo.tblLeads l        ON l.Id = d.LeadId
            LEFT JOIN dbo.tblUser o    ON o.Id = d.OwnerId
            LEFT JOIN dbo.tblLookup st ON st.Id = d.StatusId
            WHERE d.CanOpen = 1                     -- F2 / D8: no rows for leads out of view
            ORDER BY d.CreatedAt DESC, d.LeadId DESC;

        -- Total = every matching lead (= listed leads + HiddenCount); AmountTotal = the visible leads'
        -- estimated value; the N* counts = the summary cells; WonValue = Won of the period, visible leads only
        SELECT COUNT(*) AS Total,
               CAST(ISNULL(SUM(CASE WHEN CanOpen = 1 THEN EstValue END), 0) AS DECIMAL(18,2)) AS AmountTotal,
               ISNULL(SUM(NNew), 0) AS NNew, ISNULL(SUM(NCalls), 0) AS NCalls, ISNULL(SUM(NVisits), 0) AS NVisits,
               ISNULL(SUM(NOther), 0) AS NOther, ISNULL(SUM(NDue), 0) AS NDue, ISNULL(SUM(NOnTime), 0) AS NOnTime,
               ISNULL(SUM(NLate), 0) AS NLate, ISNULL(SUM(NSkipped), 0) AS NSkipped, ISNULL(SUM(NMissed), 0) AS NMissed,
               ISNULL(SUM(NWon), 0) AS NWon, CAST(ISNULL(SUM(CASE WHEN CanOpen = 1 THEN WonAmount END), 0) AS DECIMAL(18,2)) AS WonValue,
               ISNULL(SUM(NLost), 0) AS NLost
        FROM #LD;
    END;

    IF @MaxRows = 0 RETURN;

    -- RS3 path (team + @PersonId): ancestors from the top down, the caller left out, then the person
    SELECT CAST(ROW_NUMBER() OVER (ORDER BY t.Depth DESC) AS INT) AS Ord, t.AncestorId AS Id,
           CAST(COALESCE(NULLIF(u.FullName, ''), u.Username) AS NVARCHAR(200)) AS Name
    FROM #T t
    JOIN dbo.tblUser u ON u.Id = t.AncestorId
    WHERE @GroupBy = 'team' AND t.PersonId = @PersonId
      AND t.AncestorId <> ISNULL(@UserId, -1)
    ORDER BY t.Depth DESC;

    -- RS4 (last): what matched on leads out of view - events: rows ("N activities on leads no
    -- longer in your view"); leads shape: leads. Either way listed + HiddenCount = RS2 Total.
    SELECT CAST(CASE WHEN @Shape = 'leads' THEN (SELECT COUNT(DISTINCT LeadId) FROM #F WHERE CanOpen = 0)
                     ELSE (SELECT COUNT(*) FROM #F WHERE CanOpen = 0) END AS INT) AS HiddenCount;
END
GO

-- ---------------------------------------------------------------------------
-- 6. sp_FetchTickets: the complaint list and its presets (spec 3.1, F24).
--    Visibility = fn_VisibleTickets. Escalated preset: in progress AND
--    (escalated to me OR overdue AND held by one of my people). The caller's
--    own overdue complaints are not in it (fn_AccessPeople excludes self;
--    they are in Mine / Overdue). LinkedLeadId only when the lead is visible.
--    The three list parameters are gone; @UserId has no default.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchTickets
    @CompId       INT,
    @BranchId     INT           = NULL,
    @PageNumber   INT           = 1,
    @PageSize     INT           = 25,
    @SearchTerm   NVARCHAR(200) = NULL,
    @StatusId     INT           = NULL,
    @StatusCode   VARCHAR(30)   = NULL,
    @Priority     INT           = NULL,
    @CategoryId   INT           = NULL,
    @ChannelId    INT           = NULL,
    @ProductId    INT           = NULL,
    @CustomerId   INT           = NULL,
    @AssignedTo   INT           = NULL,
    @Overdue      BIT           = 0,
    @Escalated    BIT           = 0,
    @Unassigned   BIT           = 0,
    @FromDate     DATE          = NULL,
    @ToDate       DATE          = NULL,
    @UserId       INT,
    @ResolvedFrom DATETIME      = NULL,   -- 118: inclusive
    @ResolvedTo   DATETIME      = NULL    -- 118: EXCLUSIVE instant, unlike @ToDate (inclusive day)
AS
BEGIN
    -- Order: newest first. Overdue / Escalated queues: overdue first,
    -- nearest due (undated last), then newest.
    SET NOCOUNT ON;

    SET @PageNumber = CASE WHEN ISNULL(@PageNumber, 1)  < 1 THEN 1  ELSE @PageNumber END;
    SET @PageSize   = CASE WHEN ISNULL(@PageSize,  25)  < 1 THEN 25 ELSE @PageSize   END;
    SET @SearchTerm = NULLIF(LTRIM(RTRIM(@SearchTerm)), N'');
    SET @StatusCode = NULLIF(LTRIM(RTRIM(@StatusCode)), '');
    SET @Overdue    = ISNULL(@Overdue, 0);
    SET @Escalated  = ISNULL(@Escalated, 0);
    SET @Unassigned = ISNULL(@Unassigned, 0);
    DECLARE @ToEx   DATETIME = CASE WHEN @ToDate IS NULL THEN NULL ELSE DATEADD(DAY, 1, CAST(@ToDate AS DATETIME)) END;
    DECLARE @Now    DATETIME = GETDATE();
    DECLARE @Triage BIT = CASE WHEN @Overdue = 1 OR @Escalated = 1 THEN 1 ELSE 0 END;
    DECLARE @Digits VARCHAR(50) = CASE WHEN @SearchTerm IS NOT NULL
                                        AND REPLACE(REPLACE(@SearchTerm, ' ', ''), '-', '') NOT LIKE '%[^0-9+]%'
                                       THEN REPLACE(REPLACE(@SearchTerm, ' ', ''), '-', '') END;

    -- The definitions, once per call.
    CREATE TABLE #VT (TicketId INT PRIMARY KEY);
    INSERT INTO #VT (TicketId) SELECT TicketId FROM dbo.fn_VisibleTickets(@CompId, @UserId);
    CREATE TABLE #People (UserId INT PRIMARY KEY);
    IF @Escalated = 1
        INSERT INTO #People (UserId) SELECT UserId FROM dbo.fn_AccessPeople(@CompId, @UserId);

    -- One predicate, one scan: the matching ids with their sort keys.
    DECLARE @F TABLE (Id INT PRIMARY KEY, IsOverdue BIT, DueSort DATETIME, CreatedAt DATETIME);
    INSERT INTO @F (Id, IsOverdue, DueSort, CreatedAt)
    SELECT t.Id, o.IsOverdue, ISNULL(t.DueAt, '9999-12-31'), t.CreatedAt
    FROM dbo.tblTicket t
    JOIN #VT v              ON v.TicketId = t.Id
    JOIN dbo.tblLookup st   ON st.Id = t.StatusId
    JOIN dbo.tblCustomer c  ON c.Id  = t.CustomerId
    CROSS APPLY (SELECT CAST(CASE WHEN st.Code IN ('open', 'onhold') AND t.DueAt < @Now THEN 1 ELSE 0 END AS BIT) AS IsOverdue) o
    WHERE t.CompId = @CompId
      AND (@BranchId   IS NULL OR t.BranchId   = @BranchId)
      AND (@StatusId   IS NULL OR t.StatusId   = @StatusId)
      AND (@StatusCode IS NULL OR st.Code = @StatusCode
                              OR (@StatusCode = 'active' AND st.Code IN ('open', 'onhold')))
      AND (@Priority   IS NULL OR t.Priority   = @Priority)
      AND (@CategoryId IS NULL OR t.CategoryId = @CategoryId)
      AND (@ChannelId  IS NULL OR t.ChannelId  = @ChannelId)
      AND (@ProductId  IS NULL OR t.ProductId  = @ProductId)
      AND (@CustomerId IS NULL OR t.CustomerId = @CustomerId)
      AND (@AssignedTo IS NULL OR t.AssignedTo = @AssignedTo)
      AND (@Unassigned = 0 OR t.AssignedTo IS NULL)
      AND (@Overdue    = 0 OR o.IsOverdue = 1)
      AND (@Escalated  = 0 OR (st.Code IN ('open', 'onhold')
                               AND (t.EscalatedTo = @UserId
                                    OR (o.IsOverdue = 1
                                        AND t.AssignedTo IN (SELECT UserId FROM #People)))))
      AND (@FromDate IS NULL OR t.CreatedAt >= @FromDate)
      AND (@ToEx     IS NULL OR t.CreatedAt <  @ToEx)
      AND (@ResolvedFrom IS NULL OR t.ResolvedAt >= @ResolvedFrom)  -- 118
      AND (@ResolvedTo   IS NULL OR t.ResolvedAt <  @ResolvedTo)    -- 118
      AND (@SearchTerm IS NULL
           OR t.TicketNo      LIKE '%' + @SearchTerm + '%'
           OR t.Subject       LIKE '%' + @SearchTerm + '%'
           OR c.Name          LIKE '%' + @SearchTerm + '%'
           OR c.Mobile        LIKE '%' + ISNULL(@Digits, @SearchTerm) + '%'
           OR t.ContactPerson LIKE '%' + @SearchTerm + '%'
           OR t.Contact       LIKE '%' + @SearchTerm + '%');

    DECLARE @Total INT = (SELECT COUNT(*) FROM @F);

    -- Linked leads the caller can see, for this page only (F24).
    DECLARE @PageIds TABLE (Id INT PRIMARY KEY, rn INT NOT NULL);
    INSERT INTO @PageIds (Id, rn)
    SELECT f.Id, ROW_NUMBER() OVER (ORDER BY CASE WHEN @Triage = 1 THEN f.IsOverdue END DESC,
                                             CASE WHEN @Triage = 1 THEN f.DueSort   END ASC,
                                             f.CreatedAt DESC, f.Id DESC)
    FROM @F f
    ORDER BY CASE WHEN @Triage = 1 THEN f.IsOverdue END DESC,
             CASE WHEN @Triage = 1 THEN f.DueSort   END ASC,
             f.CreatedAt DESC, f.Id DESC
    OFFSET (@PageNumber - 1) * @PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;
    CREATE TABLE #VL (LeadId INT PRIMARY KEY);
    IF EXISTS (SELECT 1 FROM @PageIds p JOIN dbo.tblTicket t ON t.Id = p.Id WHERE t.LinkedLeadId IS NOT NULL)
        INSERT INTO #VL (LeadId) SELECT LeadId FROM dbo.fn_VisibleLeads(@CompId, @UserId);

    -- RS1: the page, every column + labels
    SELECT t.Id, t.CompId, t.BranchId, b.BranchName,
           t.TicketNo, t.Subject,
           t.CustomerId, c.Name AS CustomerName, c.Mobile AS CustomerMobile,
           t.ContactPerson, t.Contact,
           t.ChannelId,  ch.Value AS ChannelName,
           t.CategoryId, cat.Value AS CategoryName,
           t.Priority,   pr.Value AS PriorityName,
           t.ProductId,  p.Name AS ProductName,
           t.StatusId,   st.Value AS StatusName, st.Code AS StatusCode,
           t.AssignedTo, a.FullName AS AssigneeName, a.Avatar AS AssigneeAvatar, t.AssignedAt,
           t.DueAt, f.IsOverdue,
           DATEDIFF(HOUR, t.CreatedAt, COALESCE(t.ClosedAt, t.ResolvedAt, @Now)) AS AgeHours,
           t.EscalatedTo, e.FullName AS EscalatedToName, t.EscalatedAt,
           CASE WHEN EXISTS (SELECT 1 FROM #VL vl WHERE vl.LeadId = t.LinkedLeadId) THEN t.LinkedLeadId END AS LinkedLeadId,
           t.ResolvedAt, t.ClosedAt, t.ResolutionId, r.Value AS ResolutionName,
           t.Description,
           t.CreatedBy, t.CreatedAt, t.UpdatedAt,
           200 AS ResponseCode, 'Tickets retrieved successfully' AS ResponseMess
    FROM @PageIds x
    JOIN @F f                   ON f.Id   = x.Id
    JOIN dbo.tblTicket t        ON t.Id   = f.Id
    JOIN dbo.tblLookup st       ON st.Id  = t.StatusId
    JOIN dbo.tblCustomer c      ON c.Id   = t.CustomerId
    LEFT JOIN dbo.tblLookup ch  ON ch.Id  = t.ChannelId
    LEFT JOIN dbo.tblLookup cat ON cat.Id = t.CategoryId
    LEFT JOIN dbo.tblLookup pr  ON pr.Id  = t.Priority
    LEFT JOIN dbo.tblLookup r   ON r.Id   = t.ResolutionId
    LEFT JOIN dbo.tblProduct p  ON p.Id   = t.ProductId
    LEFT JOIN dbo.tblUser a     ON a.Id   = t.AssignedTo
    LEFT JOIN dbo.tblUser e     ON e.Id   = t.EscalatedTo
    LEFT JOIN dbo.tblBranch b   ON b.Id   = t.BranchId
    ORDER BY x.rn;

    -- RS2: pagination
    SELECT @PageNumber AS CurrentPage,
           @PageSize   AS PageSize,
           @Total      AS TotalRecords,
           CASE WHEN @Total = 0 THEN 0 ELSE CEILING(CAST(@Total AS FLOAT) / @PageSize) END AS TotalPages;
END
GO

-- ---------------------------------------------------------------------------
-- 7. sp_FetchTicketDetail - 5 result sets, all empty when the complaint is not
--    visible to @UserId (fn_RecordActions: 0 rows). RS1 gains CanEdit,
--    CanReassign, CanReopen, SendBackToId, SendBackToName (from
--    fn_RecordActions, never restated); LinkedLeadId and RS5 only when the
--    lead is visible; PreviousTickets counts visible complaints only (F4).
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchTicketDetail
    @CompId   INT,
    @TicketId INT,
    @UserId   INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Now DATETIME = GETDATE();

    DECLARE @Vis BIT = 0, @CanEdit BIT = 0, @CanReassign BIT = 0, @CanReopen BIT = 0,
            @SendBackToId INT = NULL, @LeadVis BIT = 0;
    SELECT @Vis = 1, @CanEdit = ISNULL(a.CanEdit, 0), @CanReassign = ISNULL(a.CanReassign, 0),
           @CanReopen = ISNULL(a.CanReopen, 0), @SendBackToId = a.SendBackToId
    FROM dbo.fn_RecordActions(@CompId, @UserId, 'complaints', @TicketId) a;

    CREATE TABLE #VT (TicketId INT PRIMARY KEY);
    IF @Vis = 1
    BEGIN
        INSERT INTO #VT (TicketId) SELECT TicketId FROM dbo.fn_VisibleTickets(@CompId, @UserId);
        IF EXISTS (SELECT 1 FROM dbo.tblTicket t
                   JOIN dbo.fn_VisibleLeads(@CompId, @UserId) vl ON vl.LeadId = t.LinkedLeadId
                   WHERE t.Id = @TicketId AND t.CompId = @CompId)
            SET @LeadVis = 1;
    END

    -- 1) core
    SELECT t.Id, t.CompId, t.BranchId, b.BranchName,
           t.TicketNo, t.Subject,
           t.CustomerId, c.Name AS CustomerName, c.Mobile AS CustomerMobile,
           t.ContactPerson, t.Contact,
           t.ChannelId,  ch.Value AS ChannelName,
           t.CategoryId, cat.Value AS CategoryName,
           t.Priority,   pr.Value AS PriorityName,
           t.ProductId,  p.Name AS ProductName,
           t.StatusId,   st.Value AS StatusName, st.Code AS StatusCode,
           t.AssignedTo, a.FullName AS AssigneeName, a.Avatar AS AssigneeAvatar, t.AssignedAt,
           t.DueAt,
           CAST(CASE WHEN st.Code IN ('open', 'onhold') AND t.DueAt < @Now THEN 1 ELSE 0 END AS BIT) AS IsOverdue,
           DATEDIFF(HOUR, t.CreatedAt, COALESCE(t.ClosedAt, t.ResolvedAt, @Now)) AS AgeHours,
           t.EscalatedTo, e.FullName AS EscalatedToName, t.EscalatedAt,
           CASE WHEN @LeadVis = 1 THEN t.LinkedLeadId END AS LinkedLeadId,
           t.ResolvedAt, t.ClosedAt, t.ResolutionId, r.Value AS ResolutionName,
           t.Description,
           t.CreatedBy, t.CreatedAt, t.UpdatedAt,
           t.EditBy,
           c.ContactPerson AS CustomerContactPerson, c.Email AS CustomerEmail,
           c.City AS CustomerCity, c.Address AS CustomerAddress,
           (SELECT COUNT(*) FROM dbo.tblTicket x
             JOIN #VT vx ON vx.TicketId = x.Id
             WHERE x.CompId = t.CompId AND x.CustomerId = t.CustomerId AND x.Id <> t.Id) AS PreviousTickets,
           @CanEdit AS CanEdit, @CanReassign AS CanReassign, @CanReopen AS CanReopen,
           @SendBackToId AS SendBackToId, sb.FullName AS SendBackToName,
           200 AS ResponseCode, 'Ticket detail retrieved successfully' AS ResponseMess
    FROM dbo.tblTicket t
    JOIN dbo.tblLookup st       ON st.Id  = t.StatusId
    JOIN dbo.tblCustomer c      ON c.Id   = t.CustomerId
    LEFT JOIN dbo.tblLookup ch  ON ch.Id  = t.ChannelId
    LEFT JOIN dbo.tblLookup cat ON cat.Id = t.CategoryId
    LEFT JOIN dbo.tblLookup pr  ON pr.Id  = t.Priority
    LEFT JOIN dbo.tblLookup r   ON r.Id   = t.ResolutionId
    LEFT JOIN dbo.tblProduct p  ON p.Id   = t.ProductId
    LEFT JOIN dbo.tblUser a     ON a.Id   = t.AssignedTo
    LEFT JOIN dbo.tblUser e     ON e.Id   = t.EscalatedTo
    LEFT JOIN dbo.tblBranch b   ON b.Id   = t.BranchId
    LEFT JOIN dbo.tblUser sb    ON sb.Id  = @SendBackToId
    WHERE t.Id = @TicketId AND t.CompId = @CompId AND @Vis = 1;

    -- 2) custom values
    SELECT d.Id AS FieldId, d.FieldKey, d.Label, d.Type, v.ValueText, v.ValueNumber, v.ValueDate
    FROM dbo.tblCustomFieldValue v
    INNER JOIN dbo.tblCustomFieldDef d ON d.Id = v.FieldId
    WHERE v.CompId = @CompId AND v.Entity = 'ticket' AND v.EntityId = @TicketId AND @Vis = 1
    ORDER BY d.SortOrder;

    -- 3) timeline
    SELECT a.Id, a.TicketId, a.UserId, u.FullName AS UserName, u.Avatar AS UserAvatar,
           a.Type, a.Summary, a.MetaJSON, a.CreatedAt
    FROM dbo.tblTicketActivity a
    LEFT JOIN dbo.tblUser u ON u.Id = a.UserId
    WHERE a.CompId = @CompId AND a.TicketId = @TicketId AND @Vis = 1
    ORDER BY a.CreatedAt DESC, a.Id DESC;

    -- 4) assignment history, newest first
    SELECT a.Id,
           a.FromUserId, fu.FullName AS FromUserName,
           a.ToUserId,   tu.FullName AS ToUserName,
           a.FromBranchId, fb.BranchName AS FromBranchName,
           a.ToBranchId,   tb.BranchName AS ToBranchName,
           a.ReasonId, rs.Value AS Reason, a.Remarks,
           a.AssignedBy, ab.FullName AS AssignedByName, a.AssignedAt
    FROM dbo.tblTicketAssignment a
    LEFT JOIN dbo.tblUser fu   ON fu.Id = a.FromUserId
    LEFT JOIN dbo.tblUser tu   ON tu.Id = a.ToUserId
    LEFT JOIN dbo.tblUser ab   ON ab.Id = a.AssignedBy
    LEFT JOIN dbo.tblBranch fb ON fb.Id = a.FromBranchId
    LEFT JOIN dbo.tblBranch tb ON tb.Id = a.ToBranchId
    LEFT JOIN dbo.tblLookup rs ON rs.Id = a.ReasonId
    WHERE a.CompId = @CompId AND a.TicketId = @TicketId AND @Vis = 1
    ORDER BY a.AssignedAt DESC, a.Id DESC;

    -- 5) linked-lead summary (empty set when no link, or the lead is not visible).
    SELECT l.Id, l.Name, l.MobileNo, l.Email, l.StatusId
    FROM dbo.tblLeads l
    INNER JOIN dbo.tblTicket t ON t.LinkedLeadId = l.Id
    WHERE t.Id = @TicketId AND t.CompId = @CompId AND l.CompId = @CompId AND @LeadVis = 1;
END
GO

-- ---------------------------------------------------------------------------
-- 8. sp_FetchLeads (122 body): the two lists are gone, visibility =
--    fn_VisibleLeads (#VL, once per call) in both the page and the
--    past-the-end count. Everything else is the live text.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchLeads
    @CompId                  INT,
    @BranchId                INT           = NULL,
    @PageNumber              INT           = 1,
    @PageSize                INT           = 10,
    @SearchTerm              NVARCHAR(200) = NULL,
    @StatusId                INT           = NULL,
    @StatusCode              VARCHAR(30)   = NULL,
    @ProductId               INT           = NULL,
    @OwnerId                 INT           = NULL,
    @SourceId                INT           = NULL,
    @Overdue                 BIT           = 0,
    @Unassigned              BIT           = 0,
    @FromDate                DATE          = NULL,
    @ToDate                  DATE          = NULL,
    @UserId                  INT,
    @PartnerId               INT           = NULL,
    @SortBy                  VARCHAR(20)   = NULL,
    @SortDir                 VARCHAR(4)    = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SET @PageNumber = CASE WHEN ISNULL(@PageNumber,1) < 1 THEN 1 ELSE @PageNumber END;
    SET @PageSize   = CASE WHEN ISNULL(@PageSize,10) < 1 THEN 10 ELSE @PageSize END;
    IF @SearchTerm IS NOT NULL AND LTRIM(RTRIM(@SearchTerm)) = '' SET @SearchTerm = NULL;
    IF @StatusCode IS NOT NULL AND LTRIM(RTRIM(@StatusCode)) = '' SET @StatusCode = NULL;
    IF @SortBy NOT IN ('created','lastActivity','name','value','nextFollowUp') SET @SortBy = NULL;
    SET @SortDir = CASE WHEN @SortDir = 'asc' THEN 'asc' ELSE 'desc' END;
    DECLARE @ToEx DATETIME = CASE WHEN @ToDate IS NULL THEN NULL ELSE DATEADD(DAY, 1, CAST(@ToDate AS DATETIME)) END;

    CREATE TABLE #VL (LeadId INT PRIMARY KEY);
    INSERT INTO #VL (LeadId) SELECT LeadId FROM dbo.fn_VisibleLeads(@CompId, @UserId);

    DECLARE @Today DATETIME = CAST(CAST(GETDATE() AS DATE) AS DATETIME);

    DECLARE @Page TABLE (Id INT, Total INT, rn INT, LastActivityAt DATETIME NULL);
    INSERT INTO @Page (Id, Total, rn, LastActivityAt)
    SELECT l.Id, COUNT(*) OVER (), ROW_NUMBER() OVER (
               ORDER BY CASE WHEN @SortBy IS NULL AND @Overdue = 1 THEN l.NextFollowupDate END ASC,
                        CASE WHEN @SortBy = 'lastActivity' AND la.LastActivityAt   IS NULL THEN 1
                             WHEN @SortBy = 'value'        AND l.EstValue          IS NULL THEN 1
                             WHEN @SortBy = 'nextFollowUp' AND l.NextFollowupDate  IS NULL THEN 1 ELSE 0 END ASC,
                        CASE WHEN @SortDir = 'asc'  AND @SortBy = 'created'      THEN l.CreatedAt        END ASC,
                        CASE WHEN @SortDir = 'desc' AND @SortBy = 'created'      THEN l.CreatedAt        END DESC,
                        CASE WHEN @SortDir = 'asc'  AND @SortBy = 'lastActivity' THEN la.LastActivityAt  END ASC,
                        CASE WHEN @SortDir = 'desc' AND @SortBy = 'lastActivity' THEN la.LastActivityAt  END DESC,
                        CASE WHEN @SortDir = 'asc'  AND @SortBy = 'name'         THEN l.Name             END ASC,
                        CASE WHEN @SortDir = 'desc' AND @SortBy = 'name'         THEN l.Name             END DESC,
                        CASE WHEN @SortDir = 'asc'  AND @SortBy = 'value'        THEN l.EstValue         END ASC,
                        CASE WHEN @SortDir = 'desc' AND @SortBy = 'value'        THEN l.EstValue         END DESC,
                        CASE WHEN @SortDir = 'asc'  AND @SortBy = 'nextFollowUp' THEN l.NextFollowupDate END ASC,
                        CASE WHEN @SortDir = 'desc' AND @SortBy = 'nextFollowUp' THEN l.NextFollowupDate END DESC,
                        l.CreatedAt DESC, l.Id DESC),
           la.LastActivityAt
    FROM dbo.tblLeads l
    JOIN dbo.tblLookup st ON st.Id = l.StatusId
    -- ceiling: ~50k leads per company; then a stored column kept by sp_LogLeadActivity
    OUTER APPLY (
        SELECT CASE WHEN fd.MaxDone IS NULL THEN ac.MaxAct
                    WHEN ac.MaxAct  IS NULL OR fd.MaxDone >= ac.MaxAct THEN fd.MaxDone
                    ELSE ac.MaxAct END AS LastActivityAt
        FROM (SELECT MAX(f.DoneAt) AS MaxDone FROM dbo.tblFollowUp f
              WHERE f.CompId = l.CompId AND f.LeadId = l.Id AND f.Status = 'done') fd
        CROSS JOIN
             (SELECT MAX(a.CreatedAt) AS MaxAct FROM dbo.tblLeadActivity a
              WHERE a.CompId = l.CompId AND a.LeadId = l.Id
                AND a.Type IN ('call','followup','note','status','quotation','assigned')) ac
    ) la
    WHERE l.CompId = @CompId
      AND (@BranchId   IS NULL OR l.BranchId  = @BranchId)
      AND (@StatusId   IS NULL OR l.StatusId  = @StatusId)
      AND (@StatusCode IS NULL OR st.Code     = @StatusCode)
      AND (@ProductId  IS NULL OR l.ProductId = @ProductId)
      AND (@OwnerId    IS NULL OR l.OwnerId   = @OwnerId)
      AND (@SourceId   IS NULL OR l.SourceId  = @SourceId)
      AND (@PartnerId  IS NULL OR l.PartnerId = @PartnerId)
      AND (@Unassigned = 0 OR l.OwnerId IS NULL)
      AND (@Overdue = 0 OR (l.NextFollowupDate < /*120*/ CASE WHEN CAST(l.NextFollowupDate AS TIME) = '00:00' THEN @Today ELSE GETDATE() END AND st.Code IN ('open','qualified')))
      AND (@FromDate IS NULL OR l.CreatedAt >= @FromDate)
      AND (@ToEx     IS NULL OR l.CreatedAt <  @ToEx)
      AND (@SearchTerm IS NULL OR l.Name LIKE '%' + @SearchTerm + '%'
                              OR l.Company LIKE '%' + @SearchTerm + '%'
                              OR l.MobileNo LIKE '%' + @SearchTerm + '%'
                              OR l.Email LIKE '%' + @SearchTerm + '%'
                              OR l.City LIKE '%' + @SearchTerm + '%')
      AND l.Id IN (SELECT LeadId FROM #VL)
    ORDER BY CASE WHEN @SortBy IS NULL AND @Overdue = 1 THEN l.NextFollowupDate END ASC,
             CASE WHEN @SortBy = 'lastActivity' AND la.LastActivityAt   IS NULL THEN 1
                  WHEN @SortBy = 'value'        AND l.EstValue          IS NULL THEN 1
                  WHEN @SortBy = 'nextFollowUp' AND l.NextFollowupDate  IS NULL THEN 1 ELSE 0 END ASC,
             CASE WHEN @SortDir = 'asc'  AND @SortBy = 'created'      THEN l.CreatedAt        END ASC,
             CASE WHEN @SortDir = 'desc' AND @SortBy = 'created'      THEN l.CreatedAt        END DESC,
             CASE WHEN @SortDir = 'asc'  AND @SortBy = 'lastActivity' THEN la.LastActivityAt  END ASC,
             CASE WHEN @SortDir = 'desc' AND @SortBy = 'lastActivity' THEN la.LastActivityAt  END DESC,
             CASE WHEN @SortDir = 'asc'  AND @SortBy = 'name'         THEN l.Name             END ASC,
             CASE WHEN @SortDir = 'desc' AND @SortBy = 'name'         THEN l.Name             END DESC,
             CASE WHEN @SortDir = 'asc'  AND @SortBy = 'value'        THEN l.EstValue         END ASC,
             CASE WHEN @SortDir = 'desc' AND @SortBy = 'value'        THEN l.EstValue         END DESC,
             CASE WHEN @SortDir = 'asc'  AND @SortBy = 'nextFollowUp' THEN l.NextFollowupDate END ASC,
             CASE WHEN @SortDir = 'desc' AND @SortBy = 'nextFollowUp' THEN l.NextFollowupDate END DESC,
             l.CreatedAt DESC, l.Id DESC
    OFFSET (@PageNumber - 1) * @PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;

    -- Result set 1: page of leads
    SELECT l.Id, l.CompId, l.BranchId, b.BranchName,
           l.Name, l.Company, l.MobileNo, l.AltMobile, l.Email,
           l.Address, l.City, l.State, l.Pincode,
           l.SourceId, src.Value AS SourceName,
           l.PartnerId, pr.Name AS PartnerName,
           l.ProductId, p.Name AS ProductName,
           l.StatusId, st.Value AS StatusName, st.Code AS StatusCode,
           l.OwnerId, o.FullName AS OwnerName, o.Avatar AS OwnerAvatar,
           l.EstValue, l.Remarks, l.NextFollowupDate, x.LastActivityAt,
           (SELECT TOP 1 f.Type FROM dbo.tblFollowUp f WHERE f.CompId = l.CompId AND f.LeadId = l.Id AND f.Status = 'open' ORDER BY f.DueAt, f.Id) AS NextFollowupType,  -- 119
           CAST(CASE WHEN l.NextFollowupDate < /*120*/ CASE WHEN CAST(l.NextFollowupDate AS TIME) = '00:00' THEN @Today ELSE GETDATE() END AND st.Code IN ('open','qualified') THEN 1 ELSE 0 END AS BIT) AS IsOverdue,
           l.LostReasonId, l.WonAt, l.WonValue, l.CustomerId, l.LostAt, l.AssignedAt,
           l.CreatedBy, l.EditBy, l.CreatedAt, l.UpdatedAt,
           200 AS ResponseCode, 'Leads retrieved successfully' AS ResponseMess
    FROM @Page x
    JOIN dbo.tblLeads l ON l.Id = x.Id
    JOIN dbo.tblLookup st ON st.Id = l.StatusId
    LEFT JOIN dbo.tblLookup src ON src.Id = l.SourceId
    LEFT JOIN dbo.tblPartner pr ON pr.Id = l.PartnerId
    LEFT JOIN dbo.tblProduct p ON p.Id = l.ProductId
    LEFT JOIN dbo.tblUser o ON o.Id = l.OwnerId
    LEFT JOIN dbo.tblBranch b ON b.Id = l.BranchId
    ORDER BY x.rn;

    -- Result set 2: pagination
    DECLARE @Total INT = ISNULL((SELECT MAX(Total) FROM @Page), 0);
    IF @Total = 0 AND @PageNumber > 1
        -- Asked for a page past the end: count still matters for the client.
        SELECT @Total = COUNT(*)
        FROM dbo.tblLeads l JOIN dbo.tblLookup st ON st.Id = l.StatusId
        WHERE l.CompId = @CompId
          AND (@BranchId   IS NULL OR l.BranchId  = @BranchId)
          AND (@StatusId   IS NULL OR l.StatusId  = @StatusId)
          AND (@StatusCode IS NULL OR st.Code     = @StatusCode)
          AND (@ProductId  IS NULL OR l.ProductId = @ProductId)
          AND (@OwnerId    IS NULL OR l.OwnerId   = @OwnerId)
          AND (@SourceId   IS NULL OR l.SourceId  = @SourceId)
          AND (@PartnerId  IS NULL OR l.PartnerId = @PartnerId)
          AND (@Unassigned = 0 OR l.OwnerId IS NULL)
          AND (@Overdue = 0 OR (l.NextFollowupDate < /*120*/ CASE WHEN CAST(l.NextFollowupDate AS TIME) = '00:00' THEN @Today ELSE GETDATE() END AND st.Code IN ('open','qualified')))
          AND (@FromDate IS NULL OR l.CreatedAt >= @FromDate)
          AND (@ToEx     IS NULL OR l.CreatedAt <  @ToEx)
          AND (@SearchTerm IS NULL OR l.Name LIKE '%' + @SearchTerm + '%'
                                  OR l.Company LIKE '%' + @SearchTerm + '%'
                                  OR l.MobileNo LIKE '%' + @SearchTerm + '%'
                                  OR l.Email LIKE '%' + @SearchTerm + '%'
                                  OR l.City LIKE '%' + @SearchTerm + '%')
          AND l.Id IN (SELECT LeadId FROM #VL);

    SELECT @Total AS TotalRecords,
           CASE WHEN @Total = 0 THEN 0 ELSE CEILING(CAST(@Total AS FLOAT) / @PageSize) END AS TotalPages,
           @PageNumber AS CurrentPage,
           @PageSize   AS PageSize;
END
GO

-- ---------------------------------------------------------------------------
-- 9. sp_FetchLeadDetail - 6 result sets, all empty when the lead is not
--    visible. RS1 gains CanEdit, CanReassign, SendBackToId, SendBackToName
--    (fn_RecordActions). Leads have no reopen.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchLeadDetail
    @CompId INT,
    @LeadId INT,
    @UserId INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Today DATETIME = CAST(CAST(GETDATE() AS DATE) AS DATETIME);

    DECLARE @Vis BIT = 0, @CanEdit BIT = 0, @CanReassign BIT = 0, @SendBackToId INT = NULL;
    SELECT @Vis = 1, @CanEdit = ISNULL(a.CanEdit, 0), @CanReassign = ISNULL(a.CanReassign, 0), @SendBackToId = a.SendBackToId
    FROM dbo.fn_RecordActions(@CompId, @UserId, 'leads', @LeadId) a;

    -- 1) core
    SELECT l.Id, l.CompId, l.BranchId, b.BranchName,
           l.Name, l.Company, l.MobileNo, l.AltMobile, l.Email,
           l.Address, l.City, l.State, l.Pincode,
           l.SourceId, src.Value AS SourceName,
           l.ProductId, p.Name AS ProductName,
           l.StatusId, st.Value AS StatusName, st.Code AS StatusCode,
           l.OwnerId, o.FullName AS OwnerName, o.Avatar AS OwnerAvatar,
           l.EstValue, l.Remarks, l.NextFollowupDate,
           CAST(CASE WHEN l.NextFollowupDate < /*120*/ CASE WHEN CAST(l.NextFollowupDate AS TIME) = '00:00' THEN @Today ELSE GETDATE() END AND st.Code IN ('open','qualified') THEN 1 ELSE 0 END AS BIT) AS IsOverdue,
           l.LostReasonId, lr.Value AS LostReason, l.WonAt, l.WonValue, l.CustomerId, cust.Name AS CustomerName, l.LostAt, l.AssignedAt,
           l.CreatedBy, l.EditBy, l.CreatedAt, l.UpdatedAt,
           l.PartnerId, pr.Name AS PartnerName, l.CommType, l.CommValue,   -- 107
           @CanEdit AS CanEdit, @CanReassign AS CanReassign,
           @SendBackToId AS SendBackToId, sb.FullName AS SendBackToName,
           200 AS ResponseCode, 'Lead detail retrieved successfully' AS ResponseMess
    FROM dbo.tblLeads l
    JOIN dbo.tblLookup st ON st.Id = l.StatusId
    LEFT JOIN dbo.tblLookup src ON src.Id = l.SourceId
    LEFT JOIN dbo.tblLookup lr  ON lr.Id  = l.LostReasonId
    LEFT JOIN dbo.tblProduct p  ON p.Id   = l.ProductId
    LEFT JOIN dbo.tblUser o     ON o.Id   = l.OwnerId
    LEFT JOIN dbo.tblBranch b   ON b.Id   = l.BranchId
    LEFT JOIN dbo.tblCustomer cust ON cust.Id = l.CustomerId AND cust.CompId = l.CompId
    LEFT JOIN dbo.tblPartner pr ON pr.Id = l.PartnerId   -- 107
    LEFT JOIN dbo.tblUser sb    ON sb.Id  = @SendBackToId
    WHERE l.Id = @LeadId AND l.CompId = @CompId AND @Vis = 1;

    -- 2) custom values
    SELECT d.Id AS FieldId, d.FieldKey, d.Label, d.Type,
           v.ValueText, v.ValueNumber, v.ValueDate
    FROM dbo.tblCustomFieldValue v
    INNER JOIN dbo.tblCustomFieldDef d ON d.Id = v.FieldId
    WHERE v.CompId = @CompId AND v.Entity = 'lead' AND v.EntityId = @LeadId AND @Vis = 1
    ORDER BY d.SortOrder;

    -- 3) timeline
    SELECT a.Id, a.LeadId, a.UserId, u.FullName AS UserName, u.Avatar AS UserAvatar,
           a.Type, a.Summary, a.MetaJSON, a.CreatedAt
    FROM dbo.tblLeadActivity a
    LEFT JOIN dbo.tblUser u ON u.Id = a.UserId
    WHERE a.CompId = @CompId AND a.LeadId = @LeadId AND @Vis = 1
    ORDER BY a.CreatedAt DESC, a.Id DESC;

    -- 4) follow-ups: open first (soonest due), then done/skipped newest first
    SELECT f.Id, f.LeadId, f.Type, f.DueAt, f.Status,
           f.AssignedTo, au.FullName AS AssignedToName,
           f.DoneAt, f.DoneBy, du.FullName AS DoneByName,
           f.OutcomeId, oc.Value AS Outcome, f.Remarks, f.Direction, f.Duration,
           CAST(CASE WHEN f.Status = 'open' AND f.DueAt < /*120*/ CASE WHEN CAST(f.DueAt AS TIME) = '00:00' THEN @Today ELSE GETDATE() END THEN 1 ELSE 0 END AS BIT) AS IsOverdue,
           f.CreatedBy, f.CreatedAt
    FROM dbo.tblFollowUp f
    LEFT JOIN dbo.tblUser au ON au.Id = f.AssignedTo
    LEFT JOIN dbo.tblUser du ON du.Id = f.DoneBy
    LEFT JOIN dbo.tblLookup oc ON oc.Id = f.OutcomeId
    WHERE f.CompId = @CompId AND f.LeadId = @LeadId AND @Vis = 1
    ORDER BY CASE WHEN f.Status = 'open' THEN 0 ELSE 1 END,
             CASE WHEN f.Status = 'open' THEN f.DueAt END ASC,
             f.DoneAt DESC, f.Id DESC;

    -- 5) assignment history, newest first
    SELECT a.Id, a.LeadId,
           a.FromUserId, fu.FullName AS FromUserName,
           a.ToUserId,   tu.FullName AS ToUserName,
           a.FromBranchId, fb.BranchName AS FromBranchName,
           a.ToBranchId,   tb.BranchName AS ToBranchName,
           a.ReasonId, r.Value AS Reason, a.Remarks,
           a.AssignedBy, ab.FullName AS AssignedByName, a.AssignedAt
    FROM dbo.tblLeadAssignment a
    LEFT JOIN dbo.tblUser fu ON fu.Id = a.FromUserId
    LEFT JOIN dbo.tblUser tu ON tu.Id = a.ToUserId
    LEFT JOIN dbo.tblUser ab ON ab.Id = a.AssignedBy
    LEFT JOIN dbo.tblBranch fb ON fb.Id = a.FromBranchId
    LEFT JOIN dbo.tblBranch tb ON tb.Id = a.ToBranchId
    LEFT JOIN dbo.tblLookup r ON r.Id = a.ReasonId
    WHERE a.CompId = @CompId AND a.LeadId = @LeadId AND @Vis = 1
    ORDER BY a.AssignedAt DESC, a.Id DESC;

    -- 6) commission rows of this lead, newest first (107)
    SELECT c.Id, c.PartnerId, p2.Name AS PartnerName, c.BaseValue, c.CommType, c.CommValue, c.Amount,
           c.Status, c.Reverted, c.EarnedAt, c.DueAt, c.PaidAt, c.PaidRef
    FROM dbo.tblPartnerCommission c JOIN dbo.tblPartner p2 ON p2.Id = c.PartnerId
    WHERE c.LeadId = @LeadId AND c.CompId = @CompId AND @Vis = 1
    ORDER BY c.Id DESC;
END
GO

-- ---------------------------------------------------------------------------
-- 10. sp_FetchFollowUps (spec 3.3). Two modes:
--   @LeadId > 0 : every follow-up on that lead, open first, no paging - only
--                 when the lead is visible (fn_VisibleLeads); else no rows.
--   otherwise   : cross-lead, paged, from fn_VisibleFollowUps (#VF, once).
--                 Via 1 = its lead is visible: the whole row, as before.
--                 Via 2 = open, delegated to me: lead columns limited to
--                 name, company, mobile and OwnerName (who the lead is
--                 assigned to); BranchId, OwnerId, StatusId, LeadStatus,
--                 LeadStatusCode NULL. Via 3 = open, delegated to one of my
--                 people: the same with LeadMobile NULL, and the search does
--                 not match on its mobile. A follow-up that is no longer open
--                 is only ever Via 1 (the definition). + Via column.
--                 @Overdue = open and past due. @DueFrom/@DueTo bracket DueAt.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchFollowUps
    @CompId     INT,
    @LeadId     INT           = 0,
    @AssignedTo INT           = NULL,
    @Status     VARCHAR(20)   = NULL,
    @DueFrom    DATETIME      = NULL,
    @DueTo      DATETIME      = NULL,
    @Overdue    BIT           = 0,
    @SearchTerm NVARCHAR(200) = NULL,
    @PageNumber INT           = 1,
    @PageSize   INT           = 25,
    @UserId     INT,
    @DoneFrom   DATETIME      = NULL,   -- 118: inclusive
    @DoneTo     DATETIME      = NULL    -- 118: EXCLUSIVE instant, unlike @DueTo (inclusive day)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Today DATETIME = CAST(CAST(GETDATE() AS DATE) AS DATETIME);

    IF ISNULL(@LeadId, 0) > 0
    BEGIN
        DECLARE @LeadOk BIT = CASE WHEN EXISTS (SELECT 1 FROM dbo.fn_VisibleLeads(@CompId, @UserId) v
                                                WHERE v.LeadId = @LeadId) THEN 1 ELSE 0 END;
        SELECT f.Id, f.LeadId, f.Type, f.DueAt, f.Status,
               f.AssignedTo, au.FullName AS AssignedToName,
               f.DoneAt, f.DoneBy, du.FullName AS DoneByName,
               f.OutcomeId, oc.Value AS Outcome, f.Remarks, f.Direction, f.Duration,
               CAST(CASE WHEN f.Status = 'open' AND f.DueAt < /*120*/ CASE WHEN CAST(f.DueAt AS TIME) = '00:00' THEN @Today ELSE GETDATE() END THEN 1 ELSE 0 END AS BIT) AS IsOverdue,
               f.CreatedBy, f.CreatedAt,
               200 AS ResponseCode, 'Follow-ups retrieved successfully' AS ResponseMess
        FROM dbo.tblFollowUp f
        LEFT JOIN dbo.tblUser au ON au.Id = f.AssignedTo
        LEFT JOIN dbo.tblUser du ON du.Id = f.DoneBy
        LEFT JOIN dbo.tblLookup oc ON oc.Id = f.OutcomeId
        WHERE f.CompId = @CompId AND f.LeadId = @LeadId AND @LeadOk = 1
        ORDER BY CASE WHEN f.Status = 'open' THEN 0 ELSE 1 END,
                 CASE WHEN f.Status = 'open' THEN f.DueAt END ASC,
                 f.DoneAt DESC, f.Id DESC;
        RETURN;
    END

    SET @PageNumber = CASE WHEN ISNULL(@PageNumber,1) < 1 THEN 1 ELSE @PageNumber END;
    SET @PageSize   = CASE WHEN ISNULL(@PageSize,25) < 1 THEN 25 ELSE @PageSize END;
    IF @SearchTerm IS NOT NULL AND LTRIM(RTRIM(@SearchTerm)) = '' SET @SearchTerm = NULL;
    IF @Status IS NOT NULL AND LTRIM(RTRIM(@Status)) = '' SET @Status = NULL;

    CREATE TABLE #VF (FollowUpId INT PRIMARY KEY, Via TINYINT NOT NULL);
    INSERT INTO #VF (FollowUpId, Via) SELECT FollowUpId, Via FROM dbo.fn_VisibleFollowUps(@CompId, @UserId);

    DECLARE @Page TABLE (Id INT, Total INT, rn INT);
    INSERT INTO @Page (Id, Total, rn)
    SELECT f.Id, COUNT(*) OVER (), ROW_NUMBER() OVER (ORDER BY f.DueAt ASC, f.Id ASC)
    FROM dbo.tblFollowUp f
    JOIN #VF vf ON vf.FollowUpId = f.Id
    JOIN dbo.tblLeads l ON l.Id = f.LeadId AND l.CompId = f.CompId
    JOIN dbo.tblLookup st ON st.Id = l.StatusId
    WHERE f.CompId = @CompId
      AND (@AssignedTo IS NULL OR f.AssignedTo = @AssignedTo)
      AND (@Status IS NULL OR f.Status = @Status)
      AND (@DueFrom IS NULL OR f.DueAt >= @DueFrom)
      AND (@DueTo   IS NULL OR f.DueAt <  DATEADD(DAY, 1, CAST(CAST(@DueTo AS DATE) AS DATETIME)))
      AND (@DoneFrom IS NULL OR f.DoneAt >= @DoneFrom)  -- 118
      AND (@DoneTo   IS NULL OR f.DoneAt <  @DoneTo)    -- 118
      AND (@Overdue = 0 OR (f.Status = 'open' AND f.DueAt < /*120*/ CASE WHEN CAST(f.DueAt AS TIME) = '00:00' THEN @Today ELSE GETDATE() END AND st.Code IN ('open','qualified')))
      AND (@SearchTerm IS NULL OR l.Name LIKE '%' + @SearchTerm + '%'
                              OR l.Company LIKE '%' + @SearchTerm + '%'
                              OR (vf.Via IN (1, 2) AND l.MobileNo LIKE '%' + @SearchTerm + '%')
                              OR f.Remarks LIKE '%' + @SearchTerm + '%')
    ORDER BY f.DueAt ASC, f.Id ASC
    OFFSET (@PageNumber - 1) * @PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;

    SELECT f.Id, f.LeadId, l.Name AS LeadName, l.Company AS LeadCompany,
           CASE WHEN vf.Via IN (1, 2) THEN l.MobileNo END AS LeadMobile,
           CASE WHEN vf.Via = 1 THEN l.BranchId END AS BranchId,
           CASE WHEN vf.Via = 1 THEN l.OwnerId END AS OwnerId, o.FullName AS OwnerName,
           CASE WHEN vf.Via = 1 THEN l.StatusId END AS StatusId,
           CASE WHEN vf.Via = 1 THEN st.Value END AS LeadStatus,
           CASE WHEN vf.Via = 1 THEN st.Code END AS LeadStatusCode,
           f.Type, f.DueAt, f.Status,
           f.AssignedTo, au.FullName AS AssignedToName,
           f.DoneAt, f.DoneBy, du.FullName AS DoneByName,
           f.OutcomeId, oc.Value AS Outcome, f.Remarks, f.Direction, f.Duration,
           CAST(CASE WHEN f.Status = 'open' AND f.DueAt < /*120*/ CASE WHEN CAST(f.DueAt AS TIME) = '00:00' THEN @Today ELSE GETDATE() END THEN 1 ELSE 0 END AS BIT) AS IsOverdue,
           f.CreatedBy, f.CreatedAt,
           vf.Via,
           200 AS ResponseCode, 'Follow-ups retrieved successfully' AS ResponseMess
    FROM @Page x
    JOIN dbo.tblFollowUp f ON f.Id = x.Id
    JOIN #VF vf ON vf.FollowUpId = f.Id
    JOIN dbo.tblLeads l ON l.Id = f.LeadId
    JOIN dbo.tblLookup st ON st.Id = l.StatusId
    LEFT JOIN dbo.tblUser o  ON o.Id  = l.OwnerId
    LEFT JOIN dbo.tblUser au ON au.Id = f.AssignedTo
    LEFT JOIN dbo.tblUser du ON du.Id = f.DoneBy
    LEFT JOIN dbo.tblLookup oc ON oc.Id = f.OutcomeId
    ORDER BY x.rn;

    DECLARE @Total INT = ISNULL((SELECT MAX(Total) FROM @Page), 0);
    SELECT @Total AS TotalRecords,
           CASE WHEN @Total = 0 THEN 0 ELSE CEILING(CAST(@Total AS FLOAT) / @PageSize) END AS TotalPages,
           @PageNumber AS CurrentPage, @PageSize AS PageSize;
END
GO

-- ---------------------------------------------------------------------------
-- 11. sp_FetchFollowUpLead - one row: the follow-up, only when it is in
--     fn_VisibleFollowUps for @UserId (else no row). + Via, CanAct.
--     CanAct (complete / skip / delete) = its lead is visible (Via 1) or it is
--     open and delegated to me (Via 2); a manager's Via 3 line is look-only.
--     The lead's BranchId / OwnerId / CreatedBy only on Via 1.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchFollowUpLead
    @CompId INT,
    @Id     INT,
    @UserId INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT f.Id, f.LeadId, f.Status, f.AssignedTo,
           CASE WHEN v.Via = 1 THEN l.BranchId END AS BranchId,
           CASE WHEN v.Via = 1 THEN l.OwnerId END AS OwnerId,
           CASE WHEN v.Via = 1 THEN l.CreatedBy END AS CreatedBy,
           v.Via,
           CAST(CASE WHEN v.Via IN (1, 2) THEN 1 ELSE 0 END AS BIT) AS CanAct
    FROM dbo.tblFollowUp f
    JOIN dbo.tblLeads l ON l.Id = f.LeadId AND l.CompId = f.CompId
    JOIN dbo.fn_VisibleFollowUps(@CompId, @UserId) v ON v.FollowUpId = f.Id
    WHERE f.Id = @Id AND f.CompId = @CompId;
END
GO

-- ---------------------------------------------------------------------------
-- 12. sp_FetchQuotations - the list, and (with @LeadId) a lead's own tab.
--     Visibility is the LEAD's: fn_VisibleLeads (#VL, once). Filters narrow.
--     Superseded revisions are hidden unless asked for by name.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchQuotations
    @CompId     INT,
    @PageNumber INT           = 1,
    @PageSize   INT           = 25,
    @SearchTerm NVARCHAR(200) = NULL,
    @Status     VARCHAR(20)   = NULL,
    @OwnerId    INT           = NULL,
    @BranchId   INT           = NULL,
    @LeadId     INT           = NULL,
    @FromDate   DATE          = NULL,
    @ToDate     DATE          = NULL,
    @UserId     INT
AS
BEGIN
    SET NOCOUNT ON;

    SET @PageNumber = CASE WHEN ISNULL(@PageNumber, 1) < 1 THEN 1 ELSE @PageNumber END;
    SET @PageSize   = CASE WHEN ISNULL(@PageSize, 25) < 1 THEN 25 ELSE @PageSize END;
    IF @SearchTerm IS NOT NULL AND LTRIM(RTRIM(@SearchTerm)) = '' SET @SearchTerm = NULL;
    IF @Status     IS NOT NULL AND LTRIM(RTRIM(@Status))     = '' SET @Status = NULL;

    CREATE TABLE #VL (LeadId INT PRIMARY KEY);
    INSERT INTO #VL (LeadId) SELECT LeadId FROM dbo.fn_VisibleLeads(@CompId, @UserId);

    DECLARE @Today DATE = CAST(GETDATE() AS DATE);

    DECLARE @Page TABLE (Id INT, rn INT);
    DECLARE @Total INT;

    SELECT q.Id, q.CreatedAt
    INTO #f
    FROM dbo.tblQuotation q
    JOIN dbo.tblLeads l ON l.Id = q.LeadId AND l.CompId = q.CompId
    JOIN #VL v          ON v.LeadId = l.Id
    WHERE q.CompId = @CompId
      AND (@LeadId   IS NULL OR q.LeadId   = @LeadId)
      AND (@BranchId IS NULL OR l.BranchId = @BranchId)
      AND (@OwnerId  IS NULL OR l.OwnerId  = @OwnerId)
      AND (@FromDate IS NULL OR q.QuoteDate >= @FromDate)
      AND (@ToDate   IS NULL OR q.QuoteDate <= @ToDate)
      AND ( (@Status IS NULL AND q.Status <> 'superseded') OR q.Status = @Status )
      AND (@SearchTerm IS NULL OR q.QuoteNo   LIKE '%' + @SearchTerm + '%'
                              OR q.ToName    LIKE '%' + @SearchTerm + '%'
                              OR q.ToCompany LIKE '%' + @SearchTerm + '%'
                              OR l.Name      LIKE '%' + @SearchTerm + '%');

    SET @Total = (SELECT COUNT(*) FROM #f);

    INSERT INTO @Page (Id, rn)
    SELECT Id, ROW_NUMBER() OVER (ORDER BY CreatedAt DESC, Id DESC)
    FROM #f
    ORDER BY CreatedAt DESC, Id DESC
    OFFSET (@PageNumber - 1) * @PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;

    -- Result set 1: the page
    SELECT q.Id, q.CompId, q.LeadId, l.Name AS LeadName, l.Company AS LeadCompany,
           q.RootId, q.Revision, q.QuoteNo, q.Status, q.TemplateCode, q.QuoteDate, q.ValidTill, q.Subject,
           q.ToName, q.ToCompany, q.TaxableTotal, q.GrandTotal,
           CAST(CASE WHEN q.Status = 'final' AND q.ValidTill IS NOT NULL AND q.ValidTill < @Today THEN 1 ELSE 0 END AS BIT) AS IsExpired,
           l.OwnerId, o.FullName AS OwnerName, l.BranchId, b.BranchName,
           q.CreatedBy, cu.FullName AS CreatedByName, q.CreatedAt, q.FinalisedAt, q.ClosedAt, q.CloseRemarks,
           200 AS ResponseCode, 'Quotations retrieved successfully' AS ResponseMess
    FROM @Page x
    JOIN dbo.tblQuotation q ON q.Id = x.Id
    JOIN dbo.tblLeads l     ON l.Id = q.LeadId
    LEFT JOIN dbo.tblUser o   ON o.Id  = l.OwnerId
    LEFT JOIN dbo.tblUser cu  ON cu.Id = q.CreatedBy
    LEFT JOIN dbo.tblBranch b ON b.Id  = l.BranchId
    ORDER BY x.rn;

    -- Result set 2: pagination
    SELECT @Total AS TotalRecords,
           CASE WHEN @Total = 0 THEN 0 ELSE CEILING(CAST(@Total AS FLOAT) / @PageSize) END AS TotalPages,
           @PageNumber AS CurrentPage,
           @PageSize   AS PageSize;

    DROP TABLE #f;
END
GO

-- ---------------------------------------------------------------------------
-- 13. sp_FetchQuotationDetail - 3 result sets, all empty unless the
--     quotation's lead is visible to @UserId (fn_RecordActions on the lead).
--     RS1 still carries the LEAD's OwnerId / BranchId / CreatedBy, and gains
--     CanEdit (the lead's: a quotation has no permission model of its own).
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchQuotationDetail
    @CompId      INT,
    @QuotationId INT,
    @UserId      INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Today DATE = CAST(GETDATE() AS DATE);

    DECLARE @LeadId INT = (SELECT LeadId FROM dbo.tblQuotation WHERE Id = @QuotationId AND CompId = @CompId);
    DECLARE @Vis BIT = 0, @CanEdit BIT = 0;
    SELECT @Vis = 1, @CanEdit = ISNULL(a.CanEdit, 0)
    FROM dbo.fn_RecordActions(@CompId, @UserId, 'leads', @LeadId) a;

    -- 1) header
    SELECT q.Id, q.CompId, q.LeadId, q.CustomerId, q.RootId, q.Revision, q.FinYear, q.SeqNo, q.QuoteNo,
           q.TemplateCode, q.Status, q.QuoteDate, q.ValidTill, q.Subject,
           q.ToName, q.ToCompany, q.ToMobile, q.ToEmail, q.ToAddress, q.ToCity, q.ToStateCode, q.ToPincode, q.ToGSTIN,
           q.SellerGSTIN, q.SellerStateCode, q.CompanyJSON, q.ContentJSON,
           q.SubTotal, q.DiscountTotal, q.TaxableTotal, q.CgstTotal, q.SgstTotal, q.IgstTotal, q.RoundOff, q.GrandTotal,
           q.FinalisedAt, q.FinalisedBy, q.ClosedAt, q.ClosedBy, q.CloseRemarks,
           CAST(CASE WHEN q.Status = 'final' AND q.ValidTill IS NOT NULL AND q.ValidTill < @Today THEN 1 ELSE 0 END AS BIT) AS IsExpired,
           l.Name AS LeadName, l.Company AS LeadCompany, st.Code AS LeadStatusCode, l.EstValue AS LeadEstValue,
           l.ProductId AS LeadProductId,
           l.OwnerId, o.FullName AS OwnerName, l.BranchId, b.BranchName, l.CreatedBy,
           q.CreatedBy AS QuoteCreatedBy, cu.FullName AS QuoteCreatedByName, q.CreatedAt, q.UpdatedAt,
           @CanEdit AS CanEdit,
           200 AS ResponseCode, 'Quotation retrieved successfully' AS ResponseMess
    FROM dbo.tblQuotation q
    JOIN dbo.tblLeads l        ON l.Id = q.LeadId AND l.CompId = q.CompId
    JOIN dbo.tblLookup st      ON st.Id = l.StatusId
    LEFT JOIN dbo.tblUser o    ON o.Id  = l.OwnerId
    LEFT JOIN dbo.tblUser cu   ON cu.Id = q.CreatedBy
    LEFT JOIN dbo.tblBranch b  ON b.Id  = l.BranchId
    WHERE q.Id = @QuotationId AND q.CompId = @CompId AND @Vis = 1;

    -- 2) lines
    SELECT ln.Id, ln.SortOrder, ln.ProductId, ln.Description, ln.HSNCode, ln.Qty, ln.Unit, ln.Rate,
           ln.DiscountType, ln.DiscountValue, ln.TaxPct,
           ln.GrossAmt, ln.DiscountAmt, ln.TaxableAmt, ln.CgstAmt, ln.SgstAmt, ln.IgstAmt, ln.LineTotal
    FROM dbo.tblQuotationLine ln
    WHERE ln.QuotationId = @QuotationId AND ln.CompId = @CompId AND @Vis = 1
    ORDER BY ln.SortOrder, ln.Id;

    -- 3) revisions of the same root, newest first
    SELECT r.Id, r.Revision, r.QuoteNo, r.Status, r.GrandTotal, r.QuoteDate, r.FinalisedAt, r.ClosedAt, r.CloseRemarks
    FROM dbo.tblQuotation r
    WHERE r.CompId = @CompId AND @Vis = 1
      AND r.RootId = (SELECT RootId FROM dbo.tblQuotation WHERE Id = @QuotationId AND CompId = @CompId)
    ORDER BY r.Revision DESC;
END
GO

-- ---------------------------------------------------------------------------
-- 14. sp_FetchCustomers - the customers rule is unchanged (Node still feeds
--     the customers lists; spec 3.4). Only the complaint figures change
--     (F4): Open / Total / LastTicketAt count complaints the viewer can open
--     (fn_VisibleTickets; no complaints View = 0 / 0 / NULL). @UserId loses
--     its default (N1a).
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchCustomers
    @CompId                  INT,
    @PageNumber              INT           = 1,
    @PageSize                INT           = 25,
    @SearchTerm              NVARCHAR(200) = NULL,
    @BranchId                INT           = NULL,
    @IsActive                BIT           = 1,
    @UserId                  INT,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL
AS
BEGIN
    -- Scoped by the customers module (office + CreatedBy as owner), paged, newest first.
    -- Search: Name / ContactPerson / Mobile / AltMobile / Email / City. A
    -- digits-only term also matches a mobile typed with spaces or dashes.
    -- @IsActive NULL = both live and soft-deleted rows.
    SET NOCOUNT ON;

    SET @PageNumber = CASE WHEN ISNULL(@PageNumber, 1)  < 1 THEN 1  ELSE @PageNumber END;
    SET @PageSize   = CASE WHEN ISNULL(@PageSize,  25)  < 1 THEN 25 ELSE @PageSize   END;
    SET @SearchTerm = NULLIF(LTRIM(RTRIM(@SearchTerm)), N'');
    DECLARE @Digits VARCHAR(50) = CASE WHEN @SearchTerm IS NOT NULL
                                        AND REPLACE(REPLACE(@SearchTerm, ' ', ''), '-', '') NOT LIKE '%[^0-9+]%'
                                       THEN REPLACE(REPLACE(@SearchTerm, ' ', ''), '-', '') END;

    DECLARE @BranchIds TABLE (BranchId INT PRIMARY KEY);
    DECLARE @OwnerIds  TABLE (OwnerId  INT PRIMARY KEY);
    DECLARE @UseBranchScope BIT = 0, @UseOwnerScope BIT = 0;
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
    BEGIN
        INSERT INTO @BranchIds (BranchId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@AccessibleBranchIdsJson);
        SET @UseBranchScope = 1;
    END
    IF (@OwnerIdsJson IS NOT NULL AND @OwnerIdsJson <> '')
    BEGIN
        INSERT INTO @OwnerIds (OwnerId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@OwnerIdsJson);
        SET @UseOwnerScope = 1;
    END

    -- One predicate, one scan: the matching ids, then count and page from them.
    DECLARE @F TABLE (Id INT PRIMARY KEY, CreatedAt DATETIME);
    INSERT INTO @F (Id, CreatedAt)
    SELECT c.Id, c.CreatedAt
    FROM dbo.tblCustomer c
    WHERE c.CompId = @CompId
      AND (@IsActive IS NULL OR c.IsActive = @IsActive)
      AND (@BranchId IS NULL OR c.BranchId = @BranchId)
      AND (
            (    (@UseBranchScope = 0 OR c.BranchId  IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR c.CreatedBy IN (SELECT OwnerId  FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND c.CreatedBy = @UserId)
          )
      AND (@SearchTerm IS NULL
           OR c.Name          LIKE '%' + @SearchTerm + '%'
           OR c.ContactPerson LIKE '%' + @SearchTerm + '%'
           OR c.Mobile        LIKE '%' + ISNULL(@Digits, @SearchTerm) + '%'
           OR c.AltMobile     LIKE '%' + ISNULL(@Digits, @SearchTerm) + '%'
           OR c.Email         LIKE '%' + @SearchTerm + '%'
           OR c.City          LIKE '%' + @SearchTerm + '%');

    DECLARE @Total INT = (SELECT COUNT(*) FROM @F);

    -- Complaints the viewer can open (F4), once per call.
    CREATE TABLE #VT (TicketId INT PRIMARY KEY);
    INSERT INTO #VT (TicketId) SELECT TicketId FROM dbo.fn_VisibleTickets(@CompId, @UserId);

    -- RS1: the page, with the viewer's complaint counts
    SELECT c.Id, c.CompId, c.BranchId, b.BranchName,
           c.Name, c.ContactPerson, c.Mobile, c.AltMobile, c.Email,
           c.Address, c.City, c.State, c.Pincode, c.GSTIN, c.Remarks, c.IsActive,
           ISNULL(tk.OpenTickets, 0) AS OpenTickets,
           ISNULL(tk.TotalTickets, 0) AS TotalTickets,
           tk.LastTicketAt,
           c.CreatedAt, c.UpdatedAt,
           200 AS ResponseCode, 'Customers retrieved successfully' AS ResponseMess
    FROM @F f
    JOIN dbo.tblCustomer c ON c.Id = f.Id
    LEFT JOIN dbo.tblBranch b ON b.Id = c.BranchId
    OUTER APPLY (
        SELECT COUNT(*) AS TotalTickets,
               SUM(CASE WHEN st.Code IN ('open', 'onhold') THEN 1 ELSE 0 END) AS OpenTickets,
               MAX(t.CreatedAt) AS LastTicketAt
        FROM dbo.tblTicket t
        JOIN #VT v ON v.TicketId = t.Id
        JOIN dbo.tblLookup st ON st.Id = t.StatusId
        WHERE t.CompId = c.CompId AND t.CustomerId = c.Id
    ) tk
    ORDER BY f.CreatedAt DESC, f.Id DESC
    OFFSET (@PageNumber - 1) * @PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;

    -- RS2: pagination
    SELECT @PageNumber AS CurrentPage,
           @PageSize   AS PageSize,
           @Total      AS TotalRecords,
           CASE WHEN @Total = 0 THEN 0 ELSE CEILING(CAST(@Total AS FLOAT) / @PageSize) END AS TotalPages;
END
GO

-- ---------------------------------------------------------------------------
-- 15. sp_FetchCustomerDetail - RS1 the customer (Node still checks the
--     customers rule before calling); RS1 counts and RS2 the complaint list
--     come from fn_VisibleTickets (F3, F4, F6): only complaints the viewer
--     can open, none without the complaints module. The two JSON lists (the
--     old complaints scope) are gone.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchCustomerDetail
    @CompId     INT,
    @CustomerId INT,
    @UserId     INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Now DATETIME = GETDATE();

    CREATE TABLE #VT (TicketId INT PRIMARY KEY);
    INSERT INTO #VT (TicketId) SELECT TicketId FROM dbo.fn_VisibleTickets(@CompId, @UserId);

    -- RS1: the customer
    SELECT c.Id, c.CompId, c.BranchId, b.BranchName,
           c.Name, c.ContactPerson, c.Mobile, c.AltMobile, c.Email,
           c.Address, c.City, c.State, c.Pincode, c.GSTIN, c.Remarks, c.IsActive,
           c.CreatedBy,   -- 096: Node's visibility check needs the owner
           ISNULL(tk.OpenTickets, 0) AS OpenTickets,
           ISNULL(tk.TotalTickets, 0) AS TotalTickets,
           tk.LastTicketAt,
           c.CreatedAt, c.UpdatedAt,
           200 AS ResponseCode, 'Customer detail retrieved successfully' AS ResponseMess
    FROM dbo.tblCustomer c
    LEFT JOIN dbo.tblBranch b ON b.Id = c.BranchId
    OUTER APPLY (
        SELECT COUNT(*) AS TotalTickets,
               SUM(CASE WHEN st.Code IN ('open', 'onhold') THEN 1 ELSE 0 END) AS OpenTickets,
               MAX(t.CreatedAt) AS LastTicketAt
        FROM dbo.tblTicket t
        JOIN #VT v ON v.TicketId = t.Id
        JOIN dbo.tblLookup st ON st.Id = t.StatusId
        WHERE t.CompId = c.CompId AND t.CustomerId = c.Id
    ) tk
    WHERE c.Id = @CustomerId AND c.CompId = @CompId;

    -- RS2: their complaints the viewer can open
    SELECT t.Id, t.TicketNo, t.Subject,
           t.StatusId, st.Value AS StatusName, st.Code AS StatusCode,
           t.Priority, p.Value AS PriorityName,
           t.AssignedTo, a.FullName AS AssigneeName,
           t.DueAt,
           CAST(CASE WHEN st.Code IN ('open', 'onhold') AND t.DueAt < @Now THEN 1 ELSE 0 END AS BIT) AS IsOverdue,
           t.CreatedAt, t.ResolvedAt, t.ClosedAt
    FROM dbo.tblTicket t
    JOIN #VT v                ON v.TicketId = t.Id
    JOIN dbo.tblLookup st     ON st.Id = t.StatusId
    LEFT JOIN dbo.tblLookup p ON p.Id  = t.Priority
    LEFT JOIN dbo.tblUser a   ON a.Id  = t.AssignedTo
    WHERE t.CompId = @CompId AND t.CustomerId = @CustomerId
    ORDER BY t.CreatedAt DESC, t.Id DESC;
END
GO

-- ---------------------------------------------------------------------------
-- 16. sp_Dashboard (spec 3.6, F6). Takes the company and the person only.
--     #VL = fn_VisibleLeads   - every lead figure (the 13 old copies)
--     #VT = fn_VisibleTickets - complaint figures and complaint calls
--     #VF = fn_VisibleFollowUps, Via 1 / 2 - the two follow-up counts (a
--           manager's look-only Via 3 lines are not counted as theirs)
--     #RT = fn_ReportTree people - lead calls by the activity rule: a done
--           call follow-up counts when its lead is visible OR whoever did it
--           (DoneBy) has a line in the viewer's Team report.
--     No View on a module = zeros for that module, whatever carries the name.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_Dashboard
    @CompId BIGINT,
    @UserId INT
AS
BEGIN
    SET NOCOUNT ON;

    CREATE TABLE #VL (LeadId INT PRIMARY KEY);
    CREATE TABLE #VT (TicketId INT PRIMARY KEY);
    CREATE TABLE #VF (FollowUpId INT PRIMARY KEY);
    CREATE TABLE #RT (PersonId INT PRIMARY KEY);
    INSERT INTO #VL (LeadId)     SELECT LeadId FROM dbo.fn_VisibleLeads(@CompId, @UserId);
    INSERT INTO #VT (TicketId)   SELECT TicketId FROM dbo.fn_VisibleTickets(@CompId, @UserId);
    INSERT INTO #VF (FollowUpId) SELECT FollowUpId FROM dbo.fn_VisibleFollowUps(@CompId, @UserId) WHERE Via IN (1, 2);
    INSERT INTO #RT (PersonId)   SELECT PersonId FROM dbo.fn_ReportTree(@CompId, @UserId) WHERE Depth = 0;

    DECLARE @Today DATETIME = CAST(CAST(GETDATE() AS DATE) AS DATETIME);

    /* RS0 — KPI rows */
    SELECT 'WonMonth' AS Type, CAST(COUNT(*) AS DECIMAL(18,2)) AS Number
    FROM tblLeads l
    WHERE l.CompId = @CompId
      AND l.WonAt >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)
      AND l.Id IN (SELECT LeadId FROM #VL)
    UNION ALL
    SELECT 'WonValueMonth', CAST(ISNULL(SUM(l.WonValue), 0) AS DECIMAL(18,2))
    FROM tblLeads l
    WHERE l.CompId = @CompId
      AND l.WonAt >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)
      AND l.Id IN (SELECT LeadId FROM #VL)
    UNION ALL
    SELECT 'TotalLeads', COUNT(*)
    FROM tblLeads l
    WHERE l.CompId = @CompId
      AND l.Id IN (SELECT LeadId FROM #VL)

    UNION ALL

    SELECT 'TodayNewLeads', COUNT(*)
    FROM tblLeads l
    WHERE l.CompId = @CompId
      AND CAST(l.CreatedAt AS DATE) = CAST(GETDATE() AS DATE)
      AND l.Id IN (SELECT LeadId FROM #VL)

    UNION ALL

    SELECT 'TodayFollowups', COUNT(*)
    FROM tblFollowUp f
    JOIN tblLeads l ON l.Id = f.LeadId AND l.CompId = f.CompId
    JOIN tblLookup st ON st.Id = l.StatusId
    WHERE f.CompId = @CompId AND f.Status = 'open'
      AND CAST(f.DueAt AS DATE) = CAST(GETDATE() AS DATE)
      AND st.Code IN ('open','qualified')
      AND f.Id IN (SELECT FollowUpId FROM #VF)

    UNION ALL

    SELECT 'MissedFollowups', COUNT(*)
    FROM tblFollowUp f
    JOIN tblLeads l ON l.Id = f.LeadId AND l.CompId = f.CompId
    JOIN tblLookup st ON st.Id = l.StatusId
    WHERE f.CompId = @CompId AND f.Status = 'open'
      AND f.DueAt < /*120*/ CASE WHEN CAST(f.DueAt AS TIME) = '00:00' THEN @Today ELSE GETDATE() END
      AND st.Code IN ('open','qualified')
      AND f.Id IN (SELECT FollowUpId FROM #VF);

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
               AND l.Id IN (SELECT LeadId FROM #VL)) AS Leads,
           (SELECT COUNT(*) FROM tblLeads l
             WHERE l.CompId = @CompId
               AND CAST(l.WonAt AS DATE) = d.D
               AND l.Id IN (SELECT LeadId FROM #VL)) AS Converted
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
          AND l.Id IN (SELECT LeadId FROM #VL)
        GROUP BY ISNULL(lk.Value, N'Unknown')
    )
    SELECT x.Name, x.Value
    FROM (
        SELECT Name, Value, rn FROM src WHERE rn <= 5
        UNION ALL
        SELECT N'Other', SUM(Value), 6 FROM src WHERE rn > 5 HAVING SUM(Value) > 0
    ) x
    ORDER BY x.rn;

    /* RS3 — funnel: leads per status (visibility lives in the LEFT JOIN's ON,
       so a hidden lead drops out without dropping the status row) */
    SELECT st.Value AS Name, COUNT(l.Id) AS Value, st.SortOrder
    FROM tblLookup st
    LEFT JOIN tblLeads l
           ON l.StatusId = st.Id AND l.CompId = @CompId
          AND l.Id IN (SELECT LeadId FROM #VL)
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
      AND l.Id IN (SELECT LeadId FROM #VL)
    GROUP BY u.Id, u.FullName
    ORDER BY Value DESC;

    /* RS5 — activity per quarter, current year */
    ;WITH q AS (SELECT v.n FROM (VALUES (1),(2),(3),(4)) v(n))
    SELECT 'Q' + CAST(q.n AS VARCHAR(1)) AS Name,
           (SELECT COUNT(*) FROM tblLeads l
             WHERE l.CompId = @CompId
               AND YEAR(l.CreatedAt) = YEAR(GETDATE())
               AND DATEPART(QUARTER, l.CreatedAt) = q.n
               AND l.Id IN (SELECT LeadId FROM #VL)) AS Leads,
           (SELECT COUNT(*) FROM tblFollowUp f
             WHERE f.CompId = @CompId AND f.Type = 'call' AND f.Status = 'done'
               AND YEAR(f.DoneAt) = YEAR(GETDATE())
               AND DATEPART(QUARTER, f.DoneAt) = q.n
               AND (   f.LeadId IN (SELECT LeadId FROM #VL)
                    OR f.DoneBy IN (SELECT PersonId FROM #RT)))
           + (SELECT COUNT(*) FROM tblCall c
               JOIN tblTicket bt ON bt.Id = c.TicketId AND bt.CompId = c.CompId
              WHERE c.CompId = @CompId
                AND YEAR(c.CalledAt) = YEAR(GETDATE())
                AND DATEPART(QUARTER, c.CalledAt) = q.n
                AND bt.Id IN (SELECT TicketId FROM #VT)) AS Calls,
           (SELECT COUNT(*) FROM tblTicket t
             WHERE t.CompId = @CompId
               AND YEAR(t.CreatedAt) = YEAR(GETDATE())
               AND DATEPART(QUARTER, t.CreatedAt) = q.n
               AND t.Id IN (SELECT TicketId FROM #VT)) AS Tickets
    FROM q
    ORDER BY q.n;
END
GO

-- ---------------------------------------------------------------------------
-- 17. Support reports: complaints the viewer can open (fn_VisibleTickets);
--     @BranchId only narrows.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_TicketsByCategory
    @CompId   INT,
    @BranchId INT = NULL,
    @UserId   INT
AS
BEGIN
    SET NOCOUNT ON;

    CREATE TABLE #VT (TicketId INT PRIMARY KEY);
    INSERT INTO #VT (TicketId) SELECT TicketId FROM dbo.fn_VisibleTickets(@CompId, @UserId);

    SELECT lk.Id AS CategoryId, lk.Value AS CategoryName,
           COUNT(t.Id) AS TicketCount,
           200 AS ResponseCode, 'Tickets by category retrieved successfully' AS ResponseMess
    FROM dbo.tblLookup lk
    LEFT JOIN dbo.tblTicket t
           ON t.CategoryId = lk.Id AND t.CompId = @CompId
          AND (@BranchId IS NULL OR t.BranchId = @BranchId)
          AND t.Id IN (SELECT TicketId FROM #VT)
    WHERE lk.CompId = @CompId AND lk.Kind = 'ticket_category' AND lk.IsActive = 1
    GROUP BY lk.Id, lk.Value, lk.SortOrder
    ORDER BY lk.SortOrder;
END
GO

CREATE OR ALTER PROC dbo.sp_ResolutionSummary
    @CompId   INT,
    @BranchId INT = NULL,
    @UserId   INT
AS
BEGIN
    SET NOCOUNT ON;

    CREATE TABLE #VT (TicketId INT PRIMARY KEY);
    INSERT INTO #VT (TicketId) SELECT TicketId FROM dbo.fn_VisibleTickets(@CompId, @UserId);

    SELECT lk.Id AS ResolutionId, lk.Value AS ResolutionName,
           COUNT(t.Id) AS TicketCount,
           AVG(DATEDIFF(MINUTE, t.CreatedAt, t.ResolvedAt)) AS AvgResolutionMins,
           200 AS ResponseCode, 'Resolution summary retrieved successfully' AS ResponseMess
    FROM dbo.tblLookup lk
    LEFT JOIN dbo.tblTicket t
           ON t.ResolutionId = lk.Id AND t.CompId = @CompId AND t.ResolvedAt IS NOT NULL
          AND (@BranchId IS NULL OR t.BranchId = @BranchId)
          AND t.Id IN (SELECT TicketId FROM #VT)
    WHERE lk.CompId = @CompId AND lk.Kind = 'resolution' AND lk.IsActive = 1
    GROUP BY lk.Id, lk.Value, lk.SortOrder
    ORDER BY lk.SortOrder;
END
GO

-- ---------------------------------------------------------------------------
-- 18. sp_FetchLoggedByMe (new; spec 2.5, 3.1, F14, F27). One line per
--     complaint @UserId logged (CreatedBy), only while they have complaints
--     View (fn_AccessScope); never mixed into any other list, count or report.
--     Exactly the eight things of 2.5, carried by these twelve columns:
--       Id (NULL when CanOpen = 0), TicketNo, CreatedAt, CustomerName (the
--       current customer's current name), Subject (current), StatusName,
--       StatusCode, AssignedToName (NULL = Unassigned), DueAt, IsOverdue,
--       ClosedOn = COALESCE(ClosedAt, ResolvedAt), CanOpen (= in
--       fn_VisibleTickets: the line links to the complaint).
--     Search: TicketNo, Subject, customer name. Never a phone number.
--     RS2 pagination. Newest first.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchLoggedByMe
    @CompId     BIGINT,
    @UserId     INT,
    @SearchTerm NVARCHAR(100) = NULL,
    @PageNumber INT           = 1,
    @PageSize   INT           = 25
AS
BEGIN
    SET NOCOUNT ON;
    SET @PageNumber = CASE WHEN ISNULL(@PageNumber, 1) < 1 THEN 1  ELSE @PageNumber END;
    SET @PageSize   = CASE WHEN ISNULL(@PageSize, 25)  < 1 THEN 25 ELSE @PageSize   END;
    SET @SearchTerm = NULLIF(LTRIM(RTRIM(@SearchTerm)), N'');
    DECLARE @Now DATETIME = GETDATE();

    CREATE TABLE #VT (TicketId INT PRIMARY KEY);
    DECLARE @F TABLE (Id INT PRIMARY KEY, CreatedAt DATETIME);

    IF EXISTS (SELECT 1 FROM dbo.fn_AccessScope(@CompId, @UserId, 'complaints'))
    BEGIN
        INSERT INTO #VT (TicketId) SELECT TicketId FROM dbo.fn_VisibleTickets(@CompId, @UserId);

        INSERT INTO @F (Id, CreatedAt)
        SELECT t.Id, t.CreatedAt
        FROM dbo.tblTicket t
        JOIN dbo.tblCustomer c ON c.Id = t.CustomerId
        WHERE t.CompId = @CompId AND t.CreatedBy = @UserId
          AND (@SearchTerm IS NULL
               OR t.TicketNo LIKE '%' + @SearchTerm + '%'
               OR t.Subject  LIKE '%' + @SearchTerm + '%'
               OR c.Name     LIKE '%' + @SearchTerm + '%');
    END

    DECLARE @Total INT = (SELECT COUNT(*) FROM @F);

    -- RS1: the page
    SELECT CASE WHEN v.TicketId IS NOT NULL THEN t.Id END AS Id,
           t.TicketNo, t.CreatedAt, c.Name AS CustomerName, t.Subject,
           st.Value AS StatusName, st.Code AS StatusCode,
           a.FullName AS AssignedToName,
           t.DueAt,
           CAST(CASE WHEN st.Code IN ('open', 'onhold') AND t.DueAt < @Now THEN 1 ELSE 0 END AS BIT) AS IsOverdue,
           COALESCE(t.ClosedAt, t.ResolvedAt) AS ClosedOn,
           CAST(CASE WHEN v.TicketId IS NOT NULL THEN 1 ELSE 0 END AS BIT) AS CanOpen
    FROM @F f
    JOIN dbo.tblTicket t   ON t.Id  = f.Id
    JOIN dbo.tblCustomer c ON c.Id  = t.CustomerId
    JOIN dbo.tblLookup st  ON st.Id = t.StatusId
    LEFT JOIN dbo.tblUser a ON a.Id = t.AssignedTo
    LEFT JOIN #VT v        ON v.TicketId = t.Id
    ORDER BY f.CreatedAt DESC, f.Id DESC
    OFFSET (@PageNumber - 1) * @PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;

    -- RS2: pagination
    SELECT @PageNumber AS CurrentPage,
           @PageSize   AS PageSize,
           @Total      AS TotalRecords,
           CASE WHEN @Total = 0 THEN 0 ELSE CEILING(CAST(@Total AS FLOAT) / @PageSize) END AS TotalPages;
END
GO

SET NOEXEC OFF;
GO

-- ===========================================================================
-- Verify after apply. Run on the database just applied (TestCRM ids below;
-- for another database pick users of the same kind). PASS lines print PASS.
--
-- 1. No procedure or function keeps a lead / complaint list parameter -> 0 rows.
--    The NOT IN list = every customers / cards / tasks / people procedure that
--    still takes a list on 2026-11-22 (TestCRM catalogue), plus
--    sp_ConvertedSummary (dropped in 134).
-- SELECT o.name, p.name FROM sys.parameters p JOIN sys.objects o ON o.object_id = p.object_id
-- WHERE p.name IN ('@AccessibleBranchIdsJson','@OwnerIdsJson','@BranchIdsJson','@TicketBranchIdsJson',
--                  '@TicketOwnerIdsJson','@EscalatedSubtreeJson')
--   AND o.name NOT IN ('sp_FetchCustomers','sp_FetchVisitingCards','sp_SaveVisitingCard','sp_DeleteVisitingCard',
--                      'sp_ConvertedSummary','sp_FetchActivityLog','sp_FetchKanbanColumn','sp_FetchProject',
--                      'sp_FetchTask','sp_FetchTeam','sp_FetchTimeEntry','sp_FetchUser','sp_FetchWorkspaces');
--
-- 2. N1a (pre-flight S4): no changed procedure has a default for @UserId -
--    calling it without @UserId raises 201 (parameter not supplied).
--    has_default_value is not used: SQL Server keeps it for CLR objects only.
--    Expect 17 PASS lines.
-- DECLARE @n NVARCHAR(200), @s NVARCHAR(400);
-- DECLARE c2 CURSOR LOCAL FAST_FORWARD FOR SELECT n, s FROM (VALUES
--   ('sp_FetchTickets',         N'EXEC dbo.sp_FetchTickets @CompId = 1'),
--   ('sp_FetchTicketDetail',    N'EXEC dbo.sp_FetchTicketDetail @CompId = 1, @TicketId = 0'),
--   ('sp_FetchLeads',           N'EXEC dbo.sp_FetchLeads @CompId = 1'),
--   ('sp_FetchLeadDetail',      N'EXEC dbo.sp_FetchLeadDetail @CompId = 1, @LeadId = 0'),
--   ('sp_FetchFollowUps',       N'EXEC dbo.sp_FetchFollowUps @CompId = 1'),
--   ('sp_FetchFollowUpLead',    N'EXEC dbo.sp_FetchFollowUpLead @CompId = 1, @Id = 0'),
--   ('sp_FetchQuotations',      N'EXEC dbo.sp_FetchQuotations @CompId = 1'),
--   ('sp_FetchQuotationDetail', N'EXEC dbo.sp_FetchQuotationDetail @CompId = 1, @QuotationId = 0'),
--   ('sp_FetchCustomers',       N'EXEC dbo.sp_FetchCustomers @CompId = 1'),
--   ('sp_FetchCustomerDetail',  N'EXEC dbo.sp_FetchCustomerDetail @CompId = 1, @CustomerId = 0'),
--   ('sp_Dashboard',            N'EXEC dbo.sp_Dashboard @CompId = 1'),
--   ('sp_TicketsByCategory',    N'EXEC dbo.sp_TicketsByCategory @CompId = 1'),
--   ('sp_ResolutionSummary',    N'EXEC dbo.sp_ResolutionSummary @CompId = 1'),
--   ('sp_RptSales',             N'EXEC dbo.sp_RptSales @CompId = 1, @GroupBy = ''team'''),
--   ('sp_RptSalesRows',         N'EXEC dbo.sp_RptSalesRows @CompId = 1, @GroupBy = ''team'', @Metric = ''call'', @Shape = ''events'''),
--   ('sp_FetchLoggedByMe',      N'EXEC dbo.sp_FetchLoggedByMe @CompId = 1'),
--   ('fn_SalesReportRows',      N'SELECT * FROM dbo.fn_SalesReportRows(1, ''2026-01-01'', ''2026-01-02'')')) v (n, s);
-- OPEN c2; FETCH NEXT FROM c2 INTO @n, @s;
-- WHILE @@FETCH_STATUS = 0
-- BEGIN
--   BEGIN TRY EXEC sys.sp_executesql @s; PRINT 'FAIL 2 ' + @n; END TRY
--   BEGIN CATCH PRINT CASE WHEN ERROR_NUMBER() IN (201, 216, 313) THEN 'PASS 2 ' ELSE 'FAIL 2 ' END + @n
--                     + ' (' + CAST(ERROR_NUMBER() AS VARCHAR(10)) + ')'; END CATCH;
--   FETCH NEXT FROM c2 INTO @n, @s;
-- END
-- CLOSE c2; DEALLOCATE c2;
--    (201 = procedure parameter not supplied; for the function, 313 / 216 =
--     too few arguments - it can never be called without @UserId.)
--
-- 3. Nobody gets a record: @UserId NULL.
--    a) sp_FetchFollowUpLead (one result set) -> PASS 3a
-- DECLARE @fu INT = (SELECT TOP 1 Id FROM dbo.tblFollowUp WHERE CompId = 1 ORDER BY Id);
-- CREATE TABLE #fl (Id INT, LeadId INT, Status VARCHAR(20), AssignedTo INT, BranchId BIGINT, OwnerId INT,
--                   CreatedBy INT, Via TINYINT, CanAct BIT);
-- INSERT INTO #fl EXEC dbo.sp_FetchFollowUpLead @CompId = 1, @Id = @fu, @UserId = NULL;
-- SELECT CASE WHEN COUNT(*) = 0 THEN 'PASS 3a' ELSE 'FAIL 3a' END FROM #fl;
-- DROP TABLE #fl;
--    b) the other three detail procedures, by eye: EVERY result set empty.
-- DECLARE @t3 INT = (SELECT TOP 1 Id FROM dbo.tblTicket WHERE CompId = 1 ORDER BY Id DESC);
-- DECLARE @l3 INT = (SELECT TOP 1 Id FROM dbo.tblLeads WHERE CompId = 1 ORDER BY Id DESC);
-- DECLARE @q3 INT = (SELECT TOP 1 Id FROM dbo.tblQuotation WHERE CompId = 1 ORDER BY Id DESC);
-- EXEC dbo.sp_FetchTicketDetail    @CompId = 1, @TicketId    = @t3, @UserId = NULL;   -- 5 empty sets
-- EXEC dbo.sp_FetchLeadDetail      @CompId = 1, @LeadId      = @l3, @UserId = NULL;   -- 6 empty sets
-- EXEC dbo.sp_FetchQuotationDetail @CompId = 1, @QuotationId = @q3, @UserId = NULL;   -- 3 empty sets
--    c) the same ticket for its holder: RS1 one row with CanEdit / CanReassign /
--       CanReopen / SendBackToId / SendBackToName at the end.
-- DECLARE @h3 INT = (SELECT AssignedTo FROM dbo.tblTicket WHERE Id = @t3);
-- EXEC dbo.sp_FetchTicketDetail @CompId = 1, @TicketId = @t3, @UserId = @h3;
--
-- 4. List totals = the definitions (RS2 TotalRecords of each EXEC = the
--    SELECT under it). TestCRM expected (131 dry run): complaints pooja.joshi
--    (82) 4 | bm_ho_rahul (15) 74 | vikram.rao (75) 159; leads se_ho_amit (17)
--    179 | tl_ho_neha (16) 264 | bm_ho_rahul (15) 469.
-- EXEC dbo.sp_FetchTickets @CompId = 1, @UserId = 82, @PageSize = 1;  SELECT COUNT(*) FROM dbo.fn_VisibleTickets(1, 82);
-- EXEC dbo.sp_FetchTickets @CompId = 1, @UserId = 15, @PageSize = 1;  SELECT COUNT(*) FROM dbo.fn_VisibleTickets(1, 15);
-- EXEC dbo.sp_FetchTickets @CompId = 1, @UserId = 75, @PageSize = 1;  SELECT COUNT(*) FROM dbo.fn_VisibleTickets(1, 75);
-- EXEC dbo.sp_FetchLeads   @CompId = 1, @UserId = 17, @PageSize = 1;  SELECT COUNT(*) FROM dbo.fn_VisibleLeads(1, 17);
-- EXEC dbo.sp_FetchLeads   @CompId = 1, @UserId = 16, @PageSize = 1;  SELECT COUNT(*) FROM dbo.fn_VisibleLeads(1, 16);
-- EXEC dbo.sp_FetchLeads   @CompId = 1, @UserId = 15, @PageSize = 1;  SELECT COUNT(*) FROM dbo.fn_VisibleLeads(1, 15);
--
-- 5. Sales reports, for one Sales Executive (se_ho_amit, 17, Own): every
--    summary cell = its drill's RS2 Total (122's V8, lists gone) -> 0 rows,
--    and Total = returned rows + HiddenCount for his Calls cell.
-- DECLARE @c INT = 1, @u INT = 17, @f DATE = '2026-01-01', @t DATE = '2026-11-30';
-- CREATE TABLE #S (GroupKey INT NULL, GroupLabel NVARCHAR(200), LineKind VARCHAR(10), TeamSize INT, IsActive BIT, NoManager BIT, Ord INT,
--   New INT, Calls INT, Visits INT, Meetings INT, Other INT, FuOnTime INT, FuLate INT, FuSkipped INT, FuMissed INT, FuOpen INT,
--   Won INT, WonValue DECIMAL(18,2), Lost INT, LostValue DECIMAL(18,2), OpenNow INT, OpenValue DECIMAL(18,2), OverdueNow INT, NoNext INT, Stale INT,
--   Age0_7 INT, Age8_30 INT, Age31_90 INT, Age90Plus INT,
--   CohortOpen INT, CohortWon INT, CohortWonValue DECIMAL(18,2), CohortLost INT, CohortJunk INT, CohortUntouched INT, DaysOpenSum INT, DaysOpenN INT);
-- INSERT INTO #S EXEC dbo.sp_RptSales @CompId = @c, @FromDate = @f, @ToDate = @t, @GroupBy = 'team', @UserId = @u, @LinesOnly = 1;
-- CREATE TABLE #D (Total INT, AmountTotal DECIMAL(18,2));
-- CREATE TABLE #X (GroupKey INT NULL, LineKind VARCHAR(10), Metric VARCHAR(12), Cell INT, Drill INT);
-- DECLARE @k INT, @kind VARCHAR(10), @m VARCHAR(12), @cell INT, @p INT, @r BIT, @un BIT;
-- DECLARE c5 CURSOR LOCAL FAST_FORWARD FOR
--   SELECT s.GroupKey, s.LineKind, v.m, v.cell FROM #S s
--   CROSS APPLY (VALUES ('new', s.New), ('call', s.Calls), ('visits', s.Visits + s.Meetings), ('fu_missed', s.FuMissed),
--                       ('won', s.Won), ('lost', s.Lost), ('open', s.OpenNow)) v(m, cell);
-- OPEN c5; FETCH NEXT FROM c5 INTO @k, @kind, @m, @cell;
-- WHILE @@FETCH_STATUS = 0
-- BEGIN
--   SELECT @p = CASE WHEN @kind = 'unassigned' THEN NULL ELSE @k END,
--          @r = CASE WHEN @kind = 'team' THEN 1 ELSE 0 END, @un = CASE WHEN @kind = 'unassigned' THEN 1 ELSE 0 END;
--   DELETE FROM #D;
--   INSERT INTO #D EXEC dbo.sp_RptSalesRows @CompId = @c, @FromDate = @f, @ToDate = @t, @GroupBy = 'team', @Metric = @m, @Shape = 'events',
--        @PersonId = @p, @Rollup = @r, @Unassigned = @un, @MaxRows = 0, @UserId = @u;
--   INSERT INTO #X SELECT @k, @kind, @m, @cell, Total FROM #D;
--   FETCH NEXT FROM c5 INTO @k, @kind, @m, @cell;
-- END
-- CLOSE c5; DEALLOCATE c5;
-- SELECT CASE WHEN COUNT(*) = 0 THEN 'PASS 5a' ELSE 'FAIL 5a' END FROM #X WHERE Cell <> Drill;
-- SELECT * FROM #X WHERE Metric = 'call';                       -- his Calls cell
-- DROP TABLE #S, #D, #X;
--    5b by eye: rows returned + the last recordset's HiddenCount = RS2 Total
--       = the Calls cell above (rows only for leads he can still see).
-- EXEC dbo.sp_RptSalesRows @CompId = 1, @FromDate = '2026-01-01', @ToDate = '2026-11-30', @GroupBy = 'team',
--      @Metric = 'call', @Shape = 'events', @PersonId = 17, @Rollup = 0, @UserId = 17;
--    5c Ruling 7: filtered by an office, no hidden rows are counted -> PASS 5c.
-- DECLARE @b5 INT = (SELECT BranchId FROM dbo.tblUser WHERE Id = 17);
-- CREATE TABLE #D2 (Total INT, AmountTotal DECIMAL(18,2));
-- INSERT INTO #D2 EXEC dbo.sp_RptSalesRows @CompId = 1, @FromDate = '2026-01-01', @ToDate = '2026-11-30', @GroupBy = 'team',
--      @Metric = 'all', @Shape = 'events', @BranchId = @b5, @MaxRows = 0, @UserId = 17;
-- SELECT CASE WHEN (SELECT Total FROM #D2) =
--          (SELECT COUNT(*) FROM dbo.fn_SalesReportRows(1, '2026-01-01', '2026-12-01', 17) r
--           WHERE r.BranchId = @b5 AND r.CanOpen = 1 AND r.Metric <> 'open'
--             AND r.PersonId IN (SELECT PersonId FROM dbo.fn_ReportTree(1, 17)))
--        THEN 'PASS 5c' ELSE 'FAIL 5c' END;
-- DROP TABLE #D2;
--    5d Grouped by source, no hidden lead's activity is counted (Ruling 7): the
--       whole-report drill = every visible non-open row -> PASS 5d.
-- CREATE TABLE #D3 (Total INT, AmountTotal DECIMAL(18,2));
-- INSERT INTO #D3 EXEC dbo.sp_RptSalesRows @CompId = 1, @FromDate = '2026-01-01', @ToDate = '2026-11-30', @GroupBy = 'source',
--      @Metric = 'all', @Shape = 'events', @MaxRows = 0, @UserId = 17;
-- SELECT CASE WHEN (SELECT Total FROM #D3) =
--          (SELECT COUNT(*) FROM dbo.fn_SalesReportRows(1, '2026-01-01', '2026-12-01', 17) r
--           WHERE r.CanOpen = 1 AND r.Metric <> 'open')
--        THEN 'PASS 5d' ELSE 'FAIL 5d' END;
-- DROP TABLE #D3;
--    (and by eye: the same call with @MaxRows = 2000 ends with HiddenCount 0)
--
-- 6. sp_FetchLoggedByMe returns exactly the twelve columns, in order -> PASS 6.
-- SELECT CASE WHEN STRING_AGG(name, ',') WITHIN GROUP (ORDER BY column_ordinal)
--          = 'Id,TicketNo,CreatedAt,CustomerName,Subject,StatusName,StatusCode,AssignedToName,DueAt,IsOverdue,ClosedOn,CanOpen'
--        THEN 'PASS 6' ELSE 'FAIL 6' END
-- FROM sys.dm_exec_describe_first_result_set_for_object(OBJECT_ID('dbo.sp_FetchLoggedByMe'), 0);
--    Rows (TestCRM): EXEC dbo.sp_FetchLoggedByMe @CompId = 1, @UserId = 82;
--    -> one line per complaint pooja.joshi logged; Id NULL exactly where CanOpen = 0.
--
-- 7. No changed procedure still carries an old visibility predicate -> 0.
-- SELECT COUNT(*) FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
-- WHERE o.name IN ('fn_SalesReportRows','sp_RptSales','sp_RptSalesRows','sp_FetchTickets','sp_FetchTicketDetail',
--                  'sp_FetchLeads','sp_FetchLeadDetail','sp_FetchFollowUps','sp_FetchFollowUpLead','sp_FetchQuotations',
--                  'sp_FetchQuotationDetail','sp_FetchCustomerDetail','sp_Dashboard','sp_TicketsByCategory',
--                  'sp_ResolutionSummary','sp_FetchLoggedByMe')
--   AND (m.definition LIKE '%@UseBranchScope%' OR m.definition LIKE '%CreatedBy = @UserId AND%AssignedTo IS NULL%'
--        OR m.definition LIKE '%l.OwnerId IS NULL AND l.CreatedBy = @UserId%');
--
-- 8. F4 / F6 regressions, se_ho_amit (17): no complaints module, holds 21
--    complaints (131 report). By eye:
--    customer detail of a customer with complaints: OpenTickets 0, TotalTickets 0, RS2 empty;
--    dashboard RS5 Tickets 0 in every quarter (it counted his held complaints before).
-- DECLARE @cu8 INT = (SELECT TOP 1 CustomerId FROM dbo.tblTicket WHERE CompId = 1 AND AssignedTo = 17);
-- EXEC dbo.sp_FetchCustomerDetail @CompId = 1, @CustomerId = @cu8, @UserId = 17;
-- EXEC dbo.sp_Dashboard @CompId = 1, @UserId = 17;
--
-- 9. Backups saved (17 rows; sp_FetchLoggedByMe with Definition NULL).
-- SELECT ObjName, ObjType, CASE WHEN Definition IS NULL THEN 'new' ELSE 'saved' END
-- FROM dbo.tblAccessModelBackup WHERE ScriptNo = 132 ORDER BY ObjName;
-- ===========================================================================
