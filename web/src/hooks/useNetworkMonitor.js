import { useState, useEffect, useRef } from 'react';

// Try to import notistack, but handle if it's not available
let enqueueSnackbar, closeSnackbar;
try {
  const notistack = require('notistack');
  enqueueSnackbar = notistack.enqueueSnackbar;
  closeSnackbar = notistack.closeSnackbar;
} catch (error) {
  enqueueSnackbar = (message, options) => {
    return Date.now(); // Return a mock key
  };
  closeSnackbar = (key) => {
  };
}

/**
 * Custom hook to monitor network connectivity status
 * Shows persistent notification when offline, removes when back online
 * @param {Object} options - Configuration options
 * @param {boolean} options.showNotifications - Whether to show snackbar notifications (default: true)
 * @param {number} options.recheckInterval - Interval to recheck connection in ms (default: 5000)
 * @param {string} options.testUrl - URL to test connectivity (default: '/favicon.ico')
 */
export const useNetworkMonitor = (options = {}) => {
  const {
    showNotifications = true,
    recheckInterval = 5000, // 5 seconds
    testUrl = '/favicon.ico'
  } = options;

  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [wasOffline, setWasOffline] = useState(false);
  const [lastOnlineTime, setLastOnlineTime] = useState(Date.now());
  const offlineNotificationRef = useRef(null);
  const recheckIntervalRef = useRef(null);

  // Test actual internet connectivity (not just local server)
  const testConnectivity = async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout

      // Test actual internet connectivity with reliable external endpoints
      const testUrls = [
        'https://www.google.com/favicon.ico',
        'https://www.cloudflare.com/favicon.ico',
        'https://httpbin.org/status/200'
      ];
      
      for (const url of testUrls) {
        try {
          await fetch(url, { 
            method: 'HEAD',
            cache: 'no-cache',
            mode: 'no-cors',
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          return true;
        } catch (error) {
          continue;
        }
      }
      
      clearTimeout(timeoutId);
      return false;
    } catch (error) {
      return false;
    }
  };

  // Handle going online
  const handleOnline = async () => {
    // Double-check with actual connectivity test
    const isActuallyOnline = await testConnectivity();
    
    if (!isActuallyOnline) {
      return;
    }

    setIsOnline(true);
    setLastOnlineTime(Date.now());
    
    if (showNotifications && wasOffline) {
      // Close the persistent offline notification
      if (offlineNotificationRef.current) {
        closeSnackbar(offlineNotificationRef.current);
        offlineNotificationRef.current = null;
      }
      
      // Calculate how long we were offline
      const offlineDuration = Math.floor((Date.now() - lastOnlineTime) / 1000);
      const durationText = offlineDuration > 60 
        ? `${Math.floor(offlineDuration / 60)}m ${offlineDuration % 60}s`
        : `${offlineDuration}s`;
      
      // Show "back online" notification
      enqueueSnackbar(`Connection restored. You were offline for ${durationText}.`, {
        variant: 'success',
        autoHideDuration: 4000,
        preventDuplicate: true
      });
      
      setWasOffline(false);
    }

    // Clear recheck interval when online
    if (recheckIntervalRef.current) {
      clearInterval(recheckIntervalRef.current);
      recheckIntervalRef.current = null;
    }
  };

  // Handle going offline
  const handleOffline = () => {
    setIsOnline(false);
    setWasOffline(true);
    
    if (showNotifications) {
      // Show persistent offline notification
      try {
        offlineNotificationRef.current = enqueueSnackbar(
          'No internet connection. Some features may not work properly.',
          {
            variant: 'error',
            persist: true, // This makes it stay until manually closed
            preventDuplicate: true
          }
        );
      } catch (error) {
      }
    }

    // Start periodic recheck when offline
    if (!recheckIntervalRef.current) {
      recheckIntervalRef.current = setInterval(async () => {
        // Check if browser thinks we're online and test with actual request
        if (navigator.onLine) {
          const isConnected = await testConnectivity();
          if (isConnected) {
            handleOnline();
          } else {
          }
        }
      }, recheckInterval);
    }
  };

  // Handle online event
  const handleOnlineEvent = () => {
    handleOnline();
  };

  // Handle offline event
  const handleOfflineEvent = () => {
    handleOffline();
  };

  useEffect(() => {
    // Set initial state and test connectivity
    const initializeNetworkState = async () => {
      
      // Always test actual connectivity, regardless of navigator.onLine
      const isConnected = await testConnectivity();
      
      setIsOnline(isConnected);
      
      if (!isConnected) {
        handleOffline();
      } else {
      }
    };

    // Small delay to ensure DOM is ready
    setTimeout(initializeNetworkState, 100);

    // Add event listeners
    window.addEventListener('online', handleOnlineEvent);
    window.addEventListener('offline', handleOfflineEvent);

    // Cleanup function
    return () => {
      window.removeEventListener('online', handleOnlineEvent);
      window.removeEventListener('offline', handleOfflineEvent);
      
      // Clear any pending notifications
      if (offlineNotificationRef.current) {
        closeSnackbar(offlineNotificationRef.current);
      }
      
      // Clear recheck interval
      if (recheckIntervalRef.current) {
        clearInterval(recheckIntervalRef.current);
        recheckIntervalRef.current = null;
      }
    };
  }, [showNotifications, recheckInterval, testUrl]);

  // Handle page visibility change - recheck when user returns to tab
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (!document.hidden && navigator.onLine) {
        // User returned to the tab, test connectivity
        const isConnected = await testConnectivity();
        if (isConnected && !isOnline) {
          handleOnline();
        } else if (!isConnected && isOnline) {
          handleOffline();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isOnline]);

  return {
    isOnline,
    isOffline: !isOnline,
    wasOffline,
    lastOnlineTime,
    testConnectivity
  };
};