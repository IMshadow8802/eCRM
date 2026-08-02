// src/api/client.ts
// The single axios instance every fetcher in src/api/ goes through.
//
// Nothing outside src/api/ may import this. Screens call named fetchers; if a
// screen needs an endpoint that has no fetcher, the fix is a new fetcher, not
// an inline post. That rule is the whole reason this layer exists — when a
// payload changes there is exactly one file to open.
import axios, { type AxiosRequestConfig } from "axios";

import { API_BASE_URL, REQUEST_TIMEOUT_MS } from "../config/env";
import type { ApiEnvelope } from "../types/api";

// Set by the auth store at startup and on login/logout. The store is NOT
// imported here: src/api must stay free of store imports, or the cycle
// (store -> client -> store) breaks Metro's module graph.
let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export const setAuthToken = (token: string | null): void => {
  authToken = token || null;
};

export const getAuthToken = (): string | null => authToken;

/** Registered once by the auth store; invoked when the API rejects our token. */
export const setUnauthorizedHandler = (handler: (() => void) | null): void => {
  onUnauthorized = handler;
};

// A 401 from the login endpoint means "wrong password" — it must show an error
// on the login form, not trigger the session-expired logout path. Mirrors
// web/src/utils/authRedirectGuard.js.
const AUTH_ENDPOINTS = ["/api/auth/loginUser", "/api/auth/logoutUser"];

export const shouldSkipAuthRedirect = (url = ""): boolean =>
  AUTH_ENDPOINTS.some((endpoint) => String(url).includes(endpoint));

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: REQUEST_TIMEOUT_MS,
  headers: { "Content-Type": "application/json" },
});

apiClient.interceptors.request.use((config) => {
  if (authToken) {
    config.headers.Authorization = `Bearer ${authToken}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    if (status === 401 && !shouldSkipAuthRedirect(error?.config?.url)) {
      onUnauthorized?.();
    }
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
