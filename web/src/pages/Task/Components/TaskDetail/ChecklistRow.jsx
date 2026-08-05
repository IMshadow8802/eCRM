import { CheckSquare, Square, Trash2 } from "lucide-react";

import { IconButton } from "../../../../components/ui";

// canToggle and canDelete are separate on purpose: the assignee may tick items
// (change_status) but not add or remove them (edit_fields) — mirrors the server.
// `pending` = a save/delete for this row is in flight. Locking the controls
// while pending stops the double-tap that fired a duplicate write at an
// already-changed item.
export default function ChecklistRow({
  item,
  canToggle,
  canDelete,
  pending,
  onToggle,
  onDelete,
}) {
  const canTick = canToggle && !pending;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "6px 8px",
        borderRadius: 8,
        opacity: pending ? 0.6 : 1,
      }}
    >
      <button
        type="button"
        onClick={canTick ? onToggle : undefined}
        disabled={!canTick}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          border: "none",
          background: "transparent",
          cursor: canTick ? "pointer" : "default",
          color: item.IsCompleted ? "#10B981" : "#94A3B8",
          padding: 0,
        }}
        data-testid={`checklist-toggle-${item.Id}`}
      >
        {item.IsCompleted ? <CheckSquare size={18} /> : <Square size={18} />}
      </button>
      <span
        style={{
          flex: 1,
          fontSize: 14,
          color: "var(--color-surface-700)",
          textDecoration: item.IsCompleted ? "line-through" : "none",
          opacity: item.IsCompleted ? 0.6 : 1,
        }}
      >
        {item.ItemText}
      </span>
      {canDelete && (
        <IconButton
          size="sm"
          variant="ghost"
          onClick={onDelete}
          disabled={pending}
          aria-label="Remove item"
        >
          <Trash2 size={14} />
        </IconButton>
      )}
    </div>
  );
}
