// Realtime event contract — SERVER copy.
// TWIN FILE: web/src/realtime/contract.js — keep the two in lockstep by hand
// (two codebases, no shared package). Change one, change both.
//
// PRINCIPLE: events carry INVALIDATIONS, never data. A payload names what
// changed ({ scope, workspaceId?, taskId? }); the client refetches through
// the REST layer, which applies every permission/scope rule exactly once.

// Server -> client. One event name; the payload's `scope` routes it.
const EVENT_INVALIDATE = "invalidate";

// Client -> server room management. Server verifies membership before join.
const EVENT_WORKSPACE_JOIN = "workspace:join";
const EVENT_WORKSPACE_LEAVE = "workspace:leave";

// Invalidation scopes.
const SCOPES = {
  TASK_LIST: "task-list",             // { workspaceId }            board/lists
  TASK_DETAIL: "task-detail",         // { workspaceId, taskId }    detail incl. checklist/deps/time
  TASK_COMMENTS: "task-comments",     // { workspaceId, taskId }    the chat-critical one
  WORKSPACE_MEMBERS: "workspace-members", // { workspaceId }        roster
  WORKSPACES: "workspaces",           // { }                        switcher list (lifecycle/membership)
  NOTIFICATIONS: "notifications",     // { }                        bell unread count + list
};

// Room name builders — the only two room shapes that exist.
const rooms = {
  user: (userId) => `user:${userId}`,
  workspace: (workspaceId) => `workspace:${workspaceId}`,
};

module.exports = {
  EVENT_INVALIDATE,
  EVENT_WORKSPACE_JOIN,
  EVENT_WORKSPACE_LEAVE,
  SCOPES,
  rooms,
};
