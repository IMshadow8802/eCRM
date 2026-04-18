import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { taskAPI } from "../services/api";

// Fetch tasks
export const useTasks = (
  searchTerm = null,
  projectId = null,
  status = null,
  priority = null
) => {
  return useQuery({
    queryKey: ["tasks", searchTerm, projectId, status, priority],
    queryFn: async () => {
      const tasks = await taskAPI.fetchTasks(
        searchTerm,
        projectId,
        null,
        null,
        status,
        priority
      );
      return tasks;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};

// Create task
export const useCreateTask = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: taskAPI.saveTask,
    onSuccess: (data) => {
      // Invalidate and refetch tasks
      queryClient.invalidateQueries({ queryKey: ["tasks"] });

      // Optimistically add the new task to the cache
      queryClient.setQueryData(["tasks", null, null, null, null], (oldData) => {
        if (oldData) {
          return [...oldData, data];
        }
        return [data];
      });
    },
    onError: (error) => {
      console.error("Failed to create task:", error);
    },
  });
};

// Update task
export const useUpdateTask = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: taskAPI.saveTask,
    onSuccess: (data, variables) => {
      // Invalidate and refetch tasks
      queryClient.invalidateQueries({ queryKey: ["tasks"] });

      // If we have the full task object, update the cache
      // Otherwise, just invalidate and let it refetch
      if (data && data.Id) {
        queryClient.setQueryData(["tasks", null, null, null, null], (oldData) => {
          if (oldData) {
            return oldData.map((task) => (task.Id === data.Id ? data : task));
          }
          return [data];
        });
      } else {
        // If API returns only taskId, update the cache with the original variables + updated status
        queryClient.setQueryData(["tasks", null, null, null, null], (oldData) => {
          if (oldData && variables.Id) {
            return oldData.map((task) => 
              task.Id === variables.Id ? { ...task, ...variables } : task
            );
          }
          return oldData;
        });
      }
    },
    onError: (error) => {
      console.error("Failed to update task:", error);
    },
  });
};

// Delete task
export const useDeleteTask = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: taskAPI.deleteTask,
    onSuccess: (_, deletedTaskId) => {
      // Invalidate and refetch tasks
      queryClient.invalidateQueries({ queryKey: ["tasks"] });

      // Optimistically remove the task from the cache
      queryClient.setQueryData(["tasks", null, null, null, null], (oldData) => {
        if (oldData) {
          return oldData.filter((task) => task.Id !== deletedTaskId);
        }
        return [];
      });
    },
    onError: (error) => {
      console.error("Failed to delete task:", error);
    },
  });
};
