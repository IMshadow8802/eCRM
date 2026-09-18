const database = require("../config/database");
const responseHelper = require("../utils/responseHelper");
const attachmentController = require("./attachmentController");
const {
  scopeParams,
  canSeeRecord,
  assertRecordAccess,
  assertCanAssign,
  canReopen,
} = require("../middleware/permission");
const { positiveInt, pageParams } = require("../utils/controllerKit");
const { parseDay } = require("../utils/reportKit");

// Mutating SPs log their own activity server-side and return exactly one
// status row: Id + ResponseCode + ResponseMess (+ TicketNo from sp_SaveTicket).
// A non-200 code (400 validation, 403 reopen gate, 404 customer) is passed
// through with its message, never flattened into a 500.
async function runSp(res, spName, params, failMessage) {
  try {
    const result = await database.executeStoredProcedure(spName, params);
    const spResponse = result.recordset?.[0] ?? result.recordsets?.[0]?.[0];
    const message = spResponse.ResponseMess || spResponse.ResponseMessage;
    if (spResponse.ResponseCode === 200) return responseHelper.success(res, message, spResponse);
    return responseHelper.error(res, message, "SP_ERROR", spResponse.ResponseCode);
  } catch (err) {
    console.error(`${spName} error:`, err);
    return responseHelper.error(res, failMessage);
  }
}

// Exactly the columns sp_SaveTicket accepts (086). Anything else in the body is
// dropped — the retired CustomerName / Channel / PipelineId / StageId included;
// node-mssql sends every key it is given and SQL Server rejects an undeclared
// parameter outright.
const TICKET_FIELDS = [
  "CustomerId", "Subject", "ContactPerson", "Contact", "ChannelId",
  "CategoryId", "Priority", "ProductId", "AssignedTo", "LinkedLeadId",
  "Description", "CustomJSON",
];
// The INT columns among them: a select's "" or a junk string becomes null
// rather than reaching an INT parameter and failing the whole save.
const TICKET_ID_FIELDS = [
  "CustomerId", "ChannelId", "CategoryId", "Priority", "ProductId", "AssignedTo", "LinkedLeadId",
];
const pick = (body, keys) => Object.fromEntries(keys.map((k) => [k, body[k] ?? null]));
const blank = (s) => !s || !String(s).trim();
const trimmed = (s) => (blank(s) ? null : String(s).trim());
// BIT params want 1/0. Presets are URL-driven on the web, so "false" / "0" are 0.
const bit = (v) => (v === true || v === 1 || v === "1" || v === "true" ? 1 : 0);
// A date filter carries an ISO day. Anything else is dropped rather than handed
// to @FromDate DATE as-is — reportKit's round-trip parse also rejects
// 2026-02-30, which the shape alone would pass.
const isoDay = (s) => (typeof s === "string" && parseDay(s) ? s : null);

// Every write that names a ticket starts the same way: a real TicketId, then
// the record gate. Resolves to the fetched row (assertRecordAccess hands it
// back since spec 2 — the reopen gate needs AssignedTo) or null once the 400 /
// 403 has gone out. Node validates SHAPE here; the lifecycle rules — remarks
// required, resolution required, whether a move is a reopen — are
// sp_SetTicketStatus's (spec 2 §2), and runSp surfaces its 400 / 403 untouched.
async function gateTicket(req, res, TicketId) {
  if (!TicketId) {
    responseHelper.validationError(res, "TicketId is required");
    return null;
  }
  return (await assertRecordAccess(req, res, "ticket", TicketId)) || null;
}

// Shared by transfer and bulkTransfer: the SP requires a reason and remarks,
// and refusing here saves the lookup round-trips. Blank remarks become null.
const transferArgs = (body) => ({
  ToUserId: positiveInt(body.ToUserId),
  ToBranchId: positiveInt(body.ToBranchId),
  ReasonId: positiveInt(body.ReasonId),
  Remarks: trimmed(body.Remarks),
});

const ticketController = {
  async save(req, res) {
    const { CompId, BranchId, UserId } = req.user;
    const Id = positiveInt(req.body.Id) ?? 0;
    const fields = pick(req.body, TICKET_FIELDS);
    for (const k of TICKET_ID_FIELDS) fields[k] = positiveInt(fields[k]);
    fields.Subject = trimmed(fields.Subject);

    if (Id === 0) {
      // The two things a complaint cannot exist without (spec §3). The SP
      // checks too; refusing here names the field and saves the round-trip.
      if (!fields.CustomerId) return responseHelper.validationError(res, "CustomerId is required");
      if (!fields.Subject) return responseHelper.validationError(res, "Subject is required");
      // Assigning on create is an assignment: same roster rule as transfer.
      // Only when a target is named — an unassigned create is legal for
      // everyone, while assertCanAssign 403s a null target below Branch scope.
      if (fields.AssignedTo
          && !(await assertCanAssign(req, res, { toUserId: fields.AssignedTo, toBranchId: null }))) return;
    } else {
      if (!(await assertRecordAccess(req, res, "ticket", Id))) return;
      // Ownership moves through transfer (history + notification), status
      // through setStatus (the reopen gate). The SP ignores AssignedTo on
      // update; not sending it keeps that fact visible here, not in T-SQL.
      fields.AssignedTo = null;
    }
    return runSp(res, "sp_SaveTicket", { Id, CompId, BranchId, UserId, ...fields }, "Failed to save ticket");
  },

  async fetch(req, res) {
    try {
      const { CompId } = req.user;
      const b = req.body;
      // Clamped, not taken raw: PageSize goes straight to the SP, which has no
      // ceiling of its own. Default 25 matches the SP's own default.
      const { PageNumber, PageSize } = pageParams(b, 25);

      const result = await database.executeStoredProcedure("sp_FetchTickets", {
        CompId,
        // An optional UI filter: narrows within scope, never widens it.
        // Visibility comes from scopeParams — passing req.user.BranchId here
        // is what once hid every out-of-branch ticket.
        BranchId: positiveInt(b.BranchId),
        PageNumber,
        PageSize,
        SearchTerm: trimmed(b.SearchTerm),
        StatusId: positiveInt(b.StatusId),
        // 'active' (open + onhold) or one code. A bogus value matches nothing;
        // it is never nulled, since null would WIDEN the list to every status.
        StatusCode: trimmed(b.StatusCode)?.toLowerCase() ?? null,
        Priority: positiveInt(b.Priority),
        CategoryId: positiveInt(b.CategoryId),
        ChannelId: positiveInt(b.ChannelId),
        ProductId: positiveInt(b.ProductId),
        CustomerId: positiveInt(b.CustomerId),
        AssignedTo: positiveInt(b.AssignedTo),
        Overdue: bit(b.Overdue),
        Escalated: bit(b.Escalated),
        Unassigned: bit(b.Unassigned),
        FromDate: isoDay(b.FromDate),
        ToDate: isoDay(b.ToDate),
        ...scopeParams(req),
      });

      const tickets = result.recordsets?.[0] ?? [];
      const pagination = result.recordsets?.[1]?.[0] ?? {};
      return responseHelper.success(res, "Tickets fetched successfully", {
        tickets,
        pagination: {
          currentPage: pagination.CurrentPage ?? PageNumber,
          pageSize: pagination.PageSize ?? PageSize,
          totalRecords: pagination.TotalRecords ?? tickets.length,
          totalPages: pagination.TotalPages ?? 1,
        },
      });
    } catch (err) {
      console.error("sp_FetchTickets error:", err);
      return responseHelper.error(res, "Failed to fetch tickets");
    }
  },

  async detail(req, res) {
    const { CompId } = req.user;
    const TicketId = positiveInt(req.body.TicketId);
    if (!TicketId) return responseHelper.validationError(res, "TicketId is required");
    try {
      const result = await database.executeStoredProcedure("sp_FetchTicketDetail", {
        CompId,
        TicketId,
      });
      const rs = result.recordsets ?? [];
      const ticket = rs[0]?.[0] || null;
      // The detail SP is CompId-scoped only, so gate the row here. 404 rather
      // than 403: a user who cannot see a ticket should not learn it exists.
      if (!canSeeRecord(req, ticket, "AssignedTo")) {
        return responseHelper.error(res, "Ticket not found", "NOT_FOUND", 404);
      }
      // 086: RS1 core + customer columns, RS2 custom values, RS3 timeline,
      // RS4 assignment history, RS5 linked lead (empty when none).
      return responseHelper.success(res, "Ticket detail fetched successfully", {
        ticket,
        fields: rs[1] || [],
        activity: rs[2] || [],
        assignments: rs[3] || [],
        linkedLead: rs[4]?.[0] || null,
      });
    } catch (err) {
      console.error("sp_FetchTicketDetail error:", err);
      return responseHelper.error(res, "Failed to fetch ticket detail");
    }
  },

  // Spec 2 §2: the one lifecycle engine. Node answers the reopen gate on EVERY
  // call (plan ambiguity 2) and sp_SetTicketStatus alone decides whether the
  // requested move is a reopen — a Self agent moving New → In Progress passes
  // AllowReopen 0 and the SP never consults it.
  async setStatus(req, res) {
    const { CompId, UserId } = req.user;
    const TicketId = positiveInt(req.body.TicketId);
    const StatusId = positiveInt(req.body.StatusId);
    // Both shape checks before the round-trip; gateTicket answers for TicketId.
    if (TicketId && !StatusId) return responseHelper.validationError(res, "StatusId is required");
    const ticket = await gateTicket(req, res, TicketId);
    if (!ticket) return;
    return runSp(
      res,
      "sp_SetTicketStatus",
      {
        CompId,
        TicketId,
        StatusId,
        UserId,
        ResolutionId: positiveInt(req.body.ResolutionId),
        Remarks: trimmed(req.body.Remarks),
        AllowReopen: canReopen(req, ticket) ? 1 : 0,
      },
      "Failed to update ticket status",
    );
  },

  // Shortcuts (spec §2): "first status of that code by SortOrder", delegating
  // to sp_SetTicketStatus inside SQL. Only reopen declares @AllowReopen —
  // node-mssql rejects a parameter the procedure does not declare, so it is
  // sent only where it exists.
  async resolve(req, res) {
    const { CompId, UserId } = req.user;
    const TicketId = positiveInt(req.body.TicketId);
    if (!(await gateTicket(req, res, TicketId))) return;
    return runSp(
      res,
      "sp_ResolveTicket",
      { CompId, TicketId, ResolutionId: positiveInt(req.body.ResolutionId), Remarks: trimmed(req.body.Remarks), UserId },
      "Failed to resolve ticket",
    );
  },

  async close(req, res) {
    const { CompId, UserId } = req.user;
    const TicketId = positiveInt(req.body.TicketId);
    if (!(await gateTicket(req, res, TicketId))) return;
    return runSp(
      res,
      "sp_CloseTicket",
      { CompId, TicketId, UserId, ResolutionId: positiveInt(req.body.ResolutionId), Remarks: trimmed(req.body.Remarks) },
      "Failed to close ticket",
    );
  },

  async reject(req, res) {
    const { CompId, UserId } = req.user;
    const TicketId = positiveInt(req.body.TicketId);
    if (!(await gateTicket(req, res, TicketId))) return;
    return runSp(
      res,
      "sp_RejectTicket",
      { CompId, TicketId, Remarks: trimmed(req.body.Remarks), UserId },
      "Failed to reject ticket",
    );
  },

  async reopen(req, res) {
    const { CompId, UserId } = req.user;
    const TicketId = positiveInt(req.body.TicketId);
    const ticket = await gateTicket(req, res, TicketId);
    if (!ticket) return;
    return runSp(
      res,
      "sp_ReopenTicket",
      { CompId, TicketId, Remarks: trimmed(req.body.Remarks), UserId, AllowReopen: canReopen(req, ticket) ? 1 : 0 },
      "Failed to reopen ticket",
    );
  },

  // Spec 2 §2 Transfer — the lead playbook: validation that needs no DB first,
  // then the record gate, then the target gate, then the SP. Ownership only
  // ever moves through here (history row + notification live in the SP).
  async transfer(req, res) {
    const { CompId, UserId } = req.user;
    const TicketId = positiveInt(req.body.TicketId);
    const args = transferArgs(req.body);
    if (!args.Remarks || !args.ReasonId) {
      return responseHelper.validationError(res, "A reason and remarks are required for a transfer");
    }
    if (!(await gateTicket(req, res, TicketId))) return;
    if (!(await assertCanAssign(req, res, { toUserId: args.ToUserId, toBranchId: args.ToBranchId }))) return;
    return runSp(res, "sp_TransferTicket", { CompId, TicketId, ...args, UserId }, "Failed to transfer ticket");
  },

  async bulkTransfer(req, res) {
    const { CompId, UserId } = req.user;
    const ids = Array.isArray(req.body.TicketIds)
      ? [...new Set(req.body.TicketIds.map(positiveInt).filter(Boolean))]
      : [];
    const args = transferArgs(req.body);
    if (ids.length === 0 || ids.length > 200) {
      return responseHelper.validationError(res, "Pick between 1 and 200 tickets");
    }
    if (!args.Remarks || !args.ReasonId) {
      return responseHelper.validationError(res, "A reason and remarks are required for a transfer");
    }
    // Every ticket must be visible to the caller; the SP is tenant-scoped only,
    // and one invisible id fails the whole call before anything is written.
    // ponytail: N sequential sp_FetchTicketDetail reads (5 recordsets each), ≤200 ids;
    // upgrade path = one sp_FetchTicketsVisibility(@TicketIdsJson) returning
    // Id/BranchId/AssignedTo/CreatedBy + canSeeRecord per row.
    for (const id of ids) {
      if (!(await assertRecordAccess(req, res, "ticket", id))) return;
    }
    if (!(await assertCanAssign(req, res, { toUserId: args.ToUserId, toBranchId: args.ToBranchId }))) return;
    return runSp(
      res,
      "sp_BulkTransferTickets",
      { CompId, TicketIdsJson: JSON.stringify(ids), ...args, UserId },
      "Failed to transfer tickets",
    );
  },

  // Spec 2 §2 Escalation: flag a senior; the ticket stays with the agent. The
  // caller must see the ticket; the SP validates the rest — target is an
  // ancestor of the assignee (ReportsTo, ≤ 20 hops), ticket non-terminal,
  // remarks given — and notifies the senior. No roster check: the target is
  // by definition above the caller's subtree, so assertCanAssign would refuse.
  async escalate(req, res) {
    const { CompId, UserId } = req.user;
    const TicketId = positiveInt(req.body.TicketId);
    const ToUserId = positiveInt(req.body.ToUserId);
    // Shape checks before the round-trip; gateTicket answers for TicketId.
    if (TicketId && !ToUserId) return responseHelper.validationError(res, "ToUserId is required");
    if (!(await gateTicket(req, res, TicketId))) return;
    return runSp(
      res,
      "sp_EscalateTicket",
      { CompId, TicketId, ToUserId, Remarks: trimmed(req.body.Remarks), UserId },
      "Failed to escalate ticket",
    );
  },

  // The ancestor chain the Escalate picker offers, nearest first. ForUserId
  // lets the client ask for the ASSIGNEE's chain — the SP's rule is "a senior
  // of the assignee" — and defaults to the caller's own.
  async escalationTargets(req, res) {
    const { CompId, UserId } = req.user;
    const ForUserId = positiveInt(req.body.ForUserId) ?? UserId;
    try {
      const result = await database.executeStoredProcedure("sp_FetchEscalationTargets", {
        CompId,
        UserId: ForUserId,
      });
      return responseHelper.success(res, "Escalation targets fetched successfully", {
        users: result.recordsets?.[0] ?? result.recordset ?? [],
      });
    } catch (err) {
      console.error("sp_FetchEscalationTargets error:", err);
      return responseHelper.error(res, "Failed to fetch escalation targets");
    }
  },

  async delete(req, res) {
    const { CompId } = req.user;
    const Id = positiveInt(req.body.Id);
    if (!Id) return responseHelper.validationError(res, "Id is required");
    // Spec 2 §2 Delete: the record gate. Without it any authenticated user
    // could delete any ticket in the company by id.
    if (!(await assertRecordAccess(req, res, "ticket", Id))) return;
    try {
      const result = await database.executeStoredProcedure("sp_DeleteTicket", { Id, CompId });
      const spResponse = result.recordset?.[0] ?? result.recordsets?.[0]?.[0];
      const message = spResponse.ResponseMess || spResponse.ResponseMessage;
      if (spResponse.ResponseCode === 200) {
        // 086's sp_DeleteTicket removes the assignment, history and call rows;
        // the attachment rows and the files on disk are Node's to remove.
        await attachmentController.cascadeDelete(CompId, "ticket", Id);
        return responseHelper.success(res, message, spResponse);
      }
      return responseHelper.error(res, message, "SP_ERROR", spResponse.ResponseCode);
    } catch (err) {
      console.error("sp_DeleteTicket error:", err);
      return responseHelper.error(res, "Failed to delete ticket");
    }
  },

};

module.exports = ticketController;
