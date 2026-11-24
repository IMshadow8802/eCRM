-- ===========================================================================
-- 133 - access model: the writes. Assignment, send back, follow-up scheduling,
--       reopen and escalation gates inside the database; the notices; the
--       LoggerHolds constraint.
--       (spec docs/superpowers/specs/2026-11-21-access-model/design.md
--        sections 2.4, 2.6, 3.1, 3.2, 3.3, 3.7, 11 SQL 7/8;
--        plan 2026-11-22-access-model Task 5, Rulings 6, 12, 13, 15, 16;
--        pre-flight B1, S2, S6, S7, S18; review C2)
--
-- Apply by hand:  sqlcmd -I -b ... -i 133_access_model_writes.sql
--   -I = QUOTED_IDENTIFIER ON (093 lesson), -b = stop at the first error.
-- Needs 131 and 132 on the same database; 133 refuses otherwise (and SETs
-- NOEXEC ON). 134 follows in the same sitting (plan Ruling 1).
--
-- Every object below is first saved into dbo.tblAccessModelBackup through
-- dbo.sp_AccessModelBackup (first save wins; Definition NULL = it did not
-- exist, so 135 drops it). The two CHECK constraints are recorded as the
-- pseudo-row '#ck_loggerholds_133' (135 drops CK_tblTicket_LoggerHolds and
-- CK_tblLeads_LoggerHolds).
--
-- THE REASSIGN GATES (written once, in fn_ReassignGate; single and bulk procs
-- read it, never restate it). First failure answers:
--   1 record visible (fn_RecordActions row)    404 Record not found
--   2 module Edit                              403 You do not have permission for this action
--   3 CanReassign (Edit AND (reach >= Office
--     OR in progress))                         403 Only a manager can reassign a closed record
--   4 send back: caller holds it, a raw giver  400 There is nobody to send this back to.
--     exists, and is still eligible            400 <FullName> can no longer take this. Reassign it instead.
--   5 unassign needs reach >= Office           403 Only a manager can leave a record unassigned
--   6 person in fn_AssignableUsers             403 You cannot assign records to that person
--     (skipped for send back and when the person does not change)
--   7 office table of spec 2.4                 400 Assign it to someone in that office, or unassign it first
--     (a named office must be an active office of the company: fn_CompanyOffice)
--   8 (in the procs) reason + remarks, the existing 400 messages; send back:
--     remarks only, reason = the company's `sent_back` lookup.
--   Bulk (Ruling 6, all-or-nothing, 1-200 ids): the first failing gate's code
--   and message + " (n of m refused)", e.g.
--   "Only a manager can reassign a closed record (2 of 5 refused)".
--   Gates run before the transaction; the writes then re-check the row they
--   read (AssignedTo, BranchId, StatusId) and answer 409 if it moved meanwhile.
--
-- Created / replaced (exact signatures; backend and clients depend on them):
--   fn_CompanyOffice (@CompId BIGINT, @BranchId BIGINT) -> BranchId (0/1 row: an active office of the company)  inline
--   fn_ReassignGate (@CompId BIGINT, @UserId INT, @Module VARCHAR(30), @RecordId INT,
--                    @ToUserId INT, @ToBranchId BIGINT, @SendBack BIT)
--        -> Gate, Code, Message, FromUserId, FromBranchId, ToUserId, ToBranchId (one row)
--   sp_TransferTicket  @CompId, @TicketId, @ToUserId = NULL, @ToBranchId = NULL,
--                      @ReasonId, @Remarks, @UserId, @SendBack BIT = 0
--   sp_TransferLead    @CompId, @LeadId, @ToUserId = NULL, @ToBranchId = NULL,
--                      @ReasonId, @Remarks, @UserId, @SendBack BIT = 0
--        status row: Id, ResponseCode, ResponseMess, FromUserId, ToUserId, ToName
--   sp_BulkTransferTickets / sp_BulkTransferLeads  (parameters unchanged)
--        status row: Transferred, Skipped, Moved, Refused, ResponseCode, ResponseMess
--        RS2 on success: UserId (every previous and new holder of a moved record)
--   sp_SaveTicket / sp_SaveLead (parameters unchanged)
--   sp_ScheduleFollowUp (parameters unchanged)
--   sp_SetTicketStatus @CompId, @TicketId, @StatusId, @UserId, @ResolutionId = NULL,
--                      @Remarks = NULL, @DueAtOverride = NULL     (@AllowReopen gone)
--   sp_ReopenTicket    @CompId, @TicketId, @Remarks, @UserId, @DueAtOverride = NULL
--   sp_ResolveTicket / sp_CloseTicket / sp_RejectTicket (parameters unchanged; B1)
--   sp_EscalateTicket  (parameters unchanged)
--   sp_FetchTicketEscalationTargets (new) @CompId BIGINT, @UserId INT, @TicketId INT, @ForUserId INT
--   sp_SaveUser        (same parameters, @ActorUserId now required: no default, NULL -> 400;
--                       success rows gain StrandedLeads, StrandedComplaints)
-- sp_FetchEscalationTargets is NOT touched (plan Ruling 3; tatController).
--
-- sqlcmd splits on GO even inside comments: every note is a `--` line comment.
-- ===========================================================================
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- ---------------------------------------------------------------------------
-- 1. Refuse unless 131 and 132 are applied (S18).
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.sp_AccessModelBackup', 'P') IS NULL
   OR OBJECT_ID('dbo.fn_RecordActions') IS NULL
   OR OBJECT_ID('dbo.fn_AssignableUsers') IS NULL
   OR OBJECT_ID('dbo.sp_FetchLoggedByMe', 'P') IS NULL
BEGIN
    RAISERROR('133: scripts 131 and 132 are not both applied to this database. Apply them first. Nothing was changed.', 16, 1);
    SET NOEXEC ON;
END
GO

-- ---------------------------------------------------------------------------
-- 2. Back up every object this script creates or replaces (first save wins).
-- ---------------------------------------------------------------------------
EXEC dbo.sp_AccessModelBackup 133, 'fn_CompanyOffice';
EXEC dbo.sp_AccessModelBackup 133, 'fn_ReassignGate';
EXEC dbo.sp_AccessModelBackup 133, 'sp_FetchTicketEscalationTargets';
EXEC dbo.sp_AccessModelBackup 133, 'sp_SaveTicket';
EXEC dbo.sp_AccessModelBackup 133, 'sp_SaveLead';
EXEC dbo.sp_AccessModelBackup 133, 'sp_TransferTicket';
EXEC dbo.sp_AccessModelBackup 133, 'sp_TransferLead';
EXEC dbo.sp_AccessModelBackup 133, 'sp_BulkTransferTickets';
EXEC dbo.sp_AccessModelBackup 133, 'sp_BulkTransferLeads';
EXEC dbo.sp_AccessModelBackup 133, 'sp_ScheduleFollowUp';
EXEC dbo.sp_AccessModelBackup 133, 'sp_SetTicketStatus';
EXEC dbo.sp_AccessModelBackup 133, 'sp_ReopenTicket';
EXEC dbo.sp_AccessModelBackup 133, 'sp_ResolveTicket';
EXEC dbo.sp_AccessModelBackup 133, 'sp_CloseTicket';
EXEC dbo.sp_AccessModelBackup 133, 'sp_RejectTicket';
EXEC dbo.sp_AccessModelBackup 133, 'sp_EscalateTicket';
EXEC dbo.sp_AccessModelBackup 133, 'sp_SaveUser';
IF NOT EXISTS (SELECT 1 FROM dbo.tblAccessModelBackup WHERE ObjName = '#ck_loggerholds_133')
    INSERT INTO dbo.tblAccessModelBackup (ObjName, ScriptNo, ObjType, Definition, SavedAt)
    VALUES ('#ck_loggerholds_133', 133, NULL,
            N'["CK_tblTicket_LoggerHolds","CK_tblLeads_LoggerHolds"]', GETDATE());
GO

-- ---------------------------------------------------------------------------
-- 2b. fn_CompanyOffice: one row when @BranchId is an ACTIVE office of
--     @CompId, none otherwise. tblBranch has no CompId, so an office belongs
--     to a company when an active person of that company is based there or
--     holds an extra-office grant on it (tblUserBranchAccess.CompId). Every
--     write that accepts an office reads this (review fix 1).
--     ponytail: an office nobody of the company works in cannot be targeted;
--     add tblBranch.CompId if that ever matters.
-- ---------------------------------------------------------------------------
CREATE OR ALTER FUNCTION dbo.fn_CompanyOffice (@CompId BIGINT, @BranchId BIGINT)
RETURNS TABLE
AS
RETURN
SELECT b.Id AS BranchId
FROM dbo.tblBranch b
WHERE b.Id = @BranchId AND b.IsActive = 1
  AND (   EXISTS (SELECT 1 FROM dbo.tblUser u
                  WHERE u.BranchId = b.Id AND u.CompId = @CompId AND u.IsActive = 1)
       OR EXISTS (SELECT 1 FROM dbo.tblUserBranchAccess a
                  WHERE a.BranchId = b.Id AND a.CompId = @CompId AND a.CanRead = 1));
GO

-- ---------------------------------------------------------------------------
-- 3. fn_ReassignGate (pre-flight S6): gates 1-7 of a reassign, on top of
--    fn_RecordActions and fn_AssignableUsers. Always one row. Code 200 =
--    allowed; then ToUserId / ToBranchId are the effective target (send back
--    resolves the giver; Rule 3 resolves the office).
--    works in an office = fn_AccessOffices Level 3 of that person (home, or an
--    extra office with CanRead, read-only included).
--    An office named equal to the record's own office counts as not named
--    (old clients send the current office back).
--    Send back ignores a named office: the office follows the giver (Rule 3).
--    ponytail: per-record cost = one fn_VisibleTickets/Leads + one
--    fn_AssignableUsers; a 200-id bulk call runs it 200 times. Fine at
--    today's sizes; a set-based variant is the upgrade if bulk ever drags.
-- ---------------------------------------------------------------------------
CREATE OR ALTER FUNCTION dbo.fn_ReassignGate
(
    @CompId     BIGINT,
    @UserId     INT,
    @Module     VARCHAR(30),
    @RecordId   INT,
    @ToUserId   INT,
    @ToBranchId BIGINT,
    @SendBack   BIT
)
RETURNS @G TABLE (Gate TINYINT NOT NULL, Code INT NOT NULL, Message NVARCHAR(300) NOT NULL,
                  FromUserId INT NULL, FromBranchId BIGINT NULL, ToUserId INT NULL, ToBranchId BIGINT NULL)
AS
BEGIN
    DECLARE @Found BIT = 0, @CanEdit BIT, @CanReassign BIT, @Giver INT, @Lvl TINYINT,
            @Assigned INT, @Branch BIGINT, @Raw INT;

    SELECT @Found = 1, @CanEdit = a.CanEdit, @CanReassign = a.CanReassign, @Giver = a.SendBackToId
    FROM dbo.fn_RecordActions(@CompId, @UserId, @Module, @RecordId) a;

    IF @Found = 0
    BEGIN INSERT INTO @G (Gate, Code, Message) VALUES (1, 404, N'Record not found'); RETURN; END
    IF ISNULL(@CanEdit, 0) = 0
    BEGIN INSERT INTO @G (Gate, Code, Message) VALUES (2, 403, N'You do not have permission for this action'); RETURN; END
    IF ISNULL(@CanReassign, 0) = 0
    BEGIN INSERT INTO @G (Gate, Code, Message) VALUES (3, 403, N'Only a manager can reassign a closed record'); RETURN; END

    SELECT @Lvl = ISNULL(ReachLevel, 1) FROM dbo.fn_AccessScope(@CompId, @UserId, @Module);
    IF @Module = 'complaints'
        SELECT @Assigned = AssignedTo, @Branch = BranchId FROM dbo.tblTicket WHERE Id = @RecordId AND CompId = @CompId;
    ELSE
        SELECT @Assigned = OwnerId, @Branch = BranchId FROM dbo.tblLeads WHERE Id = @RecordId AND CompId = @CompId;

    IF @ToUserId IS NOT NULL AND @ToUserId <= 0 SET @ToUserId = NULL;
    IF @ToBranchId = @Branch SET @ToBranchId = NULL;

    -- Gate 4: send back. The RAW giver (pre-flight S2): AssignedBy of the latest
    -- history row to me that is not itself a send-back (fn_RecordGiver's own
    -- SELECT, without its eligibility check), so the refusal can name them.
    IF ISNULL(@SendBack, 0) = 1
    BEGIN
        IF ISNULL(@Assigned, -1) = @UserId
        BEGIN
            IF @Module = 'complaints'
                SELECT TOP (1) @Raw = a.AssignedBy
                FROM dbo.tblTicketAssignment a
                LEFT JOIN dbo.tblLookup r ON r.Id = a.ReasonId
                WHERE a.TicketId = @RecordId AND a.CompId = @CompId AND a.ToUserId = @UserId
                  AND ISNULL(r.Code, '') <> 'sent_back'
                ORDER BY a.AssignedAt DESC, a.Id DESC;
            ELSE
                SELECT TOP (1) @Raw = a.AssignedBy
                FROM dbo.tblLeadAssignment a
                LEFT JOIN dbo.tblLookup r ON r.Id = a.ReasonId
                WHERE a.LeadId = @RecordId AND a.CompId = @CompId AND a.ToUserId = @UserId
                  AND ISNULL(r.Code, '') <> 'sent_back'
                ORDER BY a.AssignedAt DESC, a.Id DESC;
        END
        IF @Raw IS NULL OR @Raw = @UserId
        BEGIN INSERT INTO @G (Gate, Code, Message) VALUES (4, 400, N'There is nobody to send this back to.'); RETURN; END
        IF @Giver IS NULL
        BEGIN
            INSERT INTO @G (Gate, Code, Message)
            VALUES (4, 400, ISNULL((SELECT FullName FROM dbo.tblUser WHERE Id = @Raw AND CompId = @CompId), N'That person')
                            + N' can no longer take this. Reassign it instead.');
            RETURN;
        END
        SELECT @ToUserId = @Giver, @ToBranchId = NULL;
    END

    -- Gate 5: unassign.
    IF @ToUserId IS NULL AND @Lvl < 3
    BEGIN INSERT INTO @G (Gate, Code, Message) VALUES (5, 403, N'Only a manager can leave a record unassigned'); RETURN; END

    -- Gate 6: the person (Rule 2). Not asked for a send back (the giver is
    -- allowed outside the list) nor when the person stays the same.
    IF @ToUserId IS NOT NULL AND ISNULL(@SendBack, 0) = 0 AND @ToUserId <> ISNULL(@Assigned, -1)
       AND NOT EXISTS (SELECT 1 FROM dbo.fn_AssignableUsers(@CompId, @UserId, @Module, @RecordId) WHERE Id = @ToUserId)
    BEGIN INSERT INTO @G (Gate, Code, Message) VALUES (6, 403, N'You cannot assign records to that person'); RETURN; END

    -- Gate 7: the office (spec 2.4).
    IF @ToBranchId IS NOT NULL
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.fn_CompanyOffice(@CompId, @ToBranchId))   -- active, this company
           OR NOT (   @Lvl = 5
                OR (@Lvl IN (3, 4) AND EXISTS (SELECT 1 FROM dbo.fn_AccessOffices(@CompId, @UserId) o
                                               WHERE o.BranchId = @ToBranchId AND o.CanWrite = 1
                                                 AND (o.Level = 3 OR @Lvl = 4))))
           OR (@ToUserId IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM dbo.fn_AccessOffices(@CompId, @ToUserId) o
                               WHERE o.BranchId = @ToBranchId AND o.Level = 3))
        BEGIN INSERT INTO @G (Gate, Code, Message) VALUES (7, 400, N'Assign it to someone in that office, or unassign it first'); RETURN; END
    END
    ELSE
        -- Rule 3: no office named -> it stays unless the person does not work
        -- there; then their home office, if that is an active office of this
        -- company (else it stays).
        SET @ToBranchId = CASE WHEN @ToUserId IS NULL
                                 OR EXISTS (SELECT 1 FROM dbo.fn_AccessOffices(@CompId, @ToUserId) o
                                            WHERE o.BranchId = @Branch AND o.Level = 3)
                               THEN @Branch
                               ELSE ISNULL((SELECT u.BranchId FROM dbo.tblUser u
                                            CROSS APPLY dbo.fn_CompanyOffice(@CompId, u.BranchId) co
                                            WHERE u.Id = @ToUserId AND u.CompId = @CompId), @Branch) END;

    INSERT INTO @G (Gate, Code, Message, FromUserId, FromBranchId, ToUserId, ToBranchId)
    VALUES (0, 200, N'OK', @Assigned, @Branch, @ToUserId, @ToBranchId);
    RETURN;
END
GO

-- ---------------------------------------------------------------------------
-- 4. sp_TransferTicket — reassign / send back / unassign / move office.
--    Gates 1-7 from fn_ReassignGate, gate 8 here (existing 400 messages).
--    On success, one transaction: person + office, LoggerHolds = 0,
--    AssignedAt when the person changes, escalation wiped when the person
--    changes (C2), history row, activity row; DueAt untouched (the clock keeps
--    running). Notices: ticket_assigned to the new person (not on a send
--    back), ticket_sent_back (body = the remarks) to the giver,
--    ticket_moved_away to the previous holder when someone else moved it.
--    No notice carries a phone number, address or value.
--    Status row: Id, ResponseCode, ResponseMess, FromUserId (previous holder,
--    the logger included), ToUserId, ToName (NULL = unassigned).
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_TransferTicket
    @CompId     INT,
    @TicketId   INT,
    @ToUserId   INT           = NULL,
    @ToBranchId INT           = NULL,
    @ReasonId   INT,
    @Remarks    NVARCHAR(500),
    @UserId     INT,
    @SendBack   BIT           = 0
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Code INT = 200, @Mess NVARCHAR(400) = NULL, @Now DATETIME = GETDATE(),
            @FromUserId INT, @FromHolder INT, @FromBranchId INT, @FromStatusId INT,
            @TicketNo VARCHAR(30), @Subject NVARCHAR(200), @ToName NVARCHAR(200),
            @GToUser INT, @GToBranch BIGINT;
    SET @SendBack = ISNULL(@SendBack, 0);
    SET @Remarks = NULLIF(LTRIM(RTRIM(@Remarks)), N'');

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT @Code = 400, @Mess = 'CompId is required'; GOTO Answer; END
    IF @TicketId IS NULL OR @TicketId <= 0
    BEGIN SELECT @Code = 400, @Mess = 'TicketId is required'; GOTO Answer; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT @Code = 400, @Mess = 'UserId is required'; GOTO Answer; END
    IF @ToUserId IS NOT NULL AND @ToUserId <= 0 SET @ToUserId = NULL;

    SELECT @FromUserId = AssignedTo, @FromBranchId = BranchId, @FromStatusId = StatusId,
           @TicketNo = TicketNo, @Subject = Subject,
           @FromHolder = COALESCE(AssignedTo, CASE WHEN LoggerHolds = 1 THEN CreatedBy END)
    FROM dbo.tblTicket WHERE Id = @TicketId AND CompId = @CompId;

    -- Gates 1-7.
    SELECT @Code = g.Code, @Mess = g.Message, @GToUser = g.ToUserId, @GToBranch = g.ToBranchId
    FROM dbo.fn_ReassignGate(@CompId, @UserId, 'complaints', @TicketId, @ToUserId, @ToBranchId, @SendBack) g;
    IF @Code <> 200 GOTO Answer;
    SELECT @ToUserId = @GToUser, @ToBranchId = @GToBranch;

    -- Gate 8.
    IF @SendBack = 1
    BEGIN
        IF @Remarks IS NULL
        BEGIN SELECT @Code = 400, @Mess = 'Remarks are required to send this back'; GOTO Answer; END
        SET @ReasonId = (SELECT TOP 1 Id FROM dbo.tblLookup
                         WHERE CompId = @CompId AND Kind = 'transfer_reason' AND Code = 'sent_back'
                         ORDER BY IsActive DESC, Id);
        IF @ReasonId IS NULL
        BEGIN SELECT @Code = 400, @Mess = 'This company has no Sent back reason configured'; GOTO Answer; END
    END
    ELSE
    BEGIN
        IF @Remarks IS NULL
        BEGIN SELECT @Code = 400, @Mess = 'Remarks are required for a transfer'; GOTO Answer; END
        IF @ReasonId IS NULL OR @ReasonId <= 0
           OR NOT EXISTS (SELECT 1 FROM dbo.tblLookup WHERE Id = @ReasonId AND CompId = @CompId AND Kind = 'transfer_reason')
        BEGIN SELECT @Code = 400, @Mess = 'A transfer reason is required'; GOTO Answer; END
    END

    IF ISNULL(@FromUserId, -1) = ISNULL(@ToUserId, -1) AND @FromBranchId = @ToBranchId
    BEGIN SELECT @Code = 400, @Mess = 'Complaint is already assigned there'; GOTO Answer; END

    SET @ToName = (SELECT FullName FROM dbo.tblUser WHERE Id = @ToUserId);
    DECLARE @PersonChanged BIT = CASE WHEN ISNULL(@FromUserId, -1) = ISNULL(@ToUserId, -1) THEN 0 ELSE 1 END;

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));

        -- Re-check the row the gates read; 409 if it moved meanwhile.
        UPDATE dbo.tblTicket
        SET AssignedTo  = @ToUserId,
            BranchId    = @ToBranchId,
            LoggerHolds = 0,
            AssignedAt  = CASE WHEN @ToUserId IS NULL THEN NULL WHEN @PersonChanged = 1 THEN @Now ELSE AssignedAt END,
            EscalatedTo = CASE WHEN @PersonChanged = 1 THEN NULL ELSE EscalatedTo END,
            EscalatedAt = CASE WHEN @PersonChanged = 1 THEN NULL ELSE EscalatedAt END,
            EditBy = @UserId, UpdatedAt = @Now
        WHERE Id = @TicketId AND CompId = @CompId
          AND ISNULL(AssignedTo, -1) = ISNULL(@FromUserId, -1)
          AND BranchId = @FromBranchId AND StatusId = @FromStatusId;
        IF @@ROWCOUNT = 0
            THROW 50409, 'This complaint changed while you were working on it. Open it again and retry.', 1;

        INSERT INTO dbo.tblTicketAssignment
            (CompId, TicketId, FromUserId, ToUserId, FromBranchId, ToBranchId, ReasonId, Remarks, AssignedBy, AssignedAt)
        VALUES
            (@CompId, @TicketId, @FromUserId, @ToUserId, @FromBranchId, @ToBranchId, @ReasonId, @Remarks, @UserId, @Now);

        DECLARE @Reason NVARCHAR(200) = (SELECT Value FROM dbo.tblLookup WHERE Id = @ReasonId);
        DECLARE @Summary NVARCHAR(500) = LEFT(
            CASE WHEN @SendBack = 1       THEN N'Sent back to ' + ISNULL(@ToName, N'')
                 WHEN @ToUserId IS NULL   THEN N'Unassigned'
                 WHEN @PersonChanged = 0  THEN N'Moved to another office'
                 ELSE N'Reassigned to ' + ISNULL(@ToName, N'') END
            + CASE WHEN @FromBranchId <> @ToBranchId
                   THEN N' (' + ISNULL((SELECT BranchName FROM dbo.tblBranch WHERE Id = @ToBranchId), N'') + N')'
                   ELSE N'' END
            + N' — ' + ISNULL(@Reason, N''), 500);
        DECLARE @Meta NVARCHAR(MAX) = (SELECT @FromUserId AS fromUserId, @ToUserId AS toUserId,
                                              @FromBranchId AS fromBranchId, @ToBranchId AS toBranchId,
                                              @ReasonId AS reasonId, @Remarks AS remarks, @SendBack AS sendBack
                                       FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES);
        INSERT INTO @actLog
        EXEC dbo.sp_LogTicketActivity
            @CompId = @CompId, @TicketId = @TicketId, @UserId = @UserId,
            @Type = 'assigned', @Summary = @Summary, @MetaJSON = @Meta;

        -- Notices (spec 3.7). Recipient active, not the actor, not opted out.
        DECLARE @ActorName NVARCHAR(200) = ISNULL((SELECT FullName FROM dbo.tblUser WHERE Id = @UserId), N'someone');
        DECLARE @N TABLE (UserId INT NOT NULL, Type VARCHAR(40) NOT NULL, Title VARCHAR(200) NOT NULL, Body NVARCHAR(1000) NULL);
        IF @PersonChanged = 1 AND @ToUserId IS NOT NULL AND @SendBack = 0
            INSERT INTO @N VALUES (@ToUserId, 'ticket_assigned', 'Complaint assigned to you',
                                   LEFT(@TicketNo + N' — ' + @Subject, 1000));
        IF @SendBack = 1
            INSERT INTO @N VALUES (@ToUserId, 'ticket_sent_back', 'Complaint sent back to you', LEFT(@Remarks, 1000));
        IF @PersonChanged = 1 AND @FromHolder IS NOT NULL AND @FromHolder <> ISNULL(@ToUserId, -1)
            INSERT INTO @N VALUES (@FromHolder, 'ticket_moved_away', 'Complaint moved away from you',
                                   LEFT(@TicketNo + N' — ' + @Subject + N' (moved by ' + @ActorName + N')', 1000));

        INSERT INTO dbo.tblNotifications (UserId, Type, EntityType, EntityId, ActorUserId, Title, Body, CompId, BranchId)
        SELECT n.UserId, n.Type, 'ticket', @TicketId, @UserId, n.Title, n.Body, @CompId, @ToBranchId
        FROM @N n
        JOIN dbo.tblUser r ON r.Id = n.UserId AND r.CompId = @CompId AND r.IsActive = 1
        WHERE n.UserId <> @UserId
          AND NOT EXISTS (SELECT 1 FROM dbo.tblNotificationPreferences np
                          WHERE np.UserId = n.UserId AND np.Type = n.Type AND np.Channel = 'inapp' AND np.IsEnabled = 0);

        COMMIT TRANSACTION;
        SELECT @Code = 200,
               @Mess = CASE WHEN @SendBack = 1 THEN 'Complaint sent back' WHEN @ToUserId IS NULL THEN 'Complaint unassigned'
                            ELSE 'Complaint reassigned successfully' END;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT @Code = CASE WHEN ERROR_NUMBER() = 50409 THEN 409 ELSE 500 END, @Mess = ERROR_MESSAGE();
    END CATCH

Answer:
    SELECT @TicketId AS Id, @Code AS ResponseCode, @Mess AS ResponseMess,
           CASE WHEN @Code = 200 THEN @FromHolder END AS FromUserId,
           CASE WHEN @Code = 200 THEN @ToUserId END AS ToUserId,
           CASE WHEN @Code = 200 THEN @ToName END AS ToName;
END
GO

-- ---------------------------------------------------------------------------
-- 5. sp_TransferLead — the same, for leads (no escalation). Open follow-ups
--    of the previous person, or of nobody, go to the new person (NULL on
--    unassign) and take the new office; a third person's stay (spec 3.2).
--    Notices lead_assigned / lead_sent_back / lead_moved_away (body = lead
--    name, or the remarks for a send back).
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_TransferLead
    @CompId     INT,
    @LeadId     INT,
    @ToUserId   INT           = NULL,
    @ToBranchId INT           = NULL,
    @ReasonId   INT,
    @Remarks    NVARCHAR(500),
    @UserId     INT,
    @SendBack   BIT           = 0
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Code INT = 200, @Mess NVARCHAR(400) = NULL, @Now DATETIME = GETDATE(),
            @FromUserId INT, @FromHolder INT, @FromBranchId INT, @FromStatusId INT,
            @LeadName NVARCHAR(200), @ToName NVARCHAR(200),
            @GToUser INT, @GToBranch BIGINT;
    SET @SendBack = ISNULL(@SendBack, 0);
    SET @Remarks = NULLIF(LTRIM(RTRIM(@Remarks)), N'');

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT @Code = 400, @Mess = 'CompId is required'; GOTO Answer; END
    IF @LeadId IS NULL OR @LeadId <= 0
    BEGIN SELECT @Code = 400, @Mess = 'LeadId is required'; GOTO Answer; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT @Code = 400, @Mess = 'UserId is required'; GOTO Answer; END
    IF @ToUserId IS NOT NULL AND @ToUserId <= 0 SET @ToUserId = NULL;

    SELECT @FromUserId = OwnerId, @FromBranchId = BranchId, @FromStatusId = StatusId, @LeadName = Name,
           @FromHolder = COALESCE(OwnerId, CASE WHEN LoggerHolds = 1 THEN CreatedBy END)
    FROM dbo.tblLeads WHERE Id = @LeadId AND CompId = @CompId;

    -- Gates 1-7.
    SELECT @Code = g.Code, @Mess = g.Message, @GToUser = g.ToUserId, @GToBranch = g.ToBranchId
    FROM dbo.fn_ReassignGate(@CompId, @UserId, 'leads', @LeadId, @ToUserId, @ToBranchId, @SendBack) g;
    IF @Code <> 200 GOTO Answer;
    SELECT @ToUserId = @GToUser, @ToBranchId = @GToBranch;

    -- Gate 8.
    IF @SendBack = 1
    BEGIN
        IF @Remarks IS NULL
        BEGIN SELECT @Code = 400, @Mess = 'Remarks are required to send this back'; GOTO Answer; END
        SET @ReasonId = (SELECT TOP 1 Id FROM dbo.tblLookup
                         WHERE CompId = @CompId AND Kind = 'transfer_reason' AND Code = 'sent_back'
                         ORDER BY IsActive DESC, Id);
        IF @ReasonId IS NULL
        BEGIN SELECT @Code = 400, @Mess = 'This company has no Sent back reason configured'; GOTO Answer; END
    END
    ELSE
    BEGIN
        IF @Remarks IS NULL
        BEGIN SELECT @Code = 400, @Mess = 'Remarks are required for a transfer'; GOTO Answer; END
        IF @ReasonId IS NULL OR @ReasonId <= 0
           OR NOT EXISTS (SELECT 1 FROM dbo.tblLookup WHERE Id = @ReasonId AND CompId = @CompId AND Kind = 'transfer_reason')
        BEGIN SELECT @Code = 400, @Mess = 'A transfer reason is required'; GOTO Answer; END
    END

    IF ISNULL(@FromUserId, -1) = ISNULL(@ToUserId, -1) AND @FromBranchId = @ToBranchId
    BEGIN SELECT @Code = 400, @Mess = 'Lead is already assigned there'; GOTO Answer; END

    SET @ToName = (SELECT FullName FROM dbo.tblUser WHERE Id = @ToUserId);
    DECLARE @PersonChanged BIT = CASE WHEN ISNULL(@FromUserId, -1) = ISNULL(@ToUserId, -1) THEN 0 ELSE 1 END;

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));

        UPDATE dbo.tblLeads
        SET OwnerId     = @ToUserId,
            BranchId    = @ToBranchId,
            LoggerHolds = 0,
            AssignedAt  = CASE WHEN @ToUserId IS NULL THEN NULL WHEN @PersonChanged = 1 THEN @Now ELSE AssignedAt END,
            EditBy = @UserId, UpdatedAt = @Now
        WHERE Id = @LeadId AND CompId = @CompId
          AND ISNULL(OwnerId, -1) = ISNULL(@FromUserId, -1)
          AND BranchId = @FromBranchId AND StatusId = @FromStatusId;
        IF @@ROWCOUNT = 0
            THROW 50409, 'This lead changed while you were working on it. Open it again and retry.', 1;

        -- Every open follow-up takes the new office (D4.1); those of the previous
        -- person or of nobody also take the new person, a third person's keep
        -- their person (D26).
        UPDATE dbo.tblFollowUp
        SET AssignedTo = CASE WHEN AssignedTo = @FromUserId OR AssignedTo IS NULL THEN @ToUserId ELSE AssignedTo END,
            BranchId = @ToBranchId, EditBy = @UserId, UpdatedAt = @Now
        WHERE CompId = @CompId AND LeadId = @LeadId AND Status = 'open';

        INSERT INTO dbo.tblLeadAssignment
            (CompId, LeadId, FromUserId, ToUserId, FromBranchId, ToBranchId, ReasonId, Remarks, AssignedBy)
        VALUES
            (@CompId, @LeadId, @FromUserId, @ToUserId, @FromBranchId, @ToBranchId, @ReasonId, @Remarks, @UserId);

        DECLARE @Reason NVARCHAR(200) = (SELECT Value FROM dbo.tblLookup WHERE Id = @ReasonId);
        DECLARE @Summary NVARCHAR(500) = LEFT(
            CASE WHEN @SendBack = 1       THEN N'Sent back to ' + ISNULL(@ToName, N'')
                 WHEN @ToUserId IS NULL   THEN N'Unassigned'
                 WHEN @PersonChanged = 0  THEN N'Moved to another office'
                 ELSE N'Reassigned to ' + ISNULL(@ToName, N'') END
            + CASE WHEN @FromBranchId <> @ToBranchId
                   THEN N' (' + ISNULL((SELECT BranchName FROM dbo.tblBranch WHERE Id = @ToBranchId), N'') + N')'
                   ELSE N'' END
            + N' — ' + ISNULL(@Reason, N''), 500);
        DECLARE @Meta NVARCHAR(MAX) = (SELECT @FromUserId AS fromUserId, @ToUserId AS toUserId,
                                              @FromBranchId AS fromBranchId, @ToBranchId AS toBranchId,
                                              @ReasonId AS reasonId, @Remarks AS remarks, @SendBack AS sendBack
                                       FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
        INSERT INTO @actLog
        EXEC dbo.sp_LogLeadActivity
            @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId,
            @Type = 'assigned', @Summary = @Summary, @MetaJSON = @Meta;

        DECLARE @ActorName NVARCHAR(200) = ISNULL((SELECT FullName FROM dbo.tblUser WHERE Id = @UserId), N'someone');
        DECLARE @N TABLE (UserId INT NOT NULL, Type VARCHAR(40) NOT NULL, Title VARCHAR(200) NOT NULL, Body NVARCHAR(1000) NULL);
        IF @PersonChanged = 1 AND @ToUserId IS NOT NULL AND @SendBack = 0
            INSERT INTO @N VALUES (@ToUserId, 'lead_assigned', 'Lead assigned to you', LEFT(@LeadName, 1000));
        IF @SendBack = 1
            INSERT INTO @N VALUES (@ToUserId, 'lead_sent_back', 'Lead sent back to you', LEFT(@Remarks, 1000));
        IF @PersonChanged = 1 AND @FromHolder IS NOT NULL AND @FromHolder <> ISNULL(@ToUserId, -1)
            INSERT INTO @N VALUES (@FromHolder, 'lead_moved_away', 'Lead moved away from you',
                                   LEFT(@LeadName + N' (moved by ' + @ActorName + N')', 1000));

        INSERT INTO dbo.tblNotifications (UserId, Type, EntityType, EntityId, ActorUserId, Title, Body, CompId, BranchId)
        SELECT n.UserId, n.Type, 'lead', @LeadId, @UserId, n.Title, n.Body, @CompId, @ToBranchId
        FROM @N n
        JOIN dbo.tblUser r ON r.Id = n.UserId AND r.CompId = @CompId AND r.IsActive = 1
        WHERE n.UserId <> @UserId
          AND NOT EXISTS (SELECT 1 FROM dbo.tblNotificationPreferences np
                          WHERE np.UserId = n.UserId AND np.Type = n.Type AND np.Channel = 'inapp' AND np.IsEnabled = 0);

        COMMIT TRANSACTION;
        SELECT @Code = 200,
               @Mess = CASE WHEN @SendBack = 1 THEN 'Lead sent back' WHEN @ToUserId IS NULL THEN 'Lead unassigned'
                            ELSE 'Lead reassigned successfully' END;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT @Code = CASE WHEN ERROR_NUMBER() = 50409 THEN 409 ELSE 500 END, @Mess = ERROR_MESSAGE();
    END CATCH

Answer:
    SELECT @LeadId AS Id, @Code AS ResponseCode, @Mess AS ResponseMess,
           CASE WHEN @Code = 200 THEN @FromHolder END AS FromUserId,
           CASE WHEN @Code = 200 THEN @ToUserId END AS ToUserId,
           CASE WHEN @Code = 200 THEN @ToName END AS ToName;
END
GO

-- ---------------------------------------------------------------------------
-- 6. sp_BulkTransferTickets — the same gates per id (send back is single
--    only), all-or-nothing (Ruling 6), 1-200 ids. A refusal answers the first
--    failing gate's code + message + " (n of m refused)" (S7) and writes
--    nothing. Complaints already with the target are skipped, not errors.
--    Notices: one tickets_bulk_assigned to the new person ("12 complaints
--    were assigned to you by Amit") and one tickets_bulk_moved per previous
--    holder who lost some. EntityId 0: the notice opens the list, not one
--    record. Status row: Transferred, Skipped, Moved (= Transferred), Refused,
--    ResponseCode, ResponseMess. RS2 on success: UserId of every previous and
--    new holder of a moved complaint (the realtime fan-out).
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_BulkTransferTickets
    @CompId        INT,
    @TicketIdsJson NVARCHAR(MAX),
    @ToUserId      INT           = NULL,
    @ToBranchId    INT           = NULL,
    @ReasonId      INT,
    @Remarks       NVARCHAR(500),
    @UserId        INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Code INT = 200, @Mess NVARCHAR(400) = NULL, @Now DATETIME = GETDATE(),
            @Transferred INT = 0, @Skipped INT = 0, @Refused INT = 0, @Total INT = 0;
    DECLARE @Ids TABLE (TicketId INT NOT NULL PRIMARY KEY,
                        FromUserId INT NULL, FromHolder INT NULL, FromBranchId BIGINT NULL, FromStatusId INT NULL,
                        Gate TINYINT NULL, GCode INT NULL, GMess NVARCHAR(300) NULL,
                        ToUserId INT NULL, ToBranchId BIGINT NULL, Moved BIT NOT NULL DEFAULT 0);
    SET @Remarks = NULLIF(LTRIM(RTRIM(@Remarks)), N'');

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT @Code = 400, @Mess = 'CompId is required'; GOTO Answer; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT @Code = 400, @Mess = 'UserId is required'; GOTO Answer; END
    IF @ToUserId IS NOT NULL AND @ToUserId <= 0 SET @ToUserId = NULL;
    IF ISJSON(ISNULL(@TicketIdsJson, '[]')) <> 1
    BEGIN SELECT @Code = 400, @Mess = 'No complaints supplied'; GOTO Answer; END

    INSERT INTO @Ids (TicketId)
    SELECT DISTINCT TRY_CAST(value AS INT) FROM OPENJSON(ISNULL(@TicketIdsJson, '[]'))
    WHERE TRY_CAST(value AS INT) > 0;
    SET @Total = (SELECT COUNT(*) FROM @Ids);
    IF @Total = 0
    BEGIN SELECT @Code = 400, @Mess = 'No complaints supplied'; GOTO Answer; END
    IF @Total > 200
    BEGIN SELECT @Code = 400, @Mess = 'At most 200 complaints at once'; GOTO Answer; END

    UPDATE i SET FromUserId = t.AssignedTo, FromBranchId = t.BranchId, FromStatusId = t.StatusId,
                 FromHolder = COALESCE(t.AssignedTo, CASE WHEN t.LoggerHolds = 1 THEN t.CreatedBy END)
    FROM @Ids i JOIN dbo.tblTicket t ON t.Id = i.TicketId AND t.CompId = @CompId;

    -- Gates 1-7, per id (an unknown id fails gate 1 like an invisible one).
    UPDATE i SET Gate = g.Gate, GCode = g.Code, GMess = g.Message, ToUserId = g.ToUserId, ToBranchId = g.ToBranchId
    FROM @Ids i
    CROSS APPLY dbo.fn_ReassignGate(@CompId, @UserId, 'complaints', i.TicketId, @ToUserId, @ToBranchId, 0) g;

    SET @Refused = (SELECT COUNT(*) FROM @Ids WHERE GCode <> 200);
    IF @Refused > 0
    BEGIN
        SELECT TOP (1) @Code = GCode, @Mess = GMess FROM @Ids WHERE GCode <> 200 ORDER BY Gate, TicketId;
        SET @Mess = @Mess + N' (' + CAST(@Refused AS NVARCHAR(10)) + N' of ' + CAST(@Total AS NVARCHAR(10)) + N' refused)';
        GOTO Answer;
    END

    -- Gate 8.
    IF @Remarks IS NULL
    BEGIN SELECT @Code = 400, @Mess = 'Remarks are required for a transfer'; GOTO Answer; END
    IF @ReasonId IS NULL OR @ReasonId <= 0
       OR NOT EXISTS (SELECT 1 FROM dbo.tblLookup WHERE Id = @ReasonId AND CompId = @CompId AND Kind = 'transfer_reason')
    BEGIN SELECT @Code = 400, @Mess = 'A transfer reason is required'; GOTO Answer; END

    UPDATE @Ids SET Moved = 1
    WHERE NOT (ISNULL(FromUserId, -1) = ISNULL(ToUserId, -1) AND FromBranchId = ToBranchId);
    SET @Transferred = (SELECT COUNT(*) FROM @Ids WHERE Moved = 1);
    SET @Skipped = @Total - @Transferred;

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));

        -- Re-check every row the gates read; 409 if any moved meanwhile.
        UPDATE t
        SET AssignedTo  = i.ToUserId,
            BranchId    = i.ToBranchId,
            LoggerHolds = 0,
            AssignedAt  = CASE WHEN i.ToUserId IS NULL THEN NULL
                               WHEN ISNULL(i.FromUserId, -1) = i.ToUserId THEN t.AssignedAt ELSE @Now END,
            EscalatedTo = CASE WHEN ISNULL(i.FromUserId, -1) = ISNULL(i.ToUserId, -1) THEN t.EscalatedTo ELSE NULL END,
            EscalatedAt = CASE WHEN ISNULL(i.FromUserId, -1) = ISNULL(i.ToUserId, -1) THEN t.EscalatedAt ELSE NULL END,
            EditBy = @UserId, UpdatedAt = @Now
        FROM dbo.tblTicket t
        JOIN @Ids i ON i.TicketId = t.Id AND i.Moved = 1
        WHERE t.CompId = @CompId
          AND ISNULL(t.AssignedTo, -1) = ISNULL(i.FromUserId, -1)
          AND t.BranchId = i.FromBranchId AND t.StatusId = i.FromStatusId;
        IF @@ROWCOUNT <> @Transferred
            THROW 50409, 'Some of these complaints changed while you were working. Reload the list and retry.', 1;

        INSERT INTO dbo.tblTicketAssignment
            (CompId, TicketId, FromUserId, ToUserId, FromBranchId, ToBranchId, ReasonId, Remarks, AssignedBy, AssignedAt)
        SELECT @CompId, i.TicketId, i.FromUserId, i.ToUserId, i.FromBranchId, i.ToBranchId, @ReasonId, @Remarks, @UserId, @Now
        FROM @Ids i WHERE i.Moved = 1;

        -- The timeline: one logger call per moved complaint (the single logger SP).
        DECLARE @Reason NVARCHAR(200) = (SELECT Value FROM dbo.tblLookup WHERE Id = @ReasonId);
        DECLARE @TicketId INT = (SELECT MIN(TicketId) FROM @Ids WHERE Moved = 1);
        DECLARE @Summary NVARCHAR(500), @Meta NVARCHAR(MAX);
        WHILE @TicketId IS NOT NULL
        BEGIN
            SELECT @Summary = LEFT(
                       CASE WHEN i.ToUserId IS NULL THEN N'Unassigned'
                            WHEN ISNULL(i.FromUserId, -1) = i.ToUserId THEN N'Moved to another office'
                            ELSE N'Reassigned to ' + ISNULL(u.FullName, N'') END
                       + N' — ' + ISNULL(@Reason, N'') + N' (bulk)', 500),
                   @Meta = (SELECT i.FromUserId AS fromUserId, i.ToUserId AS toUserId,
                                   i.FromBranchId AS fromBranchId, i.ToBranchId AS toBranchId,
                                   @ReasonId AS reasonId, @Remarks AS remarks, 1 AS isBulk
                            FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES)
            FROM @Ids i LEFT JOIN dbo.tblUser u ON u.Id = i.ToUserId
            WHERE i.TicketId = @TicketId;

            INSERT INTO @actLog
            EXEC dbo.sp_LogTicketActivity
                @CompId = @CompId, @TicketId = @TicketId, @UserId = @UserId,
                @Type = 'assigned', @Summary = @Summary, @MetaJSON = @Meta;

            SET @TicketId = (SELECT MIN(TicketId) FROM @Ids WHERE Moved = 1 AND TicketId > @TicketId);
        END

        -- One summary notice per person (spec 3.7).
        DECLARE @ActorName NVARCHAR(200) = ISNULL((SELECT FullName FROM dbo.tblUser WHERE Id = @UserId), N'someone');
        INSERT INTO dbo.tblNotifications (UserId, Type, EntityType, EntityId, ActorUserId, Title, Body, CompId, BranchId)
        SELECT x.UserId, x.Type, 'ticket', 0, @UserId, LEFT(x.Title, 200), NULL, @CompId, x.BranchId
        FROM (
            SELECT i.ToUserId AS UserId, CAST('tickets_bulk_assigned' AS VARCHAR(40)) AS Type,
                   CAST(COUNT(*) AS NVARCHAR(10))
                   + CASE WHEN COUNT(*) = 1 THEN N' complaint was' ELSE N' complaints were' END
                   + N' assigned to you by ' + @ActorName AS Title,
                   MIN(i.ToBranchId) AS BranchId
            FROM @Ids i
            WHERE i.Moved = 1 AND i.ToUserId IS NOT NULL AND ISNULL(i.FromUserId, -1) <> i.ToUserId
            GROUP BY i.ToUserId
            UNION ALL
            SELECT i.FromHolder, CAST('tickets_bulk_moved' AS VARCHAR(40)),
                   CAST(COUNT(*) AS NVARCHAR(10))
                   + CASE WHEN COUNT(*) = 1 THEN N' complaint was' ELSE N' complaints were' END
                   + N' moved away from you by ' + @ActorName,
                   MIN(i.FromBranchId)
            FROM @Ids i
            WHERE i.Moved = 1 AND i.FromHolder IS NOT NULL AND i.FromHolder <> ISNULL(i.ToUserId, -1)
            GROUP BY i.FromHolder
        ) x
        JOIN dbo.tblUser r ON r.Id = x.UserId AND r.CompId = @CompId AND r.IsActive = 1
        WHERE x.UserId <> @UserId
          AND NOT EXISTS (SELECT 1 FROM dbo.tblNotificationPreferences np
                          WHERE np.UserId = x.UserId AND np.Type = x.Type AND np.Channel = 'inapp' AND np.IsEnabled = 0);

        COMMIT TRANSACTION;
        SELECT @Code = 200, @Mess = CAST(@Transferred AS VARCHAR(10)) + ' complaint(s) reassigned';
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT @Code = CASE WHEN ERROR_NUMBER() = 50409 THEN 409 ELSE 500 END, @Mess = ERROR_MESSAGE(),
               @Transferred = 0, @Skipped = 0;
    END CATCH

Answer:
    IF @Code <> 200 SELECT @Transferred = 0, @Skipped = 0;
    SELECT @Transferred AS Transferred, @Skipped AS Skipped, @Transferred AS Moved, @Refused AS Refused,
           @Code AS ResponseCode, @Mess AS ResponseMess;
    IF @Code = 200
        SELECT DISTINCT h.UserId
        FROM @Ids i CROSS APPLY (VALUES (i.FromHolder), (i.ToUserId)) h (UserId)
        WHERE i.Moved = 1 AND h.UserId IS NOT NULL;
END
GO

-- ---------------------------------------------------------------------------
-- 7. sp_BulkTransferLeads — the same, for leads, with the follow-up rule of
--    sp_TransferLead per lead. Notices leads_bulk_assigned / leads_bulk_moved.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_BulkTransferLeads
    @CompId      INT,
    @LeadIdsJson NVARCHAR(MAX),
    @ToUserId    INT           = NULL,
    @ToBranchId  INT           = NULL,
    @ReasonId    INT,
    @Remarks     NVARCHAR(500),
    @UserId      INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Code INT = 200, @Mess NVARCHAR(400) = NULL, @Now DATETIME = GETDATE(),
            @Transferred INT = 0, @Skipped INT = 0, @Refused INT = 0, @Total INT = 0;
    DECLARE @Ids TABLE (LeadId INT NOT NULL PRIMARY KEY,
                        FromUserId INT NULL, FromHolder INT NULL, FromBranchId BIGINT NULL, FromStatusId INT NULL,
                        Gate TINYINT NULL, GCode INT NULL, GMess NVARCHAR(300) NULL,
                        ToUserId INT NULL, ToBranchId BIGINT NULL, Moved BIT NOT NULL DEFAULT 0);
    SET @Remarks = NULLIF(LTRIM(RTRIM(@Remarks)), N'');

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT @Code = 400, @Mess = 'CompId is required'; GOTO Answer; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT @Code = 400, @Mess = 'UserId is required'; GOTO Answer; END
    IF @ToUserId IS NOT NULL AND @ToUserId <= 0 SET @ToUserId = NULL;
    IF ISJSON(ISNULL(@LeadIdsJson, '[]')) <> 1
    BEGIN SELECT @Code = 400, @Mess = 'No leads supplied'; GOTO Answer; END

    INSERT INTO @Ids (LeadId)
    SELECT DISTINCT TRY_CAST(value AS INT) FROM OPENJSON(ISNULL(@LeadIdsJson, '[]'))
    WHERE TRY_CAST(value AS INT) > 0;
    SET @Total = (SELECT COUNT(*) FROM @Ids);
    IF @Total = 0
    BEGIN SELECT @Code = 400, @Mess = 'No leads supplied'; GOTO Answer; END
    IF @Total > 200
    BEGIN SELECT @Code = 400, @Mess = 'At most 200 leads at once'; GOTO Answer; END

    UPDATE i SET FromUserId = l.OwnerId, FromBranchId = l.BranchId, FromStatusId = l.StatusId,
                 FromHolder = COALESCE(l.OwnerId, CASE WHEN l.LoggerHolds = 1 THEN l.CreatedBy END)
    FROM @Ids i JOIN dbo.tblLeads l ON l.Id = i.LeadId AND l.CompId = @CompId;

    UPDATE i SET Gate = g.Gate, GCode = g.Code, GMess = g.Message, ToUserId = g.ToUserId, ToBranchId = g.ToBranchId
    FROM @Ids i
    CROSS APPLY dbo.fn_ReassignGate(@CompId, @UserId, 'leads', i.LeadId, @ToUserId, @ToBranchId, 0) g;

    SET @Refused = (SELECT COUNT(*) FROM @Ids WHERE GCode <> 200);
    IF @Refused > 0
    BEGIN
        SELECT TOP (1) @Code = GCode, @Mess = GMess FROM @Ids WHERE GCode <> 200 ORDER BY Gate, LeadId;
        SET @Mess = @Mess + N' (' + CAST(@Refused AS NVARCHAR(10)) + N' of ' + CAST(@Total AS NVARCHAR(10)) + N' refused)';
        GOTO Answer;
    END

    IF @Remarks IS NULL
    BEGIN SELECT @Code = 400, @Mess = 'Remarks are required for a transfer'; GOTO Answer; END
    IF @ReasonId IS NULL OR @ReasonId <= 0
       OR NOT EXISTS (SELECT 1 FROM dbo.tblLookup WHERE Id = @ReasonId AND CompId = @CompId AND Kind = 'transfer_reason')
    BEGIN SELECT @Code = 400, @Mess = 'A transfer reason is required'; GOTO Answer; END

    UPDATE @Ids SET Moved = 1
    WHERE NOT (ISNULL(FromUserId, -1) = ISNULL(ToUserId, -1) AND FromBranchId = ToBranchId);
    SET @Transferred = (SELECT COUNT(*) FROM @Ids WHERE Moved = 1);
    SET @Skipped = @Total - @Transferred;

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));

        UPDATE l
        SET OwnerId     = i.ToUserId,
            BranchId    = i.ToBranchId,
            LoggerHolds = 0,
            AssignedAt  = CASE WHEN i.ToUserId IS NULL THEN NULL
                               WHEN ISNULL(i.FromUserId, -1) = i.ToUserId THEN l.AssignedAt ELSE @Now END,
            EditBy = @UserId, UpdatedAt = @Now
        FROM dbo.tblLeads l
        JOIN @Ids i ON i.LeadId = l.Id AND i.Moved = 1
        WHERE l.CompId = @CompId
          AND ISNULL(l.OwnerId, -1) = ISNULL(i.FromUserId, -1)
          AND l.BranchId = i.FromBranchId AND l.StatusId = i.FromStatusId;
        IF @@ROWCOUNT <> @Transferred
            THROW 50409, 'Some of these leads changed while you were working. Reload the list and retry.', 1;

        -- Every open follow-up takes the new office (D4.1); the previous person's
        -- or nobody's also take the new person, a third person's keep theirs (D26).
        UPDATE f
        SET AssignedTo = CASE WHEN f.AssignedTo = i.FromUserId OR f.AssignedTo IS NULL THEN i.ToUserId ELSE f.AssignedTo END,
            BranchId = i.ToBranchId, EditBy = @UserId, UpdatedAt = @Now
        FROM dbo.tblFollowUp f
        JOIN @Ids i ON i.LeadId = f.LeadId AND i.Moved = 1
        WHERE f.CompId = @CompId AND f.Status = 'open';

        INSERT INTO dbo.tblLeadAssignment
            (CompId, LeadId, FromUserId, ToUserId, FromBranchId, ToBranchId, ReasonId, Remarks, AssignedBy)
        SELECT @CompId, i.LeadId, i.FromUserId, i.ToUserId, i.FromBranchId, i.ToBranchId, @ReasonId, @Remarks, @UserId
        FROM @Ids i WHERE i.Moved = 1;

        DECLARE @Reason NVARCHAR(200) = (SELECT Value FROM dbo.tblLookup WHERE Id = @ReasonId);
        DECLARE @LeadId INT = (SELECT MIN(LeadId) FROM @Ids WHERE Moved = 1);
        DECLARE @Summary NVARCHAR(500), @Meta NVARCHAR(MAX);
        WHILE @LeadId IS NOT NULL
        BEGIN
            SELECT @Summary = LEFT(
                       CASE WHEN i.ToUserId IS NULL THEN N'Unassigned'
                            WHEN ISNULL(i.FromUserId, -1) = i.ToUserId THEN N'Moved to another office'
                            ELSE N'Reassigned to ' + ISNULL(u.FullName, N'') END
                       + N' — ' + ISNULL(@Reason, N'') + N' (bulk)', 500),
                   @Meta = (SELECT i.FromUserId AS fromUserId, i.ToUserId AS toUserId,
                                   i.FromBranchId AS fromBranchId, i.ToBranchId AS toBranchId,
                                   @ReasonId AS reasonId, @Remarks AS remarks, 1 AS isBulk
                            FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
            FROM @Ids i LEFT JOIN dbo.tblUser u ON u.Id = i.ToUserId
            WHERE i.LeadId = @LeadId;

            INSERT INTO @actLog
            EXEC dbo.sp_LogLeadActivity
                @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId,
                @Type = 'assigned', @Summary = @Summary, @MetaJSON = @Meta;

            SET @LeadId = (SELECT MIN(LeadId) FROM @Ids WHERE Moved = 1 AND LeadId > @LeadId);
        END

        DECLARE @ActorName NVARCHAR(200) = ISNULL((SELECT FullName FROM dbo.tblUser WHERE Id = @UserId), N'someone');
        INSERT INTO dbo.tblNotifications (UserId, Type, EntityType, EntityId, ActorUserId, Title, Body, CompId, BranchId)
        SELECT x.UserId, x.Type, 'lead', 0, @UserId, LEFT(x.Title, 200), NULL, @CompId, x.BranchId
        FROM (
            SELECT i.ToUserId AS UserId, CAST('leads_bulk_assigned' AS VARCHAR(40)) AS Type,
                   CAST(COUNT(*) AS NVARCHAR(10))
                   + CASE WHEN COUNT(*) = 1 THEN N' lead was' ELSE N' leads were' END
                   + N' assigned to you by ' + @ActorName AS Title,
                   MIN(i.ToBranchId) AS BranchId
            FROM @Ids i
            WHERE i.Moved = 1 AND i.ToUserId IS NOT NULL AND ISNULL(i.FromUserId, -1) <> i.ToUserId
            GROUP BY i.ToUserId
            UNION ALL
            SELECT i.FromHolder, CAST('leads_bulk_moved' AS VARCHAR(40)),
                   CAST(COUNT(*) AS NVARCHAR(10))
                   + CASE WHEN COUNT(*) = 1 THEN N' lead was' ELSE N' leads were' END
                   + N' moved away from you by ' + @ActorName,
                   MIN(i.FromBranchId)
            FROM @Ids i
            WHERE i.Moved = 1 AND i.FromHolder IS NOT NULL AND i.FromHolder <> ISNULL(i.ToUserId, -1)
            GROUP BY i.FromHolder
        ) x
        JOIN dbo.tblUser r ON r.Id = x.UserId AND r.CompId = @CompId AND r.IsActive = 1
        WHERE x.UserId <> @UserId
          AND NOT EXISTS (SELECT 1 FROM dbo.tblNotificationPreferences np
                          WHERE np.UserId = x.UserId AND np.Type = x.Type AND np.Channel = 'inapp' AND np.IsEnabled = 0);

        COMMIT TRANSACTION;
        SELECT @Code = 200, @Mess = CAST(@Transferred AS VARCHAR(10)) + ' lead(s) reassigned';
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT @Code = CASE WHEN ERROR_NUMBER() = 50409 THEN 409 ELSE 500 END, @Mess = ERROR_MESSAGE(),
               @Transferred = 0, @Skipped = 0;
    END CATCH

Answer:
    IF @Code <> 200 SELECT @Transferred = 0, @Skipped = 0;
    SELECT @Transferred AS Transferred, @Skipped AS Skipped, @Transferred AS Moved, @Refused AS Refused,
           @Code AS ResponseCode, @Mess AS ResponseMess;
    IF @Code = 200
        SELECT DISTINCT h.UserId
        FROM @Ids i CROSS APPLY (VALUES (i.FromHolder), (i.ToUserId)) h (UserId)
        WHERE i.Moved = 1 AND h.UserId IS NOT NULL;
END
GO

-- ---------------------------------------------------------------------------
-- 8. sp_SaveTicket — live body (6.1 / 101) with the 133 create-path rules:
--    a named person must be in fn_AssignableUsers (else 403 "You cannot
--    assign records to that person"); Rule 3 office (@BranchId unless the
--    person does not work there, then their home office); LoggerHolds = 1
--    when nobody is assigned, else 0 (Ruling 12). The opening history row
--    keeps AssignedBy = the creator (Ruling 13). Update still ignores
--    @AssignedTo. Lines changed by 133 are marked "133".
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_SaveTicket
    @Id            INT           = 0,
    @CompId        INT,
    @BranchId      INT,
    @UserId        INT,
    @CustomerId    INT           = NULL,
    @Subject       NVARCHAR(200) = NULL,
    @ContactPerson NVARCHAR(200) = NULL,
    @Contact       VARCHAR(100)  = NULL,
    @ChannelId     INT           = NULL,
    @CategoryId    INT           = NULL,
    @Priority      INT           = NULL,
    @ProductId     INT           = NULL,
    @AssignedTo    INT           = NULL,
    @LinkedLeadId  INT           = NULL,
    @Description   NVARCHAR(MAX) = NULL,
    @CustomJSON    NVARCHAR(MAX) = NULL,
    @DueAtOverride DATETIME      = NULL   -- 101: Node's working-calendar due time; NULL = the old wall-clock rule
AS
BEGIN
    SET NOCOUNT ON;
    SET @Id = ISNULL(@Id, 0);

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT 0 AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT 0 AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 400 AS ResponseCode, 'UserId is required' AS ResponseMess; RETURN; END
    IF @Id = 0 AND (@BranchId IS NULL OR @BranchId <= 0)
    BEGIN SELECT 0 AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 400 AS ResponseCode, 'BranchId is required' AS ResponseMess; RETURN; END

    -- 0 / negative ids mean "none"
    IF @CustomerId   <= 0 SET @CustomerId   = NULL;
    IF @ChannelId    <= 0 SET @ChannelId    = NULL;
    IF @CategoryId   <= 0 SET @CategoryId   = NULL;
    IF @Priority     <= 0 SET @Priority     = NULL;
    IF @ProductId    <= 0 SET @ProductId    = NULL;
    IF @AssignedTo   <= 0 SET @AssignedTo   = NULL;
    IF @LinkedLeadId <= 0 SET @LinkedLeadId = NULL;
    SET @Subject       = NULLIF(LTRIM(RTRIM(@Subject)), N'');
    SET @ContactPerson = NULLIF(LTRIM(RTRIM(@ContactPerson)), N'');
    SET @Contact       = NULLIF(LTRIM(RTRIM(@Contact)), '');

    IF @Id > 0 AND NOT EXISTS (SELECT 1 FROM dbo.tblTicket WHERE Id = @Id AND CompId = @CompId)
    BEGIN SELECT @Id AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 404 AS ResponseCode, 'Ticket not found' AS ResponseMess; RETURN; END
    IF @CustomerId IS NULL
    BEGIN SELECT @Id AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 400 AS ResponseCode, 'CustomerId is required' AS ResponseMess; RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.tblCustomer WHERE Id = @CustomerId AND CompId = @CompId AND IsActive = 1)
    BEGIN SELECT @Id AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 404 AS ResponseCode, 'Customer not found' AS ResponseMess; RETURN; END
    IF @Subject IS NULL
    BEGIN SELECT @Id AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 400 AS ResponseCode, 'Subject is required' AS ResponseMess; RETURN; END
    IF @Priority IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.tblLookup WHERE Id = @Priority AND CompId = @CompId AND Kind = 'priority')
    BEGIN SELECT @Id AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 400 AS ResponseCode, 'Invalid priority' AS ResponseMess; RETURN; END
    IF @CategoryId IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.tblLookup WHERE Id = @CategoryId AND CompId = @CompId AND Kind = 'ticket_category')
    BEGIN SELECT @Id AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 400 AS ResponseCode, 'Invalid category' AS ResponseMess; RETURN; END
    IF @ChannelId IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.tblLookup WHERE Id = @ChannelId AND CompId = @CompId AND Kind = 'ticket_channel')
    BEGIN SELECT @Id AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 400 AS ResponseCode, 'Invalid channel' AS ResponseMess; RETURN; END
    IF @ProductId IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.tblProduct WHERE Id = @ProductId AND CompId = @CompId)
    BEGIN SELECT @Id AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 400 AS ResponseCode, 'Invalid product' AS ResponseMess; RETURN; END
    IF @Id = 0 AND @AssignedTo IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Id = @AssignedTo AND CompId = @CompId AND IsActive = 1)
    BEGIN SELECT @Id AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 400 AS ResponseCode, 'Invalid assignee' AS ResponseMess; RETURN; END
    -- 133: Rule 2 — the named person must be in the creator's "Can assign to" list.
    IF @Id = 0 AND @AssignedTo IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.fn_AssignableUsers(@CompId, @UserId, 'complaints', NULL) WHERE Id = @AssignedTo)
    BEGIN SELECT @Id AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 403 AS ResponseCode, 'You cannot assign records to that person' AS ResponseMess; RETURN; END
    IF @LinkedLeadId IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.tblLeads WHERE Id = @LinkedLeadId AND CompId = @CompId)
    BEGIN SELECT @Id AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 400 AS ResponseCode, 'Invalid linked lead' AS ResponseMess; RETURN; END

    -- 133: Rule 3 — a new complaint sits in an office its person works in
    -- (their home office, when that is an active office of this company).
    IF @Id = 0 AND @AssignedTo IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.fn_AccessOffices(@CompId, @AssignedTo) WHERE BranchId = @BranchId AND Level = 3)
        SET @BranchId = ISNULL((SELECT u.BranchId FROM dbo.tblUser u
                                CROSS APPLY dbo.fn_CompanyOffice(@CompId, u.BranchId) co
                                WHERE u.Id = @AssignedTo AND u.CompId = @CompId), @BranchId);
    -- 133: the office must be an active office of this company (review fix 1).
    IF @Id = 0 AND NOT EXISTS (SELECT 1 FROM dbo.fn_CompanyOffice(@CompId, @BranchId))
    BEGIN SELECT 0 AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 400 AS ResponseCode, 'Invalid branch' AS ResponseMess; RETURN; END

    DECLARE @Now DATETIME = GETDATE();
    DECLARE @Tat INT = (SELECT TatHours FROM dbo.tblLookup WHERE Id = @Priority);

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));
        DECLARE @TicketId INT = @Id;
        DECLARE @TicketNo VARCHAR(30);
        DECLARE @ActType VARCHAR(30), @ActSummary NVARCHAR(500);

        IF @Id > 0
        BEGIN
            DECLARE @OldPriority INT, @OldDueAt DATETIME, @CreatedAt DATETIME;
            SELECT @OldPriority = Priority, @OldDueAt = DueAt, @CreatedAt = CreatedAt, @TicketNo = TicketNo
            FROM dbo.tblTicket WHERE Id = @Id AND CompId = @CompId;

            -- Priority change: anchor = when the current clock started
            -- (DueAt - OldTat when both are known, else CreatedAt), so a
            -- reopened ticket keeps its reopen anchor.
            DECLARE @NewDueAt DATETIME = @OldDueAt;
            IF ISNULL(@OldPriority, -1) <> ISNULL(@Priority, -1)
            BEGIN
                DECLARE @OldTat INT = (SELECT TatHours FROM dbo.tblLookup WHERE Id = @OldPriority);
                DECLARE @Anchor DATETIME = CASE WHEN @OldTat IS NOT NULL AND @OldDueAt IS NOT NULL
                                                THEN DATEADD(HOUR, -@OldTat, @OldDueAt)
                                                ELSE @CreatedAt END;
                SET @NewDueAt = ISNULL(@DueAtOverride, CASE WHEN @Tat IS NULL THEN NULL ELSE DATEADD(HOUR, @Tat, @Anchor) END);
            END

            UPDATE dbo.tblTicket
            SET CustomerId = @CustomerId, Subject = @Subject,
                ContactPerson = @ContactPerson, Contact = @Contact,
                ChannelId = @ChannelId, CategoryId = @CategoryId,
                Priority = @Priority, ProductId = @ProductId,
                -- Guarded: a client that does not know about the lead link
                -- must not be able to sever it by omitting the field.
                LinkedLeadId = ISNULL(@LinkedLeadId, LinkedLeadId),
                DueAt = @NewDueAt,
                Description = @Description,
                EditBy = @UserId, UpdatedAt = @Now
            WHERE Id = @Id AND CompId = @CompId;

            SET @ActType = 'updated';
            SET @ActSummary = N'Complaint details updated';
        END
        ELSE
        BEGIN
            DECLARE @StatusId INT = (SELECT TOP 1 Id FROM dbo.tblLookup
                                     WHERE CompId = @CompId AND Kind = 'ticket_status' AND Code = 'open' AND IsActive = 1
                                     ORDER BY SortOrder, Id);
            IF @StatusId IS NULL
            BEGIN
                ROLLBACK TRANSACTION;
                SELECT 0 AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 500 AS ResponseCode, 'No ticket_status lookups configured for this company' AS ResponseMess;
                RETURN;
            END

            -- Highest number issued so far, not the row count. sp_DeleteTicket
            -- hard-deletes, so COUNT(*) walks back over the gap and re-issues a
            -- TicketNo a surviving ticket already owns — UQ_tblTicket_CompId_TicketNo
            -- then throws on an ordinary create.
            -- ponytail: two concurrent inserts can still pick the same number;
            -- swap to a sequence table if that ever actually collides.
            DECLARE @Seq INT = (
                SELECT ISNULL(MAX(TRY_CONVERT(INT, SUBSTRING(TicketNo, 5, 10))), 0) + 1
                FROM dbo.tblTicket
                WHERE CompId = @CompId AND TicketNo LIKE 'TKT-%'
            );
            SET @TicketNo = 'TKT-' + RIGHT('000000' + CAST(@Seq AS VARCHAR(10)), 6);

            INSERT INTO dbo.tblTicket
                (CompId, BranchId, TicketNo, CustomerId, Subject, ContactPerson, Contact,
                 ChannelId, CategoryId, Priority, ProductId, StatusId,
                 AssignedTo, AssignedAt, LinkedLeadId, DueAt,
                 Description, CreatedBy, EditBy, CreatedAt, TatAnchorAt, LoggerHolds)
            VALUES
                (@CompId, @BranchId, @TicketNo, @CustomerId, @Subject, @ContactPerson, @Contact,
                 @ChannelId, @CategoryId, @Priority, @ProductId, @StatusId,
                 @AssignedTo, CASE WHEN @AssignedTo IS NULL THEN NULL ELSE @Now END, @LinkedLeadId,
                 ISNULL(@DueAtOverride, CASE WHEN @Tat IS NULL THEN NULL ELSE DATEADD(HOUR, @Tat, @Now) END),
                 @Description, @UserId, @UserId, @Now, @Now,
                 CASE WHEN @AssignedTo IS NULL THEN 1 ELSE 0 END);   -- 133: Ruling 12

            SET @TicketId = CAST(SCOPE_IDENTITY() AS INT);

            -- Opening row of the status history (NULL -> first status).
            INSERT INTO dbo.tblTicketStatusHistory (CompId, TicketId, FromStatusId, ToStatusId, ChangedBy, ChangedAt)
            VALUES (@CompId, @TicketId, NULL, @StatusId, @UserId, @Now);

            -- Opening assignment, so RS4 shows who it landed on first, and so
            -- "Send back" can find the creator (Ruling 13).
            IF @AssignedTo IS NOT NULL
                INSERT INTO dbo.tblTicketAssignment
                    (CompId, TicketId, FromUserId, ToUserId, FromBranchId, ToBranchId, ReasonId, Remarks, AssignedBy, AssignedAt)
                VALUES
                    (@CompId, @TicketId, NULL, @AssignedTo, NULL, @BranchId, NULL, N'Assigned on creation', @UserId, @Now);

            SET @ActType = 'created';
            SET @ActSummary = N'Complaint created';
        END

        -- custom-field values (shared engine, Entity='ticket')
        IF @CustomJSON IS NOT NULL AND LTRIM(RTRIM(@CustomJSON)) NOT IN ('', '[]')
        BEGIN
            ;WITH src AS (
                SELECT j.fieldId,
                       CASE WHEN j.type IN ('dropdown','text') THEN j.val END AS ValueText,
                       CASE WHEN j.type = 'number'  THEN TRY_CONVERT(DECIMAL(18,2), j.val)
                            WHEN j.type = 'checkbox' THEN CASE WHEN j.val='true' THEN 1 ELSE 0 END END AS ValueNumber,
                       CASE WHEN j.type = 'date' THEN TRY_CONVERT(DATETIME, j.val) END AS ValueDate
                FROM OPENJSON(@CustomJSON)
                     WITH (fieldId INT '$.fieldId', type VARCHAR(20) '$.type', val NVARCHAR(MAX) '$.value') j
                WHERE j.fieldId IS NOT NULL
            )
            MERGE dbo.tblCustomFieldValue AS tgt
            USING src ON tgt.CompId=@CompId AND tgt.Entity='ticket'
                      AND tgt.EntityId=@TicketId AND tgt.FieldId=src.fieldId
            WHEN MATCHED THEN UPDATE SET ValueText=src.ValueText, ValueNumber=src.ValueNumber, ValueDate=src.ValueDate
            WHEN NOT MATCHED THEN INSERT (CompId, Entity, EntityId, FieldId, ValueText, ValueNumber, ValueDate)
                 VALUES (@CompId, 'ticket', @TicketId, src.fieldId, src.ValueText, src.ValueNumber, src.ValueDate);
        END

        INSERT INTO @actLog EXEC dbo.sp_LogTicketActivity
            @CompId = @CompId, @TicketId = @TicketId, @UserId = @UserId,
            @Type = @ActType, @Summary = @ActSummary, @MetaJSON = NULL;

        IF @Id = 0 AND @AssignedTo IS NOT NULL
        BEGIN
            -- The creation assignment on the timeline, then the in-app ping
            -- (sp_CreateNotification skips the actor assigning to themself).
            DECLARE @AssigneeName NVARCHAR(200) = ISNULL((SELECT FullName FROM dbo.tblUser WHERE Id = @AssignedTo), N'');
            DECLARE @AssignSummary NVARCHAR(500) = N'Assigned to ' + @AssigneeName + N' on creation';
            DECLARE @AssignMeta NVARCHAR(MAX) = (SELECT CAST(NULL AS INT) AS fromUserId, @AssignedTo AS toUserId,
                                                        CAST(NULL AS INT) AS fromBranchId, @BranchId AS toBranchId,
                                                        CAST(NULL AS INT) AS reasonId, N'Assigned on creation' AS remarks
                                                 FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES);
            INSERT INTO @actLog EXEC dbo.sp_LogTicketActivity
                @CompId = @CompId, @TicketId = @TicketId, @UserId = @UserId,
                @Type = 'assigned', @Summary = @AssignSummary, @MetaJSON = @AssignMeta;

            DECLARE @ntf TABLE (ResponseCode INT, ResponseMess VARCHAR(400), NotificationId BIGINT, UserId INT, Type VARCHAR(40));
            DECLARE @NtfBody NVARCHAR(1000) = LEFT(@TicketNo + N' — ' + @Subject, 1000);
            INSERT INTO @ntf EXEC dbo.sp_CreateNotification
                @UserId = @AssignedTo, @Type = 'ticket_assigned', @EntityType = 'ticket', @EntityId = @TicketId,
                @ActorUserId = @UserId, @Title = 'Complaint assigned to you', @Body = @NtfBody,
                @CompId = @CompId, @BranchId = @BranchId;
        END

        COMMIT TRANSACTION;
        SELECT @TicketId AS Id, @TicketNo AS TicketNo, 200 AS ResponseCode, 'Ticket saved successfully' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT ISNULL(@Id,0) AS Id, CAST(NULL AS VARCHAR(30)) AS TicketNo, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

-- ---------------------------------------------------------------------------
-- 9. sp_SaveLead — live body (071 / 075 / 107) with the 133 create-path rules
--    (same as sp_SaveTicket): Rule 2 on @OwnerId (403), Rule 3 office,
--    LoggerHolds, and a lead_assigned notice when the person is not the
--    creator (W5). Update still ignores @OwnerId. Lines marked "133".
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_SaveLead
    @Id               INT            = 0,
    @CompId           INT,
    @BranchId         INT,
    @UserId           INT,
    @Name             NVARCHAR(200),
    @Company          NVARCHAR(200)  = NULL,
    @MobileNo         VARCHAR(20)    = NULL,
    @AltMobile        VARCHAR(20)    = NULL,
    @Email            VARCHAR(150)   = NULL,
    @Address          NVARCHAR(500)  = NULL,
    @City             NVARCHAR(100)  = NULL,
    @State            NVARCHAR(100)  = NULL,
    @Pincode          VARCHAR(10)    = NULL,
    @SourceId         INT            = NULL,
    @ProductId        INT            = NULL,
    @StatusId         INT            = NULL,
    @OwnerId          INT            = NULL,
    @EstValue         DECIMAL(18,2)  = NULL,
    @Remarks          NVARCHAR(MAX)  = NULL,
    @FirstFollowupAt  DATETIME       = NULL,
    @CustomJSON       NVARCHAR(MAX)  = NULL,
    @SetPartner       BIT            = 0,      -- 107
    @PartnerId        INT            = NULL,   -- 107
    @CommType         VARCHAR(5)     = NULL,   -- 107
    @CommValue        DECIMAL(12,2)  = NULL,   -- 107
    @SetTerms         BIT            = 0       -- 107
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess; RETURN; END
    IF @Name IS NULL OR LTRIM(RTRIM(@Name)) = ''
    BEGIN SELECT ISNULL(@Id,0) AS Id, 400 AS ResponseCode, 'Name is required' AS ResponseMess; RETURN; END
    IF @Id > 0 AND NOT EXISTS (SELECT 1 FROM dbo.tblLeads WHERE Id=@Id AND CompId=@CompId)
    BEGIN SELECT @Id AS Id, 404 AS ResponseCode, 'Lead not found' AS ResponseMess; RETURN; END
    IF @ProductId IS NOT NULL AND @ProductId > 0
       AND NOT EXISTS (SELECT 1 FROM dbo.tblProduct WHERE Id=@ProductId AND CompId=@CompId)
    BEGIN SELECT ISNULL(@Id,0) AS Id, 400 AS ResponseCode, 'Invalid product' AS ResponseMess; RETURN; END
    IF @OwnerId IS NOT NULL AND @OwnerId <= 0 SET @OwnerId = NULL;
    IF @OwnerId IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Id=@OwnerId AND CompId=@CompId)
    BEGIN SELECT ISNULL(@Id,0) AS Id, 400 AS ResponseCode, 'Invalid owner' AS ResponseMess; RETURN; END
    -- 133: Rule 2 on create — the named person must be in the creator's "Can assign to" list.
    IF ISNULL(@Id, 0) <= 0 AND @OwnerId IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.fn_AssignableUsers(@CompId, @UserId, 'leads', NULL) WHERE Id = @OwnerId)
    BEGIN SELECT 0 AS Id, 403 AS ResponseCode, 'You cannot assign records to that person' AS ResponseMess; RETURN; END
    -- 133: Rule 3 on create — the lead sits in an office its person works in.
    IF ISNULL(@Id, 0) <= 0 AND @OwnerId IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.fn_AccessOffices(@CompId, @OwnerId) WHERE BranchId = @BranchId AND Level = 3)
        SET @BranchId = ISNULL((SELECT u.BranchId FROM dbo.tblUser u
                                CROSS APPLY dbo.fn_CompanyOffice(@CompId, u.BranchId) co
                                WHERE u.Id = @OwnerId AND u.CompId = @CompId), @BranchId);
    -- 133: the office must be an active office of this company (review fix 1).
    IF ISNULL(@Id, 0) <= 0 AND NOT EXISTS (SELECT 1 FROM dbo.fn_CompanyOffice(@CompId, @BranchId))
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'Invalid branch' AS ResponseMess; RETURN; END
    -- 107: partner inputs that can be refused without reading the lead
    IF @SetPartner = 1 AND @PartnerId IS NOT NULL AND @PartnerId <= 0 SET @PartnerId = NULL;
    IF @SetPartner = 1 AND @PartnerId IS NOT NULL AND @SetTerms = 1 AND @CommType IS NOT NULL
       AND (@CommType NOT IN ('pct','fixed') OR @CommValue IS NULL OR @CommValue < 0
            OR (@CommType = 'pct' AND @CommValue > 100))
    BEGIN SELECT ISNULL(@Id,0) AS Id, 400 AS ResponseCode, 'Commission must be a percent from 0 to 100 or an amount of 0 or more' AS ResponseMess; RETURN; END
    IF @SetPartner = 1 AND @PartnerId IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.tblPartner WHERE Id = @PartnerId AND CompId = @CompId)
    BEGIN SELECT ISNULL(@Id,0) AS Id, 400 AS ResponseCode, 'Invalid partner' AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));
        DECLARE @LeadId INT = @Id;

        IF @Id > 0
        BEGIN
            UPDATE dbo.tblLeads
            SET Name = @Name, Company = @Company, MobileNo = @MobileNo, AltMobile = @AltMobile,
                Email = @Email, Address = @Address, City = @City, State = @State, Pincode = @Pincode,
                SourceId = @SourceId, ProductId = @ProductId, EstValue = @EstValue, Remarks = @Remarks,
                EditBy = @UserId, UpdatedAt = GETDATE()
            WHERE Id = @Id AND CompId = @CompId;
        END
        ELSE
        BEGIN
            IF @StatusId IS NULL OR @StatusId <= 0
                SET @StatusId = (SELECT TOP 1 Id FROM dbo.tblLookup
                                 WHERE CompId=@CompId AND Kind='lead_status' AND Code='open' AND IsActive=1
                                 ORDER BY SortOrder, Id);
            IF @StatusId IS NULL
            BEGIN
                ROLLBACK TRANSACTION;
                SELECT 0 AS Id, 500 AS ResponseCode, 'No lead_status lookups configured for this company' AS ResponseMess;
                RETURN;
            END
            IF NOT EXISTS (SELECT 1 FROM dbo.tblLookup WHERE Id=@StatusId AND CompId=@CompId AND Kind='lead_status')
            BEGIN
                ROLLBACK TRANSACTION;
                SELECT 0 AS Id, 400 AS ResponseCode, 'Invalid status' AS ResponseMess;
                RETURN;
            END

            INSERT INTO dbo.tblLeads
                (CompId, BranchId, Name, Company, MobileNo, AltMobile, Email,
                 Address, City, State, Pincode, SourceId, ProductId, StatusId, OwnerId,
                 EstValue, Remarks, AssignedAt, CreatedBy, EditBy, CreatedAt, LoggerHolds)
            VALUES
                (@CompId, @BranchId, @Name, @Company, @MobileNo, @AltMobile, @Email,
                 @Address, @City, @State, @Pincode, @SourceId, @ProductId, @StatusId, @OwnerId,
                 @EstValue, @Remarks, CASE WHEN @OwnerId IS NULL THEN NULL ELSE GETDATE() END,
                 @UserId, @UserId, GETDATE(),
                 CASE WHEN @OwnerId IS NULL THEN 1 ELSE 0 END);   -- 133: Ruling 12

            SET @LeadId = CAST(SCOPE_IDENTITY() AS INT);

            -- 075: opening row of the status history (NULL -> first status).
            INSERT INTO dbo.tblLeadStatusHistory (CompId, LeadId, FromStatusId, ToStatusId, ChangedBy)
            VALUES (@CompId, @LeadId, NULL, @StatusId, @UserId);

            -- The first follow-up: today unless the form said otherwise.
            DECLARE @DueAt DATETIME = ISNULL(@FirstFollowupAt, CAST(CAST(GETDATE() AS DATE) AS DATETIME));
            INSERT INTO dbo.tblFollowUp (CompId, BranchId, LeadId, Type, DueAt, AssignedTo, Status, CreatedBy)
            VALUES (@CompId, @BranchId, @LeadId, 'call', @DueAt, @OwnerId, 'open', @UserId);

            UPDATE dbo.tblLeads SET NextFollowupDate = @DueAt WHERE Id = @LeadId;

            -- Opening record on the timeline; carries the assignment too, so a
            -- lead created straight onto someone shows who and when, and so
            -- "Send back" can find the creator (Ruling 13).
            IF @OwnerId IS NOT NULL
                INSERT INTO dbo.tblLeadAssignment (CompId, LeadId, FromUserId, ToUserId, FromBranchId, ToBranchId, ReasonId, Remarks, AssignedBy)
                VALUES (@CompId, @LeadId, NULL, @OwnerId, NULL, @BranchId, NULL, N'Assigned on creation', @UserId);
        END

        -- Custom-field values. JSON: [{fieldId,type,value}].
        IF @CustomJSON IS NOT NULL AND LTRIM(RTRIM(@CustomJSON)) NOT IN ('', '[]')
        BEGIN
            ;WITH src AS (
                SELECT j.fieldId,
                       CASE WHEN j.type IN ('dropdown','text') THEN j.val END AS ValueText,
                       CASE WHEN j.type = 'number'   THEN TRY_CONVERT(DECIMAL(18,2), j.val)
                            WHEN j.type = 'checkbox'  THEN CASE WHEN j.val = 'true' THEN 1 ELSE 0 END
                       END AS ValueNumber,
                       CASE WHEN j.type = 'date' THEN TRY_CONVERT(DATETIME, j.val) END AS ValueDate
                FROM OPENJSON(@CustomJSON)
                     WITH (fieldId INT '$.fieldId',
                           type    VARCHAR(20) '$.type',
                           val     NVARCHAR(MAX) '$.value') j
                WHERE j.fieldId IS NOT NULL
            )
            MERGE dbo.tblCustomFieldValue AS tgt
            USING src
               ON tgt.CompId = @CompId AND tgt.Entity = 'lead'
              AND tgt.EntityId = @LeadId AND tgt.FieldId = src.fieldId
            WHEN MATCHED THEN
                UPDATE SET ValueText = src.ValueText, ValueNumber = src.ValueNumber, ValueDate = src.ValueDate
            WHEN NOT MATCHED THEN
                INSERT (CompId, Entity, EntityId, FieldId, ValueText, ValueNumber, ValueDate)
                VALUES (@CompId, 'lead', @LeadId, src.fieldId, src.ValueText, src.ValueNumber, src.ValueDate);
        END

        DECLARE @ActType VARCHAR(30) = CASE WHEN @Id > 0 THEN 'updated' ELSE 'created' END;
        DECLARE @ActSummary NVARCHAR(500) = CASE WHEN @Id > 0 THEN N'Lead details updated' ELSE N'Lead created' END;
        INSERT INTO @actLog
        EXEC dbo.sp_LogLeadActivity
            @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId,
            @Type = @ActType, @Summary = @ActSummary, @MetaJSON = NULL;

        -- 133: W5 — tell the person a lead was assigned to them at creation
        -- (sp_CreateNotification skips the creator assigning to themself).
        IF ISNULL(@Id, 0) <= 0 AND @OwnerId IS NOT NULL
        BEGIN
            DECLARE @ntf TABLE (ResponseCode INT, ResponseMess VARCHAR(400), NotificationId BIGINT, UserId INT, Type VARCHAR(40));
            DECLARE @NtfBody NVARCHAR(1000) = LEFT(@Name, 1000);
            INSERT INTO @ntf EXEC dbo.sp_CreateNotification
                @UserId = @OwnerId, @Type = 'lead_assigned', @EntityType = 'lead', @EntityId = @LeadId,
                @ActorUserId = @UserId, @Title = 'Lead assigned to you', @Body = @NtfBody,
                @CompId = @CompId, @BranchId = @BranchId;
        END

        -- 107 BEGIN partner block (amendment A1): set or clear the lead's partner and terms.
        --   @SetTerms = 1: take @CommType/@CommValue.  @SetTerms = 0: the partner's usual rule when
        --   the partner changes, the lead's current terms when it does not.
        --   Refused (409) when the live commission is already paid and partner/terms would change.
        IF @SetPartner = 1
        BEGIN
            DECLARE @OldPartner INT, @OldType VARCHAR(5), @OldValue DECIMAL(12,2),
                    @NewType VARCHAR(5), @NewValue DECIMAL(12,2);
            SELECT @OldPartner = PartnerId, @OldType = CommType, @OldValue = CommValue
            FROM dbo.tblLeads WITH (UPDLOCK, HOLDLOCK) WHERE Id = @LeadId AND CompId = @CompId;

            IF @PartnerId IS NOT NULL AND ISNULL(@OldPartner, 0) <> @PartnerId AND NOT EXISTS (
                SELECT 1 FROM dbo.tblPartner WHERE Id = @PartnerId AND CompId = @CompId AND IsActive = 1)
            BEGIN
                ROLLBACK TRANSACTION;
                SELECT ISNULL(@Id,0) AS Id, 400 AS ResponseCode, 'Pick an active partner' AS ResponseMess;
                RETURN;
            END

            IF @PartnerId IS NULL
                SELECT @NewType = NULL, @NewValue = NULL;
            ELSE IF @SetTerms = 1
                SELECT @NewType = @CommType, @NewValue = CASE WHEN @CommType IS NULL THEN NULL ELSE @CommValue END;
            ELSE IF ISNULL(@OldPartner, 0) <> @PartnerId
                SELECT @NewType = CommType, @NewValue = CommValue FROM dbo.tblPartner WHERE Id = @PartnerId;
            ELSE
                SELECT @NewType = @OldType, @NewValue = @OldValue;

            IF NOT (ISNULL(@OldPartner, 0) = ISNULL(@PartnerId, 0) AND ISNULL(@OldType, '') = ISNULL(@NewType, '')
                    AND ISNULL(@OldValue, -1) = ISNULL(@NewValue, -1))
            BEGIN
                IF EXISTS (SELECT 1 FROM dbo.tblPartnerCommission WITH (UPDLOCK, HOLDLOCK)
                           WHERE LeadId = @LeadId AND CompId = @CompId AND Status = 'paid')  -- 107: a Reverted paid row freezes too
                BEGIN
                    ROLLBACK TRANSACTION;
                    SELECT ISNULL(@Id,0) AS Id, 409 AS ResponseCode, 'The commission for this lead is already paid, so its partner and commission cannot change' AS ResponseMess;
                    RETURN;
                END

                DECLARE @PartnerSource INT = (SELECT TOP 1 Id FROM dbo.tblLookup
                                              WHERE CompId = @CompId AND Kind = 'lead_source' AND Code = 'partner' AND IsActive = 1);
                UPDATE dbo.tblLeads
                SET PartnerId = @PartnerId, CommType = @NewType, CommValue = @NewValue,
                    SourceId = CASE WHEN @PartnerId IS NOT NULL AND @PartnerSource IS NOT NULL THEN @PartnerSource ELSE SourceId END
                WHERE Id = @LeadId AND CompId = @CompId;

                DECLARE @PartnerName NVARCHAR(200) = (SELECT Name FROM dbo.tblPartner WHERE Id = @PartnerId);
                DECLARE @PartnerSummary NVARCHAR(500) = CASE WHEN @PartnerId IS NULL THEN N'Partner removed' ELSE N'Partner: ' + @PartnerName END;
                INSERT INTO @actLog
                EXEC dbo.sp_LogLeadActivity
                    @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId,
                    @Type = 'partner', @Summary = @PartnerSummary, @MetaJSON = NULL;

                EXEC dbo.sp_SyncPartnerCommission @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId;
            END
        END
        -- 107 END partner block

        COMMIT TRANSACTION;

        SELECT @LeadId AS Id, 200 AS ResponseCode, 'Lead saved successfully' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT ISNULL(@Id,0) AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

-- ---------------------------------------------------------------------------
-- 10. sp_ScheduleFollowUp — live body (9.16) + spec 3.3: the lead must be
--     visible to the person and they need leads Edit (fn_RecordActions);
--     scheduling onto someone else needs that person in the leads
--     "Can assign to" list. @AssignedTo NULL still = the lead's owner.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_ScheduleFollowUp
    @CompId     INT,
    @LeadId     INT,
    @UserId     INT,
    @Type       VARCHAR(20) = 'call',
    @DueAt      DATETIME,
    @AssignedTo INT = NULL        -- NULL = the lead's current owner
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF @LeadId IS NULL OR @LeadId <= 0
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'LeadId is required' AS ResponseMess; RETURN; END
    IF @DueAt IS NULL
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'Due date is required' AS ResponseMess; RETURN; END
    IF @Type IS NULL OR @Type NOT IN ('call','visit','meeting','other')
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'Type must be call, visit, meeting or other' AS ResponseMess; RETURN; END

    DECLARE @BranchId INT, @OwnerId INT;
    SELECT @BranchId = BranchId, @OwnerId = OwnerId FROM dbo.tblLeads WHERE Id=@LeadId AND CompId=@CompId;
    IF @BranchId IS NULL
    BEGIN SELECT 0 AS Id, 404 AS ResponseCode, 'Lead not found' AS ResponseMess; RETURN; END

    -- 133: visible + leads Edit (no row = not visible, answered as not found).
    DECLARE @CanEdit BIT;
    SELECT @CanEdit = CanEdit FROM dbo.fn_RecordActions(@CompId, @UserId, 'leads', @LeadId);
    IF @CanEdit IS NULL
    BEGIN SELECT 0 AS Id, 404 AS ResponseCode, 'Lead not found' AS ResponseMess; RETURN; END
    IF @CanEdit = 0
    BEGIN SELECT 0 AS Id, 403 AS ResponseCode, 'You do not have permission for this action' AS ResponseMess; RETURN; END

    IF @AssignedTo IS NULL OR @AssignedTo <= 0 SET @AssignedTo = @OwnerId;
    -- 133: onto someone else only within the leads "Can assign to" list.
    ELSE IF @AssignedTo <> @UserId
         AND NOT EXISTS (SELECT 1 FROM dbo.fn_AssignableUsers(@CompId, @UserId, 'leads', @LeadId) WHERE Id = @AssignedTo)
    BEGIN SELECT 0 AS Id, 403 AS ResponseCode, 'You cannot assign records to that person' AS ResponseMess; RETURN; END

    INSERT INTO dbo.tblFollowUp (CompId, BranchId, LeadId, Type, DueAt, AssignedTo, Status, CreatedBy)
    VALUES (@CompId, @BranchId, @LeadId, @Type, @DueAt, @AssignedTo, 'open', @UserId);
    DECLARE @Id INT = CAST(SCOPE_IDENTITY() AS INT);

    EXEC dbo.sp_RefreshLeadNextFollowup @CompId = @CompId, @LeadId = @LeadId;

    SELECT @Id AS Id, 201 AS ResponseCode, 'Follow-up scheduled' AS ResponseMess;
END
GO

-- ---------------------------------------------------------------------------
-- 11. sp_SetTicketStatus — the one lifecycle engine (live body 7.1 / 101).
--     133 changes (spec 11 SQL 8, Ruling 15, C2):
--       * @AllowReopen is gone. A reopen needs fn_RecordActions.CanReopen
--         (Office reach or wider; or Team reach on a complaint assigned to one
--         of their people, never their own; Edit always) else 403.
--       * A reopen wipes EscalatedTo / EscalatedAt.
--       * A reopen whose assigned person is inactive or cannot work
--         complaints (no View + Edit) unassigns it: AssignedTo NULL, a history
--         row "Unassigned", LoggerHolds 0, and a ticket_reopen_unassigned
--         notice to everyone with Office reach or wider on complaints over
--         its office (admins are Company, so always in that set).
--     Everything else is the live text.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_SetTicketStatus
    @CompId        INT,
    @TicketId      INT,
    @StatusId      INT,
    @UserId        INT,
    @ResolutionId  INT            = NULL,
    @Remarks       NVARCHAR(1000) = NULL,
    @DueAtOverride DATETIME       = NULL   -- 101: Node's working-calendar due time on reopen; NULL = the old rule
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF @TicketId IS NULL OR @TicketId <= 0
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'TicketId is required' AS ResponseMess; RETURN; END
    IF @StatusId IS NULL OR @StatusId <= 0
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'StatusId is required' AS ResponseMess; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess; RETURN; END

    SET @Remarks = NULLIF(LTRIM(RTRIM(@Remarks)), N'');
    IF @ResolutionId IS NOT NULL AND @ResolutionId <= 0 SET @ResolutionId = NULL;

    -- where it is now (the join doubles as the tenancy check)
    DECLARE @FromStatusId INT, @FromCode VARCHAR(30), @FromName NVARCHAR(200),
            @StoredResolution INT, @Priority INT,
            @AssignedTo INT, @BranchId INT, @TicketNo VARCHAR(30), @Subject NVARCHAR(200);   -- 133
    SELECT @FromStatusId    = t.StatusId,
           @FromCode        = st.Code,
           @FromName        = st.Value,
           @StoredResolution = t.ResolutionId,
           @Priority        = t.Priority,
           @AssignedTo      = t.AssignedTo,
           @BranchId        = t.BranchId,
           @TicketNo        = t.TicketNo,
           @Subject         = t.Subject
    FROM dbo.tblTicket t
    JOIN dbo.tblLookup st ON st.Id = t.StatusId
    WHERE t.Id = @TicketId AND t.CompId = @CompId;
    IF @FromStatusId IS NULL
    BEGIN SELECT @TicketId AS Id, 404 AS ResponseCode, 'Ticket not found' AS ResponseMess; RETURN; END

    -- where it is being sent (must be a live ticket_status of this company)
    DECLARE @ToCode VARCHAR(30), @ToName NVARCHAR(200);
    SELECT @ToCode = Code, @ToName = Value
    FROM dbo.tblLookup
    WHERE Id = @StatusId AND CompId = @CompId AND Kind = 'ticket_status' AND IsActive = 1;
    IF @ToCode IS NULL
    BEGIN SELECT @TicketId AS Id, 404 AS ResponseCode, 'Status not found' AS ResponseMess; RETURN; END

    IF @FromStatusId = @StatusId
    BEGIN SELECT @TicketId AS Id, 200 AS ResponseCode, 'Complaint already in this status' AS ResponseMess; RETURN; END

    DECLARE @WasTerminal BIT = CASE WHEN @FromCode IN ('resolved', 'closed', 'rejected') THEN 1 ELSE 0 END;
    DECLARE @IsReopen   BIT = CASE WHEN @WasTerminal = 1 AND @ToCode IN ('open', 'onhold') THEN 1 ELSE 0 END;
    -- "resolution (param or existing)": the parameter wins, the stored one carries over
    DECLARE @EffResolution INT = COALESCE(@ResolutionId, @StoredResolution);

    IF @ResolutionId IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.tblLookup
                       WHERE Id = @ResolutionId AND CompId = @CompId AND Kind = 'resolution')
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'Invalid resolution' AS ResponseMess; RETURN; END

    IF @IsReopen = 1
    BEGIN
        -- 133: the database decides the reopen rule (fn_RecordActions.CanReopen).
        IF NOT EXISTS (SELECT 1 FROM dbo.fn_RecordActions(@CompId, @UserId, 'complaints', @TicketId) WHERE CanReopen = 1)
        BEGIN SELECT @TicketId AS Id, 403 AS ResponseCode, 'Reopening requires a manager' AS ResponseMess; RETURN; END
        IF @Remarks IS NULL
        BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'Remarks are required to reopen a complaint' AS ResponseMess; RETURN; END
    END
    ELSE IF @ToCode = 'resolved'
    BEGIN
        IF @EffResolution IS NULL
        BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'Resolution is required' AS ResponseMess; RETURN; END
        IF @Remarks IS NULL
        BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'Remarks are required to resolve a complaint' AS ResponseMess; RETURN; END
    END
    ELSE IF @ToCode = 'closed' AND @FromCode <> 'resolved'
    BEGIN
        -- Straight to closed: nobody ever recorded how it was fixed.
        IF @EffResolution IS NULL
        BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'Resolution is required' AS ResponseMess; RETURN; END
        IF @Remarks IS NULL
        BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'Remarks are required to close a complaint that was never resolved' AS ResponseMess; RETURN; END
    END
    ELSE IF @ToCode = 'rejected'
    BEGIN
        IF @Remarks IS NULL
        BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'Remarks are required to reject a complaint' AS ResponseMess; RETURN; END
    END

    -- 133 (Ruling 15): reopened onto someone who can no longer work complaints -> nobody.
    DECLARE @Unassign BIT = CASE WHEN @IsReopen = 1 AND @AssignedTo IS NOT NULL
                                  AND NOT EXISTS (SELECT 1 FROM dbo.fn_AccessGrants(@CompId, @AssignedTo) g
                                                  WHERE g.Module = 'complaints' AND g.CanEdit = 1)
                                 THEN 1 ELSE 0 END;

    DECLARE @Now DATETIME = GETDATE();
    -- The reopened clock starts now, not at creation.
    DECLARE @Tat INT = (SELECT TatHours FROM dbo.tblLookup WHERE Id = @Priority);
    DECLARE @ActType VARCHAR(30) =
        CASE WHEN @IsReopen = 1        THEN 'reopened'
             WHEN @ToCode = 'resolved' THEN 'resolved'
             WHEN @ToCode = 'closed'   THEN 'closed'
             WHEN @ToCode = 'rejected' THEN 'rejected'
             ELSE 'status' END;

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));
        DECLARE @hist   TABLE (FromStatusId INT);

        UPDATE dbo.tblTicket
        SET StatusId     = @StatusId,
            ResolvedAt   = CASE WHEN @ToCode IN ('resolved', 'closed') THEN ISNULL(ResolvedAt, @Now) ELSE NULL END,
            ClosedAt     = CASE WHEN @ToCode IN ('closed', 'rejected') THEN ISNULL(ClosedAt, @Now)   ELSE NULL END,
            ResolutionId = CASE WHEN @ToCode IN ('resolved', 'closed') THEN @EffResolution           ELSE NULL END,
            DueAt        = CASE WHEN @IsReopen = 1
                                THEN ISNULL(@DueAtOverride, CASE WHEN @Tat IS NULL THEN NULL ELSE DATEADD(HOUR, @Tat, @Now) END)
                                ELSE DueAt END,
            TatAnchorAt  = CASE WHEN @IsReopen = 1 THEN @Now ELSE TatAnchorAt END,
            EscalatedTo  = CASE WHEN @IsReopen = 1 THEN NULL ELSE EscalatedTo END,   -- 133 (C2)
            EscalatedAt  = CASE WHEN @IsReopen = 1 THEN NULL ELSE EscalatedAt END,   -- 133 (C2)
            AssignedTo   = CASE WHEN @Unassign = 1 THEN NULL ELSE AssignedTo END,    -- 133 (Ruling 15)
            AssignedAt   = CASE WHEN @Unassign = 1 THEN NULL ELSE AssignedAt END,
            LoggerHolds  = CASE WHEN @Unassign = 1 THEN 0 ELSE LoggerHolds END,
            EditBy = @UserId, UpdatedAt = @Now
        OUTPUT deleted.StatusId INTO @hist (FromStatusId)
        WHERE Id = @TicketId AND CompId = @CompId;

        INSERT INTO dbo.tblTicketStatusHistory (CompId, TicketId, FromStatusId, ToStatusId, ChangedBy, ChangedAt)
        SELECT @CompId, @TicketId, h.FromStatusId, @StatusId, @UserId, @Now FROM @hist h;

        DECLARE @Summary NVARCHAR(500) = LEFT(N'Status: ' + @FromName + N' → ' + @ToName
                                              + CASE WHEN @Remarks IS NULL THEN N'' ELSE N' — ' + @Remarks END, 500);
        DECLARE @Meta NVARCHAR(MAX) = (SELECT @FromStatusId AS fromStatusId, @StatusId AS toStatusId,
                                              @FromCode AS fromCode, @ToCode AS toCode,
                                              CASE WHEN @ToCode IN ('resolved', 'closed') THEN @EffResolution END AS resolutionId,
                                              @Remarks AS remarks
                                       FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES);
        INSERT INTO @actLog
        EXEC dbo.sp_LogTicketActivity
            @CompId = @CompId, @TicketId = @TicketId, @UserId = @UserId,
            @Type = @ActType, @Summary = @Summary, @MetaJSON = @Meta;

        -- 133 (Ruling 15): the unassignment, on the history, the timeline and to the office's managers.
        IF @Unassign = 1
        BEGIN
            INSERT INTO dbo.tblTicketAssignment
                (CompId, TicketId, FromUserId, ToUserId, FromBranchId, ToBranchId, ReasonId, Remarks, AssignedBy, AssignedAt)
            VALUES
                (@CompId, @TicketId, @AssignedTo, NULL, @BranchId, @BranchId, NULL, N'Unassigned', @UserId, @Now);

            DECLARE @GoneName NVARCHAR(200) = ISNULL((SELECT FullName FROM dbo.tblUser WHERE Id = @AssignedTo), N'');
            DECLARE @UnSummary NVARCHAR(500) = LEFT(N'Unassigned on reopen: ' + @GoneName + N' can no longer work complaints', 500);
            DECLARE @UnMeta NVARCHAR(MAX) = (SELECT @AssignedTo AS fromUserId, CAST(NULL AS INT) AS toUserId,
                                                    @BranchId AS fromBranchId, @BranchId AS toBranchId,
                                                    CAST(NULL AS INT) AS reasonId, N'Unassigned' AS remarks
                                             FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES);
            INSERT INTO @actLog
            EXEC dbo.sp_LogTicketActivity
                @CompId = @CompId, @TicketId = @TicketId, @UserId = @UserId,
                @Type = 'assigned', @Summary = @UnSummary, @MetaJSON = @UnMeta;

            INSERT INTO dbo.tblNotifications (UserId, Type, EntityType, EntityId, ActorUserId, Title, Body, CompId, BranchId)
            SELECT c.Id, 'ticket_reopen_unassigned', 'ticket', @TicketId, @UserId,
                   'Reopened complaint is unassigned', LEFT(@TicketNo + N' — ' + @Subject, 1000), @CompId, @BranchId
            FROM dbo.tblUser c
            CROSS APPLY dbo.fn_AccessScope(@CompId, c.Id, 'complaints') sc
            WHERE c.CompId = @CompId AND c.IsActive = 1 AND c.Id <> @UserId
              AND (   sc.ReachLevel = 5
                   OR (sc.ReachLevel >= 3
                       AND EXISTS (SELECT 1 FROM dbo.fn_AccessOffices(@CompId, c.Id) o
                                   WHERE o.BranchId = @BranchId AND (o.Level = 3 OR sc.ReachLevel >= 4))))
              AND NOT EXISTS (SELECT 1 FROM dbo.tblNotificationPreferences np
                              WHERE np.UserId = c.Id AND np.Type = 'ticket_reopen_unassigned'
                                AND np.Channel = 'inapp' AND np.IsEnabled = 0);
        END

        COMMIT TRANSACTION;

        SELECT @TicketId AS Id, 200 AS ResponseCode, 'Complaint status updated successfully' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT @TicketId AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

-- ---------------------------------------------------------------------------
-- 12. The shortcuts into the engine (B1): the same bodies, minus the
--     @AllowReopen argument the engine no longer takes. sp_ReopenTicket loses
--     its own @AllowReopen parameter too.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_ReopenTicket
    @CompId        INT,
    @TicketId      INT,
    @Remarks       NVARCHAR(1000),
    @UserId        INT,
    @DueAtOverride DATETIME = NULL   -- 101: forwarded to sp_SetTicketStatus
AS
BEGIN
    SET NOCOUNT ON;

    -- The first OPEN status by SortOrder — 'New' on a seeded company.
    DECLARE @StatusId INT = (SELECT TOP 1 Id FROM dbo.tblLookup
                             WHERE CompId = @CompId AND Kind = 'ticket_status'
                               AND Code = 'open' AND IsActive = 1
                             ORDER BY SortOrder, Id);
    IF @StatusId IS NULL
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'This company has no open status configured' AS ResponseMess; RETURN; END

    EXEC dbo.sp_SetTicketStatus
        @CompId = @CompId, @TicketId = @TicketId, @StatusId = @StatusId, @UserId = @UserId,
        @ResolutionId = NULL, @Remarks = @Remarks, @DueAtOverride = @DueAtOverride;
END
GO

CREATE OR ALTER PROC dbo.sp_ResolveTicket
    @CompId       INT,
    @TicketId     INT,
    @ResolutionId INT,
    @Remarks      NVARCHAR(1000),
    @UserId       INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @StatusId INT = (SELECT TOP 1 Id FROM dbo.tblLookup
                             WHERE CompId = @CompId AND Kind = 'ticket_status'
                               AND Code = 'resolved' AND IsActive = 1
                             ORDER BY SortOrder, Id);
    IF @StatusId IS NULL
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'This company has no Resolved status configured' AS ResponseMess; RETURN; END

    EXEC dbo.sp_SetTicketStatus
        @CompId = @CompId, @TicketId = @TicketId, @StatusId = @StatusId, @UserId = @UserId,
        @ResolutionId = @ResolutionId, @Remarks = @Remarks;
END
GO

CREATE OR ALTER PROC dbo.sp_CloseTicket
    @CompId       INT,
    @TicketId     INT,
    @UserId       INT,
    @ResolutionId INT            = NULL,
    @Remarks      NVARCHAR(1000) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @StatusId INT = (SELECT TOP 1 Id FROM dbo.tblLookup
                             WHERE CompId = @CompId AND Kind = 'ticket_status'
                               AND Code = 'closed' AND IsActive = 1
                             ORDER BY SortOrder, Id);
    IF @StatusId IS NULL
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'This company has no Closed status configured' AS ResponseMess; RETURN; END

    EXEC dbo.sp_SetTicketStatus
        @CompId = @CompId, @TicketId = @TicketId, @StatusId = @StatusId, @UserId = @UserId,
        @ResolutionId = @ResolutionId, @Remarks = @Remarks;
END
GO

CREATE OR ALTER PROC dbo.sp_RejectTicket
    @CompId   INT,
    @TicketId INT,
    @Remarks  NVARCHAR(1000),
    @UserId   INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @StatusId INT = (SELECT TOP 1 Id FROM dbo.tblLookup
                             WHERE CompId = @CompId AND Kind = 'ticket_status'
                               AND Code = 'rejected' AND IsActive = 1
                             ORDER BY SortOrder, Id);
    IF @StatusId IS NULL
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'This company has no Rejected status configured' AS ResponseMess; RETURN; END

    EXEC dbo.sp_SetTicketStatus
        @CompId = @CompId, @TicketId = @TicketId, @StatusId = @StatusId, @UserId = @UserId,
        @ResolutionId = NULL, @Remarks = @Remarks;
END
GO

-- ---------------------------------------------------------------------------
-- 13. sp_EscalateTicket — live body (7.8) + the target must be able to open
--     complaints (complaints View; spec 3.1). Lines marked "133".
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_EscalateTicket
    @CompId   INT,
    @TicketId INT,
    @ToUserId INT,
    @Remarks  NVARCHAR(1000),
    @UserId   INT
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF @TicketId IS NULL OR @TicketId <= 0
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'TicketId is required' AS ResponseMess; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess; RETURN; END
    IF @ToUserId IS NULL OR @ToUserId <= 0
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'An escalation target is required' AS ResponseMess; RETURN; END

    SET @Remarks = NULLIF(LTRIM(RTRIM(@Remarks)), N'');
    IF @Remarks IS NULL
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'Remarks are required to escalate a complaint' AS ResponseMess; RETURN; END

    DECLARE @Code VARCHAR(30), @AssignedTo INT, @BranchId INT, @TicketNo VARCHAR(30), @Subject NVARCHAR(200);
    SELECT @Code = st.Code, @AssignedTo = t.AssignedTo, @BranchId = t.BranchId,
           @TicketNo = t.TicketNo, @Subject = t.Subject
    FROM dbo.tblTicket t
    JOIN dbo.tblLookup st ON st.Id = t.StatusId
    WHERE t.Id = @TicketId AND t.CompId = @CompId;
    IF @Code IS NULL
    BEGIN SELECT @TicketId AS Id, 404 AS ResponseCode, 'Ticket not found' AS ResponseMess; RETURN; END
    IF @Code NOT IN ('open', 'onhold')
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'Only open complaints can be escalated' AS ResponseMess; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Id = @ToUserId AND CompId = @CompId AND IsActive = 1)
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'Target user not found or inactive' AS ResponseMess; RETURN; END
    -- 133: the senior must be able to open complaints.
    IF NOT EXISTS (SELECT 1 FROM dbo.fn_AccessScope(@CompId, @ToUserId, 'complaints'))
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'Escalation target must be able to open complaints' AS ResponseMess; RETURN; END

    -- Walk up from whoever holds it. Depth > 0 excludes self; Depth < 20 caps
    -- the walk (and breaks a ReportsTo cycle in bad data).
    DECLARE @Base INT = ISNULL(@AssignedTo, @UserId);
    DECLARE @IsSenior BIT = 0;
    ;WITH chain AS (
        SELECT u.Id, u.ReportsTo, 0 AS Depth
        FROM dbo.tblUser u WHERE u.Id = @Base AND u.CompId = @CompId
        UNION ALL
        SELECT m.Id, m.ReportsTo, c.Depth + 1
        FROM dbo.tblUser m JOIN chain c ON m.Id = c.ReportsTo
        WHERE m.CompId = @CompId AND c.Depth < 20
    )
    SELECT @IsSenior = 1 FROM chain WHERE Id = @ToUserId AND Depth > 0
    OPTION (MAXRECURSION 32);

    IF @IsSenior = 0
    BEGIN SELECT @TicketId AS Id, 400 AS ResponseCode, 'Escalation target must be a senior of the assignee' AS ResponseMess; RETURN; END

    DECLARE @Now DATETIME = GETDATE();

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));

        UPDATE dbo.tblTicket
        SET EscalatedTo = @ToUserId, EscalatedAt = @Now,
            EditBy = @UserId, UpdatedAt = @Now
        WHERE Id = @TicketId AND CompId = @CompId;

        DECLARE @ToName NVARCHAR(200) = ISNULL((SELECT FullName FROM dbo.tblUser WHERE Id = @ToUserId), N'');
        DECLARE @Summary NVARCHAR(500) = LEFT(N'Escalated to ' + @ToName + N' — ' + @Remarks, 500);
        DECLARE @Meta NVARCHAR(MAX) = (SELECT @ToUserId AS toUserId, @Remarks AS remarks
                                       FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES);
        INSERT INTO @actLog
        EXEC dbo.sp_LogTicketActivity
            @CompId = @CompId, @TicketId = @TicketId, @UserId = @UserId,
            @Type = 'escalated', @Summary = @Summary, @MetaJSON = @Meta;

        DECLARE @ntf TABLE (ResponseCode INT, ResponseMess VARCHAR(400), NotificationId BIGINT, UserId INT, Type VARCHAR(40));
        DECLARE @NtfBody NVARCHAR(1000) = LEFT(@TicketNo + N' — ' + @Subject + N': ' + @Remarks, 1000);
        INSERT INTO @ntf
        EXEC dbo.sp_CreateNotification
            @UserId = @ToUserId, @Type = 'ticket_escalated', @EntityType = 'ticket', @EntityId = @TicketId,
            @ActorUserId = @UserId, @Title = 'Complaint escalated', @Body = @NtfBody,
            @CompId = @CompId, @BranchId = @BranchId;

        COMMIT TRANSACTION;

        SELECT @TicketId AS Id, 200 AS ResponseCode, 'Complaint escalated successfully' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT @TicketId AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

-- ---------------------------------------------------------------------------
-- 14. sp_FetchTicketEscalationTargets (new; plan Ruling 3 leaves
--     sp_FetchEscalationTargets to tatController). The "Reports to" chain
--     above the complaint's assigned person (the caller when unassigned —
--     exactly what sp_EscalateTicket accepts), active seniors who can open
--     complaints only, nearest first.
--       @TicketId given: the complaint must be in fn_VisibleTickets.
--       @TicketId NULL, @ForUserId given (installed phone builds, old web;
--       plan Ruling 4): answered only when the caller sees at least one
--       in-progress complaint assigned to that person.
--       Neither, or @UserId NULL: no rows.
--     Rows: Id, FullName, JobTitle, BranchId, BranchName, Depth (+ the usual
--     ResponseCode / ResponseMess columns).
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchTicketEscalationTargets
    @CompId    BIGINT,
    @UserId    INT,
    @TicketId  INT,
    @ForUserId INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Base INT;

    IF @TicketId IS NOT NULL
        SELECT @Base = ISNULL(t.AssignedTo, @UserId)
        FROM dbo.tblTicket t
        WHERE t.Id = @TicketId AND t.CompId = @CompId
          AND t.Id IN (SELECT TicketId FROM dbo.fn_VisibleTickets(@CompId, @UserId));
    ELSE IF @ForUserId IS NOT NULL
         AND EXISTS (SELECT 1 FROM dbo.tblTicket t
                     JOIN dbo.tblLookup s ON s.Id = t.StatusId
                     WHERE t.CompId = @CompId AND t.AssignedTo = @ForUserId AND s.Code IN ('open', 'onhold')
                       AND t.Id IN (SELECT TicketId FROM dbo.fn_VisibleTickets(@CompId, @UserId)))
        SET @Base = @ForUserId;

    ;WITH chain AS (
        SELECT u.Id, u.ReportsTo, 0 AS Depth
        FROM dbo.tblUser u WHERE u.Id = @Base AND u.CompId = @CompId
        UNION ALL
        SELECT m.Id, m.ReportsTo, c.Depth + 1
        FROM dbo.tblUser m JOIN chain c ON m.Id = c.ReportsTo
        WHERE m.CompId = @CompId AND c.Depth < 20
    )
    SELECT u.Id, u.FullName, u.JobTitle, u.BranchId, b.BranchName,
           MIN(c.Depth) AS Depth,
           200 AS ResponseCode, 'Escalation targets retrieved successfully' AS ResponseMess
    FROM chain c
    JOIN dbo.tblUser u        ON u.Id = c.Id
    LEFT JOIN dbo.tblBranch b ON b.Id = u.BranchId
    WHERE c.Depth > 0 AND u.IsActive = 1
      AND EXISTS (SELECT 1 FROM dbo.fn_AccessScope(@CompId, u.Id, 'complaints'))
    GROUP BY u.Id, u.FullName, u.JobTitle, u.BranchId, b.BranchName
    ORDER BY Depth
    OPTION (MAXRECURSION 32);
END
GO

-- ---------------------------------------------------------------------------
-- 15. sp_SaveUser — live body (094 / 096) + stranded work (spec 3.7, Ruling
--     15): after an edit that changes the person's role, active flag or
--     office, their stranded counts (fn_StrandedWork) are compared with the
--     counts before; when one went up, sp_NotifyStranded tells their manager
--     (numeric id JSON, e.g. [82]). Success rows gain StrandedLeads,
--     StrandedComplaints (the counts after the change; 0 when nothing of the
--     three changed, and on create). Lines marked "133".
--     @ActorUserId loses its default (N1a, review fix 2): leaving it out is
--     error 201; NULL answers 400 "ActorUserId is required" before anything.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_SaveUser
    @Id INT,
    @Username VARCHAR(100),
    @Password VARCHAR(500),
    @UserActive BIT,
    @IsAdmin BIT = NULL,             -- ignored since 094: admin comes from the group
    @UserIp VARCHAR(50),
    @AllowDay INT,
    @FullName VARCHAR(200),
    @Email VARCHAR(150),
    @JobTitle VARCHAR(100),
    @HourlyRate DECIMAL(10,2),
    @GroupId INT,
    @CompId BIGINT,
    @BranchId BIGINT = NULL,         -- NULL on edit = keep the current branch (094)
    @Mobile VARCHAR(20) = NULL,
    @ReportsTo INT = NULL,
    @ActorUserId INT,                -- who is saving (094); 133: required, no default (N1a)
    @ActorIsAdmin BIT = NULL         -- 096: Node passes req.scope.isAdmin; NULL = legacy caller (admin-only route)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(400);

    -- 133: fail closed on a missing actor (the self-deactivation guard, the
    -- stranded notice and the task release all need one).
    IF (@ActorUserId IS NULL OR @ActorUserId <= 0)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'ActorUserId is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@Username IS NULL OR LTRIM(RTRIM(@Username)) = '')
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Username is required and cannot be blank';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- A new user needs a password. An edit may omit it to keep the current one.
    IF (@Id = 0 AND (@Password IS NULL OR LTRIM(RTRIM(@Password)) = ''))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Password is required and cannot be blank';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    IF (@FullName IS NULL OR LTRIM(RTRIM(@FullName)) = '')
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Full name is required and cannot be blank';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- Normalize blanks to NULL so filtered-unique indexes ignore them.
    IF (@Mobile IS NOT NULL AND LTRIM(RTRIM(@Mobile)) = '') SET @Mobile = NULL;
    IF (@Email  IS NOT NULL AND LTRIM(RTRIM(@Email))  = '') SET @Email  = NULL;
    -- NULL = keep the current manager; 0 = clear it (spec 2026-10-07 §6).
    DECLARE @ClearReportsTo BIT = CASE WHEN @ReportsTo IS NOT NULL AND @ReportsTo <= 0 THEN 1 ELSE 0 END;
    IF @ClearReportsTo = 1 SET @ReportsTo = NULL;

    IF (@Id > 0 AND @UserActive = 0 AND @Id = @ActorUserId)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'You cannot deactivate your own account';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- No default group (094): the old ELSE SET @GroupId = 8 pointed at a group
    -- that does not exist. A role is required, and it must be this company's.
    IF (@GroupId IS NULL OR @GroupId <= 0
        OR NOT EXISTS (SELECT 1 FROM tblUserGroups WHERE Id = @GroupId AND CompId = @CompId AND IsActive = 1))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Pick an active role for this user';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- A non-admin (HR with people.edit) may not mint or touch an admin.
    IF @ActorIsAdmin = 0   -- NULL (legacy caller) skips the guard
    BEGIN
        IF EXISTS (SELECT 1 FROM tblUserGroups WHERE Id = @GroupId AND IsAdmin = 1)
        BEGIN SET @ResponseCode = 403; SET @ResponseMess = 'Only an administrator can give the admin role';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
        IF @Id > 0 AND EXISTS (SELECT 1 FROM tblUserGroupMap m JOIN tblUserGroups g ON g.Id = m.GroupId
                               WHERE m.UserId = @Id AND g.IsAdmin = 1 AND g.IsActive = 1)
        BEGIN SET @ResponseCode = 403; SET @ResponseMess = 'Only an administrator can edit an administrator';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    END

    IF (@Id = 0 AND @BranchId IS NULL)
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Branch is required';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    IF (@BranchId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tblBranch WHERE Id = @BranchId))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid branch';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    -- 133 (review fix 1): nobody is moved into a closed office. Not fn_CompanyOffice:
    -- the first person of a new office has nobody there yet. Keeping a person's
    -- current office (even a closed one) stays allowed.
    IF (@BranchId IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM tblBranch WHERE Id = @BranchId AND IsActive = 1)
        AND NOT EXISTS (SELECT 1 FROM tblUser WHERE Id = @Id AND CompId = @CompId AND BranchId = @BranchId))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid branch';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- tblUser.IsAdmin is a mirror of the role, never taken from the form (094).
    DECLARE @GroupIsAdmin BIT = (SELECT IsAdmin FROM tblUserGroups WHERE Id = @GroupId);

    -- Never deactivate the last active admin, nor move them into a non-admin
    -- role: either way nobody would be left to undo it.
    IF (@Id > 0 AND (@UserActive = 0 OR ISNULL(@GroupIsAdmin, 0) = 0)
        AND EXISTS (SELECT 1 FROM tblUser u
                      JOIN tblUserGroupMap m ON m.UserId = u.Id
                      JOIN tblUserGroups g ON g.Id = m.GroupId AND g.IsActive = 1 AND g.IsAdmin = 1
                     WHERE u.Id = @Id AND u.CompId = @CompId AND u.IsActive = 1)
        AND NOT EXISTS (SELECT 1 FROM tblUser u
                          JOIN tblUserGroupMap m ON m.UserId = u.Id
                          JOIN tblUserGroups g ON g.Id = m.GroupId AND g.IsActive = 1 AND g.IsAdmin = 1
                         WHERE u.CompId = @CompId AND u.IsActive = 1 AND u.Id <> @Id))
    BEGIN SET @ResponseCode = 409;
          SET @ResponseMess = 'This is the last active admin. Make someone else an admin before deactivating them or changing their role.';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    -- Reporting line: must be a colleague, not self, and must not loop.
    IF @ReportsTo IS NOT NULL
    BEGIN
        IF @ReportsTo = @Id
        BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'A user cannot report to themselves';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
        IF NOT EXISTS (SELECT 1 FROM tblUser WHERE Id = @ReportsTo AND CompId = @CompId)
        BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Reports To must be a user in this company';
              SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

        DECLARE @cur INT = @ReportsTo, @hops INT = 0;
        WHILE @cur IS NOT NULL AND @hops < 20
        BEGIN
            IF @cur = @Id
            BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Reporting line would loop back to this user';
                  SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
            SET @cur = (SELECT ReportsTo FROM tblUser WHERE Id = @cur AND CompId = @CompId);
            SET @hops += 1;
        END
    END

    -- Login keys are GLOBAL (not per-company) -- a friendly 409 before the
    -- unique index would throw a raw error.
    IF EXISTS (SELECT 1 FROM tblUser WHERE Username = @Username AND Id <> @Id)
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Username already exists';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    IF (@Email IS NOT NULL AND EXISTS (SELECT 1 FROM tblUser WHERE Email = @Email AND Id <> @Id))
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Email already in use';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END
    IF (@Mobile IS NOT NULL AND EXISTS (SELECT 1 FROM tblUser WHERE Mobile = @Mobile AND Id <> @Id))
    BEGIN SET @ResponseCode = 409; SET @ResponseMess = 'Mobile already in use';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    DECLARE @WasActive BIT;
    -- Boards where a deactivated user held open work (094): returned as the
    -- 2nd result set so the caller can refresh those boards and owners.
    DECLARE @Released TABLE (WorkspaceId BIGINT PRIMARY KEY, OwnerUserId INT, TaskCount INT);
    -- 133: stranded work before / after.
    DECLARE @OldBranch BIGINT, @RoleChanged BIT = 0, @Changed BIT = 0,
            @BeforeL INT = 0, @BeforeC INT = 0, @AfterL INT = 0, @AfterC INT = 0,
            @StrandIds NVARCHAR(50);

    BEGIN TRY
        BEGIN TRANSACTION;

        IF (@Id = 0)
        BEGIN
            INSERT INTO tblUser
                (Username, Password, IsActive, IsAdmin, UserIp, AllowDay,
                 FullName, Email, JobTitle, HourlyRate, Mobile, CompId, BranchId, ReportsTo)
            VALUES
                (@Username, @Password, @UserActive, @GroupIsAdmin, @UserIp, @AllowDay,
                 @FullName, @Email, @JobTitle, @HourlyRate, @Mobile, @CompId, @BranchId, @ReportsTo);

            SET @Id = SCOPE_IDENTITY();

            INSERT INTO tblUserGroupMap (UserId, GroupId) VALUES (@Id, @GroupId);

            COMMIT TRANSACTION;

            SET @ResponseCode = 201;
            SET @ResponseMess = 'User created successfully';

            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @Id AS UserId, @GroupId AS AssignedGroupId,
                   0 AS StrandedLeads, 0 AS StrandedComplaints;   -- 133
        END
        ELSE
        BEGIN
            SELECT @WasActive = IsActive, @OldBranch = BranchId FROM tblUser WHERE Id = @Id AND CompId = @CompId;
            IF (@WasActive IS NULL)
            BEGIN
                ROLLBACK TRANSACTION;
                SET @ResponseCode = 404; SET @ResponseMess = 'User not found';
                SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN;
            END

            -- 133: what changes, and the stranded counts before it.
            SET @RoleChanged = CASE WHEN EXISTS (SELECT 1 FROM tblUserGroupMap WHERE UserId = @Id AND GroupId <> @GroupId)
                                      OR NOT EXISTS (SELECT 1 FROM tblUserGroupMap WHERE UserId = @Id AND GroupId = @GroupId)
                                    THEN 1 ELSE 0 END;
            SET @Changed = CASE WHEN @RoleChanged = 1 OR @WasActive <> @UserActive
                                  OR (@BranchId IS NOT NULL AND @BranchId <> ISNULL(@OldBranch, -1))
                                THEN 1 ELSE 0 END;
            IF @Changed = 1
                SELECT @BeforeL = Leads, @BeforeC = Complaints FROM dbo.fn_StrandedWork(@CompId) WHERE UserId = @Id;

            UPDATE tblUser
               SET Username = @Username, IsActive = @UserActive,
                   IsAdmin = @GroupIsAdmin, UserIp = @UserIp, AllowDay = @AllowDay,
                   FullName = @FullName, Email = @Email, JobTitle = @JobTitle,
                   HourlyRate = @HourlyRate, Mobile = @Mobile,
                   ReportsTo = CASE WHEN @ClearReportsTo = 1 THEN NULL ELSE ISNULL(@ReportsTo, ReportsTo) END,
                   BranchId = ISNULL(@BranchId, BranchId),
                   -- Password only when a new hash is supplied; blank means
                   -- "keep current" (same contract as sp_UpdateOwnProfile).
                   Password = CASE WHEN @Password IS NOT NULL AND LEN(@Password) > 0
                                   THEN @Password ELSE Password END
             WHERE Id = @Id AND CompId = @CompId;

            DELETE FROM tblUserGroupMap WHERE UserId = @Id;
            INSERT INTO tblUserGroupMap (UserId, GroupId) VALUES (@Id, @GroupId);

            -- Deactivation releases their open tasks (spec items 5/16, 094): one
            -- rule in one place, sp_UnassignInvalidAssignees, run per board the
            -- user holds open work on. Plain EXEC — it uses INSERT...EXEC itself.
            IF (@WasActive = 1 AND @UserActive = 0)
            BEGIN
                INSERT INTO @Released (WorkspaceId, OwnerUserId, TaskCount)
                SELECT w.Id, w.OwnerUserId, COUNT(DISTINCT t.Id)
                  FROM dbo.tblTaskAssignee a
                  JOIN dbo.tblTasks      t ON t.Id = a.TaskId
                  JOIN dbo.tblWorkspaces w ON w.Id = t.WorkspaceId
                 WHERE a.UserId = @Id
                   AND w.CompId = @CompId
                   AND w.Type IN ('shared', 'project')
                   AND t.IsCompleted = 0
                   AND t.IsDeleted = 0
                 GROUP BY w.Id, w.OwnerUserId;

                DECLARE @RelWs BIGINT = (SELECT MIN(WorkspaceId) FROM @Released);
                WHILE (@RelWs IS NOT NULL)
                BEGIN
                    EXEC dbo.sp_UnassignInvalidAssignees
                         @WorkspaceId = @RelWs, @ActorUserId = @ActorUserId, @CompId = @CompId;
                    SET @RelWs = (SELECT MIN(WorkspaceId) FROM @Released WHERE WorkspaceId > @RelWs);
                END
            END

            -- 133: newly stranded work -> their manager is told (one notice per module).
            IF @Changed = 1
            BEGIN
                SELECT @AfterL = Leads, @AfterC = Complaints FROM dbo.fn_StrandedWork(@CompId) WHERE UserId = @Id;
                IF @AfterL > @BeforeL OR @AfterC > @BeforeC
                BEGIN
                    SET @StrandIds = '[' + CAST(@Id AS VARCHAR(12)) + ']';
                    EXEC dbo.sp_NotifyStranded @CompId = @CompId, @UserIdsJson = @StrandIds, @ActorUserId = @ActorUserId;
                END
            END

            COMMIT TRANSACTION;

            SET @ResponseCode = 200;
            SET @ResponseMess = 'User updated successfully';

            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
                   @Id AS UserId, @GroupId AS AssignedGroupId,
                   ISNULL(@AfterL, 0) AS StrandedLeads, ISNULL(@AfterC, 0) AS StrandedComplaints;   -- 133
            -- 2nd result set (094): boards whose open tasks this save released.
            SELECT WorkspaceId, OwnerUserId, TaskCount FROM @Released;
        END
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SET @ResponseCode = 500;
        SET @ResponseMess = ERROR_MESSAGE();
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    END CATCH
END
GO

-- ---------------------------------------------------------------------------
-- 16. LoggerHolds: re-run 130's backfill (Ruling 12; idempotent: 1 only where
--     nobody is assigned and no history row names anyone, so every assigned
--     row gets 0), then the constraint, now that the six writers keep it.
-- ---------------------------------------------------------------------------
UPDATE t SET LoggerHolds = x.Want
FROM dbo.tblTicket t
CROSS APPLY (SELECT CAST(CASE WHEN t.AssignedTo IS NULL
                               AND NOT EXISTS (SELECT 1 FROM dbo.tblTicketAssignment a
                                               WHERE a.TicketId = t.Id
                                                 AND (a.ToUserId IS NOT NULL OR a.FromUserId IS NOT NULL))
                              THEN 1 ELSE 0 END AS BIT) AS Want) x
WHERE t.LoggerHolds <> x.Want;
PRINT '133: tblTicket.LoggerHolds changed on ' + CAST(@@ROWCOUNT AS VARCHAR(10)) + ' row(s)';

UPDATE l SET LoggerHolds = x.Want
FROM dbo.tblLeads l
CROSS APPLY (SELECT CAST(CASE WHEN l.OwnerId IS NULL
                               AND NOT EXISTS (SELECT 1 FROM dbo.tblLeadAssignment a
                                               WHERE a.LeadId = l.Id
                                                 AND (a.ToUserId IS NOT NULL OR a.FromUserId IS NOT NULL))
                              THEN 1 ELSE 0 END AS BIT) AS Want) x
WHERE l.LoggerHolds <> x.Want;
PRINT '133: tblLeads.LoggerHolds changed on ' + CAST(@@ROWCOUNT AS VARCHAR(10)) + ' row(s)';
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_tblTicket_LoggerHolds')
    ALTER TABLE dbo.tblTicket WITH CHECK
        ADD CONSTRAINT CK_tblTicket_LoggerHolds CHECK (NOT (LoggerHolds = 1 AND AssignedTo IS NOT NULL));
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_tblLeads_LoggerHolds')
    ALTER TABLE dbo.tblLeads WITH CHECK
        ADD CONSTRAINT CK_tblLeads_LoggerHolds CHECK (NOT (LoggerHolds = 1 AND OwnerId IS NOT NULL));
GO

SET NOEXEC OFF;
GO

-- ===========================================================================
-- Verify after apply. Run each block on its own; each prints PASS n / FAIL n.
-- Every block that writes runs inside BEGIN TRAN ... ROLLBACK. User and record
-- ids are TestCRM's (company 1, checked 2026-11-22):
--   pooja.joshi 82 (Support Agent, Own, office 6, reports to vikram.rao 75)
--   sandeep.kumar 83 (Support Agent, office 6)   ananya.das 84 (office 7)
--   imran.khan 85 (Support Agent, office 1)      priya.singh 78 (Sales Executive, office 6, no complaints)
--   vikram.rao 75 (Support Head, Company)        bm_ho_rahul 15 (Branch Manager, Office, office 1)
--   se_ho_amit 17 / se_ho_sara 18 / se_ho_karan 19 (Sales Executives, Own, office 1)
--   complaints 1086 (pooja, open, EscalatedTo 75), 1087 / 1089 (pooja, open;
--   1089 was given to her by vikram), 1096 (pooja, resolved), 1093 (ananya,
--   resolved), 1090 (ananya, open), 1094 (imran, open); transfer_reason 37.
-- On another database pick records and users of the same kind.
-- Success calls are not captured with INSERT ... EXEC (the procs use
-- INSERT ... EXEC themselves, which cannot nest); their effects are checked.
-- Refusals return before any INSERT ... EXEC, so they are captured.
--
-- 1. Own-reach agent reassigns an in-progress complaint she holds to an office
--    colleague who works complaints -> it leaves her view, escalation wiped,
--    DueAt unchanged, one history row, one ticket_assigned notice.
-- BEGIN TRAN;
-- DECLARE @due DATETIME = (SELECT DueAt FROM dbo.tblTicket WHERE Id = 1086);
-- DECLARE @h INT = (SELECT COUNT(*) FROM dbo.tblTicketAssignment WHERE TicketId = 1086);
-- DECLARE @n INT = (SELECT COUNT(*) FROM dbo.tblNotifications WHERE UserId = 83 AND Type = 'ticket_assigned' AND EntityId = 1086);
-- EXEC dbo.sp_TransferTicket @CompId = 1, @TicketId = 1086, @ToUserId = 83, @ToBranchId = NULL,
--      @ReasonId = 37, @Remarks = N'verify 133', @UserId = 82, @SendBack = 0;
-- SELECT CASE WHEN EXISTS (SELECT 1 FROM dbo.tblTicket WHERE Id = 1086 AND AssignedTo = 83 AND EscalatedTo IS NULL
--                          AND EscalatedAt IS NULL AND LoggerHolds = 0 AND ISNULL(DueAt, '19000101') = ISNULL(@due, '19000101'))
--              AND 1086 NOT IN (SELECT TicketId FROM dbo.fn_VisibleTickets(1, 82))
--              AND (SELECT COUNT(*) FROM dbo.tblTicketAssignment WHERE TicketId = 1086) = @h + 1
--              AND (SELECT COUNT(*) FROM dbo.tblNotifications WHERE UserId = 83 AND Type = 'ticket_assigned' AND EntityId = 1086) = @n + 1
--         THEN 'PASS 1' ELSE 'FAIL 1' END;
-- ROLLBACK;
--
-- 2. The same agent to a Sales Executive -> 403, nothing changed (F5).
-- BEGIN TRAN;
-- DECLARE @r TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(400), FromUserId INT, ToUserId INT, ToName NVARCHAR(200));
-- INSERT INTO @r EXEC dbo.sp_TransferTicket @CompId = 1, @TicketId = 1087, @ToUserId = 78, @ToBranchId = NULL,
--      @ReasonId = 37, @Remarks = N'verify 133', @UserId = 82, @SendBack = 0;
-- SELECT CASE WHEN EXISTS (SELECT 1 FROM @r WHERE ResponseCode = 403 AND ResponseMess = 'You cannot assign records to that person')
--              AND EXISTS (SELECT 1 FROM dbo.tblTicket WHERE Id = 1087 AND AssignedTo = 82)
--         THEN 'PASS 2' ELSE 'FAIL 2' END;
-- ROLLBACK;
--
-- 3. A -> B -> C, C sends back -> holder B; B's Send back still names A
--    (vikram gave 1089 to pooja; pooja reassigns to sandeep; sandeep sends back).
-- BEGIN TRAN;
-- EXEC dbo.sp_TransferTicket @CompId = 1, @TicketId = 1089, @ToUserId = 83, @ToBranchId = NULL,
--      @ReasonId = 37, @Remarks = N'verify 133', @UserId = 82, @SendBack = 0;
-- EXEC dbo.sp_TransferTicket @CompId = 1, @TicketId = 1089, @ToUserId = NULL, @ToBranchId = NULL,
--      @ReasonId = NULL, @Remarks = N'not mine', @UserId = 83, @SendBack = 1;
-- SELECT CASE WHEN EXISTS (SELECT 1 FROM dbo.tblTicket WHERE Id = 1089 AND AssignedTo = 82)
--              AND EXISTS (SELECT 1 FROM dbo.fn_RecordActions(1, 82, 'complaints', 1089) WHERE SendBackToId = 75)
--              AND EXISTS (SELECT 1 FROM dbo.tblNotifications WHERE UserId = 82 AND Type = 'ticket_sent_back'
--                          AND EntityId = 1089 AND Body = N'not mine')
--         THEN 'PASS 3' ELSE 'FAIL 3' END;
-- ROLLBACK;
--
-- 4. Giver deactivated -> send back answers 400 naming them; record unchanged.
-- BEGIN TRAN;
-- UPDATE dbo.tblUser SET IsActive = 0 WHERE Id = 75;
-- DECLARE @r TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(400), FromUserId INT, ToUserId INT, ToName NVARCHAR(200));
-- INSERT INTO @r EXEC dbo.sp_TransferTicket @CompId = 1, @TicketId = 1089, @ToUserId = NULL, @ToBranchId = NULL,
--      @ReasonId = NULL, @Remarks = N'verify 133', @UserId = 82, @SendBack = 1;
-- SELECT CASE WHEN EXISTS (SELECT 1 FROM @r WHERE ResponseCode = 400
--                          AND ResponseMess = (SELECT FullName FROM dbo.tblUser WHERE Id = 75) + N' can no longer take this. Reassign it instead.')
--              AND EXISTS (SELECT 1 FROM dbo.tblTicket WHERE Id = 1089 AND AssignedTo = 82)
--         THEN 'PASS 4' ELSE 'FAIL 4' END;
-- DELETE FROM @r;   -- and nobody to send back to on a complaint she logged herself:
-- INSERT INTO @r EXEC dbo.sp_TransferTicket @CompId = 1, @TicketId = 1087, @ToUserId = NULL, @ToBranchId = NULL,
--      @ReasonId = NULL, @Remarks = N'verify 133', @UserId = 82, @SendBack = 1;
-- SELECT CASE WHEN EXISTS (SELECT 1 FROM @r WHERE ResponseCode = 400 AND ResponseMess = 'There is nobody to send this back to.')
--         THEN 'PASS 4b' ELSE 'FAIL 4b' END;
-- ROLLBACK;
--
-- 5. Own reach on a resolved complaint / a lost lead -> 403 (F26).
-- BEGIN TRAN;
-- DECLARE @r TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(400), FromUserId INT, ToUserId INT, ToName NVARCHAR(200));
-- INSERT INTO @r EXEC dbo.sp_TransferTicket @CompId = 1, @TicketId = 1096, @ToUserId = 83, @ToBranchId = NULL,
--      @ReasonId = 37, @Remarks = N'verify 133', @UserId = 82, @SendBack = 0;
-- DECLARE @lost INT = (SELECT TOP 1 l.Id FROM dbo.tblLeads l JOIN dbo.tblLookup s ON s.Id = l.StatusId
--                      WHERE l.CompId = 1 AND l.OwnerId = 17 AND s.Code = 'lost' ORDER BY l.Id);
-- INSERT INTO @r EXEC dbo.sp_TransferLead @CompId = 1, @LeadId = @lost, @ToUserId = 18, @ToBranchId = NULL,
--      @ReasonId = 37, @Remarks = N'verify 133', @UserId = 17, @SendBack = 0;
-- SELECT CASE WHEN (SELECT COUNT(*) FROM @r WHERE ResponseCode = 403
--                   AND ResponseMess = 'Only a manager can reassign a closed record') = 2
--              AND EXISTS (SELECT 1 FROM dbo.tblTicket WHERE Id = 1096 AND AssignedTo = 82)
--              AND EXISTS (SELECT 1 FROM dbo.tblLeads WHERE Id = @lost AND OwnerId = 17)
--         THEN 'PASS 5' ELSE 'FAIL 5' END;
-- ROLLBACK;
--
-- 6. Bulk with one invisible id among five -> Moved 0, Refused 1, the gate-1
--    sentence with the count, nothing changed (Ruling 6, S7).
-- BEGIN TRAN;
-- UPDATE dbo.tblTicket SET AssignedTo = 82 WHERE Id = 1094;          -- a fourth open complaint of hers
-- DECLARE @b TABLE (Transferred INT, Skipped INT, Moved INT, Refused INT, ResponseCode INT, ResponseMess NVARCHAR(400));
-- INSERT INTO @b EXEC dbo.sp_BulkTransferTickets @CompId = 1, @TicketIdsJson = N'[1086,1087,1089,1094,1090]',
--      @ToUserId = 83, @ToBranchId = NULL, @ReasonId = 37, @Remarks = N'verify 133', @UserId = 82;
-- SELECT CASE WHEN EXISTS (SELECT 1 FROM @b WHERE Moved = 0 AND Refused = 1 AND ResponseCode = 404
--                          AND ResponseMess = N'Record not found (1 of 5 refused)')
--              AND (SELECT COUNT(*) FROM dbo.tblTicket WHERE Id IN (1086,1087,1089,1094) AND AssignedTo = 82) = 4
--         THEN 'PASS 6' ELSE 'FAIL 6' END;
-- ROLLBACK;
--
-- 7. Lead with three open follow-ups (previous owner's, nobody's, a third
--    person's) reassigned by the Sales Head to someone based in office 2 -> the
--    first two take the new person, the third keeps hers (D26), all three take
--    office 2 with the lead (D4.1).
-- BEGIN TRAN;
-- DECLARE @lead INT = (SELECT TOP 1 l.Id FROM dbo.tblLeads l JOIN dbo.tblLookup s ON s.Id = l.StatusId
--                      WHERE l.CompId = 1 AND l.OwnerId = 17 AND l.BranchId = 1 AND s.Code = 'open' ORDER BY l.Id);
-- UPDATE dbo.tblFollowUp SET Status = 'cancelled', Remarks = N'verify 133' WHERE LeadId = @lead AND Status = 'open';
-- INSERT INTO dbo.tblFollowUp (CompId, BranchId, LeadId, Type, DueAt, AssignedTo, Status, CreatedBy)
-- VALUES (1, 1, @lead, 'call', GETDATE(), 17, 'open', 17), (1, 1, @lead, 'call', GETDATE(), NULL, 'open', 17),
--        (1, 1, @lead, 'call', GETDATE(), 18, 'open', 17);
-- EXEC dbo.sp_TransferLead @CompId = 1, @LeadId = @lead, @ToUserId = 21, @ToBranchId = NULL,
--      @ReasonId = 37, @Remarks = N'verify 133', @UserId = 13, @SendBack = 0;
-- SELECT CASE WHEN (SELECT COUNT(*) FROM dbo.tblFollowUp WHERE LeadId = @lead AND Status = 'open' AND AssignedTo = 21) = 2
--              AND (SELECT COUNT(*) FROM dbo.tblFollowUp WHERE LeadId = @lead AND Status = 'open' AND AssignedTo = 18) = 1
--              AND NOT EXISTS (SELECT 1 FROM dbo.tblFollowUp f JOIN dbo.tblLeads l ON l.Id = f.LeadId
--                              WHERE f.LeadId = @lead AND f.Status = 'open' AND f.BranchId <> l.BranchId)   -- all take its office (D4.1)
--              AND EXISTS (SELECT 1 FROM dbo.tblLeads WHERE Id = @lead AND OwnerId = 21 AND BranchId = 2)
--              AND EXISTS (SELECT 1 FROM dbo.tblNotifications WHERE UserId = 21 AND Type = 'lead_assigned' AND EntityId = @lead)
--              AND EXISTS (SELECT 1 FROM dbo.tblNotifications WHERE UserId = 17 AND Type = 'lead_moved_away' AND EntityId = @lead)
--         THEN 'PASS 7' ELSE 'FAIL 7' END;
-- ROLLBACK;
--
-- 8. Reopen: by a team lead of the assignee -> 200; by the assignee -> 403;
--    of a complaint whose assignee is inactive -> unassigned + one
--    ticket_reopen_unassigned per Office-or-wider manager (TestCRM has no
--    Team-reach complaints user, so one is made inside the transaction).
-- BEGIN TRAN;
-- DECLARE @g TABLE (Id INT);
-- INSERT INTO dbo.tblUserGroups (Name, Description, IsActive, CompId, BranchId, HierarchyLevel, DataScope, IsAdmin, CanSeeSensitive)
-- OUTPUT inserted.Id INTO @g VALUES ('zz verify 133', NULL, 1, 1, 6, 9, 'Own', 0, 0);
-- INSERT INTO dbo.tblGroupModule (GroupId, Module, CanView, CanAdd, CanEdit, CanDelete, Reach, AssignReach)
-- SELECT Id, 'complaints', 1, 1, 1, 0, 'Team', 'Team' FROM @g;
-- INSERT INTO dbo.tblUserGroupMap (UserId, GroupId) SELECT 83, Id FROM @g;   -- sandeep becomes a Team-reach lead
-- UPDATE dbo.tblUser SET ReportsTo = 83 WHERE Id = 82;                       -- of pooja
-- DECLARE @open INT = (SELECT TOP 1 Id FROM dbo.tblLookup WHERE CompId = 1 AND Kind = 'ticket_status' AND Code = 'open' ORDER BY SortOrder, Id);
-- DECLARE @s TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(400));
-- INSERT INTO @s EXEC dbo.sp_ReopenTicket @CompId = 1, @TicketId = 1096, @Remarks = N'verify 133', @UserId = 82, @DueAtOverride = NULL;
-- DECLARE @own BIT = CASE WHEN EXISTS (SELECT 1 FROM @s WHERE ResponseCode = 403) THEN 1 ELSE 0 END;
-- EXEC dbo.sp_ReopenTicket @CompId = 1, @TicketId = 1096, @Remarks = N'verify 133', @UserId = 83, @DueAtOverride = NULL;
-- DECLARE @lead8 BIT = CASE WHEN EXISTS (SELECT 1 FROM dbo.tblTicket WHERE Id = 1096 AND StatusId = @open AND AssignedTo = 82) THEN 1 ELSE 0 END;
-- UPDATE dbo.tblUser SET IsActive = 0 WHERE Id = 84;                         -- ananya leaves
-- DECLARE @n8 INT = (SELECT COUNT(*) FROM dbo.tblNotifications WHERE Type = 'ticket_reopen_unassigned' AND EntityId = 1093);
-- EXEC dbo.sp_ReopenTicket @CompId = 1, @TicketId = 1093, @Remarks = N'verify 133', @UserId = 75, @DueAtOverride = NULL;
-- SELECT CASE WHEN @own = 1 AND @lead8 = 1
--              AND EXISTS (SELECT 1 FROM dbo.tblTicket WHERE Id = 1093 AND AssignedTo IS NULL AND LoggerHolds = 0
--                          AND EscalatedTo IS NULL AND StatusId = @open)
--              AND (SELECT COUNT(*) FROM dbo.tblNotifications WHERE Type = 'ticket_reopen_unassigned' AND EntityId = 1093) > @n8
--              AND EXISTS (SELECT 1 FROM dbo.tblTicketAssignment WHERE TicketId = 1093 AND FromUserId = 84 AND ToUserId IS NULL
--                          AND Remarks = N'Unassigned')
--         THEN 'PASS 8' ELSE 'FAIL 8' END;
-- ROLLBACK;
--
-- 9. LoggerHolds = 1 with an assignee is refused by the constraints (error 547).
-- BEGIN TRAN;
-- BEGIN TRY UPDATE dbo.tblTicket SET LoggerHolds = 1 WHERE Id = 1087; PRINT 'FAIL 9a'; END TRY
-- BEGIN CATCH PRINT CASE WHEN ERROR_NUMBER() = 547 THEN 'PASS 9a' ELSE 'FAIL 9a' END; END CATCH;
-- BEGIN TRY UPDATE dbo.tblLeads SET LoggerHolds = 1 WHERE Id = (SELECT TOP 1 Id FROM dbo.tblLeads WHERE OwnerId IS NOT NULL); PRINT 'FAIL 9b'; END TRY
-- BEGIN CATCH PRINT CASE WHEN ERROR_NUMBER() = 547 THEN 'PASS 9b' ELSE 'FAIL 9b' END; END CATCH;
-- IF @@TRANCOUNT > 0 ROLLBACK;
--
-- 10. Rule 3: to a person based in another office, no office named -> the
--     complaint moves to their home office; to a person who has its office
--     as a read-only extra -> it stays.
-- BEGIN TRAN;
-- EXEC dbo.sp_TransferTicket @CompId = 1, @TicketId = 1087, @ToUserId = 85, @ToBranchId = NULL,
--      @ReasonId = 37, @Remarks = N'verify 133', @UserId = 75, @SendBack = 0;
-- DECLARE @moved BIT = CASE WHEN EXISTS (SELECT 1 FROM dbo.tblTicket WHERE Id = 1087 AND AssignedTo = 85 AND BranchId = 1) THEN 1 ELSE 0 END;
-- ROLLBACK;
-- BEGIN TRAN;
-- INSERT INTO dbo.tblUserBranchAccess (UserId, BranchId, CanRead, CanWrite, CompId, CreatedBy, CreatedDate)
-- VALUES (85, 6, 1, 0, 1, 1, GETDATE());
-- EXEC dbo.sp_TransferTicket @CompId = 1, @TicketId = 1087, @ToUserId = 85, @ToBranchId = NULL,
--      @ReasonId = 37, @Remarks = N'verify 133', @UserId = 75, @SendBack = 0;
-- SELECT CASE WHEN EXISTS (SELECT 1 FROM dbo.tblTicket WHERE Id = 1087 AND AssignedTo = 85 AND BranchId = 6)
--         THEN 'PASS 10b' ELSE 'FAIL 10b' END;
-- ROLLBACK;
-- SELECT CASE WHEN @moved = 1 THEN 'PASS 10a' ELSE 'FAIL 10a' END;   -- run with the first transaction
--
-- 11. Escalation targets: an invisible complaint -> no rows; only ForUserId of
--     a person none of whose complaints the caller sees -> no rows; positive
--     control: her own complaint -> vikram.rao (75) listed.
-- DECLARE @e TABLE (Id INT, FullName NVARCHAR(200), JobTitle NVARCHAR(100), BranchId BIGINT, BranchName NVARCHAR(100),
--                   Depth INT, ResponseCode INT, ResponseMess NVARCHAR(200));
-- INSERT INTO @e EXEC dbo.sp_FetchTicketEscalationTargets @CompId = 1, @UserId = 82, @TicketId = 1090, @ForUserId = NULL;
-- INSERT INTO @e EXEC dbo.sp_FetchTicketEscalationTargets @CompId = 1, @UserId = 82, @TicketId = NULL, @ForUserId = 84;
-- DECLARE @none INT = (SELECT COUNT(*) FROM @e);
-- INSERT INTO @e EXEC dbo.sp_FetchTicketEscalationTargets @CompId = 1, @UserId = 82, @TicketId = 1087, @ForUserId = NULL;
-- SELECT CASE WHEN @none = 0 AND EXISTS (SELECT 1 FROM @e WHERE Id = 75) THEN 'PASS 11' ELSE 'FAIL 11' END;
--
-- 12. B1 and the objects: nothing still mentions AllowReopen -> 0 rows; the
--     two constraints exist -> 2; the new procedure has no defaulted person
--     parameter (N1a) -> PASS 12c.
-- SELECT o.name FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
-- WHERE m.definition LIKE '%AllowReopen%';
-- SELECT COUNT(*) FROM sys.check_constraints WHERE name IN ('CK_tblTicket_LoggerHolds', 'CK_tblLeads_LoggerHolds');
-- BEGIN TRY EXEC dbo.sp_FetchTicketEscalationTargets @CompId = 1, @TicketId = 1087, @ForUserId = NULL; PRINT 'FAIL 12c'; END TRY
-- BEGIN CATCH PRINT CASE WHEN ERROR_NUMBER() = 201 THEN 'PASS 12c' ELSE 'FAIL 12c' END; END CATCH;
--
-- 13. Create path: logged unassigned -> LoggerHolds 1; logged onto someone
--     outside the creator's list -> 403; onto someone based elsewhere -> their
--     home office.
-- BEGIN TRAN;
-- DECLARE @c INT = (SELECT TOP 1 Id FROM dbo.tblCustomer WHERE CompId = 1 AND IsActive = 1 ORDER BY Id);
-- DECLARE @t TABLE (Id INT, TicketNo VARCHAR(30), ResponseCode INT, ResponseMess NVARCHAR(400));
-- INSERT INTO @t EXEC dbo.sp_SaveTicket @Id = 0, @CompId = 1, @BranchId = 6, @UserId = 82, @CustomerId = @c,
--      @Subject = N'verify 133', @AssignedTo = 78;
-- DECLARE @refused BIT = CASE WHEN EXISTS (SELECT 1 FROM @t WHERE ResponseCode = 403) THEN 1 ELSE 0 END;
-- EXEC dbo.sp_SaveTicket @Id = 0, @CompId = 1, @BranchId = 6, @UserId = 82, @CustomerId = @c, @Subject = N'verify 133 a';
-- EXEC dbo.sp_SaveTicket @Id = 0, @CompId = 1, @BranchId = 6, @UserId = 75, @CustomerId = @c, @Subject = N'verify 133 b', @AssignedTo = 85;
-- SELECT CASE WHEN @refused = 1
--              AND EXISTS (SELECT 1 FROM dbo.tblTicket WHERE Subject = N'verify 133 a' AND AssignedTo IS NULL AND LoggerHolds = 1)
--              AND EXISTS (SELECT 1 FROM dbo.tblTicket WHERE Subject = N'verify 133 b' AND AssignedTo = 85 AND BranchId = 1 AND LoggerHolds = 0)
--         THEN 'PASS 13' ELSE 'FAIL 13' END;
-- ROLLBACK;
--
-- 14. Review fixes: an inactive office, or an office no one of the company
--     works in, cannot be named even by a Company-reach manager (gate 7, 400);
--     a create in such an office is refused (400 Invalid branch); sp_SaveUser
--     without an actor -> 400, and leaving the parameter out -> error 201.
-- BEGIN TRAN;
-- UPDATE dbo.tblBranch SET IsActive = 0 WHERE Id = 7;
-- DECLARE @r TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(400), FromUserId INT, ToUserId INT, ToName NVARCHAR(200));
-- -- vikram.rao (75) is Company / Can assign to Company, and sunita.iyer (77, office 7) works
-- -- complaints, so gate 6 passes and the 400 comes from gate 7 (office 7 closed).
-- INSERT INTO @r EXEC dbo.sp_TransferTicket @CompId = 1, @TicketId = 1087, @ToUserId = 77, @ToBranchId = 7,
--      @ReasonId = 37, @Remarks = N'verify 133', @UserId = 75, @SendBack = 0;
-- INSERT INTO @r EXEC dbo.sp_TransferTicket @CompId = 1, @TicketId = 1087, @ToUserId = NULL, @ToBranchId = 2147483647,
--      @ReasonId = 37, @Remarks = N'verify 133', @UserId = 75, @SendBack = 0;
-- DECLARE @t TABLE (Id INT, TicketNo VARCHAR(30), ResponseCode INT, ResponseMess NVARCHAR(400));
-- DECLARE @c14 INT = (SELECT TOP 1 Id FROM dbo.tblCustomer WHERE CompId = 1 AND IsActive = 1 ORDER BY Id);
-- INSERT INTO @t EXEC dbo.sp_SaveTicket @Id = 0, @CompId = 1, @BranchId = 7, @UserId = 75,
--      @CustomerId = @c14, @Subject = N'verify 133';
-- SELECT CASE WHEN (SELECT COUNT(*) FROM @r WHERE ResponseCode = 400
--                   AND ResponseMess = 'Assign it to someone in that office, or unassign it first') = 2
--              AND EXISTS (SELECT 1 FROM @t WHERE ResponseCode = 400 AND ResponseMess = 'Invalid branch')
--              AND EXISTS (SELECT 1 FROM dbo.tblTicket WHERE Id = 1087 AND AssignedTo = 82 AND BranchId = 6)
--         THEN 'PASS 14a' ELSE 'FAIL 14a' END;
-- ROLLBACK;
-- DECLARE @u TABLE (ResponseCode INT, ResponseMess VARCHAR(400));
-- INSERT INTO @u EXEC dbo.sp_SaveUser @Id = 82, @Username = 'pooja.joshi', @Password = NULL, @UserActive = 1, @UserIp = '',
--      @AllowDay = 0, @FullName = 'Pooja Joshi', @Email = NULL, @JobTitle = NULL, @HourlyRate = NULL, @GroupId = 0,
--      @CompId = 1, @ActorUserId = NULL;
-- SELECT CASE WHEN EXISTS (SELECT 1 FROM @u WHERE ResponseCode = 400 AND ResponseMess = 'ActorUserId is required')
--         THEN 'PASS 14b' ELSE 'FAIL 14b' END;
-- BEGIN TRY EXEC dbo.sp_SaveUser @Id = 82, @Username = 'x', @Password = NULL, @UserActive = 1, @UserIp = '', @AllowDay = 0,
--      @FullName = 'x', @Email = NULL, @JobTitle = NULL, @HourlyRate = NULL, @GroupId = 0, @CompId = 1; PRINT 'FAIL 14c'; END TRY
-- BEGIN CATCH PRINT CASE WHEN ERROR_NUMBER() = 201 THEN 'PASS 14c' ELSE 'FAIL 14c' END; END CATCH;
--
-- Dry-run facts (TestCRM, read-only, 2026-11-22; 130-132 not yet applied there):
--   raw giver (fn_RecordGiver's SELECT): complaint 1089 -> 75 (vikram.rao);
--   1092 -> 75; 1086 -> 82 = the holder -> "There is nobody to send this back to.";
--   lead 6 -> 16 (tl_ho_neha); lead 5 -> none (no history row to its owner).
--   gate 6 predicate for pooja.joshi (complaints, Can assign to Office after 130):
--   allowed 75, 76, 82, 83; refused 78 and 79 (no complaints), 84 and 85 (other offices).
-- ===========================================================================
