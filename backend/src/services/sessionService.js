// src/services/sessionService.js
//
// Server-side sessions (spec D7). The JWT carries a session id (Sid); every
// request checks that session is still open. One row per sign-in in
// tblUserSession; the sign-in is also the day's check-in (tblPresenceDay).
//
// check() is cached per process for 60 s, so a session ended on ANOTHER
// container is noticed within a minute. Logout and a forced end on this
// container forget() the entry, so they bite at once. One container per
// client today (CLAUDE.md §8), so in practice every end is local.

const crypto = require("crypto");
const database = require("../config/database");
const calendarContext = require("./calendarContext");
const { firstRow, spOk, spMessage } = require("../utils/controllerKit");
const {
  DEFAULT_DAYS, currentShift, sessionExpiry, extendExpiry, effectiveStart, dateKey, addDays, at,
} = require("../utils/workCalendar");

const TTL_MS = 60000;
const PRUNE_AT = 5000; // ponytail: prune by scan when large; an LRU only if this ever shows up in a profile
const cache = new Map(); // sid (lower case) -> { at, row }

// SQL returns UNIQUEIDENTIFIER upper case; randomUUID is lower case.
const keyOf = (sid) => String(sid).toLowerCase();
const truthy = (v) => v === true || v === 1;
const dayKeyOf = (v) => (v instanceof Date ? dateKey(v) : String(v).slice(0, 10));

function remember(sid, row) {
  if (cache.size >= PRUNE_AT) {
    const now = Date.now();
    for (const [k, v] of cache) if (now - v.at >= TTL_MS) cache.delete(k);
  }
  cache.set(keyOf(sid), { at: Date.now(), row });
}

const forget = (sid) => cache.delete(keyOf(sid));
const clearCache = () => cache.clear();

// The user's shift days + context for "now" (yesterday covers a night shift still running).
async function userCalendar(compId, userId, now) {
  const today = dateKey(now);
  const info = (await calendarContext.load(compId, [userId], addDays(today, -1), today)).get(Number(userId));
  return { info, days: info?.days ?? DEFAULT_DAYS };
}

async function start({ req, user, device }) {
  const now = new Date();
  const sessionId = crypto.randomUUID();
  const { UserId, CompId } = user;
  const { info, days } = await userCalendar(CompId, UserId, now);
  const settings = await calendarContext.settings(CompId);

  const shift = currentShift(now, days);
  const live = settings.goLiveDate ? dayKeyOf(settings.goLiveDate) : null;
  let presence = { WorkDate: null, ShiftStart: null, ShiftEnd: null, LateMinutes: null, ManagerId: null };
  if (shift && info && !info.presenceExempt && live && live <= shift.workDate) {
    const begins = effectiveStart(shift.workDate, info.ctx);
    const mgr = await database.executeStoredProcedure("sp_FetchPersonManagers", { UserId, CompId });
    presence = {
      WorkDate: at(shift.workDate, 0),
      ShiftStart: shift.start,
      ShiftEnd: shift.end,
      LateMinutes: begins ? Math.max(0, Math.floor((now.getTime() - begins.getTime()) / 60000)) : 0,
      ManagerId: (mgr?.recordsets?.[0] ?? []).find((r) => r.Source === "manager")?.UserId ?? null,
    };
  }

  const expiresAt = sessionExpiry(now, days, settings.sessionBufferMin);
  const ua = req.headers?.["user-agent"];
  const result = await database.executeStoredProcedure("sp_StartSession", {
    SessionId: sessionId,
    CompId,
    UserId,
    Device: (device ?? req.body?.Device) === "mobile" ? "mobile" : "web",
    Ip: req.headers?.["x-real-ip"] || req.ip || null,
    UserAgent: ua ? String(ua).slice(0, 300) : null,
    ExpiresAt: expiresAt,
    ...presence,
    BranchId: info?.branchId ?? user.BranchId ?? null,
  });
  const row = firstRow(result);
  if (!spOk(row)) throw new Error(spMessage(row, "Session could not be started"));

  remember(sessionId, { UserId, CompId, ExpiresAt: expiresAt, EndedAt: null, EndReason: null });
  return { sessionId, expiresAt, showNotice: truthy(row.ShowNotice) };
}

async function readRow(sid) {
  const hit = cache.get(keyOf(sid));
  if (hit && Date.now() - hit.at < TTL_MS) return hit.row;
  const row = firstRow(await database.executeStoredProcedure("sp_CheckSession", { SessionId: sid }));
  remember(sid, row);
  return row;
}

// Expiry is judged on the clock every time, so a cached row cannot outlive ExpiresAt.
function verdict(row) {
  if (!row) return { ok: false, code: "SESSION_ENDED" };
  if (row.EndReason === "forced") return { ok: false, code: "SESSION_FORCED" };
  if (row.EndReason === "expired") return { ok: false, code: "SESSION_EXPIRED" };
  if (row.EndedAt || row.EndReason) return { ok: false, code: "SESSION_ENDED" };
  if (new Date(row.ExpiresAt).getTime() < Date.now()) return { ok: false, code: "SESSION_EXPIRED" };
  return { ok: true, userId: row.UserId };
}

const check = async (sid) => verdict(await readRow(sid));

// Heartbeat: extend while in use, never into the next shift (workCalendar.extendExpiry).
async function touch(sid, user) {
  const row = await readRow(sid);
  if (!verdict(row).ok) return { expiresAt: null };
  const now = new Date();
  const { days } = await userCalendar(user.CompId, user.UserId, now);
  const { sessionBufferMin } = await calendarContext.settings(user.CompId);
  const expiresAt = extendExpiry(new Date(row.ExpiresAt), now, days, sessionBufferMin);
  const r = firstRow(await database.executeStoredProcedure("sp_TouchSession", { SessionId: sid, ExpiresAt: expiresAt }));
  if (truthy(r?.Touched)) remember(sid, { ...row, ExpiresAt: expiresAt });
  else forget(sid);
  return { expiresAt };
}

// Both procs answer a failure as a status row, not a throw: a 200 here while
// the session stays open would be a logout that did nothing. The cache entry
// is dropped either way, so the next check re-reads the truth.
async function end(sid, reason, compId = null) {
  const result = await database.executeStoredProcedure("sp_EndSession", { SessionId: sid, Reason: reason, CompId: compId });
  forget(sid);
  const row = firstRow(result);
  if (!spOk(row)) throw new Error(spMessage(row, "Session could not be ended"));
  return row;
}

// RS1 is the ended SessionId rows (none = nothing open); a ResponseCode row is a failure.
async function endUser(userId, compId, reason) {
  const result = await database.executeStoredProcedure("sp_EndUserSessions", { UserId: userId, CompId: compId, Reason: reason });
  const rows = result?.recordsets?.[0] ?? [];
  if (rows[0]?.ResponseCode != null && !spOk(rows[0])) throw new Error(spMessage(rows[0], "Sessions could not be ended"));
  const ids = rows.map((r) => r.SessionId);
  ids.forEach(forget);
  return ids;
}

module.exports = { start, check, touch, end, endUser, forget, clearCache, _cacheSize: () => cache.size };
