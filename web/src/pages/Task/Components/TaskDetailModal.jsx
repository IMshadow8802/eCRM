import { useState } from "react";
import dayjs from "dayjs";
import {
  Lock,
  Save as SaveIcon,
  Clock,
  CheckCircle2,
} from "lucide-react";

import {
  Modal,
  Button,
  TextInput,
  TextArea,
  NumberInput,
  DateField,
  Combobox,
  Chip,
  Tabs,
  Skeleton,
} from "../../../components/ui";
import Attachments from "../../../components/Attachments";
import { TASK_ENDPOINTS } from "../../../api/taskQueries";
import { PLATFORM_ENDPOINTS } from "../../../api/platformQueries";
import { useApiQuery } from "../../../hooks/useApiQuery";
import useAuthStore from "../../../stores/useAuthStore";
import useWorkspaceStore from "../../../stores/useWorkspaceStore";
import useWorkspaceMemberOptions from "../../../hooks/useWorkspaceMemberOptions";
import { isAssignee } from "../../../utils/taskAssignees";

import { PRIORITY_TONE, PRIORITY_OPTIONS } from "./TaskDetail/helpers";
import useTaskDraft from "./TaskDetail/useTaskDraft";
import useTaskChecklist from "./TaskDetail/useTaskChecklist";
import useTaskComments from "./TaskDetail/useTaskComments";
import useTaskDependencies from "./TaskDetail/useTaskDependencies";
import useTaskTimeEntries from "./TaskDetail/useTaskTimeEntries";
import ChecklistPanel from "./TaskDetail/ChecklistPanel";
import CommentsPanel from "./TaskDetail/CommentsPanel";
import DependenciesPanel from "./TaskDetail/DependenciesPanel";
import HistoryPanel from "./TaskDetail/HistoryPanel";
import TimePanel from "./TaskDetail/TimePanel";
import LogTimeModal from "./TaskDetail/LogTimeModal";

export default function TaskDetailModal({ taskId, open, onClose }) {
  const [tab, setTab] = useState("details");
  const currentUserId = useAuthStore((s) => s.user?.UserId ?? s.UserId);
  const canEditOthers = useWorkspaceStore((s) => s.canEditOthersTasks)();
  const canCreateTasks = useWorkspaceStore((s) => s.canCreateTasks)();
  const workspaceRole = useWorkspaceStore((s) => s.activeWorkspaceRole);
  const isViewer = workspaceRole === "viewer";
  const workspaceType = useWorkspaceStore((s) => s.activeWorkspaceType);
  const isPersonal = workspaceType === "personal";

  const { data: taskPayload, refetch: refetchTask } = useApiQuery({
    queryKey: ["task", taskId],
    endpoint: TASK_ENDPOINTS.tasks.fetchTasks,
    params: { Id: taskId },
    enabled: Boolean(taskId && open),
    showErrorMessage: false,
  });
  const task = taskPayload?.tasks?.[0] ?? null;

  const { data: columnsPayload } = useApiQuery({
    queryKey: ["kanban-columns", task?.WorkspaceId],
    endpoint: PLATFORM_ENDPOINTS.kanban.fetchKanbanColumns,
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

  // Only ACTIVE workspace members can be assigned — sp_SaveTask rejects anyone
  // else with a 400, so offering the whole company roster (as this used to)
  // just produced a confusing error after the fact.
  const { options: userOptions } = useWorkspaceMemberOptions(task?.WorkspaceId, {
    enabled: Boolean(taskId && open) && !isPersonal,
  });

  // One hook per feature concern — each owns its queries, mutations and the
  // handlers its panel needs.
  const details = useTaskDraft({
    task,
    isPersonal,
    currentUserId,
    onClose,
    refetchTask,
  });
  const { draft, setDraft } = details;
  const checklist = useTaskChecklist(taskId, task, open);
  const commentThread = useTaskComments(taskId, task, open);
  const deps = useTaskDependencies(taskId, task, open);
  const time = useTaskTimeEntries(taskId, task, open);

  // History tab — the task's audit trail (added/ticked/edited/deleted, by whom,
  // when), read from the shared activity log. Reuses tblActivityLog; no new
  // table. Fetch it lazily (only once the tab is opened) to keep the modal light.
  const { data: activityPayload } = useApiQuery({
    queryKey: ["task", taskId, "activity"],
    endpoint: TASK_ENDPOINTS.activity.getTaskActivity,
    params: { TaskId: taskId, PageNumber: 1, PageSize: 100 },
    enabled: Boolean(taskId && open && tab === "history"),
    showErrorMessage: false,
  });
  const activities = activityPayload?.activities ?? [];

  const canEditThisTask =
    task && (canEditOthers || task.CreatedByUserId === currentUserId);

  // A task holds a SET of assignees now; read it through assigneesOf() rather
  // than the legacy scalar, which is only a mirror of the first one.
  const amAssignee = isAssignee(task, currentUserId);

  // Progress — doing the work you were handed (tick, move column, log time).
  // Any assignee, including a viewer: if you were given the work you can do it.
  const canProgressThisTask = canEditThisTask || amAssignee;

  // Work artifacts — the checklist steps and the files that evidence them. A
  // step routinely needs a document against it, so assignees hold both. An
  // assigned VIEWER is deliberately excluded: viewer stays genuinely limited,
  // since that is the role an external client gets. Mirrors the server's
  // manage_checklist / manage_attachments actions.
  const canManageArtifacts = canEditThisTask || (amAssignee && !isViewer);

  // sp_CheckTaskPermission grants log_time to owner/manager/member — the same
  // set as canCreateTasks — and grants the owner everything on a personal
  // workspace, which has no member rows at all (so the role is null there).
  // This used to be gated on canEditThisTask, which is stricter, so an assigned
  // member saw the button disabled on the very work they were tracking.
  const canLogTime = isPersonal || canCreateTasks || canProgressThisTask;

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

      {/* Tab strip lives between the header and the scrolling body — a fixed
          flex-column sibling, so it never scrolls and content never bleeds
          past it, while Modal.Body scrolls on its own as before. */}
      {task && (
        <div
          style={{
            flexShrink: 0,
            padding: "12px 20px 0",
            borderBottom: "1px solid var(--color-surface-200)",
            background: "var(--color-surface-0)",
          }}
        >
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { value: "details", label: "Details" },
              {
                value: "checklist",
                label: "Checklist",
                badge: checklist.checklistItems.length,
              },
              {
                value: "comments",
                label: "Comments",
                badge: commentThread.comments.length,
              },
              {
                value: "deps",
                label: "Dependencies",
                badge: deps.blockers.length + deps.dependents.length,
              },
              {
                value: "time",
                label: "Time",
                badge: time.timeEntries.length,
              },
              { value: "history", label: "History" },
            ]}
            data-testid="task-tabs"
          />
        </div>
      )}

      <Modal.Body>
        {!task ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Skeleton variant="text" height={22} />
            <Skeleton variant="text" height={16} />
            <Skeleton variant="rect" height={120} />
          </div>
        ) : (
          <div>
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
                          label="Assignees"
                          multiple
                          options={userOptions}
                          value={userOptions.filter((o) =>
                            (draft.AssigneeIds ?? []).includes(o.value),
                          )}
                          onChange={(v) =>
                            setDraft((d) => ({
                              ...d,
                              AssigneeIds: (Array.isArray(v) ? v : [])
                                .map((o) => o.value),
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
                          label={`${time.loggedHoursTotal.toFixed(2)} h`}
                          tone={
                            draft.EstimatedHours > 0 &&
                            time.loggedHoursTotal > draft.EstimatedHours
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
                          onClick={() => time.setLogOpen(true)}
                          disabled={!canLogTime}
                          data-testid="log-time-btn"
                        >
                          Log time
                        </Button>
                      </div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <NumberInput
                        label={
                          checklist.autoProgress != null
                            ? `Progress — auto ${checklist.autoProgress}%`
                            : "Progress (%)"
                        }
                        value={
                          checklist.autoProgress != null
                            ? checklist.autoProgress
                            : draft.Progress
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
                        disabled={!canEditThisTask || checklist.autoProgress != null}
                        hint={
                          checklist.autoProgress != null
                            ? "Driven by checklist — tick each item to progress"
                            : undefined
                        }
                      />
                    </div>
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        marginBottom: 8,
                        color: "var(--color-surface-600)",
                      }}
                    >
                      Attachments
                    </div>
                    <Attachments entity="task" entityId={task.Id} />
                  </div>
                </div>
              )}

              {tab === "checklist" && (
                <ChecklistPanel
                  checklist={checklist}
                  canProgressThisTask={canProgressThisTask}
                  canManageArtifacts={canManageArtifacts}
                />
              )}

              {tab === "time" && (
                <TimePanel
                  time={time}
                  estimatedHours={draft?.EstimatedHours}
                  canLogTime={canLogTime}
                  canEditThisTask={canEditThisTask}
                  currentUserId={currentUserId}
                />
              )}

              {tab === "comments" && (
                <CommentsPanel
                  comments={commentThread}
                  currentUserId={currentUserId}
                />
              )}

              {tab === "deps" && (
                <DependenciesPanel
                  deps={deps}
                  taskId={task.Id}
                  canEdit={canEditThisTask}
                />
              )}

              {tab === "history" && <HistoryPanel activities={activities} />}
            </div>
        )}
      </Modal.Body>
      {task && tab === "details" && canEditThisTask && (
        <Modal.Footer>
          <Button variant="ghost" onClick={onClose} disabled={details.isSaving}>
            Close
          </Button>
          <Button
            variant="primary"
            leftIcon={<SaveIcon size={14} />}
            onClick={details.saveDraft}
            disabled={!details.isDirty}
            loading={details.isSaving}
            data-testid="task-save-btn"
          >
            Save changes
          </Button>
        </Modal.Footer>
      )}
    </Modal>

    <LogTimeModal time={time} task={task} />
    </>
  );
}
