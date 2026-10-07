import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardCheck } from "lucide-react";

import { useApiQuery } from "../../hooks/useApiQuery";
import { TASK_ENDPOINTS } from "../../api/taskQueries";
import useAuthStore from "../../stores/useAuthStore";
import { KanbanCardView } from "../../components/Kanban/KanbanCard";
import { Button, Chip, EmptyState, PageHeader, Skeleton } from "../../components/ui";
import TaskDetailModal from "./Components/TaskDetailModal";
import useFocusTaskWorkspace from "./useFocusTaskWorkspace";
import { orderMyWork, isOverdue } from "./myWorkOrder";

// Everything assigned to me and still open, across every board.
// ponytail: ordering is client-side over <=200 rows; add a server ORDER BY if anyone exceeds that.
export default function MyWork() {
  const navigate = useNavigate();
  const userId = useAuthStore((s) => s.user?.UserId ?? s.UserId);
  const [openTaskId, setOpenTaskId] = useState(null);
  const { data, isLoading, isError, refetch } = useApiQuery({
    queryKey: ["tasks", "my-work", userId], // ["tasks"] prefix: realtime TASK_LIST invalidates it
    endpoint: TASK_ENDPOINTS.tasks.fetchTasks,
    params: { WorkspaceId: null, AssigneeUserId: userId, OnlyOpen: true, PageNumber: 1, PageSize: 200 },
    enabled: Boolean(userId),
    showErrorMessage: false,
  });
  const tasks = useMemo(() => orderMyWork(data?.tasks ?? []), [data]);
  const overdue = tasks.filter((t) => isOverdue(t)).length;
  // Switch to the task's board first so the modal's abilities are right.
  const { ready } = useFocusTaskWorkspace(openTaskId, () => setOpenTaskId(null));

  return (
    <div style={{ paddingBlock: 8, display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader
        title="My Work"
        subtitle={`${tasks.length} open · ${overdue} overdue`}
        icon={<ClipboardCheck size={22} />}
      />
      {isLoading ? (
        <Skeleton variant="rect" height={120} data-testid="my-work-loading" />
      ) : isError ? (
        <EmptyState
          icon={<ClipboardCheck size={32} />}
          title="Couldn't load your tasks"
          description="Check your connection and try again."
          action={<Button variant="primary" onClick={() => refetch()}>Retry</Button>}
          data-testid="my-work-error"
        />
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck size={32} />}
          title="Nothing assigned to you"
          description="Tasks assigned to you on any board show up here."
          action={<Button variant="primary" onClick={() => navigate("/tasks")}>Go to boards</Button>}
        />
      ) : (
        <div
          style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}
        >
          {tasks.map((t) => (
            <div key={t.Id} data-testid="my-work-item" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {t.WorkspaceName ? <div><Chip label={t.WorkspaceName} size="sm" /></div> : null}
              <KanbanCardView task={t} canDrag={false} onOpen={() => setOpenTaskId(t.Id)} />
            </div>
          ))}
        </div>
      )}
      <TaskDetailModal taskId={openTaskId} open={Boolean(openTaskId) && ready} onClose={() => setOpenTaskId(null)} />
    </div>
  );
}
