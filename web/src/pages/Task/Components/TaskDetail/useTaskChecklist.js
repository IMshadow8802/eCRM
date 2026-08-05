import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { TASK_ENDPOINTS } from "../../../../api/taskQueries";
import { useApiQuery } from "../../../../hooks/useApiQuery";
import { useApiMutation } from "../../../../hooks/useApiMutation";

// Checklist concern: the steps, their in-flight locks, and the optimistic cache
// patching that makes a tick feel instant. Completion is derived from this list
// (see CLAUDE.md §6) — hence autoProgress lives here too and the details form
// reads it back.
export default function useTaskChecklist(taskId, task, open) {
  const queryClient = useQueryClient();

  const { data: checklistPayload, refetch: refetchChecklist } = useApiQuery({
    queryKey: ["task", taskId, "checklist"],
    endpoint: TASK_ENDPOINTS.checklist.getTaskChecklist,
    params: { TaskId: taskId },
    enabled: Boolean(taskId && open),
    showErrorMessage: false,
  });
  const checklistItems =
    checklistPayload?.checklist ?? checklistPayload?.items ?? [];

  // Auto-progress: driven entirely by checklist completion.
  const autoProgress = (() => {
    if (checklistItems.length > 0) {
      const done = checklistItems.filter((c) => c.IsCompleted).length;
      return Math.round((done / checklistItems.length) * 100);
    }
    return null; // no checklist; manual applies
  })();

  const saveChecklistMutation = useApiMutation({
    endpoint: TASK_ENDPOINTS.checklist.saveTaskChecklist,
    showSuccessMessage: false,
  });
  const deleteChecklistMutation = useApiMutation({
    endpoint: TASK_ENDPOINTS.checklist.deleteTaskChecklist,
    showSuccessMessage: false,
  });

  const [newChecklistItem, setNewChecklistItem] = useState("");
  // Ids with a save/delete in flight. Locking the row stops a rapid second
  // click from firing a duplicate write against an already-changed/removed
  // item — that double-fire was the "click again, it fails" 404.
  const [pendingChecklist, setPendingChecklist] = useState(() => new Set());
  const checklistKey = ["task", taskId, "checklist"];
  const lockChecklist = (id, on) =>
    setPendingChecklist((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  // Optimistically patch the cached checklist so the row moves instantly
  // instead of after the round-trip; returns the previous value for rollback.
  const patchChecklistCache = (fn) => {
    const prev = queryClient.getQueryData(checklistKey);
    queryClient.setQueryData(checklistKey, (old) =>
      old ? { ...old, checklist: fn(old.checklist ?? old.items ?? []) } : old,
    );
    return prev;
  };

  const addChecklistItem = async () => {
    const text = newChecklistItem.trim();
    if (!text || !task) return;
    try {
      await saveChecklistMutation.mutateAsync({
        Id: 0,
        TaskId: task.Id,
        ItemText: text,
        IsCompleted: false,
        SortOrder: 0,
        WorkspaceId: task.WorkspaceId, // realtime emit-routing hint
      });
      setNewChecklistItem("");
      refetchChecklist();
    } catch {}
  };
  const toggleChecklistItem = async (item) => {
    if (pendingChecklist.has(item.Id)) return; // already in flight
    lockChecklist(item.Id, true);
    const prev = patchChecklistCache((list) =>
      list.map((c) =>
        c.Id === item.Id ? { ...c, IsCompleted: !c.IsCompleted } : c,
      ),
    );
    try {
      await saveChecklistMutation.mutateAsync({
        Id: item.Id,
        TaskId: task.Id,
        ItemText: item.ItemText,
        IsCompleted: !item.IsCompleted,
        SortOrder: item.SortOrder ?? 0,
        WorkspaceId: task.WorkspaceId, // realtime emit-routing hint
      });
      refetchChecklist();
    } catch {
      queryClient.setQueryData(checklistKey, prev); // rollback
    } finally {
      lockChecklist(item.Id, false);
    }
  };
  const removeChecklistItem = async (item) => {
    if (pendingChecklist.has(item.Id)) return;
    lockChecklist(item.Id, true);
    const prev = patchChecklistCache((list) =>
      list.filter((c) => c.Id !== item.Id),
    );
    try {
      await deleteChecklistMutation.mutateAsync({
        Id: item.Id,
        TaskId: task.Id, // server needs it to authorize; the SP only returns it after deleting
        WorkspaceId: task.WorkspaceId,
      });
      refetchChecklist();
    } catch {
      queryClient.setQueryData(checklistKey, prev); // rollback
    } finally {
      lockChecklist(item.Id, false);
    }
  };

  return {
    checklistItems,
    autoProgress,
    newChecklistItem,
    setNewChecklistItem,
    pendingChecklist,
    addChecklistItem,
    toggleChecklistItem,
    removeChecklistItem,
    isSaving: saveChecklistMutation.isPending,
  };
}
