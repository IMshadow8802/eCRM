import { AppState } from "react-native";
import { act, renderHook } from "@testing-library/react-native";

import { heartbeat } from "../api/presenceQueries";
import useAuthStore from "../stores/useAuthStore";
import { envelope } from "../test/fixtures";
import { seedAuth } from "../test/renderWithProviders";
import { HEARTBEAT_MS, useHeartbeat } from "./useHeartbeat";

jest.mock("../api/presenceQueries", () => ({ heartbeat: jest.fn() }));

let appState: string | null = "active";
let listeners: ((s: string) => void)[] = [];
const emit = async (s: string) => {
  appState = s;
  await act(async () => { listeners.forEach((l) => l(s)); });
};
beforeEach(() => {
  jest.useFakeTimers();
  appState = "active";
  listeners = [];
  Object.defineProperty(AppState, "currentState", { get: () => appState, configurable: true });
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, fn) => {
    listeners.push(fn as (s: string) => void);
    return { remove: () => { listeners = listeners.filter((l) => l !== fn); } } as ReturnType<typeof AppState.addEventListener>;
  });
  jest.mocked(heartbeat).mockResolvedValue(envelope({ expiresAt: "2026-11-02T13:30:00.000Z" }));
});
afterEach(() => jest.useRealTimers());

it("beats at once, then exactly once per 2-minute interval, storing the expiry", async () => {
  seedAuth();
  await renderHook(() => useHeartbeat());
  await act(async () => {});
  expect(heartbeat).toHaveBeenCalledTimes(1);
  expect(useAuthStore.getState().sessionExpiresAt).toBe("2026-11-02T13:30:00.000Z");
  for (const n of [2, 3, 4]) {
    await act(async () => { jest.advanceTimersByTime(HEARTBEAT_MS); });
    expect(heartbeat).toHaveBeenCalledTimes(n);
  }
});

it("stops in the background; coming back beats once and restarts one interval", async () => {
  seedAuth();
  await renderHook(() => useHeartbeat());
  await emit("background");
  await act(async () => { jest.advanceTimersByTime(HEARTBEAT_MS * 3); });
  expect(heartbeat).toHaveBeenCalledTimes(1);
  await emit("active");
  expect(heartbeat).toHaveBeenCalledTimes(2);
  await act(async () => { jest.advanceTimersByTime(HEARTBEAT_MS); });
  expect(heartbeat).toHaveBeenCalledTimes(3);
});

it("a cold start that is not yet active waits for active", async () => {
  appState = "background";
  seedAuth();
  await renderHook(() => useHeartbeat());
  expect(heartbeat).not.toHaveBeenCalled();
  await emit("active");
  expect(heartbeat).toHaveBeenCalledTimes(1);
});

it("pauses while the re-sign-in dialog is open, and beats as soon as it closes", async () => {
  seedAuth();
  await renderHook(() => useHeartbeat());
  expect(heartbeat).toHaveBeenCalledTimes(1);
  await act(async () => useAuthStore.setState({ reauth: { code: "SESSION_EXPIRED", message: null } }));
  await act(async () => { jest.advanceTimersByTime(HEARTBEAT_MS * 2); });
  expect(heartbeat).toHaveBeenCalledTimes(1);
  await act(async () => useAuthStore.setState({ reauth: null }));
  expect(heartbeat).toHaveBeenCalledTimes(2);
});

it("a failed beat is swallowed; signed out never beats; unmount stops it", async () => {
  jest.mocked(heartbeat).mockRejectedValue(new Error("offline"));
  seedAuth();
  const view = await renderHook(() => useHeartbeat());
  await act(async () => {});
  expect(useAuthStore.getState().sessionExpiresAt).toBeNull();
  await view.unmount();
  await act(async () => { jest.advanceTimersByTime(HEARTBEAT_MS * 2); });
  expect(heartbeat).toHaveBeenCalledTimes(1);
  expect(listeners).toHaveLength(0);

  useAuthStore.setState(useAuthStore.getInitialState(), true);
  await renderHook(() => useHeartbeat());
  expect(heartbeat).toHaveBeenCalledTimes(1);
});
