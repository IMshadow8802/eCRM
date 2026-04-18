import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export const useAuthStore = create(
  persist(
    (set, get) => ({
      // State
      isAuthenticated: false,
      isLoading: false,
      token: null,
      user: null,
      company: null,
      permissions: null,
      loginTimestamp: null,

      // Actions
      login: (responseData) => {
        const { token, user, company, permissions } = responseData;
        set({
          isAuthenticated: true,
          token,
          user,
          company,
          permissions,
          loginTimestamp: Date.now(),
          isLoading: false,
        });
      },

      logout: () => {
        set({
          isAuthenticated: false,
          token: null,
          user: null,
          company: null,
          permissions: null,
          loginTimestamp: null,
          isLoading: false,
        });
      },

      setLoading: (loading) => {
        set({ isLoading: loading });
      },

      // Helper methods
      hasPermission: (permission) => {
        const { permissions, user } = get();
        if (!permissions) return false;

        // Super admin has all permissions
        if (user?.isadmin) return true;

        // Check specific permission in menuItems
        if (permissions.menuItems) {
          return permissions.menuItems.some(
            (item) =>
              item.description
                .toLowerCase()
                .includes(permission.toLowerCase()) && item.permissions?.canView
          );
        }

        return false;
      },

      isTokenValid: () => {
        const { token, loginTimestamp } = get();

        if (!token) {
          return false;
        }

        // If no timestamp, assume token is valid (for backwards compatibility)
        if (!loginTimestamp) {
          return true;
        }

        // Check if token is older than 24 hours (adjust as needed)
        const tokenAge = Date.now() - loginTimestamp;
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours

        return tokenAge < maxAge;
      },

      getUserRole: () => {
        const { user } = get();
        return user?.role || null;
      },

      clearAuth: () => {
        set({
          isAuthenticated: false,
          token: null,
          user: null,
          company: null,
          permissions: null,
          loginTimestamp: null,
          isLoading: false,
        });
      },
    }),
    {
      name: "auth-storage",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        isAuthenticated: state.isAuthenticated,
        token: state.token,
        user: state.user,
        company: state.company,
        permissions: state.permissions,
        loginTimestamp: state.loginTimestamp,
      }),
    }
  )
);
