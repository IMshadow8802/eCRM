// src/controllers/presenceController.js
//
// Presence (spec P2): heartbeat, the first-sign-in notice, who is in today,
// and the admin's session list / "end session". Status words are fixed by the
// spec's copy rules: Online · Offline · Signed out · Not signed in yet ·
// Late by n min · On leave · On duty · Holiday.

const database = require("../config/database");
const calendarContext = require("../services/calendarContext");
const sessionService = require("../services/sessionService");
const { visibleUserIds } = require("./workSettingsController");
const { emitToUser } = require("../realtime/events");
const { getIo } = require("../realtime/socket");
const { SCOPES, rooms } = require("../realtime/contract");
const { dateKey, at, effectiveStart, lateMinutes } = require("../utils/workCalendar");
const { success, validationError } = require("../utils/responseHelper");
const { asyncRoute, firstRow, spStatus, spOk, spMessage, positiveInt } = require("../utils/controllerKit");

const KEY = /^\d{4}-\d{2}-\d{2}$/;
const ONLINE_MS = 5 * 60000; // heartbeat is every 2 min; two missed = offline
const truthy = (v) => v === true || v === 1;

/**
 * One person's status for a day. Pure. `row` is an sp_FetchPresence row whose
 * ShiftStart may be filled from the calendar when no presence row exists yet.
 * Half-day leave keeps the session-based status and adds `half`.
 */
function presenceStatus(row, now, settings, holidayToday) {
  if (holidayToday) return { code: "holiday", label: "Holiday" };
  if (row.MarkKind === "leave" && row.MarkPart === "full") return { code: "leave", label: "On leave" };
  if (row.MarkKind === "on_duty") return { code: "on_duty", label: "On duty" };
  const half = row.MarkKind === "leave" ? { half: row.MarkPart } : {};
  const grace = Number(settings?.lateGraceMin) || 0;

  // Lateness stays with the day once signed in, whatever the session does after.
  const late = row.FirstSignInAt && Number(row.LateMinutes) > grace ? { late: `Late by ${Number(row.LateMinutes)} min` } : {};
  if (truthy(row.HasOpenSession) && row.LastSeenAt && now.getTime() - new Date(row.LastSeenAt).getTime() <= ONLINE_MS) {
    return { code: "online", label: "Online", ...late, ...half };
  }
  // an open session outranks an earlier sign-out (signed out, then signed in again)
  if (row.SignedOutAt && !truthy(row.HasOpenSession)) return { code: "signed_out", label: "Signed out", ...late, ...half };
  if (row.FirstSignInAt) return { code: "offline", label: "Offline", ...late, ...half };
  // ponytail: no shift that day (day off, exempt) has no "not signed in" — Offline is the neutral word
  if (!row.ShiftStart) return { code: "offline", label: "Offline", ...half };
  if (now.getTime() < new Date(row.ShiftStart).getTime() + grace * 60000) {
    return { code: "not_signed_in_yet", label: "Not signed in yet", ...half };
  }
  return { code: "not_signed_in", label: "Not signed in", ...half };
}

/**
 * An sp_FetchPresence row for `key` with its status. `u` = the person's calendarContext entry (may be missing).
 * Shift start comes from the calendar when no row exists yet; LateMinutes is re-derived from the CURRENT
 * marks (a half-day leave saved after sign-in clears the morning), the stored value only without a calendar;
 * only today can be Online (an open session is about now).
 */
function withStatus(r, u, key, now, settings) {
  const ShiftStart = r.ShiftStart ?? (u ? effectiveStart(key, u.ctx) : null);
  const LateMinutes = u && r.FirstSignInAt ? lateMinutes(r.FirstSignInAt, key, u.ctx) : r.LateMinutes;
  const asOf = { ...r, ShiftStart, LateMinutes, HasOpenSession: key === dateKey(now) && r.HasOpenSession };
  return { ...r, LateMinutes, status: presenceStatus(asOf, now, settings, !!u?.ctx.holidays.has(key)) };
}

const reply = (res, row, data = null) => {
  const ok = spOk(row);
  return res.status(spStatus(row)).json({
    success: ok, message: spMessage(row), responseCode: spStatus(row),
    data: ok ? data : null, timestamp: new Date().toISOString(),
  });
};

class PresenceController {
  heartbeat = asyncRoute(
    async (req, res) => {
      const { expiresAt } = await sessionService.touch(req.user.Sid, req.user);
      return success(res, "Session refreshed", { expiresAt: expiresAt ? expiresAt.toISOString() : null });
    },
    "Failed to refresh session",
    "HEARTBEAT_ERROR",
  );

  ackNotice = asyncRoute(
    async (req, res) => {
      const result = await database.executeStoredProcedure("sp_AckPresenceNotice", {
        UserId: req.user.UserId, CompId: req.user.CompId,
      });
      return reply(res, firstRow(result));
    },
    "Failed to acknowledge the notice",
    "PRESENCE_NOTICE_ERROR",
  );

  fetchPresence = asyncRoute(
    async (req, res) => {
      const { WorkDate, UserIds } = req.body;
      const now = new Date();
      const key = WorkDate ? String(WorkDate).slice(0, 10) : dateKey(now);
      if (!KEY.test(key)) return validationError(res, "Date must be YYYY-MM-DD");
      const asked = (Array.isArray(UserIds) ? UserIds : []).map(positiveInt).filter(Boolean);
      const allowed = await visibleUserIds(req, asked);
      const mine = [...new Set([...(req.access?.teamOwners ?? []), Number(req.user.UserId)])];
      const ids = asked.length ? (allowed === null ? asked : asked.filter((i) => allowed.includes(i))) : mine;
      if (!ids.length) return success(res, "Presence fetched", { presence: [] });

      const CompId = req.user.CompId;
      const result = await database.executeStoredProcedure("sp_FetchPresence", {
        CompId, WorkDate: at(key, 0), UserIdsJson: JSON.stringify(ids),
      });
      const rows = result?.recordsets?.[0] ?? [];
      if (!rows.length) return success(res, "Presence fetched", { presence: [] });
      const [info, settings] = await Promise.all([calendarContext.load(CompId, ids, key, key), calendarContext.settings(CompId)]);
      const presence = rows.map((r) => withStatus(r, info.get(Number(r.UserId)), key, now, settings));
      return success(res, "Presence fetched", { presence });
    },
    "Failed to fetch presence",
    "PRESENCE_FETCH_ERROR",
  );

  fetchSessions = asyncRoute(
    async (req, res) => {
      const userId = positiveInt(req.body.UserId);
      if (!userId) return validationError(res, "User is required");
      const result = await database.executeStoredProcedure("sp_FetchSessions", { CompId: req.user.CompId, UserId: userId });
      return success(res, "Sessions fetched", { sessions: result?.recordsets?.[0] ?? [] });
    },
    "Failed to fetch sessions",
    "SESSIONS_FETCH_ERROR",
  );

  endSession = asyncRoute(
    async (req, res) => {
      const userId = positiveInt(req.body.UserId);
      if (!userId) return validationError(res, "User is required");
      if (userId === Number(req.user.UserId)) return validationError(res, "Use sign out to end your own session");
      const ended = await sessionService.endUser(userId, req.user.CompId, "forced");
      // Tell the open tabs why, then drop their sockets (a reconnect is refused SESSION_FORCED).
      emitToUser(userId, SCOPES.SESSION, { reason: "SESSION_FORCED" });
      getIo()?.in(rooms.user(userId)).disconnectSockets(true);
      return success(res, "Session ended", { ended: ended.length });
    },
    "Failed to end the session",
    "SESSION_END_ERROR",
  );
}

const controller = new PresenceController();
module.exports = controller;
module.exports.presenceStatus = presenceStatus;
module.exports.withStatus = withStatus;
