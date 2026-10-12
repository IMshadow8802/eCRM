// src/utils/dayBuckets.js
//
// Today (spec §1): one sp_FetchDayTasks row → the flags every Today number counts.
// Mine, My team and the drawer all go through describeTask, so they cannot disagree.

const { dateKey, at, workIntervals, workingMinutesBetween } = require("./workCalendar");

const LIVE = ["open", "working", "notStarted", "dueToday", "overdue", "atRisk", "onHold", "reasonOwed", "toRule"];
const BUCKETS = ["given", "done", "doneLate", ...LIVE];
const asDate = (v) => (v == null ? null : v instanceof Date ? v : new Date(v));
const inDay = (v, key) => v != null && dateKey(asDate(v)) === key;
const hm = (s) => { const [h, m] = String(s).split(":").map(Number); return h * 60 + m; };

/** The moment a task is due: the open clock's DueAt, else DueDate + DueTime / end of shift / 23:59. */
function dueMoment(row, ctx) {
  if (row.TatId && !row.ClosedAt && row.DueAt) return asDate(row.DueAt);
  if (!row.DueDate) return null;
  const key = dateKey(asDate(row.DueDate));
  if (row.DueTime) return at(key, hm(row.DueTime));
  const iv = workIntervals(key, ctx); // that day only: a day off is due 23:59, not the last shift end
  return iv.length ? iv[iv.length - 1][1] : at(key, 23 * 60 + 59);
}

function minutesLeft(due, now, clock, ctx) {
  if (!due) return null;
  if (!clock) return Math.round((due - now) / 60000);
  return due >= now ? workingMinutesBetween(now, due, ctx) : -workingMinutesBetween(due, now, ctx);
}

function describeTask(row, { key, now, ctx, live }) {
  const clockOpen = Boolean(row.TatId) && !row.ClosedAt;
  const partDone = row.CloseReason === "my_part_done" && Boolean(row.ClosedAt);
  const open = !row.IsCompleted && !partDone;
  const due = dueMoment(row, ctx);
  const done = inDay(row.CompletedDate, key) || (partDone && inDay(row.ClosedAt, key));
  const liveFlag = (v) => Boolean(live && v);
  const working = open && (Boolean(row.AcknowledgedAt) || Number(row.StepsDone) > 0);
  const flags = {
    given: inDay(row.AssignedAt, key),
    done,
    doneLate: done && Boolean(row.BreachedAt),
    open: liveFlag(open),
    working: liveFlag(working),
    notStarted: liveFlag(open && !working),
    dueToday: liveFlag(open && due && dateKey(due) === key),
    overdue: liveFlag(open && (clockOpen ? Boolean(row.BreachedAt) : Boolean(due) && due < now)),
    atRisk: liveFlag(open && clockOpen && row.WarnedAt && !row.BreachedAt),
    onHold: liveFlag(open && clockOpen && row.HeldSince),
    reasonOwed: liveFlag(row.BreachedAt && row.BreachReasonId == null && row.Verdict == null),
    toRule: liveFlag(row.BreachedAt && row.BreachReasonId != null && row.Verdict == null && row.ViewerCanRule),
  };
  return {
    TaskId: row.TaskId, TatId: row.TatId ?? null, Title: row.Title, WorkspaceId: row.WorkspaceId,
    WorkspaceName: row.WorkspaceName, AssignedByName: row.AssignedByName ?? null, Priority: row.Priority ?? null,
    StepsTotal: Number(row.StepsTotal) || 0, StepsDone: Number(row.StepsDone) || 0,
    HoldReason: row.HoldReason ?? null, CompletedDate: row.CompletedDate ?? null, BreachedAt: row.BreachedAt ?? null,
    due, timer: row.TatId ? "clock" : "none",
    timeLeftMin: live && open ? minutesLeft(due, now, clockOpen, ctx) : null,
    flags,
  };
}

function countTasks(described, { live }) {
  const out = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
  for (const t of described) for (const b of BUCKETS) if (t.flags[b]) out[b] += 1;
  if (!live) for (const b of LIVE) out[b] = null;
  return out;
}

const NOT_IN = new Set(["not_signed_in"]); // presenceStatus: lateness is status.late (a string), not a code
function rankPeople(people) {
  const score = (p) => [
    (p.counts?.overdue ?? 0) > 0 ? 0 : 1,
    (p.counts?.toRule ?? 0) > 0 ? 0 : 1,
    NOT_IN.has(p.status?.code) ? 0 : 1,
    p.status?.late ? 0 : 1,
    (p.counts?.atRisk ?? 0) > 0 ? 0 : 1,
  ];
  return [...people].sort((a, b) => {
    const x = score(a), y = score(b);
    for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
    return String(a.FullName).localeCompare(String(b.FullName));
  });
}

module.exports = { BUCKETS, LIVE, dueMoment, describeTask, countTasks, rankPeople };
