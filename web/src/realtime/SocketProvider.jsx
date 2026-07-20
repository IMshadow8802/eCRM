// Realtime client — socket.io wiring for the web app.
//
// PRINCIPLE (see ./contract.js): events carry INVALIDATIONS, never data.
// On EVENT_INVALIDATE we only invalidate TanStack queries; the refetch goes
// through the REST layer, which applies every permission rule exactly once.
//
// GRACEFUL DEGRADATION: if the socket never connects the app behaves exactly
// as it does today — nothing here throws or blocks render.

import { useEffect, useRef } from "react";
import { io } from "socket.io-client";
import { useQueryClient } from "@tanstack/react-query";
import { Box } from "@mui/material";
import { create } from "zustand";

import useAuthStore from "../stores/useAuthStore";
import useWorkspaceStore from "../stores/useWorkspaceStore";
import {
  EVENT_INVALIDATE,
  EVENT_WORKSPACE_JOIN,
  EVENT_WORKSPACE_LEAVE,
  SCOPES,
} from "./contract";

// Connection status for the header pill.
// "idle"    = never connected yet (show nothing — never alarm on first load)
// "live"    = connected
// "offline" = connection lost AFTER a successful connect
export const useSocketStatus = create(() => ({ status: "idle" }));

/**
 * Derive where the socket connects, mirroring axiosConfig's dev/prod split:
 * dev → window origin, path "/socket.io" (Vite proxy → localhost:5001);
 * prod → API_BASE_URL "https://shadowcodes.in/CRM" splits into origin
 * "https://shadowcodes.in" + path "/CRM/socket.io" (nginx strips /CRM
 * before the backend sees the request, so the prefix lives in `path`).
 */
export function deriveSocketTarget(apiBaseUrl, isDev = import.meta.env.DEV) {
  if (isDev) return { url: window.location.origin, path: "/socket.io" };
  const parsed = new URL(apiBaseUrl);
  const prefix = parsed.pathname.replace(/\/+$/, "");
  return { url: parsed.origin, path: `${prefix}/socket.io` };
}

// Scope → queryKey prefixes to invalidate. Two key families coexist:
// TaskDetailModal nests under ["task", taskId, ...] (covered by the
// ["task", taskId] prefix — TanStack prefix-matches), while the
// useTaskData.jsx hooks use FLAT keys ("taskComments"/"taskChecklist"/
// "taskTimeEntries") that a nested prefix never matches — list both.
export const SCOPE_INVALIDATIONS = {
  [SCOPES.TASK_LIST]: () => [["tasks"], ["tasks-all"], ["kanban-columns"]],
  [SCOPES.TASK_DETAIL]: ({ taskId }) => [
    ["task", taskId],
    ["taskChecklist", taskId],
    ["taskTimeEntries", taskId],
  ],
  [SCOPES.TASK_COMMENTS]: ({ taskId }) => [
    ["taskComments", taskId],
    ["task", taskId, "comments"],
  ],
  [SCOPES.WORKSPACE_MEMBERS]: () => [["workspace-members"]],
  [SCOPES.WORKSPACES]: () => [["workspaces"]],
  [SCOPES.NOTIFICATIONS]: () => [["notifications"]],
};

function joinWorkspace(socket, workspaceId) {
  if (workspaceId == null) return;
  socket.emit(EVENT_WORKSPACE_JOIN, { workspaceId }, (res) => {
    // Server verifies membership; a refusal is not a user-facing error —
    // the app simply won't get room-scoped pushes for that workspace.
    if (!res?.ok) console.warn("realtime: workspace join refused", workspaceId, res);
  });
}

/** Mounted once inside the authed tree (RootLayout). Renders nothing. */
export default function SocketProvider() {
  const queryClient = useQueryClient();
  const token = useAuthStore((s) => s.token);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const socketRef = useRef(null);

  // Socket lifecycle: connect when a token exists, tear down on logout,
  // reconnect with fresh auth when the token changes.
  useEffect(() => {
    if (!token) return undefined;

    let socket;
    try {
      const { url, path } = deriveSocketTarget(useAuthStore.getState().API_BASE_URL);
      socket = io(url, { path, auth: { token } });
    } catch (err) {
      // Bad URL/transport setup must never take the app down.
      console.warn("realtime: socket setup failed", err);
      return undefined;
    }
    socketRef.current = socket;
    let connectedOnce = false;

    socket.on("connect", () => {
      connectedOnce = true;
      useSocketStatus.setState({ status: "live" });
      // Blanket invalidation on EVERY connect (first and reconnects): while
      // disconnected we may have missed invalidation events, so refetch
      // everything as catch-up. Cheap at this scale; data still flows REST.
      queryClient.invalidateQueries();
      joinWorkspace(socket, useWorkspaceStore.getState().activeWorkspaceId);
    });

    socket.on("disconnect", () => {
      // Only flag "Offline" after a successful connect — a socket that never
      // comes up must stay silent (the app works fine without realtime).
      if (connectedOnce) useSocketStatus.setState({ status: "offline" });
    });

    socket.on(EVENT_INVALIDATE, (payload) => {
      const toKeys = SCOPE_INVALIDATIONS[payload?.scope];
      if (!toKeys) return;
      for (const queryKey of toKeys(payload)) {
        queryClient.invalidateQueries({ queryKey });
      }
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      useSocketStatus.setState({ status: "idle" });
    };
  }, [token, queryClient]);

  // Room membership follows the active workspace: leave the previous room,
  // join the new one. (The connect handler above re-joins after reconnects.)
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || activeWorkspaceId == null) return undefined;
    if (socket.connected) joinWorkspace(socket, activeWorkspaceId);
    return () => {
      if (socket.connected) {
        socket.emit(EVENT_WORKSPACE_LEAVE, { workspaceId: activeWorkspaceId });
      }
    };
  }, [activeWorkspaceId, token]);

  return null;
}

/**
 * Tiny "Live" / "Offline" pill for the header. Renders nothing until the
 * first successful connect, so a dead socket never alarms anyone.
 */
export function ConnectionStatus() {
  const status = useSocketStatus((s) => s.status);
  if (status === "idle") return null;
  const live = status === "live";
  const color = live ? "success.main" : "text.disabled";
  return (
    <Box
      data-testid="socket-status"
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        mr: 1,
        px: 1,
        py: 0.25,
        borderRadius: 99,
        fontSize: "0.7rem",
        fontWeight: 600,
        color,
        backgroundColor: "action.hover",
      }}
    >
      <Box
        sx={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          backgroundColor: color,
        }}
      />
      {live ? "Live" : "Offline"}
    </Box>
  );
}
