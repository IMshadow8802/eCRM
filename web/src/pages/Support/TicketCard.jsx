import { useSortable } from "@dnd-kit/react/sortable";
import { useTheme } from "@mui/material/styles";
import { AlertTriangle } from "lucide-react";

import { Chip, Avatar } from "../../components/ui";
import { findUserById, getUserName } from "../../utils/userShape";

function assigneeLabel(ticket, users) {
  const user = findUserById(users, ticket.AssignedTo);
  if (user) return getUserName(user) || `User #${ticket.AssignedTo}`;
  if (ticket.AssignedTo != null) return `User #${ticket.AssignedTo}`;
  return "Unassigned";
}

export default function TicketCard({ ticket, index = 0, stageId, priorityById, users }) {
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
      style={{
        padding: 14,
        marginBottom: 10,
        borderRadius: theme.radii.md,
        backgroundColor: p.surface.card,
        border: `1px solid ${p.border.default}`,
        cursor: "grab",
        opacity: isDragging ? 0.6 : 1,
        boxShadow: isDragging ? p.shadow.lg : p.shadow.xs,
      }}
    >
      <div
        style={{
          fontSize: 14,
          fontWeight: 700,
          color: p.text.primary,
          marginBottom: 6,
          wordBreak: "break-word",
          lineHeight: 1.4,
        }}
      >
        {ticket.TicketNo}
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
        {ticket.IsBreached && (
          <Chip
            label="SLA breached"
            icon={<AlertTriangle size={11} />}
            tone="error"
            size="sm"
            variant="tonal"
            data-testid={`ticket-breach-${ticket.Id}`}
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
