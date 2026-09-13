-- ===========================================================================
-- 080_scope_ticket_reports.sql
--
-- Closes a live cross-scope leak found by the 2026-09-13 security audit.
--
-- SYMPTOM (measured against production, body literally `{}`)
--   sp_TicketsByCategory and sp_ResolutionSummary take (@CompId, @BranchId)
--   and the controller passed req.user.BranchId -- the JWT branch, never
--   req.scope. CLAUDE.md section 3 names this exact anti-pattern.
--
--     se_se_pooja  (Self scope, branch 2)  saw 56 tickets / 33 resolutions.
--                                          She is assigned ZERO.
--     sh_priya     (Company scope)         saw 0, because her own BranchId
--                                          holds no tickets.
--
--   It fails BOTH ways, and one way is fail-open. Worse, tblUser.BranchId is
--   nullable: a user with no branch got @BranchId = NULL, which both procs
--   read as "no branch filter" -- company-wide totals for anybody.
--
-- FIX
--   Give both procs the full scope contract and drop @BranchId as a
--   visibility gate (it stays as an optional NARROWING filter, which is what
--   the other report procs do). The predicate is copied verbatim from the
--   live sp_FetchTickets, so a ticket report now shows exactly what the
--   ticket list shows -- AssignedTo is the ticket's owner axis, and the
--   assigned-or-created escape hatch is preserved.
--
--   Controller change ships with this (reportController.ticketsByCategory /
--   resolutionSummary now send scopeParams(req)); deploy the backend AFTER
--   applying this script, or the calls error with too many arguments.
--
-- sp_Dashboard is NOT changed here: it already takes @AccessibleBranchIdsJson
-- and needs an owner axis too, but it spans leads, tickets and tasks and
-- deserves its own script rather than being rushed in alongside this one.
-- ===========================================================================
SET NOCOUNT ON;
GO

CREATE OR ALTER PROC dbo.sp_TicketsByCategory
    @CompId                  INT,
    @BranchId                INT           = NULL,
    @UserId                  INT           = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @BranchIds TABLE (BranchId INT PRIMARY KEY);
    DECLARE @OwnerIds  TABLE (OwnerId  INT PRIMARY KEY);
    DECLARE @UseBranchScope BIT = 0, @UseOwnerScope BIT = 0;

    IF (@AccessibleBranchIdsJson IS NOT NULL AND LTRIM(RTRIM(@AccessibleBranchIdsJson)) <> '')
    BEGIN
        INSERT INTO @BranchIds (BranchId)
        SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@AccessibleBranchIdsJson);
        SET @UseBranchScope = 1;
    END

    IF (@OwnerIdsJson IS NOT NULL AND LTRIM(RTRIM(@OwnerIdsJson)) <> '')
    BEGIN
        INSERT INTO @OwnerIds (OwnerId)
        SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@OwnerIdsJson);
        SET @UseOwnerScope = 1;
    END

    SELECT lk.Id AS CategoryId, lk.Value AS CategoryName,
           COUNT(t.Id) AS TicketCount,
           200 AS ResponseCode, 'Tickets by category retrieved successfully' AS ResponseMess
    FROM dbo.tblLookup lk
    LEFT JOIN dbo.tblTicket t
           ON t.CategoryId = lk.Id AND t.CompId = @CompId
          AND (@BranchId IS NULL OR t.BranchId = @BranchId)
          AND (
                (    (@UseBranchScope = 0 OR t.BranchId   IN (SELECT BranchId FROM @BranchIds))
                 AND (@UseOwnerScope  = 0 OR t.AssignedTo IN (SELECT OwnerId  FROM @OwnerIds)) )
             OR (@UserId IS NOT NULL AND (t.AssignedTo = @UserId OR t.CreatedBy = @UserId))
              )
    WHERE lk.CompId = @CompId AND lk.Kind = 'ticket_category' AND lk.IsActive = 1
    GROUP BY lk.Id, lk.Value, lk.SortOrder
    ORDER BY lk.SortOrder;
END
GO

CREATE OR ALTER PROC dbo.sp_ResolutionSummary
    @CompId                  INT,
    @BranchId                INT           = NULL,
    @UserId                  INT           = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @BranchIds TABLE (BranchId INT PRIMARY KEY);
    DECLARE @OwnerIds  TABLE (OwnerId  INT PRIMARY KEY);
    DECLARE @UseBranchScope BIT = 0, @UseOwnerScope BIT = 0;

    IF (@AccessibleBranchIdsJson IS NOT NULL AND LTRIM(RTRIM(@AccessibleBranchIdsJson)) <> '')
    BEGIN
        INSERT INTO @BranchIds (BranchId)
        SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@AccessibleBranchIdsJson);
        SET @UseBranchScope = 1;
    END

    IF (@OwnerIdsJson IS NOT NULL AND LTRIM(RTRIM(@OwnerIdsJson)) <> '')
    BEGIN
        INSERT INTO @OwnerIds (OwnerId)
        SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@OwnerIdsJson);
        SET @UseOwnerScope = 1;
    END

    SELECT lk.Id AS ResolutionId, lk.Value AS ResolutionName,
           COUNT(t.Id) AS TicketCount,
           AVG(DATEDIFF(MINUTE, t.CreatedAt, t.ResolvedAt)) AS AvgResolutionMins,
           200 AS ResponseCode, 'Resolution summary retrieved successfully' AS ResponseMess
    FROM dbo.tblLookup lk
    LEFT JOIN dbo.tblTicket t
           ON t.ResolutionId = lk.Id AND t.CompId = @CompId AND t.ResolvedAt IS NOT NULL
          AND (@BranchId IS NULL OR t.BranchId = @BranchId)
          AND (
                (    (@UseBranchScope = 0 OR t.BranchId   IN (SELECT BranchId FROM @BranchIds))
                 AND (@UseOwnerScope  = 0 OR t.AssignedTo IN (SELECT OwnerId  FROM @OwnerIds)) )
             OR (@UserId IS NOT NULL AND (t.AssignedTo = @UserId OR t.CreatedBy = @UserId))
              )
    WHERE lk.CompId = @CompId AND lk.Kind = 'resolution' AND lk.IsActive = 1
    GROUP BY lk.Id, lk.Value, lk.SortOrder
    ORDER BY lk.SortOrder;
END
GO

-- ===========================================================================
-- VERIFY AFTER APPLY  (read-only; safe to re-run)
--   se_se_pooja (21, Self, branch 2) is assigned NO tickets -> expect every
--     TicketCount to be 0, where before the fix she saw 56.
--   sh_priya (13, Company) -> expect the real company totals, where before
--     the fix she saw 0 because her own BranchId held no tickets.
-- ===========================================================================
PRINT 'Pooja (Self, assigned nothing) -- expect all zero:';
EXEC dbo.sp_TicketsByCategory @CompId = 1, @UserId = 21,
     @AccessibleBranchIdsJson = N'[2]', @OwnerIdsJson = N'[21]';

PRINT 'Priya (Company) -- expect the real totals:';
EXEC dbo.sp_TicketsByCategory @CompId = 1, @UserId = 13,
     @AccessibleBranchIdsJson = N'[1,2,3,4,5]', @OwnerIdsJson = NULL;

PRINT 'Pooja resolutions -- expect all zero:';
EXEC dbo.sp_ResolutionSummary @CompId = 1, @UserId = 21,
     @AccessibleBranchIdsJson = N'[2]', @OwnerIdsJson = N'[21]';

PRINT 'Priya resolutions -- expect the real totals:';
EXEC dbo.sp_ResolutionSummary @CompId = 1, @UserId = 13,
     @AccessibleBranchIdsJson = N'[1,2,3,4,5]', @OwnerIdsJson = NULL;
GO
