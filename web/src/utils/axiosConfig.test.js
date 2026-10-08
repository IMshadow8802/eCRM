import { describe, it, expect, beforeEach, vi } from "vitest";

const enqueueSnackbar = vi.fn();
vi.mock("notistack", () => ({ enqueueSnackbar: (...a) => enqueueSnackbar(...a) }));

const redirectToLogin = vi.fn();
vi.mock("./redirectToLogin", () => ({
  redirectToLogin: (...a) => redirectToLogin(...a),
  getLoginUrl: () => "/login",
}));

import { apiClient } from "./axiosConfig";
import { resetEndSessionForTests, isEndingSession } from "./endSession";
import useAuthStore from "../stores/useAuthStore";
import { cancelReauth, requestReauth, resetReauthForTests, resolveReauth } from "./reauth";

/** A JWT the client will read as expired. Only the payload is ever decoded. */
const b64 = (o) =>
  btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwtExpiringAt = (secondsFromNow) =>
  `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
    exp: Math.floor(Date.now() / 1000) + secondsFromNow,
  })}.sig`;

/**
 * Run the request interceptor exactly as axios would — including the `headers`
 * object axios always supplies, which the interceptor writes the token into.
 */
const runRequest = ({ url = "/api/tasks/fetchTasks", ...rest } = {}) => {
  const { fulfilled } = apiClient.interceptors.request.handlers[0];
  return fulfilled({ url, headers: {}, ...rest });
};

/** Run the response interceptor's error path. */
const runResponseError = (error) => {
  const { rejected } = apiClient.interceptors.response.handlers[0];
  return rejected(error);
};

const unauthorized = (url) => ({ response: { status: 401 }, config: { url } });

beforeEach(() => {
  resetEndSessionForTests();
  resetReauthForTests();
  enqueueSnackbar.mockClear();
  redirectToLogin.mockClear();
  useAuthStore.setState({
    isAuthenticated: true,
    token: jwtExpiringAt(3600),
    user: { Id: 1, Username: "alice" },
    reauth: null,
  });
});

describe("request interceptor", () => {
  it("attaches the token while the session is good", async () => {
    const config = await runRequest();
    expect(config.headers.Authorization).toMatch(/^Bearer /);
  });

  it("ends the session on an expired token instead of sending the request", async () => {
    useAuthStore.setState({ token: jwtExpiringAt(-60) });
    await expect(runRequest()).rejects.toThrow("Token expired");
    expect(redirectToLogin).toHaveBeenCalledOnce();
  });

  /**
   * THE regression, and the reason the storm sustained itself.
   *
   * The expiry check lives inside `if (token)`. Once the first teardown nulled
   * the token, every later request skipped the check entirely, went out with
   * NO Authorization header, earned a fresh 401 from the API, and tripped the
   * response interceptor into tearing down all over again — one hard redirect
   * per in-flight query, each restarting the last one's navigation.
   */
  it("refuses to send anything once a teardown has started", async () => {
    useAuthStore.setState({ token: jwtExpiringAt(-60) });
    await expect(runRequest()).rejects.toThrow("Token expired");
    expect(isEndingSession()).toBe(true);

    // The token is gone now, exactly as it was in the bug.
    expect(useAuthStore.getState().token).toBeNull();
    await expect(runRequest()).rejects.toThrow("Session ended");
    await expect(runRequest()).rejects.toThrow("Session ended");

    // Still one redirect, however many callers tried.
    expect(redirectToLogin).toHaveBeenCalledOnce();
  });

  it("still lets the login request through mid-teardown", async () => {
    useAuthStore.setState({ token: jwtExpiringAt(-60) });
    await expect(runRequest()).rejects.toThrow("Token expired");

    // Otherwise signing back in would be impossible without a manual reload.
    const config = await runRequest({ url: "/api/auth/loginUser" });
    expect(config).toBeTruthy();
  });
});

describe("response interceptor", () => {
  it("tears down once for a burst of 401s", async () => {
    const burst = Array.from({ length: 12 }, () =>
      runResponseError(unauthorized("/api/tasks/fetchTasks")).catch((e) => e),
    );
    await Promise.all(burst);

    expect(redirectToLogin).toHaveBeenCalledOnce();
    expect(enqueueSnackbar).toHaveBeenCalledOnce();
  });

  it("lets a bad-credentials 401 reach the login form untouched", async () => {
    await runResponseError(unauthorized("/api/auth/loginUser")).catch(() => {});
    expect(redirectToLogin).not.toHaveBeenCalled();
    expect(isEndingSession()).toBe(false);
  });
});

describe("session 401s re-sign in over the page (spec D7)", () => {
  // The retry goes through the real instance; this adapter stands in for the
  // network and echoes the Authorization header it was sent with.
  const adapter = vi.fn(async (config) => ({
    data: { sentWith: config.headers.Authorization },
    status: 200,
    statusText: "OK",
    headers: {},
    config,
  }));
  const sessionError = (url, code = "SESSION_EXPIRED", extra = {}) => ({
    response: { status: 401, data: { code } },
    config: { url, headers: {}, adapter, ...extra },
  });
  const signBackIn = () => {
    const fresh = jwtExpiringAt(7200);
    useAuthStore.setState({ token: fresh });
    resolveReauth(fresh);
    return fresh;
  };

  beforeEach(() => {
    adapter.mockClear();
  });

  it("queues two parallel 401s into one dialog and retries both once", async () => {
    const a = runResponseError(sessionError("/api/tasks/a"));
    const b = runResponseError(sessionError("/api/tasks/b", "SESSION_FORCED"));
    await vi.waitFor(() =>
      expect(useAuthStore.getState().reauth).toEqual({ code: "SESSION_EXPIRED", username: "alice" }),
    );
    expect(adapter).not.toHaveBeenCalled();

    const fresh = signBackIn();
    const [ra, rb] = await Promise.all([a, b]);
    expect(adapter).toHaveBeenCalledTimes(2);
    expect(ra.data.sentWith).toBe(`Bearer ${fresh}`);
    expect(rb.data.sentWith).toBe(`Bearer ${fresh}`);
    expect(redirectToLogin).not.toHaveBeenCalled();
  });

  // Regression (review fix 1): a slow request sent with the OLD token whose
  // 401 lands after the person already signed back in used to open a second
  // dialog and ask for the password again.
  it("a late 401 from the old token retries with the current one, no second dialog", async () => {
    const old = useAuthStore.getState().token;
    const first = runResponseError(sessionError("/api/tasks/a"));
    await vi.waitFor(() => expect(useAuthStore.getState().reauth).not.toBeNull());
    const fresh = signBackIn();
    await first;
    adapter.mockClear();

    const late = sessionError("/api/reports/slow");
    late.config.headers.Authorization = `Bearer ${old}`;
    const res = await runResponseError(late);
    expect(useAuthStore.getState().reauth).toBeNull();
    expect(adapter).toHaveBeenCalledOnce();
    expect(res.data.sentWith).toBe(`Bearer ${fresh}`);
  });

  it("a retried request that 401s again ends the session", async () => {
    const err = sessionError("/api/tasks/a", "SESSION_EXPIRED", { _retried: true });
    await expect(runResponseError(err)).rejects.toThrow("Authentication failed");
    expect(redirectToLogin).toHaveBeenCalledOnce();
    expect(useAuthStore.getState().reauth).toBeNull();
  });

  it("a non-session 401 still ends the session", async () => {
    const err = sessionError("/api/tasks/a", "INVALID_TOKEN");
    await expect(runResponseError(err)).rejects.toThrow("Authentication failed");
    expect(redirectToLogin).toHaveBeenCalledOnce();
  });

  it("a 503 SESSION_CHECK_FAILED is an ordinary error, not a sign-out", async () => {
    const err = { response: { status: 503, data: { code: "SESSION_CHECK_FAILED" } }, config: { url: "/api/x" } };
    await expect(runResponseError(err)).rejects.toBe(err);
    expect(useAuthStore.getState().reauth).toBeNull();
    expect(redirectToLogin).not.toHaveBeenCalled();
  });

  it("holds new requests while the dialog is open, then sends them with the new token", async () => {
    requestReauth("SESSION_EXPIRED");
    let settled = false;
    const p = runRequest().then((c) => {
      settled = true;
      return c;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    const fresh = signBackIn();
    const config = await p;
    expect(config.headers.Authorization).toBe(`Bearer ${fresh}`);
  });

  it("lets the sign-in request through while the dialog is open", async () => {
    requestReauth("SESSION_EXPIRED");
    const config = await runRequest({ url: "/api/auth/loginUser" });
    expect(config.url).toBe("/api/auth/loginUser");
  });

  it("a non-session 401 while the dialog is open still tears down hard", async () => {
    requestReauth("SESSION_EXPIRED");
    const err = sessionError("/api/tasks/a", "INVALID_TOKEN");
    await expect(runResponseError(err)).rejects.toThrow("Authentication failed");
    expect(redirectToLogin).toHaveBeenCalledOnce();
  });

  it("cancelling rejects the held requests and ends the session", async () => {
    const held = runResponseError(sessionError("/api/tasks/a"));
    await vi.waitFor(() => expect(useAuthStore.getState().reauth).not.toBeNull());
    cancelReauth();
    await expect(held).rejects.toThrow("Re-sign-in cancelled");
    expect(adapter).not.toHaveBeenCalled();
    expect(redirectToLogin).toHaveBeenCalledOnce();
  });
});
