-- ===========================================================================
-- 085_fix_ticket_detail.sql
--
-- URGENT. Fixes a LIVE production outage on the whole ticket surface.
--
-- SYMPTOM (measured on production 2026-09-13)
--   POST /api/tickets/fetchTicketDetail on a REAL ticket (Id 57) returns
--   500 "Failed to fetch ticket detail". Every ticket, every caller.
--
-- ROOT CAUSE
--   sp_FetchTicketDetail's fourth result set -- the linked-lead summary --
--   selects l.StageId. That column was DROPPED when leads went flat on
--   2026-09-08 (pipelines now serve tickets only; a lead carries StatusId).
--   SQL Server resolves column names at execution, not at CREATE, so the
--   proc was stored happily and has thrown "Invalid column name 'StageId'"
--   on every call ever since.
--
-- BLAST RADIUS -- bigger than one endpoint
--   assertRecordAccess (backend/src/middleware/permission.js) reads a ticket
--   through this same proc to decide visibility. Its catch returns false,
--   so it FAILS CLOSED -- nothing leaked -- but every guarded ticket
--   mutation has been answering 500 since 2026-09-08:
--     moveTicketStage, resolveTicket, closeTicket, reopenTicket, deleteTicket
--   and, as of the 2026-09-13 security fix that finally guards it, saveTicket.
--   Ticket editing worked until today only because save was UNGUARDED -- the
--   very hole that fix closed. So the guard is right and this proc is wrong.
--
-- FIX
--   Drop l.StageId from the linked-lead summary and return l.StatusId, the
--   flat-lead equivalent. Nothing else changes: same four result sets, same
--   column order otherwise, same CompId filters.
--
--   The web reads this result set as `lead` (LinkedLead card on TicketDetail)
--   and uses Id / Name / MobileNo / Email; the stage value is not rendered,
--   so returning StatusId costs no client change.
-- ===========================================================================
SET NOCOUNT ON;
GO

CREATE OR ALTER PROC dbo.sp_FetchTicketDetail
    @CompId INT,
    @TicketId INT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT t.Id, t.CompId, t.BranchId, t.TicketNo, t.CustomerName, t.ContactPerson,
           t.Contact, t.Channel,
           t.CategoryId, t.Priority, t.PipelineId, t.StageId, t.AssignedTo, t.LinkedLeadId,
           t.ResolvedAt, t.ClosedAt, t.ResolutionId, t.Description,
           t.CreatedBy, t.EditBy, t.CreatedAt, t.UpdatedAt,
           200 AS ResponseCode, 'Ticket detail retrieved successfully' AS ResponseMess
    FROM dbo.tblTicket t WHERE t.Id=@TicketId AND t.CompId=@CompId;

    SELECT d.Id AS FieldId, d.FieldKey, d.Label, d.Type, v.ValueText, v.ValueNumber, v.ValueDate
    FROM dbo.tblCustomFieldValue v
    INNER JOIN dbo.tblCustomFieldDef d ON d.Id = v.FieldId
    WHERE v.CompId=@CompId AND v.Entity='ticket' AND v.EntityId=@TicketId
    ORDER BY d.SortOrder;

    SELECT a.Id, a.TicketId, a.UserId, a.Type, a.Summary, a.MetaJSON, a.CreatedAt
    FROM dbo.tblTicketActivity a
    WHERE a.CompId=@CompId AND a.TicketId=@TicketId
    ORDER BY a.CreatedAt DESC, a.Id DESC;

    -- linked-lead summary (null-safe: empty set when no link).
    -- l.StatusId, NOT l.StageId -- leads are flat since 2026-09-08.
    SELECT l.Id, l.Name, l.MobileNo, l.Email, l.StatusId
    FROM dbo.tblLeads l
    INNER JOIN dbo.tblTicket t ON t.LinkedLeadId = l.Id
    WHERE t.Id=@TicketId AND t.CompId=@CompId AND l.CompId=@CompId;
END
GO

-- ===========================================================================
-- VERIFY AFTER APPLY  (read-only)
--   Expect four result sets and NO error. Before the fix this raised
--   "Invalid column name 'StageId'".
-- ===========================================================================
PRINT 'Ticket 57 -- expect 4 result sets, no error:';
EXEC dbo.sp_FetchTicketDetail @CompId = 1, @TicketId = 57;

PRINT 'A ticket that does not exist -- expect 4 EMPTY result sets, no error:';
EXEC dbo.sp_FetchTicketDetail @CompId = 1, @TicketId = 999999999;
GO
