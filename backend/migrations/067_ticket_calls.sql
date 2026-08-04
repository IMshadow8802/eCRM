-- 067_ticket_calls.sql
--
-- Fix: a call logged against a TICKET disappears.
--
-- tblCall has had a TicketId column since the Support module shipped, and
-- sp_LogCall accepts and stores it. But nothing ever reads it back:
--
--   * sp_LogCall logs timeline activity only when @LeadId is set. Its own
--     comment says "tickets have their own logger" — sp_LogTicketActivity
--     exists and is used by every other ticket SP, but this one never calls it.
--   * sp_FetchCalls has no @TicketId parameter at all. Its WHERE clause can
--     filter by lead, or fall back to the caller's own calls, and that is it.
--
-- So the row is written and is unreachable: it appears in no ticket timeline
-- and no call list. A "log a call" button on a complaint would be write-only,
-- which is why the mobile Support module shipped without one.
--
-- Also fixed here: sp_LogCall guards the tenant on @LeadId but not on
-- @TicketId ("that path is untouched", per its comment). A caller could post
-- another company's TicketId and have the row accepted. Same guard, both sides.
--
-- No schema change — tblCall.TicketId already exists.

-- ---------------------------------------------------------------------------
-- 1. sp_LogCall — tenant-guard the ticket, and log to the ticket timeline
-- ---------------------------------------------------------------------------
ALTER PROC dbo.sp_LogCall
    @CompId           INT,
    @LeadId           INT           = NULL,
    @TicketId         INT           = NULL,
    @UserId           INT,
    @Direction        VARCHAR(5),
    @OutcomeId        INT           = NULL,
    @Notes            NVARCHAR(1000)= NULL,
    @Duration         INT           = NULL,
    @NextFollowupDate DATETIME      = NULL,
    @FollowupRemarks  NVARCHAR(1000)= NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN
        SELECT 0 AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess;
        RETURN;
    END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN
        SELECT 0 AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess;
        RETURN;
    END
    IF (@LeadId IS NULL OR @LeadId <= 0) AND (@TicketId IS NULL OR @TicketId <= 0)
    BEGIN
        SELECT 0 AS Id, 400 AS ResponseCode, 'A LeadId or TicketId is required' AS ResponseMess;
        RETURN;
    END
    IF @Direction IS NULL OR @Direction NOT IN ('in','out')
    BEGIN
        SELECT 0 AS Id, 400 AS ResponseCode, 'Direction must be in or out' AS ResponseMess;
        RETURN;
    END

    -- Tenant guard: a supplied lead or ticket must belong to this company.
    IF @LeadId IS NOT NULL AND @LeadId > 0
       AND NOT EXISTS (SELECT 1 FROM dbo.tblLeads WHERE Id=@LeadId AND CompId=@CompId)
    BEGIN
        SELECT 0 AS Id, 404 AS ResponseCode, 'Lead not found' AS ResponseMess;
        RETURN;
    END
    IF @TicketId IS NOT NULL AND @TicketId > 0
       AND NOT EXISTS (SELECT 1 FROM dbo.tblTicket WHERE Id=@TicketId AND CompId=@CompId)
    BEGIN
        SELECT 0 AS Id, 404 AS ResponseCode, 'Ticket not found' AS ResponseMess;
        RETURN;
    END

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));
        DECLARE @CallId INT;

        INSERT INTO dbo.tblCall
            (CompId, LeadId, TicketId, UserId, Direction, OutcomeId, Notes, Duration, CalledAt, CreatedBy)
        VALUES
            (@CompId, @LeadId, @TicketId, @UserId, @Direction, @OutcomeId, @Notes, @Duration, GETDATE(), @UserId);

        SET @CallId = CAST(SCOPE_IDENTITY() AS INT);

        -- Follow-ups hang off tblFollowUp.LeadId, so they stay lead-only.
        -- A ticket's next step is its stage, not a diary entry.
        IF @NextFollowupDate IS NOT NULL AND @LeadId IS NOT NULL AND @LeadId > 0
        BEGIN
            DECLARE @BranchId INT = (SELECT BranchId FROM dbo.tblLeads WHERE Id=@LeadId AND CompId=@CompId);

            INSERT INTO dbo.tblFollowUp
                (LeadId, NextFollowupDate, FollowupType, Remarks, Status,
                 CreatedBy, EditBy, CompId, BranchId, SourceCallId)
            VALUES
                (@LeadId, @NextFollowupDate, 'call', ISNULL(@FollowupRemarks,''), 'Pending',
                 @UserId, @UserId, @CompId, ISNULL(@BranchId,1), @CallId);
        END

        -- Timeline: each entity gets its own logger, and now BOTH are called.
        -- Previously only the lead branch existed, which is what made a
        -- ticket call invisible.
        IF @LeadId IS NOT NULL AND @LeadId > 0
        BEGIN
            INSERT INTO @actLog
            EXEC dbo.sp_LogLeadActivity
                @CompId  = @CompId,
                @LeadId  = @LeadId,
                @UserId  = @UserId,
                @Type    = 'call',
                @Summary = 'Call logged',
                @MetaJSON = NULL;
        END

        IF @TicketId IS NOT NULL AND @TicketId > 0
        BEGIN
            DECLARE @TicketSummary NVARCHAR(500) =
                CASE WHEN @Direction = 'in' THEN 'Inbound call logged'
                     ELSE 'Outbound call logged' END;

            INSERT INTO @actLog
            EXEC dbo.sp_LogTicketActivity
                @CompId   = @CompId,
                @TicketId = @TicketId,
                @UserId   = @UserId,
                @Type     = 'call',
                @Summary  = @TicketSummary,
                @MetaJSON = NULL;
        END

        COMMIT TRANSACTION;

        SELECT @CallId AS Id, 200 AS ResponseCode, 'Call logged successfully' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT 0 AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

-- ---------------------------------------------------------------------------
-- 2. sp_FetchCalls — filter by ticket as well as by lead
-- ---------------------------------------------------------------------------
-- The filter is an explicit ladder rather than the old OR-chain: lead, else
-- ticket, else the caller's own calls. Written as three arms so that passing
-- both ids narrows to the lead instead of silently returning the union.
ALTER PROC dbo.sp_FetchCalls
    @CompId   INT,
    @LeadId   INT = NULL,
    @TicketId INT = NULL,
    @UserId   INT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT c.Id, c.CompId, c.LeadId, c.TicketId, c.UserId, c.Direction, c.OutcomeId,
           c.Notes, c.Duration, c.CalledAt, c.CreatedBy, c.CreatedAt,
           200 AS ResponseCode, 'Calls retrieved successfully' AS ResponseMess
    FROM dbo.tblCall c
    WHERE c.CompId = @CompId
      AND ( (@LeadId IS NOT NULL AND c.LeadId = @LeadId)
         OR (@LeadId IS NULL AND @TicketId IS NOT NULL AND c.TicketId = @TicketId)
         OR (@LeadId IS NULL AND @TicketId IS NULL AND @UserId IS NOT NULL AND c.UserId = @UserId) )
    ORDER BY c.CalledAt DESC, c.Id DESC;
END
GO

-- ============================ verify after apply ============================
-- 1. Both procedures took the change:
--
--    SELECT o.name,
--           CASE WHEN m.definition LIKE '%sp_LogTicketActivity%' THEN 'ok' ELSE 'MISSING' END AS TicketTimeline
--      FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
--     WHERE o.name = 'sp_LogCall';
--
--    SELECT name FROM sys.parameters
--     WHERE object_id = OBJECT_ID('sp_FetchCalls') AND name = '@TicketId';
--    -- expect one row
--
-- 2. Round-trip a ticket call. Pick any ticket id in your company, then:
--
--    EXEC sp_LogCall @CompId=<c>, @TicketId=<t>, @UserId=<u>,
--         @Direction='out', @Notes='verify 067';
--
--    SELECT TOP 5 Type, Summary, CreatedAt
--      FROM tblTicketActivity WHERE TicketId=<t> ORDER BY Id DESC;
--    -- expect a 'call' row reading "Outbound call logged"
--
--    EXEC sp_FetchCalls @CompId=<c>, @TicketId=<t>;
--    -- expect the call row; before this script it returned nothing
--
-- 3. Tenant guard holds — a ticket from another company is rejected:
--
--    EXEC sp_LogCall @CompId=<c>, @TicketId=<ticket id from another CompId>,
--         @UserId=<u>, @Direction='out';
--    -- expect ResponseCode 404, 'Ticket not found'
--
-- 4. Leads are untouched: log a call on a lead with @NextFollowupDate and
--    confirm both the tblFollowUp row and the tblLeadActivity row still appear.
