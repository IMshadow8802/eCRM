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

// "08 Oct 2026, 17:30 IST" — for the TAT tab's timeline.
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

export const TAT_ICON = { ok: Clock, warn: AlertTriangle, over: AlertOctagon, held: PauseCircle };

export function tatChip(task, now = new Date()) {
  if (!task || (!task.TatDueAt && !task.TatHeldSince)) return null;
  const tone = (t, text) => ({ tone: t, text, icon: TAT_ICON[t] });
  if (task.TatHeldSince) return tone("held", `On hold: ${task.TatHoldReason || "Blocked"}`);
  const due = toDate(task.TatDueAt);
  // Over is judged on the current due only: a reopen keeps BreachedAt (on record server-side)
  // but sets a fresh due, and the chip shows that one.
  if (now > due) {
    return tone("over", `Over by ${overBy(now - due)}`);
  }
  const warnAt = toDate(task.TatWarnAt);
  return tone(warnAt && warnAt <= now ? "warn" : "ok", `Due ${istShort(due, now)}`);
}

export const VERDICT_LABEL = { excused: "Excused", not_excused: "Not excused" };

// One line per tblTaskTatEvent row. A due move (any Kind) carries old -> new
// wall-clock values; the rest are plain facts.
export function eventText(e) {
  if (isWallClock(e.NewValue)) {
    const now = parseIst(e.NewValue);
    return e.OldValue
      ? `Target changed ${istShort(e.OldValue, now).replace(" IST", "")} → ${istShort(e.NewValue, now)}`
      : `Due set to ${istShort(e.NewValue, now)}`;
  }
  switch (e.Kind) {
    case "assign": return "Assigned";
    case "reopen": return "Reopened";
    case "resume": return "Clock resumed";
    case "hold": return e.NewValue === "blocked" ? "On hold: blocked by a dependency" : `Put on hold: ${e.NewValue ?? ""}`.trim();
    case "release": return e.NewValue === "auto" ? "Hold released automatically" : e.NewValue === "blocked" ? "Dependency done, clock running" : "Hold released";
    case "acknowledge": return "Acknowledged";
    case "my_part_done": return "Marked their part done";
    case "reason": return `Reason given: ${e.NewValue ?? ""}`.trim();
    case "verdict": return `Verdict: ${VERDICT_LABEL[e.NewValue] ?? e.NewValue ?? ""}`.trim();
    default: return e.Kind;
  }
}
