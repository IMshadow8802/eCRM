import { useState } from "react";
import {
  Lock,
  Pin,
  PinOff,
  Trash2,
  Reply,
  Send,
  CornerDownRight,
} from "lucide-react";

import {
  Modal,
  Button,
  IconButton,
  TextArea,
  Combobox,
  Chip,
  Avatar,
  Tabs,
  Tooltip,
  Skeleton,
  EmptyState,
} from "../../../components/ui";
import { useApiQuery } from "../../../hooks/useApiQuery";
import { useApiMutation } from "../../../hooks/useApiMutation";
import useAuthStore from "../../../stores/useAuthStore";
import useWorkspaceStore from "../../../stores/useWorkspaceStore";

const STATUS_OPTIONS = [
  { value: "todo", label: "To Do" },
  { value: "in-progress", label: "In Progress" },
  { value: "review", label: "Review" },
  { value: "done", label: "Done" },
];

const PRIORITY_TONE = {
  low: "info",
  medium: "warning",
  high: "error",
  critical: "error",
};

export default function TaskDetailModal({ taskId, open, onClose }) {
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

  const changeStatus = async (newStatus) => {
    if (!task) return;
    try {
      await saveMutation.mutateAsync({
        Id: task.Id,
        Title: task.Title,
        Description: task.Description,
        WorkspaceId: task.WorkspaceId,
        ProjectId: task.ProjectId,
        ParentTaskId: task.ParentTaskId,
        AssignedToUserId: task.AssignedToUserId,
        TeamId: task.TeamId,
        Priority: task.Priority,
        Type: task.Type,
        Status: newStatus?.value ?? newStatus,
        DueDate: task.DueDate,
        EstimatedHours: task.EstimatedHours,
        LoggedHours: task.LoggedHours,
        Progress: task.Progress,
        IsBlocked: task.IsBlocked,
        Labels: task.Labels,
        Watchers: task.Watchers,
      });
      refetchTask();
    } catch {
      refetchTask();
    }
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
                label={`Done ${new Date(task.CompletedDate).toLocaleDateString()}`}
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
              {tab === "details" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  <TextArea
                    label="Description"
                    value={task.Description ?? ""}
                    rows={4}
                    disabled={
                      !canEditOthers && task.CreatedByUserId !== currentUserId
                    }
                  />
                  <div style={{ display: "flex", gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <Combobox
                        label="Status"
                        options={STATUS_OPTIONS}
                        value={STATUS_OPTIONS.find((s) => s.value === task.Status)}
                        onChange={(v) => changeStatus(v)}
                        data-testid="task-status-select"
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <Combobox
                        label="Priority"
                        options={[
                          { value: "low", label: "Low" },
                          { value: "medium", label: "Medium" },
                          { value: "high", label: "High" },
                          { value: "critical", label: "Critical" },
                        ]}
                        value={{ value: task.Priority, label: task.Priority }}
                        onChange={() => {}}
                        disabled
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
          {items.map((d) => (
            <Chip
              key={d.TaskId}
              label={`${d.Title} — ${d.Status}`}
              tone={d.Status === "done" ? "success" : tone}
              variant="tonal"
              size="md"
            />
          ))}
        </div>
      )}
    </div>
  );
}
