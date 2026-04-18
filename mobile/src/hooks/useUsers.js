import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { userAPI, userGroupAPI } from "../services/api";

// Query keys for consistent caching
export const userKeys = {
  all: ["users"],
  lists: () => [...userKeys.all, "list"],
  list: (filters) => [...userKeys.lists(), filters],
  details: () => [...userKeys.all, "detail"],
  detail: (id) => [...userKeys.details(), id],
};

export const userGroupKeys = {
  all: ["userGroups"],
  lists: () => [...userGroupKeys.all, "list"],
};

// Hook to fetch users with filters
export const useUsers = (
  searchTerm = null,
  userGroupId = null,
  isActive = null
) => {
  return useQuery({
    queryKey: userKeys.list({ searchTerm, userGroupId, isActive }),
    queryFn: async () => {
      const users = await userAPI.fetchUsers(searchTerm, userGroupId, isActive);
      return users;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 2,
    refetchOnWindowFocus: false,
  });
};

// Hook to fetch user groups for dropdown
export const useUserGroups = () => {
  return useQuery({
    queryKey: userGroupKeys.lists(),
    queryFn: () => userGroupAPI.fetchUserGroups(),
    staleTime: 10 * 60 * 1000, // 10 minutes - user groups change less frequently
    retry: 2,
    refetchOnWindowFocus: false,
  });
};

// Hook to create or update user
export const useCreateUser = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userData) => userAPI.saveUser(userData),
    onSuccess: (data, variables) => {
      // Invalidate and refetch users list
      queryClient.invalidateQueries({ queryKey: userKeys.lists() });

      // Optionally update specific queries - API returns userId, not id
      if (data.userId) {
        queryClient.setQueryData(userKeys.detail(data.userId), data);
      }

      // Show success message or handle success
      console.log("User saved successfully:", data);
    },
    onError: (error) => {
      console.error("Error saving user:", error.message);
      // Handle error (show toast, etc.)
    },
  });
};

// Hook to update user
export const useUpdateUser = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userData) => userAPI.saveUser(userData),
    onMutate: async (updatedUser) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: userKeys.lists() });

      // Snapshot the previous value
      const previousUsers = queryClient.getQueryData(userKeys.lists());

      // Optimistically update to the new value
      queryClient.setQueriesData({ queryKey: userKeys.lists() }, (old) => {
        if (!old) return old;
        return old.map((user) =>
          user.id === updatedUser.id ? { ...user, ...updatedUser } : user
        );
      });

      // Return a context object with the snapshotted value
      return { previousUsers };
    },
    onError: (err, updatedUser, context) => {
      // If the mutation fails, use the context returned from onMutate to roll back
      queryClient.setQueryData(userKeys.lists(), context.previousUsers);
      console.error("Error updating user:", err.message);
    },
    onSettled: () => {
      // Always refetch after error or success
      queryClient.invalidateQueries({ queryKey: userKeys.lists() });
    },
  });
};

// Hook to delete user
export const useDeleteUser = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId) => userAPI.deleteUser(userId),
    onMutate: async (userId) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: userKeys.lists() });

      // Snapshot the previous value
      const previousUsers = queryClient.getQueryData(userKeys.lists());

      // Optimistically remove from the list
      queryClient.setQueriesData({ queryKey: userKeys.lists() }, (old) => {
        if (!old) return old;
        return old.filter((user) => user.userid !== userId);
      });

      return { previousUsers };
    },
    onError: (err, userId, context) => {
      // If the mutation fails, use the context to roll back
      queryClient.setQueryData(userKeys.lists(), context.previousUsers);
      console.error("Error deleting user:", err.message);
    },
    onSettled: () => {
      // Always refetch after error or success
      queryClient.invalidateQueries({ queryKey: userKeys.lists() });
    },
  });
};

// Hook to prefetch user groups
export const usePrefetchUserGroups = () => {
  const queryClient = useQueryClient();

  return () => {
    queryClient.prefetchQuery({
      queryKey: userGroupKeys.lists(),
      queryFn: () => userGroupAPI.fetchUserGroups(),
      staleTime: 10 * 60 * 1000,
    });
  };
};

export default {
  useUsers,
  useUserGroups,
  useCreateUser,
  useUpdateUser,
  useDeleteUser,
  usePrefetchUserGroups,
};
