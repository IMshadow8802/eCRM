// src/jobs/sweep.js
//
// The 60 s background sweep: per live company, end expired sessions, raise
// "not signed in" once grace has passed, then run the TAT step.
// One timer per process; one container per client, so no cross-process lock.

const database = require("../config/database");
const calendarContext = require("../services/calendarContext");
const sessionService = require("../services/sessionService");
const tatService = require("../services/tatService");
const { emitToUser } = require("../realtime/events");
const { SCOPES } = require("../realtime/contract");
const { currentShift, effectiveStart, dateKey } = require("../utils/workCalendar");

const rows = (result, i = 0) => result?.recordsets?.[i] ?? [];

async function expireSessions(compId) {
  const ended = rows(await database.executeStoredProcedure("sp_PresenceSweep", { CompId: compId }));
  for (const r of ended) sessionService.forget(r.SessionId);
  return ended.length;
}

async function notSignedIn(compId, now) {
  const today = dateKey(now);
  const candidates = rows(await database.executeStoredProcedure("sp_FetchPresenceCandidates", { CompId: compId, WorkDate: today }));
  if (!candidates.length) return 0;
  const { lateGraceMin } = await calendarContext.settings(compId);
  const byUser = await calendarContext.load(compId, candidates.map((c) => Number(c.UserId)), today, today);
  let marked = 0;
  for (const c of candidates) {
    const info = byUser.get(Number(c.UserId));
    if (!info || info.presenceExempt) continue;
    // ponytail: only today's shift is checked; a night shift that began yesterday is not re-checked.
    const shift = currentShift(now, info.days);
    if (!shift || shift.workDate !== today) continue;
    if (info.ctx.marks.get(today)?.kind === "on_duty") continue;
    const start = effectiveStart(today, info.ctx); // null on holiday / full leave
    if (!start || now.getTime() < start.getTime() + lateGraceMin * 60000) continue;
    // Created after the shift began (a mid-day hire): nothing to sign in for yet today.
    if (c.CreatedDate && new Date(c.CreatedDate).getTime() >= start.getTime()) continue;
    // One person's failure (a deadlock, a bad row) must not skip everyone after them.
    try {
      const res = await database.executeStoredProcedure("sp_MarkNotSignedIn", {
        CompId: compId, UserId: Number(c.UserId), WorkDate: today,
        ShiftStart: shift.start, ShiftEnd: shift.end, BranchId: c.BranchId ?? null,
      });
      if (rows(res)[0]?.Inserted) marked++;
      for (const n of rows(res, 1)) emitToUser(n.UserId, SCOPES.NOTIFICATIONS);
    } catch (err) {
      console.error(`[sweep] company ${compId} user ${c.UserId} not-signed-in failed:`, err.message);
    }
  }
  return marked;
}

// Fill missing/stale due times (whole company), worked minutes of closed clocks, then warn, breach and auto-release.
async function tatStep(compId, now) {
  await tatService.processPending(compId, null, now);
  await tatService.processWork(compId); // never throws
  const notified = rows(await database.executeStoredProcedure("sp_TatSweep", { CompId: compId }));
  for (const id of new Set(notified.map((r) => Number(r.UserId)))) emitToUser(id, SCOPES.NOTIFICATIONS);
}

async function runOnce(now = new Date()) {
  const companies = rows(await database.executeStoredProcedure("sp_FetchLiveCompanies", {}));
  let expired = 0;
  let marked = 0;
  // Each step has its own try: a presence error must never silence the TAT step (or vice versa).
  const step = async (CompId, name, fn) => {
    try { return (await fn()) ?? 0; } catch (err) { console.error(`[sweep] company ${CompId} ${name} failed:`, err.message); return 0; }
  };
  for (const { CompId } of companies) {
    expired += await step(CompId, "expireSessions", () => expireSessions(CompId));
    marked += await step(CompId, "notSignedIn", () => notSignedIn(CompId, now));
    await step(CompId, "tat", () => tatStep(CompId, now));
  }
  return { companies: companies.length, expired, notSignedIn: marked };
}

function start() {
  if (process.env.NODE_ENV === "test" || process.env.SWEEP_DISABLED === "1") return () => {};
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runOnce(); } catch (err) { console.error("[sweep] run failed:", err.message); } finally { running = false; }
  };
  const first = setTimeout(tick, 5000);
  const timer = setInterval(tick, 60000);
  return () => { clearTimeout(first); clearInterval(timer); };
}

module.exports = { runOnce, start, tatStep };
