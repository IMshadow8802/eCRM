import { act, renderHook } from "@testing-library/react-native";

import { logout } from "../../api/authQueries";
import { envelope } from "../../test/fixtures";
import { seedAuth } from "../../test/renderWithProviders";
import useAuthStore from "../../stores/useAuthStore";
import { useSignOut } from "./useSignOut";

jest.mock("../../api/authQueries");

beforeEach(() => seedAuth());

it("tells the server, then clears the local session and the confirm", async () => {
  jest.mocked(logout).mockResolvedValue(envelope({}));
  const { result } = await renderHook(() => useSignOut());
  await act(async () => result.current.setConfirming(true));
  expect(result.current.confirming).toBe(true);
  await act(() => result.current.signOut());
  expect(logout).toHaveBeenCalledTimes(1);
  expect(useAuthStore.getState().isAuthenticated).toBe(false);
  expect(result.current).toMatchObject({ confirming: false, busy: false });
});

it("still signs out locally when the server call fails", async () => {
  jest.mocked(logout).mockRejectedValue(new Error("Network Error"));
  const { result } = await renderHook(() => useSignOut());
  await act(() => result.current.signOut());
  expect(useAuthStore.getState().isAuthenticated).toBe(false);
  expect(result.current.busy).toBe(false);
});

it("is busy while the server call is in flight", async () => {
  let finish!: () => void;
  jest.mocked(logout).mockReturnValue(new Promise((resolve) => { finish = () => resolve(envelope({})); }));
  const { result } = await renderHook(() => useSignOut());
  let pending!: Promise<void>;
  await act(async () => { pending = result.current.signOut(); });
  expect(result.current.busy).toBe(true);
  expect(useAuthStore.getState().isAuthenticated).toBe(true);
  await act(async () => { finish(); await pending; });
  expect(useAuthStore.getState().isAuthenticated).toBe(false);
});
