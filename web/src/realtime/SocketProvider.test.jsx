import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ---- socket.io-client mock: capture the last socket + its handlers ----
const sockets = [];
const ioMock = vi.fn((url, opts) => {
  const handlers = {};
  const socket = {
    url,
    opts,
    connected: false,
    on: vi.fn((event, cb) => {
      handlers[event] = cb;
      return socket;
    }),
    emit: vi.fn(),
    disconnect: vi.fn(() => {
      socket.connected = false;
    }),
    removeAllListeners: vi.fn(),
    handlers,
    // test helper: simulate the server accepting the connection
    fireConnect() {
      socket.connected = true;
      handlers.connect?.();
    },
    fireDisconnect() {
      socket.connected = false;
      handlers.disconnect?.();
    },
  };
  sockets.push(socket);
  return socket;
});
vi.mock("socket.io-client", () => ({ io: (...args) => ioMock(...args) }));

import useAuthStore from "../stores/useAuthStore";
import useWorkspaceStore from "../stores/useWorkspaceStore";
import SocketProvider, {
  ConnectionStatus,
  SCOPE_INVALIDATIONS,
  deriveSocketTarget,
  useSocketStatus,
} from "./SocketProvider";
import {
  EVENT_INVALIDATE,
  EVENT_WORKSPACE_JOIN,
  EVENT_WORKSPACE_LEAVE,
  SCOPES,
} from "./contract";

const lastSocket = () => sockets[sockets.length - 1];

let queryClient;
const renderProvider = () => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  vi.spyOn(queryClient, "invalidateQueries");
  return render(
    <QueryClientProvider client={queryClient}>
      <SocketProvider />
    </QueryClientProvider>,
  );
};

const loginWith = (token = "jwt-abc") =>
  act(() => {
    useAuthStore.setState({ token, isAuthenticated: true });
  });

describe("deriveSocketTarget", () => {
  it("dev: window origin + bare /socket.io (Vite proxy handles the rest)", () => {
    expect(deriveSocketTarget("https://shadowcodes.in/CRM", true)).toEqual({
      url: window.location.origin,
      path: "/socket.io",
    });
  });

  it("prod: splits API base into origin + prefixed socket path", () => {
    expect(deriveSocketTarget("https://shadowcodes.in/CRM", false)).toEqual({
      url: "https://shadowcodes.in",
      path: "/CRM/socket.io",
    });
  });

  it("prod: base with trailing slash and no prefix both normalise", () => {
    expect(deriveSocketTarget("https://shadowcodes.in/CRM/", false)).toEqual({
      url: "https://shadowcodes.in",
      path: "/CRM/socket.io",
    });
    expect(deriveSocketTarget("https://api.example.com", false)).toEqual({
      url: "https://api.example.com",
      path: "/socket.io",
    });
  });
});

describe("SocketProvider", () => {
  beforeEach(() => {
    sockets.length = 0;
    ioMock.mockClear();
    act(() => {
      useAuthStore.setState({ token: null, isAuthenticated: false });
      useWorkspaceStore.getState().clearActiveWorkspace();
      useSocketStatus.setState({ status: "idle" });
    });
  });

  it("does not connect when logged out", () => {
    renderProvider();
    expect(ioMock).not.toHaveBeenCalled();
  });

  it("connects with the token from the auth store", () => {
    loginWith("jwt-123");
    renderProvider();
    expect(ioMock).toHaveBeenCalledTimes(1);
    expect(lastSocket().opts).toMatchObject({ auth: { token: "jwt-123" } });
  });

  it("disconnects on logout and reconnects with a new token", () => {
    loginWith("jwt-1");
    renderProvider();
    const first = lastSocket();

    act(() => {
      useAuthStore.setState({ token: "jwt-2" });
    });
    expect(first.disconnect).toHaveBeenCalled();
    expect(lastSocket().opts.auth.token).toBe("jwt-2");

    const second = lastSocket();
    act(() => {
      useAuthStore.getState().logout();
    });
    expect(second.disconnect).toHaveBeenCalled();
    expect(ioMock).toHaveBeenCalledTimes(2); // no third socket after logout
  });

  it("blanket-invalidates on every connect, including reconnects", () => {
    loginWith();
    renderProvider();
    const socket = lastSocket();

    act(() => socket.fireConnect());
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith();

    queryClient.invalidateQueries.mockClear();
    act(() => socket.fireDisconnect());
    act(() => socket.fireConnect()); // reconnect
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith();
  });

  it("joins the active workspace room on connect (with ack warning on refusal)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    act(() => {
      useWorkspaceStore.getState().setActiveWorkspace({ Id: 7, Type: "shared" });
    });
    loginWith();
    renderProvider();
    const socket = lastSocket();
    act(() => socket.fireConnect());

    const joinCall = socket.emit.mock.calls.find(
      (c) => c[0] === EVENT_WORKSPACE_JOIN,
    );
    expect(joinCall[1]).toEqual({ workspaceId: 7 });
    // fire the ack with a refusal → console.warn, no throw
    joinCall[2]({ ok: false });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("leaves the previous room and joins the new one on workspace change", () => {
    act(() => {
      useWorkspaceStore.getState().setActiveWorkspace({ Id: 1 });
    });
    loginWith();
    renderProvider();
    const socket = lastSocket();
    act(() => socket.fireConnect());
    socket.emit.mockClear();

    act(() => {
      useWorkspaceStore.getState().setActiveWorkspace({ Id: 2 });
    });
    expect(socket.emit).toHaveBeenCalledWith(EVENT_WORKSPACE_LEAVE, {
      workspaceId: 1,
    });
    expect(socket.emit).toHaveBeenCalledWith(
      EVENT_WORKSPACE_JOIN,
      { workspaceId: 2 },
      expect.any(Function),
    );
  });

  it("routes every contract scope to the right queryKeys", () => {
    loginWith();
    renderProvider();
    const socket = lastSocket();
    const payload = { workspaceId: 5, taskId: 42 };

    // iterate the shipped map — every contract scope must be covered
    expect(Object.keys(SCOPE_INVALIDATIONS).sort()).toEqual(
      Object.values(SCOPES).sort(),
    );

    for (const scope of Object.values(SCOPES)) {
      queryClient.invalidateQueries.mockClear();
      act(() => socket.handlers[EVENT_INVALIDATE]({ scope, ...payload }));
      const expected = SCOPE_INVALIDATIONS[scope](payload);
      expect(queryClient.invalidateQueries.mock.calls.map((c) => c[0])).toEqual(
        expected.map((queryKey) => ({ queryKey })),
      );
    }
  });

  it("shipped map targets the keys this codebase actually uses", () => {
    const p = { workspaceId: 5, taskId: 42 };
    expect(SCOPE_INVALIDATIONS[SCOPES.TASK_LIST](p)).toEqual([
      ["tasks"],
      ["tasks-all"],
      ["kanban-columns"],
    ]);
    expect(SCOPE_INVALIDATIONS[SCOPES.TASK_DETAIL](p)).toEqual([["task", 42]]);
    expect(SCOPE_INVALIDATIONS[SCOPES.TASK_COMMENTS](p)).toEqual([
      ["task", 42, "comments"],
    ]);
    expect(SCOPE_INVALIDATIONS[SCOPES.WORKSPACE_MEMBERS](p)).toEqual([
      ["workspace-members"],
    ]);
    expect(SCOPE_INVALIDATIONS[SCOPES.WORKSPACES](p)).toEqual([["workspaces"]]);
    expect(SCOPE_INVALIDATIONS[SCOPES.NOTIFICATIONS](p)).toEqual([
      ["notifications"],
    ]);
  });

  it("ignores unknown scopes and malformed payloads", () => {
    loginWith();
    renderProvider();
    const socket = lastSocket();
    act(() => {
      socket.handlers[EVENT_INVALIDATE]({ scope: "nope" });
      socket.handlers[EVENT_INVALIDATE](undefined);
    });
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
  });

  it("app renders fine when the socket never connects", () => {
    loginWith();
    renderProvider();
    // no connect ever fired — nothing thrown, no invalidations, status idle
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
    expect(useSocketStatus.getState().status).toBe("idle");
    expect(screen.queryByTestId("socket-status")).not.toBeInTheDocument();
  });
});

describe("ConnectionStatus", () => {
  beforeEach(() => {
    sockets.length = 0;
    act(() => {
      useAuthStore.setState({ token: null, isAuthenticated: false });
      useSocketStatus.setState({ status: "idle" });
    });
  });

  it("renders nothing before the first successful connect", () => {
    render(<ConnectionStatus />);
    expect(screen.queryByTestId("socket-status")).not.toBeInTheDocument();
  });

  it("shows Live on connect and Offline only after a lost connection", () => {
    loginWith();
    renderProvider();
    const socket = lastSocket();
    render(<ConnectionStatus />);

    act(() => socket.fireConnect());
    expect(screen.getByTestId("socket-status")).toHaveTextContent("Live");

    act(() => socket.fireDisconnect());
    expect(screen.getByTestId("socket-status")).toHaveTextContent("Offline");
  });
});
