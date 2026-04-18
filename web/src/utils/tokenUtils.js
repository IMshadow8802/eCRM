/**
 * Token utility functions for JWT handling and expiry validation
 * Provides safe JWT decoding without external dependencies
 */

/**
 * Safely decode JWT token without verification (client-side only)
 * @param {string} token - JWT token string
 * @returns {object|null} - Decoded payload or null if invalid
 */
export const decodeJWT = (token) => {
  if (!token || typeof token !== 'string') {
    return null;
  }

  try {
    // Split token into parts
    const parts = token.split('.');
    if (parts.length !== 3) {
      console.warn('Invalid JWT format - not 3 parts');
      return null;
    }

    // Decode the payload (second part)
    const payload = parts[1];
    
    // Add padding if needed for base64 decoding
    const paddedPayload = payload + '='.repeat((4 - payload.length % 4) % 4);
    
    // Decode base64
    const decodedPayload = atob(paddedPayload.replace(/-/g, '+').replace(/_/g, '/'));
    
    // Parse JSON
    return JSON.parse(decodedPayload);
  } catch (error) {
    console.warn('Failed to decode JWT:', error.message);
    return null;
  }
};

/**
 * Check if token is expired
 * @param {string} token - JWT token string
 * @returns {boolean} - True if expired, false if valid
 */
export const isTokenExpired = (token) => {
  if (!token) {
    return true;
  }

  const decoded = decodeJWT(token);
  if (!decoded || !decoded.exp) {
    console.warn('Token missing expiry time (exp claim)');
    return true;
  }

  // JWT exp is in seconds, Date.now() is in milliseconds
  const currentTime = Math.floor(Date.now() / 1000);
  const isExpired = decoded.exp < currentTime;

  if (isExpired) {
    const expiredAgo = currentTime - decoded.exp;
    console.warn(`Token expired ${expiredAgo} seconds ago`);
  }

  return isExpired;
};

/**
 * Check if token is expiring soon
 * @param {string} token - JWT token string
 * @param {number} minutesBeforeExpiry - Minutes before expiry to consider "expiring soon"
 * @returns {boolean} - True if expiring soon, false otherwise
 */
export const isTokenExpiringSoon = (token, minutesBeforeExpiry = 5) => {
  if (!token) {
    return true;
  }

  const decoded = decodeJWT(token);
  if (!decoded || !decoded.exp) {
    return true;
  }

  const currentTime = Math.floor(Date.now() / 1000);
  const warningTime = decoded.exp - (minutesBeforeExpiry * 60);
  
  return currentTime >= warningTime && currentTime < decoded.exp;
};

/**
 * Get remaining time in seconds before token expires
 * @param {string} token - JWT token string
 * @returns {number} - Remaining seconds (0 if expired or invalid)
 */
export const getTokenRemainingTime = (token) => {
  if (!token) {
    return 0;
  }

  const decoded = decodeJWT(token);
  if (!decoded || !decoded.exp) {
    return 0;
  }

  const currentTime = Math.floor(Date.now() / 1000);
  const remainingTime = decoded.exp - currentTime;
  
  return Math.max(0, remainingTime);
};

/**
 * Get token expiry date
 * @param {string} token - JWT token string
 * @returns {Date|null} - Expiry date or null if invalid
 */
export const getTokenExpiryDate = (token) => {
  if (!token) {
    return null;
  }

  const decoded = decodeJWT(token);
  if (!decoded || !decoded.exp) {
    return null;
  }

  return new Date(decoded.exp * 1000);
};

/**
 * Get formatted time remaining string
 * @param {string} token - JWT token string
 * @returns {string} - Human-readable time remaining
 */
export const getFormattedTimeRemaining = (token) => {
  const seconds = getTokenRemainingTime(token);
  
  if (seconds <= 0) {
    return 'Expired';
  }

  if (seconds < 60) {
    return `${seconds} seconds`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  
  if (hours < 24) {
    return remainingMinutes > 0 
      ? `${hours}h ${remainingMinutes}m` 
      : `${hours} hour${hours !== 1 ? 's' : ''}`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  
  return remainingHours > 0 
    ? `${days}d ${remainingHours}h` 
    : `${days} day${days !== 1 ? 's' : ''}`;
};

/**
 * Validate token structure and basic claims
 * @param {string} token - JWT token string
 * @returns {object} - Validation result with isValid and details
 */
export const validateToken = (token) => {
  const result = {
    isValid: false,
    isExpired: true,
    hasRequiredClaims: false,
    expiresAt: null,
    remainingSeconds: 0,
    details: []
  };

  if (!token) {
    result.details.push('Token is null or empty');
    return result;
  }

  const decoded = decodeJWT(token);
  if (!decoded) {
    result.details.push('Failed to decode token');
    return result;
  }

  // Check for required claims
  if (!decoded.exp) {
    result.details.push('Missing expiry time (exp claim)');
  } else {
    result.hasRequiredClaims = true;
    result.expiresAt = new Date(decoded.exp * 1000);
    result.remainingSeconds = getTokenRemainingTime(token);
    result.isExpired = isTokenExpired(token);
  }

  // Additional validation
  if (decoded.iat && decoded.iat > decoded.exp) {
    result.details.push('Invalid token: issued after expiry');
  }

  if (decoded.nbf && Math.floor(Date.now() / 1000) < decoded.nbf) {
    result.details.push('Token not yet valid (nbf claim)');
  }

  result.isValid = result.hasRequiredClaims && !result.isExpired && result.details.length === 0;

  if (result.isValid) {
    result.details.push(`Token valid for ${getFormattedTimeRemaining(token)}`);
  }

  return result;
};

/**
 * Debug token information (development only)
 * @param {string} token - JWT token string
 * @returns {object} - Debug information
 */
export const debugToken = (token) => {
  if (process.env.NODE_ENV !== 'development') {
    return { message: 'Debug info only available in development mode' };
  }

  const decoded = decodeJWT(token);
  const validation = validateToken(token);

  return {
    raw: token,
    decoded,
    validation,
    length: token?.length || 0,
    parts: token?.split('.').length || 0,
    header: token ? decodeJWT(token.split('.')[0] + '==') : null
  };
};