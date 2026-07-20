-- ============================================================================
-- 052_security_hardening.sql
--
-- Deactivated users must lose API access immediately, not when their JWT
-- expires. loadScope already round-trips sp_FetchAccessibleBranchIds on every
-- request, so the cheapest enforcement point is that SP's header row: add
-- IsActive (from tblUser) to result set 1. The middleware then rejects
-- requests with IsActive = 0 (403 USER_INACTIVE).
--
-- Everything else the SP does is preserved verbatim:
--   Result 1: HierarchyLevel, DataScope, PrimaryBranchId, IsAdmin  (+ IsActive)
--   Result 2: BranchId, CanWrite
--   Result 3: OwnerId (rows only for Self/Team scope)
--
-- Fail-closed: if the user row is missing for this CompId, IsActive = 0.
-- The Node side treats an ABSENT IsActive column as active, so deploying the
-- backend before applying this script cannot lock anyone out.
-- ============================================================================

ALTER PROC dbo.sp_FetchAccessibleBranchIds
    @UserId INT,
    @CompId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @HierarchyLevel TINYINT;
    DECLARE @DataScope      VARCHAR(20);
    DECLARE @PrimaryBranchId BIGINT;
    DECLARE @IsAdmin        BIT;
    DECLARE @IsActive       BIT;

    -- A user in several groups gets their strongest: lowest HierarchyLevel wins.
    SELECT TOP 1
        @HierarchyLevel  = ug.HierarchyLevel,
        @DataScope       = ug.DataScope,
        @IsAdmin         = ug.IsAdmin,
        @PrimaryBranchId = u.BranchId,
        @IsActive        = u.IsActive
    FROM dbo.tblUser u
    LEFT JOIN dbo.tblUserGroupMap ugm ON ugm.UserId = u.Id
    LEFT JOIN dbo.tblUserGroups   ug  ON ug.Id = ugm.GroupId
    WHERE u.Id = @UserId AND u.CompId = @CompId
    ORDER BY ug.HierarchyLevel ASC;

    -- No group = least privilege. No user row = inactive (fail closed).
    IF @DataScope      IS NULL SET @DataScope      = 'Self';
    IF @HierarchyLevel IS NULL SET @HierarchyLevel = 4;
    IF @IsAdmin        IS NULL SET @IsAdmin        = 0;
    IF @IsActive       IS NULL SET @IsActive       = 0;

    SELECT @HierarchyLevel AS HierarchyLevel,
           @DataScope      AS DataScope,
           @PrimaryBranchId AS PrimaryBranchId,
           @IsAdmin        AS IsAdmin,
           @IsActive       AS IsActive;

    -- Result 2: branches
    IF @DataScope IN ('All', 'Company')
        SELECT b.Id AS BranchId, CAST(1 AS BIT) AS CanWrite FROM dbo.tblBranch b;
    ELSE IF @DataScope = 'MultiBranch'
        SELECT BranchId, CanWrite FROM (
            SELECT @PrimaryBranchId AS BranchId, CAST(1 AS BIT) AS CanWrite
            UNION
            SELECT BranchId, CanWrite FROM dbo.tblUserBranchAccess
             WHERE UserId = @UserId AND CanRead = 1
        ) merged GROUP BY BranchId, CanWrite;
    ELSE
        SELECT @PrimaryBranchId AS BranchId, CAST(1 AS BIT) AS CanWrite;

    -- Result 3: owners. Empty for the wide scopes = "no ownership filter".
    IF @DataScope = 'Self'
        SELECT @UserId AS OwnerId;
    ELSE IF @DataScope = 'Team'
        -- A team lead sees their team members' records, plus their own.
        SELECT DISTINCT OwnerId FROM (
            SELECT tm.UserId AS OwnerId
              FROM dbo.tblTeamMembers tm
              JOIN dbo.tblTeams t ON t.Id = tm.TeamId
             WHERE t.LeadUserId = @UserId
            UNION
            SELECT @UserId
        ) team_owners;
    ELSE
        SELECT CAST(NULL AS INT) AS OwnerId WHERE 1 = 0;  -- no rows
END
GO

-- ============================================================================
-- Verify after apply (read-only, rolled back):
--   * an existing active user must return IsActive = 1 in result set 1
--   * a bogus user id must return IsActive = 0
-- ============================================================================
BEGIN TRAN;
    -- Replace 1/1 with a real UserId/CompId; expect IsActive = 1.
    EXEC dbo.sp_FetchAccessibleBranchIds @UserId = 1, @CompId = 1;
    -- Nonexistent user: expect IsActive = 0 (fail closed).
    EXEC dbo.sp_FetchAccessibleBranchIds @UserId = -999, @CompId = 1;
ROLLBACK;
