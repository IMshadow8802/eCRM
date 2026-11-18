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
