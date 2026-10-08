import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const heartbeat = vi.fn(() => Promise.resolve());
vi.mock("../api/presenceQueries", () => ({ heartbeat: (...a) => heartbeat(...a) }));

import useAuthStore from "../stores/useAuthStore";
import useHeartbeat, { HEARTBEAT_MS } from "./useHeartbeat";

let visibility = "visible";
const setVisibility = (v) => {
  visibility = v;
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(() => {
  vi.useFakeTimers();
  heartbeat.mockClear();
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  useAuthStore.setState({ isAuthenticated: true, reauth: null });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useHeartbeat", () => {
  it("beats on mount and every 2 minutes while visible", () => {
    renderHook(() => useHeartbeat());
    expect(heartbeat).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(HEARTBEAT_MS));
    expect(heartbeat).toHaveBeenCalledTimes(2);
    act(() => vi.advanceTimersByTime(HEARTBEAT_MS));
    expect(heartbeat).toHaveBeenCalledTimes(3);
  });

  it("skips beats while the tab is hidden and beats again on return", () => {
    renderHook(() => useHeartbeat());
    act(() => setVisibility("hidden"));
    act(() => vi.advanceTimersByTime(HEARTBEAT_MS * 3));
    expect(heartbeat).toHaveBeenCalledTimes(1);
    act(() => setVisibility("visible"));
    expect(heartbeat).toHaveBeenCalledTimes(2);
  });

  it("ignores a failed beat", async () => {
    heartbeat.mockImplementationOnce(() => Promise.reject(new Error("down")));
    renderHook(() => useHeartbeat());
    await act(async () => {});
    expect(heartbeat).toHaveBeenCalledTimes(1);
  });

  it("does nothing when signed out, and pauses while a re-sign-in is open", () => {
    useAuthStore.setState({ isAuthenticated: false });
    renderHook(() => useHeartbeat());
    expect(heartbeat).not.toHaveBeenCalled();

    act(() => useAuthStore.setState({ isAuthenticated: true, reauth: { code: "SESSION_EXPIRED" } }));
    act(() => vi.advanceTimersByTime(HEARTBEAT_MS));
    expect(heartbeat).not.toHaveBeenCalled();

    // Signed back in: beat straight away.
    act(() => useAuthStore.setState({ reauth: null }));
    expect(heartbeat).toHaveBeenCalledTimes(1);
  });

  it("stops on unmount", () => {
    const { unmount } = renderHook(() => useHeartbeat());
    unmount();
    act(() => vi.advanceTimersByTime(HEARTBEAT_MS));
    act(() => setVisibility("visible"));
    expect(heartbeat).toHaveBeenCalledTimes(1);
  });
});
