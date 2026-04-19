import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";
import dayjs from "dayjs";
import {
  Lock,
  Pin,
  PinOff,
  Trash2,
  Reply,
  Send,
  CornerDownRight,
  Save as SaveIcon,
  CheckSquare,
  Square,
  Plus,
  Clock,
  Link2,
  GitBranch,
  CheckCircle2,
} from "lucide-react";

import {
  Modal,
  Button,
  IconButton,
  TextInput,
  TextArea,
  NumberInput,
  DateField,
  Combobox,
  Chip,
  Avatar,
  Tabs,
  Tooltip,
  Skeleton,
  EmptyState,
} from "../../../components/ui";
import { toUserOptions, getUserId } from "../../../utils/userShape";
import { useApiQuery } from "../../../hooks/useApiQuery";
import { useApiMutation } from "../../../hooks/useApiMutation";
import useAuthStore from "../../../stores/useAuthStore";
import useWorkspaceStore from "../../../stores/useWorkspaceStore";

const PRIORITY_TONE = {
  low: "info",
  medium: "warning",
  high: "error",
  critical: "error",
};

const PRIORITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

export default function TaskDetailModal({ taskId, open, onClose }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("details");
  const [newComment, setNewComment] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const currentUserId = useAuthStore((s) => s.user?.UserId ?? s.UserId);
  const canEditOthers = useWorkspaceStore((s) => s.canEditOthersTasks)();
  const workspaceType = useWorkspaceStore((s) => s.activeWorkspaceType);
  const isPersonal = workspaceType === "personal";

  const { data: taskPayload, refetch: refetchTask } = useApiQuery({
    queryKey: ["task", taskId],
    endpoint: "/api/tasks/fetchTasks",
    params: { Id: taskId },
    enabled: Boolean(taskId && open),
    showErrorMessage: false,
  });
  const task = taskPayload?.tasks?.[0] ?? null;

  const { data: columnsPayload } = useApiQuery({
    queryKey: ["kanban-columns", task?.WorkspaceId],
    endpoint: "/api/kanban/fetchKanbanColumns",
    params: { WorkspaceId: task?.WorkspaceId, PageNumber: 1, PageSize: 100 },
    enabled: Boolean(task?.WorkspaceId && open),
    showErrorMessage: false,
  });
  const workspaceColumns =
    columnsPayload?.kanbanColumns ?? columnsPayload?.columns ?? [];
  const columnOptions = workspaceColumns.map((c) => ({
    value: c.Id,
    label: c.Title,
  }));

  const { data: usersPayload } = useApiQuery({
    queryKey: ["users", "pick-list"],
    endpoint: "/api/users/fetchUsers",
    params: { PageNumber: 1, PageSize: 200 },
    enabled: Boolean(taskId && open),
    showErrorMessage: false,
  });
  const userOptions = toUserOptions(usersPayload?.users, { withJobTitle: false })
    .map((o) => ({ value: Number(o.value), label: o.label }));

  // Draft state — mirrors task on load so user can edit + save at once.
  const [draft, setDraft] = useState(null);
  useEffect(() => {
    if (!task) return;
    const normPriority = String(task.Priority ?? "medium").toLowerCase();
    setDraft({
      Title: task.Title ?? "",
      Description: task.Description ?? "",
      ColumnId: task.ColumnId ?? null,
      Priority: PRIORITY_OPTIONS.some((o) => o.value === normPriority)
        ? normPriority
        : "medium",
      AssignedToUserId: task.AssignedToUserId ?? null,
      DueDate: task.DueDate ? String(task.DueDate).slice(0, 10) : "",
      EstimatedHours: Number(task.EstimatedHours ?? 0),
      LoggedHours: Number(task.LoggedHours ?? 0),
      Progress: Number(task.Progress ?? 0),
    });
  }, [task?.Id, task?.UpdatedDate, task?.Priority]);

  const canEditThisTask =
    task && (canEditOthers || task.CreatedByUserId === currentUserId);

  const isDirty = draft && task && (
    draft.Title !== (task.Title ?? "") ||
    draft.Description !== (task.Description ?? "") ||
    draft.ColumnId !== (task.ColumnId ?? null) ||
    draft.Priority !== (task.Priority ?? "medium") ||
    draft.AssignedToUserId !== (task.AssignedToUserId ?? null) ||
    draft.DueDate !== (task.DueDate ? String(task.DueDate).slice(0, 10) : "") ||
    Number(draft.EstimatedHours) !== Number(task.EstimatedHours ?? 0) ||
    Number(draft.LoggedHours) !== Number(task.LoggedHours ?? 0) ||
    Number(draft.Progress) !== Number(task.Progress ?? 0)
  );

  const saveDraft = async () => {
    if (!task || !draft) return;
    try {
      await saveMutation.mutateAsync({
        Id: task.Id,
        Title: draft.Title.trim() || task.Title,
        Description: draft.Description,
        WorkspaceId: task.WorkspaceId,
        ColumnId: draft.ColumnId,
        ProjectId: task.ProjectId,
        ParentTaskId: task.ParentTaskId,
        AssignedToUserId: isPersonal ? currentUserId : draft.AssignedToUserId,
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

  const { data: commentsPayload, refetch: refetchComments } = useApiQuery({
    queryKey: ["task", taskId, "comments"],
    endpoint: "/api/tasks/getTaskComments",
    params: { TaskId: taskId, PageNumber: 1, PageSize: 100 },
    enabled: Boolean(taskId && open),
    showErrorMessage: false,
  });
  const comments = commentsPayload?.comments ?? [];

  const { data: depsPayload, refetch: refetchDeps } = useApiQuery({
    queryKey: ["task", taskId, "deps"],
    endpoint: "/api/tasks/fetchTaskDependencies",
    params: { TaskId: taskId },
    enabled: Boolean(taskId && open),
    showErrorMessage: false,
  });
  const blockers = depsPayload?.blockers ?? [];
  const dependents = depsPayload?.dependents ?? [];

  const { data: checklistPayload, refetch: refetchChecklist } = useApiQuery({
    queryKey: ["task", taskId, "checklist"],
    endpoint: "/api/tasks/getTaskChecklist",
    params: { TaskId: taskId },
    enabled: Boolean(taskId && open),
    showErrorMessage: false,
  });
  const checklistItems =
    checklistPayload?.checklist ?? checklistPayload?.items ?? [];

  // Piggy-back on a workspace-wide fetchTasks to populate the dependency
  // picker. Cheap at expected board size.
  const { data: workspaceTasksPayload } = useApiQuery({
    queryKey: ["tasks-all", task?.WorkspaceId],
    endpoint: "/api/tasks/fetchTasks",
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

  const { data: timeEntriesPayload, refetch: refetchTimeEntries } = useApiQuery({
    queryKey: ["task", taskId, "time"],
    endpoint: "/api/tasks/getTaskTimeEntries",
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

  // Auto-progress: driven entirely by checklist completion.
  const autoProgress = (() => {
    if (checklistItems.length > 0) {
      const done = checklistItems.filter((c) => c.IsCompleted).length;
      return Math.round((done / checklistItems.length) * 100);
    }
    return null; // no checklist; manual applies
  })();

  const saveMutation = useApiMutation({
    endpoint: "/api/tasks/saveTask",
    showSuccessMessage: false,
  });
  const addCommentMutation = useApiMutation({
    endpoint: "/api/tasks/addTaskComment",
    showSuccessMessage: false,
  });
  const deleteCommentMutation = useApiMutation({
    endpoint: "/api/tasks/deleteTaskComment",
    showSuccessMessage: false,
  });
  const pinCommentMutation = useApiMutation({
    endpoint: "/api/tasks/pinTaskComment",
    showSuccessMessage: false,
  });
  const saveChecklistMutation = useApiMutation({
    endpoint: "/api/tasks/saveTaskChecklist",
    showSuccessMessage: false,
  });
  const deleteChecklistMutation = useApiMutation({
    endpoint: "/api/tasks/deleteTaskChecklist",
    showSuccessMessage: false,
  });
  const logTimeMutation = useApiMutation({
    endpoint: "/api/tasks/logTaskTime",
    showSuccessMessage: false,
  });
  const deleteTimeMutation = useApiMutation({
    endpoint: "/api/tasks/deleteTaskTimeEntry",
    showSuccessMessage: false,
  });
  const addDependencyMutation = useApiMutation({
    endpoint: "/api/tasks/addTaskDependency",
    showSuccessMessage: false,
  });
  const removeDependencyMutation = useApiMutation({
    endpoint: "/api/tasks/removeTaskDependency",
    showSuccessMessage: false,
  });
  // Checklist handlers
  const [newChecklistItem, setNewChecklistItem] = useState("");
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
      });
      setNewChecklistItem("");
      refetchChecklist();
    } catch {}
  };
  const toggleChecklistItem = async (item) => {
    try {
      await saveChecklistMutation.mutateAsync({
        Id: item.Id,
        TaskId: task.Id,
        ItemText: item.ItemText,
        IsCompleted: !item.IsCompleted,
        SortOrder: item.SortOrder ?? 0,
      });
      refetchChecklist();
    } catch {}
  };
  const removeChecklistItem = async (item) => {
    try {
      await deleteChecklistMutation.mutateAsync({ Id: item.Id });
      refetchChecklist();
    } catch {}
  };

  // Dependencies add/remove
  const [blockerPick, setBlockerPick] = useState(null);
  const [dependentPick, setDependentPick] = useState(null);
  const addBlocker = async () => {
    if (!blockerPick?.value) return;
    try {
      await addDependencyMutation.mutateAsync({
        TaskId: task.Id,
        DependsOnTaskId: blockerPick.value,
        Type: "blocks",
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
      });
      refetchDeps();
    } catch {}
  };

  // Time logging
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
        LogDate: dayjs().format("YYYY-MM-DD"),
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
      await deleteTimeMutation.mutateAsync({ Id: entry.Id });
      refetchTimeEntries();
    } catch {}
  };


  const submitComment = async () => {
    const text = newComment.trim();
    if (!text) return;
    try {
      await addCommentMutation.mutateAsync({
        TaskId: taskId,
        Comment: text,
        ParentCommentId: replyTo || null,
      });
      setNewComment("");
      setReplyTo(null);
      refetchComments();
    } catch {}
  };

  if (!open) return null;

  return (
    <>
    <Modal open={open} onClose={onClose} size="xl" data-testid="task-detail-modal">
      <Modal.Header
        title={task?.Title ?? "Loading…"}
        subtitle={
          task
            ? `#${task.Id} · ${task.WorkspaceName ?? "Workspace"}`
            : undefined
        }
        onClose={onClose}
      >
        {task && (
          <div
            style={{
              display: "flex",
              gap: 6,
              marginTop: 6,
              alignItems: "center",
            }}
          >
            <Chip
              label={task.Priority ?? "medium"}
              tone={PRIORITY_TONE[task.Priority] ?? "warning"}
              size="sm"
              variant="tonal"
            />
            {task.IsBlocked && (
              <Chip
                label="Blocked"
                icon={<Lock size={11} />}
                tone="error"
                size="sm"
              />
            )}
            {task.IsCompleted ? (
              <Chip
                icon={<CheckCircle2 size={11} />}
                label={
                  task.CompletedDate
                    ? `Done ${dayjs(task.CompletedDate).format("DD-MM-YYYY")}`
                    : "Done"
                }
                tone="success"
                size="sm"
                data-testid="task-completed-chip"
              />
            ) : null}
          </div>
        )}
      </Modal.Header>

      <Modal.Body>
        {!task ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Skeleton variant="text" height={22} />
            <Skeleton variant="text" height={16} />
            <Skeleton variant="rect" height={120} />
          </div>
        ) : (
          <>
            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                { value: "details", label: "Details" },
                {
                  value: "checklist",
                  label: "Checklist",
                  badge: checklistItems.length,
                },
                {
                  value: "comments",
                  label: "Comments",
                  badge: comments.length,
                },
                {
                  value: "deps",
                  label: "Dependencies",
                  badge: blockers.length + dependents.length,
                },
                {
                  value: "time",
                  label: "Time",
                  badge: timeEntries.length,
                },
              ]}
              data-testid="task-tabs"
            />

            <div style={{ marginTop: 20 }}>
              {tab === "details" && draft && (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  <TextInput
                    label="Title"
                    value={draft.Title}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, Title: e.target.value }))
                    }
                    disabled={!canEditThisTask}
                    required
                    data-testid="task-title-input"
                  />
                  <TextArea
                    label="Description"
                    value={draft.Description}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, Description: e.target.value }))
                    }
                    rows={4}
                    disabled={!canEditThisTask}
                    data-testid="task-description-input"
                  />
                  <div style={{ display: "flex", gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <Combobox
                        label="Column"
                        options={columnOptions}
                        value={
                          columnOptions.find((o) => o.value === draft.ColumnId) ??
                          null
                        }
                        onChange={(v) =>
                          setDraft((d) => ({ ...d, ColumnId: v?.value ?? null }))
                        }
                        disabled={!canEditThisTask}
                        data-testid="task-column-select"
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <Combobox
                        label="Priority"
                        options={PRIORITY_OPTIONS}
                        value={
                          PRIORITY_OPTIONS.find((o) => o.value === draft.Priority) ??
                          null
                        }
                        onChange={(v) =>
                          setDraft((d) => ({
                            ...d,
                            Priority: v?.value ?? "medium",
                          }))
                        }
                        disabled={!canEditThisTask}
                        data-testid="task-priority-select"
                      />
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 12 }}>
                    {!isPersonal && (
                      <div style={{ flex: 1 }}>
                        <Combobox
                          label="Assignee"
                          options={userOptions}
                          value={
                            userOptions.find(
                              (o) => o.value === draft.AssignedToUserId,
                            ) ?? null
                          }
                          onChange={(v) =>
                            setDraft((d) => ({
                              ...d,
                              AssignedToUserId: v?.value ?? null,
                            }))
                          }
                          disabled={!canEditThisTask}
                          placeholder="Unassigned"
                          data-testid="task-assignee-select"
                        />
                      </div>
                    )}
                    <div style={{ flex: 1 }}>
                      <DateField
                        label="Due date"
                        value={draft.DueDate || null}
                        onChange={(iso) =>
                          setDraft((d) => ({ ...d, DueDate: iso || "" }))
                        }
                        disabled={!canEditThisTask}
                        data-testid="task-due-input"
                      />
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <NumberInput
                        label="Estimated hours"
                        value={draft.EstimatedHours}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            EstimatedHours: Number(e.target.value) || 0,
                          }))
                        }
                        min={0}
                        step={0.5}
                        disabled={!canEditThisTask}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          marginBottom: 6,
                          color: "var(--color-surface-600)",
                        }}
                      >
                        Logged hours
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          height: 40,
                        }}
                      >
                        <Chip
                          label={`${loggedHoursTotal.toFixed(2)} h`}
                          tone={
                            draft.EstimatedHours > 0 &&
                            loggedHoursTotal > draft.EstimatedHours
                              ? "error"
                              : "default"
                          }
                          size="sm"
                          variant="tonal"
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          leftIcon={<Clock size={14} />}
                          onClick={() => setLogOpen(true)}
                          disabled={!canEditThisTask}
                          data-testid="log-time-btn"
                        >
                          Log time
                        </Button>
                      </div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <NumberInput
                        label={
                          autoProgress != null
                            ? `Progress — auto ${autoProgress}%`
                            : "Progress (%)"
                        }
                        value={
                          autoProgress != null ? autoProgress : draft.Progress
                        }
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            Progress: Math.max(
                              0,
                              Math.min(100, Number(e.target.value) || 0),
                            ),
                          }))
                        }
                        min={0}
                        max={100}
                        step={5}
                        disabled={!canEditThisTask || autoProgress != null}
                        hint={
                          autoProgress != null
                            ? "Driven by checklist — tick each item to progress"
                            : undefined
                        }
                      />
                    </div>
                  </div>
                </div>
              )}

              {tab === "checklist" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {checklistItems.length === 0 ? (
                    <EmptyState
                      icon={<CheckSquare size={28} />}
                      title="No checklist yet"
                      description="Break this task into quick steps. Tick them off as you go."
                      size="sm"
                    />
                  ) : (
                    checklistItems.map((it) => (
                      <ChecklistRow
                        key={it.Id}
                        item={it}
                        canEdit={canEditThisTask}
                        onToggle={() => toggleChecklistItem(it)}
                        onDelete={() => removeChecklistItem(it)}
                      />
                    ))
                  )}
                  {canEditThisTask && (
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                        marginTop: 6,
                      }}
                    >
                      <TextInput
                        value={newChecklistItem}
                        onChange={(e) => setNewChecklistItem(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") addChecklistItem();
                        }}
                        placeholder="Add a step…"
                        size="sm"
                        data-testid="checklist-input"
                      />
                      <Button
                        variant="primary"
                        size="sm"
                        leftIcon={<Plus size={14} />}
                        onClick={addChecklistItem}
                        loading={saveChecklistMutation.isPending}
                        data-testid="checklist-add"
                      >
                        Add
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {tab === "time" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      fontSize: 13,
                    }}
                  >
                    <div>
                      Total logged:{" "}
                      <strong>{loggedHoursTotal.toFixed(2)} h</strong>
                      {draft?.EstimatedHours > 0 && (
                        <>
                          {" "}/ {draft.EstimatedHours.toFixed(2)} h estimated
                        </>
                      )}
                    </div>
                    <Button
                      variant="primary"
                      size="sm"
                      leftIcon={<Clock size={14} />}
                      onClick={() => setLogOpen(true)}
                      disabled={!canEditThisTask}
                    >
                      Log time
                    </Button>
                  </div>
                  {timeEntries.length === 0 ? (
                    <EmptyState
                      icon={<Clock size={28} />}
                      title="No time logged"
                      description="Track real hours as you work so the team sees actuals vs estimate."
                      size="sm"
                    />
                  ) : (
                    timeEntries.map((e) => (
                      <TimeEntryRow
                        key={e.Id}
                        entry={e}
                        canEdit={
                          canEditThisTask || e.UserId === currentUserId
                        }
                        onDelete={() => removeTimeEntry(e)}
                      />
                    ))
                  )}
                </div>
              )}

              {tab === "comments" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {comments.length === 0 ? (
                    <EmptyState
                      title="No comments yet"
                      description="Kick off the thread. Ping the assignee, ask a question, share context."
                      size="sm"
                    />
                  ) : (
                    comments.map((c) => (
                      <CommentBubble
                        key={c.Id}
                        comment={c}
                        currentUserId={currentUserId}
                        onReply={() => setReplyTo(c.Id)}
                        onDelete={() =>
                          deleteCommentMutation
                            .mutateAsync({ Id: c.Id })
                            .then(refetchComments)
                        }
                        onTogglePin={() =>
                          pinCommentMutation
                            .mutateAsync({
                              CommentId: c.Id,
                              IsPinned: !c.IsPinned,
                            })
                            .then(refetchComments)
                        }
                      />
                    ))
                  )}

                  <div
                    style={{
                      borderTop: "1px solid var(--color-surface-200)",
                      paddingTop: 12,
                    }}
                  >
                    {replyTo && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          fontSize: 12,
                          color: "var(--color-surface-500)",
                          marginBottom: 8,
                        }}
                      >
                        <CornerDownRight size={12} />
                        Replying to comment #{replyTo}
                        <Button
                          variant="text"
                          size="sm"
                          onClick={() => setReplyTo(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    )}
                    <TextArea
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      placeholder={
                        replyTo ? "Write a reply…" : "Write a comment…"
                      }
                      rows={3}
                      autoGrow
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey))
                          submitComment();
                      }}
                    />
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "flex-end",
                        marginTop: 8,
                      }}
                    >
                      <Button
                        variant="primary"
                        onClick={submitComment}
                        disabled={!newComment.trim()}
                        rightIcon={<Send size={14} />}
                        data-testid="comment-submit"
                      >
                        Send
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {tab === "deps" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  <DepSection
                    title={`Blocked by (${blockers.length})`}
                    items={blockers}
                    emptyText="No blockers"
                    tone="error"
                    canEdit={canEditThisTask}
                    onRemove={(d) => removeDependency(task.Id, d.TaskId)}
                  />
                  {canEditThisTask && (
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <Combobox
                          options={potentialDepOptions.filter(
                            (o) =>
                              !blockers.some((b) => b.TaskId === o.value),
                          )}
                          value={blockerPick}
                          onChange={setBlockerPick}
                          placeholder="Pick a task that blocks this one"
                          size="sm"
                          data-testid="blocker-pick"
                        />
                      </div>
                      <Button
                        variant="primary"
                        size="sm"
                        leftIcon={<Link2 size={14} />}
                        onClick={addBlocker}
                        disabled={!blockerPick}
                        loading={addDependencyMutation.isPending}
                        data-testid="add-blocker-btn"
                      >
                        Add blocker
                      </Button>
                    </div>
                  )}

                  <DepSection
                    title={`Blocking (${dependents.length})`}
                    items={dependents}
                    emptyText="Nothing waiting on this task"
                    tone="info"
                    canEdit={canEditThisTask}
                    onRemove={(d) => removeDependency(d.TaskId, task.Id)}
                  />
                  {canEditThisTask && (
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <Combobox
                          options={potentialDepOptions.filter(
                            (o) =>
                              !dependents.some((d) => d.TaskId === o.value),
                          )}
                          value={dependentPick}
                          onChange={setDependentPick}
                          placeholder="Pick a task that waits on this one"
                          size="sm"
                          data-testid="dependent-pick"
                        />
                      </div>
                      <Button
                        variant="primary"
                        size="sm"
                        leftIcon={<GitBranch size={14} />}
                        onClick={addDependent}
                        disabled={!dependentPick}
                        loading={addDependencyMutation.isPending}
                        data-testid="add-dependent-btn"
                      >
                        Add dependent
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </Modal.Body>
      {task && tab === "details" && canEditThisTask && (
        <Modal.Footer>
          <Button variant="ghost" onClick={onClose} disabled={saveMutation.isPending}>
            Close
          </Button>
          <Button
            variant="primary"
            leftIcon={<SaveIcon size={14} />}
            onClick={saveDraft}
            disabled={!isDirty}
            loading={saveMutation.isPending}
            data-testid="task-save-btn"
          >
            Save changes
          </Button>
        </Modal.Footer>
      )}
    </Modal>

    <Modal
      open={logOpen}
      onClose={() => setLogOpen(false)}
      size="sm"
      data-testid="log-time-modal"
    >
        <Modal.Header
          title="Log time"
          subtitle={task ? `On "${task.Title}"` : ""}
          icon={<Clock size={18} />}
          onClose={() => setLogOpen(false)}
        />
        <Modal.Body>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <NumberInput
              label="Hours"
              value={logHours}
              onChange={(e) => setLogHours(Number(e.target.value) || 0)}
              min={0}
              step={0.25}
              autoFocus
              data-testid="log-time-hours"
            />
            <TextArea
              label="Note (optional)"
              value={logNote}
              onChange={(e) => setLogNote(e.target.value)}
              rows={3}
              placeholder="What did you work on?"
            />
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={() => setLogOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submitLogTime}
            loading={logTimeMutation.isPending}
            data-testid="log-time-submit"
          >
            Log
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}

function CommentBubble({
  comment: c,
  currentUserId,
  onReply,
  onDelete,
  onTogglePin,
}) {
  return (
    <div
      data-testid={`comment-${c.Id}`}
      style={{
        padding: 12,
        borderRadius: 12,
        backgroundColor: c.IsPinned
          ? "var(--color-warning-50)"
          : "var(--color-surface-50)",
        border: `1px solid ${c.IsPinned ? "var(--color-warning-500)" : "var(--color-surface-200)"}`,
        marginLeft: c.ParentCommentId ? 28 : 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <Avatar name={c.UserName} size="sm" />
        <span style={{ fontSize: 13, fontWeight: 600 }}>{c.UserName}</span>
        {c.IsEdited ? (
          <span style={{ fontSize: 11, color: "var(--color-surface-400)" }}>
            edited
          </span>
        ) : null}
        <span
          style={{
            fontSize: 11,
            color: "var(--color-surface-400)",
            marginLeft: "auto",
          }}
        >
          {new Date(c.CreatedDate).toLocaleString()}
        </span>
        <Tooltip title={c.IsPinned ? "Unpin" : "Pin"}>
          <IconButton
            size="sm"
            variant="ghost"
            onClick={onTogglePin}
            data-testid={`pin-${c.Id}`}
            aria-label={c.IsPinned ? "Unpin comment" : "Pin comment"}
          >
            {c.IsPinned ? <Pin size={14} /> : <PinOff size={14} />}
          </IconButton>
        </Tooltip>
        <Tooltip title="Reply">
          <IconButton
            size="sm"
            variant="ghost"
            onClick={onReply}
            aria-label="Reply"
          >
            <Reply size={14} />
          </IconButton>
        </Tooltip>
        {c.UserId === currentUserId && (
          <Tooltip title="Delete">
            <IconButton
              size="sm"
              variant="destructive"
              onClick={onDelete}
              data-testid={`delete-${c.Id}`}
              aria-label="Delete comment"
            >
              <Trash2 size={14} />
            </IconButton>
          </Tooltip>
        )}
      </div>
      <div
        style={{
          fontSize: 14,
          lineHeight: 1.5,
          color: c.IsDeleted
            ? "var(--color-surface-400)"
            : "var(--color-surface-900)",
        }}
      >
        {c.Comment}
      </div>
      {c.ReadByUserIds && (
        <div
          style={{
            fontSize: 11,
            color: "var(--color-surface-400)",
            marginTop: 6,
          }}
        >
          Seen by {c.ReadByUserIds.split(",").length}
        </div>
      )}
    </div>
  );
}

function DepSection({ title, items, emptyText, tone, canEdit, onRemove }) {
  return (
    <div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          marginBottom: 8,
          color: "var(--color-surface-600)",
        }}
      >
        {title}
      </div>
      {items.length === 0 ? (
        <div
          style={{
            fontSize: 13,
            color: "var(--color-surface-400)",
            fontStyle: "italic",
          }}
        >
          {emptyText}
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {items.map((d) => {
            const done = Boolean(d.IsCompleted);
            return (
              <Chip
                key={d.TaskId}
                label={`${d.Title} — ${done ? "done" : d.ColumnTitle || "open"}`}
                tone={done ? "success" : tone}
                variant="tonal"
                size="md"
                onDelete={canEdit ? () => onRemove?.(d) : undefined}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function ChecklistRow({ item, canEdit, onToggle, onDelete }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "6px 8px",
        borderRadius: 8,
      }}
    >
      <button
        type="button"
        onClick={canEdit ? onToggle : undefined}
        disabled={!canEdit}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          border: "none",
          background: "transparent",
          cursor: canEdit ? "pointer" : "default",
          color: item.IsCompleted ? "#10B981" : "#94A3B8",
          padding: 0,
        }}
        data-testid={`checklist-toggle-${item.Id}`}
      >
        {item.IsCompleted ? <CheckSquare size={18} /> : <Square size={18} />}
      </button>
      <span
        style={{
          flex: 1,
          fontSize: 14,
          color: "var(--color-surface-700)",
          textDecoration: item.IsCompleted ? "line-through" : "none",
          opacity: item.IsCompleted ? 0.6 : 1,
        }}
      >
        {item.ItemText}
      </span>
      {canEdit && (
        <IconButton
          size="sm"
          variant="ghost"
          onClick={onDelete}
          aria-label="Remove item"
        >
          <Trash2 size={14} />
        </IconButton>
      )}
    </div>
  );
}

function TimeEntryRow({ entry, canEdit, onDelete }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        borderRadius: 8,
        border: "1px solid rgba(148,163,184,0.18)",
      }}
    >
      <Clock size={14} style={{ color: "#6366F1" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>
          {Number(entry.Hours ?? 0).toFixed(2)} h
          {entry.LogDate && (
            <span
              style={{
                fontWeight: 400,
                marginLeft: 8,
                color: "var(--color-surface-500)",
              }}
            >
              {dayjs(entry.LogDate).format("DD-MM-YYYY")}
            </span>
          )}
        </div>
        {entry.Description && (
          <div
            style={{
              fontSize: 12,
              color: "var(--color-surface-500)",
              marginTop: 2,
              wordBreak: "break-word",
            }}
          >
            {entry.Description}
          </div>
        )}
        {entry.UserFullName && (
          <div
            style={{ fontSize: 11, color: "var(--color-surface-400)", marginTop: 2 }}
          >
            {entry.UserFullName}
          </div>
        )}
      </div>
      {canEdit && (
        <IconButton
          size="sm"
          variant="ghost"
          onClick={onDelete}
          aria-label="Delete time entry"
        >
          <Trash2 size={14} />
        </IconButton>
      )}
    </div>
  );
}
