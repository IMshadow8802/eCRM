const database = require("../config/database");
const { success, error, validationError } = require("../utils/responseHelper");
const {
  asyncRoute, firstRow, spStatus, spOk, spMessage, pageParams, positiveInt, istDateTime, optionalDateTime,
} = require("../utils/controllerKit");
const { assertRecordAccess, visibleFollowUp } = require("../middleware/permission");
const { actor } = require("../utils/actor");

const blank = (s) => !s || !String(s).trim();

const BAD_DUE = "Follow-up date is not valid";

// Which follow-ups a person sees is the database's answer (fn_VisibleFollowUps via
// sp_FetchFollowUpLead): Via 1 = its lead is visible, Via 2 = an OPEN one assigned to
// them, Via 3 = a manager's look-only line (CanAct 0). Acting needs Via 1, or Via 2 while
// still open — a done one needs the lead, since a transfer re-points only open rows
// (access review F1). Not returned → 404. Sends the refusal itself, null on refusal.
async function loadVisibleFollowUp(req, res, id) {
  const Id = positiveInt(id);
  if (!Id) {
    validationError(res, "Follow-up Id is required");
    return null;
  }
  const row = await visibleFollowUp(req, Id);
  if (!row) {
    error(res, "Follow-up not found", "NOT_FOUND", 404);
    return null;
  }
  const via = Number(row.Via);
  const canAct = Number(row.CanAct) === 1 && (via === 1 || (via === 2 && row.Status === "open"));
  if (!canAct) {
    error(res, "You can view this follow-up but not act on it", "FORBIDDEN", 403);
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
      const due = istDateTime(DueAt);
      if (!due) return validationError(res, BAD_DUE);
      if (!positiveInt(LeadId)) return validationError(res, "Lead is required");
      const { CompId, UserId } = actor(req);
      // The procedure gates it all (133): the lead must be visible (404), the caller
      // may schedule (403), and AssignedTo must be someone they can assign to (403).
      const result = await database.executeStoredProcedure("sp_ScheduleFollowUp", {
        CompId, UserId, LeadId: positiveInt(LeadId),
        Type, DueAt: due, AssignedTo: positiveInt(AssignedTo),
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
      const nextDue = NextDueAt == null || NextDueAt === "" ? null : istDateTime(NextDueAt);
      if (NextDueAt != null && NextDueAt !== "" && !nextDue) return validationError(res, BAD_DUE);
      if (!(await loadVisibleFollowUp(req, res, Id))) return;
      const { CompId, UserId } = actor(req);
      const result = await database.executeStoredProcedure("sp_CompleteFollowUp", {
        CompId, Id: positiveInt(Id), UserId,
        OutcomeId: positiveInt(OutcomeId), Remarks: String(Remarks).trim(),
        Direction, Duration: positiveInt(Duration), NextType, NextDueAt: nextDue,
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
      const { CompId, UserId } = actor(req);
      const result = await database.executeStoredProcedure("sp_SkipFollowUp", {
        CompId, Id: positiveInt(Id), UserId, Remarks: String(Remarks).trim(),
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
      // "Done today" (118): a DoneAt bracket — DoneFrom inclusive, DoneTo an EXCLUSIVE instant
      // (send tomorrow for "through today"). DueTo next to it is an INCLUSIVE day; not the same.
      const DoneFrom = optionalDateTime(req.body.DoneFrom);
      const DoneTo = optionalDateTime(req.body.DoneTo);
      if (DoneFrom === undefined || DoneTo === undefined) return validationError(res, "DoneFrom / DoneTo is not a valid date");

      // Per-lead: the lead is the record being read; gate on it and return the
      // full list. Queue: the SP applies the person's definition itself.
      if (LeadId && !(await assertRecordAccess(req, res, "lead", LeadId))) return;

      const { CompId, UserId } = actor(req);
      const result = await database.executeStoredProcedure("sp_FetchFollowUps", {
        CompId, UserId, LeadId,
        AssignedTo: positiveInt(AssignedTo), Status, DueFrom, DueTo,
        // Only when set: every key is bound, and a DB without 118 would reject the parameter.
        ...(DoneFrom && { DoneFrom }),
        ...(DoneTo && { DoneTo }),
        Overdue: Overdue === true || Overdue === 1 || Overdue === "true",
        SearchTerm, PageNumber, PageSize,
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
      const { CompId } = actor(req);
      const result = await database.executeStoredProcedure("sp_DeleteFollowUp", { Id: positiveInt(Id), CompId });
      return reply(res, firstRow(result), "Follow-up deleted", () => null);
    },
    "Failed to delete follow-up",
    "FOLLOWUP_DELETE_ERROR",
  );
}

module.exports = new FollowupController();
