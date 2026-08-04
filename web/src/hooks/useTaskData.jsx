import { useApiQuery } from "./useApiQuery.jsx";

// Base payload creator
const createBasePayload = (overrides = {}) => ({
  Id: 0,
  PageNumber: 1,
  PageSize: 100,
  SearchTerm: null,
  ...overrides,
});

// ==================== SUPPORTING DATA QUERIES ====================

/**
 * Hook for fetching teams
 * @param {Object} filters - Filter parameters
 * @param {boolean} enabled - Whether to auto-fetch (default: true)
 */
export const useTeams = (filters = {}, enabled = true) => {
  return useApiQuery({
    queryKey: ['teams', filters],
    endpoint: '/api/teams/fetchTeams',
    params: createBasePayload(filters),
    dataKeys: 'teams',
    enabled,
    staleTime: 15 * 60 * 1000, // 15 minutes for relatively static data
  });
};

/**
 * Hook for fetching users
 * @param {Object} filters - Filter parameters
 * @param {boolean} enabled - Whether to auto-fetch (default: true)
 */
export const useUsers = (filters = {}, enabled = true) => {
  return useApiQuery({
    queryKey: ['users', filters],
    endpoint: '/api/users/fetchUsers',
    params: createBasePayload(filters),
    dataKeys: 'users',
    enabled,
    staleTime: 15 * 60 * 1000, // 15 minutes for relatively static data
  });
};
