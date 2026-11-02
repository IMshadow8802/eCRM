import { AppState } from "react-native";
import { act, renderHook } from "@testing-library/react-native";

import { heartbeat } from "../api/presenceQueries";
import useAuthStore from "../stores/useAuthStore";
import { envelope } from "../test/fixtures";
import { seedAuth } from "../test/renderWithProviders";
import { HEARTBEAT_MS, useHeartbeat } from "./useHeartbeat";

jest.mock("../api/presenceQueries", () => ({ heartbeat: jest.fn() }));

let appState: string | null = null;
let listeners: ((s: string) => void)[] = [];
beforeEach(() => {
  jest.useFakeTimers();
  appState = null;
  listeners = [];
  Object.defineProperty(AppState, "currentState", { get: () => appState, configurable: true });
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, fn) => {
    listeners.push(fn as (s: string) => void);
    return { remove: () => { listeners = listeners.filter((l) => l !== fn); } } as ReturnType<typeof AppState.addEventListener>;
  });
  jest.mocked(heartbeat).mockResolvedValue(envelope({ expiresAt: "2026-11-02T13:30:00.000Z" }));
});
afterEach(() => jest.useRealTimers());

it("beats at once and every 2 minutes, storing the expiry", async () => {
  seedAuth();
  await renderHook(() => useHeartbeat());
  await act(async () => {});
  expect(heartbeat).toHaveBeenCalledTimes(1);
  expect(useAuthStore.getState().sessionExpiresAt).toBe("2026-11-02T13:30:00.000Z");
  await act(async () => { jest.advanceTimersByTime(HEARTBEAT_MS); });
  expect(heartbeat).toHaveBeenCalledTimes(2);
});

it("skips while in the background and beats again on return", async () => {
  seedAuth();
  appState = "background";
  await renderHook(() => useHeartbeat());
  await act(async () => { jest.advanceTimersByTime(HEARTBEAT_MS); });
  expect(heartbeat).not.toHaveBeenCalled();
  appState = "active";
  await act(async () => { listeners.forEach((l) => l("background")); listeners.forEach((l) => l("active")); });
  expect(heartbeat).toHaveBeenCalledTimes(1);
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
