import { useSortable } from "@dnd-kit/react/sortable";
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

export default function TicketCard({ ticket, index = 0, stageId, priorityById, users, onOpen }) {
  const theme = useTheme();
  const p = theme.tokens;
  const { ref: sortableRef, isDragging } = useSortable({
    id: `ticket-${ticket.Id}`,
    index,
    type: "ticket",
    accepts: "ticket",
    group: stageId ?? ticket.StageId ?? "default",
    data: { ticketId: ticket.Id, stageId: stageId ?? ticket.StageId ?? null },
  });

  const priority = priorityById?.get(ticket.Priority);
  const assignee = assigneeLabel(ticket, users);

  return (
    <div
      ref={sortableRef}
      data-testid={`ticket-card-${ticket.Id}`}
      // Whole card opens the detail modal; a real drag suppresses the click.
      onClick={() => {
        if (!isDragging && onOpen) onOpen(ticket.Id);
      }}
      style={{
        padding: 14,
        marginBottom: 10,
        borderRadius: theme.radii.md,
        backgroundColor: p.surface.card,
        border: `1px solid ${p.border.default}`,
        cursor: onOpen ? "pointer" : "grab",
        opacity: isDragging ? 0.6 : 1,
        boxShadow: isDragging ? p.shadow.lg : p.shadow.xs,
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
        {onOpen && (
          <button
            type="button"
            aria-label={`Open ${ticket.TicketNo}`}
            data-testid={`ticket-open-${ticket.Id}`}
            onClick={(e) => {
              e.stopPropagation();
              onOpen(ticket.Id);
            }}
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
}
