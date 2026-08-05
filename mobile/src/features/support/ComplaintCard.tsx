import { memo } from "react";
import { StyleSheet, View } from "react-native";
import {
  CircleCheck,
  CircleDot,
  CircleX,
  Flag,
  Hash,
  MessageSquare,
  Phone,
  Tag,
  User,
  type LucideIcon,
} from "lucide-react-native";

import type { Ticket } from "../../types/api";
import { colors, spacing } from "../../theme";
import {
  Card,
  Chip,
  Glyph,
  Text,
} from "../../ui";
import { relativeTime } from "../tasks/taskHelpers";
import {
  channelLabel,
  lifecycleOf,
  priorityTone,
  stageOf,
  type StageRoles,
} from "./ticketHelpers";

/** The glyph mirrors where the ticket sits, so a list scans by shape not text. */
const LIFECYCLE_ICON: Record<string, LucideIcon> = {
  open: CircleDot,
  resolved: CircleCheck,
  closed: CircleCheck,
  rejected: CircleX,
  unknown: CircleDot,
};

interface ComplaintCardProps {
  ticket: Ticket;
  roles: StageRoles;
  categories: Map<number, string>;
  priorities: Map<number, string>;
  people: Map<number, string>;
  onPress: (ticket: Ticket) => void;
  /** Board view uses this for "move stage" — there is no drag on a phone. */
  onLongPress?: (ticket: Ticket) => void;
  /** Hide the stage pill inside a stage column, where it says nothing new. */
  showStage?: boolean;
}

function Stat({
  Icon,
  value,
  tone = "textMuted",
}: {
  Icon: LucideIcon;
  value: string;
  tone?: keyof typeof colors;
}) {
  return (
    <View style={styles.stat}>
      <Icon size={13} color={colors[tone]} />
      <Text variant="caption" color={tone} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function ComplaintCardBase({
  ticket,
  roles,
  categories,
  priorities,
  people,
  onPress,
  onLongPress,
  showStage = true,
}: ComplaintCardProps) {
  const stage = stageOf(ticket, roles);
  const lifecycle = lifecycleOf(ticket, roles);
  const Icon = LIFECYCLE_ICON[lifecycle] ?? CircleDot;

  // The stage's own colour comes from tblPipelineStage, so a company that
  // recolours its pipeline on the web sees it here without a mobile release.
  const ink = stage?.Color ?? colors.neutralIcon;

  const priority = ticket.Priority ? priorities.get(ticket.Priority) : undefined;
  const category = ticket.CategoryId ? categories.get(ticket.CategoryId) : undefined;
  const assignee = ticket.AssignedTo ? people.get(ticket.AssignedTo) : undefined;

  return (
    <Card
      onPress={() => onPress(ticket)}
      onLongPress={onLongPress ? () => onLongPress(ticket) : undefined}
    >
      <View style={styles.row}>
        <Glyph icon={Icon} tint={ink} size="lg" />

        <View style={styles.main}>
          <Text variant="h3" numberOfLines={1}>
            {ticket.CustomerName || "Unnamed customer"}
          </Text>
          <View style={styles.subRow}>
            <Stat Icon={Hash} value={ticket.TicketNo} />
            {ticket.ContactPerson ? (
              <Stat Icon={User} value={ticket.ContactPerson} />
            ) : null}
          </View>
        </View>

        {showStage && stage ? (
          <Chip label={stage.Name} color={ink} maxWidth={110} />
        ) : null}
      </View>

      {ticket.Description ? (
        <Text variant="secondary" numberOfLines={2}>
          {ticket.Description}
        </Text>
      ) : null}

      <View style={styles.stats}>
        {priority ? (
          <Stat Icon={Flag} value={priority} tone={priorityTone(priority)} />
        ) : null}
        {category ? <Stat Icon={Tag} value={category} /> : null}
        {ticket.Channel ? (
          <Stat
            Icon={ticket.Channel === "phone" ? Phone : MessageSquare}
            value={channelLabel(ticket.Channel)}
          />
        ) : null}
        <Stat
          Icon={User}
          value={assignee ?? "Unassigned"}
          tone={assignee ? "textSecondary" : "textMuted"}
        />

        <View style={styles.spacer} />

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
  row: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  main: { flex: 1, gap: spacing[1] },
  subRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    flexWrap: "wrap",
  },
  stats: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    flexWrap: "wrap",
  },
  stat: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
  spacer: { flex: 1 },
});
