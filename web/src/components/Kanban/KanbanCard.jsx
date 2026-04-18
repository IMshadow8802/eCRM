import { useSortable } from "@dnd-kit/sortable";
import { useTheme } from "@mui/material/styles";
import { Calendar, CheckCheck, Check, Lock } from "lucide-react";
import dayjs from "dayjs";

import { Chip, Avatar, Checkbox } from "../ui";

const PRIORITY_TONE = {
  low: "info",
  medium: "warning",
  high: "error",
  critical: "error",
};

export default function KanbanCard({
  task,
  onOpen,
  selected = false,
  onToggleSelect,
}) {
  const theme = useTheme();
  const p = theme.tokens;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `task-${task.Id}` });

  const style = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${
          isDragging ? 1.02 : 1
        })`
      : undefined,
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 100 : 1,
  };

  const overdue =
    task.DueDate &&
    task.Status !== "done" &&
    new Date(task.DueDate) < new Date(new Date().toDateString());

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        position: "relative",
        padding: 14,
        marginBottom: 10,
        borderRadius: theme.radii.md,
        backgroundColor: p.surface.card,
        border: `1px solid ${selected ? p.primary.main : p.border.default}`,
        cursor: "pointer",
        boxShadow: isDragging
          ? p.shadow.lg
          : selected
            ? p.shadow.md
            : p.shadow.xs,
        transition: isDragging
          ? undefined
          : `border-color 240ms cubic-bezier(0.4,0,0.2,1), box-shadow 240ms cubic-bezier(0.4,0,0.2,1), transform 240ms cubic-bezier(0.4,0,0.2,1)`,
      }}
      onClick={(e) => {
        if (isDragging) return;
        if (e.target.closest("[data-card-checkbox]")) return;
        onOpen?.(task);
      }}
      onMouseEnter={(e) => {
        if (isDragging || selected) return;
        e.currentTarget.style.transform = "translateY(-1px)";
        e.currentTarget.style.boxShadow = p.shadow.md;
      }}
      onMouseLeave={(e) => {
        if (isDragging || selected) return;
        e.currentTarget.style.transform = "";
        e.currentTarget.style.boxShadow = p.shadow.xs;
      }}
      {...attributes}
      {...listeners}
      data-testid={`kanban-card-${task.Id}`}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        {onToggleSelect && (
          <div
            data-card-checkbox
            onClick={(e) => e.stopPropagation()}
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
              color: p.text.primary,
              marginBottom: task.IsBlocked ? 8 : 6,
              wordBreak: "break-word",
              lineHeight: 1.4,
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
            {task.AssigneeName && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Avatar name={task.AssigneeName} size="xs" />
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
          {task.Status === "done" ? (
            <CheckCheck size={16} style={{ color: p.success.main }} />
          ) : task.HasBeenRead ? (
            <CheckCheck size={16} style={{ color: p.info.main }} />
          ) : task.HasBeenDelivered ? (
            <Check size={16} style={{ color: p.text.tertiary }} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
