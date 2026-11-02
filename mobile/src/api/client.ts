// src/api/client.ts
// The single axios instance every fetcher in src/api/ goes through.
//
// Nothing outside src/api/ may import this. Screens call named fetchers; if a
// screen needs an endpoint that has no fetcher, the fix is a new fetcher, not
// an inline post. That rule is the whole reason this layer exists — when a
// payload changes there is exactly one file to open.
import axios, { type AxiosRequestConfig } from "axios";

import { DEV_API_BASE_URL, REQUEST_TIMEOUT_MS } from "../config/env";
import type { ApiEnvelope } from "../types/api";

// Set by the auth store at startup and on login/logout. The store is NOT
// imported here: src/api must stay free of store imports, or the cycle
// (store -> client -> store) breaks Metro's module graph.
let authToken: string | null = null;
let onUnauthorized: ((code?: string, message?: string) => void) | null = null;

// Which backend this install talks to. Pushed down by the auth store after the
// company-code step (and on rehydrate), same pattern as the token. The dev
// override always wins so a laptop build never asks Central.
let apiBaseUrl: string | null = DEV_API_BASE_URL;

export const setApiBaseUrl = (url: string | null): void => {
  apiBaseUrl = DEV_API_BASE_URL ?? url ?? null;
};

export const getApiBaseUrl = (): string | null => apiBaseUrl;

// Bumped on every sign-out. A request carries the lineage it was sent in; a
// 401 from an earlier one belongs to a session that is gone and must never be
// replayed with (or sign out) whoever signed in since. A same-user re-sign-in
// swaps the token without a sign-out, so it keeps the lineage.
let lineage = 0;

export const setAuthToken = (token: string | null): void => {
  if (!token) lineage += 1;
  authToken = token || null;
};

export const getAuthToken = (): string | null => authToken;

/** Registered once by the auth store; invoked when the API rejects our token. */
export const setUnauthorizedHandler = (handler: ((code?: string, message?: string) => void) | null): void => {
  onUnauthorized = handler;
};

// A closed server session (CLAUDE.md §3 Sessions) can be saved by signing in
// again over the screen; a bad/expired JWT cannot. Mirrors web/src/utils/reauth.js.
export const SESSION_CODES = ["SESSION_REQUIRED", "SESSION_EXPIRED", "SESSION_FORCED", "SESSION_ENDED"];

// Wired by the auth store: shows the re-sign-in dialog and resolves with the
// new token (rejects when the person signs in as someone else).
let reauthHandler: ((code: string, message?: string) => Promise<string>) | null = null;
// One dialog for a burst of 401s: every request in it awaits this.
let reauthInFlight: Promise<string> | null = null;

export const setReauthHandler = (handler: typeof reauthHandler): void => {
  reauthHandler = handler;
};

// A 401 from the login endpoint means "wrong password" — it must show an error
// on the login form, not trigger the session-expired logout path. Mirrors
// web/src/utils/authRedirectGuard.js.
const AUTH_ENDPOINTS = ["/api/auth/loginUser", "/api/auth/logoutUser"];

export const shouldSkipAuthRedirect = (url = ""): boolean =>
  AUTH_ENDPOINTS.some((endpoint) => String(url).includes(endpoint));

export const apiClient = axios.create({
  timeout: REQUEST_TIMEOUT_MS,
  headers: { "Content-Type": "application/json" },
});

apiClient.interceptors.request.use((config) => {
  // Per request, not at create time: the base URL is not known until the
  // company code has been verified, and "Switch company" changes it.
  if (apiBaseUrl) {
    config.baseURL = apiBaseUrl;
  }
  if (authToken) {
    config.headers.Authorization = `Bearer ${authToken}`;
  }
  (config as typeof config & { _lineage?: number })._lineage = lineage;
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error?.config;
    if (error?.response?.status !== 401 || shouldSkipAuthRedirect(config?.url)) return Promise.reject(error);
    if (config?._lineage !== lineage) return Promise.reject(error);
    const { code, message } = error.response.data ?? {};
    // `_retried` survives axios's config merge on the retry, so a second 401 is final.
    if (reauthHandler && config && !config._retried && SESSION_CODES.includes(code)) {
      // Sent with an older token than we now hold (in flight across a re-sign-in)?
      // Retry with the current one rather than asking for the password twice.
      const sent = config.headers?.Authorization;
      const stale = Boolean(authToken && sent && sent !== `Bearer ${authToken}`);
      try {
        const handler = reauthHandler;
        const token = stale
          ? authToken
          : await (reauthInFlight ??= handler(code, message).finally(() => {
              reauthInFlight = null;
            }));
        config._retried = true;
        config.headers.Authorization = `Bearer ${token}`;
        return apiClient(config);
      } catch {
        // Signed in as someone else: the store has already ended the session.
        return Promise.reject(error);
      }
    }
    onUnauthorized?.(code, message);
    return Promise.reject(error);
  },
);

/**
 * Every endpoint is POST and every response is the standard envelope.
 * Returns the whole envelope — use when the caller needs `message` or the
 * top-level `data` object rather than one collection out of it.
 */
export const post = <T = unknown>(
  endpoint: string,
  payload: unknown = {},
  config?: AxiosRequestConfig,
): Promise<ApiEnvelope<T>> =>
  apiClient
    .post<ApiEnvelope<T>>(endpoint, payload, config)
    .then((res) => res.data);

/**
 * Unwraps `data[key]`, defaulting to `[]`. The API nests every collection
 * under a resource name (`data.tasks`, `data.workspaces`, …), and a failed or
 * empty fetch omits it entirely — so this never hands back undefined.
 */
export const postData = <T>(
  endpoint: string,
  payload: unknown,
  key: string,
): Promise<T[]> =>
  post<Record<string, T[]>>(endpoint, payload).then(
    (body) => body?.data?.[key] ?? [],
  );

export default apiClient;
