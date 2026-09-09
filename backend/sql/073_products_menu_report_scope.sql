-- ============================================================================
-- 073_products_menu_report_scope.sql
--
-- (a) Sidebar row for Settings > Products. The sidebar is DB-driven (tblMenu);
--     without a row the page is reachable only by typing the URL. The row is
--     cloned from the Lookups row (same parent, same MenuType/OpenStyle/…), and
--     every group that can see Lookups gets the identical grant on Products —
--     both are company-config screens with the same audience.
--     Menu rights load at LOGIN — users must re-login to see the new item.
--
-- (b) Report scope. sp_CallsPerUser and sp_ConversionBySource had no scope
--     parameter, so a Branch/Team/Self user saw company-wide report rows.
--     Both now take @AccessibleBranchIdsJson and apply it exactly the way
--     sp_LeadsByStatus does (OPENJSON -> @BranchIds -> @UseScope predicate).
--     Existing params and the optional @BranchId narrowing are unchanged;
--     the param defaults to NULL, so an un-upgraded caller behaves as before.
--
-- APPLY BY HAND. Idempotent (re-runnable). Author: Claude  Date: 2026-09-09
-- ============================================================================

-- ---------------------------------------------------------------------------
-- (a) Menu row + group grants for Settings > Products
-- ---------------------------------------------------------------------------
-- Clone the Lookups row so every NOT NULL / defaulted column comes from live
-- data rather than a guess; Id is IDENTITY, so it is not listed.
IF NOT EXISTS (SELECT 1 FROM dbo.tblMenu WHERE Route = '/settings/products')
    INSERT INTO dbo.tblMenu (ParentId, Description, Image, FormId, MenuType,
                             ActualId, IsAllowed, FormName, FormClass, OpenStyle, Route)
    SELECT m.ParentId, 'Products', m.Image, m.FormId, m.MenuType,
           m.ActualId, m.IsAllowed, m.FormName, m.FormClass, m.OpenStyle, '/settings/products'
    FROM dbo.tblMenu m
    WHERE m.Route = '/settings/lookups';
GO

-- Same audience as Lookups: one grant row per group that already has one.
INSERT INTO dbo.tblGroupAccess (GroupId, MenuId, CanView, CanAdd, CanEdit, CanDelete)
SELECT src.GroupId, prod.Id, src.CanView, src.CanAdd, src.CanEdit, src.CanDelete
FROM dbo.tblGroupAccess src
JOIN dbo.tblMenu look ON look.Id = src.MenuId AND look.Route = '/settings/lookups'
CROSS JOIN (SELECT Id FROM dbo.tblMenu WHERE Route = '/settings/products') prod
WHERE NOT EXISTS (SELECT 1 FROM dbo.tblGroupAccess ga
                  WHERE ga.GroupId = src.GroupId AND ga.MenuId = prod.Id);
GO

-- ---------------------------------------------------------------------------
-- (b) Report scope — sp_CallsPerUser
-- Lead calls are done follow-ups of Type='call'; ticket calls still live in
-- tblCall. Both count. Scope predicate mirrors sp_LeadsByStatus.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_CallsPerUser
    @CompId                  INT,
    @BranchId                INT           = NULL,
    @FromDate                DATETIME      = NULL,
    @ToDate                  DATETIME      = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @BranchIds TABLE (BranchId INT PRIMARY KEY);
    DECLARE @UseScope BIT = 0;
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
    BEGIN
        INSERT INTO @BranchIds SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@AccessibleBranchIdsJson);
        SET @UseScope = 1;
    END

    ;WITH calls AS (
        SELECT f.DoneBy AS UserId, f.DoneAt AS CalledAt, l.BranchId
        FROM dbo.tblFollowUp f
        JOIN dbo.tblLeads l ON l.Id = f.LeadId AND l.CompId = f.CompId
        WHERE f.CompId = @CompId AND f.Type = 'call' AND f.Status = 'done' AND f.DoneBy IS NOT NULL
        UNION ALL
        SELECT c.UserId, c.CalledAt, t.BranchId
        FROM dbo.tblCall c
        JOIN dbo.tblTicket t ON t.Id = c.TicketId AND t.CompId = c.CompId
        WHERE c.CompId = @CompId AND c.TicketId IS NOT NULL
    )
    SELECT c.UserId, u.FullName, COUNT(*) AS CallCount,
           200 AS ResponseCode, 'Calls per user retrieved successfully' AS ResponseMess
    FROM calls c
    LEFT JOIN dbo.tblUser u ON u.Id = c.UserId
    WHERE (@FromDate IS NULL OR c.CalledAt >= @FromDate)
      AND (@ToDate   IS NULL OR c.CalledAt <  DATEADD(DAY, 1, @ToDate))
      AND (@BranchId IS NULL OR c.BranchId = @BranchId)
      AND (@UseScope = 0 OR c.BranchId IN (SELECT BranchId FROM @BranchIds))
    GROUP BY c.UserId, u.FullName
    ORDER BY CallCount DESC;
END
GO

-- ---------------------------------------------------------------------------
-- (b) Report scope — sp_ConversionBySource
-- WonCount stays in the contract (0 until spec 3 sets WonAt on conversion);
-- QualifiedCount is the interim conversion measure the page shows. The scope
-- predicate sits in the LEFT JOIN's ON, next to @BranchId, so sources with no
-- visible leads still return a zero row (same shape as sp_LeadsByStatus).
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_ConversionBySource
    @CompId                  INT,
    @BranchId                INT           = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @BranchIds TABLE (BranchId INT PRIMARY KEY);
    DECLARE @UseScope BIT = 0;
    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
    BEGIN
        INSERT INTO @BranchIds SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@AccessibleBranchIdsJson);
        SET @UseScope = 1;
    END

    SELECT lk.Id AS SourceId, lk.Value AS SourceName,
           COUNT(l.Id) AS TotalLeads,
           SUM(CASE WHEN st.Code IN ('qualified','converted') THEN 1 ELSE 0 END) AS QualifiedCount,
           SUM(CASE WHEN l.WonAt IS NOT NULL THEN 1 ELSE 0 END) AS WonCount,
           SUM(CASE WHEN st.Code = 'lost' THEN 1 ELSE 0 END) AS LostCount,
           200 AS ResponseCode, 'Conversion by source retrieved successfully' AS ResponseMess
    FROM dbo.tblLookup lk
    LEFT JOIN dbo.tblLeads l
           ON l.SourceId = lk.Id AND l.CompId = @CompId
          AND (@BranchId IS NULL OR l.BranchId = @BranchId)
          AND (@UseScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
    LEFT JOIN dbo.tblLookup st ON st.Id = l.StatusId
    WHERE lk.CompId = @CompId AND lk.Kind = 'lead_source' AND lk.IsActive = 1
    GROUP BY lk.Id, lk.Value
    ORDER BY TotalLeads DESC;
END
GO

-- ---------------------------------------------------------------------------
-- Verify after apply
-- ---------------------------------------------------------------------------
-- 1 row: Products, ParentId = the Settings row, Route = '/settings/products'
SELECT Id, ParentId, Description, Route FROM dbo.tblMenu WHERE Route = '/settings/products';

-- Grants match Lookups one-for-one (expect: same GroupId set, same flags)
SELECT m.Route, ga.GroupId, ga.CanView, ga.CanAdd, ga.CanEdit, ga.CanDelete
FROM dbo.tblGroupAccess ga
JOIN dbo.tblMenu m ON m.Id = ga.MenuId
WHERE m.Route IN ('/settings/lookups', '/settings/products')
ORDER BY ga.GroupId, m.Route;

-- Both SPs now expose @AccessibleBranchIdsJson (expect 2 rows)
SELECT o.name AS ProcName, p.name AS ParamName, TYPE_NAME(p.user_type_id) AS ParamType
FROM sys.parameters p
JOIN sys.objects o ON o.object_id = p.object_id
WHERE o.name IN ('sp_CallsPerUser', 'sp_ConversionBySource')
  AND p.name = '@AccessibleBranchIdsJson';
GO
