-- ===========================================================================
-- 082_transfers_scope.sql
--
-- Fixes two number-correctness defects in sp_RptTransfers, found by the
-- 2026-09-13 audit. Not a privacy leak (see "WHAT DOES NOT CHANGE") -- a wrong
-- KPI for exactly the persona the report exists for.
--
-- SYMPTOM (measured 2026-09-13, CompId 1, AssignedAt in 2026)
--   bm_ho_rahul (15, Branch scope, branchIds [1]) opens Transfers:
--
--                                  reads   should read
--     Transfers                       47            61
--     CrossBranch                      5            18
--     SendBacks                       20            20
--     Unassigns                        0             2
--
--   14 transfers moved a lead OUT of branch 1 in that window. Exactly 1 was
--   visible to him. His own branch's outbound transfers -- the thing a branch
--   manager opens this report to see -- were the rows missing.
--
-- WHY
--   The row is a TRANSFER. It carries its own FromBranchId / ToBranchId. The
--   scope predicate gated it on l.BranchId -- where the lead sits NOW, i.e.
--   the DESTINATION. So a completed outbound cross-branch transfer left the
--   source manager's scope at the instant it succeeded: visible right up to
--   the moment it mattered, gone the moment it committed. That is the worst
--   possible time to hide an assignment audit record.
--
--   The proc had already decided what "this branch's transfers" means -- its
--   own optional filter reads
--       (@BranchId IS NULL OR a.ToBranchId = @BranchId OR a.FromBranchId = @BranchId)
--   i.e. either end. The scope half just never agreed with the filter it is
--   supposed to bound. CLAUDE.md section 3: an optional filter narrows WITHIN
--   scope; here the filter was strictly wider than the scope, which is
--   incoherent whichever one you call correct.
--
--   Second defect, same proc:
--       CrossBranch = ISNULL(a.FromBranchId, a.ToBranchId) <> a.ToBranchId
--   The ISNULL guards the wrong side. With a NULL ToBranchId the comparison is
--   `<> NULL` -> UNKNOWN -> CASE falls through to 0, so a branch move silently
--   reads as same-branch. Both columns are NULLable.
--
-- WHAT CHANGES (two hunks, nothing else in the proc)
--   1. The branch half of the scope predicate also accepts the transfer's own
--      branches:
--          OR a.FromBranchId IN @BranchIds OR a.ToBranchId IN @BranchIds
--      l.BranchId STAYS as a disjunct. A lead in my branch shows its whole
--      assignment history on the lead timeline already; dropping it would
--      create a fresh report/page disagreement. Measured: 0 rows in the live
--      data have l.BranchId in scope while neither end is, so keeping it costs
--      nothing and removes a behaviour change nobody asked for.
--   2. CrossBranch guards both sides:
--          ISNULL(a.FromBranchId, a.ToBranchId) <> ISNULL(a.ToBranchId, a.FromBranchId)
--      Unknown on either side is not evidence of a move, which is what the
--      original ISNULL meant for the From side. NOTE: this changes NO number
--      today -- 0 of 120 live rows have a NULL branch, and sp_TransferLead
--      cannot write one (`SET @ToBranchId = ISNULL(@ToBranchId, @FromBranchId)`).
--      It is a latent hazard closed, not a restated KPI. The 5 -> 18 gap above
--      is hunk 1 alone.
--
-- WHAT DOES NOT CHANGE -- and why this is not a widening
--   * The branch half is still ANDed with the owner half. Structurally, no row
--     can now reach a caller whose owner scope excludes it. Measured, same
--     window: se_se_pooja (21, Self, branch 2) 46 -> 46, sh_priya (13,
--     Company) 120 -> 120. Only the branch-scoped managers move, and only onto
--     transfers with one foot in their own branch: bm_se_vikram (20, branch 2)
--     50 -> 56, the mirror of Rahul's 47 -> 61.
--   * The proc returns NO lead fields -- counts, two user names and a branch
--     name. A branch manager seeing "my rep handed this to South Ext" learns
--     nothing he could not read on the lead before it left, and the recipient's
--     name is already in his assignable-users picker.
--   * The owner half is untouched. Its `a.ToUserId / a.FromUserId IN @OwnerIds`
--     disjuncts are the OWNER-AXIS TWIN of this very fix: removing them would
--     reintroduce the identical bug one axis over -- a Sales Team Lead would
--     stop seeing her own rep's outbound transfers the moment they succeeded
--     (measured: tl_ho_neha would drop from 44 transfers to 7). They stay.
--   * RS2 / RS3 / grouping / the SendBack and Unassign KPIs: byte-identical.
--
-- Backend: no controller change. reportKit already sends scopeParams(req).
-- ===========================================================================
SET NOCOUNT ON;
GO

CREATE OR ALTER PROC dbo.sp_RptTransfers
    @CompId                  INT,
    @FromDate                DATE,
    @ToDate                  DATE,
    @DateBasis               VARCHAR(10)   = 'created',
    @BranchId                INT           = NULL,
    @OwnerId                 INT           = NULL,
    @SourceId                INT           = NULL,
    @ProductId               INT           = NULL,
    @GroupBy                 VARCHAR(20)   = 'reason',
    @UserId                  INT           = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF ISNULL(@GroupBy, '') NOT IN ('reason','pair','branch')
    BEGIN RAISERROR('sp_RptTransfers: unknown GroupBy', 16, 1); RETURN; END
    -- A transfer has one date, AssignedAt; @DateBasis ignored.

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

    -- SendBacks is matched on tblLookup.Code = 'sent_back', never on Value:
    -- Value is company-editable free text and renaming the reason in Settings
    -- must not zero a KPI. Section 8 stamps that Code on the seeded row, the
    -- same treatment call_outcome gets for sp_RptActivity's Connected.
    SELECT a.Id,
           -- Both sides guarded: `x <> NULL` is UNKNOWN, which read as 0 and
           -- hid a branch move whenever ToBranchId was NULL. Unknown on either
           -- side is not evidence of a move.
           CASE WHEN ISNULL(a.FromBranchId, a.ToBranchId) <> ISNULL(a.ToBranchId, a.FromBranchId) THEN 1 ELSE 0 END AS CrossBranch,
           CASE WHEN r.Code = 'sent_back' THEN 1 ELSE 0 END AS SendBack,
           CASE WHEN a.ToUserId IS NULL THEN 1 ELSE 0 END AS Unassign,
           CASE @GroupBy WHEN 'reason' THEN a.ReasonId
                         WHEN 'pair'   THEN a.FromUserId
                         WHEN 'branch' THEN a.ToBranchId END AS GroupKey,
           CASE @GroupBy WHEN 'reason' THEN ISNULL(r.Value, N'No reason')
                         WHEN 'pair'   THEN ISNULL(fu.FullName, N'Unassigned') + N' → ' + ISNULL(tu.FullName, N'Unassigned')
                         WHEN 'branch' THEN ISNULL(tb.BranchName, N'—') END AS GroupLabel,
           CASE WHEN @GroupBy = 'pair' THEN a.ToUserId END AS SubKey,
           CASE WHEN @GroupBy = 'pair' THEN ISNULL(tu.FullName, N'Unassigned') END AS SubLabel,
           CAST(CASE WHEN @Weekly = 1 THEN DATEADD(WEEK, DATEDIFF(WEEK, 0, a.AssignedAt), 0) ELSE a.AssignedAt END AS DATE) AS Bucket
    INTO #A
    FROM dbo.tblLeadAssignment a
    JOIN dbo.tblLeads l        ON l.Id = a.LeadId AND l.CompId = a.CompId
    LEFT JOIN dbo.tblLookup r  ON r.Id = a.ReasonId
    LEFT JOIN dbo.tblUser fu   ON fu.Id = a.FromUserId
    LEFT JOIN dbo.tblUser tu   ON tu.Id = a.ToUserId
    LEFT JOIN dbo.tblBranch tb ON tb.Id = a.ToBranchId
    WHERE a.CompId = @CompId AND a.ReasonId IS NOT NULL
      AND (@BranchId  IS NULL OR a.ToBranchId = @BranchId OR a.FromBranchId = @BranchId)
      AND (@OwnerId   IS NULL OR a.ToUserId = @OwnerId OR a.FromUserId = @OwnerId)
      AND (@SourceId  IS NULL OR l.SourceId  = @SourceId)
      AND (@ProductId IS NULL OR l.ProductId = @ProductId)
      AND a.AssignedAt >= @FromDate AND a.AssignedAt < @ToEx
      -- The row is the TRANSFER, so both halves key on the transfer's own
      -- columns as well as the lead's. Gating on l.BranchId alone dropped an
      -- outbound cross-branch transfer out of the SOURCE manager's scope the
      -- instant it succeeded; it is also what the @BranchId filter six lines
      -- up has always meant by "this branch". The two halves still AND, so a
      -- wider branch set cannot outrun the owner set.
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds)
                                      OR a.FromBranchId IN (SELECT BranchId FROM @BranchIds)
                                      OR a.ToBranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId IN (SELECT OwnerId FROM @OwnerIds)
                                      OR a.ToUserId IN (SELECT OwnerId FROM @OwnerIds)
                                      OR a.FromUserId IN (SELECT OwnerId FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId OR a.ToUserId = @UserId OR a.FromUserId = @UserId))
          );

    -- RS1
    SELECT COUNT(*) AS Transfers,
           ISNULL(SUM(CrossBranch), 0) AS CrossBranch,
           ISNULL(SUM(SendBack), 0)    AS SendBacks,
           ISNULL(SUM(Unassign), 0)    AS Unassigns
    FROM #A;

    -- RS2
    SELECT GroupKey, GroupLabel, SubKey, SubLabel,
           COUNT(*) AS Transfers, SUM(CrossBranch) AS CrossBranch, SUM(SendBack) AS SendBacks, SUM(Unassign) AS Unassigns
    FROM #A
    GROUP BY GroupKey, GroupLabel, SubKey, SubLabel
    ORDER BY Transfers DESC, GroupLabel;

    -- RS3
    SELECT Bucket, COUNT(*) AS Transfers
    FROM #A
    GROUP BY Bucket
    ORDER BY Bucket;
END
GO

-- ===========================================================================
-- VERIFY AFTER APPLY  (read-only; safe to re-run)
--
-- Window 2026-01-01..2026-12-31 covers every tblLeadAssignment row in the
-- live data (2026-03-16 .. 2026-09-12), so these are stable numbers, not a
-- rolling window. Only RS1 matters below; RS2/RS3 come along for the ride.
--
--   1. bm_ho_rahul (15, Branch, branchIds [1], no owner scope)
--        BEFORE: Transfers 47  CrossBranch  5  SendBacks 20  Unassigns 0
--        AFTER : Transfers 61  CrossBranch 18  SendBacks 20  Unassigns 2
--      This is the fix. 14 transfers moved a lead out of branch 1; 1 was
--      visible before.
--
--   2. tl_ho_neha (16, Team, branchIds [1], ownerIds [16,17,18])
--        BEFORE: Transfers 44  CrossBranch  5  SendBacks 17  Unassigns 0
--        AFTER : Transfers 53  CrossBranch 14  SendBacks 17  Unassigns 0
--      Her team's own outbound transfers come back. The owner half still
--      gates: she gains only rows where one of {16,17,18} was a party or owns
--      the lead.
--
--   3. NO-LEAK PROBES -- these two must NOT move.
--        se_se_pooja (21, Self, branch 2)  : Transfers 46 before AND after.
--        sh_priya    (13, Company, all)    : Transfers 120 before AND after.
--      Pooja is proof the owner half still fences a Self user; Priya is proof
--      the company total did not change (a wider branch half cannot invent
--      rows).
-- ===========================================================================
PRINT '1. bm_ho_rahul (15, Branch [1]) -- expect RS1: 61 / 18 / 20 / 2';
EXEC dbo.sp_RptTransfers @CompId = 1, @FromDate = '2026-01-01', @ToDate = '2026-12-31',
     @UserId = 15, @AccessibleBranchIdsJson = N'[1]', @OwnerIdsJson = NULL;

PRINT '2. tl_ho_neha (16, Team [1], owners [16,17,18]) -- expect RS1: 53 / 14 / 17 / 0';
EXEC dbo.sp_RptTransfers @CompId = 1, @FromDate = '2026-01-01', @ToDate = '2026-12-31',
     @UserId = 16, @AccessibleBranchIdsJson = N'[1]', @OwnerIdsJson = N'[16,17,18]';

PRINT '3a. NO-LEAK: se_se_pooja (21, Self, branch 2) -- expect RS1 Transfers 46 (unchanged)';
EXEC dbo.sp_RptTransfers @CompId = 1, @FromDate = '2026-01-01', @ToDate = '2026-12-31',
     @UserId = 21, @AccessibleBranchIdsJson = N'[2]', @OwnerIdsJson = N'[21]';

PRINT '3b. NO-LEAK: sh_priya (13, Company) -- expect RS1 Transfers 120 (unchanged)';
EXEC dbo.sp_RptTransfers @CompId = 1, @FromDate = '2026-01-01', @ToDate = '2026-12-31',
     @UserId = 13, @AccessibleBranchIdsJson = N'[1,2,3,4,5]', @OwnerIdsJson = NULL;
GO
