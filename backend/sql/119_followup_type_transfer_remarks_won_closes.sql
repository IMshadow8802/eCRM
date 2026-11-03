/* ===========================================================================
   119 — next follow-up type · transfer remarks in the timeline · a closed
         lead closes its open follow-ups
   ---------------------------------------------------------------------------
   Apply by hand, TestCRM first, then eCRM+ and SolarCRM (CLAUDE.md §0.2).
   sqlcmd needs -I (QUOTED_IDENTIFIER ON).

   1. sp_FetchLeads          RS1 gains NextFollowupType: the Type of the lead's
                             earliest open follow-up (DueAt, then Id) — the same
                             row l.NextFollowupDate caches (sp_RefreshLeadNextFollowup
                             = MIN(DueAt) of the open rows). NULL when none is open.
                             New column read by name: the deployed web ignores it,
                             the mobile shows "Call …" / "Visit …" when present.
   2. sp_TransferTicket      the 'assigned' activity summary ends with the remarks:
      sp_BulkTransferTickets   "Transferred to Priya — Wrong area — customer moved to Surat"
                               "Transferred to Priya — Wrong area (bulk) — leaving the team"
                             tblTicketActivity has no remarks column (Summary +
                             MetaJSON only; the remarks were in MetaJSON already,
                             which nothing renders). The leading verb stays
                             "Transferred" / "Unassigned". Summary is NVARCHAR(500);
                             a long remark is cut there, as the variable already does.
   3. sp_ConvertLead         a won lead's open follow-ups are closed: Status
                             'skipped', Remarks 'Lead won', DoneAt/DoneBy stamped —
                             what sp_SkipFollowUp does — NextFollowupDate cleared,
                             one 'followup' activity "Follow-up skipped: Lead won".
      sp_SetLeadStatus       the same on a move to lost or junk ("Lead marked Lost"),
                             the codes whose open quotations this proc already
                             closes (its step c). Spec G17: on Lost, "Open
                             follow-ups are cancelled".
                             Undoing a win or a loss resurrects nothing: no proc
                             reopens a skipped follow-up, and step (b) of
                             sp_SetLeadStatus only touches quotations.

   Every CompId / reach predicate is untouched: (1) adds a column, correlated on
   f.CompId = l.CompId AND f.LeadId = l.Id, to rows already scoped; (2) only
   changes a string; (3) updates WHERE CompId = @CompId AND LeadId = @LeadId,
   the lead the proc already found in that company. No params added.

   HOW: the 118 pattern. Each proc is ALTERed from its own LIVE text
   (OBJECT_DEFINITION) with ONE anchored replacement; nothing else changes.
     * The text must contain "CREATE OR ALTER PROC", so executing it alters in
       place: grants and object_id kept (no DROP). Otherwise THROW, left as it was.
     * Already patched (marker present)      -> skipped, idempotent.
     * Anchor missing or not exactly once    -> THROW, proc left as it was.
     * Per procedure, in order; each ALTER in its own transaction, rolled back
       in the CATCH. On a THROW the earlier procs stay patched; fix and re-run
       the whole script (patched procs are skipped).
   Anchors are single lines (no CR/LF inside) and avoid non-ASCII text; the
   em dash added in (2) is NCHAR(8212) so the file's encoding cannot mangle it.
   Anchors were checked against the committed texts, NOT the live DBs:
     sp_FetchLeads, sp_ConvertLead, sp_SetLeadStatus  <- 107 (b349524), their last
         full CREATE OR ALTER; no later script touches them.          confidence: high
     sp_TransferTicket, sp_BulkTransferTickets        <- the support-rebuild plan
         (docs/superpowers/plans/2026-09-16-support-rebuild.md §7.6/7.7, 8446918);
         the applied .sql was never committed.                         confidence: medium
   If a THROW fires, diff the live text:
     SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.sp_TransferTicket'));

   ROLLOUT: the backend sends nothing new and passes rows through, so the shared
   src works before and after; the mobile falls back to "Follow-up …" without
   the column.
   =========================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

DECLARE @nl NCHAR(1) = NCHAR(10);
DECLARE @dash NVARCHAR(40) = N'N'' '' + NCHAR(8212) + N'' ''';   -- T-SQL text: N' ' + NCHAR(8212) + N' '

-- The block both lead procs gain, just before their partner-commission sync
-- (after their own status activity, inside their transaction; @actLog exists).
-- {why} becomes the T-SQL expression for the remark.
DECLARE @close NVARCHAR(MAX) =
       N'/* 119: a closed lead closes its open follow-ups (as sp_SkipFollowUp; never reopened) */' + @nl
     + N'        UPDATE dbo.tblFollowUp' + @nl
     + N'        SET Status = ''skipped'', DoneAt = GETDATE(), DoneBy = @UserId, Remarks = {why},' + @nl
     + N'            EditBy = @UserId, UpdatedAt = GETDATE()' + @nl
     + N'        WHERE CompId = @CompId AND LeadId = @LeadId AND Status = ''open'';' + @nl
     + N'        IF @@ROWCOUNT > 0' + @nl
     + N'        BEGIN' + @nl
     + N'            UPDATE dbo.tblLeads SET NextFollowupDate = NULL WHERE Id = @LeadId AND CompId = @CompId;' + @nl
     + N'            DECLARE @fu119 NVARCHAR(500) = N''Follow-up skipped: '' + {why};' + @nl
     + N'            INSERT INTO @actLog' + @nl
     + N'            EXEC dbo.sp_LogLeadActivity @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId,' + @nl
     + N'                 @Type = ''followup'', @Summary = @fu119, @MetaJSON = NULL;' + @nl
     + N'        END' + @nl
     + N'        ';
DECLARE @sync NVARCHAR(200) = N'EXEC dbo.sp_SyncPartnerCommission @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId;';

DECLARE @patch TABLE (seq INT, proc_name SYSNAME, marker NVARCHAR(100), a1 NVARCHAR(400), r1 NVARCHAR(MAX));
INSERT INTO @patch VALUES
(1, N'sp_FetchLeads', N'NextFollowupType',
    N'l.EstValue, l.Remarks, l.NextFollowupDate,',
    N'l.EstValue, l.Remarks, l.NextFollowupDate,' + @nl
  + N'           (SELECT TOP 1 f.Type FROM dbo.tblFollowUp f'
  + N' WHERE f.CompId = l.CompId AND f.LeadId = l.Id AND f.Status = ''open'''
  + N' ORDER BY f.DueAt, f.Id) AS NextFollowupType,  -- 119'),
(2, N'sp_TransferTicket', N'/* 119 remarks */',
    N'ISNULL(@Reason, N'''');',
    N'ISNULL(@Reason, N'''') + ' + @dash + N' + LTRIM(RTRIM(@Remarks)) /* 119 remarks */;'),
(3, N'sp_BulkTransferTickets', N'/* 119 remarks */',
    N'ISNULL(@Reason, N'''') + N'' (bulk)'';',
    N'ISNULL(@Reason, N'''') + N'' (bulk)'' + ' + @dash + N' + LTRIM(RTRIM(@Remarks)) /* 119 remarks */;'),
(4, N'sp_ConvertLead', N'/* 119: a closed lead',
    @sync,
    REPLACE(@close, N'{why}', N'N''Lead won''') + @sync),
(5, N'sp_SetLeadStatus', N'/* 119: a closed lead',
    @sync,
    -- only on a move to lost/junk; the IF wraps the whole block
    N'IF @ToCode IN (''lost'',''junk'')' + @nl + N'        BEGIN' + @nl + N'        '
  + REPLACE(@close, N'{why}', N'N''Lead marked '' + @ToName')
  + N'END' + @nl + N'        ' + @sync);

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
   VERIFY AFTER APPLY (read-only except 4, which runs in a rolled-back transaction)
   ===========================================================================
-- 1. Every proc carries its marker                               -- expect 5 rows, all 1
SELECT p.name,
       CASE WHEN CHARINDEX(CASE p.name WHEN 'sp_FetchLeads' THEN 'NextFollowupType'
                                       WHEN 'sp_TransferTicket' THEN '/* 119 remarks */'
                                       WHEN 'sp_BulkTransferTickets' THEN '/* 119 remarks */'
                                       ELSE '/* 119: a closed lead' END,
                           OBJECT_DEFINITION(p.object_id)) > 0 THEN 1 ELSE 0 END AS patched
FROM sys.procedures p
WHERE p.name IN ('sp_FetchLeads','sp_TransferTicket','sp_BulkTransferTickets','sp_ConvertLead','sp_SetLeadStatus');

-- 2. Scope predicates still there                                -- expect > 0
SELECT CHARINDEX('l.OwnerId IS NULL AND l.CreatedBy = @UserId', OBJECT_DEFINITION(OBJECT_ID('dbo.sp_FetchLeads'))) AS leads_always_visible;

-- 3. NextFollowupType = the type of the earliest open follow-up  -- expect 0 rows
--    (set @c; no scope JSON, so the SP returns every lead of the company)
DECLARE @c INT = 1;
EXEC dbo.sp_FetchLeads @CompId = @c, @PageSize = 50;   -- eyeball NextFollowupType beside NextFollowupDate
SELECT l.Id, l.NextFollowupDate, x.Type AS expected_type
FROM dbo.tblLeads l
OUTER APPLY (SELECT TOP 1 f.Type FROM dbo.tblFollowUp f
             WHERE f.CompId = l.CompId AND f.LeadId = l.Id AND f.Status = 'open' ORDER BY f.DueAt, f.Id) x
WHERE l.CompId = @c AND l.NextFollowupDate IS NOT NULL
ORDER BY l.CreatedAt DESC, l.Id DESC
OFFSET 0 ROWS FETCH NEXT 50 ROWS ONLY;

-- 4. Lost closes the open follow-ups, and only that lead's (TestCRM only; rolled back).
--    Pick an active lead with an open follow-up, and a lost_reason id.
BEGIN TRAN;
DECLARE @lead INT = (SELECT TOP 1 f.LeadId FROM dbo.tblFollowUp f JOIN dbo.tblLeads l ON l.Id = f.LeadId
                     JOIN dbo.tblLookup st ON st.Id = l.StatusId
                     WHERE f.CompId = @c AND f.Status = 'open' AND st.Code IN ('open','qualified'));
DECLARE @lost INT = (SELECT TOP 1 Id FROM dbo.tblLookup WHERE CompId = @c AND Kind = 'lead_status' AND Code = 'lost' AND IsActive = 1);
DECLARE @why  INT = (SELECT TOP 1 Id FROM dbo.tblLookup WHERE CompId = @c AND Kind = 'lost_reason');
DECLARE @otherOpen INT = (SELECT COUNT(*) FROM dbo.tblFollowUp WHERE CompId = @c AND Status = 'open' AND LeadId <> @lead);
EXEC dbo.sp_SetLeadStatus @CompId = @c, @LeadId = @lead, @StatusId = @lost, @LostReasonId = @why, @UserId = 1;
SELECT (SELECT COUNT(*) FROM dbo.tblFollowUp WHERE LeadId = @lead AND Status = 'open')        AS open_left,        -- expect 0
       (SELECT TOP 1 Remarks FROM dbo.tblFollowUp WHERE LeadId = @lead AND Status = 'skipped'
        ORDER BY UpdatedAt DESC)                                                             AS remark,           -- expect 'Lead marked Lost'
       (SELECT NextFollowupDate FROM dbo.tblLeads WHERE Id = @lead)                          AS next_date,        -- expect NULL
       (SELECT TOP 1 Summary FROM dbo.tblLeadActivity WHERE LeadId = @lead ORDER BY Id DESC) AS last_activity,    -- expect 'Follow-up skipped: Lead marked Lost'
       (SELECT COUNT(*) FROM dbo.tblFollowUp WHERE CompId = @c AND Status = 'open' AND LeadId <> @lead)
         - @otherOpen                                                                        AS others_changed;   -- expect 0
ROLLBACK;

-- 5. Transfer summary carries the remarks (after a real transfer on TestCRM):
SELECT TOP 5 TicketId, Summary FROM dbo.tblTicketActivity
WHERE Type = 'assigned' ORDER BY Id DESC;   -- expect "Transferred to … — <reason> — <remarks>"
*/
