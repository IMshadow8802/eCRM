// Fixed words for the Today screens (spec §2). One place, so Mine, My team and
// the drawer say the same thing. Times are IST.
import { parseIst } from "../../utils/tatChip";

const fmt = (opts) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hourCycle: "h23", ...opts });
const HM = fmt({ hour: "2-digit", minute: "2-digit" });
const DAY = fmt({ day: "numeric", month: "short" });
const WD = fmt({ weekday: "short" });
export const hhmm = (v) => HM.format(parseIst(v));

export function durationText(min) {
  const h = Math.floor(min / 60);
  return h > 0 ? `${h}h ${min % 60}m` : `${min}m`;
}

export function timeLeftText(min) {
  if (min == null) return "No timer";
  if (min === 0) return "Due now";
  return min > 0 ? `${durationText(min)} left` : `Overdue ${durationText(-min)}`;
}

export function taskChip(task) {
  const f = task.flags || {};
  // A task done today shows its result even if it also missed: the miss is history, the finish is the news.
  if (f.done) {
    // my_part_done closes have no CompletedDate: say the result without a time
    const at = task.CompletedDate ? ` · ${hhmm(task.CompletedDate)}` : "";
    if (task.timer === "none") return { label: `Done${at}`, tone: "green" };
    return f.doneLate ? { label: `Late${at}`, tone: "amber" } : { label: `On time${at}`, tone: "green" };
  }
  if (f.reasonOwed) return { label: `Missed · ${DAY.format(parseIst(task.BreachedAt))}`, tone: "red" };
  if (f.overdue) return { label: timeLeftText(task.timeLeftMin), tone: "red" };
  if (f.onHold) return { label: task.HoldReason ? `On hold · ${task.HoldReason}` : "On hold", tone: "blue" };
  // Past days carry no live time left; show the due date rather than "No timer".
  const label = task.timeLeftMin == null && task.due ? `Due ${DAY.format(parseIst(task.due))}` : timeLeftText(task.timeLeftMin);
  return { label, tone: f.atRisk ? "amber" : "grey" };
}

export function presenceLine(person, live = true) {
  const { status = {} } = person;
  if (status.code === "not_tracked") return "Not tracked";
  if (["leave", "on_duty", "holiday"].includes(status.code)) return status.label;
  // Half-day leave keeps the session status and adds `half` (first_half | second_half).
  const half = status.half ? ` · Leave · ${status.half.replace("_", " ")}` : "";
  return baseLine(person, live) + half;
}

function baseLine({ status = {}, session, FirstSignInAt, ShiftStart, ShiftEnd, LastSeenAt, SignedOutAt }, live) {
  if (FirstSignInAt) {
    const parts = [`In ${hhmm(FirstSignInAt)}`];
    if (session) {
      parts.push(`online ${durationText(session.onlineMinutes)}`);
      const n = session.signIns;
      const dev = session.devices?.length ? ` (${session.devices.join(", ")})` : "";
      parts.push(`${n} sign-in${n === 1 ? "" : "s"}${dev}`);
    }
    if (status.code === "signed_out" && SignedOutAt) parts.push(`signed out ${hhmm(SignedOutAt)}`);
    return parts.join(" · ");
  }
  const parts = [];
  if (status.code === "not_signed_in_yet" && ShiftStart) {
    parts.push(`Shift starts ${hhmm(ShiftStart)}`);
    if (LastSeenAt) parts.push(`last seen ${WD.format(parseIst(LastSeenAt))} ${hhmm(LastSeenAt)}`);
    return parts.join(" · ");
  }
  if (ShiftStart && ShiftEnd) parts.push(`Shift ${hhmm(ShiftStart)}–${hhmm(ShiftEnd)}`);
  // A past day is not "today".
  const none = live ? "no sign-in today" : "no sign-in";
  parts.push(parts.length ? none : ShiftStart ? none[0].toUpperCase() + none.slice(1) : "Day off");
  if (LastSeenAt) parts.push(`last seen ${WD.format(parseIst(LastSeenAt))} ${hhmm(LastSeenAt)}`);
  return parts.join(" · ");
}

export const BUCKET_LABELS = {
  given: "Given today",
  open: "Open",
  working: "Working on",
  done: "Done today",
  overdue: "Overdue",
  atRisk: "Close to deadline",
  toRule: "Waiting for your ruling",
  reasonOwed: "Waiting for reason",
  dueToday: "Due today",
  notStarted: "Not started",
  onHold: "On hold",
};

const count = (k) => (p) => (p.counts?.[k] ?? 0) > 0;
export const TILES = [
  { key: "in", label: "In now", test: (p) => p.status?.code === "online" },
  { key: "notIn", label: "Not signed in", test: (p) => p.status?.code === "not_signed_in" },
  { key: "late", label: "Late", test: (p) => Boolean(p.status?.late) },
  { key: "away", label: "On leave / on duty", test: (p) => ["leave", "on_duty"].includes(p.status?.code) },
  { key: "overdue", label: "Overdue tasks", test: count("overdue") },
  { key: "atRisk", label: "Close to deadline", test: count("atRisk") },
  { key: "toRule", label: "Waiting for your ruling", test: count("toRule") },
];

// Live states: on a past day they are null and the drawer never opens for them (spec §1 "Past day").
export const LIVE_BUCKETS = new Set(["open", "working", "notStarted", "dueToday", "overdue", "atRisk", "onHold", "reasonOwed", "toRule"]);
// Tiles that read live state: blank on a past day, and a pick of one is dropped there.
export const LIVE_TILES = new Set(["in", "overdue", "atRisk", "toRule"]);
// "Given today" / "Done today" say "Given" / "Done" once the picked day is not today.
const PAST = { given: "Given", done: "Done" };
export const numberLabel = (k, live) => (live ? BUCKET_LABELS[k] : PAST[k] ?? BUCKET_LABELS[k]);
// The six numbers on a card and in the table, in order; tone colours a nonzero value.
export const NUMBERS = [
  { key: "given" }, { key: "open" }, { key: "working" }, { key: "done" },
  { key: "overdue", tone: "error" }, { key: "atRisk", tone: "warning" },
];

const FIXED = {
  not_signed_in: ["Not signed in", "error"],
  not_signed_in_yet: ["Not signed in yet", "default"],
  leave: ["On leave", "accent"],
  on_duty: ["On duty", "info"],
  holiday: ["Holiday", "info"],
  not_tracked: ["Not tracked", "default"],
  signed_out: ["Signed out", "default"],
};
const HINT = {
  online: "Online: the app is open and active right now.",
  offline: "Offline: signed in today, but the app is closed or has been quiet for a while.",
  signed_out: "Signed out: the person signed out on purpose.",
  not_signed_in_yet: "Not signed in yet: work has not started yet, or the 'count as late after' minutes are still running. This is fine for now.",
  not_signed_in: "Not signed in: work time has started and the person has not signed in today.",
  leave: "On leave: a manager marked this day as leave.",
  on_duty: "On duty: working away from the office. Counts as present.",
  holiday: "Holiday: the company is closed today, so nobody is expected to sign in.",
  not_tracked: "Not tracked: this person's sign-ins are not watched.",
};
const LATE_HINT = "Late: signed in after the 'count as late after' minutes that start when the shift starts.";

/** The fixed status word for a person: On time · Late Nm · Not signed in · … (spec §2.2). */
export function statusWord({ status, LateMinutes, FirstSignInAt, ShiftStart }) {
  if (!status) return { label: "", tone: "default" };
  const sessionWord = ["online", "offline", "signed_out"].includes(status.code);
  // lateness stays with the day, signed out included
  if (sessionWord && status.late) return { label: LateMinutes > 0 ? `Late ${durationText(LateMinutes)}` : status.late, tone: "warning", hint: LATE_HINT };
  const fixed = FIXED[status.code];
  if (fixed) return { label: fixed[0], tone: fixed[1], hint: HINT[status.code] };
  if (sessionWord) {
    // never "On time" without a sign-in: no shift = Day off, else plain Offline
    if (!FirstSignInAt) return ShiftStart ? { label: "Offline", tone: "default", hint: HINT.offline } : { label: "Day off", tone: "default", hint: "No shift today" };
    return { label: "On time", tone: "success", hint: HINT[status.code] };
  }
  return { label: status.label ?? "", tone: "default" };
}
