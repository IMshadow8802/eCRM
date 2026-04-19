import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
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
import KanbanCard from "../../components/Kanban/KanbanCard";
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
  const canManageColumns = activeRole === "owner" || activeRole === "manager" || isAdmin;
  const [search, setSearch] = useState("");
  const [openTaskId, setOpenTaskId] = useState(null);
  const [addingInColumn, setAddingInColumn] = useState(null); // { Id, Title } or null
  const [selectedIds, setSelectedIds] = useState([]);
  const [activeDrag, setActiveDrag] = useState(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateChoice, setTemplateChoice] = useState(TEMPLATE_OPTIONS[0]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

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

  const activeTask = activeDrag
    ? tasks.find((t) => `task-${t.Id}` === activeDrag.id)
    : null;

  const handleDragStart = (event) => setActiveDrag(event.active);

  const handleDragEnd = async (event) => {
    setActiveDrag(null);
    const { active, over } = event;
    if (!over) return;
    const taskId = Number(String(active.id).replace("task-", ""));
    const task = tasks.find((t) => t.Id === taskId);
    if (!task) return;

    let newColumnId = null;
    if (String(over.id).startsWith("column-")) {
      newColumnId = Number(String(over.id).replace("column-", ""));
    } else if (String(over.id).startsWith("task-")) {
      const overTaskId = Number(String(over.id).replace("task-", ""));
      const overTask = tasks.find((t) => t.Id === overTaskId);
      if (overTask) newColumnId = overTask.ColumnId;
    }
    if (!newColumnId || newColumnId === task.ColumnId) return;

    try {
      await saveMutation.mutateAsync({
        Id: task.Id,
        Title: task.Title,
        Description: task.Description,
        WorkspaceId: task.WorkspaceId,
        ColumnId: newColumnId,
        ProjectId: task.ProjectId,
        ParentTaskId: task.ParentTaskId,
        AssignedToUserId: task.AssignedToUserId,
        TeamId: task.TeamId,
        Priority: task.Priority,
        Type: task.Type,
        DueDate: task.DueDate,
        EstimatedHours: task.EstimatedHours,
        LoggedHours: task.LoggedHours,
        Progress: task.Progress,
        IsBlocked: task.IsBlocked,
        Labels: task.Labels,
        Watchers: task.Watchers,
      });
      refetchTasks();
    } catch {
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
      await bulkDeleteMutation.mutateAsync({ TaskIds: selectedIds });
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
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
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
            {activeTask ? <KanbanCard task={activeTask} /> : null}
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
