// src/realtime/socket.js
//
// Realtime layer — socket.io bootstrap, handshake auth, room management.
//
// SINGLE-PROCESS ASSUMPTION: prod is exactly one Docker container (one Node
// process), so socket.io's default in-memory adapter is sufficient. If the
// API ever runs multiple processes/instances, add the Redis adapter here.
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const database = require("../config/database");
const { CORS_ORIGINS } = require("../config/middleware");
const {
  EVENT_WORKSPACE_JOIN,
  EVENT_WORKSPACE_LEAVE,
  rooms,
} = require("./contract");

let io = null;

// Simple per-socket join rate limit against room probing.
const JOIN_LIMIT = 30; // attempts…
const JOIN_WINDOW_MS = 60 * 1000; // …per minute

// Handshake auth — same secret and claims as the REST middleware
// (src/middleware/auth.js). The client sends the JWT in socket.io's
// `auth.token`; invalid/missing tokens refuse the connection.
function authMiddleware(socket, next) {
  try {
    const token = socket.handshake?.auth?.token;
    if (!token) return next(new Error("unauthorized"));

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.data.user = {
      UserId: decoded.UserId,
      CompId: decoded.CompId,
      IsAdmin: decoded.IsAdmin,
    };
    return next();
  } catch (err) {
    return next(new Error("unauthorized"));
  }
}

// May this user join the workspace room? sp_FetchWorkspaceMembers is exactly
// the "may see this workspace" authorization boundary: 200 for an active
// member (IsActive=1, InviteStatus='active') or an admin on a NON-personal
// workspace; 403 otherwise. Personal workspaces are owner-only — the SP
// refuses admins on them too (the invariant this room model must never break).
async function canJoinWorkspace(user, workspaceId) {
  const result = await database.executeStoredProcedure(
    "sp_FetchWorkspaceMembers",
    {
      WorkspaceId: workspaceId,
      ActingUserId: user.UserId,
      IsAdmin: user.IsAdmin ? 1 : 0,
      CompId: user.CompId,
    },
  );
  return result.recordsets?.[0]?.[0]?.ResponseCode === 200;
}

function onConnection(socket) {
  // Every socket sits in its user's room for user-targeted invalidations.
  socket.join(rooms.user(socket.data.user.UserId));

  let joinAttempts = 0;
  let windowStart = Date.now();

  socket.on(EVENT_WORKSPACE_JOIN, async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {};

    const workspaceId = Number(payload?.workspaceId);
    if (!Number.isInteger(workspaceId) || workspaceId <= 0) {
      return reply({ ok: false, error: "invalid workspaceId" });
    }

    const now = Date.now();
    if (now - windowStart >= JOIN_WINDOW_MS) {
      windowStart = now;
      joinAttempts = 0;
    }
    joinAttempts += 1;
    if (joinAttempts > JOIN_LIMIT) {
      return reply({ ok: false, error: "rate limited" });
    }

    try {
      if (!(await canJoinWorkspace(socket.data.user, workspaceId))) {
        return reply({ ok: false, error: "forbidden" });
      }
      socket.join(rooms.workspace(workspaceId));
      return reply({ ok: true });
    } catch (err) {
      console.error("workspace:join failed:", err.message);
      return reply({ ok: false, error: "join failed" });
    }
  });

  // Leaving a room needs no authorization.
  socket.on(EVENT_WORKSPACE_LEAVE, (payload) => {
    const workspaceId = Number(payload?.workspaceId);
    if (Number.isInteger(workspaceId) && workspaceId > 0) {
      socket.leave(rooms.workspace(workspaceId));
    }
  });
}

function init(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: CORS_ORIGINS, // mirror the Express CORS allowlist
      credentials: true,
    },
  });
  io.use(authMiddleware);
  io.on("connection", onConnection);
  console.log("✅ Realtime (socket.io) initialized");
  return io;
}

// Null until init() — emit helpers treat that as "no-op".
const getIo = () => io;

module.exports = { init, getIo, authMiddleware, onConnection };
