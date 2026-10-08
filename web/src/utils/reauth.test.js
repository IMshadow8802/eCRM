import { describe, it, expect, beforeEach, vi } from "vitest";

const endSession = vi.fn();
vi.mock("./endSession", () => ({ endSession: (...a) => endSession(...a) }));

import useAuthStore from "../stores/useAuthStore";
import {
  cancelReauth,
  isReauthOpen,
  isSessionCode,
  requestReauth,
  resetReauthForTests,
  resolveReauth,
} from "./reauth";

beforeEach(() => {
  resetReauthForTests();
  endSession.mockClear();
  useAuthStore.setState({ user: { Id: 7, Username: "alice" }, reauth: null });
});

describe("reauth", () => {
  it("knows the four session codes and nothing else", () => {
    expect(isSessionCode("SESSION_FORCED")).toBe(true);
    expect(isSessionCode("SESSION_CHECK_FAILED")).toBe(false);
  });

  it("opens one dialog for many callers and resolves them all with the token", async () => {
    const a = requestReauth("SESSION_EXPIRED");
    const b = requestReauth("SESSION_FORCED");
    expect(a).toBe(b);
    expect(isReauthOpen()).toBe(true);
    // The first code wins; a later one does not retitle the open dialog.
    expect(useAuthStore.getState().reauth).toEqual({ code: "SESSION_EXPIRED", username: "alice" });

    resolveReauth("new-token");
    await expect(a).resolves.toBe("new-token");
    expect(isReauthOpen()).toBe(false);
    expect(useAuthStore.getState().reauth).toBeNull();
  });

  it("falls back to SESSION_REQUIRED for an unknown reason", () => {
    requestReauth(undefined);
    expect(useAuthStore.getState().reauth.code).toBe("SESSION_REQUIRED");
  });

  it("cancel rejects the waiters and ends the session", async () => {
    const p = requestReauth("SESSION_ENDED");
    cancelReauth();
    await expect(p).rejects.toThrow("Re-sign-in cancelled");
    // A deliberate choice, not an expiry: the snackbar must not say "expired".
    expect(endSession).toHaveBeenCalledWith("cancelled re-sign-in", "Signed out. Sign in to continue.");
    expect(useAuthStore.getState().reauth).toBeNull();
  });

  it("resolve/cancel with nothing open are harmless", () => {
    resolveReauth("x");
    cancelReauth();
    expect(endSession).toHaveBeenCalledOnce();
  });
});
