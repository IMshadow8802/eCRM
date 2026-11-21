-- ===========================================================================
-- 129 - access leaks, ship-ahead (access-model review F1 + F3).
--
-- Apply by hand with sqlcmd -I (QUOTED_IDENTIFIER ON), CLAUDE.md 0.2.
-- Order of databases: TestCRM, then eCRM+, SolarCRM, OSG.
--
-- F1  dbo.sp_FetchFollowUps (the Follow-ups page, paged mode)
--     The visibility arm ORed `f.AssignedTo = @UserId` in ANY state. But
--     sp_TransferLead re-points only OPEN follow-ups, so a lead's previous
--     owner kept seeing name / company / mobile / owner / status through its
--     done and cancelled follow-ups (eCRM+: 8 users, 193 rows, 69 leads).
--     Now: the lead is visible (reach, owner = me, creator while unowned), OR
--     the follow-up is OPEN and assigned to me (delegated work). Count and page
--     come from the same WHERE (COUNT(*) OVER ()), so totals stay consistent.
--     The per-lead mode (@LeadId > 0) is untouched: Node gates it on the lead.
--     Anchor (once in the proc):  `OR f.AssignedTo = @UserId))`
--
-- F3  dbo.sp_FetchCustomerDetail RS2 (the customer's complaints list)
--     Same narrowing as script 128 applied to the other complaint procs: the
--     creator keeps a complaint only while it is unassigned.
--     Anchor (once in the proc):  `t.AssignedTo = @UserId OR t.CreatedBy = @UserId`
--
-- Verified 2026-11-21 (read-only): each anchor occurs exactly once in its proc,
-- the header is stored as `CREATE   PROC dbo.<name>`, and both procs have the
-- same text on TestCRM, eCRM+, SolarCRM and OSG.
--
-- Each proc is patched from its own live text (OBJECT_DEFINITION): header
-- CREATE   PROC -> CREATE OR ALTER PROC, then the one anchored REPLACE.
-- Idempotent: a proc already carrying the new clause is skipped; a missing
-- proc or anchor raises instead of silently doing nothing.
--
-- sqlcmd splits on GO even inside comments, so every note here is a `--` line
-- comment; the live proc bodies travel as a string value in @sql.
-- ===========================================================================
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

DECLARE @p TABLE (name SYSNAME, oldTxt NVARCHAR(200), newTxt NVARCHAR(200));
INSERT INTO @p (name, oldTxt, newTxt) VALUES
    ('sp_FetchFollowUps',
     'OR f.AssignedTo = @UserId))',
     'OR (f.AssignedTo = @UserId AND f.Status = ''open'')))'),
    ('sp_FetchCustomerDetail',
     't.AssignedTo = @UserId OR t.CreatedBy = @UserId',
     't.AssignedTo = @UserId OR (t.CreatedBy = @UserId AND t.AssignedTo IS NULL)');

DECLARE @name SYSNAME, @old NVARCHAR(200), @new NVARCHAR(200), @sql NVARCHAR(MAX);
DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT name, oldTxt, newTxt FROM @p;
OPEN c;
FETCH NEXT FROM c INTO @name, @old, @new;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = OBJECT_DEFINITION(OBJECT_ID('dbo.' + @name));

    IF @sql IS NULL
        RAISERROR('129: %s not found', 16, 1, @name);
    ELSE IF CHARINDEX(@new, @sql) > 0
        PRINT '129: ' + @name + ' already patched, skipping';
    ELSE IF CHARINDEX(@old, @sql) = 0
        RAISERROR('129: anchor not found in %s', 16, 1, @name);
    ELSE IF CHARINDEX('CREATE   PROC dbo.' + @name, @sql) = 0
        RAISERROR('129: header not found in %s', 16, 1, @name);
    ELSE
    BEGIN
        SET @sql = REPLACE(@sql, 'CREATE   PROC dbo.' + @name, 'CREATE OR ALTER PROC dbo.' + @name);
        SET @sql = REPLACE(@sql, @old, @new);
        EXEC sys.sp_executesql @sql;
        PRINT '129: patched ' + @name;
    END

    FETCH NEXT FROM c INTO @name, @old, @new;
END
CLOSE c;
DEALLOCATE c;
GO

-- ===========================================================================
-- Verify after apply (expect FuNew = 1, FuOld = 0, CdNew = 1, CdOld = 0):
--
-- SELECT
--   SUM(CASE WHEN o.name = 'sp_FetchFollowUps' AND m.definition LIKE '%(f.AssignedTo = @UserId AND f.Status = ''open'')%' THEN 1 ELSE 0 END) AS FuNew,
--   SUM(CASE WHEN o.name = 'sp_FetchFollowUps' AND m.definition LIKE '%OR f.AssignedTo = @UserId))%' THEN 1 ELSE 0 END) AS FuOld,
--   SUM(CASE WHEN o.name = 'sp_FetchCustomerDetail' AND m.definition LIKE '%t.CreatedBy = @UserId AND t.AssignedTo IS NULL%' THEN 1 ELSE 0 END) AS CdNew,
--   SUM(CASE WHEN o.name = 'sp_FetchCustomerDetail' AND m.definition LIKE '%t.AssignedTo = @UserId OR t.CreatedBy = @UserId)%' THEN 1 ELSE 0 END) AS CdOld
-- FROM sys.sql_modules m
-- JOIN sys.objects o ON o.object_id = m.object_id
-- WHERE o.name IN ('sp_FetchFollowUps', 'sp_FetchCustomerDetail');
--
-- F1 data check (eCRM+ before apply: 193 rows / 8 users / 69 leads; after: 0).
-- Done/cancelled follow-ups assigned to someone on a lead they no longer hold
-- and do not see by reach: run the Follow-ups page (All, no filters) as one of
-- those Own-reach users; none of those rows may appear, and the page total
-- must equal the rows paged through. Open follow-ups delegated to them still
-- show.
--
-- F3 behaviour check: as a Self-reach user, log a complaint for a customer you
-- can see, have a manager transfer it to someone else, open the customer page:
-- the complaint is gone from its list (it stays while unassigned or yours).
-- ===========================================================================
