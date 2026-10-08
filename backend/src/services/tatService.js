// src/services/tatService.js
//
// Task TAT due times (spec §6). SQL decides which clocks exist (sp_TatReconcile)
// and stamps warn/breach (sp_TatSweep); this file computes every DueAt/WarnAt
// with workCalendar.js and writes them back through sp_TatApplyDue.
// A TAT failure never fails the task write that triggered it.

const database = require("../config/database");
const calendarContext = require("./calendarContext");
const {
  DEFAULT_DAYS, addWorkingMinutes, workingMinutesBetween, endOfShift, at, warnAt, toSqlIst, dateKey, addDays,
} = require("../utils/workCalendar");

const pad = (n) => String(n).padStart(2, "0");
const rows = (result, i = 0) => result?.recordsets?.[i] ?? [];
const DEFAULT_CTX = { days: DEFAULT_DAYS, holidays: new Set(), marks: new Map() };
const RETRO_MIN = 30;
const REOPEN_MIN = 60;
// Fields of sp_SaveTask's RS3 that move a target.
const TARGET_FIELDS = new Set(["Priority", "DueDate", "DueTime", "TatMinutes"]);

// node-mssql runs with useUTC:false, so DATE and TIME come back built from LOCAL
// components (DATE = local midnight, TIME = 1970-01-01 local). Strings are accepted too.
const dueDateKey = (v) => (v instanceof Date ? `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}` : String(v).slice(0, 10));
const minutesOf = (v) => {
  if (v instanceof Date) return v.getHours() * 60 + v.getMinutes();
  const [h, m] = String(v).split(":").map(Number);
  return h * 60 + m;
};
const t = (d) => (d ? new Date(d).getTime() : null);

/** Pure. One clock (an sp_TatReconcile RS1 row + warnPct) → its due/warn times. */
function computeDue(clock, ctx, now) {
  let anchor;
  let target;
  let held = Number(clock.HeldMinutes) || 0;
  if (clock.StaleKind === "reopen") {
    const remaining = clock.DueAt && clock.LastClosedAt && t(clock.DueAt) > t(clock.LastClosedAt)
      ? workingMinutesBetween(new Date(clock.LastClosedAt), new Date(clock.DueAt), ctx) : 0;
    target = Math.max(REOPEN_MIN, remaining);
    anchor = new Date(clock.ReopenedAt);
    held = 0;
  } else if (clock.ReopenedAt) {
    anchor = new Date(clock.AnchorAt); // the reopen anchor stands
    target = clock.TargetMinutes;
  } else {
    anchor = new Date(clock.AssignedAt);
    target = clock.TaskTatMinutes ?? (clock.DueDate ? null : clock.PolicyMinutes);
  }

  let due;
  if (target != null) {
    due = addWorkingMinutes(anchor, Number(target) + held, ctx);
  } else {
    const key = dueDateKey(clock.DueDate);
    const base = clock.DueTime != null && clock.DueTime !== "" ? at(key, minutesOf(clock.DueTime)) : endOfShift(key, ctx);
    due = addWorkingMinutes(base, held, ctx);
  }
  // Never breached retroactively: a change that puts the due time behind us gives 30 working minutes.
  if (clock.StaleKind !== "assign" && !clock.BreachedAt && due.getTime() <= now.getTime()) {
    due = addWorkingMinutes(now, RETRO_MIN, ctx);
  }
  const warn = due.getTime() <= anchor.getTime() ? due : warnAt(anchor, due, Number(clock.warnPct ?? 80), ctx);
  return { DueAt: due, WarnAt: warn, AnchorAt: anchor, TargetMinutes: target ?? null, HeldMinutes: held };
}

/** Reconcile (one task or the whole company), then compute and apply every stale clock. */
async function processPending(compId, taskId = null, now = new Date()) {
  const result = await database.executeStoredProcedure("sp_TatReconcile", { CompId: compId, TaskId: taskId });
  const clocks = rows(result, 0);
  const allHolds = rows(result, 1);
  if (!clocks.length) return { updated: 0 };

  const byId = new Map(clocks.map((c) => [Number(c.Id), { ...c, HeldMinutes: Number(c.HeldMinutes) || 0 }]));
  // Every hold-ending proc marks its clock stale, so its clock is in RS1; a hold that is not waits.
  const holds = allHolds.filter((h) => byId.has(Number(h.TatId)));

  const stamps = [...clocks.flatMap((c) => [c.AssignedAt, c.AnchorAt, c.ReopenedAt, c.LastClosedAt]), ...holds.map((h) => h.StartedAt)]
    .filter(Boolean).map((d) => new Date(d).getTime());
  const fromKey = addDays(dateKey(new Date(Math.min(now.getTime(), ...stamps))), -1);
  const dueKeys = clocks.filter((c) => c.DueDate).map((c) => dueDateKey(c.DueDate));
  const toKey = [addDays(dateKey(now), 120), ...dueKeys.map((k) => addDays(k, 1))].sort().pop();
  const userIds = [...new Set(clocks.map((c) => Number(c.UserId)))];
  const [info, settings] = await Promise.all([
    calendarContext.load(compId, userIds, fromKey, toKey),
    calendarContext.settings(compId),
  ]);
  const ctxOf = (userId) => info.get(Number(userId))?.ctx ?? DEFAULT_CTX;

  // At most one open hold per clock, so spans never overlap and sum directly.
  const holdMins = holds.map((h) => {
    const mins = workingMinutesBetween(new Date(h.StartedAt), new Date(h.EndedAt), ctxOf(h.UserId));
    byId.get(Number(h.TatId)).HeldMinutes += mins;
    return { HoldId: Number(h.HoldId), TatId: Number(h.TatId), HeldMinutes: mins };
  });

  const items = [];
  for (const c of byId.values()) {
    try {
      const d = computeDue({ ...c, warnPct: settings?.warnPct }, ctxOf(c.UserId), now);
      items.push({
        Id: Number(c.Id), DueAt: toSqlIst(d.DueAt), WarnAt: toSqlIst(d.WarnAt), AnchorAt: toSqlIst(d.AnchorAt),
        TargetMinutes: d.TargetMinutes, HeldMinutes: d.HeldMinutes, Kind: c.StaleKind, StaleSeq: c.StaleSeq,
      });
    } catch (err) {
      // ponytail: a calendar with no working time leaves the clock stale; it is retried (and logged) every pass.
      console.error(`TAT_COMPUTE: clock ${c.Id} skipped:`, err.message);
    }
  }
  // A hold is applied only with its clock, or its minutes would be marked applied and lost.
  const done = new Set(items.map((i) => i.Id));
  const holdItems = holdMins.filter((h) => done.has(h.TatId)).map(({ HoldId, HeldMinutes }) => ({ HoldId, HeldMinutes }));
  const applied = await database.executeStoredProcedure("sp_TatApplyDue", {
    CompId: compId, ItemsJson: JSON.stringify(items), HoldsJson: JSON.stringify(holdItems),
  });
  const status = rows(applied)[0];
  if (Number(status?.ResponseCode) !== 200) console.error("TAT_APPLY failed:", status?.ResponseMess);
  return { updated: Number(status?.Updated) || 0 };
}

/**
 * Worked minutes for closed clocks (P4): working time from AnchorAt (or AssignedAt)
 * to ClosedAt less HeldMinutes and any ended holds not yet applied (RS2), never negative. sp_TatReconcile clears WorkMinutes
 * when a clock reopens, so it is recomputed here on its next close. Never throws.
 */
async function processWork(compId) {
  try {
    const pending = await database.executeStoredProcedure("sp_TatPendingWork", { CompId: compId });
    const clocks = rows(pending);
    if (!clocks.length) return { updated: 0 };
    const holds = rows(pending, 1); // ended holds not yet folded into HeldMinutes
    const startOf = (c) => new Date(c.AnchorAt ?? c.AssignedAt);
    const fromKey = addDays(dateKey(new Date(Math.min(...clocks.map((c) => startOf(c).getTime())))), -1);
    const toKey = dateKey(new Date(Math.max(...clocks.map((c) => t(c.ClosedAt)))));
    const info = await calendarContext.load(compId, [...new Set(clocks.map((c) => Number(c.UserId)))], fromKey, toKey);
    const items = clocks.map((c) => {
      const ctx = info.get(Number(c.UserId))?.ctx ?? DEFAULT_CTX;
      const unapplied = holds.filter((h) => Number(h.TatId) === Number(c.Id))
        .reduce((n, h) => n + workingMinutesBetween(new Date(h.StartedAt), new Date(h.EndedAt), ctx), 0);
      const worked = workingMinutesBetween(startOf(c), new Date(c.ClosedAt), ctx) - (Number(c.HeldMinutes) || 0) - unapplied;
      return { Id: Number(c.Id), WorkMinutes: Math.max(0, worked) };
    });
    const status = rows(await database.executeStoredProcedure("sp_TatApplyWork", { CompId: compId, ItemsJson: JSON.stringify(items) }))[0];
    if (Number(status?.ResponseCode) !== 200) console.error("TAT_WORK_APPLY failed:", status?.ResponseMess);
    return { updated: Number(status?.Updated) || 0 };
  } catch (err) {
    console.error("TAT_WORK skipped:", err.message);
    return { updated: 0 };
  }
}

/** After a task write: mark the task's clocks stale when a target moved, then reconcile it. Never throws. */
async function afterTaskWrite(req, taskId, { changed } = {}) {
  try {
    const CompId = req.user.CompId;
    if ((changed ?? []).some((c) => TARGET_FIELDS.has(c.Field))) {
      await database.executeStoredProcedure("sp_TatMarkStale", { CompId, TaskId: taskId, UserId: null, Kind: "change" });
    }
    await processPending(CompId, taskId);
  } catch (err) {
    console.error("TAT_AFTER_WRITE skipped:", err.message);
  }
}

/** The caller's first act on a task acknowledges their clock. Never throws. */
async function acknowledge(req, taskId) {
  try {
    await database.executeStoredProcedure("sp_TatAcknowledge", { CompId: req.user.CompId, TaskId: taskId, UserId: req.user.UserId });
  } catch (err) {
    console.error("TAT_ACK skipped:", err.message);
  }
}

/** The caller's breached clock on this task still owing a reason, or null. Never throws. */
async function reasonNeeded(req, taskId) {
  try {
    const result = await database.executeStoredProcedure("sp_FetchTaskTat", { CompId: req.user.CompId, TaskId: taskId });
    const mine = rows(result).find((c) => Number(c.UserId) === Number(req.user.UserId)
      && c.BreachedAt && c.BreachReasonId == null && c.Verdict == null);
    return mine ? Number(mine.Id) : null;
  } catch (err) {
    console.error("TAT_REASON_LOOKUP skipped:", err.message);
    return null;
  }
}

module.exports = { computeDue, processPending, processWork, afterTaskWrite, acknowledge, reasonNeeded };
