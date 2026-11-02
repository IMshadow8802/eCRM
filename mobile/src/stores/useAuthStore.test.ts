import AsyncStorage from "@react-native-async-storage/async-storage";

import * as authQueries from "../api/authQueries";
import { getApiBaseUrl, getAuthToken, post } from "../api/client";
import { queryClient } from "../api/queryClient";
import { access, envelope, loginData } from "../test/fixtures";
import { fail, lastRequest, respond } from "../test/transport";
import { waitFor } from "@testing-library/react-native";
import { seedAuth } from "../test/renderWithProviders";
import useAuthStore from "./useAuthStore";

const BASE = "https://shadowcodes.in/TestCRM";


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

  it("isAdmin reads the role's access, not the login-time user flag", () => {
    expect(state().isAdmin()).toBe(false);
    seedAuth({ user: { IsAdmin: true } });
    expect(state().isAdmin()).toBe(false);
    state().login(loginData({ access: access({ isAdmin: true }) }));
    expect(state().isAdmin()).toBe(true);
  });

  it("login keeps the access it was given", () => {
    const grants = access({ modules: { complaints: { view: true, add: true, edit: false, delete: false, reach: "Team" } } });
    state().login(loginData({ access: grants }));
    expect(state().access).toEqual(grants);
  });
});

describe("the query cache never outlives a session", () => {
  const seeded = () => queryClient.setQueryData(["tasks", "mine"], [{ Id: 1 }]);
  const cached = () => queryClient.getQueryData(["tasks", "mine"]);

  // The seeded query's 10-minute gc timer would otherwise hold jest open when the code under test fails.
  afterEach(() => queryClient.clear());

  it("login drops the previous user's cached data", () => {
    seeded();
    state().login(loginData());
    expect(cached()).toBeUndefined();
  });

  it("logout drops it", () => {
    state().login(loginData());
    seeded();
    state().logout();
    expect(cached()).toBeUndefined();
  });

  it("Switch company drops it", () => {
    state().login(loginData());
    seeded();
    state().clearClientConfig();
    expect(cached()).toBeUndefined();
  });

  it("a dead-token 401 drops it", async () => {
    seedAuth();
    seeded();
    fail(401, { code: "TOKEN_EXPIRED" });
    await expect(post("/api/tasks/fetchTasks")).rejects.toBeTruthy();
    expect(cached()).toBeUndefined();
  });
});

describe("refreshAccess", () => {
  const fresh = access({ isAdmin: true, modules: { leads: { view: true, add: false, edit: false, delete: false, reach: "Own" } } });
  const menu = [{ menuid: 1, parentid: 0, description: "Leads", image: null, route: "/sales/leads", formname: null, formclass: null, openStyle: null, permissions: { canView: true, canAdd: false, canEdit: false, canDelete: false }, groupName: null }];
  let now = 1_000_000;
  let fetchMyAccess: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(Date, "now").mockImplementation(() => now);
    fetchMyAccess = jest
      .spyOn(authQueries, "fetchMyAccess")
      .mockResolvedValue(envelope({ access: fresh, permissions: { menuItems: menu, rawPermissions: menu, totalMenuItems: 1 } }));
  });

  afterEach(() => jest.restoreAllMocks());

  it("stores the server's access and menu rights, keeping the login-only flag", async () => {
    state().login(loginData());
    now += 60_000;
    await state().refreshAccess();
    expect(fetchMyAccess).toHaveBeenCalledTimes(1);
    expect(state().access).toEqual(fresh);
    expect(state().permissions).toEqual({ menuItems: menu, rawPermissions: menu, totalMenuItems: 1, hasAdminAccess: false });
  });

  it("asks at most once a minute", async () => {
    seedAuth();
    await state().refreshAccess();
    now += 59_999;
    await state().refreshAccess();
    expect(fetchMyAccess).toHaveBeenCalledTimes(1);
    now += 1;
    await state().refreshAccess();
    expect(fetchMyAccess).toHaveBeenCalledTimes(2);
  });

  it("does not ask right after a login, which just brought access", async () => {
    state().login(loginData());
    await state().refreshAccess();
    expect(fetchMyAccess).not.toHaveBeenCalled();
  });

  it("does not ask when nobody is signed in", async () => {
    await state().refreshAccess();
    expect(fetchMyAccess).not.toHaveBeenCalled();
  });

  it("a reply without access keeps the access it had", async () => {
    fetchMyAccess.mockResolvedValue(envelope(null));
    state().login(loginData());
    now += 60_000;
    await state().refreshAccess();
    expect(state().access).toEqual(access());
  });

  it("a failed refresh keeps the access it had", async () => {
    fetchMyAccess.mockRejectedValue(new Error("Network Error"));
    state().login(loginData());
    now += 60_000;
    await state().refreshAccess();
    expect(state().access).toEqual(access());
  });

  it("while access is unknown, every foreground retries (no throttle)", async () => {
    fetchMyAccess.mockRejectedValue(new Error("Network Error"));
    seedAuth();
    await state().refreshAccess();
    await state().refreshAccess();
    expect(fetchMyAccess).toHaveBeenCalledTimes(2);
  });

  it("a cold start always asks, whatever stamp was saved", async () => {
    await AsyncStorage.setItem(
      "nexus-crm-auth",
      JSON.stringify({
        state: { API_BASE_URL: BASE, isClientConfigured: true, isAuthenticated: true, token: "tok-9", access: access(), accessCheckedAt: now },
        version: 0,
      }),
    );
    await useAuthStore.persist.rehydrate();
    await state().refreshAccess();
    expect(fetchMyAccess).toHaveBeenCalledTimes(1);
  });

  it("never saves the stamp", async () => {
    state().login(loginData());
    const saved = JSON.parse((await AsyncStorage.getItem("nexus-crm-auth")) ?? "{}");
    expect(saved.state.token).toBe("tok-1");
    expect(saved.state).not.toHaveProperty("accessCheckedAt");
  });

  describe("a reply that lands after the session changed is dropped", () => {
    let release: () => void;
    beforeEach(() => {
      fetchMyAccess.mockImplementation(
        () =>
          new Promise((resolve) => {
            release = () => resolve(envelope({ access: fresh, permissions: { menuItems: menu, rawPermissions: menu, totalMenuItems: 1 } }));
          }),
      );
    });

    it("logout mid-flight writes no access", async () => {
      seedAuth();
      const pending = state().refreshAccess();
      state().logout();
      release();
      await pending;
      expect(state()).toMatchObject({ access: null, permissions: null });
    });

    it("another user signing in mid-flight keeps their own access", async () => {
      seedAuth();
      const pending = state().refreshAccess();
      const theirs = access({ modules: { complaints: { view: true, add: false, edit: false, delete: false, reach: "Own" } } });
      state().login(loginData({ token: "tok-B", access: theirs }));
      release();
      await pending;
      expect(state().access).toEqual(theirs);
      expect(state().permissions?.rawPermissions).toEqual([]);
    });
  });
});

describe("a 401 from the API", () => {
  it.each(["TOKEN_EXPIRED", "INVALID_TOKEN"])(
    "%s logs the user out and keeps the server's code and message",
    async (code) => {
      seedAuth();
      fail(401, { code, message: `server says ${code}` });
      await expect(post("/api/tasks/fetchTasks")).rejects.toBeTruthy();
      expect(state()).toMatchObject({
        isAuthenticated: false,
        token: null,
        sessionEndedReason: code,
        sessionEndedMessage: `server says ${code}`,
      });
    },
  );

  it("a 401 without a code logs out without a reason", async () => {
    seedAuth();
    fail(401, {});
    await expect(post("/api/tasks/fetchTasks")).rejects.toBeTruthy();
    expect(state()).toMatchObject({ isAuthenticated: false, sessionEndedReason: null, sessionEndedMessage: null });
  });

  it("login clears the last end message", async () => {
    useAuthStore.setState({ sessionEndedReason: "SESSION_FORCED", sessionEndedMessage: "An admin ended your session." });
    state().login(loginData());
    expect(state()).toMatchObject({ sessionEndedReason: null, sessionEndedMessage: null });
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

describe("a closed session asks for the password instead of logging out", () => {
  afterEach(() => queryClient.clear());

  // The request is parked until the dialog settles; wait for the store to show it.
  // Wrapped in an object: an async function returning the bare promise would await it.
  const parkedOn = async (code: string, message?: string) => {
    fail(401, { code, message });
    const request = post("/api/tickets/saveTicket", { Title: "half typed" });
    await waitFor(() => expect(state().reauth).not.toBeNull());
    return { request };
  };

  it.each(["SESSION_ENDED", "SESSION_EXPIRED", "SESSION_FORCED", "SESSION_REQUIRED"])(
    "%s opens re-sign-in with the server's message and keeps the session and cache",
    async (code) => {
      seedAuth();
      queryClient.setQueryData(["tasks", "mine"], [{ Id: 1 }]);
      const { request } = await parkedOn(code, `server says ${code}`);
      expect(state()).toMatchObject({ isAuthenticated: true, reauth: { code, message: `server says ${code}` } });
      expect(queryClient.getQueryData(["tasks", "mine"])).toEqual([{ Id: 1 }]);
      state().logout();
      await expect(request).rejects.toBeTruthy();
    },
  );

  it("signing in again as the same person swaps the token, keeps the cache, and retries the request once", async () => {
    seedAuth({ UserId: 9 });
    queryClient.setQueryData(["tasks", "mine"], [{ Id: 1 }]);
    const { request } = await parkedOn("SESSION_EXPIRED");
    respond({ success: true, data: { saved: true } });
    state().resumeSession(loginData({ token: "tok-2" }));
    await expect(request).resolves.toMatchObject({ data: { saved: true } });
    expect(lastRequest().config.headers.Authorization).toBe("Bearer tok-2");
    expect(lastRequest().body).toEqual({ Title: "half typed" });
    expect(state()).toMatchObject({ isAuthenticated: true, token: "tok-2", reauth: null, UserId: 9, BranchId: 4 });
    expect(queryClient.getQueryData(["tasks", "mine"])).toEqual([{ Id: 1 }]);
  });

  it("a different person signing in gets a clean slate: full logout, cache cleared, request rejected", async () => {
    seedAuth({ UserId: 5 });
    queryClient.setQueryData(["tasks", "mine"], [{ Id: 1 }]);
    const { request } = await parkedOn("SESSION_EXPIRED");
    respond({ success: true, data: {} }); // a retry would succeed: only the user check stops it
    state().resumeSession(loginData()); // user 9
    await expect(request).rejects.toMatchObject({ response: { status: 401 } });
    expect(state()).toMatchObject({ isAuthenticated: false, token: null, reauth: null });
    expect(queryClient.getQueryData(["tasks", "mine"])).toBeUndefined();
  });

  it("a stale session 401 after logout opens nothing", async () => {
    fail(401, { code: "SESSION_EXPIRED" });
    await expect(post("/api/tasks/fetchTasks")).rejects.toBeTruthy();
    expect(state()).toMatchObject({ reauth: null, sessionEndedReason: null });
  });

  it("the dialog is never saved: a cold start with a dead token just 401s again", async () => {
    seedAuth();
    const { request } = await parkedOn("SESSION_EXPIRED");
    const saved = JSON.parse((await AsyncStorage.getItem("nexus-crm-auth")) ?? "{}");
    expect(saved.state).not.toHaveProperty("reauth");
    state().logout();
    await expect(request).rejects.toBeTruthy();
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

  it("keeps the session on a dev build, whose base URL is the override and never stored", async () => {
    await persist({ API_BASE_URL: null, isClientConfigured: true, isAuthenticated: true, token: "tok-9" });
    process.env.EXPO_PUBLIC_API_BASE_URL = "http://192.168.1.5:5001";
    let dev!: typeof useAuthStore;
    jest.isolateModules(() => {
      dev = require("./useAuthStore").default;
    });
    delete process.env.EXPO_PUBLIC_API_BASE_URL;
    await dev.persist.rehydrate();
    expect(dev.getState()).toMatchObject({ isClientConfigured: true, isAuthenticated: true, token: "tok-9" });
  });
});
