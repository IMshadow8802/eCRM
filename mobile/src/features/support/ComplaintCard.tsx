import { memo } from "react";
import { StyleSheet, View } from "react-native";
import { ArrowUpRight, Clock, Flag, Hash, User } from "lucide-react-native";

import type { Ticket } from "../../types/api";
import { colors, spacing } from "../../theme";
import { Card, Chip, Text } from "../../ui";
import { relativeTime } from "../tasks/taskHelpers";
import { dueLabel, lifecycleOf, priorityTone, statusTone } from "./ticketHelpers";

interface ComplaintCardProps {
  ticket: Ticket;
  onPress: (ticket: Ticket) => void;
}

/**
 * One complaint in the list. Everything on it comes off the row — since 086
 * sp_FetchTickets joins the names — so the card takes no lookup maps.
 *
 * Reads top-down the way a queue is scanned: what is wrong (Subject), whose
 * it is (number + customer), then the chips that say how urgent it is —
 * status, priority, the TAT clock (red once it has run out) and a flag when a
 * senior has been pulled in. Who holds it and how old it is close the card.
 */
function ComplaintCardBase({ ticket, onPress }: ComplaintCardProps) {
  const code = lifecycleOf(ticket);
  const due = dueLabel(ticket);

  return (
    <Card onPress={() => onPress(ticket)}>
      <Text variant="h3" numberOfLines={2}>
        {ticket.Subject}
      </Text>

      <View style={styles.row}>
        <Hash size={13} color={colors.textMuted} />
        <Text variant="caption" color="textMuted">
          {ticket.TicketNo}
        </Text>
        <Text variant="caption" color="textMuted">
          ·
        </Text>
        <Text
          variant="caption"
          color="textSecondary"
          numberOfLines={1}
          style={styles.grow}
        >
          {ticket.CustomerName || "Unnamed customer"}
        </Text>
      </View>

      <View style={styles.chips}>
        <Chip label={ticket.StatusName ?? code} tone={statusTone(code)} />
        {ticket.PriorityName ? (
          <Chip
            label={ticket.PriorityName}
            icon={Flag}
            tone={priorityTone(ticket.PriorityName)}
          />
        ) : null}
        {due ? (
          <Chip
            label={due.label}
            icon={Clock}
            tone={due.overdue ? "danger" : "neutral"}
          />
        ) : null}
        {ticket.EscalatedTo ? (
          <Chip label="Escalated" icon={ArrowUpRight} tone="primary" />
        ) : null}
      </View>

      <View style={styles.row}>
        <User size={13} color={colors.textMuted} />
        <Text
          variant="caption"
          color={ticket.AssigneeName ? "textSecondary" : "textMuted"}
          numberOfLines={1}
          style={styles.grow}
        >
          {ticket.AssigneeName ?? "Unassigned"}
        </Text>
        <Text variant="caption" color="textMuted">
          {relativeTime(ticket.CreatedAt)}
        </Text>
      </View>
    </Card>
  );
}

export const ComplaintCard = memo(ComplaintCardBase);
export default ComplaintCard;

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
  grow: { flex: 1 },
  chips: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing[2],
  },
});
