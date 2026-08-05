import { describe, it, expect, beforeEach } from "vitest";
import useAuthStore from "./useAuthStore";

describe("useAuthStore.hasPermission", () => {
  beforeEach(() => {
    // Reset store between tests by overwriting permissions
    useAuthStore.setState({
      permissions: {
        menuItems: [
          {
            description: "Leads",
            permissions: { view: true, add: true, edit: true, delete: false },
          },
          {
            description: "Tasks",
            permissions: { view: true, add: false, edit: false, delete: false },
          },
        ],
      },
    });
  });

  it("returns true for granted permissions", () => {
    expect(useAuthStore.getState().hasPermission("Leads", "view")).toBe(true);
    expect(useAuthStore.getState().hasPermission("Leads", "add")).toBe(true);
    expect(useAuthStore.getState().hasPermission("Leads", "edit")).toBe(true);
  });

  it("returns false for denied permissions", () => {
    expect(useAuthStore.getState().hasPermission("Leads", "delete")).toBe(false);
    expect(useAuthStore.getState().hasPermission("Tasks", "edit")).toBe(false);
  });

  it("returns false for unknown menus", () => {
    expect(useAuthStore.getState().hasPermission("Accounts", "view")).toBe(false);
  });

  it("returns false when permissions are missing entirely", () => {
    useAuthStore.setState({ permissions: null });
    expect(useAuthStore.getState().hasPermission("Leads", "view")).toBe(false);
  });

  it("returns false when menuItems is missing", () => {
    useAuthStore.setState({ permissions: {} });
    expect(useAuthStore.getState().hasPermission("Leads", "view")).toBe(false);
  });
});

describe("useAuthStore.updateUser", () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({ user: { Id: 1, FullName: "Old", Avatar: null } });
  });

  it("merges a patch into the user + persisted localStorage", () => {
    localStorage.setItem(
      "userData",
      JSON.stringify({ user: { Id: 1, FullName: "Old", Avatar: null } }),
    );
    useAuthStore.getState().updateUser({ FullName: "New", Avatar: "emoji:🚀" });

    const user = useAuthStore.getState().user;
    expect(user.FullName).toBe("New");
    expect(user.Avatar).toBe("emoji:🚀");
    expect(user.Id).toBe(1); // untouched fields kept

    const stored = JSON.parse(localStorage.getItem("userData"));
    expect(stored.user.FullName).toBe("New");
    expect(stored.user.Avatar).toBe("emoji:🚀");
  });

  it("updates state even when nothing is persisted yet", () => {
    useAuthStore.getState().updateUser({ FullName: "Solo" });
    expect(useAuthStore.getState().user.FullName).toBe("Solo");
  });
});

const b64 = (o) =>
  btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwtExpiringIn = (seconds) =>
  `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
    exp: Math.floor(Date.now() / 1000) + seconds,
  })}.sig`;

describe("useAuthStore.checkTokenExpiry", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: true, token: jwtExpiringIn(3600) });
  });

  it("answers true while the token is still good", () => {
    expect(useAuthStore.getState().checkTokenExpiry()).toBe(true);
  });

  it("answers false for an expired token", () => {
    useAuthStore.setState({ token: jwtExpiringIn(-60) });
    expect(useAuthStore.getState().checkTokenExpiry()).toBe(false);
  });

  it("answers false when there is no token at all", () => {
    useAuthStore.setState({ token: null });
    expect(useAuthStore.getState().checkTokenExpiry()).toBe(false);
  });

  /**
   * REGRESSION: this used to call state.logout() when it found an expired
   * token, so asking whether the session was still valid silently ended it —
   * from a function named "check". Callers then ran their own teardown and
   * became the SECOND one to clear the store, which is how two logout paths
   * came to interleave on wake. Ending a session belongs to endSession.
   */
  it("is a question, not an action — it never clears the session", () => {
    useAuthStore.setState({ token: jwtExpiringIn(-60) });
    useAuthStore.getState().checkTokenExpiry();

    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().token).not.toBeNull();
  });
});
