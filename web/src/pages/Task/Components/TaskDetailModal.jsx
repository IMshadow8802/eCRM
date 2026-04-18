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
    label: c.IsDone ? `${c.Title} ✓` : c.Title,
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
        AssignedToUserId: draft.AssignedToUserId,
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
    <Modal open={open} onClose={onClose} size="lg" data-testid="task-detail-modal">
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
            {task.CompletedDate && (
              <Chip
                label={`Done ${dayjs(task.CompletedDate).format("DD-MM-YYYY")}`}
                tone="success"
                size="sm"
              />
            )}
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
                { value: "comments", label: "Comments", badge: comments.length },
                {
                  value: "deps",
                  label: "Dependencies",
                  badge: blockers.length + dependents.length,
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
                    <div style={{ flex: 1 }}>
                      <Combobox
                        label="Assignee"
                        options={userOptions}
                        value={
                          userOptions.find((o) => o.value === draft.AssignedToUserId) ??
                          null
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
                      <NumberInput
                        label="Logged hours"
                        value={draft.LoggedHours}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            LoggedHours: Number(e.target.value) || 0,
                          }))
                        }
                        min={0}
                        step={0.25}
                        disabled={!canEditThisTask}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <NumberInput
                        label="Progress (%)"
                        value={draft.Progress}
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
                        disabled={!canEditThisTask}
                      />
                    </div>
                  </div>
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
                  />
                  <DepSection
                    title={`Blocking (${dependents.length})`}
                    items={dependents}
                    emptyText="Nothing waiting on this task"
                    tone="info"
                  />
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

function DepSection({ title, items, emptyText, tone }) {
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
            const done = Boolean(d.ColumnIsDone);
            return (
              <Chip
                key={d.TaskId}
                label={`${d.Title} — ${done ? "done" : d.ColumnTitle || "open"}`}
                tone={done ? "success" : tone}
                variant="tonal"
                size="md"
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
