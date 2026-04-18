import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { teamAPI } from "../services/api";

// Query keys for consistent caching
export const teamKeys = {
  all: ["teams"],
  lists: () => [...teamKeys.all, "list"],
  list: (filters) => [...teamKeys.lists(), filters],
  details: () => [...teamKeys.all, "detail"],
  detail: (id) => [...teamKeys.details(), id],
};

// Hook to fetch teams with filters
export const useTeams = (searchTerm = null) => {
  return useQuery({
    queryKey: teamKeys.list({ searchTerm }),
    queryFn: async () => {
      const teams = await teamAPI.fetchTeams(searchTerm);
      return teams;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 2,
    refetchOnWindowFocus: false,
  });
};

// Hook to create team
export const useCreateTeam = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (teamData) => teamAPI.saveTeam(teamData),
    onSuccess: (data, variables) => {
      // Invalidate and refetch teams list
      queryClient.invalidateQueries({ queryKey: teamKeys.lists() });

      // Optionally update specific queries
      if (data.Id) {
        queryClient.setQueryData(teamKeys.detail(data.Id), data);
      }

      console.log("Team saved successfully:", data);
    },
    onError: (error) => {
      console.error("Error saving team:", error.message);
    },
  });
};

// Hook to update team
export const useUpdateTeam = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (teamData) => teamAPI.saveTeam(teamData),
    onMutate: async (updatedTeam) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: teamKeys.lists() });

      // Snapshot the previous value
      const previousTeams = queryClient.getQueryData(teamKeys.lists());

      // Optimistically update to the new value
      queryClient.setQueriesData({ queryKey: teamKeys.lists() }, (old) => {
        if (!old) return old;
        return old.map((team) =>
          team.Id === updatedTeam.Id ? { ...team, ...updatedTeam } : team
        );
      });

      return { previousTeams };
    },
    onError: (err, updatedTeam, context) => {
      // If the mutation fails, use the context returned from onMutate to roll back
      queryClient.setQueryData(teamKeys.lists(), context.previousTeams);
      console.error("Error updating team:", err.message);
    },
    onSettled: () => {
      // Always refetch after error or success
      queryClient.invalidateQueries({ queryKey: teamKeys.lists() });
    },
  });
};

// Hook to delete team
export const useDeleteTeam = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (teamId) => teamAPI.deleteTeam(teamId),
    onMutate: async (teamId) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: teamKeys.lists() });

      // Snapshot the previous value
      const previousTeams = queryClient.getQueryData(teamKeys.lists());

      // Optimistically remove from the list
      queryClient.setQueriesData({ queryKey: teamKeys.lists() }, (old) => {
        if (!old) return old;
        return old.filter((team) => team.Id !== teamId);
      });

      return { previousTeams };
    },
    onError: (err, teamId, context) => {
      // If the mutation fails, use the context to roll back
      queryClient.setQueryData(teamKeys.lists(), context.previousTeams);
      console.error("Error deleting team:", err.message);
    },
    onSettled: () => {
      // Always refetch after error or success
      queryClient.invalidateQueries({ queryKey: teamKeys.lists() });
    },
  });
};

export default {
  useTeams,
  useCreateTeam,
  useUpdateTeam,
  useDeleteTeam,
};
