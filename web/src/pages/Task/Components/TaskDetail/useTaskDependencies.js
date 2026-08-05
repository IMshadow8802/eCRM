import { useState } from "react";
import { enqueueSnackbar } from "notistack";

import { TASK_ENDPOINTS } from "../../../../api/taskQueries";
import { useApiQuery } from "../../../../hooks/useApiQuery";
import { useApiMutation } from "../../../../hooks/useApiMutation";

// Dependencies concern: the two hard-block directions (blocked by / blocking),
// the picker options, and add/remove.
export default function useTaskDependencies(taskId, task, open) {
  const { data: depsPayload, refetch: refetchDeps } = useApiQuery({
    queryKey: ["task", taskId, "deps"],
    endpoint: TASK_ENDPOINTS.dependencies.fetchTaskDependencies,
    params: { TaskId: taskId },
    enabled: Boolean(taskId && open),
    showErrorMessage: false,
  });
  const blockers = depsPayload?.blockers ?? [];
  const dependents = depsPayload?.dependents ?? [];

  // Piggy-back on a workspace-wide fetchTasks to populate the dependency
  // picker. Cheap at expected board size.
  const { data: workspaceTasksPayload } = useApiQuery({
    queryKey: ["tasks-all", task?.WorkspaceId],
    endpoint: TASK_ENDPOINTS.tasks.fetchTasks,
    params: {
      WorkspaceId: task?.WorkspaceId,
      PageNumber: 1,
      PageSize: 200,
    },
    enabled: Boolean(task?.WorkspaceId && open),
    showErrorMessage: false,
  });
  const workspaceTasks = workspaceTasksPayload?.tasks ?? [];
  const potentialDepOptions = workspaceTasks
    .filter((t) => t.Id !== task?.Id)
    .map((t) => ({ value: t.Id, label: `#${t.Id} · ${t.Title}` }));

  const addDependencyMutation = useApiMutation({
    endpoint: TASK_ENDPOINTS.dependencies.addTaskDependency,
    showSuccessMessage: false,
  });
  const removeDependencyMutation = useApiMutation({
    endpoint: TASK_ENDPOINTS.dependencies.removeTaskDependency,
    showSuccessMessage: false,
  });

  const [blockerPick, setBlockerPick] = useState(null);
  const [dependentPick, setDependentPick] = useState(null);
  const addBlocker = async () => {
    if (!blockerPick?.value) return;
    try {
      await addDependencyMutation.mutateAsync({
        TaskId: task.Id,
        DependsOnTaskId: blockerPick.value,
        Type: "blocks",
        WorkspaceId: task.WorkspaceId, // realtime emit-routing hint
      });
      setBlockerPick(null);
      refetchDeps();
      enqueueSnackbar("Blocker added", { variant: "success" });
    } catch {}
  };
  const addDependent = async () => {
    if (!dependentPick?.value) return;
    try {
      await addDependencyMutation.mutateAsync({
        TaskId: dependentPick.value,
        DependsOnTaskId: task.Id,
        Type: "blocks",
        WorkspaceId: task.WorkspaceId, // realtime emit-routing hint
      });
      setDependentPick(null);
      refetchDeps();
      enqueueSnackbar("Dependent added", { variant: "success" });
    } catch {}
  };
  const removeDependency = async (taskId, dependsOnId) => {
    try {
      await removeDependencyMutation.mutateAsync({
        TaskId: taskId,
        DependsOnTaskId: dependsOnId,
        WorkspaceId: task.WorkspaceId, // realtime emit-routing hint
      });
      refetchDeps();
    } catch {}
  };

  return {
    blockers,
    dependents,
    potentialDepOptions,
    blockerPick,
    setBlockerPick,
    dependentPick,
    setDependentPick,
    addBlocker,
    addDependent,
    removeDependency,
    isAdding: addDependencyMutation.isPending,
  };
}
