//src/hooks/useApi.js
import { useMemo } from "react";
import axios from "axios";
import useAuthStore from "../stores/useAuthStore";

const useApi = () => {
  const { API_BASE_URL, token, logout } = useAuthStore();

  const apiClient = useMemo(() => {
    // In dev, leave baseURL empty so requests go through Vite's proxy
    // (vite.config.js → http://localhost:5001). In prod, use the store URL.
    const baseURL = import.meta.env.DEV ? "" : API_BASE_URL;
    const client = axios.create({
      baseURL,
      headers: {
        "Content-Type": "application/json",
      },
    });

    // Request interceptor to add auth token and validate expiry
    client.interceptors.request.use(
      (config) => {
        // Debug: Log the actual URL being requested
        console.log('🚀 API Request:', config.baseURL + config.url);
        
        // Get fresh token state from store
        const currentState = useAuthStore.getState();
        const currentToken = currentState.token;
        
        if (currentToken) {
          // Check if token is expired before making request
          if (!currentState.checkTokenExpiry()) {
            console.warn('Token expired before request - blocking API call');
            return Promise.reject(new Error('Token expired'));
          }
          
          config.headers.Authorization = `Bearer ${currentToken}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor to handle auth errors
    client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          // Token expired or invalid
          console.warn('API returned 401 - token expired or invalid');
          logout();
          
          // Use navigate if available, otherwise fallback to window.location
          if (typeof window !== 'undefined') {
            window.location.href = "/login";
          }
        }
        return Promise.reject(error);
      }
    );

    return client;
  }, [API_BASE_URL, token, logout]);

  return apiClient;
};

export default useApi;
