// src/services/calendarContext.js
//
// Loads what workCalendar.js needs (shift days, holidays, marks) for a set of
// users, and the per-company work settings. One sp_FetchCalendarContext call.

const database = require("../config/database");
const { DEFAULT_DAYS, parseDays, dateKey, at } = require("../utils/workCalendar");

// A DATE column comes back as a Date (local midnight) or a string depending on driver config.
const keyOf = (v) => (v instanceof Date ? dateKey(v) : String(v).slice(0, 10));

const badCalendars = new Set();
function daysOf(calendar) {
  if (!calendar) return DEFAULT_DAYS;
  try { return parseDays(calendar.DaysJson); } catch (err) {
    if (!badCalendars.has(calendar.Id)) {
      badCalendars.add(calendar.Id); // log once per calendar
      console.error(`CALENDAR_BAD_JSON: calendar ${calendar.Id} falls back to the default week:`, err.message);
    }
    return DEFAULT_DAYS;
  }
}

async function load(compId, userIds, fromKey, toKey) {
  const out = new Map();
  if (!userIds?.length) return out;
  const result = await database.executeStoredProcedure("sp_FetchCalendarContext", {
    CompId: compId,
    UserIdsJson: JSON.stringify(userIds),
    FromDate: at(fromKey, 0),
    ToDate: at(toKey, 0),
  });
  const [users = [], calendars = [], holidays = [], marks = []] = result?.recordsets ?? [];
  const byCal = new Map(calendars.map((c) => [Number(c.Id), c]));
  const parsed = new Map();
  const daysFor = (id) => {
    if (!parsed.has(id)) parsed.set(id, daysOf(byCal.get(id)));
    return parsed.get(id);
  };
  for (const u of users) {
    const branchId = u.BranchId == null ? null : Number(u.BranchId);
    const userId = Number(u.UserId);
    const days = daysFor(Number(u.CalendarId));
    const hol = new Set(holidays.filter((h) => h.BranchId == null || Number(h.BranchId) === branchId).map((h) => keyOf(h.HolidayDate)));
    const mk = new Map(marks.filter((m) => Number(m.UserId) === userId).map((m) => [keyOf(m.WorkDate), { part: m.Part, kind: m.Kind }]));
    out.set(userId, {
      ctx: { days, holidays: hol, marks: mk },
      days,
      branchId,
      presenceExempt: u.PresenceExempt === true || u.PresenceExempt === 1,
      reportsTo: u.ReportsTo == null ? null : Number(u.ReportsTo),
      calendarId: u.CalendarId == null ? null : Number(u.CalendarId),
    });
  }
  return out;
}

const TTL_MS = 60000;
const cache = new Map(); // compId -> { at, value }

async function settings(compId) {
  const hit = cache.get(compId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const result = await database.executeStoredProcedure("sp_FetchWorkSettings", { CompId: compId });
  const r = result?.recordsets?.[0]?.[0] || {};
  const value = {
    lateGraceMin: r.LateGraceMin ?? 0,
    sessionBufferMin: r.SessionBufferMin ?? 0,
    warnPct: r.WarnPct ?? 80,
    notifyNotSignedIn: r.NotifyNotSignedIn === true || r.NotifyNotSignedIn === 1,
    goLiveDate: r.GoLiveDate ?? null,
  };
  cache.set(compId, { at: Date.now(), value });
  return value;
}

const clearSettingsCache = () => cache.clear();

module.exports = { load, settings, clearSettingsCache };
