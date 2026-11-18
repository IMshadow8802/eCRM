/* ===========================================================================
   122 — sales reports rebuild: one row source, one reporting tree, two procs
   ---------------------------------------------------------------------------
   Apply by hand with sqlcmd -I (QUOTED_IDENTIFIER ON), CLAUDE.md §0.2.
   Order of databases: TestCRM, then eCRM+, SolarCRM, OSG.

   APPLY TO A DATABASE IMMEDIATELY BEFORE DEPLOYING THE NEW BACKEND AND WEB
   TO IT. §7 (menu rows) and §8 (drop the old report procedures) break the
   old report pages on purpose; the old backend must not run against a
   database that has had 122.

   Sections, in apply order:
     §1  index IX_tblLeads_CompId_CreatedAt
     §2  dbo.fn_ReportTree       — the in-view reporting tree, once
     §3  dbo.fn_SalesReportRows  — every countable sales fact, once
     §4  dbo.sp_RptSales         — summary lines
     §5  dbo.sp_RptSalesRows     — the rows behind a number
     §6  dbo.sp_FetchLeads       — from its live definition
     §7  menu rows
     §8  drop the old report procedures
     §9  verify after apply (end of file, -- comments only)

   Spec: docs/superpowers/specs/2026-11-18-sales-reports-rebuild/design.md.
   Rulings this script carries (the reasoning travels with the objects):

   Ruling 1 — Calls are done follow-ups of Type 'call' PLUS tblCall rows with
   a LeadId. sp_LogCall writes tblCall only (it stopped writing a follow-up in
   9.17) and both clients still call /api/calls/logCall with a LeadId;
   sp_CompleteFollowUp never writes tblCall, so the two sets are disjoint and
   adding them counts nothing twice. A tblCall row is dated on CalledAt and
   credited to its UserId.

   Ruling 2 — fn_ReportTree takes the caller's scope and returns the IN-VIEW
   tree, not the raw ReportsTo tree. Walking the raw tree and restricting to
   the people in view afterwards counts a person twice when their chain
   passes through someone out of view (Office reach: A -> B in another office
   -> C), and it cannot turn a reporting loop into a forest. Both report procs
   read this one function.

   Ruling 3 — The caller is always a root. Their own manager, if in view,
   does not roll them up; otherwise the start level would count the caller's
   team twice.

   Ruling 4 — A fifth follow-up state, fu_open: due in the period, still open,
   not (yet) missed. Without it "Follow-ups due" would not equal the sum of
   its parts (a follow-up due later today counts as due).

   Ruling 5 — Missed uses the 120 rule: a date-only follow-up (time 00:00) is
   missed from the next day, a timed one once its time has passed. On time is
   the same split: a timed follow-up done within 2 hours of its time, a
   date-only one done any time on its due day.

   Ruling 6 — "Not contacted yet" = created in the period, still open, with no
   done follow-up and no tblCall row. fn_SalesReportRows carries a Contacted
   bit for it. LastActivityAt IS NULL would not work: an 'assigned' activity
   is written when the lead is created.
   =========================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- ===========================================================================
-- §1 index — every lead-subject family ranges on CreatedAt / reads per company
-- ===========================================================================
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE object_id = OBJECT_ID(N'dbo.tblLeads') AND name = N'IX_tblLeads_CompId_CreatedAt')
    CREATE INDEX IX_tblLeads_CompId_CreatedAt ON dbo.tblLeads (CompId, CreatedAt DESC);
GO

-- ===========================================================================
-- §2 dbo.fn_ReportTree — the reporting tree of the people the caller can see
--
-- Returns one row per (ancestor, person): every person in view once at
-- Depth 0 as their own ancestor, plus one row per ancestor above them in the
-- in-view tree. ChildId is the ancestor's direct report on the path to the
-- person (for the Depth 0 row: the person), which is what a summary line
-- groups on: "a manager's number" = their own row + every ChildId under them.
--
-- In view: users of @CompId who are the caller, or who pass both scope axes
-- (an axis is off when its JSON is NULL or ''; '[]' is on and empty = nobody,
-- never collapsed to NULL). Not filtered by IsActive: a deactivated manager is
-- still a link in the chain; who is shown is the proc's business.
-- Manager in view: u.ReportsTo when that user is in view, is not the person,
-- and the person is not the caller (Ruling 3); otherwise NULL — the person is
-- a root. A root whose manager exists but is out of view is NOT NoManager
-- (Ruling 11: the "No manager set" chip is only for ReportsTo NULL / self /
-- a cut loop).
-- Loop cut: walk down from the roots level by level. While people remain
-- unreached they sit in or under a reporting loop: the loop's members are
-- found by pruning unreached people nobody unreached reports to; the member
-- with the lowest Id loses its manager (NoManager = 1) and the walk goes on.
-- ponytail: depth capped at 50 levels; anyone deeper is cut like a loop
-- member (no real org is 50 deep).
-- ===========================================================================
CREATE OR ALTER FUNCTION dbo.fn_ReportTree
(
    @CompId        INT,
    @UserId        INT,
    @BranchIdsJson NVARCHAR(MAX),
    @OwnerIdsJson  NVARCHAR(MAX)
)
RETURNS @T TABLE
(
    AncestorId INT NOT NULL,
    PersonId   INT NOT NULL,
    ChildId    INT NOT NULL,
    Depth      INT NOT NULL,
    NoManager  BIT NOT NULL,
    PRIMARY KEY (AncestorId, PersonId)
)
AS
BEGIN
    DECLARE @UseB BIT = CASE WHEN @BranchIdsJson IS NULL OR @BranchIdsJson = '' THEN 0 ELSE 1 END;
    DECLARE @UseO BIT = CASE WHEN @OwnerIdsJson  IS NULL OR @OwnerIdsJson  = '' THEN 0 ELSE 1 END;
    DECLARE @B TABLE (Id INT PRIMARY KEY);
    DECLARE @O TABLE (Id INT PRIMARY KEY);
    IF @UseB = 1 INSERT INTO @B (Id) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@BranchIdsJson);
    IF @UseO = 1 INSERT INTO @O (Id) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@OwnerIdsJson);

    DECLARE @V TABLE (Id INT PRIMARY KEY, RawMgr INT NULL, Mgr INT NULL, Lvl INT NULL, NoManager BIT NOT NULL);

    -- 1. in view
    INSERT INTO @V (Id, RawMgr, NoManager)
    SELECT u.Id, u.ReportsTo,
           CASE WHEN u.ReportsTo IS NULL OR u.ReportsTo = u.Id THEN 1 ELSE 0 END
    FROM dbo.tblUser u
    WHERE u.CompId = @CompId
      AND (   u.Id = @UserId
           OR (    (@UseO = 0 OR u.Id       IN (SELECT Id FROM @O))
               AND (@UseB = 0 OR u.BranchId IN (SELECT Id FROM @B))));

    -- 2. manager in view (the caller is always a root)
    UPDATE v SET Mgr = v.RawMgr
    FROM @V v
    WHERE v.RawMgr <> v.Id
      AND (@UserId IS NULL OR v.Id <> @UserId)
      AND EXISTS (SELECT 1 FROM @V m WHERE m.Id = v.RawMgr);

    -- 3. walk from the roots; cut loops
    UPDATE @V SET Lvl = 0 WHERE Mgr IS NULL;
    DECLARE @lvl INT, @n INT, @cut INT;
    DECLARE @C TABLE (Id INT PRIMARY KEY, Mgr INT NULL);
    WHILE 1 = 1
    BEGIN
        SET @lvl = 0; SET @n = 1;
        WHILE @n > 0 AND @lvl < 50
        BEGIN
            UPDATE c SET Lvl = @lvl + 1
            FROM @V c JOIN @V p ON p.Id = c.Mgr
            WHERE c.Lvl IS NULL AND p.Lvl = @lvl;
            SET @n = @@ROWCOUNT;
            SET @lvl += 1;
        END

        IF NOT EXISTS (SELECT 1 FROM @V WHERE Lvl IS NULL) BREAK;

        -- the loop members: prune unreached people nobody unreached reports to
        DELETE FROM @C;
        INSERT INTO @C (Id, Mgr) SELECT Id, Mgr FROM @V WHERE Lvl IS NULL;
        SET @n = 1;
        WHILE @n > 0
        BEGIN
            DELETE c FROM @C c WHERE NOT EXISTS (SELECT 1 FROM @C k WHERE k.Mgr = c.Id);
            SET @n = @@ROWCOUNT;
        END
        SELECT @cut = MIN(Id) FROM @C;
        IF @cut IS NULL SELECT @cut = MIN(Id) FROM @V WHERE Lvl IS NULL;   -- deeper than 50, no loop

        UPDATE @V SET Mgr = NULL, NoManager = 1, Lvl = 0 WHERE Id = @cut;
    END;

    -- 4. output: self rows + every ancestor through the kept edges (a forest now)
    WITH A AS
    (
        SELECT v.Id AS PersonId, v.Mgr AS AncestorId, v.Id AS ChildId, 1 AS Depth
        FROM @V v WHERE v.Mgr IS NOT NULL
        UNION ALL
        SELECT a.PersonId, p.Mgr, a.AncestorId, a.Depth + 1
        FROM A a JOIN @V p ON p.Id = a.AncestorId
        WHERE p.Mgr IS NOT NULL
    )
    INSERT INTO @T (AncestorId, PersonId, ChildId, Depth, NoManager)
    SELECT v.Id, v.Id, v.Id, 0, v.NoManager FROM @V v
    UNION ALL
    SELECT a.AncestorId, a.PersonId, a.ChildId, a.Depth, v.NoManager
    FROM A a JOIN @V v ON v.Id = a.PersonId;

    RETURN;
END
GO

-- ===========================================================================
-- §3 dbo.fn_SalesReportRows — the one row source of every sales report
--
-- A row is one countable fact; every number on every sales report is a count
-- or a sum of these rows. Families (Metric · Src · dated on · credited to):
--   new                        L  tblLeads.CreatedAt    lead OwnerId   Amount EstValue
--   call/visit/meeting/other   F  tblFollowUp.DoneAt    DoneBy         Amount Duration (done, by Type)
--   call                       C  tblCall.CalledAt      UserId         Amount Duration (Ruling 1)
--   fu_ontime/fu_late/fu_skipped/fu_missed/fu_open
--                              F  tblFollowUp.DueAt     COALESCE(DoneBy, AssignedTo, lead OwnerId)
--                                 (not cancelled, not an open leftover on a lost/junk/converted lead;
--                                  one state per follow-up, Rulings 4 and 5)
--   won                        L  tblLeads.WonAt        lead OwnerId   Amount WonValue  (status code converted)
--   lost                       L  tblLeads.LostAt       lead OwnerId   Amount EstValue  (status code lost)
--   open                       L  — (ignores @From/@ToEx; open now)  lead OwnerId   Amount EstValue
-- (Metric, Src, RefId) is unique. Each family repeats the range on its own
-- base date column so it stays sargable. Lead columns are computed once, in
-- the CTE L, and joined to every family.
--
-- Scope (CLAUDE.md §3). An axis is off when its JSON is NULL or ''; '[]' is
-- on and empty = nobody, never collapsed to NULL.
--   Lead-subject rows (new, won, lost, open): the sp_FetchLeads predicate,
--   character for character. CanOpen is that predicate as a bit on every row.
--   People-subject rows (every F and C row): the follow-up predicate of
--   sp_RptLeaderboard / sp_RptFollowUpCompliance — the owner half also
--   accepts the ACTOR (f.DoneBy or f.AssignedTo, or c.UserId) in @OwnerIds,
--   and the caller's own work is always visible.
--
-- Why the actor disjunct (copied from the header of sp_RptFollowUpCompliance,
-- which §8 drops; measured 2026-09-13 on CompId 1):
--   1. This is a PEOPLE report; its subject is the rep, not the lead. Without
--      the disjunct a rep's historical on-time % mutates whenever a lead
--      changes hands, with no activity having occurred.
--   2. It is what keeps a manager's view consistent with everyone else's.
--      Rep se_ho_sara (18): her Leaderboard Activities read 256 to herself,
--      256 to bm_ho_rahul (15, Branch) and 256 to her own manager tl_ho_neha
--      (16, Team). Drop the disjunct and Neha -- and only Neha, the manager in
--      between -- reads 229. A report that ranks people must not show the
--      middle manager less than the two people either side of her.
--   3. It changes nothing for any scope but Team. @OwnerIds is empty for
--      All / Company / MultiBranch / Branch (owner axis off), and for Self it
--      is {caller}, where the disjunct is already covered by the @UserId
--      escape hatch.
--   It is not a widening: the branch half still ANDs, so no row can reach a
--   caller outside an accessible branch.
--
-- IsOverdue is sp_FetchLeads' 120 expression with its @Today variable written
-- out as CAST(CAST(GETDATE() AS DATE) AS DATETIME) (an inline function has no
-- variables); the 120 marker comment is left out so 120's verify count stays
-- true.
-- ===========================================================================
CREATE OR ALTER FUNCTION dbo.fn_SalesReportRows
(
    @CompId        INT,
    @From          DATETIME,
    @ToEx          DATETIME,
    @UserId        INT,
    @BranchIdsJson NVARCHAR(MAX),
    @OwnerIdsJson  NVARCHAR(MAX)
)
RETURNS TABLE
AS
RETURN
WITH L AS
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
           CAST(CASE WHEN
                (    (@BranchIdsJson IS NULL OR @BranchIdsJson = '' OR l.BranchId IN (SELECT CAST(value AS INT) FROM OPENJSON(NULLIF(@BranchIdsJson, ''))))
                 AND (@OwnerIdsJson  IS NULL OR @OwnerIdsJson  = '' OR l.OwnerId  IN (SELECT CAST(value AS INT) FROM OPENJSON(NULLIF(@OwnerIdsJson, '')))) )
             OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR (l.OwnerId IS NULL AND l.CreatedBy = @UserId)))
                THEN 1 ELSE 0 END AS BIT) AS CanOpen
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
    -- lead-subject: sp_FetchLeads
    (x.Src = 'L' AND (
        (    (@BranchIdsJson IS NULL OR @BranchIdsJson = '' OR L.BranchId IN (SELECT CAST(value AS INT) FROM OPENJSON(NULLIF(@BranchIdsJson, ''))))
         AND (@OwnerIdsJson  IS NULL OR @OwnerIdsJson  = '' OR L.OwnerId  IN (SELECT CAST(value AS INT) FROM OPENJSON(NULLIF(@OwnerIdsJson, '')))) )
     OR (@UserId IS NOT NULL AND (L.OwnerId = @UserId OR (L.OwnerId IS NULL AND L.CreatedBy = @UserId)))
    ))
    -- people-subject: the follow-up predicate, actor = DoneBy / AssignedTo, or tblCall.UserId
 OR (x.Src IN ('F','C') AND (
        (    (@BranchIdsJson IS NULL OR @BranchIdsJson = '' OR L.BranchId IN (SELECT CAST(value AS INT) FROM OPENJSON(NULLIF(@BranchIdsJson, ''))))
         AND (@OwnerIdsJson  IS NULL OR @OwnerIdsJson  = ''
              OR L.OwnerId IN (SELECT CAST(value AS INT) FROM OPENJSON(NULLIF(@OwnerIdsJson, '')))
              OR x.Actor1  IN (SELECT CAST(value AS INT) FROM OPENJSON(NULLIF(@OwnerIdsJson, '')))
              OR x.Actor2  IN (SELECT CAST(value AS INT) FROM OPENJSON(NULLIF(@OwnerIdsJson, '')))) )
     OR (@UserId IS NOT NULL AND (L.OwnerId = @UserId OR (L.OwnerId IS NULL AND L.CreatedBy = @UserId)
                                  OR x.Actor1 = @UserId OR x.Actor2 = @UserId))
    ));
GO

-- ===========================================================================
-- §4 dbo.sp_RptSales — the summary lines of every sales report
--
-- The opening block (#T, #R) is the same in sp_RptSalesRows (§5); change both
-- together. Every number is a count or sum of #R rows mapped to a line, and a
-- row reaches a 'team' / 'person' line only THROUGH #T: a row credited to
-- someone outside the in-view tree (a follow-up done by a person out of view,
-- a deleted user) falls in no line. So the TOTALS row (= Node's sum of the
-- lines), the previous-period row (the same call for the earlier range) and
-- the drill without a person (§5: PersonId in #T, plus the unassigned rows)
-- are the same set. No totals come from SQL.
--
-- @GroupBy 'team':
--   Roots = people in #T with no ancestor. The level is @NodeId (it must be in
--   #T with someone under it, else no lines and NodeOk = 0) or, at the start,
--   the caller when they have people under them. Its lines: each direct
--   report, rolled up over everyone under them ('team', or 'person' when
--   alone), plus the level person's own rows ('own'). A caller with nobody
--   under them gets one 'person' line. The start also lists every other root
--   rolled up over its subtree (NoManager from #T, Ruling 11), and one
--   'unassigned' line for rows with no person (a lead with no owner; a
--   follow-up with no DoneBy / AssignedTo on such a lead) when the owner axis
--   is off. Every person in #T sits under exactly one root and the caller is a
--   root (Ruling 3), so no row is counted on two lines.
--   Listed: active people always (zeros too); inactive people and the
--   unassigned line only when not all zero.
--   Ord: 1 caller's / node's direct reports, 2 other roots, 3 own (or the
--   caller alone), 4 other roots with NoManager, 5 unassigned.
--   TeamSize = people at or under the line's person in #T.
-- 'source' groups every row by SourceId; 'reason' groups lost rows by
-- LostReasonId; 'person' groups by PersonId over everyone in #T, flat, plus the
-- unassigned line as above. These leave out all-zero lines.
-- @LinesOnly = 1 returns RS1 alone, so the verify block can INSERT ... EXEC it
-- (INSERT ... EXEC needs every result set to have one shape); Node never sets it.
-- ===========================================================================
CREATE OR ALTER PROCEDURE dbo.sp_RptSales
    @CompId                  INT,
    @FromDate                DATE          = NULL,
    @ToDate                  DATE          = NULL,
    @GroupBy                 VARCHAR(12),
    @NodeId                  INT           = NULL,
    @BranchId                INT           = NULL,
    @SourceId                INT           = NULL,
    @ProductId               INT           = NULL,
    @UserId                  INT           = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL,
    @LinesOnly               BIT           = 0
AS
BEGIN
    SET NOCOUNT ON;
    IF @GroupBy IS NULL OR @GroupBy NOT IN ('team','source','person','reason')
    BEGIN RAISERROR('sp_RptSales: @GroupBy must be team, source, person or reason.', 16, 1); RETURN; END;

    -- opening block, same in sp_RptSalesRows -------------------------------
    DECLARE @ToEx DATE = DATEADD(DAY, 1, @ToDate);
    DECLARE @OwnerOff BIT = CASE WHEN @OwnerIdsJson IS NULL OR @OwnerIdsJson = '' THEN 1 ELSE 0 END;
    SELECT * INTO #T FROM dbo.fn_ReportTree(@CompId, @UserId, @AccessibleBranchIdsJson, @OwnerIdsJson);
    SELECT r.* INTO #R
    FROM dbo.fn_SalesReportRows(@CompId, @FromDate, @ToEx, @UserId, @AccessibleBranchIdsJson, @OwnerIdsJson) r
    WHERE (@BranchId  IS NULL OR r.BranchId  = @BranchId)
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

-- ===========================================================================
-- §5 dbo.sp_RptSalesRows — the rows behind one number
--
-- The opening block (#T, #R) is copied from sp_RptSales (§4); change both
-- together. The contract: a summary cell (line, metric) = RS2.Total of this
-- proc called with the same dates, filters and scope and that line's drill:
--   'team' line -> @PersonId = GroupKey, @Rollup = 1;  'person' / 'own' -> @Rollup = 0;
--   'unassigned' -> @Unassigned = 1;  a source / reason line -> @GroupKey (or @GroupKeyIsNull = 1);
--   no person at all with 'team' / 'person' -> everyone in #T plus the unassigned rows = the TOTALS row.
-- A person filter, like the summary, only ever matches PersonId through #T.
-- @Metric: new, call, visit, meeting, other, visits (= visit + meeting),
--   fu_due (= the five fu_*), fu_ontime, fu_late, fu_skipped, fu_missed,
--   fu_open, won, lost, open, all (= every metric except open).
-- @State / @AgeBucket / @Flag repeat the summary's column expressions.
-- @Shape 'leads' (Metric 'all', one person, no roll-up): one row per lead.
-- RS2 counts the whole filtered set before TOP. @MaxRows = 0 returns RS2
-- alone (one result set: the previous-period call, and INSERT ... EXEC in the
-- verify block).
-- ===========================================================================
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
    @UserId                  INT           = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL
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
    DECLARE @OwnerOff BIT = CASE WHEN @OwnerIdsJson IS NULL OR @OwnerIdsJson = '' THEN 1 ELSE 0 END;
    SELECT * INTO #T FROM dbo.fn_ReportTree(@CompId, @UserId, @AccessibleBranchIdsJson, @OwnerIdsJson);
    SELECT r.* INTO #R
    FROM dbo.fn_SalesReportRows(@CompId, @FromDate, @ToEx, @UserId, @AccessibleBranchIdsJson, @OwnerIdsJson) r
    WHERE (@BranchId  IS NULL OR r.BranchId  = @BranchId)
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
            ORDER BY CASE WHEN @Metric = 'open' THEN f.AgeDays END DESC,
                     CASE WHEN @Metric = 'open' THEN f.LeadId  END DESC,
                     f.EventAt DESC, f.RefId DESC;

        SELECT COUNT(*) AS Total, CAST(ISNULL(SUM(Amount), 0) AS DECIMAL(18,2)) AS AmountTotal FROM #F;
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
            ORDER BY d.CreatedAt DESC, d.LeadId DESC;

        -- AmountTotal = the listed leads' estimated value; WonValue = Won ₹ of the period (= the summary cell)
        SELECT COUNT(*) AS Total, CAST(ISNULL(SUM(EstValue), 0) AS DECIMAL(18,2)) AS AmountTotal,
               ISNULL(SUM(NNew), 0) AS NNew, ISNULL(SUM(NCalls), 0) AS NCalls, ISNULL(SUM(NVisits), 0) AS NVisits,
               ISNULL(SUM(NOther), 0) AS NOther, ISNULL(SUM(NDue), 0) AS NDue, ISNULL(SUM(NOnTime), 0) AS NOnTime,
               ISNULL(SUM(NLate), 0) AS NLate, ISNULL(SUM(NSkipped), 0) AS NSkipped, ISNULL(SUM(NMissed), 0) AS NMissed,
               ISNULL(SUM(NWon), 0) AS NWon, CAST(ISNULL(SUM(WonAmount), 0) AS DECIMAL(18,2)) AS WonValue,
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
END
GO

-- ===========================================================================
-- VERIFY AFTER APPLY — read-only unless marked
-- ===========================================================================
-- (TestCRM: comp = 1, owner = 2 Ayush Mishra.)
-- V1 tree: every person in view appears exactly once at Depth 0, and never twice under one ancestor.
-- SELECT PersonId, COUNT(*) FROM dbo.fn_ReportTree(<comp>, <ownerId>, NULL, NULL) WHERE Depth = 0 GROUP BY PersonId HAVING COUNT(*) <> 1;   -- expect 0 rows
-- V2 tree, Own reach: SELECT * FROM dbo.fn_ReportTree(<comp>, <staffId>, NULL, '[<staffId>]');   -- expect exactly 1 row (self, Depth 0)
-- V3 tree, nobody: SELECT * FROM dbo.fn_ReportTree(<comp>, NULL, NULL, '[]');                     -- expect 0 rows
-- V4 cycle (TestCRM only): BEGIN TRAN; UPDATE two users to report to each other; SELECT from fn_ReportTree; ROLLBACK;
--    expect: returns, each of the two appears once at Depth 0, the lower Id is the other's ancestor, NoManager = 1 on the lower Id.
-- V5 rows: SELECT Metric, COUNT(*) n, SUM(Amount) amt FROM dbo.fn_SalesReportRows(<comp>, '2026-09-01', '2026-10-01', <ownerId>, NULL, NULL) GROUP BY Metric;
--    expect on TestCRM for the owner (mockup frame 01, unless data was edited since 2026-11-18):
--    new 221 · call 209 · visit + meeting 110 · won 6 (amt 17000) · lost 49
--    measured 2026-11-18 (family SELECTs run read-only on TestCRM, comp 1, owner 2, scope NULL/NULL):
--    new 221 (amt 29794153) · call 209 (F 209 + C 0; amt = minutes 2943) · visit 73 + meeting 37 = 110
--    · other 15 · won 6 (amt 17000) · lost 49 (amt 6690663) · open 626 (as of 2026-11-18)
--    · fu_ontime 248 · fu_late 71 · fu_skipped 7 · fu_missed 349 · fu_open 0   -> matches the mockup
--      (fu_open was 11 before the leftover rule: all 11 were open follow-ups on lost/junk/converted
--       leads, now excluded; missed unchanged, it was already gated on an active lead)
--    tree (pre-apply, by query): CompId 1 has 75 users, 24 roots, max depth 3, no loops -> V1 expects 75 Depth 0 rows.
-- V6 nobody: same call with @UserId NULL and @OwnerIdsJson '[]'  -- expect 0 rows
-- V7 one family per fact: SELECT Metric, Src, RefId, COUNT(*) FROM dbo.fn_SalesReportRows(...) GROUP BY Metric, Src, RefId HAVING COUNT(*) > 1;  -- expect 0 rows
-- V8 reconciliation, team start level (number = drill rows). Run as one batch; expect 0 rows.
--    For every RS1 line and each of New, Calls, Visits+Meetings, FuMissed, Won, Lost, OpenNow, OverdueNow,
--    the drill's RS2.Total for that line must equal the cell. The drill with no person = the TOTALS row.
-- DECLARE @c INT = 1, @u INT = 2, @f DATE = '2026-09-01', @t DATE = '2026-09-30';
-- CREATE TABLE #S (GroupKey INT NULL, GroupLabel NVARCHAR(200), LineKind VARCHAR(10), TeamSize INT, IsActive BIT, NoManager BIT, Ord INT,
--   New INT, Calls INT, Visits INT, Meetings INT, Other INT, FuOnTime INT, FuLate INT, FuSkipped INT, FuMissed INT, FuOpen INT,
--   Won INT, WonValue DECIMAL(18,2), Lost INT, LostValue DECIMAL(18,2), OpenNow INT, OpenValue DECIMAL(18,2), OverdueNow INT, NoNext INT, Stale INT,
--   Age0_7 INT, Age8_30 INT, Age31_90 INT, Age90Plus INT,
--   CohortOpen INT, CohortWon INT, CohortWonValue DECIMAL(18,2), CohortLost INT, CohortJunk INT, CohortUntouched INT, DaysOpenSum INT, DaysOpenN INT);
-- INSERT INTO #S EXEC dbo.sp_RptSales @CompId = @c, @FromDate = @f, @ToDate = @t, @GroupBy = 'team', @UserId = @u, @LinesOnly = 1;
-- INSERT INTO #S (GroupKey, LineKind, New, Calls, Visits, Meetings, FuMissed, Won, Lost, OpenNow, OverdueNow)       -- the TOTALS row
-- SELECT NULL, 'total', SUM(New), SUM(Calls), SUM(Visits), SUM(Meetings), SUM(FuMissed), SUM(Won), SUM(Lost), SUM(OpenNow), SUM(OverdueNow) FROM #S;
-- CREATE TABLE #D (Total INT, AmountTotal DECIMAL(18,2));
-- CREATE TABLE #X (GroupKey INT NULL, LineKind VARCHAR(10), Metric VARCHAR(12), Cell INT, Drill INT);
-- DECLARE @k INT, @kind VARCHAR(10), @m VARCHAR(12), @flag VARCHAR(8), @cell INT, @p INT, @r BIT, @un BIT;
-- DECLARE cur CURSOR LOCAL FAST_FORWARD FOR
--   SELECT s.GroupKey, s.LineKind, v.m, v.fl, v.cell FROM #S s
--   CROSS APPLY (VALUES ('new', NULL, s.New), ('call', NULL, s.Calls), ('visits', NULL, s.Visits + s.Meetings), ('fu_missed', NULL, s.FuMissed),
--                       ('won', NULL, s.Won), ('lost', NULL, s.Lost), ('open', NULL, s.OpenNow), ('open', 'overdue', s.OverdueNow)) v(m, fl, cell);
-- OPEN cur; FETCH NEXT FROM cur INTO @k, @kind, @m, @flag, @cell;
-- WHILE @@FETCH_STATUS = 0
-- BEGIN
--   SELECT @p = CASE WHEN @kind IN ('unassigned','total') THEN NULL ELSE @k END,
--          @r = CASE WHEN @kind = 'team' THEN 1 ELSE 0 END, @un = CASE WHEN @kind = 'unassigned' THEN 1 ELSE 0 END;
--   DELETE FROM #D;
--   INSERT INTO #D EXEC dbo.sp_RptSalesRows @CompId = @c, @FromDate = @f, @ToDate = @t, @GroupBy = 'team', @Metric = @m, @Shape = 'events',
--        @PersonId = @p, @Rollup = @r, @Unassigned = @un, @Flag = @flag, @MaxRows = 0, @UserId = @u;
--   INSERT INTO #X SELECT @k, @kind, @m + ISNULL('/' + @flag, ''), @cell, Total FROM #D;
--   FETCH NEXT FROM cur INTO @k, @kind, @m, @flag, @cell;
-- END
-- CLOSE cur; DEALLOCATE cur;
-- SELECT * FROM #X WHERE Cell <> Drill;                                             -- expect 0 rows
-- SELECT COUNT(*) AS Checked FROM #X;                                               -- expect (lines + 1) * 8
-- DROP TABLE #S, #D, #X;
-- V8b the same block with @NodeId = <a manager at the start level, e.g. Priya Sharma> on the sp_RptSales call: expect 0 rows.
-- V8c the same block with an Own-reach staff id: @UserId = <staffId> and @OwnerIdsJson = '[<staffId>]' on both calls: expect 0 rows.
-- V9 the same block for @GroupBy = 'source': p / r / un are not used; per line pass @GroupKey = s.GroupKey
--    (@GroupKeyIsNull = 1 when it is NULL), metrics 'new' and 'new' with each @State
--    (open -> CohortOpen, won -> CohortWon, lost -> CohortLost, junk -> CohortJunk, untouched -> CohortUntouched).   -- expect 0 rows
-- V10 roll-up: for one manager M with LineKind 'team' at the start level, M's start cells = the column sums of
--    INSERT INTO #S2 EXEC dbo.sp_RptSales ... @NodeId = M, @LinesOnly = 1 (same dates, same scope).   -- expect equal on every column
-- V11 scope: EXEC dbo.sp_RptSales @CompId = 1, @FromDate = '2026-09-01', @ToDate = '2026-09-30', @GroupBy = 'team',
--        @UserId = <staffId>, @OwnerIdsJson = '[<staffId>]';            -- expect exactly 1 line, LineKind 'person'
--     ... @UserId = NULL, @OwnerIdsJson = '[]';                          -- expect 0 lines
--     ... @UserId = <staffId>, @OwnerIdsJson = '[<staffId>]', @NodeId = 2;   -- expect 0 lines, RS3 NodeOk = 0
-- V12 cap: EXEC dbo.sp_RptSalesRows @CompId = 1, @FromDate = '2026-09-01', @ToDate = '2026-09-30', @GroupBy = 'team',
--        @Metric = 'new', @Shape = 'events', @MaxRows = 5, @UserId = 2;   -- expect RS1 5 rows, RS2 Total 221 (the full count)
-- V13 dropped rows (credited to a user row that does not exist: they fall in no line, so they are shown here):
-- SELECT r.Metric, COUNT(*) AS n FROM dbo.fn_SalesReportRows(1, '2026-09-01', '2026-10-01', 2, NULL, NULL) r
-- WHERE r.PersonId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.tblUser u WHERE u.Id = r.PersonId AND u.CompId = 1)
-- GROUP BY r.Metric;                                                    -- read the count; 0 rows on TestCRM on 2026-11-18
-- V13b people-subject rows with nobody to credit (follow-up with no DoneBy, no AssignedTo, on a lead with no owner):
--    they count on the 'Unassigned leads' line (owner axis off), and the @Unassigned = 1 drill returns them.
-- SELECT r.Metric, COUNT(*) AS n FROM dbo.fn_SalesReportRows(1, '2026-09-01', '2026-10-01', 2, NULL, NULL) r
-- WHERE r.PersonId IS NULL AND r.Src <> 'L' GROUP BY r.Metric;     -- TestCRM 2026-11-18: fu_missed 5 (follow-ups 2207-2211)
--    measured 2026-11-18, team start level for the owner, Sep 2026 (aggregate run read-only before apply):
--    Priya Sharma (13) New 214 · Calls 209 · Visits+Meetings 110 · Won 6 (17000) · Lost 49 · Open 524 · Missed 344
--    Unassigned leads New 6 · Open 9 · Missed 5   Ayush Mishra (own) New 1 · Open 85   Rajesh Verma (74) Open 8
--    lines sum: New 221 · Calls 209 · Visits+Meetings 110 · Won 6 (17000) · Lost 49 · Open 626 = V5;
--    Missed 344 + 5 (Unassigned, the V13b rows) = 349 = V5.
