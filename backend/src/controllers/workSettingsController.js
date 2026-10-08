const database = require("../config/database");
const { scopeFor } = require("../middleware/permission");
const calendarContext = require("../services/calendarContext");
const { DEFAULT_DAYS, parseDays, dateKey, dayKey, addDays, at, workIntervals } = require("../utils/workCalendar");
const { success, validationError } = require("../utils/responseHelper");
const { asyncRoute, firstRow, spStatus, spOk, spMessage, positiveInt } = require("../utils/controllerKit");

const KEY = /^\d{4}-\d{2}-\d{2}$/;
const keyOf = (v) => (typeof v === "string" ? v.slice(0, 10) : null);
const inRange = (v, lo, hi) => Number.isInteger(Number(v)) && v !== "" && v !== null && Number(v) >= lo && Number(v) <= hi;

const reply = (res, row, data = null) => {
  const ok = spOk(row);
  return res.status(spStatus(row)).json({
    success: ok, message: spMessage(row), responseCode: spStatus(row),
    data: ok ? data : null, timestamp: new Date().toISOString(),
  });
};

// Task clocks are re-derived after a calendar change (Kind must be one sp_TatMarkStale
// accepts: assign/change/reopen/hold — "recompute" was refused with a 400). Sprocs live in script 100;
// on a DB without it the failure is logged and the request still succeeds.
const markStale = async (CompId, UserId = null) => {
  try { await database.executeStoredProcedure("sp_TatMarkStale", { CompId, TaskId: null, UserId, Kind: "change" }); } catch (err) { console.error("sp_TatMarkStale skipped:", err.message); }
};
const excuse = async (CompId, UserId, FromAt, ToAt, Why, BranchId = null) => {
  try { await database.executeStoredProcedure("sp_TatExcuseForDays", { CompId, UserId, FromAt, ToAt, Why, BranchId }); } catch (err) { console.error("sp_TatExcuseForDays skipped:", err.message); }
};

// null = every user; else the user ids the caller may see (callers intersect with their candidates).
async function visibleUserIds(req, candidateIds = []) {
  const s = scopeFor(req, "attendance");
  if (s.isAdmin || (s.can.view && s.reach === "Company")) return null;
  const team = [...new Set([...(req.access?.teamOwners ?? []), Number(req.user.UserId)])];
  if (s.can.view && (s.reach === "Office" || s.reach === "OfficeTree") && candidateIds.length) {
    const today = dateKey(new Date());
    const info = await calendarContext.load(req.user.CompId, candidateIds, today, today);
    const inOffice = candidateIds.filter((id) => info.has(Number(id)) && s.branchIds.includes(info.get(Number(id)).branchId));
    return [...new Set([...team, ...inOffice.map(Number)])];
  }
  return team;
}

// The instants a leave mark excuses: the marked part of that date's shift, computed
// without the new mark. A shift belongs to the date it starts on, so a night shift
// runs past midnight. null = no shift that date, nothing to excuse.
async function excusedWindow(compId, userId, key, part) {
  const info = (await calendarContext.load(compId, [userId], key, key)).get(Number(userId));
  if (!info) return null;
  const marks = new Map(info.ctx.marks);
  if (part === "full") marks.delete(key);
  else marks.set(key, { kind: "leave", part: part === "first_half" ? "second_half" : "first_half" }); // leaves the marked half
  const iv = workIntervals(key, { ...info.ctx, marks });
  return iv.length ? [iv[0][0], iv[iv.length - 1][1]] : null;
}

class WorkSettingsController {
  fetchWorkSettings = asyncRoute(
    async (req, res) => {
      const result = await database.executeStoredProcedure("sp_FetchWorkSettings", { CompId: req.user.CompId });
      const [s, cals = [], hol = [], tat = []] = result?.recordsets ?? [];
      const calendars = cals.map((c) => {
        let days = DEFAULT_DAYS;
        try { days = parseDays(c.DaysJson); } catch { /* shown as the default week; the admin can re-save it */ }
        return { ...c, DaysJson: days };
      });
      return success(res, "Work settings fetched", { settings: s?.[0] ? { ...s[0], GoLiveDate: dayKey(s[0].GoLiveDate) } : null, calendars,
        holidays: hol.map((h) => ({ ...h, HolidayDate: dayKey(h.HolidayDate) })), tatPolicy: tat });
    },
    "Failed to fetch work settings",
    "WORK_SETTINGS_FETCH_ERROR",
  );

  saveCompanySetting = asyncRoute(
    async (req, res) => {
      const { LateGraceMin, SessionBufferMin, WarnPct, NotifyNotSignedIn, GoLiveDate } = req.body;
      if (!inRange(LateGraceMin, 0, 120)) return validationError(res, "Late grace must be 0 to 120 minutes");
      if (!inRange(SessionBufferMin, 0, 480)) return validationError(res, "Session buffer must be 0 to 480 minutes");
      if (!inRange(WarnPct, 50, 95)) return validationError(res, "Warning point must be 50 to 95 percent");
      const live = GoLiveDate ? keyOf(GoLiveDate) : null;
      if (GoLiveDate && !KEY.test(live)) return validationError(res, "Go-live date must be YYYY-MM-DD");
      const result = await database.executeStoredProcedure("sp_SaveCompanySetting", {
        CompId: req.user.CompId,
        LateGraceMin: Number(LateGraceMin),
        SessionBufferMin: Number(SessionBufferMin),
        WarnPct: Number(WarnPct),
        NotifyNotSignedIn: NotifyNotSignedIn ? 1 : 0,
        GoLiveDate: live ? at(live, 0) : null,
      });
      calendarContext.clearSettingsCache();
      return reply(res, firstRow(result));
    },
    "Failed to save settings",
    "COMPANY_SETTING_SAVE_ERROR",
  );

  saveWorkCalendar = asyncRoute(
    async (req, res) => {
      const { Id, Name, DaysJson, IsDefault } = req.body;
      if (!Name || !String(Name).trim()) return validationError(res, "Calendar name is required");
      let days;
      try { days = parseDays(DaysJson); } catch (err) { return validationError(res, err.message); }
      const result = await database.executeStoredProcedure("sp_SaveWorkCalendar", {
        Id: Number(Id) || 0,
        CompId: req.user.CompId,
        Name: String(Name).trim(),
        DaysJson: JSON.stringify(days),
        IsDefault: IsDefault ? 1 : 0,
      });
      const row = firstRow(result);
      if (spOk(row)) await markStale(req.user.CompId);
      return reply(res, row, { id: row?.Id });
    },
    "Failed to save calendar",
    "WORK_CALENDAR_SAVE_ERROR",
  );

  deleteWorkCalendar = asyncRoute(
    async (req, res) => {
      const id = positiveInt(req.body.Id);
      if (!id) return validationError(res, "Calendar id is required");
      const result = await database.executeStoredProcedure("sp_DeleteWorkCalendar", { Id: id, CompId: req.user.CompId });
      const row = firstRow(result);
      if (spOk(row)) await markStale(req.user.CompId);
      return reply(res, row);
    },
    "Failed to delete calendar",
    "WORK_CALENDAR_DELETE_ERROR",
  );

  saveHoliday = asyncRoute(
    async (req, res) => {
      const { Id, HolidayDate, Name, BranchId } = req.body;
      const key = keyOf(HolidayDate);
      if (!key || !KEY.test(key)) return validationError(res, "Holiday date must be YYYY-MM-DD");
      if (!Name || !String(Name).trim()) return validationError(res, "Holiday name is required");
      const CompId = req.user.CompId;
      const branchId = positiveInt(BranchId);
      const result = await database.executeStoredProcedure("sp_SaveHoliday", {
        Id: Number(Id) || 0, CompId, HolidayDate: at(key, 0), Name: String(Name).trim(), BranchId: branchId,
      });
      const row = firstRow(result);
      if (spOk(row)) {
        await markStale(CompId);
        await excuse(CompId, null, at(key, 0), at(addDays(key, 1), 0), "Holiday", branchId);
      }
      return reply(res, row, { id: row?.Id });
    },
    "Failed to save holiday",
    "HOLIDAY_SAVE_ERROR",
  );

  deleteHoliday = asyncRoute(
    async (req, res) => {
      const id = positiveInt(req.body.Id);
      if (!id) return validationError(res, "Holiday id is required");
      const result = await database.executeStoredProcedure("sp_DeleteHoliday", { Id: id, CompId: req.user.CompId });
      const row = firstRow(result);
      if (spOk(row)) await markStale(req.user.CompId);
      return reply(res, row);
    },
    "Failed to delete holiday",
    "HOLIDAY_DELETE_ERROR",
  );

  saveDayMark = asyncRoute(
    async (req, res) => {
      const { UserId, WorkDate, Part, Kind, Remarks } = req.body;
      const userId = positiveInt(UserId);
      const key = keyOf(WorkDate);
      if (!userId) return validationError(res, "User is required");
      if (!key || !KEY.test(key)) return validationError(res, "Date must be YYYY-MM-DD");
      const CompId = req.user.CompId;
      const result = await database.executeStoredProcedure("sp_SaveDayMark", {
        CompId, UserId: userId, WorkDate: at(key, 0), Part, Kind, Remarks: Remarks ?? null,
        ActorUserId: req.user.UserId, ActorIsAdmin: req.scope?.isAdmin ? 1 : 0,
      });
      const row = firstRow(result);
      if (spOk(row)) {
        await markStale(CompId, userId);
        if (Kind === "leave") {
          try {
            const w = await excusedWindow(CompId, userId, key, Part);
            if (w) await excuse(CompId, userId, w[0], w[1], "On leave");
          } catch (err) { console.error("DAY_MARK_EXCUSE skipped:", err.message); }
        }
      }
      return reply(res, row, { id: row?.Id });
    },
    "Failed to save day mark",
    "DAY_MARK_SAVE_ERROR",
  );

  deleteDayMark = asyncRoute(
    async (req, res) => {
      const { UserId, WorkDate } = req.body;
      const userId = positiveInt(UserId);
      const key = keyOf(WorkDate);
      if (!userId) return validationError(res, "User is required");
      if (!key || !KEY.test(key)) return validationError(res, "Date must be YYYY-MM-DD");
      const result = await database.executeStoredProcedure("sp_DeleteDayMark", {
        CompId: req.user.CompId, UserId: userId, WorkDate: at(key, 0),
        ActorUserId: req.user.UserId, ActorIsAdmin: req.scope?.isAdmin ? 1 : 0,
      });
      const row = firstRow(result);
      if (spOk(row)) await markStale(req.user.CompId, userId);
      return reply(res, row);
    },
    "Failed to delete day mark",
    "DAY_MARK_DELETE_ERROR",
  );

  fetchDayMarks = asyncRoute(
    async (req, res) => {
      const { UserIds, FromDate, ToDate } = req.body;
      const from = keyOf(FromDate);
      const to = keyOf(ToDate);
      if (!from || !to || !KEY.test(from) || !KEY.test(to)) return validationError(res, "From and to dates are required");
      const asked = (Array.isArray(UserIds) ? UserIds : []).map(positiveInt).filter(Boolean);
      const allowed = await visibleUserIds(req, asked);
      const mine = [...new Set([...(req.access?.teamOwners ?? []), Number(req.user.UserId)])];
      const ids = asked.length ? (allowed === null ? asked : asked.filter((i) => allowed.includes(i))) : mine;
      if (!ids.length) return success(res, "Day marks fetched", { marks: [] });
      const result = await database.executeStoredProcedure("sp_FetchDayMarks", {
        CompId: req.user.CompId, UserIdsJson: JSON.stringify(ids), FromDate: at(from, 0), ToDate: at(to, 0),
      });
      return success(res, "Day marks fetched", { marks: (result?.recordsets?.[0] ?? []).map((m) => ({ ...m, WorkDate: dayKey(m.WorkDate) })) });
    },
    "Failed to fetch day marks",
    "DAY_MARKS_FETCH_ERROR",
  );
}

const controller = new WorkSettingsController();
module.exports = controller;
module.exports.visibleUserIds = visibleUserIds;
