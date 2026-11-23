-- ===========================================================================
-- 139 - access model: fixes from the final branch review (2026-11-23,
--       .superpowers/sdd/2026-11-22-access-model/final-review.md; rulings
--       FR-I1, FR-I2, FR-minor in progress.md).
--
-- Apply by hand, TestCRM FIRST, then eCRM+ and SolarCRM once it is checked:
--   sqlcmd -I -b -f 65001 -S <server> -U <login> -d TestCRM -i 139_access_model_review_fixes.sql
--   -I = QUOTED_IDENTIFIER ON (093 lesson), -b = stop at the first error,
--   -f 65001 = read the file as UTF-8. Needs 130-134 on the same database.
--   Idempotent: every object is CREATE OR ALTER, every patch is skipped when
--   its marker is already in the live text, so a re-run changes nothing.
--   Ship the backend of this branch in the same sitting (attachment upload
--   calls sp_LoggerMayAttach; the clients read lead CanReopen).
--
-- What changes:
--   I1  sp_LoggerMayAttach (new): the person who CREATED a lead / complaint
--       may upload files to it for 15 minutes after CreatedAt, even when it
--       was created onto someone else (and they no longer see it). Upload
--       only: list / download / delete still need the record to be visible.
--       They also need the module's Add right now. attachmentController.save
--       asks this only after the normal gate refused.
--   I2  fn_RecordActions.CanReopen now answers for leads too, by the
--       complaint rule: Edit AND terminal status (lead: lost / junk /
--       converted) AND (reach >= Office OR (Team AND the holder is one of my
--       people, never myself)). sp_SetLeadStatus refuses terminal -> active
--       without it: 403 'Only a manager can reopen a closed lead'.
--       sp_FetchLeadDetail RS1 gains CanReopen.
--   m1  A 404 from these procedures now always means "that record is not
--       there for you". The lookups that meant something else answer 400:
--       sp_SetTicketStatus / sp_SetLeadStatus 'Status not found',
--       sp_SaveTicket 'Customer not found'.
--   m2  fn_RecordActions.SendBackToId only when CanReassign = 1 (gate 3 of
--       fn_ReassignGate refuses a send back otherwise, so the button lied).
--   m3  sp_TransferLead / sp_BulkTransferLeads hand over the follow-ups of
--       the HOLDER (OwnerId, else the logger while LoggerHolds = 1), not of
--       OwnerId only (D26 / D3).
--
-- How the procedures are changed: fn_RecordActions and sp_LoggerMayAttach are
-- written out whole. The six procedures are PATCHED in their live text (the
-- 119 pattern): each patch names one anchor that must occur exactly once and a
-- marker that only the patched text contains; a patch whose marker is present
-- is skipped; a missing / repeated anchor stops the run with nothing patched
-- (all patches run in one transaction). sp_SetLeadStatus's live body is 107's
-- plus 119's patch and is not in the repository, which is why patching is used.
--
-- ROLLBACK (135): every object is saved with sp_AccessModelBackup under
-- ScriptNo 133, because 139 amends 131-133 and must come and go with them:
--   135 -v From=130 or 131  -> undoes 139 too: sp_SetLeadStatus is restored
--       from its first save (taken here = its pre-130 text), the others from
--       their 131/132/133 saves (also pre-130), sp_LoggerMayAttach is dropped.
--   135 -v From=134         -> 139 stays (it is not part of 134).
-- After a partial rollback, re-run 130-134 and then 139.
--
-- sqlcmd splits on GO even inside comments: every note is a `--` line comment.
-- ===========================================================================
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- ---------------------------------------------------------------------------
-- 1. Refuse unless 130-133 are applied.
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.sp_AccessModelBackup', 'P') IS NULL
   OR OBJECT_ID('dbo.fn_RecordActions') IS NULL
   OR OBJECT_ID('dbo.fn_ReassignGate') IS NULL
   OR OBJECT_ID('dbo.sp_FetchLoggedByMe', 'P') IS NULL
BEGIN
    RAISERROR('139: scripts 130-134 are not applied to this database. Apply them first. Nothing was changed.', 16, 1);
    SET NOEXEC ON;
END
GO

-- ---------------------------------------------------------------------------
-- 2. Backups (first save wins; filed under 133, see the header).
--    Already saved by 131-133, so these are no-ops there: fn_RecordActions,
--    sp_FetchLeadDetail, sp_SaveTicket, sp_SetTicketStatus, sp_TransferLead,
--    sp_BulkTransferLeads. New saves: sp_SetLeadStatus (its pre-139 text) and
--    sp_LoggerMayAttach (Definition NULL: 135 drops it).
-- ---------------------------------------------------------------------------
EXEC dbo.sp_AccessModelBackup 133, 'fn_RecordActions';
EXEC dbo.sp_AccessModelBackup 133, 'sp_FetchLeadDetail';
EXEC dbo.sp_AccessModelBackup 133, 'sp_SaveTicket';
EXEC dbo.sp_AccessModelBackup 133, 'sp_SetTicketStatus';
EXEC dbo.sp_AccessModelBackup 133, 'sp_TransferLead';
EXEC dbo.sp_AccessModelBackup 133, 'sp_BulkTransferLeads';
EXEC dbo.sp_AccessModelBackup 133, 'sp_SetLeadStatus';
EXEC dbo.sp_AccessModelBackup 133, 'sp_LoggerMayAttach';
GO

-- ---------------------------------------------------------------------------
-- 3. fn_RecordActions (I2, m2). Same signature and columns as 131.
--      CanReassign  = Edit AND (ReachLevel >= 3 OR in progress)
--      CanReopen    = Edit AND terminal AND (ReachLevel >= 3 OR (ReachLevel = 2
--                     AND the holder is one of my people, never myself))
--                     terminal: complaint resolved / closed / rejected,
--                               lead lost / junk / converted       (139: leads too)
--      SendBackToId = fn_RecordGiver when I hold it AND CanReassign  (139)
-- ---------------------------------------------------------------------------
CREATE OR ALTER FUNCTION dbo.fn_RecordActions (@CompId BIGINT, @UserId INT, @Module VARCHAR(30), @RecordId INT)
RETURNS TABLE
AS
RETURN
SELECT CAST(r.InProgress AS BIT) AS InProgress,
       s.CanEdit,
       CAST(c.CanReassign AS BIT) AS CanReassign,
       CAST(CASE WHEN s.CanEdit = 1 AND r.Terminal = 1
                  AND (   ISNULL(s.ReachLevel, 1) >= 3
                       OR (s.ReachLevel = 2
                           AND r.AssignedTo IN (SELECT UserId FROM dbo.fn_AccessPeople(@CompId, @UserId))))
                 THEN 1 ELSE 0 END AS BIT) AS CanReopen,
       CASE WHEN c.CanReassign = 1 THEN dbo.fn_RecordGiver(@CompId, @Module, @RecordId, @UserId) END AS SendBackToId
FROM dbo.fn_AccessScope(@CompId, @UserId, @Module) s
CROSS JOIN (
    SELECT t.AssignedTo,
           CASE WHEN st.Code IN ('open', 'onhold') THEN 1 ELSE 0 END AS InProgress,
           CASE WHEN st.Code IN ('resolved', 'closed', 'rejected') THEN 1 ELSE 0 END AS Terminal
    FROM dbo.tblTicket t
    JOIN dbo.tblLookup st ON st.Id = t.StatusId
    WHERE @Module = 'complaints' AND t.Id = @RecordId AND t.CompId = @CompId
      AND t.Id IN (SELECT TicketId FROM dbo.fn_VisibleTickets(@CompId, @UserId))
    UNION ALL
    SELECT l.OwnerId,
           CASE WHEN st.Code IN ('open', 'qualified') THEN 1 ELSE 0 END,
           CASE WHEN st.Code IN ('lost', 'junk', 'converted') THEN 1 ELSE 0 END
    FROM dbo.tblLeads l
    JOIN dbo.tblLookup st ON st.Id = l.StatusId
    WHERE @Module = 'leads' AND l.Id = @RecordId AND l.CompId = @CompId
      AND l.Id IN (SELECT LeadId FROM dbo.fn_VisibleLeads(@CompId, @UserId))
) r
CROSS APPLY (SELECT CASE WHEN s.CanEdit = 1 AND (ISNULL(s.ReachLevel, 1) >= 3 OR r.InProgress = 1)
                         THEN 1 ELSE 0 END AS CanReassign) c;
GO

-- ---------------------------------------------------------------------------
-- 4. sp_LoggerMayAttach (I1). One row, MayAttach 1/0. 1 = @UserId created
--    this lead (@Entity 'lead') / complaint ('ticket') of @CompId less than
--    15 minutes ago and holds the module's Add right now. Says nothing about
--    visibility: the caller answers a 0 exactly like a missing record.
--    ponytail: fixed 15-minute window (FR-I1); a company setting if anyone asks.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_LoggerMayAttach
    @CompId   BIGINT,
    @UserId   INT,
    @Entity   VARCHAR(20),
    @EntityId INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Since DATETIME = DATEADD(MINUTE, -15, GETDATE());
    SELECT CAST(CASE WHEN EXISTS (
               SELECT 1
               FROM dbo.fn_AccessScope(@CompId, @UserId,
                        CASE @Entity WHEN 'ticket' THEN 'complaints' WHEN 'lead' THEN 'leads' END) s
               WHERE s.CanAdd = 1
                 AND (   (@Entity = 'ticket' AND EXISTS (
                             SELECT 1 FROM dbo.tblTicket t
                             WHERE t.Id = @EntityId AND t.CompId = @CompId
                               AND t.CreatedBy = @UserId AND t.CreatedAt >= @Since))
                      OR (@Entity = 'lead' AND EXISTS (
                             SELECT 1 FROM dbo.tblLeads l
                             WHERE l.Id = @EntityId AND l.CompId = @CompId
                               AND l.CreatedBy = @UserId AND l.CreatedAt >= @Since))))
                THEN 1 ELSE 0 END AS BIT) AS MayAttach;
END
GO

-- ---------------------------------------------------------------------------
-- 5. Patches to the live procedures, all or nothing.
-- ---------------------------------------------------------------------------
SET XACT_ABORT ON;
DECLARE @nl NCHAR(1) = NCHAR(10);
DECLARE @patch TABLE (Seq INT PRIMARY KEY, ProcName SYSNAME, Marker NVARCHAR(200), Anchor NVARCHAR(400), Repl NVARCHAR(MAX));
INSERT INTO @patch (Seq, ProcName, Marker, Anchor, Repl) VALUES
-- I2: the lead reopen gate, before the "already in this status" answer.
(1, N'sp_SetLeadStatus', N'/* 139: reopen gate',
    N'IF @FromStatusId = @StatusId',
    N'/* 139: reopen gate - a closed lead back to an active status needs fn_RecordActions.CanReopen */' + @nl
  + N'    IF @FromCode IN (''lost'', ''junk'', ''converted'') AND @ToCode NOT IN (''lost'', ''junk'', ''converted'')' + @nl
  + N'       AND NOT EXISTS (SELECT 1 FROM dbo.fn_RecordActions(@CompId, @UserId, ''leads'', @LeadId) WHERE CanReopen = 1)' + @nl
  + N'    BEGIN SELECT @LeadId AS Id, 403 AS ResponseCode, ''Only a manager can reopen a closed lead'' AS ResponseMess; RETURN; END' + @nl
  + N'    IF @FromStatusId = @StatusId'),
-- m1: a bad status / customer id is a bad request, not a missing record.
(2, N'sp_SetLeadStatus', N'400 AS ResponseCode, ''Status not found''',
    N'404 AS ResponseCode, ''Status not found''',
    N'400 AS ResponseCode, ''Status not found'''),
(3, N'sp_SetTicketStatus', N'400 AS ResponseCode, ''Status not found''',
    N'404 AS ResponseCode, ''Status not found''',
    N'400 AS ResponseCode, ''Status not found'''),
(4, N'sp_SaveTicket', N'400 AS ResponseCode, ''Customer not found''',
    N'404 AS ResponseCode, ''Customer not found''',
    N'400 AS ResponseCode, ''Customer not found'''),
-- m3: the holder's follow-ups go with the lead.
(5, N'sp_TransferLead', N'AssignedTo = ISNULL(@FromUserId, @FromHolder)',
    N'CASE WHEN AssignedTo = @FromUserId OR AssignedTo IS NULL',
    N'CASE WHEN AssignedTo = ISNULL(@FromUserId, @FromHolder) OR AssignedTo IS NULL'),
(6, N'sp_BulkTransferLeads', N'f.AssignedTo = ISNULL(i.FromUserId, i.FromHolder)',
    N'CASE WHEN f.AssignedTo = i.FromUserId OR f.AssignedTo IS NULL',
    N'CASE WHEN f.AssignedTo = ISNULL(i.FromUserId, i.FromHolder) OR f.AssignedTo IS NULL'),
-- I2: lead detail RS1 carries CanReopen.
(7, N'sp_FetchLeadDetail', N'@CanReopen139 = ISNULL(a.CanReopen, 0)',
    N'SELECT @Vis = 1, @CanEdit = ISNULL(a.CanEdit, 0), @CanReassign = ISNULL(a.CanReassign, 0), @SendBackToId = a.SendBackToId',
    N'DECLARE @CanReopen139 BIT = 0;   -- 139' + @nl
  + N'    SELECT @Vis = 1, @CanEdit = ISNULL(a.CanEdit, 0), @CanReassign = ISNULL(a.CanReassign, 0), @SendBackToId = a.SendBackToId,' + @nl
  + N'           @CanReopen139 = ISNULL(a.CanReopen, 0)'),
(8, N'sp_FetchLeadDetail', N'@CanReopen139 AS CanReopen',
    N'@CanEdit AS CanEdit, @CanReassign AS CanReassign,',
    N'@CanEdit AS CanEdit, @CanReassign AS CanReassign, @CanReopen139 AS CanReopen,');

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
        BEGIN SET @msg = N'139: dbo.' + @p + N' not found'; THROW 50139, @msg, 1; END

        IF CHARINDEX(@marker, @def) > 0
            PRINT N'139: patch ' + CAST(@seq AS NVARCHAR(5)) + N' already in ' + @p + N', skipped';
        ELSE
        BEGIN
            IF (DATALENGTH(@def) - DATALENGTH(REPLACE(@def, @a, N''))) / DATALENGTH(@a) <> 1
            BEGIN
                SET @msg = N'139: patch ' + CAST(@seq AS NVARCHAR(5)) + N': anchor not found exactly once in live dbo.' + @p
                         + N' - nothing patched; diff its OBJECT_DEFINITION';
                THROW 50139, @msg, 1;
            END
            SET @hdr = N'PROC dbo.' + @p;
            IF (DATALENGTH(@def) - DATALENGTH(REPLACE(@def, @hdr, N''))) / DATALENGTH(@hdr) <> 1
            BEGIN
                SET @msg = N'139: header "' + @hdr + N'" not found exactly once - nothing patched';
                THROW 50139, @msg, 1;
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
                BEGIN SET @msg = N'139: unreadable header in dbo.' + @p + N' - nothing patched'; THROW 50139, @msg, 1; END
                SET @k -= 2;
                WHILE @k > 0 AND SUBSTRING(@def, @k, 1) IN (N' ', NCHAR(9), NCHAR(10), NCHAR(13)) SET @k -= 1;
            END
            IF @k < 6 OR SUBSTRING(@def, @k - 5, 6) <> N'CREATE'
            BEGIN SET @msg = N'139: no CREATE before "' + @hdr + N'" - nothing patched'; THROW 50139, @msg, 1; END
            SET @def = STUFF(@def, @k - 5, @h - (@k - 5), N'CREATE OR ALTER ');

            EXEC (@def);
            PRINT N'139: patch ' + CAST(@seq AS NVARCHAR(5)) + N' applied to ' + @p;
        END
        SET @seq += 1;
    END
    COMMIT;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    PRINT N'139: FAILED - no procedure was patched (sections 3-4 are in place; re-run after fixing).';
    THROW;
END CATCH
GO

SET NOEXEC OFF;
GO

-- ===========================================================================
-- VERIFY AFTER APPLY (read-only; expected answer after each query).
-- ===========================================================================
-- 1. Every patch is in -> 8 rows, Applied = 1
-- SELECT v.ProcName, v.Marker,
--        CASE WHEN CHARINDEX(v.Marker, OBJECT_DEFINITION(OBJECT_ID('dbo.' + v.ProcName))) > 0 THEN 1 ELSE 0 END AS Applied
-- FROM (VALUES ('sp_SetLeadStatus', '/* 139: reopen gate'),
--              ('sp_SetLeadStatus', '400 AS ResponseCode, ''Status not found'''),
--              ('sp_SetTicketStatus', '400 AS ResponseCode, ''Status not found'''),
--              ('sp_SaveTicket', '400 AS ResponseCode, ''Customer not found'''),
--              ('sp_TransferLead', 'AssignedTo = ISNULL(@FromUserId, @FromHolder)'),
--              ('sp_BulkTransferLeads', 'f.AssignedTo = ISNULL(i.FromUserId, i.FromHolder)'),
--              ('sp_FetchLeadDetail', '@CanReopen139 = ISNULL(a.CanReopen, 0)'),
--              ('sp_FetchLeadDetail', '@CanReopen139 AS CanReopen')) v (ProcName, Marker);
--
-- 2. Saves for rollback -> 2 rows: sp_LoggerMayAttach (HasText 0), sp_SetLeadStatus (HasText 1), both ScriptNo 133
-- SELECT ObjName, ScriptNo, CASE WHEN Definition IS NULL THEN 0 ELSE 1 END AS HasText
-- FROM dbo.tblAccessModelBackup WHERE ObjName IN ('sp_LoggerMayAttach', 'sp_SetLeadStatus');
--
-- 3. Lead reopen rule (TestCRM; pick a lost lead held by a Sales Executive on Own, @se,
--    and their Office-reach manager @mgr) -> 0 then 1
-- SELECT CanReopen FROM dbo.fn_RecordActions(1, @se,  'leads', @lostLead);
-- SELECT CanReopen FROM dbo.fn_RecordActions(1, @mgr, 'leads', @lostLead);
--    and on a scratch lead (TestCRM only) as @se:
-- EXEC dbo.sp_SetLeadStatus @CompId = 1, @LeadId = @lostLead, @StatusId = @openStatus, @UserId = @se;
--    -> 403 'Only a manager can reopen a closed lead'
--
-- 4. Send back hidden when reassign is refused: an Own agent on a resolved complaint
--    that was given to them -> CanReassign 0, SendBackToId NULL
-- SELECT CanReassign, SendBackToId FROM dbo.fn_RecordActions(1, @agent, 'complaints', @resolvedTicket);
--
-- 5. Logger upload window: as the desk agent right after logging a complaint onto
--    someone else -> 1; for any complaint they did not create, or after 15 min -> 0
-- EXEC dbo.sp_LoggerMayAttach @CompId = 1, @UserId = @desk, @Entity = 'ticket', @EntityId = @justLogged;
--
-- 6. Bad status is 400 now -> ResponseCode 400 'Status not found'
-- EXEC dbo.sp_SetTicketStatus @CompId = 1, @TicketId = @anyVisible, @StatusId = -5, @UserId = @admin;
--    (StatusId <= 0 may stop earlier at 'StatusId is required'; use an id of another Kind instead)
-- ===========================================================================
