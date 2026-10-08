// Complaint due time on the working calendar (P4, D13). TatHours are working
// hours on the assignee's shift; unassigned = the company default calendar + company-wide holidays (sp_FetchDefaultCalendar).
// Never throws: callers pass null and the SP keeps its wall-clock DueAt.
const database = require("../config/database");
const calendarContext = require("./calendarContext");
const { DEFAULT_DAYS, parseDays, addWorkingMinutes, dateKey, dayKey, addDays } = require("../utils/workCalendar");

const DEFAULT_CTX = { days: DEFAULT_DAYS, holidays: new Set(), marks: new Map() };

// Unassigned: the company default calendar + company-wide holidays; no row or bad JSON = the default week.
async function defaultCtx(compId) {
  const r = await database.executeStoredProcedure("sp_FetchDefaultCalendar", { CompId: compId });
  const [cal, hol = []] = [r?.recordsets?.[0]?.[0], r?.recordsets?.[1]];
  let days = DEFAULT_DAYS;
  try { if (cal?.DaysJson) days = parseDays(cal.DaysJson); } catch { /* default week */ }
  return { days, holidays: new Set(hol.map((h) => dayKey(h.HolidayDate))), marks: new Map() };
}
const HORIZON_DAYS = 400;

async function compute(compId, { assigneeId, tatHours, anchorAt }) {
  const hours = Number(tatHours);
  if (tatHours == null || !(hours > 0)) return null;
  try {
    const from = dateKey(anchorAt);
    let ctx;
    if (assigneeId) {
      const info = await calendarContext.load(compId, [Number(assigneeId)], from, addDays(from, HORIZON_DAYS));
      ctx = info?.get(Number(assigneeId))?.ctx ?? DEFAULT_CTX;
    } else ctx = await defaultCtx(compId);
    return addWorkingMinutes(anchorAt, Math.round(hours * 60), ctx);
  } catch (err) {
    console.error("TICKET_DUE_COMPUTE_FAILED:", err.message);
    return null;
  }
}

// TatHours of one priority lookup row, or null (no priority / no TAT / lookup failed).
async function priorityTatHours(compId, priorityId) {
  if (!priorityId) return null;
  try {
    const r = await database.executeStoredProcedure("sp_FetchLookups", { CompId: compId, Kind: "priority" });
    const row = (r?.recordset ?? r?.recordsets?.[0] ?? []).find((l) => Number(l.Id) === Number(priorityId));
    return row?.TatHours ?? null;
  } catch (err) {
    console.error("TICKET_DUE_PRIORITY_FAILED:", err.message);
    return null;
  }
}

// Due time for a reopen: now + the ticket's current TatHours on its assignee's calendar.
async function forReopen(compId, ticketId) {
  try {
    const t = (await database.executeStoredProcedure("sp_FetchTicketDue", { CompId: compId, TicketId: ticketId }))?.recordset?.[0];
    return t ? await compute(compId, { assigneeId: t.AssignedTo, tatHours: t.TatHours, anchorAt: new Date() }) : null;
  } catch (err) {
    console.error("TICKET_DUE_REOPEN_FAILED:", err.message);
    return null;
  }
}

module.exports = { compute, priorityTatHours, forReopen };
