/**
 * Shared API utility functions for handling empty data responses
 * Handles the case where API returns "No data found" with ResponseCode 200
 */

/**
 * Check if a data array contains "No data found" response
 * @param {Array} dataArray - The array from API response
 * @param {string} arrayKey - Key name for logging (e.g., 'tasks', 'projects')
 * @returns {boolean} - True if it's an empty data response
 */
export const isEmptyDataResponse = (dataArray, arrayKey = 'data') => {
  if (!dataArray || !Array.isArray(dataArray) || dataArray.length === 0) {
    return true;
  }
  
  // Check if first item is a "No data found" response
  const firstItem = dataArray[0];
  if (firstItem && firstItem.ResponseCode === 200) {
    // Check for common "no data" messages
    const message = firstItem.ResponseMess || '';
    const isNoDataMessage = 
      message.includes('No ') || 
      message.includes('found') ||
      message.includes('not found') ||
      firstItem.Id === null;
      
    if (isNoDataMessage) {
      console.log(`Empty data response detected for ${arrayKey}:`, message);
      return true;
    }
  }
  
  return false;
};

/**
 * Clean API response data by filtering out "No data found" objects
 * @param {Object} responseData - The data object from API response
 * @param {string|Array} dataKeys - Key(s) to check and clean (e.g., 'tasks' or ['tasks', 'projects'])
 * @returns {Object} - Cleaned response data with empty arrays instead of "No data found" objects
 */
export const cleanApiResponseData = (responseData, dataKeys) => {
  if (!responseData || typeof responseData !== 'object') {
    return responseData;
  }

  const keysToCheck = Array.isArray(dataKeys) ? dataKeys : [dataKeys];
  const cleanedData = { ...responseData };

  keysToCheck.forEach(key => {
    if (cleanedData[key] && isEmptyDataResponse(cleanedData[key], key)) {
      cleanedData[key] = [];
    }
  });

  return cleanedData;
};

/**
 * Process API response for React Query or other hooks
 * @param {Object} response - Axios response object
 * @param {string|Array} dataKeys - Key(s) to check and clean
 * @returns {Object} - Processed response data
 */
export const processApiResponse = (response, dataKeys = null) => {
  if (!response.data) {
    return response;
  }

  // If response has nested data structure (like your API)
  if (response.data.data && dataKeys) {
    return {
      ...response.data,
      data: cleanApiResponseData(response.data.data, dataKeys)
    };
  }

  // If dataKeys provided and data is at root level
  if (dataKeys) {
    return cleanApiResponseData(response.data, dataKeys);
  }

  return response.data;
};

/**
 * Enhanced success handler for TaskApi.js style functions
 * @param {Object} response - Axios response
 * @param {string} successMessage - Success message to show
 * @param {string|Array} dataKeys - Data keys to clean
 * @returns {Object} - Processed data
 */
export const handleApiSuccess = (response, successMessage = null, dataKeys = null) => {
  if (response.data.success) {
    if (successMessage && typeof window !== 'undefined') {
      // Only show success message if notistack is available
      try {
        const { enqueueSnackbar } = require('notistack');
        enqueueSnackbar(successMessage, { variant: 'success' });
      } catch (error) {
        console.log('Success:', successMessage);
      }
    }
    
    const data = response.data.data;
    
    // Handle empty data responses
    if (dataKeys && data) {
      return cleanApiResponseData(data, dataKeys);
    }
    
    return data;
  } else {
    throw new Error(response.data.message || 'Operation failed');
  }
};

/**
 * Check if response indicates no data (for React Query)
 * @param {Object} responseData - Response data to check
 * @param {string} dataKey - Key to check for data
 * @returns {boolean} - True if no real data
 */
export const hasNoData = (responseData, dataKey) => {
  if (!responseData || !responseData[dataKey]) {
    return true;
  }
  
  return isEmptyDataResponse(responseData[dataKey], dataKey);
};

/**
 * Transform API response for components that expect clean arrays
 * @param {Object} apiResponse - Full API response
 * @param {string} dataKey - Key containing the array data
 * @returns {Array} - Clean array or empty array if no data
 */
export const extractCleanArray = (apiResponse, dataKey) => {
  if (!apiResponse || !apiResponse.data || !apiResponse.data[dataKey]) {
    return [];
  }
  
  const dataArray = apiResponse.data[dataKey];
  
  if (isEmptyDataResponse(dataArray, dataKey)) {
    return [];
  }
  
  return dataArray;
};

/**
 * Helper for bulk operations that need to check multiple data types
 * @param {Object} responseData - Response containing multiple data arrays
 * @param {Array} dataKeys - Array of keys to clean
 * @returns {Object} - Cleaned response with empty arrays for "no data" responses
 */
export const cleanBulkResponseData = (responseData, dataKeys = []) => {
  if (!responseData) {
    return {};
  }

  const cleaned = { ...responseData };
  
  dataKeys.forEach(key => {
    if (cleaned[key]) {
      if (isEmptyDataResponse(cleaned[key], key)) {
        cleaned[key] = [];
      }
    }
  });

  return cleaned;
};

// Export default object for easier importing
export default {
  isEmptyDataResponse,
  cleanApiResponseData,
  processApiResponse,
  handleApiSuccess,
  hasNoData,
  extractCleanArray,
  cleanBulkResponseData
};