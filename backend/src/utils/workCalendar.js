// src/utils/workCalendar.js
//
// All working-time arithmetic (spec D12). Instants in, instants out. The wall
// clock is IST (+05:30, no DST) whatever the process TZ is, so results do not
// change between a laptop, a UTC container and the IST server.
//
// ctx = { days: Day[7], holidays: Set<"YYYY-MM-DD">, marks: Map<key, {part, kind}> }
// A shift belongs to the date it starts on; one ending past midnight runs into the next date.

const IST_MS = 330 * 60000;
const DAY_MS = 86400000;
const MAX_DAYS = 400; // ponytail: guard against a calendar with no working time; raise if targets go past a year

const DEFAULT_DAYS = [0, 1, 2, 3, 4, 5, 6].map((d) => (d === 0
  ? { d, on: false }
  : { d, on: true, start: "09:00", end: "18:00", breakStart: "13:00", breakEnd: "14:00" }));

const pad = (n) => String(n).padStart(2, "0");
const keyOfUtc = (t) => `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
const midnightUtc = (key) => { const [y, m, d] = key.split("-").map(Number); return Date.UTC(y, m - 1, d); };

const dateKey = (date) => keyOfUtc(new Date(date.getTime() + IST_MS));
// SQL DATE columns arrive as local-midnight Dates (mssql useUTC:false); JSON would shift them a day. Send the IST date.
const dayKey = (v) => (v instanceof Date ? dateKey(v) : v);
const addDays = (key, n) => keyOfUtc(new Date(midnightUtc(key) + n * DAY_MS));
const at = (key, minutes) => new Date(midnightUtc(key) + minutes * 60000 - IST_MS);
const weekday = (key) => new Date(midnightUtc(key)).getUTCDay();
const toSqlIst = (date) => {
  const t = new Date(date.getTime() + IST_MS);
  return `${keyOfUtc(t)} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}`;
};

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const hm = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };

function parseDays(json) {
  let days;
  try { days = typeof json === "string" ? JSON.parse(json) : json; } catch { throw new Error("Shift days are not valid JSON"); }
  if (!Array.isArray(days) || days.length !== 7) throw new Error("A shift needs all seven weekdays");
  const out = [];
  for (let d = 0; d < 7; d++) {
    const r = days.find((x) => Number(x?.d) === d);
    if (!r) throw new Error("A shift needs all seven weekdays");
    if (!r.on) { out.push({ d, on: false }); continue; }
    if (!HM.test(r.start) || !HM.test(r.end)) throw new Error("Times must be HH:mm");
    if (r.start === r.end) throw new Error("A shift cannot start and end at the same time");
    const day = { d, on: true, start: r.start, end: r.end };
    if (r.breakStart || r.breakEnd) {
      if (!HM.test(r.breakStart) || !HM.test(r.breakEnd)) throw new Error("Break times must be HH:mm");
      const s = hm(r.start); let e = hm(r.end); if (e <= s) e += 1440;
      let bs = hm(r.breakStart); if (bs < s) bs += 1440;
      let be = hm(r.breakEnd); if (be < bs) be += 1440;
      if (bs <= s || be >= e || be <= bs) throw new Error("The break must sit inside the shift");
      day.breakStart = r.breakStart; day.breakEnd = r.breakEnd;
    }
    out.push(day);
  }
  const NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  for (const x of out) {
    const n = out[(x.d + 1) % 7];
    if (!x.on || !n.on) continue;
    const s = hm(x.start); let e = hm(x.end); if (e <= s) e += 1440;
    if (e > 1440 + hm(n.start)) throw new Error(`${NAMES[x.d]}'s shift runs into ${NAMES[n.d]}'s`);
  }
  if (!out.some((x) => x.on)) throw new Error("A shift needs at least one working day");
  return out;
}

// The base shift on a date, ignoring holidays and marks.
function shiftOn(key, days) {
  const r = days.find((x) => x.d === weekday(key));
  if (!r || !r.on) return null;
  const s = hm(r.start); let e = hm(r.end); if (e <= s) e += 1440;
  const sh = { workDate: key, start: at(key, s), end: at(key, e) };
  if (r.breakStart) {
    let bs = hm(r.breakStart); if (bs < s) bs += 1440;
    let be = hm(r.breakEnd); if (be < bs) be += 1440;
    sh.breakStart = at(key, bs); sh.breakEnd = at(key, be);
  }
  return sh;
}

function workIntervals(key, ctx) {
  const sh = shiftOn(key, ctx.days);
  if (!sh || ctx.holidays?.has(key)) return [];
  const mark = ctx.marks?.get(key);
  if (mark?.kind === "leave" && mark.part === "full") return [];
  const first = sh.breakStart ? [[sh.start, sh.breakStart]] : [[sh.start, new Date((sh.start.getTime() + sh.end.getTime()) / 2)]];
  const second = sh.breakStart ? [[sh.breakEnd, sh.end]] : [[first[0][1], sh.end]];
  if (mark?.kind === "leave") return mark.part === "first_half" ? second : first;
  return sh.breakStart ? [...first, ...second] : [[sh.start, sh.end]];
}

// Working intervals from `from` onward, clipped to start at `from`.
function* intervalsFrom(from, ctx) {
  let key = addDays(dateKey(from), -1); // yesterday's night shift may still be running
  for (let i = 0; i < MAX_DAYS; i++, key = addDays(key, 1)) {
    for (const [s, e] of workIntervals(key, ctx)) {
      if (e.getTime() > from.getTime()) yield [s.getTime() < from.getTime() ? from : s, e];
    }
  }
}

function workingMinutesBetween(a, b, ctx) {
  if (b.getTime() <= a.getTime()) return 0;
  let ms = 0;
  for (const [s, e] of intervalsFrom(a, ctx)) {
    if (s.getTime() >= b.getTime()) break;
    ms += Math.min(e.getTime(), b.getTime()) - s.getTime();
  }
  return Math.round(ms / 60000);
}

function addWorkingMinutes(start, minutes, ctx) {
  if (minutes <= 0) return new Date(start.getTime());
  let left = minutes * 60000;
  for (const [s, e] of intervalsFrom(start, ctx)) {
    const len = e.getTime() - s.getTime();
    if (left <= len) return new Date(s.getTime() + left);
    left -= len;
  }
  throw new Error("No working time found within 400 days");
}

function endOfShift(key, ctx) {
  for (let i = 0, k = key; i <= 14; i++, k = addDays(k, -1)) {
    const iv = workIntervals(k, ctx);
    if (iv.length) return iv[iv.length - 1][1];
  }
  return at(key, 23 * 60 + 59);
}

const effectiveStart = (key, ctx) => workIntervals(key, ctx)[0]?.[0] || null;

// The shift `now` is in, or today's not yet started; yesterday's night shift wins while it runs.
function currentShift(now, days) {
  const today = dateKey(now);
  for (const key of [addDays(today, -1), today]) {
    const sh = shiftOn(key, days);
    if (sh && now.getTime() < sh.end.getTime() && (key === today || now.getTime() >= sh.start.getTime())) {
      return { workDate: sh.workDate, start: sh.start, end: sh.end };
    }
  }
  return null;
}

function nextShiftStart(after, days) {
  for (let i = 0, k = dateKey(after); i < 15; i++, k = addDays(k, 1)) {
    const sh = shiftOn(k, days);
    if (sh && sh.start.getTime() > after.getTime()) return sh.start;
  }
  return null;
}

const minDate = (a, b) => (b && b.getTime() < a.getTime() ? b : a);

function sessionExpiry(now, days, bufferMin) {
  const cur = currentShift(now, days);
  if (cur) return minDate(new Date(cur.end.getTime() + bufferMin * 60000), nextShiftStart(cur.end, days));
  return nextShiftStart(now, days) || new Date(now.getTime() + DAY_MS);
}

// Later of current and now+buffer, never past the next shift's start; never shrinks.
function extendExpiry(current, now, days, bufferMin) {
  const want = new Date(Math.max(current.getTime(), now.getTime() + bufferMin * 60000));
  const cur = currentShift(now, days);
  const cap = nextShiftStart(cur && now.getTime() >= cur.start.getTime() ? cur.end : now, days);
  if (!cap) return want;
  if (cap.getTime() <= current.getTime()) return current;
  return minDate(want, cap);
}

const warnAt = (anchor, due, pct, ctx) =>
  addWorkingMinutes(anchor, Math.floor((workingMinutesBetween(anchor, due, ctx) * pct) / 100), ctx);

module.exports = {
  DEFAULT_DAYS, parseDays, dateKey, dayKey, addDays, at, toSqlIst, workIntervals, workingMinutesBetween,
  addWorkingMinutes, endOfShift, effectiveStart, currentShift, sessionExpiry, extendExpiry, warnAt,
};
