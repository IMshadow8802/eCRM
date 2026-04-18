import { useMutation, useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar, closeSnackbar } from "notistack";
import { apiClient } from "../utils/axiosConfig";

/**
 * Generic hook for API mutations with standardized error handling and notifications
 * @param {Object} config - Configuration object
 * @param {string} config.endpoint - API endpoint to call
 * @param {string} config.method - HTTP method (post, put, delete, etc.) - default: 'post'
 * @param {string|Array} config.invalidateQueries - Query keys to invalidate after success
 * @param {string} config.successMessage - Success notification message
 * @param {string} config.errorMessage - Custom error message
 * @param {boolean} config.showSuccessMessage - Whether to show success notification (default: true)
 * @param {boolean} config.showErrorMessage - Whether to show error notification (default: true)
 * @param {Function} config.onSuccess - Custom success handler
 * @param {Function} config.onError - Custom error handler
 * @param {Object} config.options - Additional React Query mutation options
 * @returns {Object} Mutation result with mutate function, loading state, etc.
 */
export const useApiMutation = ({
  endpoint,
  method = 'post',
  invalidateQueries,
  successMessage = "Operation completed successfully",
  errorMessage,
  showSuccessMessage = true,
  showErrorMessage = true,
  onSuccess,
  onError,
  options = {},
  ...reactQueryOptions
}) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params) => {
      const response = await apiClient[method](endpoint, params);
      
      if (response.data.success) {
        return response.data.data || response.data;
      } else {
        throw new Error(response.data.message || "Operation failed");
      }
    },
    onSuccess: (data, variables, context) => {
      // Show success message
      if (showSuccessMessage) {
        enqueueSnackbar(successMessage, { variant: "success" });
      }

      // Invalidate queries
      if (invalidateQueries) {
        const queries = Array.isArray(invalidateQueries) ? invalidateQueries : [invalidateQueries];
        queries.forEach(queryKey => {
          queryClient.invalidateQueries({ queryKey });
        });
      }

      // Custom success handler
      if (onSuccess) {
        onSuccess(data, variables, context);
      }
    },
    onError: (error, variables, context) => {
      // Show error message
      if (showErrorMessage) {
        const message = errorMessage || 
          error.response?.data?.message || 
          error.message || 
          "Operation failed";
        enqueueSnackbar(message, { variant: "error" });
      }

      // Custom error handler
      if (onError) {
        onError(error, variables, context);
      }
    },
    ...options,
    ...reactQueryOptions
  });
};

/**
 * Hook for delete mutations with confirmation dialog
 * @param {Object} config - Same as useApiMutation plus confirmation options
 * @param {string} config.confirmMessage - Confirmation dialog message
 * @param {Function} config.getItemName - Function to get item name for confirmation
 * @returns {Object} Mutation result with deleteWithConfirmation function
 */
export const useDeleteMutation = ({
  confirmMessage = "Are you sure you want to delete this item?",
  getItemName = () => "this item",
  ...config
}) => {
  const mutation = useApiMutation({
    ...config,
    showSuccessMessage: false, // We'll handle this manually
  });

  const deleteWithConfirmation = (item) => {
    const itemName = getItemName(item);
    const message = confirmMessage.replace(/this item/g, itemName);
    
    enqueueSnackbar(message, {
      variant: "warning",
      persist: true,
      action: (key) => (
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            style={{
              backgroundColor: '#1976d2',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              padding: '4px 12px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
            onClick={() => {
              closeSnackbar(key);
              mutation.mutate(item, {
                onSuccess: () => {
                  enqueueSnackbar(`${itemName} deleted successfully!`, { 
                    variant: "success" 
                  });
                }
              });
            }}
          >
            Yes
          </button>
          <button
            style={{
              backgroundColor: '#f44336',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              padding: '4px 12px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
            onClick={() => closeSnackbar(key)}
          >
            No
          </button>
        </div>
      ),
    });
  };

  return {
    ...mutation,
    deleteWithConfirmation
  };
};