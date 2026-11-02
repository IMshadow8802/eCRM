import { memo } from "react";
import { StyleSheet, View } from "react-native";
import { CalendarClock, Package, Phone, User } from "lucide-react-native";

import type { Lead } from "../../types/api";
import { colors, spacing } from "../../theme";
import { Card, Chip, Text } from "../../ui";
import { dayLabel, isActiveLead, leadTone, rupees } from "./leadHelpers";

interface LeadCardProps {
  lead: Lead;
  onPress: (lead: Lead) => void;
}

/**
 * One lead in the list. Every name is on the row (sp_FetchLeads joins them).
 * Reads the way a salesperson scans: who, how to reach them, where it stands
 * and when they next owe a call — red once that day has passed.
 */
function LeadCardBase({ lead, onPress }: LeadCardProps) {
  const next = isActiveLead(lead.StatusCode) ? dayLabel(lead.NextFollowupDate) : null;
  const value = rupees(lead.EstValue);

  return (
    <Card onPress={() => onPress(lead)}>
      <Text variant="h3" numberOfLines={2}>
        {lead.Name}
      </Text>

      <View style={styles.row}>
        <Phone size={13} color={colors.textMuted} />
        <Text variant="caption" color="textSecondary" numberOfLines={1} style={styles.grow}>
          {[lead.MobileNo, lead.Company].filter(Boolean).join(" · ") || "No contact"}
        </Text>
      </View>

      <View style={styles.chips}>
        <Chip label={lead.StatusName ?? "—"} tone={leadTone(lead.StatusCode)} />
        {next ? (
          <Chip
            label={lead.IsOverdue ? `Overdue · ${next}` : next}
            icon={CalendarClock}
            tone={lead.IsOverdue ? "danger" : "neutral"}
          />
        ) : null}
        {lead.ProductName ? (
          <Chip label={lead.ProductName} icon={Package} maxWidth={160} />
        ) : null}
      </View>

      <View style={styles.row}>
        <User size={13} color={colors.textMuted} />
        <Text
          variant="caption"
          color={lead.OwnerName ? "textSecondary" : "textMuted"}
          numberOfLines={1}
          style={styles.grow}
        >
          {lead.OwnerName ?? "Unassigned"}
        </Text>
        {value ? (
          <Text variant="caption" color="textMuted">
            {value}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

export const LeadCard = memo(LeadCardBase);
export default LeadCard;

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
