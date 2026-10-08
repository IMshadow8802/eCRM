import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";

import { TASK_ENDPOINTS } from "../../../../api/taskQueries";
import { useApiMutation } from "../../../../hooks/useApiMutation";
import { assigneeIdsOf, sameAssignees } from "../../../../utils/taskAssignees";
import { PRIORITY_OPTIONS } from "./helpers";

// The stored values the TAT fields start from: "HH:mm" and hours as text, so
// an empty target (company default) stays distinct from 0 (no clock).
// DueTime arrives as "HH:mm" (or "HH:mm:ss"); anything else reads as no time.
const dueTimeOf = (task) => /^\d{2}:\d{2}/.test(task.DueTime ?? "") ? task.DueTime.slice(0, 5) : "";
const tatHoursOf = (task) => (task.TatMinutes == null ? "" : String(Math.round((Number(task.TatMinutes) / 60) * 100) / 100));

// Details/edit concern: the editable mirror of the task, whether it diverged
// from the server copy, and the save that pushes it back.
export default function useTaskDraft({
  task,
  isPersonal,
  currentUserId,
  onClose,
  refetchTask,
}) {
  const queryClient = useQueryClient();

  // Draft state — mirrors task on load so user can edit + save at once.
  const [draft, setDraft] = useState(null);
  useEffect(() => {
    if (!task) return;
    const normPriority = String(task.Priority ?? "medium").toLowerCase();
    setDraft({
      Title: task.Title ?? "",
      Description: task.Description ?? "",
      Priority: PRIORITY_OPTIONS.some((o) => o.value === normPriority)
        ? normPriority
        : "medium",
      AssigneeIds: assigneeIdsOf(task),
      DueDate: task.DueDate ? String(task.DueDate).slice(0, 10) : "",
      EstimatedHours: Number(task.EstimatedHours ?? 0),
      LoggedHours: Number(task.LoggedHours ?? 0),
      Progress: Number(task.Progress ?? 0),
      DueTime: dueTimeOf(task),
      TatHours: tatHoursOf(task),
    });
  }, [task?.Id, task?.UpdatedDate, task?.Priority]);

  const isDirty = draft && task && (
    draft.Title !== (task.Title ?? "") ||
    draft.Description !== (task.Description ?? "") ||
    draft.Priority !== (task.Priority ?? "medium") ||
    !sameAssignees(draft.AssigneeIds, assigneeIdsOf(task)) ||
    draft.DueDate !== (task.DueDate ? String(task.DueDate).slice(0, 10) : "") ||
    Number(draft.EstimatedHours) !== Number(task.EstimatedHours ?? 0) ||
    Number(draft.LoggedHours) !== Number(task.LoggedHours ?? 0) ||
    Number(draft.Progress) !== Number(task.Progress ?? 0) ||
    draft.DueTime !== dueTimeOf(task) ||
    draft.TatHours !== tatHoursOf(task)
  );

  const saveMutation = useApiMutation({
    endpoint: TASK_ENDPOINTS.tasks.saveTask,
    showSuccessMessage: false,
  });

  const saveDraft = async () => {
    if (!task || !draft) return;
    try {
      await saveMutation.mutateAsync({
        Id: task.Id,
        Title: draft.Title.trim() || task.Title,
        Description: draft.Description,
        WorkspaceId: task.WorkspaceId,
        ProjectId: task.ProjectId,
        ParentTaskId: task.ParentTaskId,
        AssigneeIds: isPersonal ? [currentUserId] : draft.AssigneeIds,
        TeamId: task.TeamId,
        Priority: draft.Priority,
        Type: task.Type,
        DueDate: draft.DueDate || null,
        EstimatedHours: draft.EstimatedHours,
        LoggedHours: draft.LoggedHours,
        Progress: draft.Progress,
        IsBlocked: task.IsBlocked,
        Labels: task.Labels,
        Watchers: task.Watchers,
        // Sent only when changed: the server keeps a stored time/target that
        // is absent from the body (contract amendment, HasDueTime/CanSetTarget).
        ...(draft.DueTime !== dueTimeOf(task) && { DueTime: draft.DueTime || null }),
        ...(draft.TatHours !== tatHoursOf(task) && {
          TatMinutes: draft.TatHours === "" ? null : Math.round(Number(draft.TatHours) * 60),
        }),
      });
      enqueueSnackbar("Task saved", { variant: "success" });
      queryClient.invalidateQueries({ queryKey: ["tasks"], refetchType: "all" });
      queryClient.invalidateQueries({
        queryKey: ["kanban-columns"],
        refetchType: "all",
      });
      // The single-task cache backs the modal itself; drop it so the next
      // open re-fetches fresh instead of hydrating from a stale entry.
      queryClient.removeQueries({ queryKey: ["task", task.Id] });
      onClose?.();
    } catch {
      refetchTask();
    }
  };

  return { draft, setDraft, isDirty, saveDraft, isSaving: saveMutation.isPending };
}
