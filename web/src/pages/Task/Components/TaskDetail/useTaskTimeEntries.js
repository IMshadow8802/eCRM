import { useState } from "react";
import { enqueueSnackbar } from "notistack";
import dayjs from "dayjs";

import { TASK_ENDPOINTS } from "../../../../api/taskQueries";
import { useApiQuery } from "../../../../hooks/useApiQuery";
import { useApiMutation } from "../../../../hooks/useApiMutation";

// Time concern: the logged entries, their total (which the details form shows
// against the estimate), and the state behind the "Log time" modal.
export default function useTaskTimeEntries(taskId, task, open) {
  const { data: timeEntriesPayload, refetch: refetchTimeEntries } = useApiQuery({
    queryKey: ["task", taskId, "time"],
    endpoint: TASK_ENDPOINTS.time.getTaskTimeEntries,
    params: { TaskId: taskId },
    enabled: Boolean(taskId && open),
    showErrorMessage: false,
  });
  const timeEntries =
    timeEntriesPayload?.timeEntries ?? timeEntriesPayload?.entries ?? [];
  const loggedHoursTotal = timeEntries.reduce(
    (sum, e) => sum + Number(e.Hours ?? 0),
    0,
  );

  const logTimeMutation = useApiMutation({
    endpoint: TASK_ENDPOINTS.time.logTaskTime,
    showSuccessMessage: false,
  });
  const deleteTimeMutation = useApiMutation({
    endpoint: TASK_ENDPOINTS.time.deleteTaskTimeEntry,
    showSuccessMessage: false,
  });

  const [logOpen, setLogOpen] = useState(false);
  const [logHours, setLogHours] = useState(0);
  const [logNote, setLogNote] = useState("");
  const submitLogTime = async () => {
    const hours = Number(logHours);
    if (!hours || hours <= 0) {
      enqueueSnackbar("Enter hours greater than 0", { variant: "warning" });
      return;
    }
    try {
      await logTimeMutation.mutateAsync({
        TaskId: task.Id,
        Hours: hours,
        Description: logNote || null,
        WorkDate: dayjs().format("YYYY-MM-DD"),
        WorkspaceId: task.WorkspaceId, // realtime emit-routing hint
      });
      setLogOpen(false);
      setLogHours(0);
      setLogNote("");
      refetchTimeEntries();
      enqueueSnackbar("Time logged", { variant: "success" });
    } catch {}
  };
  const removeTimeEntry = async (entry) => {
    try {
      await deleteTimeMutation.mutateAsync({
        Id: entry.Id,
        TaskId: task.Id, // realtime emit-routing hints
        WorkspaceId: task.WorkspaceId,
      });
      refetchTimeEntries();
    } catch {}
  };

  return {
    timeEntries,
    loggedHoursTotal,
    logOpen,
    setLogOpen,
    logHours,
    setLogHours,
    logNote,
    setLogNote,
    submitLogTime,
    removeTimeEntry,
    isLogging: logTimeMutation.isPending,
  };
}
