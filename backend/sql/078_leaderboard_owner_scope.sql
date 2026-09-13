-- ===========================================================================
-- 078_leaderboard_owner_scope.sql
--
-- Fixes a misleading ranking found by the spec-4a live contract check
-- (2026-09-13, run against the applied 075 + 076).
--
-- SYMPTOM
--   Logged in as se_ho_amit (Sales Executive, DataScope = Self), the
--   Leaderboard listed SEVEN reps -- including Isha Bose, an executive in
--   branch 3 that Amit has no relationship with -- and ranked Amit #1 with
--   108 leads against colleagues showing 0-9.
--
-- NOT A DATA LEAK. Every one of those rows traces to a lead Amit can already
-- see: five reps are the current owners of leads Amit CREATED, and Isha did 8
-- follow-ups on leads Amit OWNS. sp_RptLeaderboard's scope predicate is
-- correct and unchanged by this script.
--
-- THE REAL PROBLEM IS THAT A LEADERBOARD IS A RANKING.
--   Those reps' numbers are not their numbers -- they are the slivers visible
--   through Amit's own leads. Amit reads the table as "I am outperforming the
--   team 12:1", which is false. A rep whose work you can only partly see must
--   not be ranked against you.
--
-- FIX
--   When owner scope is active (@OwnerIdsJson non-empty -- i.e. DataScope is
--   Self or Team), restrict the rep list to those owner ids plus the caller.
--   Branch / Company / All scopes pass an empty @OwnerIdsJson, so they are
--   untouched and still rank everyone they can see in full.
--
--   Self  -> the rep sees only himself.
--   Team  -> a Team Lead sees his own team, which is what he manages.
--   Branch+ -> unchanged.
--
-- Only the `reps` CTE changes. Everything else in the proc is byte-identical
-- to 075.
-- ===========================================================================
SET NOCOUNT ON;
GO

CREATE OR ALTER PROC dbo.sp_RptLeaderboard
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
    IF ISNULL(@GroupBy, '') NOT IN ('owner')
    BEGIN RAISERROR('sp_RptLeaderboard: unknown GroupBy', 16, 1); RETURN; END
    -- Leads are dated on CreatedAt, activities on DoneAt; @DateBasis ignored.

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
    DECLARE @ToEx DATETIME = DATEADD(DAY, 1, CAST(@ToDate AS DATETIME));
    DECLARE @Now  DATETIME = GETDATE();

    -- Scoped leads created in range, with their qualified date and first touch.
    SELECT l.Id, l.OwnerId, l.CreatedAt,
           (SELECT MIN(h.ChangedAt) FROM dbo.tblLeadStatusHistory h JOIN dbo.tblLookup s ON s.Id = h.ToStatusId
             WHERE h.CompId = @CompId AND h.LeadId = l.Id AND s.Code = 'qualified') AS QualifiedAt,
           (SELECT MIN(f.DoneAt) FROM dbo.tblFollowUp f
             WHERE f.CompId = @CompId AND f.LeadId = l.Id AND f.Status = 'done') AS FirstTouchAt
    INTO #L
    FROM dbo.tblLeads l
    WHERE l.CompId = @CompId AND l.OwnerId IS NOT NULL
      AND (@BranchId  IS NULL OR l.BranchId  = @BranchId)
      AND (@OwnerId   IS NULL OR l.OwnerId   = @OwnerId)
      AND (@SourceId  IS NULL OR l.SourceId  = @SourceId)
      AND (@ProductId IS NULL OR l.ProductId = @ProductId)
      AND l.CreatedAt >= @FromDate AND l.CreatedAt < @ToEx
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))
          );

    -- Scoped follow-ups in range, carrying Compliance's four terms verbatim so
    -- the leaderboard's OnTimePct is the same number the Compliance report
    -- shows for that rep. Skipped and missed rows have no DoneBy, so the rep is
    -- COALESCE(DoneBy, AssignedTo, l.OwnerId) as it is there, and the row is
    -- dated on COALESCE(DoneAt, DueAt) -- for a done row that is still DoneAt,
    -- so Activities (Done = 1) counts exactly what it counted before.
    SELECT f.Id,
           COALESCE(f.DoneBy, f.AssignedTo, l.OwnerId) AS RepId,
           CASE WHEN f.Status = 'done' THEN 1 ELSE 0 END AS Done,
           CASE WHEN f.Status = 'done' AND f.DoneAt <= DATEADD(HOUR, 2, f.DueAt) THEN 1 ELSE 0 END AS OnTime,
           CASE WHEN f.Status = 'done' AND f.DoneAt >  DATEADD(HOUR, 2, f.DueAt) THEN 1 ELSE 0 END AS Late,
           CASE WHEN f.Status = 'skipped' THEN 1 ELSE 0 END AS Skipped,
           CASE WHEN f.Status = 'open' AND f.DueAt < @Now AND d.LeadCode IN ('open','qualified') THEN 1 ELSE 0 END AS Missed
    INTO #F
    FROM dbo.tblFollowUp f
    JOIN dbo.tblLeads l   ON l.Id = f.LeadId AND l.CompId = f.CompId
    JOIN dbo.tblLookup st ON st.Id = l.StatusId
    CROSS APPLY (SELECT COALESCE(f.DoneAt, f.DueAt) AS EventAt, st.Code AS LeadCode) d
    WHERE f.CompId = @CompId
      AND COALESCE(f.DoneBy, f.AssignedTo, l.OwnerId) IS NOT NULL
      AND (@BranchId  IS NULL OR l.BranchId  = @BranchId)
      AND (@OwnerId   IS NULL OR COALESCE(f.DoneBy, f.AssignedTo, l.OwnerId) = @OwnerId)
      AND (@SourceId  IS NULL OR l.SourceId  = @SourceId)
      AND (@ProductId IS NULL OR l.ProductId = @ProductId)
      AND ((f.DoneAt >= @FromDate AND f.DoneAt < @ToEx)
        OR (f.DoneAt IS NULL AND f.DueAt >= @FromDate AND f.DueAt < @ToEx))
      AND d.EventAt >= @FromDate AND d.EventAt < @ToEx
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId IN (SELECT OwnerId FROM @OwnerIds) OR f.DoneBy IN (SELECT OwnerId FROM @OwnerIds) OR f.AssignedTo IN (SELECT OwnerId FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId OR f.DoneBy = @UserId OR f.AssignedTo = @UserId))
          );

    -- RS1: no KPI row for a leaderboard (spec §3)
    SELECT CAST(NULL AS INT) AS Nothing WHERE 1 = 0;

    -- RS2: one row per rep who owns a lead or did an activity in range.
    -- THE ONLY CHANGE IN 078: under owner scope (Self / Team) a rep is listed
    -- only if he is in scope or is the caller. Otherwise the table ranks the
    -- caller against colleagues whose numbers are just the fragments visible
    -- through the caller's own leads, which reads as a real ranking and is not.
    ;WITH reps AS (
        SELECT OwnerId AS RepId FROM #L
        UNION
        SELECT RepId FROM #F
    ), visible_reps AS (
        SELECT r.RepId FROM reps r
        WHERE @UseOwnerScope = 0
           OR r.RepId IN (SELECT OwnerId FROM @OwnerIds)
           OR r.RepId = @UserId
    ), stats AS (
        SELECT r.RepId,
               (SELECT COUNT(*) FROM #L x WHERE x.OwnerId = r.RepId) AS Created,
               (SELECT COUNT(*) FROM #L x WHERE x.OwnerId = r.RepId AND x.QualifiedAt IS NOT NULL) AS Qualified,
               (SELECT COUNT(*) FROM #F y WHERE y.RepId = r.RepId AND y.Done = 1) AS Activities,
               (SELECT CAST(100.0 * SUM(y.OnTime) / NULLIF(SUM(y.OnTime) + SUM(y.Late) + SUM(y.Skipped) + SUM(y.Missed), 0) AS DECIMAL(5,1))
                  FROM #F y WHERE y.RepId = r.RepId) AS OnTimePct,
               (SELECT CAST(AVG(DATEDIFF(MINUTE, x.CreatedAt, x.FirstTouchAt) / 60.0) AS DECIMAL(8,1))
                  FROM #L x WHERE x.OwnerId = r.RepId AND x.FirstTouchAt IS NOT NULL) AS AvgResponseHours
        FROM visible_reps r
    )
    SELECT s.RepId AS GroupKey, ISNULL(u.FullName, N'Unknown') AS GroupLabel,
           s.Created, s.Qualified, s.Activities, s.OnTimePct, s.AvgResponseHours,
           CAST(RANK() OVER (ORDER BY s.Qualified DESC, s.Activities DESC, s.Created DESC) AS INT) AS [Rank]
    FROM stats s
    LEFT JOIN dbo.tblUser u ON u.Id = s.RepId
    ORDER BY [Rank], GroupLabel;

    -- RS3: no trend for a leaderboard (spec §3)
    SELECT CAST(NULL AS DATE) AS Bucket WHERE 1 = 0;
END
GO

-- ===========================================================================
-- VERIFY AFTER APPLY  (read-only; safe to re-run)
--   Amit  (17, Self)  -> expect exactly 1 row, GroupKey 17
--   Neha  (16, Team)  -> expect only her own team's reps
--   Priya (13, Company) -> unchanged, expect the full roster (13 rows on the
--                          076 seed)
-- ===========================================================================
DECLARE @from DATE = '2026-03-17', @to DATE = '2026-09-13';

PRINT 'Amit (Self) -- expect 1 row, GroupKey 17:';
EXEC dbo.sp_RptLeaderboard @CompId = 1, @FromDate = @from, @ToDate = @to,
     @GroupBy = 'owner', @UserId = 17,
     @AccessibleBranchIdsJson = N'[1]', @OwnerIdsJson = N'[17]';

PRINT 'Neha (Team) -- expect her team only:';
EXEC dbo.sp_RptLeaderboard @CompId = 1, @FromDate = @from, @ToDate = @to,
     @GroupBy = 'owner', @UserId = 16,
     @AccessibleBranchIdsJson = N'[1]', @OwnerIdsJson = N'[16,17,18,19]';

PRINT 'Priya (Company) -- unchanged, expect the full roster:';
EXEC dbo.sp_RptLeaderboard @CompId = 1, @FromDate = @from, @ToDate = @to,
     @GroupBy = 'owner', @UserId = 13,
     @AccessibleBranchIdsJson = N'[1,2,3,4,5]', @OwnerIdsJson = NULL;
GO
