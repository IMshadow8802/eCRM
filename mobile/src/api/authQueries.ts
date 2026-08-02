// src/api/authQueries.ts
import { post } from "./client";
import type { ApiEnvelope, LoginData } from "../types/api";

export const AUTH_ENDPOINTS = {
  login: "/api/auth/loginUser",
  logout: "/api/auth/logoutUser",
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
}): Promise<ApiEnvelope<LoginData>> => post<LoginData>(AUTH_ENDPOINTS.login, params);

export const logout = (): Promise<ApiEnvelope<unknown>> =>
  post(AUTH_ENDPOINTS.logout, {});
