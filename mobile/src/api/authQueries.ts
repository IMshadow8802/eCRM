// src/api/authQueries.ts
import { post } from "./client";
import type { Access, ApiEnvelope, LoginData, Permissions } from "../types/api";

export const AUTH_ENDPOINTS = {
  login: "/api/auth/loginUser",
  logout: "/api/auth/logoutUser",
  fetchMyAccess: "/api/auth/fetchMyAccess",
} as const;

/**
 * `identifier` accepts username, email or mobile — sp_ValidateUser resolves
 * all three. The backend still honours a legacy `username` key, but new
 * clients must send `identifier` or email/mobile login silently fails.
 *
 * Returns the full envelope: the caller needs token, user, company and
 * permissions together to seed the auth store.
 */
export const login = (params: {
  identifier: string;
  password: string;
}): Promise<ApiEnvelope<LoginData>> => post<LoginData>(AUTH_ENDPOINTS.login, { ...params, Device: "mobile" });

/** `token`: end that session rather than the current one (a sign-in the app is discarding). */
export const logout = (token?: string): Promise<ApiEnvelope<unknown>> =>
  post(AUTH_ENDPOINTS.logout, {}, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);

/**
 * The caller's role grants and menu rights, re-read so a role change reaches a
 * signed-in phone without a re-login (authController.fetchMyAccess). Same
 * shapes as login, except the menu payload has no `hasAdminAccess`.
 */
export const fetchMyAccess = (): Promise<
  ApiEnvelope<{ access: Access; permissions: Omit<Permissions, "hasAdminAccess"> }>
> => post(AUTH_ENDPOINTS.fetchMyAccess, {});
