import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { kanbanAPI } from "../services/api";

// Fetch kanban columns with project filtering
export const useKanbanColumns = (projectId = null) => {
  return useQuery({
    queryKey: ["kanban", "columns", projectId],
    queryFn: async () => {
      const columns = await kanbanAPI.fetchColumns(projectId);
      return columns || [];
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!projectId, // Only fetch when projectId is provided
  });
};

// Create kanban column
export const useCreateKanbanColumn = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: kanbanAPI.saveColumn,
    onSuccess: (data, variables) => {
      // Invalidate queries for all projects and the specific project
      queryClient.invalidateQueries({ queryKey: ["kanban", "columns"] });
      
      // Invalidate the specific project's columns
      if (variables.ProjectId) {
        queryClient.invalidateQueries({ queryKey: ["kanban", "columns", variables.ProjectId] });
      }
    },
    onError: (error) => {
      console.error("Failed to create kanban column:", error);
    },
  });
};

// Update kanban column
export const useUpdateKanbanColumn = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: kanbanAPI.saveColumn,
    onSuccess: (data, variables) => {
      // Invalidate queries for all projects and the specific project
      queryClient.invalidateQueries({ queryKey: ["kanban", "columns"] });
      
      // Invalidate the specific project's columns
      if (variables.ProjectId) {
        queryClient.invalidateQueries({ queryKey: ["kanban", "columns", variables.ProjectId] });
      }
    },
    onError: (error) => {
      console.error("Failed to update kanban column:", error);
    },
  });
};

// Delete kanban column
export const useDeleteKanbanColumn = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: kanbanAPI.deleteColumn,
    onSuccess: () => {
      // Invalidate all kanban column queries to refresh data
      queryClient.invalidateQueries({ queryKey: ["kanban", "columns"] });
    },
    onError: (error) => {
      console.error("Failed to delete kanban column:", error);
    },
  });
};

