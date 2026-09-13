-- ===========================================================================
-- 083_compliance_scope_comment.sql
--
-- COMMENT-ONLY. Zero behaviour change. Apply it, or don't -- nothing depends
-- on it. It exists because the lie it removes is stored in the database, not
-- just in a file: the header block below is part of sp_RptFollowUpCompliance's
-- definition in sys.sql_modules, so `sp_helptext` and the next auditor read it.
--
-- SYMPTOM
--   The 2026-09-13 audit flagged sp_RptFollowUpCompliance (075:916) for
--   carrying an owner-scope disjunct -- `OR f.AssignedTo IN @OwnerIds` -- that
--   sp_FetchFollowUps does not have, while its own header (075:806-812)
--   claimed the predicate was "the same predicate sp_FetchFollowUps (071)
--   uses". The paragraph contradicted itself inside five lines: the sentence
--   right after the claim described the extra disjunct.
--
-- DECISION
--   The predicate is RIGHT and stays. The comment was wrong and is rewritten
--   to say what the predicate actually does, why it deliberately differs from
--   the list SP, and what that costs. Full reasoning is in the header block
--   below -- it is the deliverable here, so it is written into the proc rather
--   than into this wrapper, where it would be deleted with the script.
--
--   Short version: sp_RptFollowUpCompliance / sp_RptActivity / sp_RptLeaderboard
--   are PEOPLE reports. Narrowing them to the lead-centric list predicate would
--   have made a Team lead see FEWER of her own rep's activities than both the
--   rep herself and the rep's branch manager (se_ho_sara: 256 / 256 / 229), and
--   would have made a closed month's on-time % move whenever a lead changed
--   hands. Neither is acceptable in a report that ranks people.
--
-- WHAT CHANGES
--   Two hunks, both outside the proc body:
--     1. the five-line "Scope:" paragraph in the header block -> rewritten;
--     2. CREATE   PROC -> CREATE OR ALTER PROC.
--   The body -- params, #F, the predicate, RS1/RS2/RS3 -- is byte-identical to
--   the live definition. Diffed, not asserted.
--
--   The rest of the header block is carried over verbatim, including its
--   references to "Part D of this script" and section numbering, which belong
--   to 075 and are kept only so the diff stays two hunks.
--
-- NOT CHANGED, deliberately
--   * sp_RptActivity, sp_RptLeaderboard, sp_RptTransfers -- same decision, and
--     none of their stored definitions carries the false claim, so none needs
--     a redeploy.
--   * sp_FetchFollowUps / sp_FetchLeads -- see KNOWN-OPEN in the block below.
--     Widening the list SPs would put rows in the Follow-ups page whose lead
--     403s on the "view lead" button, which trades a number difference between
--     two unlinked pages for a dead control on a page people use.
--   * No backend change. No web change.
-- ===========================================================================
SET NOCOUNT ON;
GO

-- ===========================================================================
-- 6. REPORT PROCS — follow-up family
--
-- Contract (spec §3): same twelve params, three result sets, no ResponseCode.
--
-- Scope: a follow-up is visible when it sits in an accessible BRANCH and
-- either its lead is owned by someone in the caller's owner scope OR the
-- follow-up is ASSIGNED to someone in it -- or the caller owns/created the
-- lead, or the follow-up is the caller's own.
--
-- That second disjunct, f.AssignedTo IN @OwnerIds, is DELIBERATE and is NOT
-- what sp_FetchFollowUps uses. An earlier version of this comment claimed the
-- predicate was copied verbatim from that proc. It never was -- the very next
-- sentence contradicted it -- and the 2026-09-13 audit rightly flagged the
-- lie. The difference is kept, on purpose, for three reasons:
--
--   1. This is a PEOPLE report; its subject is the rep, not the lead. Without
--      the disjunct a rep's historical on-time % mutates whenever a lead
--      changes hands, with no activity having occurred.
--   2. It is what keeps a manager's view consistent with everyone else's.
--      Measured 2026-09-13, CompId 1, rep se_ho_sara (18): her Leaderboard
--      Activities read 256 to herself, 256 to bm_ho_rahul (15, Branch) and
--      256 to her own manager tl_ho_neha (16, Team). Drop the disjunct and
--      Neha -- and only Neha, the manager in between -- reads 229. A report
--      that ranks people must not show the middle manager less than the two
--      people either side of her.
--   3. It changes nothing for any scope but Team. @OwnerIds is empty for
--      All / Company / MultiBranch / Branch (@UseOwnerScope = 0), and for
--      Self it is {caller}, where the disjunct is already covered by the
--      @UserId escape hatch on the line below it.
--
-- It is not a widening: the branch half still ANDs, so no row can reach a
-- caller outside an accessible branch. Verified -- 0 of the 51 extra rows
-- tl_ho_neha sees cross a branch boundary, and every one of them is her own
-- rep's work on a lead since transferred away from her team.
--
-- CONSEQUENCE, expected and correct: this report counts more follow-ups than
-- the Follow-ups PAGE shows a Team lead (tl_ho_neha: 748 here, 697 there).
-- The page answers "follow-ups on leads I can open"; this answers "my team's
-- follow-up work". Nothing links the two -- every drill on this report lands
-- on the LEADS list, keyed on Missed, and Missed is unaffected either way:
-- all 51 extra rows are done or skipped, never open, because an open
-- follow-up travels with its lead (sp_TransferLead rewrites AssignedTo). The
-- drill still reconciles.
--
-- KNOWN-OPEN, separate defect, NOT fixed here: sp_FetchFollowUps' owner half
-- is narrower than its own @UserId hatch, so Team scope is not a superset of
-- a member's Self scope -- se_ho_amit (17) sees 54 follow-ups on the page
-- that his own manager tl_ho_neha (16) cannot. Closing it properly needs
-- l.CreatedBy IN @OwnerIds as well, in sp_FetchFollowUps and sp_FetchLeads
-- both, which is a scope-model change and wants its own script.
--
-- Dates: compliance is dated on DueAt for @DateBasis='created' and on
-- COALESCE(DoneAt, DueAt) otherwise; activity has exactly one date (DoneAt)
-- and ignores @DateBasis, as does the leaderboard (leads on CreatedAt,
-- follow-ups on COALESCE(DoneAt, DueAt) — a skipped or still-open one has no
-- DoneAt, and the leaderboard now counts those). For the default basis the window is
-- repeated on the base column (f.DueAt) as well as on d.EventAt: a predicate
-- on a CROSS APPLY output is not sargable, so without it the optimizer has no
-- range on a real column to estimate or to push down as a residual filter.
--
-- 'On time' is DoneAt <= DueAt + 2h (the grace in spec §3); 'Missed' is a
-- follow-up still open whose DueAt has passed as of GETDATE() AND whose lead is
-- still in play (lead_status Code 'open' or 'qualified', carried into #F as
-- LeadCode). The active-lead gate is what makes Missed reconcile with the row's
-- drill, which lists that group's overdue ACTIVE leads: a follow-up left open
-- on a lost or junk lead is nobody's outstanding work. It gates Missed only —
-- Due, DoneOnTime, DoneLate and Skipped count on every lead. Every row in #F
-- already has DueAt < @ToEx, so for a window that has closed the two readings
-- ("past due now" / "past due at @ToEx") coincide; GETDATE() is the stricter
-- one for a window running into the future, where a not-yet-due follow-up is
-- not a miss.
--
-- The leaderboard's OnTimePct uses those same four terms, so a rep's number
-- there is the number Compliance shows for him — 'of everything that came due',
-- not 'of what he got round to'.
--
-- Every tblLeadStatusHistory / tblFollowUp correlated read carries CompId as
-- well as LeadId: multi-tenancy, and both tables' indexes lead with CompId.
-- The 'Connected' outcome is matched on tblLookup.Code = 'connected', not on
-- Value: Value is company-editable free text and renaming it must not zero a
-- KPI. Part D of this script backfills Code on the call_outcome rows, which
-- today carry Code NULL — so apply this script whole, in order.
-- ===========================================================================

CREATE OR ALTER PROC dbo.sp_RptFollowUpCompliance
    @CompId                  INT,
    @FromDate                DATE,
    @ToDate                  DATE,
    @DateBasis               VARCHAR(10)   = 'created',
    @BranchId                INT           = NULL,
    @OwnerId                 INT           = NULL,
    @SourceId                INT           = NULL,
    @ProductId               INT           = NULL,
    @GroupBy                 VARCHAR(20)   = 'owner',
    @UserId                  INT           = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF ISNULL(@GroupBy, '') NOT IN ('owner','team','branch')
    BEGIN RAISERROR('sp_RptFollowUpCompliance: unknown GroupBy', 16, 1); RETURN; END
    IF @DateBasis NOT IN ('created','closed','activity') SET @DateBasis = 'created';

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
    DECLARE @ToEx   DATETIME = DATEADD(DAY, 1, CAST(@ToDate AS DATETIME));
    DECLARE @Weekly BIT      = CASE WHEN DATEDIFF(DAY, @FromDate, @ToDate) > 31 THEN 1 ELSE 0 END;
    DECLARE @Now    DATETIME = GETDATE();

    SELECT f.Id, f.DueAt, f.DoneAt, f.Status, d.LeadCode,
           CASE WHEN f.Status = 'done' AND f.DoneAt <= DATEADD(HOUR, 2, f.DueAt) THEN 1 ELSE 0 END AS OnTime,
           CASE WHEN f.Status = 'done' AND f.DoneAt >  DATEADD(HOUR, 2, f.DueAt) THEN 1 ELSE 0 END AS Late,
           CASE WHEN f.Status = 'skipped' THEN 1 ELSE 0 END AS Skipped,
           CASE WHEN f.Status = 'open' AND f.DueAt < @Now AND d.LeadCode IN ('open','qualified') THEN 1 ELSE 0 END AS Missed,
           CASE @GroupBy WHEN 'owner'  THEN rep.Id
                         WHEN 'team'   THEN ISNULL(rep.ReportsTo, rep.Id)
                         WHEN 'branch' THEN l.BranchId END AS GroupKey,
           CASE @GroupBy WHEN 'owner'  THEN ISNULL(rep.FullName, N'Unassigned')
                         WHEN 'team'   THEN ISNULL(mgr.FullName, ISNULL(rep.FullName, N'Unassigned'))
                         WHEN 'branch' THEN ISNULL(b.BranchName, N'—') END AS GroupLabel,
           CAST(CASE WHEN @Weekly = 1 THEN DATEADD(WEEK, DATEDIFF(WEEK, 0, d.EventAt), 0) ELSE d.EventAt END AS DATE) AS Bucket
    INTO #F
    FROM dbo.tblFollowUp f
    JOIN dbo.tblLeads l       ON l.Id = f.LeadId AND l.CompId = f.CompId
    JOIN dbo.tblLookup st     ON st.Id = l.StatusId
    LEFT JOIN dbo.tblUser rep ON rep.Id = COALESCE(f.DoneBy, f.AssignedTo, l.OwnerId)
    LEFT JOIN dbo.tblUser mgr ON mgr.Id = rep.ReportsTo
    LEFT JOIN dbo.tblBranch b ON b.Id = l.BranchId
    CROSS APPLY (SELECT CASE WHEN @DateBasis = 'created' THEN f.DueAt ELSE COALESCE(f.DoneAt, f.DueAt) END AS EventAt,
                        st.Code AS LeadCode) d
    WHERE f.CompId = @CompId
      AND (@BranchId  IS NULL OR l.BranchId  = @BranchId)
      AND (@OwnerId   IS NULL OR COALESCE(f.DoneBy, f.AssignedTo, l.OwnerId) = @OwnerId)
      AND (@SourceId  IS NULL OR l.SourceId  = @SourceId)
      AND (@ProductId IS NULL OR l.ProductId = @ProductId)
      AND (@DateBasis <> 'created' OR (f.DueAt >= @FromDate AND f.DueAt < @ToEx))
      AND d.EventAt >= @FromDate AND d.EventAt < @ToEx
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId IN (SELECT OwnerId FROM @OwnerIds) OR f.AssignedTo IN (SELECT OwnerId FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId OR f.AssignedTo = @UserId))
          );

    -- RS1
    SELECT COUNT(*) AS Due,
           ISNULL(SUM(OnTime), 0)  AS DoneOnTime,
           ISNULL(SUM(Late), 0)    AS DoneLate,
           ISNULL(SUM(Skipped), 0) AS Skipped,
           ISNULL(SUM(Missed), 0)  AS Missed,
           CAST(100.0 * SUM(OnTime) / NULLIF(SUM(OnTime) + SUM(Late) + SUM(Skipped) + SUM(Missed), 0) AS DECIMAL(5,1)) AS OnTimePct,
           CAST(AVG(CASE WHEN Late = 1 THEN DATEDIFF(MINUTE, DueAt, DoneAt) / 60.0 END) AS DECIMAL(8,1)) AS AvgDelayHours
    FROM #F;

    -- RS2
    SELECT GroupKey, GroupLabel,
           COUNT(*) AS Due, SUM(OnTime) AS DoneOnTime, SUM(Late) AS DoneLate, SUM(Skipped) AS Skipped, SUM(Missed) AS Missed,
           CAST(100.0 * SUM(OnTime) / NULLIF(SUM(OnTime) + SUM(Late) + SUM(Skipped) + SUM(Missed), 0) AS DECIMAL(5,1)) AS OnTimePct,
           CAST(AVG(CASE WHEN Late = 1 THEN DATEDIFF(MINUTE, DueAt, DoneAt) / 60.0 END) AS DECIMAL(8,1)) AS AvgDelayHours
    FROM #F
    GROUP BY GroupKey, GroupLabel
    ORDER BY OnTimePct DESC, Due DESC, GroupLabel;

    -- RS3
    SELECT Bucket, COUNT(*) AS Due, SUM(OnTime) AS DoneOnTime, SUM(Late) AS DoneLate, SUM(Missed) AS Missed
    FROM #F
    GROUP BY Bucket
    ORDER BY Bucket;
END
GO

-- ===========================================================================
-- VERIFY AFTER APPLY  (read-only; safe to re-run)
--
-- This script changes no number, so the verification is that these match what
-- the report showed BEFORE it was applied. Window 2026-01-01..2026-12-31
-- covers every tblFollowUp row in the live data (DueAt 2026-03-16 ..
-- 2026-10-05), so the numbers are stable rather than a rolling window.
-- @DateBasis defaults to 'created', i.e. the DueAt window.
--
--   1. tl_ho_neha (16, Team, branchIds [1], ownerIds [16,17,18])
--        RS1: Due 748  DoneOnTime 445  DoneLate 131  Skipped 16
--      748, not 697, is the correct reading -- see the header block. 697 is
--      what the Follow-ups PAGE shows her, and the two answer different
--      questions.
--
--   2. bm_ho_rahul (15, Branch, branchIds [1], no owner scope)
--        RS1: Due 946  DoneOnTime 565  DoneLate 166  Skipped 19
--      Branch scope sends no @OwnerIdsJson, so @UseOwnerScope = 0 and the
--      disjunct under discussion is inert for him. His numbers are the proof
--      that this only ever concerned Team scope.
--
--   Missed and OnTimePct move with GETDATE() (Missed is "still open and past
--   due AS OF NOW"), so do not assert them against a fixed number -- compare
--   them to a run taken just before applying.
-- ===========================================================================
PRINT '1. tl_ho_neha (16, Team) -- expect RS1: Due 748 / OnTime 445 / Late 131 / Skipped 16';
EXEC dbo.sp_RptFollowUpCompliance @CompId = 1, @FromDate = '2026-01-01', @ToDate = '2026-12-31',
     @UserId = 16, @AccessibleBranchIdsJson = N'[1]', @OwnerIdsJson = N'[16,17,18]';

PRINT '2. bm_ho_rahul (15, Branch) -- expect RS1: Due 946 / OnTime 565 / Late 166 / Skipped 19';
EXEC dbo.sp_RptFollowUpCompliance @CompId = 1, @FromDate = '2026-01-01', @ToDate = '2026-12-31',
     @UserId = 15, @AccessibleBranchIdsJson = N'[1]', @OwnerIdsJson = NULL;
GO
