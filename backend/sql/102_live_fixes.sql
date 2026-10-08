-- 102_live_fixes.sql — fix wave 2 (SQL part, S1–S3) from the 2026-10-08 live demo run.
-- Needs 099_presence.sql applied (sp_FetchPresenceCandidates). Independent of 101.
-- Additive and backward compatible: safe to apply while the old Node is running.
--   S1. `attendance` carries a reach like leads/complaints/customers/people:
--       CK_tblGroupModule_Reach widened, existing attendance rows (Reach NULL) backfilled
--       to 'Own', sp_SaveGroupModules keeps attendance's Reach and defaults it to 'Own'.
--       Before: the proc nulled it, so an attendance grant never widened anyone's scope.
--       sp_FetchUserAccess needs no change: RS2 already returns Reach for every module,
--       RS3 office lists are per reach level, not per module.
--   S2. sp_FetchTickets gains a trailing @EscalatedSubtreeJson = NULL. With @Escalated = 1
--       and a list, the "overdue" half of the Escalated queue only counts tickets assigned
--       inside that list (the caller's ReportsTo subtree). NULL = exactly the old behaviour.
--   S3. sp_FetchPresenceCandidates appends u.CreatedDate (sweep skips people created after
--       the day's shift start). Existing columns unchanged.
--   S4. sp_FetchTeamToday: a person with no clocks showed Open = 1 (the LEFT JOIN's NULL
--       row was counted). Every count now requires tt.Id IS NOT NULL. Checked the other
--       099/100/101 procs (sp_FetchToday, sp_RptTat, ...): no LEFT JOIN + conditional count.
-- Apply (both DBs): sqlcmd ... -C -b -I -i sql/102_live_fixes.sql
-- Idempotent (safe to apply twice). Verify-after-apply block at the end.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO

-- ===========================================================================
-- S1a. Constraint: attendance joins the reach modules.
--      Order matters: drop, backfill, re-add WITH CHECK (old rows must pass).
-- ===========================================================================
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_tblGroupModule_Reach'
           AND parent_object_id = OBJECT_ID('dbo.tblGroupModule'))
    ALTER TABLE dbo.tblGroupModule DROP CONSTRAINT CK_tblGroupModule_Reach;
GO

UPDATE dbo.tblGroupModule SET Reach = 'Own' WHERE Module = 'attendance' AND Reach IS NULL;
GO

ALTER TABLE dbo.tblGroupModule WITH CHECK ADD CONSTRAINT CK_tblGroupModule_Reach CHECK (
    (Module IN ('leads','complaints','customers','people','attendance')
        AND Reach IN ('Own','Team','Office','OfficeTree','Company'))
 OR (Module NOT IN ('leads','complaints','customers','people','attendance')
        AND Reach IS NULL));
GO

-- ===========================================================================
-- S1b. sp_SaveGroupModules — only the two reach-module lists change.
-- ===========================================================================
CREATE OR ALTER PROC dbo.sp_SaveGroupModules
    @GroupId         INT,
    @CompId          BIGINT,
    @ModulesJson     NVARCHAR(MAX),
    @CanSeeSensitive BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.tblUserGroups WHERE Id = @GroupId AND CompId = @CompId)
    BEGIN SELECT @GroupId AS Id, 404 AS ResponseCode, 'Role not found' AS ResponseMess; RETURN; END
    IF ISJSON(@ModulesJson) <> 1
    BEGIN SELECT @GroupId AS Id, 400 AS ResponseCode, 'Modules must be a JSON array' AS ResponseMess; RETURN; END

    DECLARE @In TABLE (Module VARCHAR(30) PRIMARY KEY, V BIT, A BIT, E BIT, D BIT, Reach VARCHAR(12));

    BEGIN TRY
        -- Parsed inside the TRY, and de-duplicated per module, so a bad payload is a 400, not a raw 500.
        INSERT INTO @In
        SELECT Module, MAX(CAST(ISNULL(CanView,0) AS INT)), MAX(CAST(ISNULL(CanAdd,0) AS INT)),
               MAX(CAST(ISNULL(CanEdit,0) AS INT)), MAX(CAST(ISNULL(CanDelete,0) AS INT)), MAX(NULLIF(Reach, ''))
        FROM OPENJSON(@ModulesJson) WITH (Module VARCHAR(30), CanView BIT, CanAdd BIT, CanEdit BIT, CanDelete BIT, Reach VARCHAR(12))
        WHERE Module IS NOT NULL
        GROUP BY Module;

        -- Any right implies view; no view = no row.
        UPDATE @In SET V = 1 WHERE A = 1 OR E = 1 OR D = 1;
        DELETE FROM @In WHERE V = 0;
        -- Reach modules default to Own; others carry none.
        UPDATE @In SET Reach = ISNULL(Reach, 'Own') WHERE Module IN ('leads','complaints','customers','people','attendance');
        UPDATE @In SET Reach = NULL WHERE Module NOT IN ('leads','complaints','customers','people','attendance');

        BEGIN TRAN;
        DELETE FROM dbo.tblGroupModule WHERE GroupId = @GroupId;
        INSERT INTO dbo.tblGroupModule (GroupId, Module, CanView, CanAdd, CanEdit, CanDelete, Reach)
        SELECT @GroupId, Module, V, A, E, D, Reach FROM @In;
        UPDATE dbo.tblUserGroups SET CanSeeSensitive = ISNULL(@CanSeeSensitive, 0) WHERE Id = @GroupId;
        COMMIT;
        SELECT @GroupId AS Id, 200 AS ResponseCode, 'Role permissions saved' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        -- 547 = the CHECK constraints (unknown module / bad reach); 245/2628/8114/8152 = unparseable or oversize values.
        SELECT @GroupId AS Id,
               CASE WHEN ERROR_NUMBER() IN (547, 245, 2628, 8114, 8152) THEN 400 ELSE 500 END AS ResponseCode,
               CASE WHEN ERROR_NUMBER() IN (547, 245, 2628, 8114, 8152) THEN 'Unknown module or reach' ELSE ERROR_MESSAGE() END AS ResponseMess;
    END CATCH
END
GO

-- ===========================================================================
-- S2. sp_FetchTickets — live text (092) + trailing @EscalatedSubtreeJson.
--     Only the @Escalated predicate and the subtree table are new.
-- ===========================================================================
CREATE OR ALTER PROC dbo.sp_FetchTickets
    @CompId                  INT,
    @BranchId                INT           = NULL,
    @PageNumber              INT           = 1,
    @PageSize                INT           = 25,
    @SearchTerm              NVARCHAR(200) = NULL,
    @StatusId                INT           = NULL,
    @StatusCode              VARCHAR(30)   = NULL,
    @Priority                INT           = NULL,
    @CategoryId              INT           = NULL,
    @ChannelId               INT           = NULL,
    @ProductId               INT           = NULL,
    @CustomerId              INT           = NULL,
    @AssignedTo              INT           = NULL,
    @Overdue                 BIT           = 0,
    @Escalated               BIT           = 0,
    @Unassigned              BIT           = 0,
    @FromDate                DATE          = NULL,
    @ToDate                  DATE          = NULL,
    @UserId                  INT           = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL,
    @EscalatedSubtreeJson    NVARCHAR(MAX) = NULL   -- 102: caller's ReportsTo subtree (incl. self); NULL = any overdue in reach
AS
BEGIN
    -- Order: newest first. Overdue / Escalated queues: overdue first,
    -- nearest due (undated last), then newest.
    SET NOCOUNT ON;

    SET @PageNumber = CASE WHEN ISNULL(@PageNumber, 1)  < 1 THEN 1  ELSE @PageNumber END;
    SET @PageSize   = CASE WHEN ISNULL(@PageSize,  25)  < 1 THEN 25 ELSE @PageSize   END;
    SET @SearchTerm = NULLIF(LTRIM(RTRIM(@SearchTerm)), N'');
    SET @StatusCode = NULLIF(LTRIM(RTRIM(@StatusCode)), '');
    SET @Overdue    = ISNULL(@Overdue, 0);
    SET @Escalated  = ISNULL(@Escalated, 0);
    SET @Unassigned = ISNULL(@Unassigned, 0);
    DECLARE @ToEx   DATETIME = CASE WHEN @ToDate IS NULL THEN NULL ELSE DATEADD(DAY, 1, CAST(@ToDate AS DATETIME)) END;
    DECLARE @Now    DATETIME = GETDATE();
    DECLARE @Triage BIT = CASE WHEN @Overdue = 1 OR @Escalated = 1 THEN 1 ELSE 0 END;
    DECLARE @Digits VARCHAR(50) = CASE WHEN @SearchTerm IS NOT NULL
                                        AND REPLACE(REPLACE(@SearchTerm, ' ', ''), '-', '') NOT LIKE '%[^0-9+]%'
                                       THEN REPLACE(REPLACE(@SearchTerm, ' ', ''), '-', '') END;

    DECLARE @BranchIds TABLE (BranchId INT PRIMARY KEY);
    DECLARE @OwnerIds  TABLE (OwnerId  INT PRIMARY KEY);
    DECLARE @Subtree   TABLE (UserId   INT PRIMARY KEY);
    DECLARE @UseBranchScope BIT = 0, @UseOwnerScope BIT = 0, @UseSubtree BIT = 0;
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
    -- '[]' = an empty subtree: only tickets escalated to the caller (fail closed).
    IF (@EscalatedSubtreeJson IS NOT NULL AND @EscalatedSubtreeJson <> '')
    BEGIN
        INSERT INTO @Subtree (UserId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@EscalatedSubtreeJson);
        SET @UseSubtree = 1;
    END

    -- One predicate, one scan: the matching ids with their sort keys.
    DECLARE @F TABLE (Id INT PRIMARY KEY, IsOverdue BIT, DueSort DATETIME, CreatedAt DATETIME);
    INSERT INTO @F (Id, IsOverdue, DueSort, CreatedAt)
    SELECT t.Id, o.IsOverdue, ISNULL(t.DueAt, '9999-12-31'), t.CreatedAt
    FROM dbo.tblTicket t
    JOIN dbo.tblLookup st   ON st.Id = t.StatusId
    JOIN dbo.tblCustomer c  ON c.Id  = t.CustomerId
    CROSS APPLY (SELECT CAST(CASE WHEN st.Code IN ('open', 'onhold') AND t.DueAt < @Now THEN 1 ELSE 0 END AS BIT) AS IsOverdue) o
    WHERE t.CompId = @CompId
      AND (@BranchId   IS NULL OR t.BranchId   = @BranchId)
      AND (@StatusId   IS NULL OR t.StatusId   = @StatusId)
      AND (@StatusCode IS NULL OR st.Code = @StatusCode
                              OR (@StatusCode = 'active' AND st.Code IN ('open', 'onhold')))
      AND (@Priority   IS NULL OR t.Priority   = @Priority)
      AND (@CategoryId IS NULL OR t.CategoryId = @CategoryId)
      AND (@ChannelId  IS NULL OR t.ChannelId  = @ChannelId)
      AND (@ProductId  IS NULL OR t.ProductId  = @ProductId)
      AND (@CustomerId IS NULL OR t.CustomerId = @CustomerId)
      AND (@AssignedTo IS NULL OR t.AssignedTo = @AssignedTo)
      AND (@Unassigned = 0 OR t.AssignedTo IS NULL)
      AND (@Overdue    = 0 OR o.IsOverdue = 1)
      AND (@Escalated  = 0 OR (st.Code IN ('open', 'onhold')
                               AND (t.EscalatedTo = @UserId
                                    OR (o.IsOverdue = 1
                                        AND (@UseSubtree = 0 OR t.AssignedTo IN (SELECT UserId FROM @Subtree))))))
      AND (@FromDate IS NULL OR t.CreatedAt >= @FromDate)
      AND (@ToEx     IS NULL OR t.CreatedAt <  @ToEx)
      AND (@SearchTerm IS NULL
           OR t.TicketNo      LIKE '%' + @SearchTerm + '%'
           OR t.Subject       LIKE '%' + @SearchTerm + '%'
           OR c.Name          LIKE '%' + @SearchTerm + '%'
           OR c.Mobile        LIKE '%' + ISNULL(@Digits, @SearchTerm) + '%'
           OR t.ContactPerson LIKE '%' + @SearchTerm + '%'
           OR t.Contact       LIKE '%' + @SearchTerm + '%')
      AND (
            (    (@UseBranchScope = 0 OR t.BranchId   IN (SELECT BranchId FROM @BranchIds))
             AND (@UseOwnerScope  = 0 OR t.AssignedTo IN (SELECT OwnerId  FROM @OwnerIds)) )
         OR (@UserId IS NOT NULL AND (t.AssignedTo = @UserId OR t.CreatedBy = @UserId))
          );

    DECLARE @Total INT = (SELECT COUNT(*) FROM @F);

    -- RS1: the page, every column + labels
    SELECT t.Id, t.CompId, t.BranchId, b.BranchName,
           t.TicketNo, t.Subject,
           t.CustomerId, c.Name AS CustomerName, c.Mobile AS CustomerMobile,
           t.ContactPerson, t.Contact,
           t.ChannelId,  ch.Value AS ChannelName,
           t.CategoryId, cat.Value AS CategoryName,
           t.Priority,   pr.Value AS PriorityName,
           t.ProductId,  p.Name AS ProductName,
           t.StatusId,   st.Value AS StatusName, st.Code AS StatusCode,
           t.AssignedTo, a.FullName AS AssigneeName, a.Avatar AS AssigneeAvatar, t.AssignedAt,
           t.DueAt, f.IsOverdue,
           DATEDIFF(HOUR, t.CreatedAt, COALESCE(t.ClosedAt, t.ResolvedAt, @Now)) AS AgeHours,
           t.EscalatedTo, e.FullName AS EscalatedToName, t.EscalatedAt,
           t.LinkedLeadId,
           t.ResolvedAt, t.ClosedAt, t.ResolutionId, r.Value AS ResolutionName,
           t.Description,
           t.CreatedBy, t.CreatedAt, t.UpdatedAt,
           200 AS ResponseCode, 'Tickets retrieved successfully' AS ResponseMess
    FROM @F f
    JOIN dbo.tblTicket t        ON t.Id   = f.Id
    JOIN dbo.tblLookup st       ON st.Id  = t.StatusId
    JOIN dbo.tblCustomer c      ON c.Id   = t.CustomerId
    LEFT JOIN dbo.tblLookup ch  ON ch.Id  = t.ChannelId
    LEFT JOIN dbo.tblLookup cat ON cat.Id = t.CategoryId
    LEFT JOIN dbo.tblLookup pr  ON pr.Id  = t.Priority
    LEFT JOIN dbo.tblLookup r   ON r.Id   = t.ResolutionId
    LEFT JOIN dbo.tblProduct p  ON p.Id   = t.ProductId
    LEFT JOIN dbo.tblUser a     ON a.Id   = t.AssignedTo
    LEFT JOIN dbo.tblUser e     ON e.Id   = t.EscalatedTo
    LEFT JOIN dbo.tblBranch b   ON b.Id   = t.BranchId
    ORDER BY CASE WHEN @Triage = 1 THEN f.IsOverdue END DESC,
             CASE WHEN @Triage = 1 THEN f.DueSort   END ASC,
             f.CreatedAt DESC, f.Id DESC
    OFFSET (@PageNumber - 1) * @PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;

    -- RS2: pagination
    SELECT @PageNumber AS CurrentPage,
           @PageSize   AS PageSize,
           @Total      AS TotalRecords,
           CASE WHEN @Total = 0 THEN 0 ELSE CEILING(CAST(@Total AS FLOAT) / @PageSize) END AS TotalPages;
END
GO

-- ===========================================================================
-- S3. sp_FetchPresenceCandidates — live text (099) + trailing CreatedDate.
-- ===========================================================================
CREATE OR ALTER PROCEDURE dbo.sp_FetchPresenceCandidates
    @CompId   BIGINT,
    @WorkDate DATE
AS
BEGIN
    SET NOCOUNT ON;
    SELECT u.Id AS UserId, u.BranchId, u.CreatedDate
    FROM dbo.tblUser u
    JOIN dbo.tblCompanySetting s ON s.CompId = u.CompId
    WHERE u.CompId = @CompId AND u.IsActive = 1 AND u.PresenceExempt = 0
      AND s.NotifyNotSignedIn = 1
      AND s.GoLiveDate IS NOT NULL AND @WorkDate >= s.GoLiveDate
      AND NOT EXISTS (SELECT 1 FROM dbo.tblPresenceDay p WHERE p.UserId = u.Id AND p.WorkDate = @WorkDate);
END
GO

-- ===========================================================================
-- S4. sp_FetchTeamToday — live text (100) with every count requiring a real clock.
--     The LEFT JOIN's NULL row (a person with no clocks) satisfied
--     "tt.ClosedAt IS NULL", so it showed Open = 1. Params and columns unchanged.
-- ===========================================================================
-- Per person: Open, AtRisk (warned, not breached), Over (breached), ReasonPending.
-- Counts are as of now; @WorkDate is accepted for the caller's symmetry with sp_FetchPresence.
CREATE OR ALTER PROCEDURE dbo.sp_FetchTeamToday
    @CompId      BIGINT,
    @WorkDate    DATE = NULL,
    @UserIdsJson NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT u.Id AS UserId,
           COUNT(CASE WHEN tt.Id IS NOT NULL AND tt.ClosedAt IS NULL THEN 1 END) AS [Open],
           COUNT(CASE WHEN tt.Id IS NOT NULL AND tt.ClosedAt IS NULL AND tt.WarnedAt IS NOT NULL AND tt.BreachedAt IS NULL THEN 1 END) AS AtRisk,
           COUNT(CASE WHEN tt.Id IS NOT NULL AND tt.ClosedAt IS NULL AND tt.BreachedAt IS NOT NULL THEN 1 END) AS [Over],
           COUNT(CASE WHEN tt.Id IS NOT NULL AND tt.BreachedAt IS NOT NULL AND tt.BreachReasonId IS NULL AND tt.Verdict IS NULL THEN 1 END) AS ReasonPending
    FROM dbo.tblUser u
    LEFT JOIN dbo.tblTaskTat tt ON tt.UserId = u.Id AND tt.CompId = @CompId
    WHERE u.CompId = @CompId
      AND u.Id IN (SELECT TRY_CAST(value AS INT) FROM OPENJSON(ISNULL(@UserIdsJson, N'[]')))
    GROUP BY u.Id;
END
GO

/* ===========================================================================
   VERIFY AFTER APPLY (read-only; run on both DBs)
   ===========================================================================
-- S1: constraint lists attendance and is trusted (is_not_trusted = 0)
SELECT name, is_not_trusted, definition FROM sys.check_constraints WHERE name = 'CK_tblGroupModule_Reach';
-- S1: no attendance row without a reach (expect 0)
SELECT COUNT(*) AS AttendanceNoReach FROM dbo.tblGroupModule WHERE Module = 'attendance' AND Reach IS NULL;
-- S1: proc keeps attendance's reach (expect 2 occurrences of the 5-module list)
SELECT (LEN(definition) - LEN(REPLACE(definition, '''people'',''attendance''', ''))) / LEN('''people'',''attendance''') AS Lists
FROM sys.sql_modules WHERE OBJECT_NAME(object_id) = 'sp_SaveGroupModules';

-- procs, all with QUOTED_IDENTIFIER ON (expect 4 rows, all 1)
SELECT OBJECT_NAME(object_id) AS proc_name, uses_quoted_identifier FROM sys.sql_modules
WHERE OBJECT_NAME(object_id) IN ('sp_SaveGroupModules','sp_FetchTickets','sp_FetchPresenceCandidates','sp_FetchTeamToday')
ORDER BY 1;

-- S2: the trailing optional param (expect 1 row)
SELECT name, has_default_value FROM sys.parameters
WHERE object_id = OBJECT_ID('dbo.sp_FetchTickets') AND name = '@EscalatedSubtreeJson';

-- S2 smoke: old call (NULL) vs an empty subtree — the second TotalRecords <= the first
DECLARE @u INT = (SELECT TOP 1 Id FROM dbo.tblUser WHERE CompId = 1 ORDER BY Id);
EXEC dbo.sp_FetchTickets @CompId=1, @Escalated=1, @UserId=@u;
EXEC dbo.sp_FetchTickets @CompId=1, @Escalated=1, @UserId=@u, @EscalatedSubtreeJson=N'[]';

-- S3: CreatedDate is the third column
SELECT name, column_ordinal FROM sys.dm_exec_describe_first_result_set_for_object(OBJECT_ID('dbo.sp_FetchPresenceCandidates'), 0);

-- S4: a user with no clocks at all shows Open = 0 (expect one row, all four counts 0)
DECLARE @nc INT = (SELECT TOP 1 u.Id FROM dbo.tblUser u WHERE u.CompId = 1
                   AND NOT EXISTS (SELECT 1 FROM dbo.tblTaskTat tt WHERE tt.UserId = u.Id) ORDER BY u.Id);
DECLARE @ncJson NVARCHAR(50) = N'[' + CAST(@nc AS NVARCHAR(20)) + N']';
EXEC dbo.sp_FetchTeamToday @CompId=1, @UserIdsJson=@ncJson;
*/
