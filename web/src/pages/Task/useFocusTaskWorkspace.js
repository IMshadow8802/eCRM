import { useEffect } from "react";
import { enqueueSnackbar } from "notistack";

import { useApiQuery } from "../../hooks/useApiQuery";
import { TASK_ENDPOINTS } from "../../api/taskQueries";
import { WORKSPACE_ENDPOINTS, WORKSPACE_LIST_PARAMS } from "../../api/workspaceQueries";
import useWorkspaceStore from "../../stores/useWorkspaceStore";

// Makes the task's own workspace the active one, so TaskDetailModal's
// role-derived abilities are right. Shares the ["task", id] cache with the modal
// and ["workspaces","list"] with WorkspaceSwitcher - no extra requests.
// A task that is gone (deleted, or the fetch fails) gets a toast and onMissing()
// so the caller closes the modal instead of leaving it on a skeleton forever.
export default function useFocusTaskWorkspace(taskId, onMissing) {
  const { data: taskPayload, isSuccess, isError } = useApiQuery({
    queryKey: ["task", taskId],
    endpoint: TASK_ENDPOINTS.tasks.fetchTasks,
    params: { Id: taskId },
    enabled: Boolean(taskId),
    showErrorMessage: false,
    retry: false, // a gone task will not come back; fail fast
  });
  const { data: wsPayload, isSuccess: wsLoaded, isError: wsFailed } = useApiQuery({
    queryKey: ["workspaces", "list"],
    endpoint: WORKSPACE_ENDPOINTS.workspaces.fetchWorkspaces,
    params: WORKSPACE_LIST_PARAMS,
    enabled: Boolean(taskId),
  });
  const activeId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const task = taskPayload?.tasks?.[0] ?? null;
  const missing = Boolean(taskId) && (isError || (isSuccess && !task));

  useEffect(() => {
    if (!task?.WorkspaceId) return;
    const row = (wsPayload?.workspaces ?? []).find((w) => w.Id === task.WorkspaceId);
    // Not in the list (an admin non-member): don't switch, the server decides.
    if (row && useWorkspaceStore.getState().activeWorkspaceId !== row.Id) {
      useWorkspaceStore.getState().setActiveWorkspace(row);
    }
  }, [task?.WorkspaceId, wsPayload]);

  useEffect(() => {
    if (!missing) return;
    enqueueSnackbar("This task no longer exists", { variant: "warning" });
    onMissing?.();
  }, [missing]);

  // Open the modal only once its role/type source (the active workspace) is
  // right: the switch has landed, or the board is not in my list (nothing to
  // switch to; the server decides access).
  const inList = (wsPayload?.workspaces ?? []).some((w) => w.Id === task?.WorkspaceId);
  const ready = Boolean(task) && (activeId === task.WorkspaceId || ((wsLoaded || wsFailed) && !inList));
  return { task, ready };
}
