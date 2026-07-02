import axios from 'axios';
import { isTokenExpired, isTokenExpiringSoon } from './tokenUtils';
import { redirectToLogin } from './redirectToLogin';
import { shouldSkipAuthRedirect } from './authRedirectGuard';
import useAuthStore from '../stores/useAuthStore';
import { enqueueSnackbar } from 'notistack';

/**
 * Configure axios instance with token validation interceptors
 */
const createAxiosInstance = () => {
  const instance = axios.create({
    timeout: 30000,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  // Request interceptor - Add token and validate expiry
  instance.interceptors.request.use(
    (config) => {
      const { token, logout, API_BASE_URL } = useAuthStore.getState();

      // In dev, leave baseURL empty so requests are relative (e.g. `/api/...`)
      // and get forwarded by Vite's proxy → http://localhost:5001 (see
      // vite.config.js). In prod we use the persisted store URL.
      config.baseURL = import.meta.env.DEV ? "" : API_BASE_URL;
      
      if (token) {
        // Check if token is expired
        if (isTokenExpired(token)) {
          console.warn('Token expired, logging out...');
          logout();
          enqueueSnackbar('Session expired. Please login again.', { 
            variant: 'warning',
            autoHideDuration: 3000 
          });
          
          // Redirect to login page
          redirectToLogin();
          return Promise.reject(new Error('Token expired'));
        }

        // Check if token is expiring soon (within 5 minutes)
        if (isTokenExpiringSoon(token, 5)) {
          console.warn('Token expiring soon...');
          enqueueSnackbar('Your session will expire soon. Please save your work.', { 
            variant: 'info',
            autoHideDuration: 5000 
          });
        }

        // Add token to request headers
        config.headers.Authorization = `Bearer ${token}`;
      }

      return config;
    },
    (error) => {
      return Promise.reject(error);
    }
  );

  // Response interceptor - Handle token expiry responses
  instance.interceptors.response.use(
    (response) => {
      return response;
    },
    (error) => {
      const { logout } = useAuthStore.getState();
      
      // Handle 401 Unauthorized responses (skip for auth endpoints — bad-creds
      // 401 must surface to the caller, not trigger logout/redirect loop).
      if (error.response?.status === 401 && !shouldSkipAuthRedirect(error.config?.url)) {
        console.warn('Received 401 Unauthorized, logging out...');
        logout();
        enqueueSnackbar('Session expired. Please login again.', {
          variant: 'error',
          autoHideDuration: 3000
        });

        redirectToLogin();
        return Promise.reject(new Error('Authentication failed'));
      }

      // Handle 403 Forbidden responses
      if (error.response?.status === 403) {
        enqueueSnackbar('Access denied. You do not have permission to perform this action.', { 
          variant: 'error',
          autoHideDuration: 4000 
        });
      }

      // Handle network errors
      if (!error.response) {
        enqueueSnackbar('Network error. Please check your connection.', { 
          variant: 'error',
          autoHideDuration: 4000 
        });
      }

      return Promise.reject(error);
    }
  );

  return instance;
};

// Create and export the configured axios instance
export const apiClient = createAxiosInstance();

// Default export for backward compatibility
export default apiClient;