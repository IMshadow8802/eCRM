import React, { useState, useEffect } from 'react';
import { WifiOff } from 'lucide-react';

/**
 * Network Status Banner Component
 * Shows a persistent banner when offline that won't go away until connection is restored
 */
const NetworkStatusBanner = () => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [offlineStartTime, setOfflineStartTime] = useState(null);
  const [offlineDuration, setOfflineDuration] = useState('');

  // Test actual internet connectivity (not just local server)
  const testConnectivity = async () => {
    try {
      setIsTestingConnection(true);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, 3000);

      // Test actual internet connectivity with a reliable external endpoint
      await fetch('https://www.google.com/favicon.ico', { 
        method: 'HEAD',
        cache: 'no-cache',
        mode: 'no-cors',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      return true;
    } catch (error) {
      return false;
    } finally {
      setIsTestingConnection(false);
    }
  };

  // Handle going online
  const handleOnline = async () => {
    const isActuallyOnline = await testConnectivity();
    
    if (isActuallyOnline) {
      setIsOnline(true);
      setOfflineStartTime(null);
      setOfflineDuration('');
    }
  };

  // Handle going offline
  const handleOffline = () => {
    setIsOnline(false);
    setOfflineStartTime(Date.now());
  };

  // Update offline duration
  useEffect(() => {
    let interval;
    
    if (!isOnline && offlineStartTime) {
      interval = setInterval(() => {
        const duration = Math.floor((Date.now() - offlineStartTime) / 1000);
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;
        
        if (minutes > 0) {
          setOfflineDuration(`${minutes}m ${seconds}s`);
        } else {
          setOfflineDuration(`${seconds}s`);
        }
      }, 1000);
    }
    
    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [isOnline, offlineStartTime]);

  // Set up event listeners
  useEffect(() => {
    const handleOnlineEvent = () => {
      handleOnline();
    };

    const handleOfflineEvent = () => {
      handleOffline();
    };

    // Initial connectivity test
    const initializeNetworkState = async () => {
      
      // Always test connectivity regardless of navigator.onLine
      const isConnected = await testConnectivity();
      
      setIsOnline(isConnected);
      
      if (!isConnected) {
        handleOffline();
      } else {
      }
    };

    // Small delay to ensure everything is loaded
    setTimeout(initializeNetworkState, 200);

    // Add event listeners
    window.addEventListener('online', handleOnlineEvent);
    window.addEventListener('offline', handleOfflineEvent);

    // Periodic recheck when offline
    const recheckInterval = setInterval(async () => {
      if (!isOnline && navigator.onLine) {
        const isConnected = await testConnectivity();
        if (isConnected) {
          handleOnline();
        }
      }
    }, 5000);

    return () => {
      window.removeEventListener('online', handleOnlineEvent);
      window.removeEventListener('offline', handleOfflineEvent);
      clearInterval(recheckInterval);
    };
  }, [isOnline]);

  // Handle retry button click
  const handleRetry = async () => {
    if (navigator.onLine) {
      await handleOnline();
    }
  };

  // Don't render anything if online
  if (isOnline) {
    return null;
  }


  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        backgroundColor: '#f44336', // Red background
        color: 'white',
        padding: '12px 16px',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
        fontSize: '14px',
        fontFamily: 'system-ui, -apple-system, sans-serif'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <WifiOff size={16} strokeWidth={2.25} />
        <span>
          <strong>No Internet Connection</strong>
          {offlineDuration && (
            <span style={{ marginLeft: '8px', opacity: 0.9 }}>
              (offline for {offlineDuration})
            </span>
          )}
        </span>
      </div>
      
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span style={{ fontSize: '12px', opacity: 0.9 }}>
          Some features may not work properly
        </span>
        <button
          onClick={handleRetry}
          disabled={isTestingConnection}
          style={{
            backgroundColor: 'rgba(255, 255, 255, 0.2)',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            padding: '6px 12px',
            cursor: isTestingConnection ? 'not-allowed' : 'pointer',
            fontSize: '12px',
            fontWeight: '500',
            opacity: isTestingConnection ? 0.7 : 1,
            transition: 'all 0.2s ease'
          }}
          onMouseOver={(e) => {
            if (!isTestingConnection) {
              e.target.style.backgroundColor = 'rgba(255, 255, 255, 0.3)';
            }
          }}
          onMouseOut={(e) => {
            e.target.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
          }}
        >
          {isTestingConnection ? 'Testing...' : 'Retry'}
        </button>
      </div>
    </div>
  );
};

export default NetworkStatusBanner;