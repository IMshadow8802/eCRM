import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const endSession = vi.fn();
vi.mock("../utils/endSession", () => ({
  endSession: (...a) => endSession(...a),
  isEndingSession: () => false,
}));

const enqueueSnackbar = vi.fn();
vi.mock("notistack", () => ({ enqueueSnackbar: (...a) => enqueueSnackbar(...a) }));

import { useTokenMonitor } from "./useTokenMonitor.jsx";
import useAuthStore from "../stores/useAuthStore";

const b64 = (o) =>
  btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwtExpiringIn = (seconds) =>
  `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
    exp: Math.floor(Date.now() / 1000) + seconds,
  })}.sig`;

const signedInWith = (token) =>
  act(() => useAuthStore.setState({ isAuthenticated: true, token }));

beforeEach(() => {
  vi.useFakeTimers();
  endSession.mockClear();
  enqueueSnackbar.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  act(() => useAuthStore.setState({ isAuthenticated: false, token: null }));
});

describe("useTokenMonitor", () => {
  it("does nothing while signed out", () => {
    act(() => useAuthStore.setState({ isAuthenticated: false, token: null }));
    renderHook(() => useTokenMonitor());
    act(() => vi.advanceTimersByTime(120_000));
    expect(endSession).not.toHaveBeenCalled();
  });

  it("ends the session when the token is already dead at mount", () => {
    signedInWith(jwtExpiringIn(-60));
    renderHook(() => useTokenMonitor());
    expect(endSession).toHaveBeenCalledOnce();
  });

  it("ends the session when the token dies while the tab sits open", () => {
    signedInWith(jwtExpiringIn(30));
    renderHook(() => useTokenMonitor({ checkInterval: 1000 }));
    expect(endSession).not.toHaveBeenCalled();

    // Push wall-clock past the expiry, then let the interval fire.
    vi.setSystemTime(Date.now() + 60_000);
    act(() => vi.advanceTimersByTime(1000));
    expect(endSession).toHaveBeenCalledOnce();
  });

  /**
   * The teardown goes through endSession and nowhere else. This hook used to
   * do its own: forceLogout() plus a soft navigate('/login'), while the axios
   * interceptors did a different reset plus a hard redirect. Two paths racing
   * on wake is what produced the frozen page.
   */
  it("never tears down on its own", () => {
    signedInWith(jwtExpiringIn(-60));
    renderHook(() => useTokenMonitor());
    // The store is endSession's to clear — the mock means nothing happened.
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it("respects autoLogout: false", () => {
    signedInWith(jwtExpiringIn(-60));
    renderHook(() => useTokenMonitor({ autoLogout: false }));
    expect(endSession).not.toHaveBeenCalled();
  });

  it("warns once that the session is nearly up, not on every tick", () => {
    signedInWith(jwtExpiringIn(120)); // inside the 5-minute warning window
    renderHook(() => useTokenMonitor({ checkInterval: 1000, warningMinutes: 5 }));

    act(() => vi.advanceTimersByTime(3000));
    expect(endSession).not.toHaveBeenCalled();
    expect(enqueueSnackbar).toHaveBeenCalledOnce();
  });

  it("checks again when the tab regains focus", () => {
    signedInWith(jwtExpiringIn(30));
    renderHook(() => useTokenMonitor());
    expect(endSession).not.toHaveBeenCalled();

    // The overnight case: time passed while the tab was in the background.
    vi.setSystemTime(Date.now() + 60_000);
    act(() => window.dispatchEvent(new Event("focus")));
    expect(endSession).toHaveBeenCalledOnce();
  });

  it("checks again when the tab becomes visible", () => {
    signedInWith(jwtExpiringIn(30));
    renderHook(() => useTokenMonitor());

    vi.setSystemTime(Date.now() + 60_000);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(endSession).toHaveBeenCalledOnce();
  });

  it("stops checking once unmounted", () => {
    signedInWith(jwtExpiringIn(30));
    const { unmount } = renderHook(() => useTokenMonitor({ checkInterval: 1000 }));
    unmount();

    vi.setSystemTime(Date.now() + 60_000);
    act(() => vi.advanceTimersByTime(5000));
    act(() => window.dispatchEvent(new Event("focus")));
    expect(endSession).not.toHaveBeenCalled();
  });
});
