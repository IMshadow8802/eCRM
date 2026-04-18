import React from 'react';
import { useTokenMonitor } from '../hooks/useTokenMonitor.jsx';
import { useNetworkMonitor } from '../hooks/useNetworkMonitor';
import NetworkStatusBanner from './NetworkStatusBanner';

/**
 * Session Monitor Component
 * Monitors token expiry, handles automatic logout, and tracks network connectivity
 * This component should be placed near the root of your app (in App.jsx or RootLayout)
 */
const SessionMonitor = ({ children, options = {} }) => {
  const {
    // Token monitoring options
    tokenCheckInterval = 60000, // Check every minute
    tokenWarningMinutes = 5,    // Warn 5 minutes before expiry
    autoLogout = true,          // Automatically logout when expired
    
    // Network monitoring options
    showNetworkNotifications = true,  // Show offline/online notifications
    networkRecheckInterval = 5000,    // Recheck connection every 5 seconds when offline
    connectivityTestUrl = '/favicon.ico', // URL to test connectivity
    
    // Debug options
    debug = false
  } = options;

  // Initialize token monitoring
  const tokenStatus = useTokenMonitor({
    checkInterval: tokenCheckInterval,
    warningMinutes: tokenWarningMinutes,
    autoLogout: autoLogout
  });

  // Initialize network monitoring
  const networkStatus = useNetworkMonitor({
    showNotifications: showNetworkNotifications,
    recheckInterval: networkRecheckInterval,
    testUrl: connectivityTestUrl
  });

  // Debug logging in development
  if (debug && process.env.NODE_ENV === 'development') {
    console.log('SessionMonitor Debug:', {
      token: {
        isExpiring: tokenStatus.isTokenExpiring,
        remainingSeconds: tokenStatus.remainingSeconds
      },
      network: {
        isOnline: networkStatus.isOnline,
        isOffline: networkStatus.isOffline,
        wasOffline: networkStatus.wasOffline,
        lastOnlineTime: new Date(networkStatus.lastOnlineTime).toLocaleString()
      }
    });
  }

  // Render network status banner and children
  return (
    <>
      <NetworkStatusBanner />
      {children || null}
    </>
  );
};

export default SessionMonitor;

// Export individual status hooks for use in other components
export { useTokenMonitor, useNetworkMonitor };