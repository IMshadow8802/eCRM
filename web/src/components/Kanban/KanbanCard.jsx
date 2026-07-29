import { memo, useMemo } from "react";
import { useDraggable } from "@dnd-kit/core";
import { useTheme } from "@mui/material/styles";
import {
  Calendar,
  CheckCheck,
  Check,
  Lock,
  CheckCircle2,
  ListChecks,
} from "lucide-react";
import dayjs from "dayjs";

import { Chip, Checkbox } from "../ui";
import UserAvatar from "../ui/UserAvatar";

const PRIORITY_TONE = {
  low: "info",
  medium: "warning",
  high: "error",
  critical: "error",
};

/**
 * Pure presentational card. Shared by the draggable wrapper (below) and the
 * DragOverlay clone, so the visual never diverges. No dnd hooks here — the
 * overlay renders this directly while the real card is dimmed in place, which
 * is why the library never has to reparent a live node (the crash we fixed).
 */
export const KanbanCardView = memo(function KanbanCardView({
  task,
  selected = false,
  onToggleSelect,
  onOpen,
  dragging = false,
  overlay = false,
  dragRef,
  dragHandleProps = {},
}) {
  const theme = useTheme();
  const p = theme.tokens;

  const isCompleted = Boolean(task.IsCompleted);
  const overdue =
    task.DueDate &&
    !isCompleted &&
    new Date(task.DueDate) < new Date(new Date().toDateString());

  const checklistTotal = Number(task.ChecklistTotal ?? 0);
  const checklistDone = Number(task.ChecklistDone ?? 0);
  const showStepsChip = checklistTotal > 0;

  return (
    <div
      ref={dragRef}
      {...dragHandleProps}
      style={{
        position: "relative",
        padding: 14,
        marginBottom: overlay ? 0 : 10,
        borderRadius: theme.radii.md,
        backgroundColor: p.surface.card,
        border: `1px solid ${selected ? p.primary.main : p.border.default}`,
        cursor: overlay ? "grabbing" : "grab",
        // Dim the real card while its overlay clone follows the cursor.
        opacity: dragging && !overlay ? 0.4 : isCompleted ? 0.72 : 1,
        boxShadow: overlay ? p.shadow.lg : selected ? p.shadow.md : p.shadow.xs,
        // Promote the moving overlay clone to its own compositor layer so it
        // tracks the cursor smoothly instead of repainting each frame.
        willChange: overlay ? "transform" : undefined,
        transition: dragging
          ? undefined
          : `border-color 240ms cubic-bezier(0.4,0,0.2,1), box-shadow 240ms cubic-bezier(0.4,0,0.2,1)`,
      }}
      onClick={
        overlay
          ? undefined
          : (e) => {
              if (dragging) return;
              if (e.target.closest("[data-card-checkbox]")) return;
              onOpen?.(task);
            }
      }
      data-testid={`kanban-card-${task.Id}`}
      data-completed={isCompleted ? "true" : "false"}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        {onToggleSelect && !overlay && (
          <div
            data-card-checkbox
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            style={{ flexShrink: 0, marginTop: 1 }}
          >
            <Checkbox
              checked={selected}
              onChange={() => onToggleSelect(task.Id)}
              size="sm"
              data-testid={`card-select-${task.Id}`}
            />
          </div>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: isCompleted ? p.text.secondary : p.text.primary,
              marginBottom: task.IsBlocked ? 8 : 6,
              wordBreak: "break-word",
              lineHeight: 1.4,
              textDecoration: isCompleted ? "line-through" : "none",
            }}
          >
            {task.Title}
          </div>

          {task.IsBlocked && (
            <div style={{ marginBottom: 8 }}>
              <Chip
                label="Blocked"
                icon={<Lock size={11} />}
                tone="error"
                size="sm"
                variant="tonal"
                data-testid={`card-blocked-${task.Id}`}
              />
            </div>
          )}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            <Chip
              label={task.Priority ?? "medium"}
              tone={PRIORITY_TONE[task.Priority] ?? "warning"}
              size="sm"
              variant="tonal"
            />
            {showStepsChip && (
              <Chip
                label={`${checklistDone}/${checklistTotal}`}
                icon={<ListChecks size={11} />}
                tone={isCompleted ? "success" : "default"}
                size="sm"
                variant="tonal"
                data-testid={`card-steps-${task.Id}`}
              />
            )}
            {task.AssigneeName && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <UserAvatar
                  userId={task.AssignedToUserId}
                  name={task.AssigneeName}
                  size="xs"
                />
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    color: p.text.secondary,
                  }}
                >
                  {task.AssigneeName}
                </span>
              </div>
            )}
            {task.DueDate && (
              <Chip
                label={dayjs(task.DueDate).format("DD-MM-YYYY")}
                icon={<Calendar size={11} />}
                tone={overdue ? "error" : "default"}
                size="sm"
                variant="tonal"
              />
            )}
          </div>
        </div>

        <div style={{ flexShrink: 0, marginLeft: 4 }}>
          {isCompleted ? (
            <CheckCircle2
              size={16}
              style={{ color: p.success.main }}
              data-testid={`card-done-${task.Id}`}
            />
          ) : task.HasBeenRead ? (
            <CheckCheck size={16} style={{ color: p.info.main }} />
          ) : task.HasBeenDelivered ? (
            <Check size={16} style={{ color: p.text.tertiary }} />
          ) : null}
        </div>
      </div>
    </div>
  );
});

/**
 * Draggable kanban card (stable @dnd-kit/core). Columns are the droppables;
 * cards are draggable-only — we persist only which column a card lands in, not
 * intra-column order, so no SortableContext is needed.
 */
export default function KanbanCard({
  task,
  columnId,
  onOpen,
  selected = false,
  onToggleSelect,
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `task-${task.Id}`,
    data: { taskId: task.Id, columnId: columnId ?? task.ColumnId ?? null, task },
  });

  // Stable ref so the memoized view bails out of re-render while other cards
  // are being dragged (dnd-kit re-renders every consumer on each pointer move).
  const dragHandleProps = useMemo(
    () => ({ ...listeners, ...attributes }),
    [listeners, attributes],
  );

  return (
    <KanbanCardView
      task={task}
      selected={selected}
      onToggleSelect={onToggleSelect}
      onOpen={onOpen}
      dragging={isDragging}
      dragRef={setNodeRef}
      dragHandleProps={dragHandleProps}
    />
  );
}
