import { useState } from "react";
import dayjs from "dayjs";
import {
  Lock,
  Save as SaveIcon,
  Clock,
  CheckCircle2,
  Trash2,
  UserCheck,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";

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
import { useApiMutation } from "../../../hooks/useApiMutation";
import { useConfirmation } from "../../../hooks/useConfirmation";
import ConfirmationDialog from "../../../components/ConfirmationDialog";
import useAuthStore from "../../../stores/useAuthStore";
import { useIsAdmin } from "../../../hooks/useAccess";
import useWorkspaceStore from "../../../stores/useWorkspaceStore";
import useWorkspaceMemberOptions from "../../../hooks/useWorkspaceMemberOptions";
import { taskAbilities } from "../../../utils/taskAbilities";

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
import TatPanel from "./TaskDetail/TatPanel";
import BreachReasonDialog from "./TaskDetail/BreachReasonDialog";

export default function TaskDetailModal({ taskId, open, onClose }) {
  const [tab, setTab] = useState("details");
  const currentUserId = useAuthStore((s) => s.user?.UserId ?? s.UserId);
  const isAdmin = useIsAdmin();
  const workspaceRole = useWorkspaceStore((s) => s.activeWorkspaceRole);
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

  // One rule set with the server (utils/taskAbilities).
  const can = taskAbilities({
    wsType: workspaceType,
    role: workspaceRole,
    isAdmin,
    userId: currentUserId,
    task,
  });
  const canEditThisTask = Boolean(task) && can.editFields;
  const canProgressThisTask = can.changeStatus;
  const canManageArtifacts = can.manageArtifacts;
  const canLogTime = can.logTime;
  // claim_task: open task nobody has (viewers can't hold tasks - 094).
  const canClaim = Boolean(task) && !isPersonal && !task.IsCompleted && can.claim;

  const queryClient = useQueryClient();
  const confirmation = useConfirmation();
  const deleteMutation = useApiMutation({
    endpoint: TASK_ENDPOINTS.tasks.deleteTask,
    showSuccessMessage: false,
  });
  // delete_task: owner/manager, or the creator while nobody else is on it -
  // the server decides the second half and says why when it refuses.
  const requestDelete = () =>
    confirmation.confirmDelete({
      title: "Delete task",
      message: `Delete "${task.Title}"? It disappears from every board and list.`,
      confirmText: "Delete",
      onConfirm: async () => {
        await deleteMutation.mutateAsync({ Id: task.Id, WorkspaceId: task.WorkspaceId });
        enqueueSnackbar("Task deleted", { variant: "success" });
        queryClient.invalidateQueries({ queryKey: ["tasks"], refetchType: "all" });
        queryClient.removeQueries({ queryKey: ["task", task.Id] });
        onClose?.();
      },
    });

  // Column = progress (change_status), same endpoint and gate as dragging the
  // card - so an assignee can use it, not only someone who may edit fields.
  const moveMutation = useApiMutation({
    endpoint: TASK_ENDPOINTS.tasks.moveTaskColumn,
    showSuccessMessage: false,
  });
  const moveToColumn = async (columnId) => {
    if (!task || !columnId || columnId === task.ColumnId) return;
    try {
      await moveMutation.mutateAsync({
        TaskId: task.Id,
        ColumnId: columnId,
        WorkspaceId: task.WorkspaceId,
      });
      queryClient.invalidateQueries({ queryKey: ["tasks"], refetchType: "all" });
      refetchTask();
    } catch {
      /* useApiMutation already showed why */
    }
  };

  const claimMutation = useApiMutation({
    endpoint: TASK_ENDPOINTS.tasks.claimTask,
    successMessage: "You've taken this task",
  });
  const claim = async () => {
    try {
      await claimMutation.mutateAsync({ TaskId: task.Id, WorkspaceId: task.WorkspaceId });
      queryClient.invalidateQueries({ queryKey: ["tasks"], refetchType: "all" });
      refetchTask();
    } catch {
      /* message already shown */
    }
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
              // No TAT in personal workspaces (D10).
              ...(isPersonal ? [] : [{ value: "tat", label: "TAT" }]),
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
                        value={columnOptions.find((o) => o.value === task.ColumnId) ?? null}
                        onChange={(v) => moveToColumn(v?.value)}
                        disabled={!canProgressThisTask || moveMutation.isPending}
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
                        {canClaim && (
                          <Button
                            variant="ghost"
                            size="sm"
                            leftIcon={<UserCheck size={14} />}
                            onClick={claim}
                            loading={claimMutation.isPending}
                            data-testid="task-claim-btn"
                            sx={{ mt: 0.75 }}
                          >
                            Take this task
                          </Button>
                        )}
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
                  {(draft.DueDate || (!isPersonal && canEditThisTask)) && (
                    <div style={{ display: "flex", gap: 12 }}>
                      {draft.DueDate && (
                        <div style={{ flex: 1 }}>
                          <TextInput
                            type="time"
                            label="Due time"
                            hint="Empty = end of the shift"
                            value={draft.DueTime}
                            onChange={(e) => setDraft((d) => ({ ...d, DueTime: e.target.value }))}
                            disabled={!canEditThisTask}
                            data-testid="task-due-time-input"
                          />
                        </div>
                      )}
                      {/* reassign in sp_CheckTaskPermission = editFields here */}
                      {!isPersonal && canEditThisTask && (
                        <div style={{ flex: 1 }}>
                          <TextInput
                            type="number"
                            label="Time target (hours)"
                            hint="Empty = company default · 0 = no clock"
                            value={draft.TatHours}
                            onChange={(e) => setDraft((d) => ({ ...d, TatHours: e.target.value }))}
                            min={0}
                            step={0.5}
                            data-testid="task-tat-hours-input"
                          />
                        </div>
                      )}
                    </div>
                  )}
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

              {tab === "tat" && (
                <TatPanel task={task} canReassign={can.editFields} currentUserId={currentUserId} />
              )}
            </div>
        )}
      </Modal.Body>
      {task && tab === "details" && canEditThisTask && (
        <Modal.Footer>
          {can.deleteTask && (
            <Button
              variant="destructive"
              leftIcon={<Trash2 size={14} />}
              onClick={requestDelete}
              disabled={details.isSaving}
              data-testid="task-delete-btn"
              sx={{ mr: "auto" }}
            >
              Delete
            </Button>
          )}
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

    <ConfirmationDialog
      open={confirmation.confirmationState.open}
      onClose={confirmation.hideConfirmation}
      onConfirm={confirmation.handleConfirm}
      title={confirmation.confirmationState.title}
      message={confirmation.confirmationState.message}
      confirmText={confirmation.confirmationState.confirmText}
      cancelText={confirmation.confirmationState.cancelText}
      type={confirmation.confirmationState.type}
      isLoading={confirmation.confirmationState.isLoading}
    />
    <LogTimeModal time={time} task={task} />
    <BreachReasonDialog
      open={Boolean(checklist.reasonTatId)}
      tatId={checklist.reasonTatId}
      taskId={taskId}
      onClose={() => checklist.setReasonTatId(null)}
    />
    </>
  );
}
