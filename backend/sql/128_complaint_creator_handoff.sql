-- ===========================================================================
-- 128 - complaint creator handoff: a ticket's creator keeps it only while it
--       is unassigned, matching how a lead's creator keeps it only while it
--       has no owner.
--
-- Apply by hand with sqlcmd -I (QUOTED_IDENTIFIER ON), CLAUDE.md 0.2.
-- Order of databases: TestCRM, then eCRM+, SolarCRM, OSG.
--
-- Today every complaint-visibility predicate ORs `t.CreatedBy = @UserId`, so a
-- ticket's creator keeps full sight of it even after it is transferred to
-- someone else. This narrows that OR to `t.CreatedBy = @UserId AND
-- t.AssignedTo IS NULL`: the creator keeps it only while it is unassigned.
-- Once it is assigned to anyone (including back to the creator, which is then
-- caught by the `t.AssignedTo = @UserId` arm), the plain creator clause no
-- longer grants sight. The JS half of the rule is permission.js canSeeRecord.
--
-- Four procedures share the exact same ticket predicate
--   `t.AssignedTo = @UserId OR t.CreatedBy = @UserId`
-- (verified: that string occurs exactly once in each, on all four DBs, and
-- each proc's header is stored as `CREATE   PROC dbo.<name>`):
--   dbo.sp_FetchTickets        the complaint LIST (and detail scope)
--   dbo.sp_Dashboard           the "my complaints" home-screen counts
--   dbo.sp_ResolutionSummary   resolution report scope
--   dbo.sp_TicketsByCategory   category report scope
-- sp_Dashboard's lead clause uses OwnerId and is NOT this anchor, so it is left
-- untouched (leads already follow this rule). sp_Dashboard ALSO carries a
-- SECOND ticket predicate in its RS5 "Calls" subquery, aliased `bt` instead of
-- `t` (`bt.AssignedTo = @UserId OR bt.CreatedBy = @UserId`); it gets the same
-- narrowing via a dashboard-only extra REPLACE below, or the Calls figure would
-- still count calls on tickets the viewer created but no longer owns.
--
-- Each proc is patched from its own live text (OBJECT_DEFINITION), so nothing
-- but the REPLACEs below changes: header rewritten CREATE   PROC ->
-- CREATE OR ALTER PROC, then the shared `t` anchor narrowed (plus the `bt`
-- anchor for sp_Dashboard). Idempotent: a proc already carrying the new `t`
-- clause is skipped; a missing proc, a missing `t` anchor, or a missing `bt`
-- anchor in sp_Dashboard raises rather than silently doing nothing.
--
-- sqlcmd splits on GO even inside comments, so every note here is a `--` line
-- comment and the live proc bodies travel as a string value in @sql (never
-- parsed as batch text), which is why their own block comments and any GO
-- inside them are harmless.
-- ===========================================================================
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

DECLARE @procs TABLE (name SYSNAME);
INSERT INTO @procs (name) VALUES
    ('sp_FetchTickets'), ('sp_Dashboard'), ('sp_ResolutionSummary'), ('sp_TicketsByCategory');

DECLARE @name SYSNAME, @sql NVARCHAR(MAX);
DECLARE @oldPred NVARCHAR(200) = 't.AssignedTo = @UserId OR t.CreatedBy = @UserId';
DECLARE @newPred NVARCHAR(200) = 't.AssignedTo = @UserId OR (t.CreatedBy = @UserId AND t.AssignedTo IS NULL)';
-- sp_Dashboard only: the RS5 Calls subquery's `bt`-aliased copy of the predicate.
DECLARE @oldBt   NVARCHAR(200) = 'bt.AssignedTo = @UserId OR bt.CreatedBy = @UserId';
DECLARE @newBt   NVARCHAR(200) = 'bt.AssignedTo = @UserId OR (bt.CreatedBy = @UserId AND bt.AssignedTo IS NULL)';

DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM @procs;
OPEN c;
FETCH NEXT FROM c INTO @name;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = OBJECT_DEFINITION(OBJECT_ID('dbo.' + @name));

    IF @sql IS NULL
        RAISERROR('128: %s not found', 16, 1, @name);
    ELSE IF CHARINDEX(@newPred, @sql) > 0
        PRINT '128: ' + @name + ' already patched, skipping';
    ELSE IF CHARINDEX(@oldPred, @sql) = 0
        RAISERROR('128: anchor not found in %s', 16, 1, @name);
    ELSE IF @name = 'sp_Dashboard' AND CHARINDEX(@oldBt, @sql) = 0
        RAISERROR('128: bt anchor not found in %s', 16, 1, @name);
    ELSE
    BEGIN
        SET @sql = REPLACE(@sql, 'CREATE   PROC dbo.' + @name, 'CREATE OR ALTER PROC dbo.' + @name);
        SET @sql = REPLACE(@sql, @oldPred, @newPred);
        -- sp_Dashboard's second (Calls subquery) ticket predicate; a no-op for
        -- the other three procs, which never contain the bt-aliased copy.
        IF @name = 'sp_Dashboard'
            SET @sql = REPLACE(@sql, @oldBt, @newBt);
        EXEC sys.sp_executesql @sql;
        PRINT '128: patched ' + @name;
    END

    FETCH NEXT FROM c INTO @name;
END
CLOSE c;
DEALLOCATE c;
GO

-- ===========================================================================
-- Verify after apply (expect NewClause = 4, OldOnly = 0, BtNew = 1, BtOld = 0):
--
-- SELECT
--   SUM(CASE WHEN m.definition LIKE '%t.CreatedBy = @UserId AND t.AssignedTo IS NULL%' THEN 1 ELSE 0 END) AS NewClause,
--   SUM(CASE WHEN m.definition LIKE '%t.AssignedTo = @UserId OR t.CreatedBy = @UserId)%'
--             AND m.definition NOT LIKE '%t.CreatedBy = @UserId AND t.AssignedTo IS NULL%' THEN 1 ELSE 0 END) AS OldOnly,
--   SUM(CASE WHEN m.definition LIKE '%bt.CreatedBy = @UserId AND bt.AssignedTo IS NULL%' THEN 1 ELSE 0 END) AS BtNew,
--   SUM(CASE WHEN m.definition LIKE '%bt.AssignedTo = @UserId OR bt.CreatedBy = @UserId)%'
--             AND m.definition NOT LIKE '%bt.CreatedBy = @UserId AND bt.AssignedTo IS NULL%' THEN 1 ELSE 0 END) AS BtOld
-- FROM sys.sql_modules m
-- JOIN sys.objects o ON o.object_id = m.object_id
-- WHERE o.name IN ('sp_FetchTickets','sp_Dashboard','sp_ResolutionSummary','sp_TicketsByCategory');
--
-- Behaviour check on the list: as a Self-reach user, create a complaint, then
-- have a manager transfer it to someone else. It must disappear from your
-- list/detail, stay visible to the new assignee, and stay visible to the
-- manager by reach. While it is still unassigned (or assigned to you) it stays
-- yours.
-- ===========================================================================
