-- ===========================================================================
-- 143 - findings from the SolarTest access-model run (2026-11-23,
--       scratchpad solartest-report.md: the app bug + "things that read wrong").
--
-- Apply by hand, TestCRM FIRST, then SolarTest / SolarCRM / eCRM+ once checked:
--   sqlcmd -I -b -f 65001 -S <server> -U <login> -d TestCRM -i 143_solartest_findings.sql
--   -I = QUOTED_IDENTIFIER ON (093 lesson), -b = stop at the first error,
--   -f 65001 = read the file as UTF-8. Needs 130-134 and 139 on the same database.
--   Idempotent: fn_ReportTree is CREATE OR ALTER, every procedure patch is
--   skipped when its marker is already in the live text, so a re-run changes
--   nothing. No server deploy is needed for the SQL to work; the clients of
--   this branch also stop offering the reason (web modals, mobile AssignSheet).
--
-- What changes:
--   F1  A reassign may not carry the `sent_back` transfer reason. Only a send
--       back (@SendBack = 1) writes it, and fn_RecordGiver skips rows with it,
--       so a hand-picked "Sent back" hid the giver from the next person's
--       "Send back to ...". sp_TransferTicket / sp_TransferLead (normal path)
--       and sp_BulkTransferTickets / sp_BulkTransferLeads (no send-back path)
--       answer 400 'Choose another reason. Sent back is set only by the Send
--       back button.' The send-back path picks the reason itself and is
--       untouched. The controllers relay the 400 as-is (runSp).
--   F2  fn_ReportTree keeps only people who belong in a sales report: the
--       caller, anyone holding leads View in an active group (admin included),
--       anyone with sales history (owns a lead / has a lead follow-up assigned
--       or done / logged a call on a lead), and the managers connecting them
--       to a root. Support staff with no sales history no longer appear as
--       zero rows in the Team report. History is "ever", a superset of every
--       PersonId fn_SalesReportRows can credit in any period, so no row is
--       dropped and every number (sp_RptSales, sp_RptSalesRows, sp_Dashboard's
--       lead calls) stays exactly what it was; cell == drill holds as before.
--       Readers of fn_ReportTree: fn_SalesReportRows, sp_RptSales,
--       sp_RptSalesRows, sp_Dashboard (checked 2026-11-23); none changes.
--
-- How: fn_ReportTree is written out whole (its live 131 text plus step 3b).
-- The four procedures are PATCHED in their live text (the 139 pattern): each
-- patch names one anchor that must occur exactly once and a marker only the
-- patched text contains; a patch whose marker is present is skipped; a
-- missing / repeated anchor stops the run with nothing patched (all patches
-- run in one transaction).
--
-- ROLLBACK (135): the five objects were already saved by 131 / 133 (their
-- pre-130 text), and the saves below are no-ops there (first save wins), so:
--   135 -v From=130 or 131 -> undoes 143 too (each object comes back from its
--       131 / 133 save).
--   135 -v From=134        -> 143 stays (it is not part of 134).
-- After a partial rollback re-apply 130-134, 139, 140 AND 143.
--
-- sqlcmd splits on GO even inside comments: every note is a `--` line comment.
-- ===========================================================================
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- ---------------------------------------------------------------------------
-- 1. Refuse unless 130-134 and 139 are applied.
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.sp_AccessModelBackup', 'P') IS NULL
   OR OBJECT_ID('dbo.fn_ReassignGate') IS NULL
   OR OBJECT_ID('dbo.fn_AccessScope') IS NULL
   OR OBJECT_ID('dbo.sp_LoggerMayAttach', 'P') IS NULL
   OR CHARINDEX('fn_ReassignGate', ISNULL(OBJECT_DEFINITION(OBJECT_ID('dbo.sp_TransferTicket')), '')) = 0
BEGIN
    RAISERROR('143: scripts 130-134 and 139 are not applied to this database. Apply them first. Nothing was changed.', 16, 1);
    SET NOEXEC ON;
END
GO

-- ---------------------------------------------------------------------------
-- 2. Backups (first save wins: already saved by 131 / 133, so no-ops there;
--    kept so the file stands on its own).
-- ---------------------------------------------------------------------------
EXEC dbo.sp_AccessModelBackup 131, 'fn_ReportTree';
EXEC dbo.sp_AccessModelBackup 133, 'sp_TransferTicket';
EXEC dbo.sp_AccessModelBackup 133, 'sp_BulkTransferTickets';
EXEC dbo.sp_AccessModelBackup 133, 'sp_TransferLead';
EXEC dbo.sp_AccessModelBackup 133, 'sp_BulkTransferLeads';
GO

-- ---------------------------------------------------------------------------
-- 3. fn_ReportTree (F2). The 131 body (steps 1-4 unchanged) plus step 3b.
--    In view comes from the caller's leads scope: Own -> self; Team -> self +
--    people; Office / OfficeTree -> self + people + people based in those
--    offices; Company -> everyone in the company. No leads View / NULL
--    caller: no rows. 143: then only the people who belong in a sales report
--    (step 3b), so the forest stays connected and every count is unchanged.
-- ---------------------------------------------------------------------------
CREATE OR ALTER FUNCTION dbo.fn_ReportTree
(
    @CompId BIGINT,
    @UserId INT
)
RETURNS @T TABLE
(
    AncestorId INT NOT NULL,
    PersonId   INT NOT NULL,
    ChildId    INT NOT NULL,
    Depth      INT NOT NULL,
    NoManager  BIT NOT NULL,
    PRIMARY KEY (AncestorId, PersonId)
)
AS
BEGIN
    DECLARE @Lvl TINYINT;
    SELECT @Lvl = ISNULL(ReachLevel, 1) FROM dbo.fn_AccessScope(@CompId, @UserId, 'leads');
    IF @Lvl IS NULL RETURN;

    DECLARE @P TABLE (UserId INT NOT NULL PRIMARY KEY);
    DECLARE @O TABLE (BranchId BIGINT NOT NULL PRIMARY KEY, Level TINYINT NOT NULL);
    IF @Lvl BETWEEN 2 AND 4 INSERT INTO @P (UserId) SELECT UserId FROM dbo.fn_AccessPeople(@CompId, @UserId);
    IF @Lvl IN (3, 4)       INSERT INTO @O (BranchId, Level) SELECT BranchId, Level FROM dbo.fn_AccessOffices(@CompId, @UserId);

    DECLARE @V TABLE (Id INT PRIMARY KEY, RawMgr INT NULL, Mgr INT NULL, Lvl INT NULL, NoManager BIT NOT NULL);

    -- 1. in view
    INSERT INTO @V (Id, RawMgr, NoManager)
    SELECT u.Id, u.ReportsTo,
           CASE WHEN u.ReportsTo IS NULL OR u.ReportsTo = u.Id THEN 1 ELSE 0 END
    FROM dbo.tblUser u
    WHERE u.CompId = @CompId
      AND (   u.Id = @UserId
           OR @Lvl = 5
           OR EXISTS (SELECT 1 FROM @P p WHERE p.UserId = u.Id)
           OR EXISTS (SELECT 1 FROM @O o WHERE o.BranchId = u.BranchId AND (o.Level = 3 OR @Lvl = 4)));

    -- 2. manager in view (the caller is always a root)
    UPDATE v SET Mgr = v.RawMgr
    FROM @V v
    WHERE v.RawMgr <> v.Id
      AND v.Id <> @UserId
      AND EXISTS (SELECT 1 FROM @V m WHERE m.Id = v.RawMgr);

    -- 3. walk from the roots; cut loops
    -- ponytail: depth capped at 50 levels; anyone deeper is cut like a loop member.
    UPDATE @V SET Lvl = 0 WHERE Mgr IS NULL;
    DECLARE @lvlN INT, @n INT, @cut INT;
    DECLARE @C TABLE (Id INT PRIMARY KEY, Mgr INT NULL);
    WHILE 1 = 1
    BEGIN
        SET @lvlN = 0; SET @n = 1;
        WHILE @n > 0 AND @lvlN < 50
        BEGIN
            UPDATE c SET Lvl = @lvlN + 1
            FROM @V c JOIN @V p ON p.Id = c.Mgr
            WHERE c.Lvl IS NULL AND p.Lvl = @lvlN;
            SET @n = @@ROWCOUNT;
            SET @lvlN += 1;
        END

        IF NOT EXISTS (SELECT 1 FROM @V WHERE Lvl IS NULL) BREAK;

        -- the loop members: prune unreached people nobody unreached reports to
        DELETE FROM @C;
        INSERT INTO @C (Id, Mgr) SELECT Id, Mgr FROM @V WHERE Lvl IS NULL;
        SET @n = 1;
        WHILE @n > 0
        BEGIN
            DELETE c FROM @C c WHERE NOT EXISTS (SELECT 1 FROM @C k WHERE k.Mgr = c.Id);
            SET @n = @@ROWCOUNT;
        END
        SELECT @cut = MIN(Id) FROM @C;
        IF @cut IS NULL SELECT @cut = MIN(Id) FROM @V WHERE Lvl IS NULL;   -- deeper than 50, no loop

        UPDATE @V SET Mgr = NULL, NoManager = 1, Lvl = 0 WHERE Id = @cut;
    END;

    -- 3b. (143) only people who belong in a sales report: the caller (always a
    --     root), anyone holding leads View through an active group (an admin group
    --     counts), anyone with sales history, and the managers that connect them to
    --     a root. History = owns a lead, or has a lead follow-up assigned / done, or
    --     logged a call on a lead: every PersonId fn_SalesReportRows can credit, in
    --     any period, so nobody who has a row is ever dropped and every count stays
    --     as it was. Support staff with no sales history disappear (SolarTest
    --     2026-11-23: zero rows beside the sales team).
    DECLARE @H TABLE (Id INT PRIMARY KEY);
    INSERT INTO @H (Id)
    SELECT OwnerId    FROM dbo.tblLeads    WHERE CompId = @CompId AND OwnerId    IS NOT NULL
    UNION SELECT AssignedTo FROM dbo.tblFollowUp WHERE CompId = @CompId AND AssignedTo IS NOT NULL
    UNION SELECT DoneBy     FROM dbo.tblFollowUp WHERE CompId = @CompId AND DoneBy     IS NOT NULL
    UNION SELECT UserId     FROM dbo.tblCall     WHERE CompId = @CompId AND LeadId     IS NOT NULL;

    DECLARE @K TABLE (Id INT PRIMARY KEY);
    INSERT INTO @K (Id)
    SELECT v.Id
    FROM @V v
    WHERE v.Id = @UserId
       OR EXISTS (SELECT 1 FROM @H h WHERE h.Id = v.Id)
       OR EXISTS (SELECT 1
                  FROM dbo.tblUser u
                  JOIN dbo.tblUserGroupMap m ON m.UserId = u.Id
                  JOIN dbo.tblUserGroups g   ON g.Id = m.GroupId AND g.IsActive = 1 AND g.CompId = @CompId
                  WHERE u.Id = v.Id AND u.CompId = @CompId AND u.IsActive = 1
                    AND (   g.IsAdmin = 1
                         OR EXISTS (SELECT 1 FROM dbo.tblGroupModule gm
                                    WHERE gm.GroupId = g.Id AND gm.Module = 'leads' AND gm.CanView = 1)));

    -- the managers on the way up (the kept edges of step 3; loops are already cut)
    SET @n = 1;
    WHILE @n > 0
    BEGIN
        INSERT INTO @K (Id)
        SELECT DISTINCT v.Mgr
        FROM @V v JOIN @K k ON k.Id = v.Id
        WHERE v.Mgr IS NOT NULL AND NOT EXISTS (SELECT 1 FROM @K x WHERE x.Id = v.Mgr);
        SET @n = @@ROWCOUNT;
    END
    DELETE v FROM @V v WHERE NOT EXISTS (SELECT 1 FROM @K k WHERE k.Id = v.Id);

    -- 4. output: self rows + every ancestor through the kept edges (a forest now)
    WITH A AS
    (
        SELECT v.Id AS PersonId, v.Mgr AS AncestorId, v.Id AS ChildId, 1 AS Depth
        FROM @V v WHERE v.Mgr IS NOT NULL
        UNION ALL
        SELECT a.PersonId, p.Mgr, a.AncestorId, a.Depth + 1
        FROM A a JOIN @V p ON p.Id = a.AncestorId
        WHERE p.Mgr IS NOT NULL
    )
    INSERT INTO @T (AncestorId, PersonId, ChildId, Depth, NoManager)
    SELECT v.Id, v.Id, v.Id, 0, v.NoManager FROM @V v
    UNION ALL
    SELECT a.AncestorId, a.PersonId, a.ChildId, a.Depth, v.NoManager
    FROM A a JOIN @V v ON v.Id = a.PersonId;

    RETURN;
END
GO

-- ---------------------------------------------------------------------------
-- 4. Patches to the live transfer procedures (F1), all or nothing.
-- ---------------------------------------------------------------------------
SET XACT_ABORT ON;
DECLARE @nl NCHAR(1) = NCHAR(10);
DECLARE @anchor NVARCHAR(400) = N'BEGIN SELECT @Code = 400, @Mess = ''A transfer reason is required''; GOTO Answer; END';
DECLARE @refuse NVARCHAR(400) =
      N'/* 143: no hand-picked sent_back - only a send back writes it (fn_RecordGiver skips it) */';
DECLARE @check NVARCHAR(400) =
      N'IF EXISTS (SELECT 1 FROM dbo.tblLookup WHERE Id = @ReasonId AND Code = ''sent_back'')';
DECLARE @answer NVARCHAR(400) =
      N'BEGIN SELECT @Code = 400, @Mess = ''Choose another reason. Sent back is set only by the Send back button.''; GOTO Answer; END';
DECLARE @patch TABLE (Seq INT PRIMARY KEY, ProcName SYSNAME, Marker NVARCHAR(200), Anchor NVARCHAR(400), Repl NVARCHAR(MAX));
-- The single procedures check the reason inside their ELSE (not a send back),
-- indented 8; the bulk ones have no send back, indented 4.
INSERT INTO @patch (Seq, ProcName, Marker, Anchor, Repl) VALUES
(1, N'sp_TransferTicket',      N'/* 143: no hand-picked sent_back', @anchor,
    @anchor + @nl + N'        ' + @refuse + @nl + N'        ' + @check + @nl + N'        ' + @answer),
(2, N'sp_TransferLead',        N'/* 143: no hand-picked sent_back', @anchor,
    @anchor + @nl + N'        ' + @refuse + @nl + N'        ' + @check + @nl + N'        ' + @answer),
(3, N'sp_BulkTransferTickets', N'/* 143: no hand-picked sent_back', @anchor,
    @anchor + @nl + N'    ' + @refuse + @nl + N'    ' + @check + @nl + N'    ' + @answer),
(4, N'sp_BulkTransferLeads',   N'/* 143: no hand-picked sent_back', @anchor,
    @anchor + @nl + N'    ' + @refuse + @nl + N'    ' + @check + @nl + N'    ' + @answer);

DECLARE @seq INT = 1, @max INT = (SELECT MAX(Seq) FROM @patch),
        @p SYSNAME, @marker NVARCHAR(200), @a NVARCHAR(400), @r NVARCHAR(MAX),
        @def NVARCHAR(MAX), @hdr NVARCHAR(300), @h INT, @k INT, @msg NVARCHAR(2048);

BEGIN TRY
    BEGIN TRAN;
    WHILE @seq <= @max
    BEGIN
        SELECT @p = ProcName, @marker = Marker, @a = Anchor, @r = Repl FROM @patch WHERE Seq = @seq;
        SET @def = OBJECT_DEFINITION(OBJECT_ID(N'dbo.' + @p));
        IF @def IS NULL
        BEGIN SET @msg = N'143: dbo.' + @p + N' not found'; THROW 50143, @msg, 1; END

        IF CHARINDEX(@marker, @def) > 0
            PRINT N'143: patch ' + CAST(@seq AS NVARCHAR(5)) + N' already in ' + @p + N', skipped';
        ELSE
        BEGIN
            IF (DATALENGTH(@def) - DATALENGTH(REPLACE(@def, @a, N''))) / DATALENGTH(@a) <> 1
            BEGIN
                SET @msg = N'143: patch ' + CAST(@seq AS NVARCHAR(5)) + N': anchor not found exactly once in live dbo.' + @p
                         + N' - nothing patched; diff its OBJECT_DEFINITION';
                THROW 50143, @msg, 1;
            END
            SET @hdr = N'PROC dbo.' + @p;
            IF (DATALENGTH(@def) - DATALENGTH(REPLACE(@def, @hdr, N''))) / DATALENGTH(@hdr) <> 1
            BEGIN
                SET @msg = N'143: header "' + @hdr + N'" not found exactly once - nothing patched';
                THROW 50143, @msg, 1;
            END

            SET @def = REPLACE(@def, @a, @r);
            -- The stored header reads "CREATE PROC" or "CREATE OR ALTER PROC"
            -- (spacing as typed); either becomes CREATE OR ALTER.
            SET @h = CHARINDEX(@hdr, @def);
            SET @k = @h - 1;
            WHILE @k > 0 AND SUBSTRING(@def, @k, 1) IN (N' ', NCHAR(9), NCHAR(10), NCHAR(13)) SET @k -= 1;
            IF @k >= 5 AND SUBSTRING(@def, @k - 4, 5) = N'ALTER'
            BEGIN
                SET @k -= 5;
                WHILE @k > 0 AND SUBSTRING(@def, @k, 1) IN (N' ', NCHAR(9), NCHAR(10), NCHAR(13)) SET @k -= 1;
                IF @k < 2 OR SUBSTRING(@def, @k - 1, 2) <> N'OR'
                BEGIN SET @msg = N'143: unreadable header in dbo.' + @p + N' - nothing patched'; THROW 50143, @msg, 1; END
                SET @k -= 2;
                WHILE @k > 0 AND SUBSTRING(@def, @k, 1) IN (N' ', NCHAR(9), NCHAR(10), NCHAR(13)) SET @k -= 1;
            END
            IF @k < 6 OR SUBSTRING(@def, @k - 5, 6) <> N'CREATE'
            BEGIN SET @msg = N'143: no CREATE before "' + @hdr + N'" - nothing patched'; THROW 50143, @msg, 1; END
            SET @def = STUFF(@def, @k - 5, @h - (@k - 5), N'CREATE OR ALTER ');

            EXEC (@def);
            PRINT N'143: patch ' + CAST(@seq AS NVARCHAR(5)) + N' applied to ' + @p;
        END
        SET @seq += 1;
    END
    COMMIT;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    PRINT N'143: FAILED - no procedure was patched (section 3, fn_ReportTree, is in place; re-run after fixing).';
    THROW;
END CATCH
GO

SET NOEXEC OFF;
GO

-- ===========================================================================
-- VERIFY AFTER APPLY (read-only; expected answer after each query).
-- ===========================================================================
-- 1. Every patch is in -> 4 rows, Applied = 1
-- SELECT v.ProcName,
--        CASE WHEN CHARINDEX('/* 143: no hand-picked sent_back', OBJECT_DEFINITION(OBJECT_ID('dbo.' + v.ProcName))) > 0
--             THEN 1 ELSE 0 END AS Applied
-- FROM (VALUES ('sp_TransferTicket'), ('sp_TransferLead'), ('sp_BulkTransferTickets'), ('sp_BulkTransferLeads')) v (ProcName);
--
-- 2. fn_ReportTree has step 3b -> 1
-- SELECT CASE WHEN CHARINDEX('3b. (143)', OBJECT_DEFINITION(OBJECT_ID('dbo.fn_ReportTree'))) > 0 THEN 1 ELSE 0 END;
--
-- 3. Saves for rollback unchanged -> 5 rows, ScriptNo 131 / 133, HasText 1, SavedAt before today
-- SELECT ObjName, ScriptNo, CASE WHEN Definition IS NULL THEN 0 ELSE 1 END AS HasText, SavedAt
-- FROM dbo.tblAccessModelBackup
-- WHERE ObjName IN ('fn_ReportTree', 'sp_TransferTicket', 'sp_BulkTransferTickets', 'sp_TransferLead', 'sp_BulkTransferLeads');
--
-- 4. F1, a hand-picked Sent back is refused (any in-progress complaint the
--    caller may reassign, @t; @to on their Can-assign-to list; @sb = the
--    company's sent_back reason id) -> ResponseCode 400 'Choose another reason. ...'
--    and nothing written. On TestCRM only:
-- DECLARE @sb INT = (SELECT TOP 1 Id FROM dbo.tblLookup WHERE CompId = 1 AND Kind = 'transfer_reason' AND Code = 'sent_back');
-- EXEC dbo.sp_TransferTicket @CompId = 1, @TicketId = @t, @ToUserId = @to, @ReasonId = @sb, @Remarks = N'x', @UserId = @me;
-- EXEC dbo.sp_TransferLead   @CompId = 1, @LeadId   = @l, @ToUserId = @to, @ReasonId = @sb, @Remarks = N'x', @UserId = @me;
-- EXEC dbo.sp_BulkTransferTickets @CompId = 1, @TicketIdsJson = N'[<t>]', @ToUserId = @to, @ReasonId = @sb, @Remarks = N'x', @UserId = @me;
-- EXEC dbo.sp_BulkTransferLeads   @CompId = 1, @LeadIdsJson   = N'[<l>]', @ToUserId = @to, @ReasonId = @sb, @Remarks = N'x', @UserId = @me;
--    and the send back still works (a record given to @me by someone): -> 200 'Complaint sent back'
-- EXEC dbo.sp_TransferTicket @CompId = 1, @TicketId = @given, @ReasonId = NULL, @Remarks = N'not mine', @UserId = @me, @SendBack = 1;
--
-- 5. F2, support staff gone from the Team report (SolarTest, Amit = 2, CompId 1)
--    -> Amit, Neha Yadav and her seven; no Nitin Kumar, Prasant, ROHIT GAUR,
--    Vinod Kumar, Vivek Kumar (none holds leads View or has sales history)
-- SELECT t.PersonId, u.FullName FROM dbo.fn_ReportTree(1, 2) t JOIN dbo.tblUser u ON u.Id = t.PersonId WHERE t.Depth = 0;
--
-- 6. F2, every number unchanged: run this BEFORE applying 143 and again AFTER,
--    for a manager and an admin -> identical output both times
-- SELECT Metric, COUNT(*) AS N, SUM(ISNULL(Amount, 0)) AS Amount
-- FROM dbo.fn_SalesReportRows(1, '2000-01-01', '2100-01-01', @u) GROUP BY Metric ORDER BY Metric;
-- EXEC dbo.sp_Dashboard @CompId = 1, @UserId = @u;   -- the KPI rows (RS0) match
-- ===========================================================================
