// src/controllers/attendanceReport.js
//
// Attendance report v2 (spec §2.4): a month grid, person × day, with a fixed cell
// code per day, per-person totals and company KPIs. sp_FetchAttendanceRange gives
// users + presence rows; sp_FetchSessionsRange the sessions behind "online".
// Working-day values come from the person's calendar (workCalendar); ½ counts ½.
// Scope = the attendance scope (visibleUserIds); rows outside it are dropped, never 403.

const database = require("../config/database");
const calendarContext = require("../services/calendarContext");
const { visibleUserIds } = require("./workSettingsController");
const { DEFAULT_DAYS, workIntervals, dateKey, addDays, lateMinutes } = require("../utils/workCalendar");
const { sessionsByUserDay } = require("../utils/sessionDay");
const { parseRange } = require("../utils/reportKit");
const { success, error } = require("../utils/responseHelper");
const { asyncRoute, positiveInt } = require("../utils/controllerKit");

const DEFAULT_CTX = { days: DEFAULT_DAYS, holidays: new Set(), marks: new Map() };
const MAX_DAYS = 62; // a month grid, two months at most
const ABSENT_TOP = 5;

// A DATE/DATETIME column as an IST day key: a Date (driver) or a 'YYYY-MM-DD…' string.
const keyOf = (v) => (v == null ? null : v instanceof Date ? dateKey(v) : String(v).slice(0, 10));
const ms = (v) => (v == null ? null : new Date(v).getTime());
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** 0 = no shift / holiday / full leave, 0.5 = half-day leave, else 1. */
function dayValue(key, ctx) {
  if (!workIntervals(key, ctx).length) return 0;
  const mark = ctx.marks?.get(key);
  return mark?.kind === "leave" && mark.part !== "full" ? 0.5 : 1;
}

/**
 * One person-day → { code } for days that do not count, else
 * { code, value, present, late, signedIn, shiftEnd, shiftMin }.
 */
function classify({ key, ctx, p, today, nowMs, start, lateGraceMin }) {
  if (key < start) return { code: "before_start" };
  if (key > today) return { code: "future" };
  if (!workIntervals(key, { days: ctx.days }).length) return { code: "off" };
  if (ctx.holidays?.has(key)) return { code: "holiday" };
  const mark = ctx.marks?.get(key);
  if (mark?.kind === "leave" && mark.part === "full") return { code: "leave" };
  const iv = workIntervals(key, ctx);
  const shiftEnd = iv[iv.length - 1][1].getTime();
  const shiftMin = iv.reduce((n, [a, b]) => n + (b - a) / 60000, 0);
  const signedIn = !!p?.FirstSignInAt;
  // Today counts only once signed in or after its shift end; before that the day is still open.
  if (key === today && !signedIn && nowMs < shiftEnd) return { code: "future" };
  const value = dayValue(key, ctx);
  const day = { value, signedIn, shiftEnd, shiftMin };
  // On duty (field work) is present by definition: no sign-in needed, never late.
  if (mark?.kind === "on_duty") return { ...day, code: "on_duty", present: value, late: 0 };
  // Late on read against the current marks: a half-day leave saved after sign-in moves the start.
  const raw = signedIn ? lateMinutes(p.FirstSignInAt, key, ctx) : 0;
  const late = raw > lateGraceMin ? raw : 0;
  const present = signedIn ? value : 0;
  if (value < 1) return { ...day, code: "half", present, late }; // never absent
  return { ...day, code: !signedIn ? "absent" : late ? "late" : "on_time", present, late };
}

/**
 * Pure. users (RS1, CreatedDate: earlier days are before_start), presence (RS2), sessions
 * (sp_FetchSessionsRange), { goLive, lateGraceMin }, ctxOf(userId), from/to as YYYY-MM-DD,
 * now (Date) → { kpis, days, rows }.
 */
function summarise({ users, presence, sessions = [], goLive, lateGraceMin, ctxOf, from, to, now }) {
  const today = dateKey(now);
  const nowMs = now.getTime();
  const days = [];
  for (let key = from; key <= to; key = addDays(key, 1)) days.push(key);
  const byKey = new Map(presence.map((p) => [`${Number(p.UserId)}|${keyOf(p.WorkDate)}`, p]));
  const online = sessionsByUserDay(sessions, from, to, now);
  const allLates = [], allOnline = [], allShift = [];

  const rows = users.map((u) => {
    const id = Number(u.UserId);
    const ctx = ctxOf(id);
    const start = [goLive, keyOf(u.CreatedDate)].reduce((a, b) => (b && b > a ? b : a), "");
    const row = { UserId: id, FullName: u.FullName, Present: 0, WorkingDays: 0, Late: 0, LateMinutes: 0, Absent: 0,
      Leave: 0, LeftEarly: 0, OnlineMedianMin: null, ShiftMedianMin: null, LateStreak: false, cells: [] };
    const onlineMins = [], shiftMins = [];
    let run = 0;
    for (const key of days) {
      const p = byKey.get(`${id}|${key}`);
      const d = classify({ key, ctx, p, today, nowMs, start, lateGraceMin });
      const day = online.get(`${id}|${key}`);
      const onlineMin = day?.onlineMinutes ?? 0;
      row.cells.push({ date: key, code: d.code, lateMin: d.late ?? 0, onlineMin });
      if (d.code === "leave") row.Leave += 1;
      if (d.value == null) continue; // not a working day: neither counts nor breaks a late streak
      if (d.code === "half") row.Leave += 1 - d.value;
      row.WorkingDays += d.value;
      row.Present += d.present;
      if (d.code === "absent") row.Absent += 1;
      if (d.late) { row.Late += 1; row.LateMinutes += d.late; allLates.push(d.late); }
      run = d.late ? run + 1 : 0;
      if (run >= 3) row.LateStreak = true;
      if (d.signedIn) {
        onlineMins.push(onlineMin); shiftMins.push(d.shiftMin);
        const out = ms(p.SignedOutAt);
        if (out != null && out < d.shiftEnd && !day?.open) row.LeftEarly += 1;
      }
    }
    row.OnlineMedianMin = median(onlineMins);
    row.ShiftMedianMin = median(shiftMins);
    allOnline.push(...onlineMins); allShift.push(...shiftMins);
    return row;
  });

  const sum = (f) => rows.reduce((n, r) => n + r[f], 0);
  const WorkingDays = sum("WorkingDays");
  const PresentDays = sum("Present");
  return {
    kpis: {
      PresentPct: WorkingDays ? (PresentDays / WorkingDays) * 100 : null,
      PresentDays, WorkingDays,
      LateCount: sum("Late"), LateMinutesTotal: sum("LateMinutes"), LateMinutesMedian: median(allLates),
      Absent: sum("Absent"),
      AbsentTop: rows.filter((r) => r.Absent > 0).sort((a, b) => b.Absent - a.Absent)
        .slice(0, ABSENT_TOP).map((r) => ({ FullName: r.FullName, days: r.Absent })),
      OnlineMedianMin: median(allOnline), ShiftMedianMin: median(allShift),
    },
    days,
    rows,
  };
}

const attendance = asyncRoute(
  async (req, res) => {
    const body = req.body ?? {};
    const range = parseRange(body);
    if (range.error) return error(res, range.error, "VALIDATION_ERROR", 400);
    const { from, to } = range;
    if ((Date.parse(to) - Date.parse(from)) / 86400000 + 1 > MAX_DAYS) {
      return error(res, `Pick ${MAX_DAYS} days or fewer`, "VALIDATION_ERROR", 400);
    }
    const BranchId = positiveInt(body.BranchId);
    const OwnerId = positiveInt(body.OwnerId);
    const CompId = req.user.CompId;

    // ponytail: without an OwnerId every company user's rows are fetched, then scoped here
    // (Office reach needs the candidates); narrow server-side if companies grow large.
    const result = await database.executeStoredProcedure("sp_FetchAttendanceRange", {
      CompId, FromDate: from, ToDate: to, UserIdsJson: OwnerId ? JSON.stringify([OwnerId]) : null,
    });
    const [allUsers = [], presence = [], [cfg = {}] = []] = result?.recordsets ?? [];
    const candidates = allUsers.map((u) => Number(u.UserId))
      .filter((id) => !OwnerId || id === OwnerId);
    const allowed = await visibleUserIds(req, candidates);
    const users = allUsers.filter((u) => candidates.includes(Number(u.UserId))
      && (allowed === null || allowed.includes(Number(u.UserId)))
      && (!BranchId || Number(u.BranchId) === BranchId));
    const ids = users.map((u) => Number(u.UserId));

    const [info, sessions] = await Promise.all([
      calendarContext.load(CompId, ids, from, to),
      database.executeStoredProcedure("sp_FetchSessionsRange", { CompId, FromDate: from, ToDate: to, UserIdsJson: JSON.stringify(ids) }),
    ]);
    const data = summarise({
      users, presence, sessions: sessions?.recordsets?.[0] ?? [],
      goLive: keyOf(cfg.GoLiveDate),
      lateGraceMin: Number(cfg.LateGraceMin) || 0,
      ctxOf: (id) => info.get(Number(id))?.ctx ?? DEFAULT_CTX,
      from, to, now: new Date(),
    });
    return success(res, "Report fetched successfully", { ...data, range: { from, to } });
  },
  "Failed to fetch report",
  "REPORT_ERROR",
);

module.exports = { attendance, summarise, dayValue };
