//zustand/useAuthStore.js
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  getTokenRemainingTime,
  isTokenExpired,
  isTokenExpiringSoon,
  validateToken,
} from "../utils/tokenUtils";
import { isTrustedApiUrl } from "../config/central";

// Which backend this browser talks to. Filled by the company-code step on the
// login page from Central (see api/centralQueries.js) and persisted, so the
// code is typed once per browser. Null = ask for the code.
const CLIENT_EMPTY = {
  API_BASE_URL: null,
  compCode: null,
  companyName: null,
  logoURL: null,
  isClientConfigured: false,
};

const SESSION_EMPTY = {
  isAuthenticated: false,
  BranchId: null,
  CompId: null,
  UserId: null,
  token: null,
  user: null,
  company: null,
  permissions: null,
  loginTimestamp: null,
  menuRights: [],
  activeMenuRights: null,
};

const getUserDataFromLocalStorage = () => {
  const userData = JSON.parse(localStorage.getItem("userData"));
  const token = userData?.token || null;

  const isValidToken = token && !isTokenExpired(token);
  // Canonical user shape uses PascalCase Id. Pre-canonicalization sessions
  // stored camelCase (userid). Treat those as stale: wipe + force re-login.
  const hasCanonicalShape = Boolean(userData?.user?.Id);

  if (userData && !hasCanonicalShape) {
    localStorage.removeItem("userData");
  }

  const stateIsValid = isValidToken && hasCanonicalShape;

  return {
    isAuthenticated: !!userData && stateIsValid,
    token: stateIsValid ? token : null,
    user: stateIsValid ? userData?.user || null : null,
    company: stateIsValid ? userData?.company || null : null,
    permissions: stateIsValid ? userData?.permissions || null : null,
    BranchId: stateIsValid ? userData?.user?.BranchId ?? null : null,
    CompId: stateIsValid ? userData?.user?.CompId ?? null : null,
    UserId: stateIsValid ? userData?.user?.Id ?? null : null,
    loginTimestamp: stateIsValid ? userData?.loginTimestamp || null : null,
  };
};

const useAuthStore = create(
  persist(
    (set, get) => {
      const initialState = getUserDataFromLocalStorage();

      return {
        isAuthenticated: initialState.isAuthenticated,
        BranchId: initialState.BranchId,
        CompId: initialState.CompId,
        UserId: initialState.UserId,
        token: initialState.token,
        user: initialState.user,
        company: initialState.company,
        permissions: initialState.permissions,
        loginTimestamp: initialState.loginTimestamp,
        ...CLIENT_EMPTY,
        menuRights: initialState.permissions?.rawPermissions || [],
        activeMenuRights: null,

        setMenuRights: (rights) => set({ menuRights: rights }),
        setActiveMenuRights: (rights) => set({ activeMenuRights: rights }),

        setClientConfig: ({ baseURL, compCode, companyName, logoURL }) =>
          set({
            API_BASE_URL: baseURL,
            compCode: compCode ?? null,
            companyName: companyName ?? null,
            logoURL: logoURL ?? null,
            isClientConfigured: true,
          }),

        // "Switch company": a different backend means a different session too.
        clearClientConfig: () => {
          localStorage.removeItem("userData");
          set({ ...SESSION_EMPTY, ...CLIENT_EMPTY });
        },

        login: (responseData) => {
          const { token, user, company, permissions } = responseData;

          // Store login timestamp for additional validation
          const userData = {
            token,
            user,
            company,
            permissions,
            loginTimestamp: Date.now(),
          };
          localStorage.setItem("userData", JSON.stringify(userData));

          set({
            isAuthenticated: true,
            token,
            user,
            company,
            permissions,
            BranchId: user.BranchId,
            CompId: user.CompId,
            UserId: user.Id,
            loginTimestamp: userData.loginTimestamp,
            menuRights: permissions?.rawPermissions || [],
          });
        },

        // Merge a partial user patch (e.g. FullName/Avatar after a self-service
        // profile save) into state + persisted localStorage.
        updateUser: (patch) => {
          const user = { ...(get().user || {}), ...patch };
          const stored = JSON.parse(localStorage.getItem("userData") || "null");
          if (stored) {
            stored.user = { ...(stored.user || {}), ...patch };
            localStorage.setItem("userData", JSON.stringify(stored));
          }
          set({ user });
        },

        logout: () => {
          // Clear localStorage
          localStorage.removeItem("userData");

          // Reset all state
          set({ ...SESSION_EMPTY });
        },

        // ponytail: `logoutWithApi(apiClient)` lived here with zero callers —
        // TopNav owns the logout-then-clear flow and calls api/platformQueries'
        // `logoutUser` directly. Dropped rather than rewired, which also keeps
        // the store free of an import cycle back through axiosConfig.

        // Helper method to get current user data
        getCurrentUser: () => {
          const state = get();
          return state.user || getUserDataFromLocalStorage().user;
        },

        // Helper method to get user permissions
        getUserPermissions: () => {
          const state = get();
          return state.permissions || getUserDataFromLocalStorage().permissions;
        },

        // Helper method to check if user has specific permission
        hasPermission: (menuName, permission) => {
          const permissions = get().getUserPermissions();
          if (!permissions?.menuItems) return false;

          const menu = permissions.menuItems.find(
            (item) => item.description === menuName
          );
          return menu?.permissions?.[permission] || false;
        },

        // Helper method to get auth headers
        getAuthHeaders: () => {
          const state = get();
          return {
            Authorization: `Bearer ${state.token}`,
            "Content-Type": "application/json",
          };
        },

        // Helper method to refresh user data from localStorage
        refreshUserData: () => {
          const userData = getUserDataFromLocalStorage();
          set({
            isAuthenticated: userData.isAuthenticated,
            BranchId: userData.BranchId,
            CompId: userData.CompId,
            UserId: userData.UserId,
            token: userData.token,
            user: userData.user,
            company: userData.company,
            permissions: userData.permissions,
            loginTimestamp: userData.loginTimestamp,
            menuRights: userData.permissions?.menuItems || [],
          });
        },

        // Token validation methods.
        //
        // A QUESTION, not an action. This used to call state.logout() when it
        // found an expired token — so asking whether the session was still
        // good silently ended it, from a function named "check". That is what
        // let two logout paths interleave: the caller would get `false`, run
        // its own teardown, and be the SECOND one to clear the store. Ending
        // the session is endSession's job now, and only the caller decides.
        checkTokenExpiry: () => {
          const state = get();
          if (!state.token) return false;
          return !isTokenExpired(state.token);
        },

        isTokenExpiring: (minutesBeforeExpiry = 5) => {
          const state = get();
          return state.token
            ? isTokenExpiringSoon(state.token, minutesBeforeExpiry)
            : true;
        },

        getTokenRemainingSeconds: () => {
          const state = get();
          return state.token ? getTokenRemainingTime(state.token) : 0;
        },

        getTokenValidation: () => {
          const state = get();
          return state.token ? validateToken(state.token) : null;
        },

        // Force logout with reason
        forceLogout: (reason = "Session expired") => {
          console.warn(`Forced logout: ${reason}`);
          localStorage.removeItem("userData");
          set({ ...SESSION_EMPTY });
        },
      };
    },
    {
      name: "auth-storage-eCRM",
      storage: createJSONStorage(() => localStorage),
      // The session AND the company binding persist. The base URL is
      // rehydrated into every Authorization header, so `merge` below refuses
      // any stored URL that is not on a Central-hosted origin — a same-origin
      // localStorage write cannot redirect the token to another host.
      partialize: (s) => ({
        isAuthenticated: s.isAuthenticated,
        token: s.token,
        user: s.user,
        company: s.company,
        permissions: s.permissions,
        loginTimestamp: s.loginTimestamp,
        menuRights: s.menuRights,
        activeMenuRights: s.activeMenuRights,
        API_BASE_URL: s.API_BASE_URL,
        compCode: s.compCode,
        companyName: s.companyName,
        logoURL: s.logoURL,
        isClientConfigured: s.isClientConfigured,
      }),
      merge: (persisted, current) => {
        const p = persisted || {};
        const trusted = isTrustedApiUrl(p.API_BASE_URL);
        return { ...current, ...p, ...(trusted ? {} : CLIENT_EMPTY) };
      },
      // Bump whenever the persisted shape changes so stale sessions get wiped
      // instead of silently returning undefined keys.
      // v2 = PascalCase canonical shape. v3 = company binding (2026-09-16):
      // everyone re-enters their company code once. v4 = primaryColor dropped
      // (2026-09-17): merge spreads the persisted object, so without a bump a
      // stale session would re-add a key nothing declares any more.
      version: 4,
      migrate: () => undefined,
    }
  )
);

export default useAuthStore;
