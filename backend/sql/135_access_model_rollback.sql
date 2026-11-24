-- ===========================================================================
-- 135 - access model: the ONE rollback for scripts 130-134 (plan Ruling 2,
--       review N1b; plan 2026-11-22-access-model Task 7; pre-flight S1).
--
-- Apply by hand, choosing how far back with -v From=13x:
--   sqlcmd -I -b -f 65001 ... -v From=130 -i 135_access_model_rollback.sql
--   -I = QUOTED_IDENTIFIER ON (093 lesson), -b = stop at the first error,
--   -f 65001 = read the file as UTF-8. A refusal also SETs NOEXEC ON.
--   From=130  everything: the database is as it was before 130.
--   From=131  131-134 undone; 130's columns, rows and tables stay (the old
--             server works on them, plan Ruling 1).
--   From=134  only 134 undone (sp_LeadsUserWise / sp_ConvertedSummary back
--             where they still compile, see step 7).
--   From=132  REFUSED: the old sp_RptSales / sp_RptSalesRows call the 4-param
--             fn_ReportTree that only a 131 rollback brings back. Use 131.
--   From=133  REFUSED: no server image runs on it (the new server needs 133's
--             writers and sp_FetchTicketEscalationTargets; the old one cannot
--             run 132's reads; old sp_SaveTicket / sp_SaveLead never set
--             LoggerHolds = 1). Use 131.
-- AFTER A PARTIAL ROLLBACK (From=131 or 134) RE-RUN 130 (IT RETAKES THE
-- SNAPSHOT) BEFORE 131-134: 135 empties tblAccessModelSnapshot, because 130
-- only takes it while empty and 134 would otherwise compare against the old
-- one (records created meanwhile would land in `other`); 134 refuses while
-- the snapshot is empty.
--
-- AFTER A ROLLBACK OF 130 OR 131 THE OLD SERVER IMAGE MUST BE RUNNING FOR THAT
-- COMPANY (the command is in plan Task 33). The new server cannot run on the
-- old procedures. The rollback is rehearsed on TestCRM at Gate G1:
-- apply 130-134, run 135 -v From=130, compare with the pre-130 capture below
-- (no difference apart from 134's dead procedures, see step 7), then apply
-- 130-134 again.
--
-- How it works (steps 1-6 in ONE transaction; any error rolls them all back;
-- step 7 runs after the commit):
--   1. Refuse unless From is 130 / 131 / 134 and tblAccessModelBackup
--      exists (130 applied, not yet rolled back).
--   2. From <= 133: drop CK_tblTicket_LoggerHolds / CK_tblLeads_LoggerHolds
--      (pseudo-row #ck_loggerholds_133).
--   3. Every backup row with ScriptNo >= From (except 134's, step 7) and
--      Definition NOT NULL is put
--      back from its saved text: FUNCTIONS first, oldest script first, then
--      PROCEDURES oldest first (pre-flight S1: the old report procs need the
--      old fn_ReportTree in place before they compile). The object is dropped
--      and the saved text EXECuted verbatim, so OBJECT_DEFINITION afterwards
--      is byte-identical to the save; the run checks that with SHA2_256 and
--      refuses to commit on any mismatch. (Drop + create rather than a header
--      rewrite: saved texts start with comments that can contain the word
--      CREATE; none of these objects carries an explicit GRANT, checked on
--      TestCRM 2026-11-22.)
--   4. Every backup row with ScriptNo >= From and Definition NULL (the object
--      did not exist before) is dropped: procedures first, then functions,
--      newest script first. Today: fn_AccessGrants, fn_AccessScope,
--      fn_AccessPeople, fn_AccessOffices, fn_RecordGiver, fn_VisibleLeads,
--      fn_VisibleTickets, fn_VisibleFollowUps, fn_AssignableUsers,
--      fn_RecordActions, fn_StrandedWork, sp_NotifyStranded (131),
--      sp_FetchLoggedByMe (132), fn_CompanyOffice, fn_ReassignGate,
--      sp_FetchTicketEscalationTargets (133); 134 creates nothing.
--      139 (review fixes) files its saves under ScriptNo 133, so it is
--      undone with From=130/131 (sp_LoggerMayAttach dropped here,
--      sp_SetLeadStatus restored in step 3 from 139's save = its pre-130
--      text; fn_RecordActions and the patched procedures come back from
--      their 131-133 saves) and kept with From=134. After a partial
--      rollback re-apply 130-134 AND 139.
--      Pseudo-rows (ObjName LIKE '#%') are never EXECuted or dropped.
--   5. From >= 131: the backup rows of the undone scripts are deleted, so
--      re-applying a script saves the then-live text again (first save
--      wins), and tblAccessModelSnapshot is emptied (re-run 130 first).
--   6. From = 130 only, from 130's pseudo-rows:
--      #escalation_n3          the cleared escalations are put back (only
--                              where EscalatedTo is still empty).
--      #label_sent_back        'Sent back' -> the saved old text, only where
--                              the label still reads 'Sent back'.
--      #role_support_team_lead each group 130 inserted is removed (module rows
--                              first, then the group) only when it has no
--                              members and no tblGroupAccess rows; otherwise it
--                              is listed and kept.
--      then CK_tblGroupModule_AssignReach + AssignReach, DF_tblTicket_LoggerHolds
--      + tblTicket.LoggerHolds, DF_tblLeads_LoggerHolds + tblLeads.LoggerHolds,
--      tblAccessModelSnapshot, sp_AccessModelBackup, tblAccessModelBackup.
--   7. After the commit, best effort: the two dead procedures 134 drops
--      (ScriptNo = 134: sp_LeadsUserWise, sp_ConvertedSummary). Their saved
--      texts reference columns removed long ago (tblLeads.AssignTo, LeadDate,
--      LeadStatus, InvoiceDate) and a missing COLUMN is not deferred, so on
--      today's schema they do not compile (G1 on TestCRM, 2026-11-22: Msg 207
--      rolled the whole run back). Each is EXECuted from its saved text in its
--      own TRY/CATCH with XACT_ABORT OFF and no open transaction: on success the
--      hash is checked as in step 3; on failure the run prints
--      "135: <name> not restored ..." and goes on, leaving it dropped. The
--      texts are read before step 5/6 removes their rows; the rows go by the
--      same rule as every other row (deleted with From >= 131, the table
--      dropped with From = 130), restored or not - dead objects, not worth
--      keeping a save for.
-- Not undone: notifications the new procedures wrote stay; data the new
-- procedures wrote (assignments, history rows) stays - it is ordinary data.
-- The rule: first save wins, so an object two scripts altered keeps the text
-- from before the first one; 130-134 alter no object twice (checked).
--
-- G1 pre-130 capture: run BEFORE 130 and AFTER 135 -v From=130; save both
-- outputs; they must be identical except the first query may lack
-- P sp_ConvertedSummary and P sp_LeadsUserWise (step 7: dead, left dropped;
-- on TestCRM both are, so the diff is exactly those two lines).
-- SELECT o.type, o.name, CONVERT(VARCHAR(66), HASHBYTES('SHA2_256', m.definition), 1) AS DefHash
-- FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
-- ORDER BY o.name;
-- SELECT OBJECT_NAME(c.object_id) AS Tbl, c.name, c.column_id FROM sys.columns c
-- WHERE c.object_id IN (OBJECT_ID('dbo.tblGroupModule'), OBJECT_ID('dbo.tblTicket'), OBJECT_ID('dbo.tblLeads'))
-- ORDER BY Tbl, c.column_id;
-- SELECT name FROM sys.objects WHERE type IN ('C', 'D', 'U') ORDER BY name;
-- SELECT Id, CompId, Value FROM dbo.tblLookup WHERE Kind = 'transfer_reason' AND Code = 'sent_back';
-- SELECT CompId, Id, Name FROM dbo.tblUserGroups ORDER BY CompId, Id;
-- SELECT Id, EscalatedTo, EscalatedAt FROM dbo.tblTicket WHERE EscalatedTo IS NOT NULL ORDER BY Id;
--
-- sqlcmd splits on GO even inside comments: every note is a `--` line comment.
-- ===========================================================================
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- ---------------------------------------------------------------------------
-- 1. Refuse.
-- ---------------------------------------------------------------------------
DECLARE @From INT = TRY_CAST(N'$(From)' AS INT);
IF @From IS NULL OR @From NOT IN (130, 131, 132, 133, 134)
BEGIN
    RAISERROR('135: run with -v From=130, 131 or 134. Nothing was changed.', 16, 1);
    SET NOEXEC ON;
END
ELSE IF @From = 132
BEGIN
    RAISERROR('135: From=132 is refused - the old report procedures need the old fn_ReportTree, which only a 131 rollback restores. Use From=131. Nothing was changed.', 16, 1);
    SET NOEXEC ON;
END
ELSE IF @From = 133
BEGIN
    RAISERROR('135: From=133 is refused - no server image can run on 132 reads with the old writers. Roll back to 131 instead (From=131). Nothing was changed.', 16, 1);
    SET NOEXEC ON;
END
ELSE IF OBJECT_ID('dbo.tblAccessModelBackup', 'U') IS NULL
BEGIN
    RAISERROR('135: dbo.tblAccessModelBackup does not exist - 130 is not applied here, or it was already rolled back. Nothing was changed.', 16, 1);
    SET NOEXEC ON;
END
GO

-- ---------------------------------------------------------------------------
-- 2-6. The rollback, one transaction; 7. best effort after it.
-- ---------------------------------------------------------------------------
SET XACT_ABORT ON;
SET NOCOUNT ON;
DECLARE @From INT = TRY_CAST(N'$(From)' AS INT);
DECLARE @name SYSNAME, @type CHAR(2), @def NVARCHAR(MAX), @kw NVARCHAR(20),
        @sql NVARCHAR(MAX), @json NVARCHAR(MAX), @n INT;
DECLARE @log TABLE (Seq INT IDENTITY PRIMARY KEY, ObjName SYSNAME, Action VARCHAR(20), Result VARCHAR(40));
DECLARE @best TABLE (ObjName SYSNAME PRIMARY KEY, Definition NVARCHAR(MAX));

BEGIN TRY
    BEGIN TRAN;

    -- 7's texts, read now: step 5/6 removes their rows.
    INSERT INTO @best (ObjName, Definition)
    SELECT ObjName, Definition FROM dbo.tblAccessModelBackup
    WHERE ScriptNo = 134 AND ScriptNo >= @From AND Definition IS NOT NULL AND ObjName NOT LIKE '#%';

    -- 2. LoggerHolds checks (133).
    IF @From <= 133
    BEGIN
        IF OBJECT_ID('dbo.CK_tblTicket_LoggerHolds', 'C') IS NOT NULL
        BEGIN
            ALTER TABLE dbo.tblTicket DROP CONSTRAINT CK_tblTicket_LoggerHolds;
            INSERT INTO @log (ObjName, Action, Result) VALUES ('CK_tblTicket_LoggerHolds', 'drop', 'dropped');
        END
        IF OBJECT_ID('dbo.CK_tblLeads_LoggerHolds', 'C') IS NOT NULL
        BEGIN
            ALTER TABLE dbo.tblLeads DROP CONSTRAINT CK_tblLeads_LoggerHolds;
            INSERT INTO @log (ObjName, Action, Result) VALUES ('CK_tblLeads_LoggerHolds', 'drop', 'dropped');
        END
    END

    -- 3. Put saved objects back: functions oldest-first, then procedures.
    DECLARE r CURSOR LOCAL FAST_FORWARD FOR
        SELECT ObjName, ObjType, Definition
        FROM dbo.tblAccessModelBackup
        WHERE ScriptNo >= @From AND ScriptNo <> 134   -- 134's: step 7, after the commit
          AND Definition IS NOT NULL AND ObjName NOT LIKE '#%'
        ORDER BY CASE WHEN ObjType IN ('FN', 'IF', 'TF') THEN 0 ELSE 1 END, ScriptNo, ObjName;
    OPEN r;
    FETCH NEXT FROM r INTO @name, @type, @def;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        SELECT @kw = CASE o.type WHEN 'P' THEN 'PROCEDURE' WHEN 'FN' THEN 'FUNCTION' WHEN 'IF' THEN 'FUNCTION'
                                 WHEN 'TF' THEN 'FUNCTION' WHEN 'V' THEN 'VIEW' END
        FROM sys.objects o WHERE o.object_id = OBJECT_ID(N'dbo.' + QUOTENAME(@name));
        IF @@ROWCOUNT = 1
        BEGIN
            IF @kw IS NULL THROW 50001, '135: a saved object is of a type this script cannot drop', 1;
            SET @sql = N'DROP ' + @kw + N' dbo.' + QUOTENAME(@name) + N';';
            EXEC sys.sp_executesql @sql;
        END
        EXEC sys.sp_executesql @def;

        INSERT INTO @log (ObjName, Action, Result)
        SELECT @name, 'restore',
               CASE WHEN HASHBYTES('SHA2_256', OBJECT_DEFINITION(OBJECT_ID(N'dbo.' + QUOTENAME(@name))))
                         = HASHBYTES('SHA2_256', @def)
                    THEN 'same as saved' ELSE 'MISMATCH' END;
        SET @kw = NULL;
        FETCH NEXT FROM r INTO @name, @type, @def;
    END
    CLOSE r; DEALLOCATE r;

    IF EXISTS (SELECT 1 FROM @log WHERE Result = 'MISMATCH')
    BEGIN
        SELECT * FROM @log ORDER BY Seq;
        THROW 50002, '135: a restored object differs from its saved text (listed above). Rolled back.', 1;
    END

    -- 4. Drop what the undone scripts created: procedures, then functions.
    DECLARE d CURSOR LOCAL STATIC READ_ONLY FOR   -- STATIC: the loop drops what it iterates
        SELECT b.ObjName,
               CASE o.type WHEN 'P' THEN 'PROCEDURE' WHEN 'FN' THEN 'FUNCTION' WHEN 'IF' THEN 'FUNCTION'
                           WHEN 'TF' THEN 'FUNCTION' WHEN 'V' THEN 'VIEW' END
        FROM dbo.tblAccessModelBackup b
        JOIN sys.objects o ON o.object_id = OBJECT_ID(N'dbo.' + QUOTENAME(b.ObjName))
        WHERE b.ScriptNo >= @From AND b.Definition IS NULL AND b.ObjName NOT LIKE '#%'
        ORDER BY CASE WHEN o.type = 'P' THEN 0 ELSE 1 END, b.ScriptNo DESC, b.ObjName;
    OPEN d;
    FETCH NEXT FROM d INTO @name, @kw;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        IF @kw IS NULL THROW 50003, '135: a created object is of a type this script cannot drop', 1;
        SET @sql = N'DROP ' + @kw + N' dbo.' + QUOTENAME(@name) + N';';
        EXEC sys.sp_executesql @sql;
        INSERT INTO @log (ObjName, Action, Result) VALUES (@name, 'drop new', 'dropped');
        FETCH NEXT FROM d INTO @name, @kw;
    END
    CLOSE d; DEALLOCATE d;

    -- 6. From = 130: 130's rows, columns and tables (before 5: reads the rows).
    IF @From = 130
    BEGIN
        -- #escalation_n3: put the cleared escalations back where still empty.
        SET @json = (SELECT Definition FROM dbo.tblAccessModelBackup WHERE ObjName = '#escalation_n3');
        IF @json IS NOT NULL
        BEGIN
            UPDATE t SET EscalatedTo = j.EscalatedTo, EscalatedAt = j.EscalatedAt
            FROM dbo.tblTicket t
            JOIN OPENJSON(@json) WITH (Id INT, EscalatedTo INT, EscalatedAt DATETIME) j ON j.Id = t.Id
            WHERE t.EscalatedTo IS NULL;
            SET @n = @@ROWCOUNT;
            INSERT INTO @log (ObjName, Action, Result)
            VALUES ('#escalation_n3', 'restore', CAST(@n AS VARCHAR(10)) + ' of '
                    + CAST((SELECT COUNT(*) FROM OPENJSON(@json)) AS VARCHAR(10)) + ' put back');
        END

        -- #label_sent_back: old text back where 130's text is still there.
        SET @json = (SELECT Definition FROM dbo.tblAccessModelBackup WHERE ObjName = '#label_sent_back');
        IF @json IS NOT NULL
        BEGIN
            UPDATE l SET Value = j.Value
            FROM dbo.tblLookup l
            JOIN OPENJSON(@json) WITH (Id INT, CompId INT, Value NVARCHAR(200)) j
              ON j.Id = l.Id AND j.CompId = l.CompId
            WHERE l.Kind = 'transfer_reason' AND l.Code = 'sent_back' AND l.Value = N'Sent back';
            INSERT INTO @log (ObjName, Action, Result)
            VALUES ('#label_sent_back', 'restore', CAST(@@ROWCOUNT AS VARCHAR(10)) + ' row(s)');
        END

        -- #role_support_team_lead: remove only unused groups 130 inserted.
        SET @json = (SELECT Definition FROM dbo.tblAccessModelBackup WHERE ObjName = '#role_support_team_lead');
        IF @json IS NOT NULL
        BEGIN
            DECLARE @g TABLE (GroupId INT PRIMARY KEY, CompId BIGINT, Used BIT);
            INSERT INTO @g (GroupId, CompId, Used)
            SELECT j.GroupId, j.CompId,
                   CASE WHEN EXISTS (SELECT 1 FROM dbo.tblUserGroupMap m WHERE m.GroupId = j.GroupId)
                          OR EXISTS (SELECT 1 FROM dbo.tblGroupAccess a WHERE a.GroupId = j.GroupId)
                        THEN 1 ELSE 0 END
            FROM OPENJSON(@json) WITH (CompId BIGINT, GroupId INT) j
            JOIN dbo.tblUserGroups ug ON ug.Id = j.GroupId AND ug.CompId = j.CompId AND ug.Name = 'Support Team Lead';

            SELECT 'Support Team Lead KEPT (has members or group access; remove it in Admin)' AS List,
                   g.CompId, g.GroupId,
                   (SELECT COUNT(*) FROM dbo.tblUserGroupMap m WHERE m.GroupId = g.GroupId) AS Members
            FROM @g g WHERE g.Used = 1;

            DELETE gm FROM dbo.tblGroupModule gm JOIN @g g ON g.GroupId = gm.GroupId WHERE g.Used = 0;
            DELETE ug FROM dbo.tblUserGroups ug JOIN @g g ON g.GroupId = ug.Id WHERE g.Used = 0;
            INSERT INTO @log (ObjName, Action, Result)
            VALUES ('#role_support_team_lead', 'remove', CAST(@@ROWCOUNT AS VARCHAR(10)) + ' removed, '
                    + CAST((SELECT COUNT(*) FROM @g WHERE Used = 1) AS VARCHAR(10)) + ' kept');
        END

        -- Columns and constraints (dynamic: a re-run compiles without them).
        IF OBJECT_ID('dbo.CK_tblGroupModule_AssignReach', 'C') IS NOT NULL
            EXEC (N'ALTER TABLE dbo.tblGroupModule DROP CONSTRAINT CK_tblGroupModule_AssignReach;');
        IF COL_LENGTH('dbo.tblGroupModule', 'AssignReach') IS NOT NULL
            EXEC (N'ALTER TABLE dbo.tblGroupModule DROP COLUMN AssignReach;');
        IF OBJECT_ID('dbo.DF_tblTicket_LoggerHolds', 'D') IS NOT NULL
            EXEC (N'ALTER TABLE dbo.tblTicket DROP CONSTRAINT DF_tblTicket_LoggerHolds;');
        IF COL_LENGTH('dbo.tblTicket', 'LoggerHolds') IS NOT NULL
            EXEC (N'ALTER TABLE dbo.tblTicket DROP COLUMN LoggerHolds;');
        IF OBJECT_ID('dbo.DF_tblLeads_LoggerHolds', 'D') IS NOT NULL
            EXEC (N'ALTER TABLE dbo.tblLeads DROP CONSTRAINT DF_tblLeads_LoggerHolds;');
        IF COL_LENGTH('dbo.tblLeads', 'LoggerHolds') IS NOT NULL
            EXEC (N'ALTER TABLE dbo.tblLeads DROP COLUMN LoggerHolds;');
        INSERT INTO @log (ObjName, Action, Result) VALUES ('130 columns', 'drop', 'AssignReach, LoggerHolds x2');

        IF OBJECT_ID('dbo.tblAccessModelSnapshot', 'U') IS NOT NULL DROP TABLE dbo.tblAccessModelSnapshot;
        IF OBJECT_ID('dbo.sp_AccessModelBackup', 'P') IS NOT NULL DROP PROCEDURE dbo.sp_AccessModelBackup;
        DROP TABLE dbo.tblAccessModelBackup;
        INSERT INTO @log (ObjName, Action, Result) VALUES ('130 tables', 'drop', 'snapshot, backup, sp_AccessModelBackup');
    END
    ELSE
    BEGIN
        -- 5. Forget the undone scripts' saves (first save wins on a re-apply).
        DELETE FROM dbo.tblAccessModelBackup WHERE ScriptNo >= @From;
        INSERT INTO @log (ObjName, Action, Result)
        VALUES ('tblAccessModelBackup', 'delete', CAST(@@ROWCOUNT AS VARCHAR(10)) + ' row(s) >= ' + CAST(@From AS VARCHAR(10)));
        -- 130 retakes the snapshot only while empty; empty it so a re-run of
        -- 130 before 131-134 compares against today's data, not the old one.
        IF OBJECT_ID('dbo.tblAccessModelSnapshot', 'U') IS NOT NULL
        BEGIN
            TRUNCATE TABLE dbo.tblAccessModelSnapshot;
            INSERT INTO @log (ObjName, Action, Result) VALUES ('tblAccessModelSnapshot', 'truncate', 're-run 130 next');
        END
    END

    COMMIT;

    -- 7. Best effort, outside the transaction: 134's dead procedures.
    SET XACT_ABORT OFF;
    SET @name = NULL;
    WHILE 1 = 1
    BEGIN
        SELECT TOP (1) @name = ObjName, @def = Definition
        FROM @best WHERE ObjName > ISNULL(@name, N'') ORDER BY ObjName;
        IF @@ROWCOUNT = 0 BREAK;
        IF OBJECT_ID(N'dbo.' + QUOTENAME(@name)) IS NOT NULL
            INSERT INTO @log (ObjName, Action, Result) VALUES (@name, 'restore (best)', 'already there');
        ELSE
        BEGIN
            BEGIN TRY
                EXEC sys.sp_executesql @def;
                INSERT INTO @log (ObjName, Action, Result)
                SELECT @name, 'restore (best)',
                       CASE WHEN HASHBYTES('SHA2_256', OBJECT_DEFINITION(OBJECT_ID(N'dbo.' + QUOTENAME(@name))))
                                 = HASHBYTES('SHA2_256', @def)
                            THEN 'same as saved' ELSE 'MISMATCH (left in place)' END;
            END TRY
            BEGIN CATCH
                IF @@TRANCOUNT > 0 ROLLBACK;
                PRINT '135: ' + @name + ' not restored - its saved text does not compile on today''s schema (dead object, left dropped)';
                PRINT '     ' + ERROR_MESSAGE();
                INSERT INTO @log (ObjName, Action, Result) VALUES (@name, 'restore (best)', 'skipped: does not compile');
            END CATCH
        END
    END
    SET XACT_ABORT ON;

    SELECT Seq, ObjName, Action, Result FROM @log ORDER BY Seq;
    PRINT '135: rolled back scripts ' + CAST(@From AS VARCHAR(10)) + '-134.';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    IF CURSOR_STATUS('local', 'r') >= -1 DEALLOCATE r;
    IF CURSOR_STATUS('local', 'd') >= -1 DEALLOCATE d;
    PRINT '135: FAILED at ' + ISNULL(@name, '(no object)') + ' - nothing was changed. Steps done before the error (rolled back):';
    SELECT Seq, ObjName, Action, Result FROM @log ORDER BY Seq;
    THROW;
END CATCH
GO

SET NOEXEC OFF;
GO

-- ===========================================================================
-- Verify after apply. Each query's expected answer follows it.
--
-- During the run: the last result set lists every step; every 'restore' row
-- reads 'same as saved' (a MISMATCH aborts the run before commit). The two
-- 'restore (best)' rows (step 7) read 'same as saved' or 'skipped: does not
-- compile' (with the printed "not restored" line); on TestCRM both skip.
--
-- After From=131 / 134 (From=130 also passes 1-4):
-- 1. Nothing an undone script created is left -> 0 rows
--    (From=134: these are untouched - 134 creates none of them)
-- SELECT name FROM sys.objects WHERE name IN ('fn_AccessGrants', 'fn_AccessScope',
--   'fn_AccessPeople', 'fn_AccessOffices', 'fn_RecordGiver', 'fn_VisibleLeads',
--   'fn_VisibleTickets', 'fn_VisibleFollowUps', 'fn_AssignableUsers', 'fn_RecordActions',
--   'fn_StrandedWork', 'sp_NotifyStranded', 'sp_FetchLoggedByMe', 'fn_ReassignGate',
--   'sp_FetchTicketEscalationTargets', 'fn_CompanyOffice', 'sp_LoggerMayAttach');
--    139 undone too (From <= 131): no 139 marker left in sp_SetLeadStatus -> 0
-- SELECT CHARINDEX('139:', OBJECT_DEFINITION(OBJECT_ID('dbo.sp_SetLeadStatus')));
-- 2. The old signatures are back (From <= 131) -> 1, 4
-- SELECT COUNT(*) FROM sys.parameters WHERE object_id = OBJECT_ID('dbo.sp_FetchTickets')
--   AND name = '@AccessibleBranchIdsJson';
-- SELECT COUNT(*) FROM sys.parameters WHERE object_id = OBJECT_ID('dbo.fn_ReportTree') AND parameter_id > 0;
--    (From <= 131) sp_SetTicketStatus has @AllowReopen again -> 1
-- SELECT COUNT(*) FROM sys.parameters WHERE object_id = OBJECT_ID('dbo.sp_SetTicketStatus') AND name = '@AllowReopen';
-- 3. LoggerHolds checks gone (From <= 131) -> 0
-- SELECT COUNT(*) FROM sys.check_constraints WHERE name IN ('CK_tblTicket_LoggerHolds', 'CK_tblLeads_LoggerHolds');
-- 4. 134's drops are back where they compile -> 2 minus the step-7 skips
--    (on today's schema both skip -> 0; that is expected, not a failure)
-- SELECT COUNT(*) FROM sys.objects WHERE name IN ('sp_LeadsUserWise', 'sp_ConvertedSummary') AND type = 'P';
-- 5. (From 131 / 134) no save of an undone script is left, snapshot empty -> 0, 0
-- SELECT COUNT(*) FROM dbo.tblAccessModelBackup WHERE ScriptNo >= 131;   -- use your From
-- SELECT COUNT(*) FROM dbo.tblAccessModelSnapshot;
--    Next: re-run 130 (retakes the snapshot), then 131-134.
--
-- After From=130 only:
-- 6. 130's schema is gone -> NULL x6
-- SELECT COL_LENGTH('dbo.tblGroupModule', 'AssignReach'), COL_LENGTH('dbo.tblTicket', 'LoggerHolds'),
--        COL_LENGTH('dbo.tblLeads', 'LoggerHolds'), OBJECT_ID('dbo.tblAccessModelBackup'),
--        OBJECT_ID('dbo.tblAccessModelSnapshot'), OBJECT_ID('dbo.sp_AccessModelBackup');
-- SELECT COUNT(*) FROM sys.objects WHERE name IN ('CK_tblGroupModule_AssignReach',
--   'DF_tblTicket_LoggerHolds', 'DF_tblLeads_LoggerHolds');                  -- 0
-- 7. The label reads the old text again -> 'Sent back to manager' where 130 changed it
-- SELECT Id, CompId, Value FROM dbo.tblLookup WHERE Kind = 'transfer_reason' AND Code = 'sent_back';
-- 8. Support Team Lead: gone wherever 130 created it and nobody was put in it
--    -> 0 rows on TestCRM before 136; with 136 applied, am_rohit's company
--    keeps it (listed during the run as KEPT).
-- SELECT CompId, Id FROM dbo.tblUserGroups WHERE Name = 'Support Team Lead';
-- 9. N3 escalations back -> TestCRM 17 (the run's '#escalation_n3' row reads
--    '17 of 17 put back'), other databases 0.
-- 10. G1: the pre-130 capture in the header, run again -> identical output,
--     except the first query lacks P sp_ConvertedSummary and P sp_LeadsUserWise
--     when step 7 skipped them (TestCRM: exactly those two lines).
-- ===========================================================================
