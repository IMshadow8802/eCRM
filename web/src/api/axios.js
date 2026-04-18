// src/api/axios.js
import axios from "axios";
import useAuthStore from "../stores/useAuthStore";

const resolveBaseURL = () =>
  import.meta.env.DEV ? "" : useAuthStore.getState().API_BASE_URL;

const createAxiosInstance = () => {
  const instance = axios.create({
    baseURL: resolveBaseURL(),
    headers: {
      "Content-Type": "application/json",
    },
  });

  // Re-resolve per request so dev/prod stays correct without a reload.
  instance.interceptors.request.use((config) => {
    config.baseURL = resolveBaseURL();
    return config;
  });

  // Add response interceptor for error handling
  instance.interceptors.response.use(
    (response) => response,
    (error) => {
      // Handle common errors here (401, 403, 500, etc.)
      if (error.response && error.response.status === 401) {
        // Handle unauthorized - could redirect to login
        useAuthStore.getState().logout();
        window.location.href = "/login";
      }
      return Promise.reject(error);
    }
  );

  return instance;
};

export const api = createAxiosInstance();
