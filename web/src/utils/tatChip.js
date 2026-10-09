// Task TAT chip + IST time formatting (spec 2026-10-07 §6). Times are always
// shown in IST with an "IST" suffix, whatever the browser's own zone is, so
// every format goes through Intl with timeZone Asia/Kolkata.
import { AlertOctagon, AlertTriangle, Clock, PauseCircle } from "lucide-react";

const PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "short",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const istParts = (d) =>
  Object.fromEntries(PARTS.formatToParts(d).map((p) => [p.type, p.value]));

const toDate = (v) => (v == null || v === "" ? null : v instanceof Date ? v : new Date(v));

// A DB wall-clock string ("2026-10-08 17:00:00", CONVERT style 120) is IST
// already; anything else (ISO from the JSON driver) is an instant.
const isWallClock = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(v);
export const parseIst = (v) =>
  isWallClock(v)
    ? new Date(`${v.slice(0, 10)}T${v.slice(11, 19).padEnd(8, ":00")}+05:30`)
    : toDate(v);

// "17:30 IST" on the same IST day as `now`, else "Tue 11:00 IST".
export function istShort(value, now = new Date()) {
  const d = parseIst(value);
  if (!d || Number.isNaN(d.getTime())) return "";
  const a = istParts(d);
  const b = istParts(now);
  const sameDay = a.year === b.year && a.month === b.month && a.day === b.day;
  return `${sameDay ? "" : `${a.weekday} `}${a.hour}:${a.minute} IST`;
}

// "08 Oct 2026, 17:30 IST" — for the Deadline tab's timeline.
export function istStamp(value) {
  const d = parseIst(value);
  if (!d || Number.isNaN(d.getTime())) return "";
  const a = istParts(d);
  return `${a.day} ${a.month} ${a.year}, ${a.hour}:${a.minute} IST`;
}

// Wall-clock difference: 25m · 3h 10m · 2d 4h.
export function overBy(ms) {
  const mins = Math.max(1, Math.floor(ms / 60000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return mins % 60 ? `${h}h ${mins % 60}m` : `${h}h`;
  return h % 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${Math.floor(h / 24)}d`;
}

// "25 minutes" · "3 hours 10 minutes" · "2 days 4 hours" - the spoken form of overBy.
export function overByLong(ms) {
  const mins = Math.max(1, Math.floor(ms / 60000));
  const u = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (mins < 60) return u(mins, "minute");
  const h = Math.floor(mins / 60);
  if (h < 24) return mins % 60 ? `${u(h, "hour")} ${u(mins % 60, "minute")}` : u(h, "hour");
  return h % 24 ? `${u(Math.floor(h / 24), "day")} ${u(h % 24, "hour")}` : u(Math.floor(h / 24), "day");
}

export const TAT_ICON = { ok: Clock, warn: AlertTriangle, over: AlertOctagon, held: PauseCircle };

export function tatChip(task, now = new Date()) {
  if (!task || (!task.TatDueAt && !task.TatHeldSince)) return null;
  const tone = (t, text) => ({ tone: t, text, icon: TAT_ICON[t] });
  if (task.TatHeldSince) return tone("held", `On hold: ${task.TatHoldReason || "Blocked"}`);
  const due = toDate(task.TatDueAt);
  // Over is judged on the current due only: a reopen keeps BreachedAt (on record server-side)
  // but sets a fresh due, and the chip shows that one.
  if (now > due) {
    return tone("over", `Late by ${overBy(now - due)}`);
  }
  const warnAt = toDate(task.TatWarnAt);
  return tone(warnAt && warnAt <= now ? "warn" : "ok", `Due ${istShort(due, now)}`);
}

// The chip as a full sentence, for its hover/focus tooltip.
export function tatSentence(task, now = new Date()) {
  const chip = tatChip(task, now);
  if (!chip) return "";
  if (task.TatHeldSince) return `${chip.text}. The timer is paused and no time is counted.`;
  const due = toDate(task.TatDueAt);
  if (now > due) return `Missed the deadline by ${overByLong(now - due)}. The deadline has passed.`;
  const at = istShort(due, now);
  const sentence = /^[A-Z][a-z]{2} /.test(at) ? `Due on ${at}` : `Due at ${at} today`;
  return chip.tone === "warn" ? `${sentence}. Most of the time is used up.` : `${sentence}.`;
}

export const VERDICT_LABEL = { excused: "Delay accepted", not_excused: "Delay rejected" };

// One line per tblTaskTatEvent row. A due move (any Kind) carries old -> new
// wall-clock values; the rest are plain facts.
export function eventText(e) {
  if (isWallClock(e.NewValue)) {
    const now = parseIst(e.NewValue);
    return e.OldValue
      ? `Deadline changed ${istShort(e.OldValue, now).replace(" IST", "")} → ${istShort(e.NewValue, now)}`
      : `Due set to ${istShort(e.NewValue, now)}`;
  }
  switch (e.Kind) {
    case "assign": return "Assigned";
    case "reopen": return "Reopened";
    case "resume": return "Timer restarted";
    case "hold": return e.NewValue === "blocked" ? "On hold: blocked by a dependency" : `Put on hold: ${e.NewValue ?? ""}`.trim();
    case "release": return e.NewValue === "auto" ? "Resumed automatically" : e.NewValue === "blocked" ? "Dependency done, timer running" : "Resumed";
    case "acknowledge": return "Accepted";
    case "my_part_done": return "Marked their part done";
    case "reason": return `Reason given: ${e.NewValue ?? ""}`.trim();
    case "verdict": return `Decision: ${VERDICT_LABEL[e.NewValue] ?? e.NewValue ?? ""}`.trim();
    default: return e.Kind;
  }
}
