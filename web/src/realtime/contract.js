// Realtime event contract — WEB copy.
// TWIN FILE: backend/src/realtime/contract.js — keep the two in lockstep by
// hand (two codebases, no shared package). Change one, change both.
//
// PRINCIPLE: events carry INVALIDATIONS, never data. A payload names what
// changed ({ scope, workspaceId?, taskId? }); this client refetches through
// the REST layer, which applies every permission/scope rule exactly once.

// Server -> client. One event name; the payload's `scope` routes it.
export const EVENT_INVALIDATE = "invalidate";

// Client -> server room management. Server verifies membership before join.
export const EVENT_WORKSPACE_JOIN = "workspace:join";
export const EVENT_WORKSPACE_LEAVE = "workspace:leave";

// Invalidation scopes.
export const SCOPES = {
  TASK_LIST: "task-list",             // { workspaceId }            board/lists
  TASK_DETAIL: "task-detail",         // { workspaceId, taskId }    detail incl. checklist/deps/time
  TASK_COMMENTS: "task-comments",     // { workspaceId, taskId }    the chat-critical one
  WORKSPACE_MEMBERS: "workspace-members", // { workspaceId }        roster
  WORKSPACES: "workspaces",           // { }                        switcher list (lifecycle/membership)
  NOTIFICATIONS: "notifications",     // { }                        bell unread count + list
};
