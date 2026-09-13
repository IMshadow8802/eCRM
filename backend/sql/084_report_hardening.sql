-- ===========================================================================
-- 084_report_hardening.sql
--
-- Hardens the four lead-cohort report procs against the MEDIUM findings of the
-- 2026-09-13 security audit. NONE of these is exploitable today. This is a
-- no-op pass by design: same rows, same KPIs, stronger guards. If any number
-- in the verify block at the bottom moves, something is wrong -- do not ship.
--
-- Procs changed: sp_RptFunnel, sp_RptLost, sp_RptPipelineValue, sp_RptAging.
--
-- ---------------------------------------------------------------------------
-- M1 -- label joins carry no CompId
--
--   Every join that exists only to render a name hangs off an already
--   CompId-scoped lead, and matches on a bare surrogate Id:
--
--       JOIN dbo.tblLookup st     ON st.Id = l.StatusId        -- no CompId
--       LEFT JOIN dbo.tblUser o   ON o.Id  = l.OwnerId         -- no CompId
--       LEFT JOIN dbo.tblUser mgr ON mgr.Id = o.ReportsTo      -- no CompId
--
--   NOT EXPLOITABLE TODAY. These joins cannot ADD rows to the cohort -- the
--   cohort is already fixed by `l.CompId = @CompId` plus the scope predicate,
--   and every one of these is either a LEFT JOIN (adds no rows by definition)
--   or an inner join on a 1:1 surrogate key. The database also holds exactly
--   one company, and a full sweep of every lead/follow-up/assignment foreign
--   key found ZERO rows pointing at a label row from a different company.
--
--   WHAT WOULD MAKE IT EXPLOITABLE. One cross-tenant foreign key -- a bad
--   import, a merge script, a mis-typed Id in a fixup UPDATE -- and the proc
--   renders ANOTHER COMPANY'S user name or lookup value as a GroupLabel.
--   The count stays right while the label lies, which is the worst shape of
--   this bug: nothing looks broken.
--
--   FIX. `AND <alias>.CompId = @CompId` on each label join. On a LEFT JOIN a
--   cross-tenant row then renders as the existing ISNULL fallback
--   ('Unassigned' / 'No source' / 'No product') instead of a foreign name; on
--   the inner status join the lead drops out of the cohort entirely, which is
--   correct -- a lead whose status belongs to another tenant is corrupt data,
--   not a row to report on.
--
--   SKIPPED: dbo.tblBranch. It HAS NO CompId COLUMN (Id, BranchName, Address,
--   Latitude, Longitude), so `b.CompId = @CompId` would not compile. The
--   `LEFT JOIN dbo.tblBranch b` label joins are therefore left exactly as they
--   are in all four procs. Branch is scoped indirectly, via the branch-scope
--   predicate on the lead. Closing this properly needs a column on tblBranch
--   and is out of scope here.
--
--   ALSO NOT CHANGED (flagged, not fixed): the inner
--   `JOIN dbo.tblLookup s ON s.Id = h.ToStatusId` inside the CROSS APPLY
--   subqueries. Those are predicate joins (they read s.Code), not label joins,
--   and they hang off an already `h.CompId = @CompId` scoped history row.
--   Same class, and the sweep found zero cross-tenant history rows -- but
--   adding a predicate there CAN change which leads count as Qualified/Lost,
--   so it does not belong in a pass that must not move a number.
--
-- ---------------------------------------------------------------------------
-- M3 -- the @DateBasis guard omits ISNULL
--
--       IF @DateBasis NOT IN ('created','closed','activity') SET @DateBasis = 'created';
--
--   With @DateBasis = NULL, `NULL NOT IN (...)` evaluates to UNKNOWN, the IF
--   never fires, and the variable stays NULL. Every downstream
--   `CASE @DateBasis WHEN 'closed' ... WHEN 'activity' ... ELSE l.CreatedAt`
--   then falls to its ELSE while `@DateBasis <> 'created'` is ALSO UNKNOWN --
--   a hybrid basis that is none of the three.
--
--   NOT EXPLOITABLE TODAY: it narrows rather than widens, and the controller
--   whitelists the value, so NULL cannot reach the proc from the API. But
--   this is the exact bug class that already bit this project once -- a NULL
--   @GroupBy slipped every RAISERROR guard and returned an all-NULL row. The
--   @GroupBy guard three lines above got the ISNULL treatment. This one did
--   not. FIX: `IF ISNULL(@DateBasis, '') NOT IN (...)`.
--
--   sp_RptAging is NOT changed for M3: it is a snapshot and has no @DateBasis
--   guard to fix -- the parameter is accepted for contract symmetry and never
--   read. Adding a guard there would be new behaviour, not hardening.
--
-- ---------------------------------------------------------------------------
-- L1 -- a whitespace-only scope JSON disables branch scope entirely
--
--       IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
--
--   SQL Server pads the shorter operand in a string comparison, so '   ' <> ''
--   is FALSE. The IF never fires, @UseBranchScope stays 0, and the branch half
--   of the scope predicate short-circuits to "allow everything" -- the caller
--   sees the WHOLE COMPANY.
--
--   NOT EXPLOITABLE TODAY: scopeJson (backend/src/middleware/permission.js:174)
--   emits only JSON.stringify(array) or null, never whitespace. But the
--   failure is silent, total, and fail-OPEN. 080 already uses the trimmed
--   form; this brings the four lead reports in line, for @OwnerIdsJson too.
--   FIX: LTRIM(RTRIM(@x)) <> ''.
--
-- ---------------------------------------------------------------------------
-- PROVENANCE. Each proc body below was taken from the LIVE definition
-- (sys.sql_modules), which was first confirmed byte-identical to 075 --
-- whitespace-normalised SHA2_256 matched on all four, so there is no drift to
-- preserve. The ONLY edits are the three above: 27 lines across four procs
-- (Funnel 8, Lost 8, PipelineValue 6, Aging 5). Everything else is verbatim.
-- ===========================================================================
SET NOCOUNT ON;
GO

CREATE OR ALTER PROC dbo.sp_RptFunnel
    @CompId                  INT,
    @FromDate                DATE,
    @ToDate                  DATE,
    @DateBasis               VARCHAR(10)   = 'created',
    @BranchId                INT           = NULL,
    @OwnerId                 INT           = NULL,
    @SourceId                INT           = NULL,
    @ProductId               INT           = NULL,
    @GroupBy                 VARCHAR(20)   = 'source',
    @UserId                  INT           = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF ISNULL(@GroupBy, '') NOT IN ('source','owner','product','branch','status','team')
    BEGIN RAISERROR('sp_RptFunnel: unknown GroupBy', 16, 1); RETURN; END
    IF ISNULL(@DateBasis, '') NOT IN ('created','closed','activity') SET @DateBasis = 'created';

    DECLARE @BranchIds TABLE (BranchId INT PRIMARY KEY);
    DECLARE @OwnerIds  TABLE (OwnerId  INT PRIMARY KEY);
    DECLARE @UseBranchScope BIT = 0, @UseOwnerScope BIT = 0;
    IF (@AccessibleBranchIdsJson IS NOT NULL AND LTRIM(RTRIM(@AccessibleBranchIdsJson)) <> '')
    BEGIN
        INSERT INTO @BranchIds (BranchId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@AccessibleBranchIdsJson);
        SET @UseBranchScope = 1;
    END
    IF (@OwnerIdsJson IS NOT NULL AND LTRIM(RTRIM(@OwnerIdsJson)) <> '')
    BEGIN
        INSERT INTO @OwnerIds (OwnerId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@OwnerIdsJson);
        SET @UseOwnerScope = 1;
    END
    DECLARE @ToEx   DATETIME = DATEADD(DAY, 1, CAST(@ToDate AS DATETIME));
    DECLARE @Weekly BIT      = CASE WHEN DATEDIFF(DAY, @FromDate, @ToDate) > 31 THEN 1 ELSE 0 END;

    SELECT l.Id, l.CreatedAt,
           CASE @GroupBy WHEN 'source'  THEN l.SourceId
                         WHEN 'owner'   THEN l.OwnerId
                         WHEN 'product' THEN l.ProductId
                         WHEN 'branch'  THEN l.BranchId
                         WHEN 'status'  THEN l.StatusId
                         WHEN 'team'    THEN ISNULL(o.ReportsTo, o.Id) END AS GroupKey,
           CASE @GroupBy WHEN 'source'  THEN ISNULL(src.Value, N'No source')
                         WHEN 'owner'   THEN ISNULL(o.FullName, N'Unassigned')
                         WHEN 'product' THEN ISNULL(p.Name, N'No product')
                         WHEN 'branch'  THEN ISNULL(b.BranchName, N'—')
                         WHEN 'status'  THEN st.Value
                         WHEN 'team'    THEN ISNULL(mgr.FullName, ISNULL(o.FullName, N'Unassigned')) END AS GroupLabel,
           c.ContactedAt, c.QualifiedAt, c.LostAt, c.JunkAt,
           d.EventAt,
           CAST(CASE WHEN @Weekly = 1 THEN DATEADD(WEEK, DATEDIFF(WEEK, 0, d.EventAt), 0) ELSE d.EventAt END AS DATE) AS Bucket
    INTO #L
    FROM dbo.tblLeads l
    JOIN dbo.tblLookup st       ON st.Id = l.StatusId AND st.CompId = @CompId
    LEFT JOIN dbo.tblLookup src ON src.Id = l.SourceId AND src.CompId = @CompId
    LEFT JOIN dbo.tblProduct p  ON p.Id = l.ProductId AND p.CompId = @CompId
    LEFT JOIN dbo.tblUser o     ON o.Id = l.OwnerId AND o.CompId = @CompId
    LEFT JOIN dbo.tblUser mgr   ON mgr.Id = o.ReportsTo AND mgr.CompId = @CompId
    LEFT JOIN dbo.tblBranch b   ON b.Id = l.BranchId
    CROSS APPLY (
        SELECT
          (SELECT MIN(x.At) FROM (
               SELECT h.ChangedAt AS At FROM dbo.tblLeadStatusHistory h
                WHERE h.CompId = @CompId AND h.LeadId = l.Id AND h.FromStatusId IS NOT NULL
               UNION ALL
               SELECT f.DoneAt FROM dbo.tblFollowUp f
                WHERE f.CompId = @CompId AND f.LeadId = l.Id AND f.Status = 'done') x) AS ContactedAt,
          (SELECT MIN(h.ChangedAt) FROM dbo.tblLeadStatusHistory h JOIN dbo.tblLookup s ON s.Id = h.ToStatusId
            WHERE h.CompId = @CompId AND h.LeadId = l.Id AND s.Code = 'qualified') AS QualifiedAt,
          (SELECT MIN(h.ChangedAt) FROM dbo.tblLeadStatusHistory h JOIN dbo.tblLookup s ON s.Id = h.ToStatusId
            WHERE h.CompId = @CompId AND h.LeadId = l.Id AND s.Code = 'lost') AS LostAt,
          (SELECT MIN(h.ChangedAt) FROM dbo.tblLeadStatusHistory h JOIN dbo.tblLookup s ON s.Id = h.ToStatusId
            WHERE h.CompId = @CompId AND h.LeadId = l.Id AND s.Code = 'junk') AS JunkAt,
          (SELECT MAX(f.DoneAt) FROM dbo.tblFollowUp f
            WHERE f.CompId = @CompId AND f.LeadId = l.Id AND f.Status = 'done') AS LastActivityAt
    ) c
    CROSS APPLY (
        SELECT CASE @DateBasis
                 WHEN 'closed'   THEN (SELECT MAX(h.ChangedAt) FROM dbo.tblLeadStatusHistory h JOIN dbo.tblLookup s ON s.Id = h.ToStatusId
                                        WHERE h.CompId = @CompId AND h.LeadId = l.Id AND s.Code IN ('qualified','lost','junk'))
                 WHEN 'activity' THEN c.LastActivityAt
                 ELSE l.CreatedAt END AS EventAt
    ) d
    WHERE l.CompId = @CompId
      AND (@BranchId  IS NULL OR l.BranchId  = @BranchId)
      AND (@OwnerId   IS NULL OR l.OwnerId   = @OwnerId)
      AND (@SourceId  IS NULL OR l.SourceId  = @SourceId)
      AND (@ProductId IS NULL OR l.ProductId = @ProductId)
      AND (@DateBasis <> 'created' OR (l.CreatedAt >= @FromDate AND l.CreatedAt < @ToEx))
      AND d.EventAt >= @FromDate AND d.EventAt < @ToEx
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))
          );

    -- RS1: KPIs
    SELECT COUNT(*) AS Created,
           ISNULL(SUM(CASE WHEN ContactedAt IS NOT NULL THEN 1 ELSE 0 END), 0) AS Contacted,
           ISNULL(SUM(CASE WHEN QualifiedAt IS NOT NULL THEN 1 ELSE 0 END), 0) AS Qualified,
           ISNULL(SUM(CASE WHEN LostAt      IS NOT NULL THEN 1 ELSE 0 END), 0) AS Lost,
           ISNULL(SUM(CASE WHEN JunkAt      IS NOT NULL THEN 1 ELSE 0 END), 0) AS Junk,
           CAST(100.0 * SUM(CASE WHEN QualifiedAt IS NOT NULL THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) AS DECIMAL(5,1)) AS QualifiedPct,
           CAST(100.0 * SUM(CASE WHEN LostAt      IS NOT NULL THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) AS DECIMAL(5,1)) AS LostPct,
           CAST(AVG(CASE WHEN ContactedAt IS NOT NULL THEN DATEDIFF(HOUR, CreatedAt, ContactedAt) / 24.0 END) AS DECIMAL(6,1)) AS AvgDaysToContact,
           CAST(AVG(CASE WHEN QualifiedAt IS NOT NULL THEN DATEDIFF(HOUR, CreatedAt, QualifiedAt) / 24.0 END) AS DECIMAL(6,1)) AS AvgDaysToQualify
    FROM #L;

    -- RS2: breakdown
    SELECT GroupKey, GroupLabel,
           COUNT(*) AS Created,
           SUM(CASE WHEN ContactedAt IS NOT NULL THEN 1 ELSE 0 END) AS Contacted,
           SUM(CASE WHEN QualifiedAt IS NOT NULL THEN 1 ELSE 0 END) AS Qualified,
           SUM(CASE WHEN LostAt      IS NOT NULL THEN 1 ELSE 0 END) AS Lost,
           SUM(CASE WHEN JunkAt      IS NOT NULL THEN 1 ELSE 0 END) AS Junk,
           CAST(100.0 * SUM(CASE WHEN QualifiedAt IS NOT NULL THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) AS DECIMAL(5,1)) AS QualifiedPct,
           CAST(100.0 * SUM(CASE WHEN LostAt      IS NOT NULL THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0) AS DECIMAL(5,1)) AS LostPct,
           CAST(AVG(CASE WHEN ContactedAt IS NOT NULL THEN DATEDIFF(HOUR, CreatedAt, ContactedAt) / 24.0 END) AS DECIMAL(6,1)) AS AvgDaysToContact,
           CAST(AVG(CASE WHEN QualifiedAt IS NOT NULL THEN DATEDIFF(HOUR, CreatedAt, QualifiedAt) / 24.0 END) AS DECIMAL(6,1)) AS AvgDaysToQualify
    FROM #L
    GROUP BY GroupKey, GroupLabel
    ORDER BY Created DESC, GroupLabel;

    -- RS3: trend
    SELECT Bucket,
           COUNT(*) AS Created,
           SUM(CASE WHEN QualifiedAt IS NOT NULL THEN 1 ELSE 0 END) AS Qualified,
           SUM(CASE WHEN LostAt      IS NOT NULL THEN 1 ELSE 0 END) AS Lost
    FROM #L
    GROUP BY Bucket
    ORDER BY Bucket;
END

GO

CREATE OR ALTER PROC dbo.sp_RptLost
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
    IF ISNULL(@GroupBy, '') NOT IN ('reason','source','product','owner','branch')
    BEGIN RAISERROR('sp_RptLost: unknown GroupBy', 16, 1); RETURN; END
    IF ISNULL(@DateBasis, '') NOT IN ('created','closed','activity') SET @DateBasis = 'created';

    DECLARE @BranchIds TABLE (BranchId INT PRIMARY KEY);
    DECLARE @OwnerIds  TABLE (OwnerId  INT PRIMARY KEY);
    DECLARE @UseBranchScope BIT = 0, @UseOwnerScope BIT = 0;
    IF (@AccessibleBranchIdsJson IS NOT NULL AND LTRIM(RTRIM(@AccessibleBranchIdsJson)) <> '')
    BEGIN
        INSERT INTO @BranchIds (BranchId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@AccessibleBranchIdsJson);
        SET @UseBranchScope = 1;
    END
    IF (@OwnerIdsJson IS NOT NULL AND LTRIM(RTRIM(@OwnerIdsJson)) <> '')
    BEGIN
        INSERT INTO @OwnerIds (OwnerId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@OwnerIdsJson);
        SET @UseOwnerScope = 1;
    END
    DECLARE @ToEx   DATETIME = DATEADD(DAY, 1, CAST(@ToDate AS DATETIME));
    DECLARE @Weekly BIT      = CASE WHEN DATEDIFF(DAY, @FromDate, @ToDate) > 31 THEN 1 ELSE 0 END;

    -- Every scoped lead dated on the basis; IsLost marks the subset. LostPct
    -- is lost / all, so the denominator has to be here too.
    SELECT l.Id,
           CASE WHEN st.Code = 'lost' THEN 1 ELSE 0 END AS IsLost,
           l.LostReasonId,
           ISNULL(lr.Value, N'No reason') AS ReasonLabel,
           CASE @GroupBy WHEN 'source'  THEN l.SourceId
                         WHEN 'product' THEN l.ProductId
                         WHEN 'owner'   THEN l.OwnerId
                         WHEN 'branch'  THEN l.BranchId END AS SubKey,
           CASE @GroupBy WHEN 'source'  THEN ISNULL(src.Value, N'No source')
                         WHEN 'product' THEN ISNULL(p.Name, N'No product')
                         WHEN 'owner'   THEN ISNULL(o.FullName, N'Unassigned')
                         WHEN 'branch'  THEN ISNULL(b.BranchName, N'—') END AS SubLabel,
           CAST(CASE WHEN @Weekly = 1 THEN DATEADD(WEEK, DATEDIFF(WEEK, 0, d.EventAt), 0) ELSE d.EventAt END AS DATE) AS Bucket
    INTO #L
    FROM dbo.tblLeads l
    JOIN dbo.tblLookup st       ON st.Id = l.StatusId AND st.CompId = @CompId
    LEFT JOIN dbo.tblLookup lr  ON lr.Id = l.LostReasonId AND lr.CompId = @CompId
    LEFT JOIN dbo.tblLookup src ON src.Id = l.SourceId AND src.CompId = @CompId
    LEFT JOIN dbo.tblProduct p  ON p.Id = l.ProductId AND p.CompId = @CompId
    LEFT JOIN dbo.tblUser o     ON o.Id = l.OwnerId AND o.CompId = @CompId
    LEFT JOIN dbo.tblBranch b   ON b.Id = l.BranchId
    CROSS APPLY (
        SELECT CASE @DateBasis
                 WHEN 'closed'   THEN (SELECT MAX(h.ChangedAt) FROM dbo.tblLeadStatusHistory h JOIN dbo.tblLookup s ON s.Id = h.ToStatusId
                                        WHERE h.CompId = @CompId AND h.LeadId = l.Id AND s.Code IN ('qualified','lost','junk'))
                 WHEN 'activity' THEN (SELECT MAX(f.DoneAt) FROM dbo.tblFollowUp f
                                        WHERE f.CompId = @CompId AND f.LeadId = l.Id AND f.Status = 'done')
                 ELSE l.CreatedAt END AS EventAt
    ) d
    WHERE l.CompId = @CompId
      AND (@BranchId  IS NULL OR l.BranchId  = @BranchId)
      AND (@OwnerId   IS NULL OR l.OwnerId   = @OwnerId)
      AND (@SourceId  IS NULL OR l.SourceId  = @SourceId)
      AND (@ProductId IS NULL OR l.ProductId = @ProductId)
      AND (@DateBasis <> 'created' OR (l.CreatedAt >= @FromDate AND l.CreatedAt < @ToEx))
      AND d.EventAt >= @FromDate AND d.EventAt < @ToEx
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))
          );

    DECLARE @Lost INT = (SELECT COUNT(*) FROM #L WHERE IsLost = 1);

    -- RS1
    SELECT @Lost AS Lost,
           CAST(100.0 * @Lost / NULLIF((SELECT COUNT(*) FROM #L), 0) AS DECIMAL(5,1)) AS LostPct,
           (SELECT TOP 1 ReasonLabel FROM #L WHERE IsLost = 1 GROUP BY ReasonLabel ORDER BY COUNT(*) DESC, ReasonLabel) AS TopReason;

    -- RS2: reason rows; a second key when grouped by source/product/owner/branch
    SELECT LostReasonId AS GroupKey, ReasonLabel AS GroupLabel,
           CASE WHEN @GroupBy = 'reason' THEN NULL ELSE SubKey END AS SubKey,
           CASE WHEN @GroupBy = 'reason' THEN NULL ELSE SubLabel END AS SubLabel,
           COUNT(*) AS Lost,
           CAST(100.0 * COUNT(*) / NULLIF(@Lost, 0) AS DECIMAL(5,1)) AS LostPct
    FROM #L
    WHERE IsLost = 1
    GROUP BY LostReasonId, ReasonLabel,
             CASE WHEN @GroupBy = 'reason' THEN NULL ELSE SubKey END,
             CASE WHEN @GroupBy = 'reason' THEN NULL ELSE SubLabel END
    ORDER BY Lost DESC, GroupLabel, SubLabel;

    -- RS3
    SELECT Bucket, COUNT(*) AS Lost
    FROM #L
    WHERE IsLost = 1
    GROUP BY Bucket
    ORDER BY Bucket;
END

GO

CREATE OR ALTER PROC dbo.sp_RptPipelineValue
    @CompId                  INT,
    @FromDate                DATE,
    @ToDate                  DATE,
    @DateBasis               VARCHAR(10)   = 'created',
    @BranchId                INT           = NULL,
    @OwnerId                 INT           = NULL,
    @SourceId                INT           = NULL,
    @ProductId               INT           = NULL,
    @GroupBy                 VARCHAR(20)   = 'status',
    @UserId                  INT           = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF ISNULL(@GroupBy, '') NOT IN ('status','owner','product','branch')
    BEGIN RAISERROR('sp_RptPipelineValue: unknown GroupBy', 16, 1); RETURN; END
    IF ISNULL(@DateBasis, '') NOT IN ('created','closed','activity') SET @DateBasis = 'created';

    DECLARE @BranchIds TABLE (BranchId INT PRIMARY KEY);
    DECLARE @OwnerIds  TABLE (OwnerId  INT PRIMARY KEY);
    DECLARE @UseBranchScope BIT = 0, @UseOwnerScope BIT = 0;
    IF (@AccessibleBranchIdsJson IS NOT NULL AND LTRIM(RTRIM(@AccessibleBranchIdsJson)) <> '')
    BEGIN
        INSERT INTO @BranchIds (BranchId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@AccessibleBranchIdsJson);
        SET @UseBranchScope = 1;
    END
    IF (@OwnerIdsJson IS NOT NULL AND LTRIM(RTRIM(@OwnerIdsJson)) <> '')
    BEGIN
        INSERT INTO @OwnerIds (OwnerId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@OwnerIdsJson);
        SET @UseOwnerScope = 1;
    END
    DECLARE @ToEx   DATETIME = DATEADD(DAY, 1, CAST(@ToDate AS DATETIME));
    DECLARE @Weekly BIT      = CASE WHEN DATEDIFF(DAY, @FromDate, @ToDate) > 31 THEN 1 ELSE 0 END;

    SELECT l.Id, l.EstValue, st.Code AS StatusCode,
           CASE @GroupBy WHEN 'status'  THEN l.StatusId
                         WHEN 'owner'   THEN l.OwnerId
                         WHEN 'product' THEN l.ProductId
                         WHEN 'branch'  THEN l.BranchId END AS GroupKey,
           CASE @GroupBy WHEN 'status'  THEN st.Value
                         WHEN 'owner'   THEN ISNULL(o.FullName, N'Unassigned')
                         WHEN 'product' THEN ISNULL(p.Name, N'No product')
                         WHEN 'branch'  THEN ISNULL(b.BranchName, N'—') END AS GroupLabel,
           CAST(CASE WHEN @Weekly = 1 THEN DATEADD(WEEK, DATEDIFF(WEEK, 0, d.EventAt), 0) ELSE d.EventAt END AS DATE) AS Bucket
    INTO #L
    FROM dbo.tblLeads l
    JOIN dbo.tblLookup st      ON st.Id = l.StatusId AND st.CompId = @CompId
    LEFT JOIN dbo.tblProduct p ON p.Id = l.ProductId AND p.CompId = @CompId
    LEFT JOIN dbo.tblUser o    ON o.Id = l.OwnerId AND o.CompId = @CompId
    LEFT JOIN dbo.tblBranch b  ON b.Id = l.BranchId
    CROSS APPLY (
        SELECT CASE @DateBasis
                 WHEN 'closed'   THEN (SELECT MAX(h.ChangedAt) FROM dbo.tblLeadStatusHistory h JOIN dbo.tblLookup s ON s.Id = h.ToStatusId
                                        WHERE h.CompId = @CompId AND h.LeadId = l.Id AND s.Code IN ('qualified','lost','junk'))
                 WHEN 'activity' THEN (SELECT MAX(f.DoneAt) FROM dbo.tblFollowUp f
                                        WHERE f.CompId = @CompId AND f.LeadId = l.Id AND f.Status = 'done')
                 ELSE l.CreatedAt END AS EventAt
    ) d
    WHERE l.CompId = @CompId
      AND (@BranchId  IS NULL OR l.BranchId  = @BranchId)
      AND (@OwnerId   IS NULL OR l.OwnerId   = @OwnerId)
      AND (@SourceId  IS NULL OR l.SourceId  = @SourceId)
      AND (@ProductId IS NULL OR l.ProductId = @ProductId)
      AND (@DateBasis <> 'created' OR (l.CreatedAt >= @FromDate AND l.CreatedAt < @ToEx))
      AND d.EventAt >= @FromDate AND d.EventAt < @ToEx
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))
          );

    -- RS1
    SELECT ISNULL(SUM(CASE WHEN StatusCode = 'open'      THEN ISNULL(EstValue, 0) END), 0) AS OpenValue,
           ISNULL(SUM(CASE WHEN StatusCode = 'qualified' THEN ISNULL(EstValue, 0) END), 0) AS QualifiedValue,
           ISNULL(SUM(CASE WHEN StatusCode = 'lost'      THEN ISNULL(EstValue, 0) END), 0) AS LostValue,
           ISNULL(SUM(CASE WHEN StatusCode IN ('open','qualified') THEN 1 ELSE 0 END), 0) AS OpenCount,
           CAST(AVG(CASE WHEN StatusCode IN ('open','qualified') THEN EstValue END) AS DECIMAL(18,2)) AS AvgValue
    FROM #L;

    -- RS2
    SELECT GroupKey, GroupLabel, COUNT(*) AS [Count], SUM(ISNULL(EstValue, 0)) AS Value
    FROM #L
    GROUP BY GroupKey, GroupLabel
    ORDER BY Value DESC, GroupLabel;

    -- RS3: value still in play, by the bucket the lead was dated into
    SELECT Bucket, ISNULL(SUM(CASE WHEN StatusCode IN ('open','qualified') THEN ISNULL(EstValue, 0) END), 0) AS OpenValue
    FROM #L
    GROUP BY Bucket
    ORDER BY Bucket;
END

GO

CREATE OR ALTER PROC dbo.sp_RptAging
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
    IF ISNULL(@GroupBy, '') NOT IN ('owner','branch','team')
    BEGIN RAISERROR('sp_RptAging: unknown GroupBy', 16, 1); RETURN; END
    -- Aging is a snapshot: RS1/RS2 describe what is open right now. The date
    -- range (and @DateBasis) only shape RS3, the "open as of" trend.

    DECLARE @BranchIds TABLE (BranchId INT PRIMARY KEY);
    DECLARE @OwnerIds  TABLE (OwnerId  INT PRIMARY KEY);
    DECLARE @UseBranchScope BIT = 0, @UseOwnerScope BIT = 0;
    IF (@AccessibleBranchIdsJson IS NOT NULL AND LTRIM(RTRIM(@AccessibleBranchIdsJson)) <> '')
    BEGIN
        INSERT INTO @BranchIds (BranchId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@AccessibleBranchIdsJson);
        SET @UseBranchScope = 1;
    END
    IF (@OwnerIdsJson IS NOT NULL AND LTRIM(RTRIM(@OwnerIdsJson)) <> '')
    BEGIN
        INSERT INTO @OwnerIds (OwnerId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@OwnerIdsJson);
        SET @UseOwnerScope = 1;
    END
    DECLARE @Now    DATETIME = GETDATE();
    DECLARE @Weekly BIT      = CASE WHEN DATEDIFF(DAY, @FromDate, @ToDate) > 31 THEN 1 ELSE 0 END;
    DECLARE @Step   INT      = CASE WHEN @Weekly = 1 THEN 7 ELSE 1 END;

    -- Every scoped lead (any status) with its close date; RS1/RS2 filter to
    -- the ones still active, RS3 replays the count over time.
    SELECT l.Id, l.CreatedAt, l.NextFollowupDate,
           CASE WHEN st.Code IN ('open','qualified') THEN 1 ELSE 0 END AS IsActive,
           CASE WHEN st.Code IN ('open','qualified') THEN NULL ELSE
             (SELECT MAX(h.ChangedAt) FROM dbo.tblLeadStatusHistory h JOIN dbo.tblLookup s ON s.Id = h.ToStatusId
               WHERE h.CompId = @CompId AND h.LeadId = l.Id AND s.Code IN ('lost','junk')) END AS ClosedAt,
           (SELECT MAX(v) FROM (VALUES (l.CreatedAt), (t.FuTouch), (t.ActTouch)) x(v)) AS LastTouchAt,
           CASE @GroupBy WHEN 'owner'  THEN l.OwnerId
                         WHEN 'team'   THEN ISNULL(o.ReportsTo, o.Id)
                         WHEN 'branch' THEN l.BranchId END AS GroupKey,
           CASE @GroupBy WHEN 'owner'  THEN ISNULL(o.FullName, N'Unassigned')
                         WHEN 'team'   THEN ISNULL(mgr.FullName, ISNULL(o.FullName, N'Unassigned'))
                         WHEN 'branch' THEN ISNULL(b.BranchName, N'—') END AS GroupLabel
    INTO #L
    FROM dbo.tblLeads l
    JOIN dbo.tblLookup st     ON st.Id = l.StatusId AND st.CompId = @CompId
    LEFT JOIN dbo.tblUser o   ON o.Id = l.OwnerId AND o.CompId = @CompId
    LEFT JOIN dbo.tblUser mgr ON mgr.Id = o.ReportsTo AND mgr.CompId = @CompId
    LEFT JOIN dbo.tblBranch b ON b.Id = l.BranchId
    CROSS APPLY (
        SELECT (SELECT MAX(COALESCE(f.DoneAt, f.CreatedAt)) FROM dbo.tblFollowUp f
                 WHERE f.CompId = @CompId AND f.LeadId = l.Id) AS FuTouch,
               (SELECT MAX(a.CreatedAt) FROM dbo.tblLeadActivity a
                 WHERE a.CompId = @CompId AND a.LeadId = l.Id) AS ActTouch
    ) t
    WHERE l.CompId = @CompId
      AND (@BranchId  IS NULL OR l.BranchId  = @BranchId)
      AND (@OwnerId   IS NULL OR l.OwnerId   = @OwnerId)
      AND (@SourceId  IS NULL OR l.SourceId  = @SourceId)
      AND (@ProductId IS NULL OR l.ProductId = @ProductId)
      AND (
            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))
          );

    -- RS1: snapshot
    SELECT COUNT(*) AS [Open],
           ISNULL(SUM(CASE WHEN DATEDIFF(DAY, CreatedAt, @Now) <= 7  THEN 1 ELSE 0 END), 0) AS Age0_7,
           ISNULL(SUM(CASE WHEN DATEDIFF(DAY, CreatedAt, @Now) BETWEEN 8  AND 30 THEN 1 ELSE 0 END), 0) AS Age8_30,
           ISNULL(SUM(CASE WHEN DATEDIFF(DAY, CreatedAt, @Now) BETWEEN 31 AND 90 THEN 1 ELSE 0 END), 0) AS Age31_90,
           ISNULL(SUM(CASE WHEN DATEDIFF(DAY, CreatedAt, @Now) > 90 THEN 1 ELSE 0 END), 0) AS Age90Plus,
           ISNULL(SUM(CASE WHEN NextFollowupDate IS NULL THEN 1 ELSE 0 END), 0) AS NoNextFollowUp,
           CAST(AVG(DATEDIFF(HOUR, LastTouchAt, @Now) / 24.0) AS DECIMAL(6,1)) AS AvgDaysSinceTouch
    FROM #L WHERE IsActive = 1;

    -- RS2
    SELECT GroupKey, GroupLabel,
           COUNT(*) AS [Open],
           SUM(CASE WHEN DATEDIFF(DAY, CreatedAt, @Now) <= 7  THEN 1 ELSE 0 END) AS Age0_7,
           SUM(CASE WHEN DATEDIFF(DAY, CreatedAt, @Now) BETWEEN 8  AND 30 THEN 1 ELSE 0 END) AS Age8_30,
           SUM(CASE WHEN DATEDIFF(DAY, CreatedAt, @Now) BETWEEN 31 AND 90 THEN 1 ELSE 0 END) AS Age31_90,
           SUM(CASE WHEN DATEDIFF(DAY, CreatedAt, @Now) > 90 THEN 1 ELSE 0 END) AS Age90Plus,
           SUM(CASE WHEN NextFollowupDate IS NULL THEN 1 ELSE 0 END) AS NoNextFollowUp,
           CAST(AVG(DATEDIFF(HOUR, LastTouchAt, @Now) / 24.0) AS DECIMAL(6,1)) AS AvgDaysSinceTouch
    FROM #L WHERE IsActive = 1
    GROUP BY GroupKey, GroupLabel
    ORDER BY [Open] DESC, GroupLabel;

    -- RS3: active leads as of each bucket end (created before it, not closed before it)
    ;WITH buckets AS (
        SELECT CAST(CASE WHEN @Weekly = 1 THEN DATEADD(WEEK, DATEDIFF(WEEK, 0, @FromDate), 0) ELSE @FromDate END AS DATE) AS Bucket
        UNION ALL
        SELECT CAST(DATEADD(DAY, @Step, Bucket) AS DATE) FROM buckets WHERE DATEADD(DAY, @Step, Bucket) <= @ToDate
    )
    SELECT b.Bucket,
           (SELECT COUNT(*) FROM #L x
             WHERE x.CreatedAt < DATEADD(DAY, @Step, CAST(b.Bucket AS DATETIME))
               AND (x.ClosedAt IS NULL OR x.ClosedAt >= DATEADD(DAY, @Step, CAST(b.Bucket AS DATETIME)))) AS [Open]
    FROM buckets b
    ORDER BY b.Bucket
    OPTION (MAXRECURSION 1000);
END

GO

-- ===========================================================================
-- VERIFY AFTER APPLY -- read-only. Nothing below writes.
--
-- This is a no-op hardening pass. EVERY number below must come back exactly
-- as stated. If one moves, behaviour changed: do not deploy, report it.
--
-- Seeded demo callers (076):
--   sh_priya    Id 13  Company scope  branchIds [1,2,3,4,5]  no ownerIds
--   se_ho_amit  Id 17  Self scope     branchIds [1]          ownerIds [17]
-- Window: 2026-03-17 .. 2026-09-13, @DateBasis 'created', default @GroupBy.
-- ===========================================================================

-- 1. The three edits actually landed, and nothing else did. Expect 4 rows,
--    HasCompIdOnLabelJoins = 1 and HasTrimmedScopeGuards = 1 on all four,
--    HasIsNullDateBasis = 1 on the first three and 0 on sp_RptAging (which
--    has no @DateBasis guard by design -- see the M3 note above).
SELECT p.name,
       CASE WHEN CHARINDEX('st.CompId = @CompId', d.def) > 0 THEN 1 ELSE 0 END AS HasCompIdOnLabelJoins,
       CASE WHEN CHARINDEX('NOT NULL AND @', d.def) = 0    THEN 1 ELSE 0 END AS HasTrimmedScopeGuards,
       CASE WHEN CHARINDEX('ISNULL(@DateBasis', d.def) > 0 THEN 1 ELSE 0 END AS HasIsNullDateBasis,
       CASE WHEN CHARINDEX('b.CompId', d.def) = 0          THEN 1 ELSE 0 END AS BranchJoinUntouched
FROM (VALUES('sp_RptFunnel'),('sp_RptLost'),('sp_RptPipelineValue'),('sp_RptAging')) p(name)
CROSS APPLY (SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.'+p.name)) AS def) d;

-- 2. The premise behind M1. Expect 0 on every row -- these are the foreign
--    keys the label joins follow. A non-zero here means a cross-tenant label
--    exists and the M1 guards are now doing real work: investigate the data.
SELECT 'lead.StatusId->tblLookup' AS Ref, COUNT(*) AS CrossTenantRows
  FROM dbo.tblLeads l JOIN dbo.tblLookup x ON x.Id = l.StatusId AND x.CompId <> l.CompId
UNION ALL SELECT 'lead.SourceId->tblLookup', COUNT(*)
  FROM dbo.tblLeads l JOIN dbo.tblLookup x ON x.Id = l.SourceId AND x.CompId <> l.CompId
UNION ALL SELECT 'lead.LostReasonId->tblLookup', COUNT(*)
  FROM dbo.tblLeads l JOIN dbo.tblLookup x ON x.Id = l.LostReasonId AND x.CompId <> l.CompId
UNION ALL SELECT 'lead.ProductId->tblProduct', COUNT(*)
  FROM dbo.tblLeads l JOIN dbo.tblProduct x ON x.Id = l.ProductId AND x.CompId <> l.CompId
UNION ALL SELECT 'lead.OwnerId->tblUser', COUNT(*)
  FROM dbo.tblLeads l JOIN dbo.tblUser x ON x.Id = l.OwnerId AND x.CompId <> l.CompId
UNION ALL SELECT 'user.ReportsTo->tblUser', COUNT(*)
  FROM dbo.tblUser u JOIN dbo.tblUser m ON m.Id = u.ReportsTo AND m.CompId <> u.CompId;

-- ---------------------------------------------------------------------------
-- 3. sp_RptFunnel
-- ---------------------------------------------------------------------------
-- Company caller. RS1 Created = 618. RS2 = 6 rows. RS3 = weekly buckets.
EXEC dbo.sp_RptFunnel @CompId=1, @FromDate='2026-03-17', @ToDate='2026-09-13',
     @DateBasis='created', @GroupBy='source', @UserId=13,
     @AccessibleBranchIdsJson='[1,2,3,4,5]', @OwnerIdsJson=NULL;

-- Self caller. RS1 Created = 125. RS2 = 6 rows.
EXEC dbo.sp_RptFunnel @CompId=1, @FromDate='2026-03-17', @ToDate='2026-09-13',
     @DateBasis='created', @GroupBy='source', @UserId=17,
     @AccessibleBranchIdsJson='[1]', @OwnerIdsJson='[17]';

-- ---------------------------------------------------------------------------
-- 4. sp_RptLost
-- ---------------------------------------------------------------------------
-- Company caller. RS1 Lost = 108, LostPct = 17.5 (108/618). RS2 = 5 rows.
EXEC dbo.sp_RptLost @CompId=1, @FromDate='2026-03-17', @ToDate='2026-09-13',
     @DateBasis='created', @GroupBy='reason', @UserId=13,
     @AccessibleBranchIdsJson='[1,2,3,4,5]', @OwnerIdsJson=NULL;

-- Self caller. RS1 Lost = 20, LostPct = 16.0 (20/125). RS2 = 5 rows.
EXEC dbo.sp_RptLost @CompId=1, @FromDate='2026-03-17', @ToDate='2026-09-13',
     @DateBasis='created', @GroupBy='reason', @UserId=17,
     @AccessibleBranchIdsJson='[1]', @OwnerIdsJson='[17]';

-- ---------------------------------------------------------------------------
-- 5. sp_RptPipelineValue
-- ---------------------------------------------------------------------------
-- Company caller. RS1 OpenCount = 467, OpenValue + QualifiedValue = 63,062,064.
--                 RS2 = 6 rows (one per status).
EXEC dbo.sp_RptPipelineValue @CompId=1, @FromDate='2026-03-17', @ToDate='2026-09-13',
     @DateBasis='created', @GroupBy='status', @UserId=13,
     @AccessibleBranchIdsJson='[1,2,3,4,5]', @OwnerIdsJson=NULL;

-- Self caller. RS1 OpenCount = 95, OpenValue + QualifiedValue = 13,516,780.
--              RS2 = 6 rows.
EXEC dbo.sp_RptPipelineValue @CompId=1, @FromDate='2026-03-17', @ToDate='2026-09-13',
     @DateBasis='created', @GroupBy='status', @UserId=17,
     @AccessibleBranchIdsJson='[1]', @OwnerIdsJson='[17]';

-- ---------------------------------------------------------------------------
-- 6. sp_RptAging  (snapshot: RS1/RS2 ignore the date range, RS3 uses it)
-- ---------------------------------------------------------------------------
-- Company caller. Cohort 619 leads, RS1 [Open] = 468. RS2 = 13 rows.
EXEC dbo.sp_RptAging @CompId=1, @FromDate='2026-03-17', @ToDate='2026-09-13',
     @DateBasis='created', @GroupBy='owner', @UserId=13,
     @AccessibleBranchIdsJson='[1,2,3,4,5]', @OwnerIdsJson=NULL;

-- Self caller. Cohort 125 leads, RS1 [Open] = 95. RS2 = 6 rows.
EXEC dbo.sp_RptAging @CompId=1, @FromDate='2026-03-17', @ToDate='2026-09-13',
     @DateBasis='created', @GroupBy='owner', @UserId=17,
     @AccessibleBranchIdsJson='[1]', @OwnerIdsJson='[17]';

-- ---------------------------------------------------------------------------
-- 7. The L1 guard now bites. Before this script a whitespace-only scope JSON
--    silently returned the WHOLE COMPANY; after it, it is treated as "no
--    branch scope supplied" exactly like NULL, and Amit falls back to the
--    @UserId escape hatch (his own + created-by rows) instead of all 618.
--    Expect RS1 Created STRICTLY LESS THAN 618 -- and equal to what the same
--    call returns with @AccessibleBranchIdsJson=NULL.
EXEC dbo.sp_RptFunnel @CompId=1, @FromDate='2026-03-17', @ToDate='2026-09-13',
     @DateBasis='created', @GroupBy='source', @UserId=17,
     @AccessibleBranchIdsJson='   ', @OwnerIdsJson='[17]';

-- 8. The M3 guard now bites: @DateBasis=NULL must behave exactly like
--    'created'. Expect RS1 Created = 618, identical to step 3's first call.
EXEC dbo.sp_RptFunnel @CompId=1, @FromDate='2026-03-17', @ToDate='2026-09-13',
     @DateBasis=NULL, @GroupBy='source', @UserId=13,
     @AccessibleBranchIdsJson='[1,2,3,4,5]', @OwnerIdsJson=NULL;
