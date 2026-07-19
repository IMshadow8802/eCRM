// src/realtime/events.js
//
// Invalidation emit helpers. Events carry INVALIDATIONS, never data — the
// payload is only { scope, workspaceId?, taskId? }; clients refetch via REST.
// Both helpers are safe no-ops when the socket server isn't initialized
// (unit tests, scripts).
const { EVENT_INVALIDATE, rooms } = require("./contract");
const { getIo } = require("./socket");

function emitToWorkspace(workspaceId, scope, extra = {}) {
  const io = getIo();
  if (!io || !workspaceId) return;
  io.to(rooms.workspace(workspaceId)).emit(EVENT_INVALIDATE, {
    scope,
    ...extra,
  });
}

function emitToUser(userId, scope, extra = {}) {
  const io = getIo();
  if (!io || !userId) return;
  io.to(rooms.user(userId)).emit(EVENT_INVALIDATE, { scope, ...extra });
}

module.exports = { emitToWorkspace, emitToUser };
