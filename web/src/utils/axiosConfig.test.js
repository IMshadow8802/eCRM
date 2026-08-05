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
  enqueueSnackbar.mockClear();
  redirectToLogin.mockClear();
  useAuthStore.setState({ isAuthenticated: true, token: jwtExpiringAt(3600) });
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
