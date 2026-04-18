import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { authAPI } from "../services/api";

// Hook for login
export const useLogin = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ username, password }) => authAPI.login(username, password),
    onSuccess: async (data) => {
      // Store authentication data
      if (data.token) {
        await AsyncStorage.setItem("authToken", data.token);
        await AsyncStorage.setItem("userData", JSON.stringify(data.user));
      }

      // Clear any cached data from previous session
      queryClient.clear();

      console.log("Login successful:", data.user);
    },
    onError: (error) => {
      console.error("Login failed:", error.message);
    },
  });
};

// Hook for logout
export const useLogout = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => authAPI.logout(),
    onSuccess: async () => {
      // Clear stored data
      await AsyncStorage.removeItem("authToken");
      await AsyncStorage.removeItem("userData");

      // Clear all cached data
      queryClient.clear();

      console.log("Logout successful");
    },
    onError: (error) => {
      console.error("Logout failed:", error.message);
      // Even if logout API fails, clear local data
      AsyncStorage.removeItem("authToken");
      AsyncStorage.removeItem("userData");
      queryClient.clear();
    },
  });
};

// Hook to check if user is authenticated
export const useAuthCheck = () => {
  return {
    checkAuth: async () => {
      try {
        const token = await AsyncStorage.getItem("authToken");
        const userData = await AsyncStorage.getItem("userData");

        if (token && userData) {
          return {
            isAuthenticated: true,
            user: JSON.parse(userData),
            token,
          };
        }

        return {
          isAuthenticated: false,
          user: null,
          token: null,
        };
      } catch (error) {
        console.error("Error checking auth:", error);
        return {
          isAuthenticated: false,
          user: null,
          token: null,
        };
      }
    },
  };
};

export default {
  useLogin,
  useLogout,
  useAuthCheck,
};
