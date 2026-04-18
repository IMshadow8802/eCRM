// src/hooks/useConfirmation.jsx
import { useState, useCallback } from 'react';

/**
 * Custom hook for managing confirmation dialogs
 * @returns {Object} Object containing confirmation state and methods
 */
export const useConfirmation = () => {
  const [confirmationState, setConfirmationState] = useState({
    open: false,
    title: '',
    message: '',
    onConfirm: null,
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    type: 'warning',
    icon: null,
    isLoading: false,
    maxWidth: 'sm',
  });

  /**
   * Show confirmation dialog
   * @param {Object} options - Configuration options for the dialog
   */
  const showConfirmation = useCallback((options) => {
    setConfirmationState(prev => ({
      ...prev,
      open: true,
      ...options,
    }));
  }, []);

  /**
   * Hide confirmation dialog
   */
  const hideConfirmation = useCallback(() => {
    setConfirmationState(prev => ({
      ...prev,
      open: false,
      isLoading: false,
    }));
  }, []);

  /**
   * Set loading state for the confirmation
   * @param {boolean} loading - Loading state
   */
  const setLoading = useCallback((loading) => {
    setConfirmationState(prev => ({
      ...prev,
      isLoading: loading,
    }));
  }, []);

  /**
   * Handle confirm action with loading state management
   */
  const handleConfirm = useCallback(async () => {
    if (confirmationState.onConfirm) {
      try {
        setLoading(true);
        await confirmationState.onConfirm();
        hideConfirmation();
      } catch (error) {
        console.error('Confirmation action failed:', error);
        setLoading(false);
      }
    }
  }, [confirmationState.onConfirm, setLoading, hideConfirmation]);

  // Shortcut methods for common confirmation types
  const confirmDelete = useCallback((options) => {
    showConfirmation({
      type: 'danger',
      title: 'Delete Confirmation',
      confirmText: 'Delete',
      ...options,
    });
  }, [showConfirmation]);

  const confirmAction = useCallback((options) => {
    showConfirmation({
      type: 'warning',
      title: 'Confirm Action',
      confirmText: 'Confirm',
      ...options,
    });
  }, [showConfirmation]);

  const confirmInfo = useCallback((options) => {
    showConfirmation({
      type: 'info',
      title: 'Information',
      confirmText: 'OK',
      ...options,
    });
  }, [showConfirmation]);

  return {
    // State
    confirmationState,
    isOpen: confirmationState.open,
    isLoading: confirmationState.isLoading,
    
    // Methods
    showConfirmation,
    hideConfirmation,
    setLoading,
    handleConfirm,
    
    // Shortcut methods
    confirmDelete,
    confirmAction,
    confirmInfo,
  };
};

export default useConfirmation;