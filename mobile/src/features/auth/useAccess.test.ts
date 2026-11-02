import { AppState, type AppStateStatus } from "react-native";
import { act, renderHook } from "@testing-library/react-native";

import { fetchMyAccess } from "../../api/authQueries";
import { access, envelope, loginData } from "../../test/fixtures";
import { seedAuth } from "../../test/renderWithProviders";
import useAuthStore from "../../stores/useAuthStore";
import { useAccess, useAccessRefresh } from "./useAccess";

jest.mock("../../api/authQueries");

const complaints = { view: true, add: true, edit: false, delete: false, reach: "Team" as const };

beforeEach(() => useAuthStore.setState(useAuthStore.getInitialState(), true));

describe("useAccess", () => {
  it("returns the role's grant for the module, with isAdmin false", async () => {
    useAuthStore.getState().login(loginData({ access: access({ modules: { complaints } }) }));
    const { result } = await renderHook(() => useAccess("complaints"));
    expect(result.current).toEqual({ ...complaints, isAdmin: false });
  });

  it("a module the role has no grant for is all false", async () => {
    useAuthStore.getState().login(loginData({ access: access({ modules: { complaints } }) }));
    const { result } = await renderHook(() => useAccess("leads"));
    expect(result.current).toEqual({ view: false, add: false, edit: false, delete: false, reach: null, isAdmin: false });
  });

  it("an admin may do everything company-wide", async () => {
    useAuthStore.getState().login(loginData({ access: access({ isAdmin: true }) }));
    const { result } = await renderHook(() => useAccess("cards"));
    expect(result.current).toEqual({ view: true, add: true, edit: true, delete: true, reach: "Company", isAdmin: true });
  });

  it("nothing is granted before access is known, even for a login-time admin flag", async () => {
    seedAuth({ user: { IsAdmin: true } });
    const { result } = await renderHook(() => useAccess("complaints"));
    expect(result.current).toEqual({ view: false, add: false, edit: false, delete: false, reach: null, isAdmin: false });
  });

  it("follows a refreshed grant without a re-login", async () => {
    useAuthStore.getState().login(loginData());
    const { result } = await renderHook(() => useAccess("complaints"));
    expect(result.current.view).toBe(false);
    await act(async () => useAuthStore.setState({ access: access({ modules: { complaints } }) }));
    expect(result.current.view).toBe(true);
  });
});

describe("useAccessRefresh", () => {
  let onChange: (s: AppStateStatus) => void;
  const remove = jest.fn();
  let now = 5_000_000;

  beforeEach(() => {
    jest.spyOn(Date, "now").mockImplementation(() => now);
    jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
      onChange = handler as (s: AppStateStatus) => void;
      return { remove };
    });
    jest.mocked(fetchMyAccess).mockResolvedValue(
      envelope({ access: access({ modules: { complaints } }), permissions: { menuItems: [], rawPermissions: [], totalMenuItems: 0 } }),
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it("re-reads access when the app comes back to the foreground, at most once a minute", async () => {
    seedAuth();
    const { unmount } = await renderHook(() => useAccessRefresh());
    await act(async () => onChange("active"));
    expect(fetchMyAccess).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().access?.modules.complaints).toEqual(complaints);

    now += 30_000;
    await act(async () => onChange("background"));
    await act(async () => onChange("active"));
    expect(fetchMyAccess).toHaveBeenCalledTimes(1);

    now += 30_000;
    await act(async () => onChange("active"));
    expect(fetchMyAccess).toHaveBeenCalledTimes(2);

    await unmount();
    expect(remove).toHaveBeenCalled();
  });

  it("does not listen while signed out", async () => {
    await renderHook(() => useAccessRefresh());
    expect(AppState.addEventListener).not.toHaveBeenCalled();
    expect(fetchMyAccess).not.toHaveBeenCalled();
  });
});
