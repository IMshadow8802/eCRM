import axios from 'axios';
import { isTokenExpired, isTokenExpiringSoon } from './tokenUtils';
import { shouldSkipAuthRedirect } from './authRedirectGuard';
import { endSession, isEndingSession } from './endSession';
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
      const { token, API_BASE_URL } = useAuthStore.getState();

      // In dev, leave baseURL empty so requests are relative (e.g. `/api/...`)
      // and get forwarded by Vite's proxy → http://localhost:5001 (see
      // vite.config.js). In prod we use the persisted store URL.
      config.baseURL = import.meta.env.DEV ? "" : API_BASE_URL;

      // Once the session is being torn down, nothing else goes out. This used
      // to be missing, and it is what made the storm self-sustaining: the
      // expiry check below sits inside `if (token)`, so after the first logout
      // nulled the token every later request skipped the check entirely, went
      // out with NO Authorization header, earned a fresh 401, and tripped the
      // response interceptor into logging out all over again.
      // Auth endpoints are exempt — the login form must still work.
      if (isEndingSession() && !shouldSkipAuthRedirect(config.url)) {
        return Promise.reject(new Error('Session ended'));
      }

      if (token) {
        // Check if token is expired
        if (isTokenExpired(token)) {
          endSession('Expired token on an outgoing request');
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
      // Handle 401 Unauthorized responses (skip for auth endpoints — bad-creds
      // 401 must surface to the caller, not trigger logout/redirect loop).
      // endSession is idempotent, so a burst of 401s tears down exactly once.
      if (error.response?.status === 401 && !shouldSkipAuthRedirect(error.config?.url)) {
        endSession('401 from the API');
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