import AsyncStorage from "@react-native-async-storage/async-storage";

import { getApiBaseUrl, getAuthToken, post } from "../api/client";
import { fail } from "../test/transport";
import { seedAuth } from "../test/renderWithProviders";
import type { AuthUser, LoginData } from "../types/api";
import useAuthStore from "./useAuthStore";

const BASE = "https://shadowcodes.in/TestCRM";

const loginData = (patch: Partial<LoginData> = {}): LoginData => ({
  token: "tok-1",
  user: { Id: 9, CompId: 3, BranchId: 4, FullName: "Asha", IsAdmin: false } as AuthUser,
  company: {} as LoginData["company"],
  permissions: { menuItems: [], rawPermissions: [], totalMenuItems: 0, hasAdminAccess: false },
  ...patch,
});

const state = () => useAuthStore.getState();

beforeEach(async () => {
  useAuthStore.setState(useAuthStore.getInitialState(), true);
  await AsyncStorage.clear();
});

describe("company binding", () => {
  it("setClientConfig stores Central's config and points the client at its base URL", () => {
    state().setClientConfig({ baseURL: BASE, compCode: "TESTCRM", companyName: "Test CRM", logoURL: "https://x/logo.png" });
    expect(state()).toMatchObject({
      API_BASE_URL: BASE,
      compCode: "TESTCRM",
      companyName: "Test CRM",
      logoURL: "https://x/logo.png",
      isClientConfigured: true,
    });
    expect(getApiBaseUrl()).toBe(BASE);
  });

  it("never stores a colour from Central", () => {
    state().setClientConfig({ baseURL: BASE, compCode: "TESTCRM", companyName: null, logoURL: null });
    expect(Object.keys(state()).some((k) => /color/i.test(k))).toBe(false);
  });

  it("Switch company clears the company AND the session", () => {
    state().setClientConfig({ baseURL: BASE, compCode: "TESTCRM", companyName: "Test CRM", logoURL: null });
    state().login(loginData());
    state().clearClientConfig();
    expect(state()).toMatchObject({
      API_BASE_URL: null,
      compCode: null,
      companyName: null,
      isClientConfigured: false,
      isAuthenticated: false,
      token: null,
      user: null,
    });
    expect(getApiBaseUrl()).toBeNull();
    expect(getAuthToken()).toBeNull();
  });
});

describe("session", () => {
  it("login seeds the session, ids and token, and clears an old end reason", () => {
    useAuthStore.setState({ sessionEndedReason: "SESSION_EXPIRED" });
    state().login(loginData({ presenceNotice: true }));
    expect(state()).toMatchObject({
      isAuthenticated: true,
      token: "tok-1",
      UserId: 9,
      CompId: 3,
      BranchId: 4,
      sessionEndedReason: null,
      presenceNotice: true,
    });
    expect(state().loginTimestamp).toEqual(expect.any(Number));
    expect(getAuthToken()).toBe("tok-1");
  });

  it("presenceNotice defaults to false when login omits it", () => {
    state().login(loginData());
    expect(state().presenceNotice).toBe(false);
  });

  it("ackPresenceNotice clears the notice", () => {
    state().login(loginData({ presenceNotice: true }));
    state().ackPresenceNotice();
    expect(state().presenceNotice).toBe(false);
  });

  it("logout drops the session but keeps the company", () => {
    state().setClientConfig({ baseURL: BASE, compCode: "TESTCRM", companyName: null, logoURL: null });
    state().login(loginData());
    state().logout();
    expect(state()).toMatchObject({ isAuthenticated: false, token: null, user: null, UserId: null, API_BASE_URL: BASE });
    expect(getAuthToken()).toBeNull();
  });

  it("updateUser patches a signed-in user and is a no-op without one", () => {
    state().updateUser({ FullName: "Nobody" });
    expect(state().user).toBeNull();
    state().login(loginData());
    state().updateUser({ FullName: "Asha K" });
    expect(state().user).toMatchObject({ Id: 9, FullName: "Asha K" });
  });

  it("isAdmin reads the user's role flag", () => {
    expect(state().isAdmin()).toBe(false);
    seedAuth({ user: { IsAdmin: true } });
    expect(state().isAdmin()).toBe(true);
  });
});

describe("a 401 from the API", () => {
  it.each(["SESSION_ENDED", "SESSION_EXPIRED", "SESSION_FORCED", "SESSION_REQUIRED"])(
    "%s logs the user out and records why",
    async (code) => {
      seedAuth();
      fail(401, { code });
      await expect(post("/api/tasks/fetchTasks")).rejects.toBeTruthy();
      expect(state()).toMatchObject({ isAuthenticated: false, token: null, sessionEndedReason: code });
    },
  );

  it("a non-session 401 logs out without a reason", async () => {
    seedAuth();
    fail(401, { code: "TOKEN_INVALID" });
    await expect(post("/api/tasks/fetchTasks")).rejects.toBeTruthy();
    expect(state()).toMatchObject({ isAuthenticated: false, sessionEndedReason: null });
  });

  it("a stale 401 after logout paints no reason", async () => {
    fail(401, { code: "SESSION_EXPIRED" });
    await expect(post("/api/tasks/fetchTasks")).rejects.toBeTruthy();
    expect(state().sessionEndedReason).toBeNull();
  });

  it("503 SESSION_CHECK_FAILED is not a logout", async () => {
    seedAuth();
    fail(503, { code: "SESSION_CHECK_FAILED" });
    await expect(post("/api/tasks/fetchTasks")).rejects.toBeTruthy();
    expect(state()).toMatchObject({ isAuthenticated: true, sessionEndedReason: null });
  });
});

describe("rehydration", () => {
  const persist = (s: object) => AsyncStorage.setItem("nexus-crm-auth", JSON.stringify({ state: s, version: 0 }));

  it("restores a trusted company and session and pushes both to the client", async () => {
    await persist({ API_BASE_URL: BASE, compCode: "TESTCRM", isClientConfigured: true, isAuthenticated: true, token: "tok-9" });
    await useAuthStore.persist.rehydrate();
    expect(state()).toMatchObject({ API_BASE_URL: BASE, isClientConfigured: true, isAuthenticated: true, token: "tok-9" });
    expect(getApiBaseUrl()).toBe(BASE);
    expect(getAuthToken()).toBe("tok-9");
  });

  it("drops the company and the session when the stored base URL is not trusted", async () => {
    await persist({ API_BASE_URL: "https://evil.example/CRM", isClientConfigured: true, isAuthenticated: true, token: "tok-9" });
    await useAuthStore.persist.rehydrate();
    expect(state()).toMatchObject({ API_BASE_URL: null, isClientConfigured: false, isAuthenticated: false, token: null });
  });
});
