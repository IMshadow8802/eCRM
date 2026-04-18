import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { enqueueSnackbar } from 'notistack';
import useAuthStore from '../stores/useAuthStore';

/**
 * Custom hook to monitor token expiry and handle automatic logout
 * @param {Object} options - Configuration options
 * @param {number} options.checkInterval - Interval in milliseconds to check token (default: 60000 = 1 minute)
 * @param {number} options.warningMinutes - Minutes before expiry to show warning (default: 5)
 * @param {boolean} options.autoLogout - Whether to automatically logout when expired (default: true)
 */
export const useTokenMonitor = (options = {}) => {
  const {
    checkInterval = 60000, // 1 minute
    warningMinutes = 5,
    autoLogout = true
  } = options;

  const navigate = useNavigate();
  const intervalRef = useRef(null);
  const warningShownRef = useRef(false);
  
  const { 
    token, 
    isAuthenticated, 
    checkTokenExpiry, 
    isTokenExpiring, 
    getTokenRemainingSeconds,
    forceLogout 
  } = useAuthStore();

  useEffect(() => {
    // Don't monitor if not authenticated
    if (!isAuthenticated || !token) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      warningShownRef.current = false;
      return;
    }

    // Initial check
    if (!checkTokenExpiry()) {
      if (autoLogout) {
        enqueueSnackbar('Session expired. Please login again.', { 
          variant: 'error',
          autoHideDuration: 3000 
        });
        forceLogout('Token expired');
        navigate('/login');
      }
      return;
    }

    // Set up periodic checking
    intervalRef.current = setInterval(() => {
      // Check if token is expired
      if (!checkTokenExpiry()) {
        if (autoLogout) {
          enqueueSnackbar('Session expired. Please login again.', { 
            variant: 'error',
            autoHideDuration: 3000 
          });
          forceLogout('Token expired during monitoring');
          navigate('/login');
        }
        return;
      }

      // Check if token is expiring soon and show warning once
      if (isTokenExpiring(warningMinutes) && !warningShownRef.current) {
        const remainingSeconds = getTokenRemainingSeconds();
        const remainingMinutes = Math.ceil(remainingSeconds / 60);
        
        enqueueSnackbar(
          `Your session will expire in ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}. Please save your work.`, 
          { 
            variant: 'warning',
            autoHideDuration: 8000,
            preventDuplicate: true
          }
        );
        warningShownRef.current = true;
      }

      // Reset warning flag if token is refreshed or has more time
      if (!isTokenExpiring(warningMinutes)) {
        warningShownRef.current = false;
      }
    }, checkInterval);

    // Cleanup on unmount or dependency change
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [
    isAuthenticated, 
    token, 
    checkInterval, 
    warningMinutes, 
    autoLogout, 
    navigate,
    checkTokenExpiry,
    isTokenExpiring,
    getTokenRemainingSeconds,
    forceLogout
  ]);

  // Handle page visibility change - check token when user returns to tab
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && isAuthenticated && token) {
        // User returned to the tab, check token immediately
        if (!checkTokenExpiry()) {
          if (autoLogout) {
            enqueueSnackbar('Session expired while you were away. Please login again.', { 
              variant: 'error',
              autoHideDuration: 4000 
            });
            forceLogout('Token expired while away');
            navigate('/login');
          }
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isAuthenticated, token, autoLogout, navigate, checkTokenExpiry, forceLogout]);

  // Handle page focus - similar to visibility change
  useEffect(() => {
    const handleFocus = () => {
      if (isAuthenticated && token) {
        // Check token when page gains focus
        if (!checkTokenExpiry()) {
          if (autoLogout) {
            enqueueSnackbar('Session expired. Please login again.', { 
              variant: 'error',
              autoHideDuration: 3000 
            });
            forceLogout('Token expired on focus');
            navigate('/login');
          }
        }
      }
    };

    window.addEventListener('focus', handleFocus);
    
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, [isAuthenticated, token, autoLogout, navigate, checkTokenExpiry, forceLogout]);

  return {
    isTokenExpiring: isTokenExpiring(warningMinutes),
    remainingSeconds: getTokenRemainingSeconds(),
    checkTokenExpiry: () => checkTokenExpiry(),
    forceLogout
  };
};