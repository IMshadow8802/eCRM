/* ===========================================================================
   118 — resolved / done date filters for the mobile Home counts
   ---------------------------------------------------------------------------
   Apply by hand, TestCRM first, then eCRM+ and SolarCRM (CLAUDE.md §0.2).
   sqlcmd needs -I (QUOTED_IDENTIFIER ON).

   1. sp_FetchTickets   gains trailing @ResolvedFrom DATETIME = NULL, @ResolvedTo DATETIME = NULL
                        -> t.ResolvedAt >= @ResolvedFrom AND t.ResolvedAt < @ResolvedTo
                        ("my complaints resolved in the last 7 days": PageSize 1, TotalRecords).
   2. sp_FetchFollowUps gains trailing @DoneFrom DATETIME = NULL, @DoneTo DATETIME = NULL
                        -> f.DoneAt >= @DoneFrom AND f.DoneAt < @DoneTo  (queue mode only;
                        the per-lead mode returns the lead's full list as before). "Done today".

   Both are AND-ed into the existing WHERE: they only narrow within reach. Every
   CompId / branch / owner / always-visible predicate is untouched. Both default
   NULL, so the deployed web and mobile (which never send them) behave exactly as
   before.

   HOW: the same text patch as 107. Each proc is ALTERed from its own LIVE
   text (OBJECT_DEFINITION) with two anchored insertions; nothing else changes.
   This is deliberate: sp_FetchFollowUps' live text was itself produced by 107's
   in-place REPLACE (creator arm), so no committed file holds its exact body, and
   a full CREATE OR ALTER from git would risk reverting a scope fix.
     * Both stored texts begin "CREATE OR ALTER PROC", so executing the patched
       text alters in place: grants and object_id are kept (no DROP). A text that
       does not begin that way -> THROW, proc left as it was.
     * Already patched (param present)       -> skipped, idempotent.
     * An anchor missing or not exactly once -> THROW, proc left as it was.
     * The THROW is PER PROCEDURE, in order: if sp_FetchFollowUps fails,
       sp_FetchTickets is already patched (and stays patched). Fix and simply
       re-run the whole script: the patched proc is skipped.
     * Each ALTER runs in its own transaction, rolled back in the CATCH.
   Anchors were checked against the committed texts: sp_FetchTickets from 102
   (0b10fae) and sp_FetchFollowUps from 071 (eec3a36) + 107's two REPLACEs
   (b349524) — NOT against the live DBs. If a THROW fires, diff the live text:
     SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.sp_FetchFollowUps'));

   DATE RANGES — read before calling:
     @ResolvedFrom / @DoneFrom : inclusive instant   (>=)
     @ResolvedTo   / @DoneTo   : EXCLUSIVE instant   (<)  "through today" = tomorrow 00:00
     The neighbouring @DueTo (follow-ups) and @ToDate (tickets) are INCLUSIVE
     whole days (the SP adds a day itself). Different on purpose; do not mix.

   ROLLOUT: the backend sends these keys only when the caller sets them, so the
   shared src keeps working on a DB that has not had 118 yet.
   =========================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

DECLARE @nl NCHAR(1) = NCHAR(10);
DECLARE @patch TABLE (
    seq INT, proc_name SYSNAME, marker NVARCHAR(100),
    a1 NVARCHAR(400), r1 NVARCHAR(1000), a2 NVARCHAR(400), r2 NVARCHAR(800));

INSERT INTO @patch VALUES
(1, N'sp_FetchTickets', N'@ResolvedFrom',
    -- param list: append after the last param (positional callers unaffected)
    N'@EscalatedSubtreeJson    NVARCHAR(MAX) = NULL',
    N'@EscalatedSubtreeJson    NVARCHAR(MAX) = NULL, @ResolvedFrom DATETIME = NULL /* 118: inclusive */, @ResolvedTo DATETIME = NULL /* 118: EXCLUSIVE instant, unlike @ToDate (inclusive day) */',
    -- WHERE: right after the CreatedAt bracket
    N'AND (@ToEx     IS NULL OR t.CreatedAt <  @ToEx)',
    N'AND (@ToEx     IS NULL OR t.CreatedAt <  @ToEx)' + @nl
  + N'      AND (@ResolvedFrom IS NULL OR t.ResolvedAt >= @ResolvedFrom)  -- 118' + @nl
  + N'      AND (@ResolvedTo   IS NULL OR t.ResolvedAt <  @ResolvedTo)    -- 118'),
(2, N'sp_FetchFollowUps', N'@DoneFrom',
    N'@OwnerIdsJson            NVARCHAR(MAX) = NULL',
    N'@OwnerIdsJson            NVARCHAR(MAX) = NULL, @DoneFrom DATETIME = NULL /* 118: inclusive */, @DoneTo DATETIME = NULL /* 118: EXCLUSIVE instant, unlike @DueTo (inclusive day) */',
    -- WHERE of the paged (queue) query: right before the Overdue predicate
    N'AND (@Overdue = 0 OR (f.Status = ''open''',
    N'AND (@DoneFrom IS NULL OR f.DoneAt >= @DoneFrom)  -- 118' + @nl
  + N'      AND (@DoneTo   IS NULL OR f.DoneAt <  @DoneTo)    -- 118' + @nl
  + N'      AND (@Overdue = 0 OR (f.Status = ''open''');

DECLARE @seq INT = 1, @p SYSNAME, @marker NVARCHAR(100), @a1 NVARCHAR(400), @r1 NVARCHAR(1000),
        @a2 NVARCHAR(400), @r2 NVARCHAR(800), @def NVARCHAR(MAX), @msg NVARCHAR(2048);
WHILE @seq <= 2
BEGIN
    SELECT @p = proc_name, @marker = marker, @a1 = a1, @r1 = r1, @a2 = a2, @r2 = r2 FROM @patch WHERE seq = @seq;
    SET @def = OBJECT_DEFINITION(OBJECT_ID(N'dbo.' + @p));

    IF @def IS NULL
    BEGIN
        SET @msg = N'118: dbo.' + @p + N' not found';
        THROW 50118, @msg, 1;
    END

    IF CHARINDEX(@marker, @def) = 0 AND CHARINDEX(N'CREATE OR ALTER PROC', @def) = 0
    BEGIN
        SET @msg = N'118: live dbo.' + @p + N' does not begin CREATE OR ALTER PROC — left as it was';
        THROW 50118, @msg, 1;
    END

    IF CHARINDEX(@marker, @def) > 0
        PRINT N'118: already patched, skipped: ' + @p;
    ELSE
    BEGIN
        -- each anchor exactly once, or nothing is touched
        IF (DATALENGTH(@def) - DATALENGTH(REPLACE(@def, @a1, N''))) / DATALENGTH(@a1) <> 1
        OR (DATALENGTH(@def) - DATALENGTH(REPLACE(@def, @a2, N''))) / DATALENGTH(@a2) <> 1
        BEGIN
            SET @msg = N'118: anchor not found exactly once in live dbo.' + @p + N' — left as it was; diff its OBJECT_DEFINITION';
            THROW 50118, @msg, 1;
        END

        SET @def = REPLACE(REPLACE(@def, @a1, @r1), @a2, @r2);
        BEGIN TRY
            BEGIN TRAN;
            EXEC (@def);   -- CREATE OR ALTER: alters in place, grants + object_id kept
            COMMIT;
            PRINT N'118: patched ' + @p;
        END TRY
        BEGIN CATCH
            IF @@TRANCOUNT > 0 ROLLBACK;
            PRINT N'118: FAILED, left as it was: ' + @p + N' — ' + ERROR_MESSAGE();
            THROW;
        END CATCH
    END
    SET @seq += 1;
END
GO

/* ===========================================================================
   VERIFY AFTER APPLY (read-only; run on each DB)
   ===========================================================================
-- 1. Four new params, DATETIME, last in each list            -- expect 4 rows
SELECT OBJECT_NAME(object_id) AS proc_name, parameter_id, name, TYPE_NAME(user_type_id) AS type
FROM sys.parameters
WHERE object_id IN (OBJECT_ID('dbo.sp_FetchTickets'), OBJECT_ID('dbo.sp_FetchFollowUps'))
  AND name IN ('@ResolvedFrom', '@ResolvedTo', '@DoneFrom', '@DoneTo')
ORDER BY proc_name, parameter_id;

-- 2. Scope predicates still there                             -- expect both > 0
SELECT CHARINDEX('t.AssignedTo = @UserId', OBJECT_DEFINITION(OBJECT_ID('dbo.sp_FetchTickets')))  AS tickets_always_visible,
       CHARINDEX('l.OwnerId IS NULL AND l.CreatedBy = @UserId',
                 OBJECT_DEFINITION(OBJECT_ID('dbo.sp_FetchFollowUps')))                         AS followups_107_arm;

-- 3. The filters count what a direct query counts. No scope JSON is passed, so
--    the SP's reach arm is "everything in CompId" and the direct counts below
--    use the same rows. Set @c (CompId) and @u (an assignee with resolved tickets).
DECLARE @c INT = 1, @u INT = 1,
        @wk DATETIME = DATEADD(DAY, -7, CAST(CAST(GETDATE() AS DATE) AS DATETIME)),
        @d0 DATETIME = CAST(CAST(GETDATE() AS DATE) AS DATETIME),
        @d1 DATETIME = DATEADD(DAY, 1, CAST(CAST(GETDATE() AS DATE) AS DATETIME));

-- 3a. Tickets: RS2 TotalRecords   -- expect EQUAL to direct_resolved_7d
EXEC dbo.sp_FetchTickets @CompId = @c, @UserId = @u, @PageSize = 1, @AssignedTo = @u,
                         @ResolvedFrom = @wk, @ResolvedTo = @d1;
SELECT COUNT(*) AS direct_resolved_7d
FROM dbo.tblTicket t
JOIN dbo.tblLookup st  ON st.Id = t.StatusId
JOIN dbo.tblCustomer c ON c.Id  = t.CustomerId
WHERE t.CompId = @c AND t.AssignedTo = @u AND t.ResolvedAt >= @wk AND t.ResolvedAt < @d1;

-- 3b. Upper bound is EXCLUSIVE: a window ending exactly at a ticket's ResolvedAt
--     must not contain it; one ending 3 ms later (DATETIME tick) must.
DECLARE @x DATETIME = (SELECT TOP 1 ResolvedAt FROM dbo.tblTicket
                       WHERE CompId = @c AND ResolvedAt IS NOT NULL ORDER BY ResolvedAt DESC);
DECLARE @x3 DATETIME = DATEADD(MILLISECOND, 3, @x);
EXEC dbo.sp_FetchTickets @CompId = @c, @PageSize = 1, @ResolvedFrom = @x, @ResolvedTo = @x;   -- expect RS2 TotalRecords = 0
EXEC dbo.sp_FetchTickets @CompId = @c, @PageSize = 1, @ResolvedFrom = @x, @ResolvedTo = @x3;  -- expect RS2 TotalRecords >= 1
SELECT COUNT(*) AS direct_at_x FROM dbo.tblTicket WHERE CompId = @c AND ResolvedAt = @x;      -- expect EQUAL to the second

-- 3c. Follow-ups done today: RS2 TotalRecords   -- expect EQUAL to direct_done_today
EXEC dbo.sp_FetchFollowUps @CompId = @c, @PageSize = 1, @Status = 'done', @DoneFrom = @d0, @DoneTo = @d1;
SELECT COUNT(*) AS direct_done_today
FROM dbo.tblFollowUp f
JOIN dbo.tblLeads l   ON l.Id = f.LeadId AND l.CompId = f.CompId
JOIN dbo.tblLookup st ON st.Id = l.StatusId
WHERE f.CompId = @c AND f.Status = 'done' AND f.DoneAt >= @d0 AND f.DoneAt < @d1;

-- 3d. An old call is unchanged (no new params): RS2 = every ticket in CompId
EXEC dbo.sp_FetchTickets @CompId = @c, @PageSize = 1;
*/
