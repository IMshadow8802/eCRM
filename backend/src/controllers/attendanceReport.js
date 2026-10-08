// src/controllers/attendanceReport.js
//
// Attendance report (P4): per person, over a date range — working days, present,
// late, not signed in. sp_FetchAttendanceRange gives users + presence rows; the
// working-day value of each date comes from the person's calendar (workCalendar).
// Scope = the attendance scope (visibleUserIds); rows outside it are dropped, never 403.

const database = require("../config/database");
const calendarContext = require("../services/calendarContext");
const { visibleUserIds } = require("./workSettingsController");
const { DEFAULT_DAYS, workIntervals, dateKey, addDays, lateMinutes } = require("../utils/workCalendar");
const { parseRange } = require("../utils/reportKit");
const { success, error } = require("../utils/responseHelper");
const { asyncRoute, positiveInt } = require("../utils/controllerKit");

const DEFAULT_CTX = { days: DEFAULT_DAYS, holidays: new Set(), marks: new Map() };
const WEEKLY_FROM_DAYS = 31; // same rule as sp_RptTat: DATEDIFF(day, from, to) >= 31

// A DATE/DATETIME column as an IST day key: a Date (driver) or a 'YYYY-MM-DD…' string.
const keyOf = (v) => (v == null ? null : v instanceof Date ? dateKey(v) : String(v).slice(0, 10));
const spanDays = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const mondayOf = (key) => addDays(key, -((new Date(`${key}T00:00:00Z`).getUTCDay() + 6) % 7));
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
 * Pure. users (RS1, with CreatedDate: earlier days are skipped), presence (RS2), { goLive, lateGraceMin }, ctxOf(userId),
 * from/to/today as YYYY-MM-DD → { kpis, rows, trend }.
 */
function summarise({ users, presence, goLive, lateGraceMin, ctxOf, from, to, today }) {
  const start = goLive && goLive > from ? goLive : from;
  const end = to < today ? to : today;
  const weekly = spanDays(from, to) >= WEEKLY_FROM_DAYS;
  const byKey = new Map(presence.map((p) => [`${Number(p.UserId)}|${keyOf(p.WorkDate)}`, p]));
  const lates = new Map(users.map((u) => [Number(u.UserId), []]));
  const joined = new Map(users.map((u) => [Number(u.UserId), keyOf(u.CreatedDate)]));
  const rows = users.map((u) => ({
    GroupKey: Number(u.UserId), GroupLabel: u.FullName,
    WorkingDays: 0, PresentDays: 0, LateDays: 0, MedianLateMin: null, NotSignedInDays: 0,
  }));
  const trend = new Map();

  for (let key = start; key <= end; key = addDays(key, 1)) {
    const bucket = weekly ? mondayOf(key) : key;
    if (!trend.has(bucket)) trend.set(bucket, { Bucket: bucket, Present: 0, Late: 0, NotSignedIn: 0 });
    const tb = trend.get(bucket);
    for (const row of rows) {
      const since = joined.get(row.GroupKey);
      if (since && key < since) continue; // not yet in the company
      const ctx = ctxOf(row.GroupKey);
      const value = dayValue(key, ctx);
      const p = byKey.get(`${row.GroupKey}|${key}`);
      row.WorkingDays += value;
      // On duty (field work) is present by definition: no sign-in needed, never late.
      if (ctx.marks?.get(key)?.kind === "on_duty") { row.PresentDays += value; tb.Present += value; continue; }
      const signedIn = !!p?.FirstSignInAt;
      if (value > 0 && signedIn) { row.PresentDays += value; tb.Present += value; }
      // Late on read against the current marks: a half-day leave saved after sign-in moves the start.
      const late = signedIn ? lateMinutes(p.FirstSignInAt, key, ctx) : 0;
      if (value > 0 && late > lateGraceMin) {
        row.LateDays++; tb.Late++;
        lates.get(row.GroupKey).push(late);
      }
      // Today counts only once the sweep has raised it; before that the shift may not have started.
      if (value > 0 && !signedIn && (key < today || p?.NotSignedInAt)) { row.NotSignedInDays++; tb.NotSignedIn++; }
    }
  }
  for (const row of rows) row.MedianLateMin = median(lates.get(row.GroupKey));

  const sum = (f) => rows.reduce((n, r) => n + r[f], 0);
  return {
    kpis: {
      People: rows.length, WorkingDays: sum("WorkingDays"), PresentDays: sum("PresentDays"),
      LateDays: sum("LateDays"), MedianLateMin: median([...lates.values()].flat()), NotSignedInDays: sum("NotSignedInDays"),
    },
    rows,
    trend: [...trend.values()],
  };
}

const attendance = asyncRoute(
  async (req, res) => {
    const body = req.body ?? {};
    const range = parseRange(body);
    if (range.error) return error(res, range.error, "VALIDATION_ERROR", 400);
    const groupBy = body.GroupBy ?? "person";
    if (groupBy !== "person") return error(res, "GroupBy must be person", "VALIDATION_ERROR", 400);
    const BranchId = positiveInt(body.BranchId);
    const OwnerId = positiveInt(body.OwnerId);
    const { from, to } = range;
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

    const info = await calendarContext.load(CompId, users.map((u) => Number(u.UserId)), from, to);
    const data = summarise({
      users, presence,
      goLive: keyOf(cfg.GoLiveDate),
      lateGraceMin: Number(cfg.LateGraceMin) || 0,
      ctxOf: (id) => info.get(Number(id))?.ctx ?? DEFAULT_CTX,
      from, to, today: dateKey(new Date()),
    });
    return success(res, "Report fetched successfully", { ...data, range: { from, to, groupBy } });
  },
  "Failed to fetch report",
  "REPORT_ERROR",
);

module.exports = { attendance, summarise, dayValue };
