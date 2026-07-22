//zustand/useAuthStore.js
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  getTokenRemainingTime,
  isTokenExpired,
  isTokenExpiringSoon,
  validateToken,
} from "../utils/tokenUtils";

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
        API_BASE_URL: "https://shadowcodes.in/CRM", // prod API (nginx → :5001)
        menuRights: initialState.permissions?.rawPermissions || [],
        activeMenuRights: null,

        setMenuRights: (rights) => set({ menuRights: rights }),
        setActiveMenuRights: (rights) => set({ activeMenuRights: rights }),

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
          set({
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
          });
        },

        // Enhanced logout with API call
        logoutWithApi: async (apiClient) => {
          try {
            // Call logout API if apiClient is provided
            if (apiClient) {
              await apiClient.post("/api/auth/logoutUser");
            }
          } catch (error) {
            console.error("Logout API error:", error);
            // Continue with logout even if API fails
          } finally {
            // Always clear local state
            get().logout();
          }
        },

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

        // Token validation methods
        checkTokenExpiry: () => {
          const state = get();
          if (!state.token) {
            return false;
          }

          if (isTokenExpired(state.token)) {
            console.warn("Token expired, logging out...");
            state.logout();
            return false;
          }
          return true;
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
          set({
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
          });
        },
      };
    },
    {
      name: "auth-storage-eCRM",
      storage: createJSONStorage(() => localStorage),
      // Bump whenever the persisted user/company shape changes so stale
      // sessions get wiped instead of silently returning undefined keys.
      // v2 = PascalCase canonical shape (matches tblUser columns).
      version: 2,
      migrate: () => undefined,
    }
  )
);

export default useAuthStore;
