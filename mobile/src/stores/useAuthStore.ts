// src/stores/useAuthStore.ts
// Mirrors web/src/stores/useAuthStore.js — same PascalCase shape, so anything
// learned on one client transfers to the other. Persisted to AsyncStorage.
//
// The token lives here AND in the api client (via setAuthToken). The client
// cannot import this store: src/api must stay store-free, or the cycle
// store -> client -> store breaks Metro. So the store pushes the token down;
// the client never reaches up.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { setApiBaseUrl, setAuthToken, setUnauthorizedHandler } from "../api/client";
import { DEV_API_BASE_URL, isTrustedApiUrl } from "../config/env";
import type { AuthUser, ClientConfig, Company, LoginData, Permissions } from "../types/api";

interface AuthState {
  // Which backend this install talks to — the company-code step fills it from
  // Central and it persists, so the code is typed once. Null = ask for it.
  API_BASE_URL: string | null;
  compCode: string | null;
  companyName: string | null;
  logoURL: string | null;
  isClientConfigured: boolean;
  setClientConfig: (cfg: ClientConfig) => void;
  /** "Switch company": a different backend means a different session too. */
  clearClientConfig: () => void;

  isAuthenticated: boolean;
  token: string | null;
  user: AuthUser | null;
  company: Company | null;
  permissions: Permissions | null;
  UserId: number | null;
  CompId: number | null;
  BranchId: number | null;
  loginTimestamp: number | null;
  login: (data: LoginData) => void;
  logout: () => void;
  updateUser: (patch: Partial<AuthUser>) => void;
  isAdmin: () => boolean;
}

const CLIENT_EMPTY = {
  API_BASE_URL: null,
  compCode: null,
  companyName: null,
  logoURL: null,
  // A dev build pointed at a laptop never asks for a code.
  isClientConfigured: DEV_API_BASE_URL != null,
} as const;

const EMPTY = {
  isAuthenticated: false,
  token: null,
  user: null,
  company: null,
  permissions: null,
  UserId: null,
  CompId: null,
  BranchId: null,
  loginTimestamp: null,
} as const;

const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      ...CLIENT_EMPTY,
      ...EMPTY,

      setClientConfig: (cfg) => {
        setApiBaseUrl(cfg.baseURL);
        set({
          API_BASE_URL: cfg.baseURL,
          compCode: cfg.compCode ?? null,
          companyName: cfg.companyName ?? null,
          logoURL: cfg.logoURL ?? null,
          isClientConfigured: true,
        });
      },

      clearClientConfig: () => {
        setAuthToken(null);
        setApiBaseUrl(null);
        set({ ...EMPTY, ...CLIENT_EMPTY });
      },

      login: ({ token, user, company, permissions }) => {
        setAuthToken(token);
        set({
          isAuthenticated: true,
          token,
          user,
          company,
          permissions,
          UserId: user?.Id ?? null,
          CompId: user?.CompId ?? null,
          BranchId: user?.BranchId ?? null,
          loginTimestamp: Date.now(),
        });
      },

      logout: () => {
        setAuthToken(null);
        set({ ...EMPTY });
      },

      updateUser: (patch) => {
        const current = get().user;
        if (current) set({ user: { ...current, ...patch } });
      },

      isAdmin: () => Boolean(get().user?.IsAdmin),
    }),
    {
      name: "nexus-crm-auth",
      storage: createJSONStorage(() => AsyncStorage),
      // Only a base URL on a Central-hosted origin survives a reload; anything
      // else (a tampered AsyncStorage value) drops the company binding AND the
      // session, since the token would otherwise be sent to that host.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AuthState>;
        const trusted = isTrustedApiUrl(p.API_BASE_URL);
        return {
          ...current,
          ...p,
          ...(trusted ? { isClientConfigured: DEV_API_BASE_URL != null || !!p.isClientConfigured } : { ...EMPTY, ...CLIENT_EMPTY }),
        };
      },
      // Rehydration is async on AsyncStorage. The base URL and token must reach
      // the api client the moment they come back, or the first request after a
      // cold start goes out to nowhere / unauthenticated and 401s the user.
      onRehydrateStorage: () => (state) => {
        if (state?.API_BASE_URL) setApiBaseUrl(state.API_BASE_URL);
        if (state?.token) setAuthToken(state.token);
      },
    },
  ),
);

// A 401 on any non-auth endpoint means the token is dead — drop the session so
// the navigator falls back to login. Registered once at module load.
setUnauthorizedHandler(() => {
  useAuthStore.getState().logout();
});

export default useAuthStore;
