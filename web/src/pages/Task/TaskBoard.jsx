import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  pointerWithin,
} from "@dnd-kit/core";
import { enqueueSnackbar } from "notistack";
import {
  Plus,
  Trash2,
  LayoutGrid,
  Inbox,
  CheckSquare,
  BookOpen,
  Handshake,
  Rocket,
} from "lucide-react";

import { useApiQuery } from "../../hooks/useApiQuery";
import { useApiMutation } from "../../hooks/useApiMutation";
import useWorkspaceStore from "../../stores/useWorkspaceStore";
import WorkspaceSwitcher from "../../components/Workspace/WorkspaceSwitcher";
import KanbanColumn from "../../components/Kanban/KanbanColumn";
import { KanbanCardView } from "../../components/Kanban/KanbanCard";
import { dragGuard } from "../../realtime/dragGuard";
import ColumnAddInline from "../../components/Kanban/ColumnAddInline";
import TaskCreateModal from "./Components/TaskCreateModal";
import TaskDetailModal from "./Components/TaskDetailModal";
import {
  Button,
  PageHeader,
  SearchInput,
  Chip,
  EmptyState,
  Combobox,
  Modal,
} from "../../components/ui";
import { bucketTasksByColumn, ORPHAN_BUCKET_KEY } from "./taskBucket";
import useAuthStore from "../../stores/useAuthStore";
import { isAssignee } from "../../utils/taskAssignees";
import HelpGuide from "../../components/HelpGuide";
import { HELP_GUIDES } from "../../data/helpGuides";

const TEMPLATE_OPTIONS = [
  { value: "basic", label: "Basic — To Do / In Progress / Done" },
  { value: "scrum", label: "Scrum — Backlog / Sprint / In Progress / Review / Done" },
  { value: "bug", label: "Bug triage — New / Triaged / In Progress / Fixed / Verified" },
  { value: "content", label: "Content — Idea / Draft / Review / Published" },
];

const TYPE_ICON = {
  personal: <BookOpen size={22} />,
  shared: <Handshake size={22} />,
  project: <Rocket size={22} />,
};

export default function TaskBoard() {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const activeRole = useWorkspaceStore((s) => s.activeWorkspaceRole);
  const activeType = useWorkspaceStore((s) => s.activeWorkspaceType);
  const activeName = useWorkspaceStore((s) => s.activeWorkspaceName);
  const activeColor = useWorkspaceStore((s) => s.activeWorkspaceColor);
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);
  const canCreate = useWorkspaceStore((s) => s.canCreateTasks)();
  const isAdmin = useAuthStore((s) => s.user?.IsAdmin) || false;
  const currentUserId = useAuthStore((s) => s.user?.UserId ?? s.UserId);

  // Mirrors sp_CheckTaskPermission's change_status rule. Every card used to be
  // draggable by every role: the board optimistically moved it, the server
  // 403'd, and it snapped back with a raw error. Now a card you cannot move
  // does not offer to move.
  const canDragCard = (task) =>
    isAdmin ||
    activeType === "personal" ||
    activeRole === "owner" ||
    activeRole === "manager" ||
    task?.CreatedByUserId === currentUserId ||
    isAssignee(task, currentUserId);
  const canManageColumns = activeRole === "owner" || activeRole === "manager" || isAdmin;
  const [search, setSearch] = useState("");
  const [openTaskId, setOpenTaskId] = useState(null);
  const [addingInColumn, setAddingInColumn] = useState(null); // { Id, Title } or null
  const [selectedIds, setSelectedIds] = useState([]);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateChoice, setTemplateChoice] = useState(TEMPLATE_OPTIONS[0]);
  const [activeTask, setActiveTask] = useState(null); // the card in the drag overlay

  // Distance constraint so a plain click still opens the task (no accidental
  // drag); keyboard sensor keeps drag accessible.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );

  // Safety: if the board unmounts mid-drag (navigation), release the realtime
  // gate so deferred refetches aren't held forever.
  useEffect(() => () => dragGuard.end(), []);

  const ensureMutation = useApiMutation({
    endpoint: "/api/workspaces/ensurePersonalWorkspace",
    showSuccessMessage: false,
    showErrorMessage: false,
  });
  const applyTemplateMutation = useApiMutation({
    endpoint: "/api/workspaces/applyKanbanTemplate",
    showSuccessMessage: false,
  });

  useEffect(() => {
    if (!workspaceId) {
      ensureMutation
        .mutateAsync({})
        .then((res) => {
          if (res?.workspaceId) {
            setActiveWorkspace({
              Id: res.workspaceId,
              Type: "personal",
              MyRole: "owner",
            });
          }
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: columnsPayload } = useApiQuery({
    queryKey: ["kanban-columns", workspaceId],
    endpoint: "/api/kanban/fetchKanbanColumns",
    params: { WorkspaceId: workspaceId, PageNumber: 1, PageSize: 100 },
    enabled: Boolean(workspaceId),
    showErrorMessage: false,
  });
  const columns =
    columnsPayload?.kanbanColumns ?? columnsPayload?.columns ?? [];

  const { data: tasksPayload, refetch: refetchTasks } = useApiQuery({
    queryKey: ["tasks", workspaceId, search],
    endpoint: "/api/tasks/fetchTasks",
    params: {
      WorkspaceId: workspaceId,
      PageNumber: 1,
      PageSize: 200,
      SearchTerm: search || null,
    },
    enabled: Boolean(workspaceId),
    showErrorMessage: false,
  });
  const tasks = tasksPayload?.tasks ?? [];

  const saveMutation = useApiMutation({
    endpoint: "/api/tasks/saveTask",
    showSuccessMessage: false,
  });
  // Dragging is a status change, not an edit of the task — it goes through its
  // own endpoint so the assignee can move their own work, and so the whole task
  // (including the legacy AssignedToUserId alias, which would replace the
  // assignee set with one person) is never re-sent just to change a column.
  const moveMutation = useApiMutation({
    endpoint: "/api/tasks/moveTaskColumn",
    showSuccessMessage: false,
  });
  const bulkDeleteMutation = useApiMutation({
    endpoint: "/api/tasks/bulkDeleteTasks",
    showSuccessMessage: false,
    showErrorMessage: false,
  });

  const tasksByColumn = useMemo(
    () => bucketTasksByColumn(columns, tasks),
    [columns, tasks],
  );
  const orphanTasks = tasksByColumn[ORPHAN_BUCKET_KEY] || [];

  const tasksQueryKey = ["tasks", workspaceId, search];

  const handleDragStart = (event) => {
    dragGuard.start(); // hold realtime refetches until the drop lands
    setActiveTask(event.active.data.current?.task ?? null);
  };

  const handleDragCancel = () => {
    setActiveTask(null);
    dragGuard.end();
  };

  const handleDragEnd = async (event) => {
    setActiveTask(null);
    const { active, over } = event;
    // Release the realtime gate now — the optimistic patch below is the source
    // of truth until the save round-trips; deferred refetches can flush.
    dragGuard.end();
    if (!over) return;

    const taskId = active.data.current?.taskId;
    const task = tasks.find((t) => t.Id === taskId);
    if (!task) return;

    const targetColumnId = over.data.current?.columnId;
    if (!targetColumnId || targetColumnId === task.ColumnId) return;

    // Optimistic: patch React Query cache so card jumps to the target column
    // immediately, before the save round-trip completes.
    const previousPayload = queryClient.getQueryData(tasksQueryKey);
    queryClient.setQueryData(tasksQueryKey, (prev) => {
      if (!prev?.tasks) return prev;
      return {
        ...prev,
        tasks: prev.tasks.map((t) =>
          t.Id === taskId ? { ...t, ColumnId: targetColumnId } : t,
        ),
      };
    });

    try {
      await moveMutation.mutateAsync({
        TaskId: task.Id,
        ColumnId: targetColumnId,
        WorkspaceId: task.WorkspaceId, // realtime emit-routing hint
      });
      // Don't refetch — optimistic cache is already correct. Invalidate so
      // other screens (detail modal) pick up the change, but no UI flicker here.
      queryClient.invalidateQueries({
        queryKey: ["tasks"],
        refetchType: "none",
      });
    } catch {
      // Rollback on failure
      if (previousPayload) {
        queryClient.setQueryData(tasksQueryKey, previousPayload);
      }
      refetchTasks();
    }
  };

  const handleRequestAddTask = (column) => setAddingInColumn(column);

  const toggleSelect = (id) =>
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    try {
      await bulkDeleteMutation.mutateAsync({
        TaskIds: selectedIds,
        WorkspaceId: workspaceId, // realtime emit-routing hint
      });
      enqueueSnackbar(`Deleted ${selectedIds.length} tasks`, { variant: "success" });
      setSelectedIds([]);
      refetchTasks();
    } catch (err) {
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        "Delete failed";
      enqueueSnackbar(msg, { variant: "warning" });
    }
  };

  const handleApplyTemplate = async () => {
    if (!workspaceId || !templateChoice?.value) return;
    try {
      await applyTemplateMutation.mutateAsync({
        WorkspaceId: workspaceId,
        TemplateKey: templateChoice.value,
      });
      enqueueSnackbar("Template applied", { variant: "success" });
      setTemplateOpen(false);
      // Refetch columns so the board renders the new ones immediately.
      queryClient.invalidateQueries({ queryKey: ["kanban-columns", workspaceId] });
    } catch {
      // mutation hook surfaces error toast
    }
  };

  const invalidateColumns = () =>
    queryClient.invalidateQueries({ queryKey: ["kanban-columns", workspaceId] });

  if (!workspaceId) {
    return (
      <div style={{ padding: 32 }}>
        <EmptyState
          icon={<LayoutGrid size={32} />}
          title="Welcome — pick or create a workspace"
          description="Your personal workspace is being set up. Refresh if nothing appears."
          action={<WorkspaceSwitcher />}
          size="lg"
        />
      </div>
    );
  }

  return (
    <div
      style={{
        padding: 24,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        gap: 16,
      }}
    >
      <PageHeader
        title="Tasks"
        titleSuffix={
          activeName ? (
            <Chip
              label={activeName}
              tone="primary"
              variant="tonal"
              size="md"
              data-testid="active-workspace-chip"
            />
          ) : null
        }
        subtitle="Your boards, shared work, and team projects — all in one place."
        icon={TYPE_ICON[activeType] ?? <CheckSquare size={22} />}
        iconBg={activeColor ?? undefined}
        iconFg="#FFFFFF"
        actions={<HelpGuide guide={HELP_GUIDES.tasks} isAdmin={isAdmin} />}
      />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <WorkspaceSwitcher />
        <div style={{ minWidth: 260, flex: "1 1 260px", maxWidth: 360 }}>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search tasks by title, description…"
            shortcutHint="/"
          />
        </div>
        <div style={{ flex: 1 }} />
        {selectedIds.length > 0 && (
          <>
            <Chip
              label={`${selectedIds.length} selected`}
              tone="primary"
              variant="tonal"
            />
            <Button
              variant="destructive"
              size="sm"
              leftIcon={<Trash2 size={14} />}
              onClick={handleBulkDelete}
              data-testid="bulk-delete"
            >
              Delete
            </Button>
          </>
        )}
      </div>

      {columns.length === 0 ? (
        <EmptyState
          icon={<Inbox size={32} />}
          title="No columns yet"
          description={
            canManageColumns
              ? "Apply a kanban template to get started."
              : "The owner of this workspace has not added any columns yet."
          }
          action={
            canManageColumns ? (
              <Button
                variant="primary"
                leftIcon={<Plus size={16} />}
                onClick={() => setTemplateOpen(true)}
                data-testid="apply-template-cta"
              >
                Apply template
              </Button>
            ) : null
          }
          size="md"
        />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div
            style={{
              display: "flex",
              gap: 12,
              overflowX: "auto",
              paddingBottom: 12,
              flex: 1,
            }}
          >
            {columns
              .slice()
              .sort((a, b) => (a.SortOrder ?? 0) - (b.SortOrder ?? 0))
              .map((col) => (
                <KanbanColumn
                  key={col.Id}
                  column={col}
                  tasks={tasksByColumn[col.Id] || []}
                  onOpenTask={(t) => setOpenTaskId(t.Id)}
                  onRequestAddTask={handleRequestAddTask}
                  onColumnUpdated={invalidateColumns}
                  selectedTaskIds={selectedIds}
                  onToggleSelect={toggleSelect}
                  canCreate={canCreate}
                  canManage={canManageColumns}
                  canDragCard={canDragCard}
                  siblingColumns={columns}
                />
              ))}
            {canManageColumns && (
              <ColumnAddInline
                workspaceId={workspaceId}
                onCreated={invalidateColumns}
              />
            )}
            {orphanTasks.length > 0 && (
              <KanbanColumn
                key="orphan"
                column={{
                  Id: -1,
                  Title: "Uncategorized",
                  Color: "#F59E0B",
                  SortOrder: 9999,
                }}
                tasks={orphanTasks}
                onOpenTask={(t) => setOpenTaskId(t.Id)}
                selectedTaskIds={selectedIds}
                onToggleSelect={toggleSelect}
                canCreate={false}
                data-testid="orphan-column"
              />
            )}
          </div>
          <DragOverlay>
            {activeTask ? (
              <KanbanCardView task={activeTask} overlay dragging />
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      <TaskCreateModal
        open={Boolean(addingInColumn)}
        onClose={() => setAddingInColumn(null)}
        workspaceId={workspaceId}
        columnId={addingInColumn?.Id ?? null}
        columnTitle={addingInColumn?.Title ?? null}
        onCreated={() => {
          setAddingInColumn(null);
          refetchTasks();
        }}
      />

      <TaskDetailModal
        taskId={openTaskId}
        open={Boolean(openTaskId)}
        onClose={() => setOpenTaskId(null)}
      />

      <Modal
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        size="sm"
        data-testid="apply-template-modal"
      >
        <Modal.Header
          title="Apply kanban template"
          subtitle="Seed this workspace with a starter set of columns."
          onClose={() => setTemplateOpen(false)}
        />
        <Modal.Body>
          <Combobox
            label="Template"
            value={templateChoice}
            onChange={setTemplateChoice}
            options={TEMPLATE_OPTIONS}
          />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={() => setTemplateOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleApplyTemplate}
            loading={applyTemplateMutation.isPending}
            data-testid="apply-template-confirm"
          >
            Apply
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
