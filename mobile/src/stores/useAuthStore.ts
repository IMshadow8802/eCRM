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

import { setAuthToken, setUnauthorizedHandler } from "../api/client";
import type { AuthUser, Company, LoginData, Permissions } from "../types/api";

interface AuthState {
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
      ...EMPTY,

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
      // Rehydration is async on AsyncStorage. The token must reach the api
      // client the moment it comes back, or the first request after a cold
      // start goes out unauthenticated and 401s the user straight to login.
      onRehydrateStorage: () => (state) => {
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
