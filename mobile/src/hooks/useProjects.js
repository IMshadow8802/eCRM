import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { projectAPI } from "../services/api";

// Fetch projects
export const useProjects = (searchTerm = null) => {
  return useQuery({
    queryKey: ["projects", searchTerm],
    queryFn: async () => {
      const projects = await projectAPI.fetchProjects(searchTerm);
      return projects;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};

// Create project
export const useCreateProject = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: projectAPI.saveProject,
    onSuccess: (data) => {
      // Invalidate and refetch projects
      queryClient.invalidateQueries({ queryKey: ["projects"] });

      // Optimistically add the new project to the cache
      queryClient.setQueryData(["projects", null], (oldData) => {
        if (oldData) {
          return [...oldData, data];
        }
        return [data];
      });
    },
    onError: (error) => {
      console.error("Failed to create project:", error);
    },
  });
};

// Update project
export const useUpdateProject = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: projectAPI.saveProject,
    onSuccess: (data) => {
      // Invalidate and refetch projects
      queryClient.invalidateQueries({ queryKey: ["projects"] });

      // Optimistically update the project in the cache
      queryClient.setQueryData(["projects", null], (oldData) => {
        if (oldData) {
          return oldData.map((project) =>
            project.Id === data.Id ? data : project
          );
        }
        return [data];
      });
    },
    onError: (error) => {
      console.error("Failed to update project:", error);
    },
  });
};

// Delete project
export const useDeleteProject = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: projectAPI.deleteProject,
    onSuccess: (_, deletedProjectId) => {
      // Invalidate and refetch projects
      queryClient.invalidateQueries({ queryKey: ["projects"] });

      // Optimistically remove the project from the cache
      queryClient.setQueryData(["projects", null], (oldData) => {
        if (oldData) {
          return oldData.filter((project) => project.Id !== deletedProjectId);
        }
        return [];
      });
    },
    onError: (error) => {
      console.error("Failed to delete project:", error);
    },
  });
};
