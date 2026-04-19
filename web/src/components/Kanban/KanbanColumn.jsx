import { useState } from "react";
import { useDroppable } from "@dnd-kit/react";
import { useTheme } from "@mui/material/styles";
import { Plus, MoreVertical, Check, X, Trash2 } from "lucide-react";

import KanbanCard from "./KanbanCard";
import { TextInput, Menu, IconButton, Modal, Button, Combobox } from "../ui";
import { useApiMutation } from "../../hooks/useApiMutation";

export default function KanbanColumn({
  column,
  tasks,
  onOpenTask,
  onRequestAddTask,
  onColumnUpdated,
  selectedTaskIds = [],
  onToggleSelect,
  canCreate = true,
  canManage = false,
  siblingColumns = [],
}) {
  const theme = useTheme();
  const p = theme.tokens;
  const { ref: dropRef, isDropTarget } = useDroppable({
    id: `column-${column.Id}`,
    type: "column",
    accepts: "task",
    data: { columnId: column.Id },
    disabled: column.Id === -1,
  });
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(column.Title || "");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reassignTarget, setReassignTarget] = useState(null);
  const atCapacity =
    column.MaxTasks != null && tasks.length >= column.MaxTasks;
  const isOrphan = column.Id === -1;

  const saveColumnMutation = useApiMutation({
    endpoint: "/api/kanban/saveKanbanColumn",
    showSuccessMessage: false,
  });
  const deleteColumnMutation = useApiMutation({
    endpoint: "/api/kanban/deleteKanbanColumn",
    showSuccessMessage: false,
  });

  const handleRequestAdd = () => {
    if (atCapacity) return;
    onRequestAddTask?.(column);
  };

  const commitRename = async () => {
    const next = draftTitle.trim();
    if (!next || next === column.Title) {
      setRenaming(false);
      setDraftTitle(column.Title || "");
      return;
    }
    try {
      await saveColumnMutation.mutateAsync({
        Id: column.Id,
        WorkspaceId: column.WorkspaceId,
        Title: next,
        Color: column.Color,
        SortOrder: column.SortOrder,
        MaxTasks: column.MaxTasks,
        IsActive: true,
      });
      onColumnUpdated?.();
    } finally {
      setRenaming(false);
    }
  };

  const confirmDelete = async () => {
    try {
      await deleteColumnMutation.mutateAsync({
        Id: column.Id,
        ReassignToColumnId: reassignTarget?.value ?? null,
      });
      setDeleteOpen(false);
      onColumnUpdated?.();
    } catch {
      // error toast from hook
    }
  };

  const otherColumnOptions = siblingColumns
    .filter((c) => c.Id !== column.Id)
    .map((c) => ({ value: c.Id, label: c.Title }));

  return (
    <div
      data-testid={`kanban-column-${column.Id}`}
      style={{
        flex: "0 0 300px",
        minWidth: 300,
        backgroundColor: isDropTarget ? p.primary.subtle : p.surface.subtle,
        borderRadius: theme.radii.lg,
        border: `1px solid ${isDropTarget ? p.primary.border : p.border.default}`,
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
        {renaming ? (
          <div
            style={{ flex: 1, display: "inline-flex", alignItems: "center", gap: 4 }}
          >
            <TextInput
              size="sm"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") {
                  setRenaming(false);
                  setDraftTitle(column.Title || "");
                }
              }}
              data-testid={`column-rename-input-${column.Id}`}
            />
            <IconButton
              size="sm"
              variant="ghost"
              onClick={commitRename}
              aria-label="Save column name"
            >
              <Check size={14} />
            </IconButton>
            <IconButton
              size="sm"
              variant="ghost"
              onClick={() => {
                setRenaming(false);
                setDraftTitle(column.Title || "");
              }}
              aria-label="Cancel rename"
            >
              <X size={14} />
            </IconButton>
          </div>
        ) : (
          <button
            type="button"
            onClick={canManage && !isOrphan ? () => setRenaming(true) : undefined}
            data-testid={`column-title-${column.Id}`}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              padding: 0,
              textAlign: "left",
              fontSize: 13,
              fontWeight: 700,
              color: p.text.primary,
              letterSpacing: "0.01em",
              cursor: canManage && !isOrphan ? "text" : "default",
              fontFamily: "inherit",
            }}
          >
            {column.Title}
          </button>
        )}
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
        {canManage && !isOrphan && (
          <>
            <IconButton
              size="sm"
              variant="ghost"
              onClick={(e) => setMenuAnchor(e.currentTarget)}
              aria-label="Column options"
              data-testid={`column-menu-${column.Id}`}
            >
              <MoreVertical size={14} />
            </IconButton>
            <Menu
              anchorEl={menuAnchor}
              open={Boolean(menuAnchor)}
              onClose={() => setMenuAnchor(null)}
              items={[
                {
                  id: "rename",
                  label: "Rename column",
                  onClick: () => {
                    setMenuAnchor(null);
                    setRenaming(true);
                  },
                },
                {
                  id: "delete",
                  label: "Delete column",
                  icon: <Trash2 size={14} />,
                  onClick: () => {
                    setMenuAnchor(null);
                    setReassignTarget(otherColumnOptions[0] ?? null);
                    setDeleteOpen(true);
                  },
                },
              ]}
            />
          </>
        )}
      </div>

      <div
        ref={dropRef}
        style={{ padding: 10, overflowY: "auto", flex: 1, minHeight: 100 }}
      >
        {tasks.map((task, idx) => (
          <KanbanCard
            key={task.Id}
            task={task}
            index={idx}
            columnId={column.Id}
            onOpen={onOpenTask}
            selected={selectedTaskIds.includes(task.Id)}
            onToggleSelect={onToggleSelect}
          />
        ))}

        {canCreate && !isOrphan ? (
          <button
            type="button"
            data-testid={`quick-add-btn-${column.Id}`}
            onClick={handleRequestAdd}
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
              transition:
                "background-color 240ms cubic-bezier(0.4,0,0.2,1), border-color 240ms cubic-bezier(0.4,0,0.2,1)",
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

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        size="sm"
        data-testid={`column-delete-modal-${column.Id}`}
      >
        <Modal.Header
          title={`Delete "${column.Title}"?`}
          subtitle={
            tasks.length > 0
              ? `${tasks.length} task${tasks.length === 1 ? "" : "s"} will move to another column so nothing is lost.`
              : "No tasks in this column. Safe to delete."
          }
          onClose={() => setDeleteOpen(false)}
        />
        {tasks.length > 0 && otherColumnOptions.length > 0 && (
          <Modal.Body>
            <Combobox
              label="Move tasks to"
              value={reassignTarget}
              onChange={setReassignTarget}
              options={otherColumnOptions}
            />
          </Modal.Body>
        )}
        <Modal.Footer>
          <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={confirmDelete}
            loading={deleteColumnMutation.isPending}
            data-testid={`column-delete-confirm-${column.Id}`}
          >
            Delete column
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
