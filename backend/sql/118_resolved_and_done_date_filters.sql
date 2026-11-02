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

   HOW: the same text patch as 107. Each proc is re-created from its own LIVE
   text (OBJECT_DEFINITION) with two anchored insertions, nothing else changes.
   This is deliberate: sp_FetchFollowUps' live text was itself produced by 107's
   in-place REPLACE (creator arm), so no committed file holds its exact body, and
   a full CREATE OR ALTER from git would risk reverting a scope fix.
     * Already patched (param present)       -> skipped, idempotent.
     * An anchor missing or not exactly once -> THROW, proc left as it was.
     * DROP + re-create run in one transaction (DDL is transactional), as in 107.
   Anchors were checked against the committed texts: sp_FetchTickets from 102
   (0b10fae) and sp_FetchFollowUps from 071 (eec3a36) + 107's two REPLACEs
   (b349524) — NOT against the live DBs. If a THROW fires, diff the live text:
     SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.sp_FetchTickets'));
   =========================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

DECLARE @nl NCHAR(1) = NCHAR(10);
DECLARE @patch TABLE (
    seq INT, proc_name SYSNAME, marker NVARCHAR(100),
    a1 NVARCHAR(400), r1 NVARCHAR(800), a2 NVARCHAR(400), r2 NVARCHAR(800));

INSERT INTO @patch VALUES
(1, N'sp_FetchTickets', N'@ResolvedFrom',
    -- param list: append after the last param (positional callers unaffected)
    N'@EscalatedSubtreeJson    NVARCHAR(MAX) = NULL',
    N'@EscalatedSubtreeJson    NVARCHAR(MAX) = NULL, @ResolvedFrom DATETIME = NULL, @ResolvedTo DATETIME = NULL',
    -- WHERE: right after the CreatedAt bracket
    N'AND (@ToEx     IS NULL OR t.CreatedAt <  @ToEx)',
    N'AND (@ToEx     IS NULL OR t.CreatedAt <  @ToEx)' + @nl
  + N'      AND (@ResolvedFrom IS NULL OR t.ResolvedAt >= @ResolvedFrom)  -- 118' + @nl
  + N'      AND (@ResolvedTo   IS NULL OR t.ResolvedAt <  @ResolvedTo)    -- 118'),
(2, N'sp_FetchFollowUps', N'@DoneFrom',
    N'@OwnerIdsJson            NVARCHAR(MAX) = NULL',
    N'@OwnerIdsJson            NVARCHAR(MAX) = NULL, @DoneFrom DATETIME = NULL, @DoneTo DATETIME = NULL',
    -- WHERE of the paged (queue) query: right before the Overdue predicate
    N'AND (@Overdue = 0 OR (f.Status = ''open''',
    N'AND (@DoneFrom IS NULL OR f.DoneAt >= @DoneFrom)  -- 118' + @nl
  + N'      AND (@DoneTo   IS NULL OR f.DoneAt <  @DoneTo)    -- 118' + @nl
  + N'      AND (@Overdue = 0 OR (f.Status = ''open''');

DECLARE @seq INT = 1, @p SYSNAME, @marker NVARCHAR(100), @a1 NVARCHAR(400), @r1 NVARCHAR(800),
        @a2 NVARCHAR(400), @r2 NVARCHAR(800), @def NVARCHAR(MAX), @drop NVARCHAR(400), @msg NVARCHAR(2048);
WHILE @seq <= 2
BEGIN
    SELECT @p = proc_name, @marker = marker, @a1 = a1, @r1 = r1, @a2 = a2, @r2 = r2 FROM @patch WHERE seq = @seq;
    SET @def = OBJECT_DEFINITION(OBJECT_ID(N'dbo.' + @p));

    IF @def IS NULL
    BEGIN
        SET @msg = N'118: dbo.' + @p + N' not found';
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

        SET @def  = REPLACE(REPLACE(@def, @a1, @r1), @a2, @r2);
        SET @drop = N'DROP PROCEDURE dbo.' + QUOTENAME(@p);
        BEGIN TRY
            BEGIN TRAN;
            EXEC (@drop);
            EXEC (@def);
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
-- 1. Four new params, DATETIME, last in each list
SELECT OBJECT_NAME(object_id) AS proc_name, parameter_id, name, TYPE_NAME(user_type_id) AS type
FROM sys.parameters
WHERE object_id IN (OBJECT_ID('dbo.sp_FetchTickets'), OBJECT_ID('dbo.sp_FetchFollowUps'))
  AND name IN ('@ResolvedFrom', '@ResolvedTo', '@DoneFrom', '@DoneTo')
ORDER BY proc_name, parameter_id;                       -- expect 4 rows, DATETIME

-- 2. The scope predicates are still there (each expect 1)
SELECT CHARINDEX('t.AssignedTo = @UserId', OBJECT_DEFINITION(OBJECT_ID('dbo.sp_FetchTickets')))   AS tickets_always_visible,
       CHARINDEX('l.OwnerId IS NULL AND l.CreatedBy = @UserId',
                 OBJECT_DEFINITION(OBJECT_ID('dbo.sp_FetchFollowUps')))                          AS followups_107_arm;
                                                         -- expect both > 0

-- 3. Old call unchanged, new call narrows (CompId of TestCRM; pick a real UserId)
DECLARE @c INT = 1, @u INT = 1,
        @wk DATETIME = DATEADD(DAY, -7, CAST(CAST(GETDATE() AS DATE) AS DATETIME)),
        @d0 DATETIME = CAST(CAST(GETDATE() AS DATE) AS DATETIME),
        @d1 DATETIME = DATEADD(DAY, 1, CAST(CAST(GETDATE() AS DATE) AS DATETIME));
EXEC dbo.sp_FetchTickets   @CompId = @c, @UserId = @u, @PageSize = 1;                         -- RS2 TotalRecords = all
EXEC dbo.sp_FetchTickets   @CompId = @c, @UserId = @u, @PageSize = 1, @AssignedTo = @u,
                           @ResolvedFrom = @wk, @ResolvedTo = @d1;                           -- RS2 = mine resolved, 7 days
SELECT COUNT(*) AS expect_at_most FROM dbo.tblTicket
WHERE CompId = @c AND AssignedTo = @u AND ResolvedAt >= @wk AND ResolvedAt < @d1;
EXEC dbo.sp_FetchFollowUps @CompId = @c, @UserId = @u, @PageSize = 1, @Status = 'done',
                           @DoneFrom = @d0, @DoneTo = @d1;                                    -- RS2 = done today
*/
