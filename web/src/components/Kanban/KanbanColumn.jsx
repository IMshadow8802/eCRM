import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useTheme } from "@mui/material/styles";
import { Plus } from "lucide-react";

import KanbanCard from "./KanbanCard";
import { TextInput } from "../ui";

export default function KanbanColumn({
  column,
  tasks,
  onOpenTask,
  onQuickAddTask,
  selectedTaskIds = [],
  onToggleSelect,
  canCreate = true,
}) {
  const theme = useTheme();
  const p = theme.tokens;
  const { setNodeRef, isOver } = useDroppable({ id: `column-${column.Id}` });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const atCapacity =
    column.MaxTasks != null && tasks.length >= column.MaxTasks;

  const submit = async () => {
    const t = title.trim();
    if (!t) {
      setAdding(false);
      return;
    }
    await onQuickAddTask?.({
      Title: t,
      Status: column.Title?.trim()
        .toLowerCase()
        .replace(/\bto do\b/g, "todo")
        .replace(/\s+/g, "-"),
    });
    setTitle("");
    setAdding(false);
  };

  return (
    <div
      data-testid={`kanban-column-${column.Id}`}
      style={{
        flex: "0 0 300px",
        minWidth: 300,
        backgroundColor: isOver ? p.primary.subtle : p.surface.subtle,
        borderRadius: theme.radii.lg,
        border: `1px solid ${isOver ? p.primary.border : p.border.default}`,
        display: "flex",
        flexDirection: "column",
        maxHeight: "calc(100vh - 240px)",
        transition:
          "background-color 240ms cubic-bezier(0.4,0,0.2,1), border-color 240ms cubic-bezier(0.4,0,0.2,1)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 14px",
          borderBottom: `1px solid ${p.border.subtle}`,
        }}
      >
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: theme.radii.full,
            background: column.Color || p.text.tertiary,
            boxShadow: `0 0 0 3px ${column.Color || p.text.tertiary}22`,
          }}
        />
        <div
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: 700,
            color: p.text.primary,
            letterSpacing: "0.01em",
          }}
        >
          {column.Title}
        </div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: p.text.tertiary,
            padding: "2px 8px",
            borderRadius: theme.radii.full,
            backgroundColor: p.surface.card,
          }}
        >
          {tasks.length}
          {column.MaxTasks ? ` / ${column.MaxTasks}` : ""}
        </div>
      </div>

      <div
        ref={setNodeRef}
        style={{ padding: 10, overflowY: "auto", flex: 1, minHeight: 100 }}
      >
        <SortableContext
          items={tasks.map((t) => `task-${t.Id}`)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((task) => (
            <KanbanCard
              key={task.Id}
              task={task}
              onOpen={onOpenTask}
              selected={selectedTaskIds.includes(task.Id)}
              onToggleSelect={onToggleSelect}
            />
          ))}
        </SortableContext>

        {adding ? (
          <div style={{ marginTop: 2 }}>
            <TextInput
              size="sm"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title, Enter to save"
              autoFocus
              onBlur={submit}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
                if (e.key === "Escape") {
                  setAdding(false);
                  setTitle("");
                }
              }}
            />
          </div>
        ) : canCreate ? (
          <button
            type="button"
            data-testid={`quick-add-btn-${column.Id}`}
            onClick={() => setAdding(true)}
            disabled={atCapacity}
            style={{
              width: "100%",
              padding: "8px 10px",
              border: `1px dashed ${p.border.default}`,
              borderRadius: theme.radii.md,
              backgroundColor: "transparent",
              color: atCapacity ? p.text.disabled : p.text.secondary,
              cursor: atCapacity ? "not-allowed" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "inherit",
              transition: "background-color 240ms cubic-bezier(0.4,0,0.2,1), border-color 240ms cubic-bezier(0.4,0,0.2,1)",
            }}
            onMouseEnter={(e) => {
              if (atCapacity) return;
              e.currentTarget.style.backgroundColor = p.surface.card;
              e.currentTarget.style.borderColor = p.primary.border;
              e.currentTarget.style.color = p.primary.main;
            }}
            onMouseLeave={(e) => {
              if (atCapacity) return;
              e.currentTarget.style.backgroundColor = "transparent";
              e.currentTarget.style.borderColor = p.border.default;
              e.currentTarget.style.color = p.text.secondary;
            }}
          >
            <Plus size={14} />
            {atCapacity ? "Column full" : "Add task"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
