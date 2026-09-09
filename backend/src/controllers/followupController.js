const database = require("../config/database");
const { success, error, validationError } = require("../utils/responseHelper");
const {
  asyncRoute, firstRow, spStatus, spOk, spMessage, pageParams, positiveInt,
} = require("../utils/controllerKit");
const { assertRecordAccess, assertCanAssign, canSeeRecord, scopeParams } = require("../middleware/permission");

const blank = (s) => !s || !String(s).trim();

// A follow-up is governed by its lead's visibility, plus one extra: the person
// it is ASSIGNED to may act on it even when the lead sits outside their owner
// scope (a manager scheduled it onto them). Resolved in one read via
// sp_FetchFollowUpLead; sends 404/403 itself and returns null on refusal.
async function loadVisibleFollowUp(req, res, id) {
  const Id = positiveInt(id);
  if (!Id) {
    validationError(res, "Follow-up Id is required");
    return null;
  }
  const result = await database.executeStoredProcedure("sp_FetchFollowUpLead", { CompId: req.user.CompId, Id });
  const row = firstRow(result);
  if (!row) {
    error(res, "Follow-up not found", "NOT_FOUND", 404);
    return null;
  }
  const mine = Number(row.AssignedTo) === Number(req.user.UserId);
  if (!mine && !canSeeRecord(req, row, "OwnerId")) {
    error(res, "You do not have access to this follow-up", "FORBIDDEN", 403);
    return null;
  }
  return row;
}

const reply = (res, row, okMessage, data) =>
  spOk(row)
    ? success(res, spMessage(row, okMessage), data(row), spStatus(row))
    : error(res, spMessage(row, "Request failed"), "SP_ERROR", spStatus(row));

class FollowupController {
  schedule = asyncRoute(
    async (req, res) => {
      // `Type: rawType` rather than a destructuring default: the default only
      // fires on `undefined`, so an explicit `Type: null` reached the SP as
      // null and violated its NOT NULL column.
      const { LeadId, Type: rawType, DueAt, AssignedTo = null } = req.body;
      const Type = rawType ?? "call";
      if (!DueAt) return validationError(res, "Due date is required");
      if (!(await assertRecordAccess(req, res, "lead", LeadId))) return;
      // Scheduling onto someone else is an assignment: same roster gate as a
      // lead transfer. Branch stays null — a follow-up never moves a lead.
      if (AssignedTo && !(await assertCanAssign(req, res, { toUserId: AssignedTo, toBranchId: null }))) return;
      const result = await database.executeStoredProcedure("sp_ScheduleFollowUp", {
        CompId: req.user.CompId, LeadId: positiveInt(LeadId), UserId: req.user.UserId,
        Type, DueAt, AssignedTo: positiveInt(AssignedTo),
      });
      return reply(res, firstRow(result), "Follow-up scheduled", (r) => ({ Id: r.Id }));
    },
    "Failed to schedule follow-up",
    "FOLLOWUP_SCHEDULE_ERROR",
  );

  complete = asyncRoute(
    async (req, res) => {
      const { Id, OutcomeId = null, Remarks, Direction = null, Duration = null, NextType = null, NextDueAt = null } = req.body;
      if (blank(Remarks)) return validationError(res, "Remarks are required");
      if (!(await loadVisibleFollowUp(req, res, Id))) return;
      const result = await database.executeStoredProcedure("sp_CompleteFollowUp", {
        CompId: req.user.CompId, Id: positiveInt(Id), UserId: req.user.UserId,
        OutcomeId: positiveInt(OutcomeId), Remarks: String(Remarks).trim(),
        Direction, Duration: positiveInt(Duration), NextType, NextDueAt,
      });
      return reply(res, firstRow(result), "Follow-up logged", (r) => ({ Id: r.Id, NextId: r.NextId ?? null }));
    },
    "Failed to log follow-up",
    "FOLLOWUP_COMPLETE_ERROR",
  );

  skip = asyncRoute(
    async (req, res) => {
      const { Id, Remarks } = req.body;
      if (blank(Remarks)) return validationError(res, "Remarks are required");
      if (!(await loadVisibleFollowUp(req, res, Id))) return;
      const result = await database.executeStoredProcedure("sp_SkipFollowUp", {
        CompId: req.user.CompId, Id: positiveInt(Id), UserId: req.user.UserId, Remarks: String(Remarks).trim(),
      });
      return reply(res, firstRow(result), "Follow-up skipped", (r) => ({ Id: r.Id }));
    },
    "Failed to skip follow-up",
    "FOLLOWUP_SKIP_ERROR",
  );

  fetch = asyncRoute(
    async (req, res) => {
      const LeadId = positiveInt(req.body.LeadId) ?? 0;
      const { AssignedTo = null, Status = null, DueFrom = null, DueTo = null, Overdue = false, SearchTerm = null } = req.body;
      const { PageNumber, PageSize } = pageParams(req.body, 25);

      // Per-lead: the lead is the record being read; gate on it and return the
      // full list. Queue: the SP applies scope itself.
      if (LeadId && !(await assertRecordAccess(req, res, "lead", LeadId))) return;

      const result = await database.executeStoredProcedure("sp_FetchFollowUps", {
        CompId: req.user.CompId, LeadId,
        AssignedTo: positiveInt(AssignedTo), Status, DueFrom, DueTo,
        Overdue: Overdue === true || Overdue === 1 || Overdue === "true",
        SearchTerm, PageNumber, PageSize,
        ...scopeParams(req),
      });
      const followups = result.recordsets?.[0] ?? [];
      if (LeadId) return success(res, "Follow-ups fetched successfully", { followups });

      const p = result.recordsets?.[1]?.[0] ?? {};
      return success(res, "Follow-ups fetched successfully", {
        followups,
        pagination: {
          currentPage: p.CurrentPage ?? PageNumber,
          pageSize: p.PageSize ?? PageSize,
          totalRecords: p.TotalRecords ?? followups.length,
          totalPages: p.TotalPages ?? 1,
        },
      });
    },
    "Failed to fetch follow-ups",
    "FOLLOWUP_FETCH_ERROR",
  );

  delete = asyncRoute(
    async (req, res) => {
      const { Id } = req.body;
      if (!(await loadVisibleFollowUp(req, res, Id))) return;
      const result = await database.executeStoredProcedure("sp_DeleteFollowUp", { Id: positiveInt(Id), CompId: req.user.CompId });
      return reply(res, firstRow(result), "Follow-up deleted", () => null);
    },
    "Failed to delete follow-up",
    "FOLLOWUP_DELETE_ERROR",
  );
}

module.exports = new FollowupController();
