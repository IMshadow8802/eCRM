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

import { fetchMyAccess, logout as logoutRequest } from "../api/authQueries";
import { setApiBaseUrl, setAuthToken, setReauthHandler, setUnauthorizedHandler } from "../api/client";
import { queryClient } from "../api/queryClient";
import { DEV_API_BASE_URL, isTrustedApiUrl } from "../config/env";
import type { Access, AuthUser, ClientConfig, Company, LoginData, Permissions } from "../types/api";

/** Access is re-read at most this often (web/src/utils/refreshAccess.js). */
const ACCESS_REFRESH_MS = 60_000;

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
  /** Role grants from the server; `isAdmin` lives here, never on `user`. Null until known. */
  access: Access | null;
  /** When access was last asked for (login counts), for the once-a-minute throttle. */
  accessCheckedAt: number | null;
  /** Re-reads access + menu rights; skipped when signed out or asked within the last minute. */
  refreshAccess: () => Promise<void>;
  UserId: number | null;
  CompId: number | null;
  BranchId: number | null;
  loginTimestamp: number | null;
  /** When the server session ends (ISO), from login and every heartbeat (G22). Null = unknown. */
  sessionExpiresAt: string | null;
  /** A heartbeat answered with a new expiry; a null answer keeps the last known one. */
  noteSessionExpiry: (expiresAt: string | null | undefined) => void;
  /** Why the last session ended server-side (a 401 `code`); shown on the login screen. */
  sessionEndedReason: string | null;
  /** The server's own wording for that 401, shown before any local fallback. */
  sessionEndedMessage: string | null;
  /** A closed session waiting on the re-sign-in dialog (never persisted). */
  reauth: { code: string; message: string | null } | null;
  /** Re-sign-in answered: same person resumes in place; anyone else gets a full logout. */
  resumeSession: (data: LoginData) => void;
  /** Login said the one-time presence notice has not been acknowledged. */
  presenceNotice: boolean;
  ackPresenceNotice: () => void;
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
  access: null,
  accessCheckedAt: null,
  UserId: null,
  CompId: null,
  BranchId: null,
  loginTimestamp: null,
  sessionExpiresAt: null,
  presenceNotice: false,
  reauth: null,
} as const;

// The dialog's answer for the requests parked in the api client. Module-level:
// a promise cannot live in persisted state.
let pendingReauth: { resolve: (token: string) => void; reject: (err: Error) => void } | null = null;

const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      ...CLIENT_EMPTY,
      ...EMPTY,
      sessionEndedReason: null,
      sessionEndedMessage: null,

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
        queryClient.clear();
        set({ ...EMPTY, ...CLIENT_EMPTY });
      },

      login: ({ token, user, company, permissions, access, presenceNotice, sessionExpiresAt }) => {
        setAuthToken(token);
        // The previous user's (or company's) cached tasks, complaints and inbox must not show.
        queryClient.clear();
        set({
          isAuthenticated: true,
          token,
          user,
          company,
          permissions,
          access: access ?? null,
          accessCheckedAt: access ? Date.now() : null,
          UserId: user?.Id ?? null,
          CompId: user?.CompId ?? null,
          BranchId: user?.BranchId ?? null,
          loginTimestamp: Date.now(),
          sessionExpiresAt: sessionExpiresAt ?? null,
          sessionEndedReason: null,
          sessionEndedMessage: null,
          presenceNotice: Boolean(presenceNotice),
        });
      },

      ackPresenceNotice: () => set({ presenceNotice: false }),

      noteSessionExpiry: (expiresAt) => {
        if (expiresAt && get().isAuthenticated) set({ sessionExpiresAt: expiresAt });
      },

      logout: () => {
        // Parked requests fail with their original 401; the navigator drops to login.
        pendingReauth?.reject(new Error("Signed out"));
        pendingReauth = null;
        setAuthToken(null);
        queryClient.clear();
        set({ ...EMPTY });
      },

      resumeSession: (data) => {
        // A different person must not inherit this screen or its parked requests.
        if (Number(data.user?.Id) !== Number(get().UserId)) {
          get().logout();
          // Their sign-in just minted a server session we are throwing away: end it.
          // After logout(), so the client holds no token to overwrite this one.
          logoutRequest(data.token).catch(() => {});
          return;
        }
        // Not login(): that clears the query cache, and the screen underneath is still using it.
        setAuthToken(data.token);
        set({
          token: data.token,
          user: data.user,
          // Same person, but an admin may have moved their office meanwhile.
          BranchId: data.user?.BranchId ?? get().BranchId,
          company: data.company,
          permissions: data.permissions,
          access: data.access ?? get().access,
          accessCheckedAt: data.access ? Date.now() : get().accessCheckedAt,
          loginTimestamp: Date.now(),
          sessionExpiresAt: data.sessionExpiresAt ?? null,
          presenceNotice: Boolean(data.presenceNotice),
          reauth: null,
        });
        pendingReauth?.resolve(data.token);
        pendingReauth = null;
      },

      refreshAccess: async () => {
        const { isAuthenticated, accessCheckedAt, access, UserId } = get();
        if (!isAuthenticated) return;
        // Unknown access (an old saved session, a failed first ask) retries on every foreground.
        if (access && accessCheckedAt != null && Date.now() - accessCheckedAt < ACCESS_REFRESH_MS) return;
        // Stamped before the call so a second foreground mid-request does not ask again.
        set({ accessCheckedAt: Date.now() });
        try {
          const { data } = await fetchMyAccess();
          // A reply that lands after logout or another person's sign-in is not theirs. The
          // same person re-signing in (only the token changed) still takes it.
          if (!data?.access || !get().isAuthenticated || get().UserId !== UserId) return;
          set({
            access: data.access,
            permissions: { hasAdminAccess: false, ...get().permissions, ...data.permissions },
          });
        } catch {
          // Keep what we had; a dead session is the 401 handler's job.
        }
      },

      updateUser: (patch) => {
        const current = get().user;
        if (current) set({ user: { ...current, ...patch } });
      },

      isAdmin: () => Boolean(get().access?.isAdmin),
    }),
    {
      name: "nexus-crm-auth",
      storage: createJSONStorage(() => AsyncStorage),
      // The throttle stamp is per process: a cold start always re-reads access, as the web does on load.
      // The dialog is per process too: its parked requests died with the old one.
      partialize: ({ accessCheckedAt: _, reauth: __, ...rest }) => rest,
      // Only a base URL on a Central-hosted origin survives a reload; anything
      // else (a tampered AsyncStorage value) drops the company binding AND the
      // session, since the token would otherwise be sent to that host.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AuthState>;
        // A dev build never stores a base URL (the override is used instead), so it is trusted as is.
        const trusted = DEV_API_BASE_URL != null || isTrustedApiUrl(p.API_BASE_URL);
        return {
          ...current,
          ...p,
          accessCheckedAt: null,
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
setUnauthorizedHandler((code, message) => {
  const { isAuthenticated, logout } = useAuthStore.getState();
  // Only a live session has a reason to report; a stale 401 after logout must
  // not paint one on the login screen.
  if (isAuthenticated && code) {
    useAuthStore.setState({ sessionEndedReason: code, sessionEndedMessage: message || null });
  }
  logout();
});

// A closed server session (SESSION_* codes) is saved by signing in again over
// the screen; the client parks every request in the burst on this one promise.
setReauthHandler((code, message) => {
  if (!useAuthStore.getState().isAuthenticated) return Promise.reject(new Error("Signed out"));
  return new Promise<string>((resolve, reject) => {
    pendingReauth = { resolve, reject };
    useAuthStore.setState({ reauth: { code, message: message || null } });
  });
});

export default useAuthStore;
