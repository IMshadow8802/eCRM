/* ===========================================================================
   119 — next follow-up type on lead rows · a closed lead cancels its open
         follow-ups
   ---------------------------------------------------------------------------
   Apply by hand, TestCRM first, then eCRM+ and SolarCRM (CLAUDE.md §0.2).
   sqlcmd needs -I (QUOTED_IDENTIFIER ON).

   0. CK_tblFollowUp_Status   + 'cancelled' (was open / done / skipped, 071).
                              Dropped and re-added by name in one transaction,
                              only when its definition lacks 'cancelled'.
   1. sp_FetchLeads           RS1 gains NextFollowupType: the Type of the lead's
                              earliest open follow-up (DueAt, then Id) — the row
                              l.NextFollowupDate caches (MIN(DueAt) of the open
                              rows). NULL when none is open. Read by name: the
                              deployed web ignores it, the mobile shows
                              "Call …" / "Visit …" when present.
   2. sp_ConvertLead          a won lead's open follow-ups become 'cancelled':
      sp_SetLeadStatus        DoneAt = now, DoneBy = NULL (nobody did them),
                              Remarks 'Lead won' / 'Lead marked <status>' (lost
                              or junk — the codes whose open quotations this
                              proc already closes; spec G17), NextFollowupDate
                              cleared, one 'followup' activity
                              "Follow-up cancelled: <remark>".
                              The block sits BEFORE the proc's UPDATE tblLeads:
                              tblFollowUp -> tblLeads, sp_SkipFollowUp's order.
                              Undoing the status reopens nothing: no proc turns
                              a cancelled row back to open.
                              Not 'skipped': skipped rows count against DoneBy in
                              Follow-up Compliance and the Leaderboard.
   3. sp_RptFollowUpCompliance  'cancelled' rows leave #F. Every per-status
      sp_RptLeaderboard         term already ignores them (they test 'done' /
                              'skipped' / 'open'), but Compliance's Due is
                              COUNT(*) over #F and the Leaderboard lists a rep
                              from any #F row, so a cancelled visit would read
                              as "due" / list a rep. One AND each.
   Other readers, checked in git: sp_RptFunnel / Lost / PipelineValue /
   Activity, sp_Dashboard, sp_FetchLeadDetail and sp_FetchFollowUps test
   'open' or 'done' explicitly, so a cancelled row is neither. sp_Complete /
   Skip / DeleteFollowUp refuse a non-open row ("Follow-up is already
   cancelled"). sp_FetchFollowUps' unfiltered "All" view lists it, labelled.

   Every CompId / reach predicate is untouched; no params added.

   HOW (procs): the 118 pattern. Each proc is ALTERed from its own LIVE text
   (OBJECT_DEFINITION) with ONE anchored replacement; nothing else changes.
     * The text must contain "CREATE OR ALTER PROC", so executing it alters in
       place: grants and object_id kept (no DROP). Otherwise THROW.
     * Already patched (marker present)      -> skipped, idempotent.
     * Anchor missing or not exactly once    -> THROW, proc left as it was.
     * Per procedure, in order; each ALTER in its own transaction, rolled back
       in the CATCH. On a THROW the earlier steps stay applied; fix and re-run
       the whole script (done steps are skipped).
   Anchors are single lines, checked against the committed texts, NOT the
   live DBs (confidence: high for all six — each one's last full definition
   is committed and no later script touches the anchor line):
     sp_FetchLeads, sp_ConvertLead, sp_SetLeadStatus  <- 107 (b349524)
     sp_RptFollowUpCompliance <- 083 (576f3e1), sp_RptLeaderboard <- 079
       (576f3e1); 091 and 107 later text-patched both, on other lines.
   If a THROW fires, diff the live text:
     SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.sp_ConvertLead'));

   ROLLOUT: the backend sends nothing new and passes rows through, so the
   shared src works before and after; the mobile falls back to "Follow-up …"
   without the column; web and mobile label a 'cancelled' row "Cancelled".
   =========================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- 0. The status constraint ------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
               WHERE name = N'CK_tblFollowUp_Status' AND parent_object_id = OBJECT_ID(N'dbo.tblFollowUp')
                 AND definition LIKE N'%cancelled%')
BEGIN
    BEGIN TRY
        BEGIN TRAN;
        IF EXISTS (SELECT 1 FROM sys.check_constraints
                   WHERE name = N'CK_tblFollowUp_Status' AND parent_object_id = OBJECT_ID(N'dbo.tblFollowUp'))
            ALTER TABLE dbo.tblFollowUp DROP CONSTRAINT CK_tblFollowUp_Status;
        ALTER TABLE dbo.tblFollowUp WITH CHECK ADD CONSTRAINT CK_tblFollowUp_Status
            CHECK (Status IN ('open','done','skipped','cancelled'));
        COMMIT;
        PRINT N'119: CK_tblFollowUp_Status now allows cancelled';
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        PRINT N'119: FAILED, constraint left as it was — ' + ERROR_MESSAGE();
        THROW;
    END CATCH
END
ELSE
    PRINT N'119: CK_tblFollowUp_Status already allows cancelled, skipped';
GO

-- 1-3. The procedures -------------------------------------------------------------
-- Gate: never patch the lead procs unless the status check already allows
-- 'cancelled' (step 0 above). Otherwise every won/lost would fail that check.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
               WHERE parent_object_id = OBJECT_ID('dbo.tblFollowUp')
                 AND definition LIKE '%cancelled%')
  THROW 50119, '119: tblFollowUp status check does not allow cancelled yet; step 0 must succeed first. Nothing patched.', 1;
DECLARE @nl NCHAR(1) = NCHAR(10);

-- The block both lead procs gain, just before their own "DECLARE @hist" (the
-- line before their UPDATE tblLeads). {why} becomes the remark expression.
-- Its own table variable: sp_ConvertLead declares @actLog later in the text.
DECLARE @close NVARCHAR(MAX) =
       N'/* 119: a closed lead cancels its open follow-ups (tblFollowUp -> tblLeads, as sp_SkipFollowUp; never reopened) */' + @nl
     + N'        DECLARE @act119 TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));' + @nl
     + N'        UPDATE dbo.tblFollowUp' + @nl
     + N'        SET Status = ''cancelled'', DoneAt = GETDATE(), DoneBy = NULL, Remarks = {why},' + @nl
     + N'            EditBy = @UserId, UpdatedAt = GETDATE()' + @nl
     + N'        WHERE CompId = @CompId AND LeadId = @LeadId AND Status = ''open'';' + @nl
     + N'        IF @@ROWCOUNT > 0' + @nl
     + N'        BEGIN' + @nl
     + N'            UPDATE dbo.tblLeads SET NextFollowupDate = NULL WHERE Id = @LeadId AND CompId = @CompId;' + @nl
     + N'            DECLARE @fu119 NVARCHAR(500) = N''Follow-up cancelled: '' + {why};' + @nl
     + N'            INSERT INTO @act119' + @nl
     + N'            EXEC dbo.sp_LogLeadActivity @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId,' + @nl
     + N'                 @Type = ''followup'', @Summary = @fu119, @MetaJSON = NULL;' + @nl
     + N'        END' + @nl
     + N'        ';
DECLARE @histC NVARCHAR(100) = N'DECLARE @hist TABLE (FromStatusId INT);';     -- sp_ConvertLead
DECLARE @histS NVARCHAR(100) = N'DECLARE @hist   TABLE (FromStatusId INT);';   -- sp_SetLeadStatus

DECLARE @patch TABLE (seq INT, proc_name SYSNAME, marker NVARCHAR(100), a1 NVARCHAR(400), r1 NVARCHAR(MAX));
INSERT INTO @patch VALUES
(1, N'sp_FetchLeads', N'NextFollowupType',
    N'l.EstValue, l.Remarks, l.NextFollowupDate,',
    N'l.EstValue, l.Remarks, l.NextFollowupDate,' + @nl
  + N'           (SELECT TOP 1 f.Type FROM dbo.tblFollowUp f'
  + N' WHERE f.CompId = l.CompId AND f.LeadId = l.Id AND f.Status = ''open'''
  + N' ORDER BY f.DueAt, f.Id) AS NextFollowupType,  -- 119'),
(2, N'sp_ConvertLead', N'/* 119: a closed lead',
    @histC,
    REPLACE(@close, N'{why}', N'N''Lead won''') + @histC),
(3, N'sp_SetLeadStatus', N'/* 119: a closed lead',
    @histS,
    N'IF @ToCode IN (''lost'',''junk'')' + @nl + N'        BEGIN' + @nl + N'        '
  + REPLACE(@close, N'{why}', N'N''Lead marked '' + @ToName')
  + N'END' + @nl + N'        ' + @histS),
(4, N'sp_RptFollowUpCompliance', N'119: cancelled',
    N'AND (@DateBasis <> ''created'' OR (f.DueAt >= @FromDate AND f.DueAt < @ToEx))',
    N'AND (@DateBasis <> ''created'' OR (f.DueAt >= @FromDate AND f.DueAt < @ToEx))'
  + N' AND f.Status <> ''cancelled''  -- 119: cancelled is not due'),
(5, N'sp_RptLeaderboard', N'119: cancelled',
    N'AND COALESCE(f.DoneBy, f.AssignedTo, l.OwnerId) IS NOT NULL',
    N'AND COALESCE(f.DoneBy, f.AssignedTo, l.OwnerId) IS NOT NULL'
  + N' AND f.Status <> ''cancelled''  -- 119: cancelled is not due');

DECLARE @seq INT = 1, @p SYSNAME, @marker NVARCHAR(100), @a1 NVARCHAR(400), @r1 NVARCHAR(MAX),
        @def NVARCHAR(MAX), @msg NVARCHAR(2048);
WHILE @seq <= 5
BEGIN
    SELECT @p = proc_name, @marker = marker, @a1 = a1, @r1 = r1 FROM @patch WHERE seq = @seq;
    SET @def = OBJECT_DEFINITION(OBJECT_ID(N'dbo.' + @p));

    IF @def IS NULL
    BEGIN
        SET @msg = N'119: dbo.' + @p + N' not found';
        THROW 50119, @msg, 1;
    END

    IF CHARINDEX(@marker, @def) = 0 AND CHARINDEX(N'CREATE OR ALTER PROC', @def) = 0
    BEGIN
        SET @msg = N'119: live dbo.' + @p + N' does not begin CREATE OR ALTER PROC — left as it was';
        THROW 50119, @msg, 1;
    END

    IF CHARINDEX(@marker, @def) > 0
        PRINT N'119: already patched, skipped: ' + @p;
    ELSE
    BEGIN
        IF (DATALENGTH(@def) - DATALENGTH(REPLACE(@def, @a1, N''))) / DATALENGTH(@a1) <> 1
        BEGIN
            SET @msg = N'119: anchor not found exactly once in live dbo.' + @p + N' — left as it was; diff its OBJECT_DEFINITION';
            THROW 50119, @msg, 1;
        END

        SET @def = REPLACE(@def, @a1, @r1);
        BEGIN TRY
            BEGIN TRAN;
            EXEC (@def);   -- CREATE OR ALTER: alters in place, grants + object_id kept
            COMMIT;
            PRINT N'119: patched ' + @p;
        END TRY
        BEGIN CATCH
            IF @@TRANCOUNT > 0 ROLLBACK;
            PRINT N'119: FAILED, left as it was: ' + @p + N' — ' + ERROR_MESSAGE();
            THROW;
        END CATCH
    END
    SET @seq += 1;
END
GO

/* ===========================================================================
   VERIFY AFTER APPLY — 1-3 read-only on every DB; 4 on TestCRM only
   ===========================================================================
-- 1. Constraint + markers                                     -- expect 1, then 5 rows all patched = 1
SELECT COUNT(*) AS ck_allows_cancelled FROM sys.check_constraints
WHERE name = 'CK_tblFollowUp_Status' AND definition LIKE '%cancelled%';
SELECT p.name,
       CASE WHEN CHARINDEX(CASE p.name WHEN 'sp_FetchLeads' THEN 'NextFollowupType'
                                       WHEN 'sp_RptFollowUpCompliance' THEN '119: cancelled'
                                       WHEN 'sp_RptLeaderboard' THEN '119: cancelled'
                                       ELSE '/* 119: a closed lead' END,
                           OBJECT_DEFINITION(p.object_id)) > 0 THEN 1 ELSE 0 END AS patched
FROM sys.procedures p
WHERE p.name IN ('sp_FetchLeads','sp_ConvertLead','sp_SetLeadStatus','sp_RptFollowUpCompliance','sp_RptLeaderboard');

-- 2. Scope arm intact                                         -- expect > 0
SELECT CHARINDEX('l.OwnerId IS NULL AND l.CreatedBy = @UserId', OBJECT_DEFINITION(OBJECT_ID('dbo.sp_FetchLeads'))) AS leads_always_visible;

-- 3. NextFollowupType is the EARLIEST open follow-up's type. Takes the lead
--    whose open follow-ups have the most distinct types (so a wrong pick shows).
DECLARE @c INT = 1;   -- CompId
DECLARE @lid INT, @mob VARCHAR(20), @expect VARCHAR(20);
SELECT TOP 1 @lid = f.LeadId FROM dbo.tblFollowUp f
WHERE f.CompId = @c AND f.Status = 'open'
GROUP BY f.LeadId ORDER BY COUNT(DISTINCT f.Type) DESC, COUNT(*) DESC;
SELECT @mob = MobileNo FROM dbo.tblLeads WHERE Id = @lid;
SELECT TOP 1 @expect = Type FROM dbo.tblFollowUp
WHERE CompId = @c AND LeadId = @lid AND Status = 'open' ORDER BY DueAt, Id;
SELECT @lid AS lead_id, @expect AS expected_type;
EXEC dbo.sp_FetchLeads @CompId = @c, @SearchTerm = @mob, @PageSize = 50;
--    expect: the row with Id = lead_id has NextFollowupType = expected_type;
--    a row with NextFollowupDate NULL has NextFollowupType NULL.
GO

-- 4. TestCRM ONLY. Stop after block 3 on eCRM+ / SolarCRM. Each block runs inside its own transaction and ends with a
--    guarded ROLLBACK, so nothing stays. (If the proc itself fails it rolls the
--    whole thing back and prints error 266; the guard then skips — no 3903.)
-- 4a. Lost: open follow-ups -> cancelled, only on that lead.
BEGIN TRAN;
DECLARE @c4 INT = 1, @u INT = 1;   -- CompId, an acting UserId
DECLARE @lead INT = (SELECT TOP 1 f.LeadId FROM dbo.tblFollowUp f JOIN dbo.tblLeads l ON l.Id = f.LeadId
                     JOIN dbo.tblLookup st ON st.Id = l.StatusId
                     WHERE f.CompId = @c4 AND f.Status = 'open' AND st.Code IN ('open','qualified'));
DECLARE @lost INT = (SELECT TOP 1 Id FROM dbo.tblLookup WHERE CompId = @c4 AND Kind = 'lead_status' AND Code = 'lost' AND IsActive = 1);
DECLARE @why  INT = (SELECT TOP 1 Id FROM dbo.tblLookup WHERE CompId = @c4 AND Kind = 'lost_reason');
DECLARE @open0 INT = (SELECT COUNT(*) FROM dbo.tblFollowUp WHERE LeadId = @lead AND Status = 'open');
DECLARE @others INT = (SELECT COUNT(*) FROM dbo.tblFollowUp WHERE CompId = @c4 AND Status = 'open' AND LeadId <> @lead);
EXEC dbo.sp_SetLeadStatus @CompId = @c4, @LeadId = @lead, @StatusId = @lost, @LostReasonId = @why, @UserId = @u;  -- expect 200
SELECT (SELECT COUNT(*) FROM dbo.tblFollowUp WHERE LeadId = @lead AND Status = 'open')                           AS open_left,       -- expect 0
       (SELECT COUNT(*) FROM dbo.tblFollowUp WHERE LeadId = @lead AND Status = 'cancelled'
           AND DoneBy IS NULL AND DoneAt IS NOT NULL AND Remarks = 'Lead marked ' +
           (SELECT Value FROM dbo.tblLookup WHERE Id = @lost)) - @open0                                         AS cancelled_diff,  -- expect 0
       (SELECT NextFollowupDate FROM dbo.tblLeads WHERE Id = @lead)                                             AS next_date,       -- expect NULL
       (SELECT TOP 1 Summary FROM dbo.tblLeadActivity WHERE LeadId = @lead AND Type = 'followup' ORDER BY Id DESC) AS activity,     -- expect 'Follow-up cancelled: Lead marked <Lost>'
       (SELECT COUNT(*) FROM dbo.tblFollowUp WHERE CompId = @c4 AND Status = 'open' AND LeadId <> @lead) - @others AS others_diff;  -- expect 0
IF @@TRANCOUNT > 0 ROLLBACK;
GO
-- 4b. Won: same, remark 'Lead won'; undoing the win reopens nothing.
BEGIN TRAN;
DECLARE @c4 INT = 1, @u INT = 1;
DECLARE @lead INT = (SELECT TOP 1 f.LeadId FROM dbo.tblFollowUp f JOIN dbo.tblLeads l ON l.Id = f.LeadId
                     JOIN dbo.tblLookup st ON st.Id = l.StatusId
                     WHERE f.CompId = @c4 AND f.Status = 'open' AND st.Code IN ('open','qualified'));
DECLARE @back INT = (SELECT StatusId FROM dbo.tblLeads WHERE Id = @lead);
EXEC dbo.sp_ConvertLead @CompId = @c4, @LeadId = @lead, @UserId = @u, @WonValue = 1000;                -- expect 200
SELECT (SELECT COUNT(*) FROM dbo.tblFollowUp WHERE LeadId = @lead AND Status = 'open')                    AS open_left,   -- expect 0
       (SELECT TOP 1 Remarks FROM dbo.tblFollowUp WHERE LeadId = @lead AND Status = 'cancelled' ORDER BY Id DESC) AS remark; -- expect 'Lead won'
EXEC dbo.sp_SetLeadStatus @CompId = @c4, @LeadId = @lead, @StatusId = @back, @UserId = @u;             -- undo the win
SELECT COUNT(*) AS open_after_undo FROM dbo.tblFollowUp WHERE LeadId = @lead AND Status = 'open';      -- expect 0
IF @@TRANCOUNT > 0 ROLLBACK;
GO
*/
