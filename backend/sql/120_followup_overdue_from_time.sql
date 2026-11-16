/* ===========================================================================
   120 — a timed follow-up is overdue from its time, not from the next day
   ---------------------------------------------------------------------------
   Apply by hand: TestCRM first, then eCRM+, SolarCRM and OSG (CLAUDE.md §0.2).
   sqlcmd needs -I (QUOTED_IDENTIFIER ON).

   Today every overdue test reads "{col} < @Today" (@Today = midnight today),
   so a follow-up due today at 10:00 is not overdue until tomorrow. A follow-up
   now may carry a time. Each test becomes:

       {col} < CASE WHEN CAST({col} AS TIME) = '00:00' THEN @Today ELSE GETDATE() END

   A date-only row (time 00:00, every row saved before this feature) keeps the
   old meaning: overdue from the next day. A timed row is overdue once its
   time has passed. Each rewritten test carries the 120 marker comment.

   1. sp_FetchFollowUps   f.DueAt < @Today            x3  (lead-mode IsOverdue,
                                                           @Overdue filter,
                                                           queue IsOverdue)
   2. sp_FetchLeads       l.NextFollowupDate < @Today x3  (two @Overdue filters,
                                                           IsOverdue)
   3. sp_FetchLeadDetail  l.NextFollowupDate < @Today x1, f.DueAt < @Today x1
   4. sp_Dashboard        f.DueAt < @Today            x1
   sp_RptFollowUpCompliance already tests GETDATE() and is not touched.
   Same columns, same params; every CompId / reach predicate is untouched.

   HOW: the 118/119 pattern. Each proc is ALTERed from its own LIVE text
   (OBJECT_DEFINITION); only the anchors above change.
     * SQL Server stores "CREATE OR ALTER PROC" as "CREATE   PROC", so the
       header "PROC dbo.<name>" must occur exactly once; it is rewritten to
       CREATE OR ALTER just before EXEC (alters in place: grants + object_id
       kept, no DROP).
     * Already patched (120 marker present)       -> skipped, idempotent.
     * Any anchor count differs from the list     -> THROW 50120, proc left
                                                     as it was.
     * All of a proc's anchors are replaced in one text, then ONE EXEC in its
       own transaction, rolled back in the CATCH. Per procedure, in order: on a
       THROW the earlier procs stay patched; fix and re-run (done ones skip).
   Anchor counts checked read-only against the live text of TestCRM, eCRM+,
   SolarCRM and OSG on 2026-11-16: identical on all four.
   If a THROW fires, diff the live text:
     SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.sp_FetchLeads'));

   ROLLOUT: backend and clients unchanged (they read IsOverdue from the
   server); works before and after.
   =========================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

DECLARE @tmpl NVARCHAR(400) =
    N'{col} < /*120*/ CASE WHEN CAST({col} AS TIME) = ''00:00'' THEN @Today ELSE GETDATE() END';

DECLARE @anchor TABLE (seq INT, col NVARCHAR(100), cnt INT);
DECLARE @proc TABLE (seq INT, proc_name SYSNAME);
INSERT INTO @proc VALUES (1, N'sp_FetchFollowUps'), (2, N'sp_FetchLeads'), (3, N'sp_FetchLeadDetail'), (4, N'sp_Dashboard');
INSERT INTO @anchor VALUES
(1, N'f.DueAt', 3),
(2, N'l.NextFollowupDate', 3),
(3, N'l.NextFollowupDate', 1),
(3, N'f.DueAt', 1),
(4, N'f.DueAt', 1);

DECLARE @seq INT = 1, @p SYSNAME, @def NVARCHAR(MAX), @msg NVARCHAR(2048),
        @hdr NVARCHAR(300), @h INT, @k INT, @bad NVARCHAR(400);
WHILE @seq <= 4
BEGIN
    SELECT @p = proc_name FROM @proc WHERE seq = @seq;
    SET @def = OBJECT_DEFINITION(OBJECT_ID(N'dbo.' + @p));

    IF @def IS NULL
    BEGIN
        SET @msg = N'120: dbo.' + @p + N' not found';
        THROW 50120, @msg, 1;
    END

    IF CHARINDEX(N'/*120*/', @def) > 0
        PRINT N'120: already patched, skipped: ' + @p;
    ELSE
    BEGIN
        SET @hdr = N'PROC dbo.' + @p;
        IF (DATALENGTH(@def) - DATALENGTH(REPLACE(@def, @hdr, N''))) / DATALENGTH(@hdr) <> 1
        BEGIN
            SET @msg = N'120: live dbo.' + @p + N' header "' + @hdr + N'" not found exactly once — left as it was';
            THROW 50120, @msg, 1;
        END

        SET @bad = NULL;
        SELECT TOP 1 @bad = a.col + N' < @Today: expected ' + CAST(a.cnt AS NVARCHAR(10)) + N', found '
             + CAST((DATALENGTH(@def) - DATALENGTH(REPLACE(@def, a.col + N' < @Today', N''))) / DATALENGTH(a.col + N' < @Today') AS NVARCHAR(10))
        FROM @anchor a
        WHERE a.seq = @seq
          AND (DATALENGTH(@def) - DATALENGTH(REPLACE(@def, a.col + N' < @Today', N''))) / DATALENGTH(a.col + N' < @Today') <> a.cnt;
        IF @bad IS NOT NULL
        BEGIN
            SET @msg = N'120: dbo.' + @p + N' anchor count differs (' + @bad + N') — left as it was; diff its OBJECT_DEFINITION';
            THROW 50120, @msg, 1;
        END

        SELECT @def = REPLACE(@def, a.col + N' < @Today', REPLACE(@tmpl, N'{col}', a.col))
        FROM @anchor a WHERE a.seq = @seq;
        -- the multi-row assignment above must have applied every anchor
        IF (DATALENGTH(@def) - DATALENGTH(REPLACE(@def, N'/*120*/', N''))) / DATALENGTH(N'/*120*/')
           <> (SELECT SUM(cnt) FROM @anchor WHERE seq = @seq)
        BEGIN
            SET @msg = N'120: dbo.' + @p + N' not every anchor was replaced — left as it was';
            THROW 50120, @msg, 1;
        END

        SET @h = CHARINDEX(@hdr, @def);
        SET @k = @h - 1;
        WHILE @k > 0 AND SUBSTRING(@def, @k, 1) IN (N' ', NCHAR(9), NCHAR(10), NCHAR(13)) SET @k -= 1;
        IF @k < 6 OR SUBSTRING(@def, @k - 5, 6) <> N'CREATE'
        BEGIN
            SET @msg = N'120: no CREATE before "' + @hdr + N'" — left as it was';
            THROW 50120, @msg, 1;
        END
        SET @def = STUFF(@def, @k - 5, @h - (@k - 5), N'CREATE OR ALTER ');
        BEGIN TRY
            BEGIN TRAN;
            EXEC (@def);   -- CREATE OR ALTER: alters in place, grants + object_id kept
            COMMIT;
            PRINT N'120: patched ' + @p;
        END TRY
        BEGIN CATCH
            IF @@TRANCOUNT > 0 ROLLBACK;
            PRINT N'120: FAILED, left as it was: ' + @p + N' — ' + ERROR_MESSAGE();
            THROW;
        END CATCH
    END
    SET @seq += 1;
END
GO

-- ===========================================================================
--    VERIFY AFTER APPLY — read-only, every DB
--    ===========================================================================
-- Expect 4 rows: FetchFollowUps 3, FetchLeads 3, FetchLeadDetail 2, Dashboard 1 markers
-- SELECT o.name, (LEN(m.definition) - LEN(REPLACE(m.definition, '/*120*/', ''))) / 7 AS markers
-- FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
-- WHERE m.definition LIKE '%/*120*/%';
-- Behaviour: an open follow-up due today 00:00 has IsOverdue 0; one due today at an hour already past has IsOverdue 1:
-- EXEC dbo.sp_FetchFollowUps @CompId = <id>, @LeadId = <lead with both>;
