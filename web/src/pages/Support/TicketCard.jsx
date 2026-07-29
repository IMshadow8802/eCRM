import { memo, useMemo } from "react";
import { useDraggable } from "@dnd-kit/core";
import { useTheme } from "@mui/material/styles";
import { Eye } from "lucide-react";

import { Chip, Avatar } from "../../components/ui";
import { findUserById, getUserName } from "../../utils/userShape";

function assigneeLabel(ticket, users) {
  const user = findUserById(users, ticket.AssignedTo);
  if (user) return getUserName(user) || `User #${ticket.AssignedTo}`;
  if (ticket.AssignedTo != null) return `User #${ticket.AssignedTo}`;
  return "Unassigned";
}

/**
 * Pure presentational card. Shared by the draggable wrapper (below) and the
 * DragOverlay clone, so the visual never diverges. No dnd hooks here — the
 * overlay renders this directly while the real card is dimmed in place, which
 * is why the library never has to reparent a live node (the crash we fixed).
 */
export const TicketCardView = memo(function TicketCardView({
  ticket,
  priorityById,
  users,
  onOpen,
  dragging = false,
  overlay = false,
  dragRef,
  dragHandleProps = {},
}) {
  const theme = useTheme();
  const p = theme.tokens;

  const priority = priorityById?.get(ticket.Priority);
  const assignee = assigneeLabel(ticket, users);

  return (
    <div
      ref={dragRef}
      {...dragHandleProps}
      data-testid={`ticket-card-${ticket.Id}`}
      // Whole card opens the detail modal; a real drag suppresses the click.
      onClick={
        overlay
          ? undefined
          : () => {
              if (!dragging && onOpen) onOpen(ticket.Id);
            }
      }
      style={{
        padding: 14,
        marginBottom: overlay ? 0 : 10,
        borderRadius: theme.radii.md,
        backgroundColor: p.surface.card,
        border: `1px solid ${p.border.default}`,
        cursor: overlay ? "grabbing" : onOpen ? "pointer" : "grab",
        // Dim the real card while its overlay clone follows the cursor.
        opacity: dragging && !overlay ? 0.4 : 1,
        boxShadow: overlay ? p.shadow.lg : p.shadow.xs,
        willChange: overlay ? "transform" : undefined,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: p.text.primary,
            wordBreak: "break-word",
            lineHeight: 1.4,
          }}
        >
          {ticket.TicketNo}
        </div>
        {/* Explicit open affordance: a dedicated button never fights the
            card's drag gesture, and signals the card leads somewhere. */}
        {onOpen && !overlay && (
          <button
            type="button"
            aria-label={`Open ${ticket.TicketNo}`}
            data-testid={`ticket-open-${ticket.Id}`}
            onClick={(e) => {
              e.stopPropagation();
              onOpen(ticket.Id);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 24,
              height: 24,
              padding: 0,
              border: "none",
              borderRadius: theme.radii.sm,
              background: "transparent",
              color: p.text.tertiary,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <Eye size={14} />
          </button>
        )}
      </div>

      {ticket.CustomerName && (
        <div
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: p.text.secondary,
            marginBottom: 8,
            wordBreak: "break-word",
          }}
        >
          {ticket.CustomerName}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {priority && (
          <Chip
            label={priority}
            tone="warning"
            size="sm"
            variant="tonal"
            data-testid={`ticket-priority-${ticket.Id}`}
          />
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Avatar name={assignee} size="xs" />
        <span style={{ fontSize: 11, fontWeight: 500, color: p.text.secondary }}>{assignee}</span>
      </div>
    </div>
  );
});

/**
 * Draggable ticket card (stable @dnd-kit/core). Stages are the droppables;
 * cards are draggable-only — we persist only which stage a card lands in, not
 * intra-stage order, so no SortableContext is needed.
 */
export default function TicketCard({ ticket, stageId, priorityById, users, onOpen }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `ticket-${ticket.Id}`,
    data: { ticketId: ticket.Id, stageId: stageId ?? ticket.StageId ?? null, ticket },
  });

  // Stable ref so the memoized view bails while other cards are dragged.
  const dragHandleProps = useMemo(
    () => ({ ...listeners, ...attributes }),
    [listeners, attributes],
  );

  return (
    <TicketCardView
      ticket={ticket}
      priorityById={priorityById}
      users={users}
      onOpen={onOpen}
      dragging={isDragging}
      dragRef={setNodeRef}
      dragHandleProps={dragHandleProps}
    />
  );
}
