import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";
import { apiClient } from "../utils/axiosConfig";
import { processApiResponse } from "../utils/apiUtils";

/**
 * Generic hook for API queries with standardized error handling and notifications
 * @param {Object} config - Configuration object
 * @param {string|Array} config.queryKey - Query key for caching
 * @param {string} config.endpoint - API endpoint to call
 * @param {Object} config.params - Parameters to send with the request
 * @param {string|Array} config.dataKeys - Keys to clean for empty data responses
 * @param {Object} config.options - Additional React Query options
 * @param {boolean} config.showSuccessMessage - Whether to show success notification
 * @param {string} config.successMessage - Custom success message
 * @param {boolean} config.showErrorMessage - Whether to show error notification (default: true)
 * @param {string} config.errorMessage - Custom error message
 * @param {boolean} config.enabled - Whether the query should run (default: true)
 * @param {number} config.staleTime - Cache time in milliseconds (default: 5 minutes)
 * @param {Function} config.select - Transform function for data
 * @returns {Object} Query result with data, loading state, error, etc.
 */
export const useApiQuery = ({
  queryKey,
  endpoint,
  params = {},
  dataKeys = null,
  options = {},
  showSuccessMessage = false,
  successMessage = "Data fetched successfully",
  showErrorMessage = true,
  errorMessage,
  enabled = true,
  staleTime = 5 * 60 * 1000, // 5 minutes default
  select,
  ...reactQueryOptions
}) => {
  return useQuery({
    queryKey: Array.isArray(queryKey) ? queryKey : [queryKey, params],
    queryFn: async () => {
      const response = await apiClient.post(endpoint, params);
      
      if (response.data.success) {
        const data = response.data.data || response.data;
        
        // Process response to handle "No data found" cases
        if (dataKeys) {
          return processApiResponse({ data: { data } }, dataKeys).data;
        }
        
        return data;
      } else {
        throw new Error(response.data.message || "Failed to fetch data");
      }
    },
    staleTime,
    retry: 1,
    enabled,
    select,
    onSuccess: showSuccessMessage ? () => {
      enqueueSnackbar(successMessage, { variant: "success" });
    } : undefined,
    onError: showErrorMessage ? (error) => {
      const message = errorMessage || 
        error.response?.data?.message || 
        error.message || 
        "Failed to fetch data";
      enqueueSnackbar(message, { variant: "error" });
    } : undefined,
    ...options,
    ...reactQueryOptions
  });
};

/**
 * Hook for queries that should only run when manually triggered
 * @param {Object} config - Same as useApiQuery
 * @returns {Object} Query result with additional trigger function
 */
export const useManualApiQuery = (config) => {
  const [shouldFetch, setShouldFetch] = useState(false);
  
  const queryResult = useApiQuery({
    ...config,
    enabled: shouldFetch && (config.enabled !== false)
  });

  const trigger = () => setShouldFetch(true);
  const reset = () => setShouldFetch(false);

  return {
    ...queryResult,
    trigger,
    reset,
    isTriggered: shouldFetch
  };
};