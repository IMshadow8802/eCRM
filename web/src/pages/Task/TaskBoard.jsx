import { useEffect, useMemo, useState } from "react";
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
} from "lucide-react";

import { useApiQuery } from "../../hooks/useApiQuery";
import { useApiMutation } from "../../hooks/useApiMutation";
import useWorkspaceStore from "../../stores/useWorkspaceStore";
import WorkspaceSwitcher from "../../components/Workspace/WorkspaceSwitcher";
import KanbanColumn from "../../components/Kanban/KanbanColumn";
import KanbanCard from "../../components/Kanban/KanbanCard";
import TaskCreateModal from "./Components/TaskCreateModal";
import TaskDetailModal from "./Components/TaskDetailModal";
import {
  Button,
  PageHeader,
  SearchInput,
  Chip,
  EmptyState,
} from "../../components/ui";

function normalizeColumnKey(title) {
  if (!title) return "";
  return title
    .trim()
    .toLowerCase()
    .replace(/\bto do\b/g, "todo")
    .replace(/\s+/g, "-");
}

export default function TaskBoard() {
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);
  const canCreate = useWorkspaceStore((s) => s.canCreateTasks)();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createDefaults, setCreateDefaults] = useState({ status: "todo" });
  const [openTaskId, setOpenTaskId] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [activeDrag, setActiveDrag] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const ensureMutation = useApiMutation({
    endpoint: "/api/workspaces/ensurePersonalWorkspace",
    showSuccessMessage: false,
    showErrorMessage: false,
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
  });

  const tasksByColumn = useMemo(() => {
    const bucket = {};
    for (const col of columns) {
      const key = normalizeColumnKey(col.Title);
      bucket[key] = [];
    }
    for (const t of tasks) {
      const key = (t.Status || "todo").toLowerCase();
      if (!bucket[key]) bucket[key] = [];
      bucket[key].push(t);
    }
    return bucket;
  }, [columns, tasks]);

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

    let newStatus = null;
    if (String(over.id).startsWith("column-")) {
      const colId = Number(String(over.id).replace("column-", ""));
      const col = columns.find((c) => c.Id === colId);
      if (col) newStatus = normalizeColumnKey(col.Title);
    } else if (String(over.id).startsWith("task-")) {
      const overTaskId = Number(String(over.id).replace("task-", ""));
      const overTask = tasks.find((t) => t.Id === overTaskId);
      if (overTask) newStatus = overTask.Status;
    }
    if (!newStatus || newStatus === task.Status) return;

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
        Status: newStatus,
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

  const handleQuickAdd = async ({ Title, Status }) => {
    try {
      await saveMutation.mutateAsync({
        Id: 0,
        Title,
        Status,
        WorkspaceId: workspaceId,
        Priority: "medium",
      });
      refetchTasks();
    } catch {}
  };

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
    } catch {}
  };

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
        subtitle="Your boards, shared work, and team projects — all in one place."
        icon={<LayoutGrid size={22} />}
        actions={
          canCreate ? (
            <Button
              variant="primary"
              leftIcon={<Plus size={16} />}
              onClick={() => setCreateOpen(true)}
              data-testid="new-task-btn"
            >
              New task
            </Button>
          ) : null
        }
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
          description="Apply a kanban template to this workspace to get started."
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
              .map((col) => {
                const key = normalizeColumnKey(col.Title);
                return (
                  <KanbanColumn
                    key={col.Id}
                    column={col}
                    tasks={tasksByColumn[key] || []}
                    onOpenTask={(t) => setOpenTaskId(t.Id)}
                    onQuickAddTask={handleQuickAdd}
                    selectedTaskIds={selectedIds}
                    onToggleSelect={toggleSelect}
                    canCreate={canCreate}
                  />
                );
              })}
          </div>

          <DragOverlay>
            {activeTask ? <KanbanCard task={activeTask} /> : null}
          </DragOverlay>
        </DndContext>
      )}

      <TaskCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        workspaceId={workspaceId}
        defaultStatus={createDefaults.status}
        onCreated={() => refetchTasks()}
      />

      <TaskDetailModal
        taskId={openTaskId}
        open={Boolean(openTaskId)}
        onClose={() => setOpenTaskId(null)}
      />
    </div>
  );
}
