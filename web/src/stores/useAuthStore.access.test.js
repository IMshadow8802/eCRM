import { describe, it, expect, beforeEach } from "vitest";
import useAuthStore from "./useAuthStore";

const ACCESS = { isAdmin: false, modules: { leads: { view: true, reach: "Own" } } };

describe("useAuthStore access", () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({ access: null });
  });

  it("login keeps data.access, and a login without it leaves null", () => {
    const base = { token: "t", user: { Id: 1, BranchId: 2, CompId: 3 }, company: {}, permissions: {} };
    useAuthStore.getState().login({ ...base, access: ACCESS });
    expect(useAuthStore.getState().access).toEqual(ACCESS);
    useAuthStore.getState().login(base);
    expect(useAuthStore.getState().access).toBeNull();
  });

  it("setAccess replaces it; logout and Switch company clear it", () => {
    useAuthStore.getState().setAccess(ACCESS);
    expect(useAuthStore.getState().access).toEqual(ACCESS);
    useAuthStore.getState().setAccess(undefined);
    expect(useAuthStore.getState().access).toBeNull();
    useAuthStore.getState().setAccess(ACCESS);
    useAuthStore.getState().logout();
    expect(useAuthStore.getState().access).toBeNull();
    useAuthStore.getState().setAccess(ACCESS);
    useAuthStore.getState().clearClientConfig();
    expect(useAuthStore.getState().access).toBeNull();
  });

  it("is persisted", () => {
    useAuthStore.getState().setAccess(ACCESS);
    expect(JSON.parse(localStorage.getItem("auth-storage-eCRM")).state.access).toEqual(ACCESS);
  });
});
