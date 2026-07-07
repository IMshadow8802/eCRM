-- 039_fix_sp_dashboard.sql
-- Fix sp_Dashboard: it referenced legacy tblLeads columns (LeadDate,
-- FollowupDate, LeadStatus) that no longer exist on the config-engine lead
-- schema, so the Dashboard page 500'd on every load. Remap to the current
-- columns, same output contract (rows of Type / Number).
--
--   old column      -> new column / rule
--   LeadDate        -> CreatedAt
--   FollowupDate    -> NextFollowupDate
--   LeadStatus <> 'Converted'          -> WonAt IS NULL          (not yet won)
--   LeadStatus NOT IN ('Converted',      -> WonAt IS NULL AND LostAt IS NULL
--                       'Closed')            (still open)
--
-- APPLY BY HAND against the CRM DB (select eCRM+ in SSMS). Idempotent
-- (CREATE OR ALTER). Verify snippet at the bottom.

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
END
GO

-- VERIFY: EXEC sp_Dashboard @CompId = 1, @AccessibleBranchIdsJson = NULL;
-- Expect 4 rows: TotalLeads / TodayNewLeads / TodayFollowups / MissedFollowups.
