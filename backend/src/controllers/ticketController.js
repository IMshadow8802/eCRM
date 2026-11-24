const database = require("../config/database");
const responseHelper = require("../utils/responseHelper");
const attachmentController = require("./attachmentController");
const { scopeFor, assertRecordAccess } = require("../middleware/permission");
const { actor } = require("../utils/actor");
const { emitToUser } = require("../realtime/events");
const { SCOPES } = require("../realtime/contract");
const { assertCustomerVisible } = require("./customerController");
const { positiveInt, pageParams, optionalDateTime } = require("../utils/controllerKit");
const { parseDay } = require("../utils/reportKit");
const ticketDue = require("../services/ticketDue");

// Mutating SPs log their own activity server-side and return exactly one
// status row: Id + ResponseCode + ResponseMess (+ TicketNo from sp_SaveTicket).
// A non-200 code (400 validation, 403/404 gate, 409 race) is passed through
// with its message, never flattened into a 500. `after(row, result)` runs on
// 200 only (notify, re-word) and may return the message to answer with.
async function runSp(res, spName, params, failMessage, after) {
  try {
    const result = await database.executeStoredProcedure(spName, params);
    const spResponse = result.recordset?.[0] ?? result.recordsets?.[0]?.[0];
    const message = spResponse.ResponseMess || spResponse.ResponseMessage;
    if (spResponse.ResponseCode !== 200) return responseHelper.error(res, message, "SP_ERROR", spResponse.ResponseCode);
    const said = after ? await after(spResponse, result) : null;
    return responseHelper.success(res, said || message, spResponse);
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
// the record gate (the detail procedure answers: a row the caller can see, with
// CanEdit). Resolves to that row or null once the 400 / 403 has gone out. Node
// validates SHAPE here; the lifecycle rules — remarks required, resolution
// required, who may reopen — are the procedures', surfaced untouched by runSp.
async function gateTicket(req, res, TicketId) {
  if (!TicketId) {
    responseHelper.validationError(res, "TicketId is required");
    return null;
  }
  return (await assertRecordAccess(req, res, "ticket", TicketId, "write")) || null;
}

// Shared by transfer and bulkTransfer: the SP requires a reason and remarks
// (a send back: remarks only), and refusing here saves the round-trip. Blank
// remarks become null.
const transferArgs = (body) => ({
  ToUserId: positiveInt(body.ToUserId),
  ToBranchId: positiveInt(body.ToBranchId),
  ReasonId: positiveInt(body.ReasonId),
  Remarks: trimmed(body.Remarks),
});
const REASON_AND_REMARKS = "A reason and remarks are required to reassign";

// "this person's complaints changed" — no id, no data; clients refetch.
const notifyHolders = (ids) => {
  for (const id of new Set(ids.map(Number).filter(Boolean))) emitToUser(id, SCOPES.RECORDS, { module: "complaints" });
};

// The name for "Logged and assigned to <name>". sp_FetchAssignableUsers with a
// target answers that one row; the create already passed the same rule. Any
// failure just keeps the procedure's own message — the complaint is saved.
async function assigneeName({ CompId, UserId }, AssignedTo) {
  try {
    const r = await database.executeStoredProcedure("sp_FetchAssignableUsers", {
      CompId, UserId, Module: "complaints", RecordId: null, TargetUserId: AssignedTo,
    });
    return r.recordsets?.[0]?.[0]?.FullName || null;
  } catch (err) {
    console.error("assignee name lookup failed:", err.message);
    return null;
  }
}

const pageOf = (result, PageNumber, PageSize, rows) => {
  const p = result.recordsets?.[1]?.[0] ?? {};
  return {
    currentPage: p.CurrentPage ?? PageNumber,
    pageSize: p.PageSize ?? PageSize,
    totalRecords: p.TotalRecords ?? rows.length,
    totalPages: p.TotalPages ?? 1,
  };
};

const ticketController = {
  async save(req, res) {
    const { CompId, UserId } = actor(req);
    // W6: a new complaint belongs to the caller's live home office (re-read per
    // request), not the one in the token. The procedure reads it on create only.
    const BranchId = req.access?.primaryBranchId ?? null;
    const Id = positiveInt(req.body.Id) ?? 0;
    const fields = pick(req.body, TICKET_FIELDS);
    for (const k of TICKET_ID_FIELDS) fields[k] = positiveInt(fields[k]);
    fields.Subject = trimmed(fields.Subject);

    if (Id === 0) {
      // The two things a complaint cannot exist without (spec §3). The SP
      // checks too; refusing here names the field and saves the round-trip.
      if (!fields.CustomerId) return responseHelper.validationError(res, "CustomerId is required");
      if (!fields.Subject) return responseHelper.validationError(res, "Subject is required");
      // Assigning on create: sp_SaveTicket checks "Can assign to" and answers
      // 403, relayed by runSp.
    }
    let current = null;
    if (Id > 0) {
      current = await assertRecordAccess(req, res, "ticket", Id, "write");
      if (!current) return;
      // Ownership moves through transfer (history + notification), status
      // through setStatus (the reopen gate). The SP ignores AssignedTo on
      // update; not sending it keeps that fact visible here, not in T-SQL.
      fields.AssignedTo = null;
    }
    // A ticket may only hang off a customer the caller can see (customers scope).
    // Keeping the customer a ticket already has is no new act of linking: an
    // assignee with customers reach Own must still be able to edit (W2).
    if (fields.CustomerId && Number(current?.CustomerId) !== fields.CustomerId
        && !(await assertCustomerVisible(req, res, fields.CustomerId, scopeFor(req, "customers")))) return;
    // ...and only link a lead the caller can see: the detail shows the linked
    // lead's contact details (audit 2026-10-12). Keeping the link a ticket
    // already has is no new act of linking, so a lead moved away later does
    // not freeze the complaint.
    if (fields.LinkedLeadId && Number(current?.LinkedLeadId) !== fields.LinkedLeadId
        && !(await assertRecordAccess(req, res, "lead", fields.LinkedLeadId))) return;
    // P4: DueAt on the assignee's working calendar. Create always stamps; an
    // update re-stamps only when the priority changed (from the original anchor).
    // A transfer never does (R-P4-3). Any failure sends null = the SP's old clock.
    let DueAtOverride = null;
    try {
      if (Id === 0) {
        DueAtOverride = await ticketDue.compute(CompId, {
          assigneeId: fields.AssignedTo,
          tatHours: await ticketDue.priorityTatHours(CompId, fields.Priority),
          anchorAt: new Date(),
        });
      } else if (fields.Priority) {
        const rs = (await database.executeStoredProcedure("sp_FetchTicketDue", { CompId, TicketId: Id }))?.recordset?.[0];
        if (rs && Number(rs.Priority) !== fields.Priority) {
          DueAtOverride = await ticketDue.compute(CompId, {
            assigneeId: rs.AssignedTo,
            tatHours: await ticketDue.priorityTatHours(CompId, fields.Priority),
            anchorAt: new Date(rs.TatAnchorAt ?? rs.CreatedAt),
          });
        }
      }
    } catch (err) {
      console.error("TICKET_DUE_FAILED:", err.message);
    }
    const assigned = Id === 0 && fields.AssignedTo;
    return runSp(res, "sp_SaveTicket", { Id, CompId, UserId, BranchId, ...fields, DueAtOverride }, "Failed to save ticket",
      async () => {
        if (!assigned) return null;
        const name = await assigneeName({ CompId, UserId }, fields.AssignedTo);
        return name && `Logged and assigned to ${name}`;
      });
  },

  async fetch(req, res) {
    try {
      const b = req.body;
      const { CompId, UserId } = actor(req);
      // Clamped, not taken raw: PageSize goes straight to the SP, which has no
      // ceiling of its own. Default 25 matches the SP's own default.
      const { PageNumber, PageSize } = pageParams(b, 25);
      // 118: a ResolvedAt bracket — From inclusive, To an EXCLUSIVE instant (send tomorrow's
      // date for "through today"), unlike FromDate/ToDate, which are whole days on CreatedAt.
      const ResolvedFrom = optionalDateTime(b.ResolvedFrom);
      const ResolvedTo = optionalDateTime(b.ResolvedTo);
      if (ResolvedFrom === undefined || ResolvedTo === undefined) {
        return responseHelper.validationError(res, "ResolvedFrom / ResolvedTo is not a valid date");
      }

      const result = await database.executeStoredProcedure("sp_FetchTickets", {
        // Visibility is the procedure's, from the session person alone.
        CompId,
        UserId,
        // An optional UI filter: narrows within what the caller can see.
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
        // Only when set: every key is bound, and a DB without 118 would reject the parameter.
        ...(ResolvedFrom && { ResolvedFrom }),
        ...(ResolvedTo && { ResolvedTo }),
      });

      const tickets = result.recordsets?.[0] ?? [];
      return responseHelper.success(res, "Tickets fetched successfully", {
        tickets,
        pagination: pageOf(result, PageNumber, PageSize, tickets),
      });
    } catch (err) {
      console.error("sp_FetchTickets error:", err);
      return responseHelper.error(res, "Failed to fetch tickets");
    }
  },

  async detail(req, res) {
    const TicketId = positiveInt(req.body.TicketId);
    if (!TicketId) return responseHelper.validationError(res, "TicketId is required");
    try {
      const { CompId, UserId } = actor(req);
      const result = await database.executeStoredProcedure("sp_FetchTicketDetail", { CompId, UserId, TicketId });
      const rs = result.recordsets ?? [];
      const ticket = rs[0]?.[0] || null;
      // No row = not visible, or no such id: one answer for both, so ids
      // cannot be probed (404, never 403).
      if (!ticket) return responseHelper.error(res, "Complaint not found", "NOT_FOUND", 404);
      // RS1 core (+ CanEdit, CanReassign, CanReopen, SendBackToId,
      // SendBackToName), RS2 custom values, RS3 timeline, RS4 assignment
      // history, RS5 linked lead. The procedure blanks LinkedLeadId and RS5
      // when the caller cannot see that lead; Node attaches only what the row
      // carries and never looks the lead up itself.
      return responseHelper.success(res, "Ticket detail fetched successfully", {
        ticket,
        fields: rs[1] || [],
        activity: rs[2] || [],
        assignments: rs[3] || [],
        linkedLead: (ticket.LinkedLeadId && rs[4]?.[0]) || null,
      });
    } catch (err) {
      console.error("sp_FetchTicketDetail error:", err);
      return responseHelper.error(res, "Failed to fetch ticket detail");
    }
  },

  // Spec 2 §2: the one lifecycle engine. sp_SetTicketStatus decides whether a
  // move is a reopen and who may make it (133: CanReopen from the access
  // definitions); its 403 comes back as-is.
  async setStatus(req, res) {
    const { CompId, UserId } = actor(req);
    const TicketId = positiveInt(req.body.TicketId);
    const StatusId = positiveInt(req.body.StatusId);
    // Both shape checks before the round-trip; gateTicket answers for TicketId.
    if (TicketId && !StatusId) return responseHelper.validationError(res, "StatusId is required");
    if (!(await gateTicket(req, res, TicketId))) return;
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
        // The SP uses it only on a reopen; computed for every move since Node
        // does not know which moves are reopens.
        DueAtOverride: await ticketDue.forReopen(CompId, TicketId),
      },
      "Failed to update ticket status",
    );
  },

  // Shortcuts (spec §2): "first status of that code by SortOrder", delegating
  // to sp_SetTicketStatus inside SQL. node-mssql rejects a parameter the
  // procedure does not declare, so each sends exactly its own list.
  async resolve(req, res) {
    const { CompId, UserId } = actor(req);
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
    const { CompId, UserId } = actor(req);
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
    const { CompId, UserId } = actor(req);
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
    const { CompId, UserId } = actor(req);
    const TicketId = positiveInt(req.body.TicketId);
    if (!(await gateTicket(req, res, TicketId))) return;
    return runSp(
      res,
      "sp_ReopenTicket",
      {
        CompId, TicketId, Remarks: trimmed(req.body.Remarks), UserId,
        DueAtOverride: await ticketDue.forReopen(CompId, TicketId),
      },
      "Failed to reopen ticket",
    );
  },

  // Reassign / send back / unassign / move office — one procedure, whose gates
  // (visible, may reassign, "Can assign to", office rule; 133 fn_ReassignGate)
  // answer 404/403/400 relayed as-is. Node checks shape only. SendBack is
  // optional: installed phone builds never send it (D23).
  async transfer(req, res) {
    const { CompId, UserId } = actor(req);
    const TicketId = positiveInt(req.body.TicketId);
    const SendBack = bit(req.body.SendBack);
    const args = transferArgs(req.body);
    if (!TicketId) return responseHelper.validationError(res, "TicketId is required");
    if (SendBack && !args.Remarks) return responseHelper.validationError(res, "Remarks are required to send this back");
    if (!SendBack && (!args.Remarks || !args.ReasonId)) return responseHelper.validationError(res, REASON_AND_REMARKS);
    return runSp(res, "sp_TransferTicket", { CompId, TicketId, ...args, UserId, SendBack },
      "Failed to reassign complaint",
      (row) => notifyHolders([row.FromUserId, row.ToUserId]));
  },

  async bulkTransfer(req, res) {
    const { CompId, UserId } = actor(req);
    const ids = Array.isArray(req.body.TicketIds)
      ? [...new Set(req.body.TicketIds.map(positiveInt).filter(Boolean))]
      : [];
    const args = transferArgs(req.body);
    if (ids.length === 0 || ids.length > 200) {
      return responseHelper.validationError(res, "Pick between 1 and 200 tickets");
    }
    if (!args.Remarks || !args.ReasonId) return responseHelper.validationError(res, REASON_AND_REMARKS);
    // One call. The procedure runs every gate per id, all-or-nothing (Ruling
    // 6): one refusal answers that gate's code + message + "(n of m refused)".
    // On 200 its RS2 lists every previous and new holder.
    return runSp(
      res,
      "sp_BulkTransferTickets",
      { CompId, TicketIdsJson: JSON.stringify(ids), ...args, UserId },
      "Failed to reassign complaints",
      (row, result) => notifyHolders((result.recordsets?.[1] ?? []).map((r) => r.UserId)),
    );
  },

  // Spec 2 §2 Escalation: flag a senior; the ticket stays with the agent. The
  // caller must see the ticket; the SP validates the rest — target is an
  // ancestor of the assignee (ReportsTo, ≤ 20 hops), ticket non-terminal,
  // remarks given — and notifies the senior. No roster check: the target is
  // by definition above the caller's subtree, outside "Can assign to".
  async escalate(req, res) {
    const { CompId, UserId } = actor(req);
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

  // The ancestor chain the Escalate picker offers, nearest first, for a
  // complaint the caller can see (TicketId, new clients). Old clients send
  // ForUserId: answered only when the caller can see an in-progress complaint
  // held by that person (Ruling 4) — the procedure decides; else no rows.
  async escalationTargets(req, res) {
    const { CompId, UserId } = actor(req);
    const TicketId = positiveInt(req.body?.TicketId) ?? null;
    const ForUserId = positiveInt(req.body?.ForUserId) ?? (TicketId ? null : UserId);
    try {
      const result = await database.executeStoredProcedure("sp_FetchTicketEscalationTargets", {
        CompId, UserId, TicketId, ForUserId,
      });
      return responseHelper.success(res, "Escalation targets fetched successfully", {
        users: result.recordsets?.[0] ?? result.recordset ?? [],
      });
    } catch (err) {
      console.error("sp_FetchTicketEscalationTargets error:", err);
      return responseHelper.error(res, "Failed to fetch escalation targets");
    }
  },

  // Logged by me: complaints the caller created, wherever they are now. A row
  // the caller can no longer open carries Id NULL / CanOpen 0 (sp_FetchLoggedByMe).
  async loggedByMe(req, res) {
    const { PageNumber, PageSize } = pageParams(req.body ?? {}, 25);
    try {
      const { CompId, UserId } = actor(req);
      const result = await database.executeStoredProcedure("sp_FetchLoggedByMe", {
        CompId, UserId, SearchTerm: trimmed(req.body?.SearchTerm), PageNumber, PageSize,
      });
      const rows = result.recordsets?.[0] ?? [];
      return responseHelper.success(res, "Logged by me fetched successfully", {
        rows,
        pagination: pageOf(result, PageNumber, PageSize, rows),
      });
    } catch (err) {
      console.error("sp_FetchLoggedByMe error:", err);
      return responseHelper.error(res, "Failed to fetch complaints logged by me");
    }
  },

  async delete(req, res) {
    const { CompId } = actor(req);
    const Id = positiveInt(req.body.Id);
    if (!Id) return responseHelper.validationError(res, "Id is required");
    // Spec 2 §2 Delete: the record gate. Without it any authenticated user
    // could delete any ticket in the company by id.
    if (!(await assertRecordAccess(req, res, "ticket", Id, "write"))) return;
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
