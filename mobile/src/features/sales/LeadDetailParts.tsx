// Presentational halves of LeadDetailScreen — the Details and Follow-ups tabs.
// No data fetching and no writes here; every action comes in as a callback.
import { ScrollView, StyleSheet, View } from "react-native";
import {
  Ban,
  Building2,
  CalendarClock,
  CircleCheck,
  History,
  IndianRupee,
  Mail,
  MapPin,
  Package,
  Phone,
  SkipForward,
  Sparkles,
  Trophy,
  User,
  UserPlus,
  type LucideIcon,
} from "lucide-react-native";

import type { CustomFieldValue, FollowUp, Lead } from "../../types/api";
import { colors, spacing, SCREEN_PADDING } from "../../theme";
import { Button, Card, Chip, Text } from "../../ui";
import { relativeTime } from "../tasks/taskHelpers";
import { dayLabel, followUpTypeLabel, rupees } from "./leadHelpers";

export function LeadDetailsTab({ lead, fields }: { lead: Lead; fields: CustomFieldValue[] }) {
  const address = [lead.Address, lead.City, lead.State, lead.Pincode].filter(Boolean).join(", ");
  return (
    <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
      {lead.StatusCode === "converted" ? (
        <Card>
          <View style={styles.row}>
            <Trophy size={20} color={colors.success} />
            <View style={styles.grow}>
              <Text variant="h3">Won for {rupees(lead.WonValue) ?? "—"}</Text>
              <Text variant="caption" color="textMuted">
                {[dayLabel(lead.WonAt), lead.CustomerName ? `customer: ${lead.CustomerName}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </View>
          </View>
        </Card>
      ) : null}

      <Card padded={false} gap={0} style={styles.factCard}>
        <Fact Icon={Phone} label="Mobile" value={lead.MobileNo ?? "—"} />
        {lead.AltMobile ? <Fact Icon={Phone} label="Alternate" value={lead.AltMobile} /> : null}
        <Fact Icon={Mail} label="Email" value={lead.Email ?? "—"} />
        <Fact Icon={Building2} label="Company" value={lead.Company ?? "—"} />
        <Fact Icon={Package} label="Product" value={lead.ProductName ?? "—"} />
        <Fact Icon={IndianRupee} label="Est. value" value={rupees(lead.EstValue) ?? "—"} />
        <Fact Icon={Sparkles} label="Source" value={lead.SourceName ?? "—"} />
        {lead.PartnerName ? <Fact Icon={UserPlus} label="Partner" value={lead.PartnerName} /> : null}
        <Fact Icon={User} label="Owner" value={lead.OwnerName ?? "Unassigned"} />
        <Fact Icon={Building2} label="Office" value={lead.BranchName ?? "—"} />
        {lead.LostReason ? (
          <Fact Icon={Ban} label="Lost reason" value={lead.LostReason} danger />
        ) : null}
        <Fact Icon={History} label="Added" value={relativeTime(lead.CreatedAt)} last />
      </Card>

      {address ? (
        <Block title="Address">
          <View style={styles.row}>
            <MapPin size={16} color={colors.textMuted} />
            <Text variant="body" style={styles.grow}>
              {address}
            </Text>
          </View>
        </Block>
      ) : null}

      {lead.Remarks ? (
        <Block title="Remarks">
          <Text variant="body">{lead.Remarks}</Text>
        </Block>
      ) : null}

      {fields.length ? (
        <Block title="Extra details">
          {fields.map((field) => (
            <View key={field.FieldId} style={styles.fieldRow}>
              <Text variant="caption" color="textMuted">
                {field.Label}
              </Text>
              <Text variant="body">{customValue(field)}</Text>
            </View>
          ))}
        </Block>
      ) : null}
    </ScrollView>
  );
}

/** `onLog`/`onSkip` are absent for a role without the edit grant — no buttons then. */
export function FollowUpsTab({
  followups,
  onLog,
  onSkip,
}: {
  followups: FollowUp[];
  onLog?: (f: FollowUp) => void;
  onSkip?: (f: FollowUp) => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
      {followups.length ? (
        followups.map((f) => {
          const open = f.Status === "open";
          return (
            <Card key={f.Id}>
              <View style={styles.row}>
                <CalendarClock size={18} color={f.IsOverdue ? colors.danger : colors.textMuted} />
                <Text variant="h3" style={styles.grow}>
                  {followUpTypeLabel(f.Type)}
                </Text>
                <Chip
                  label={
                    open
                      ? `${f.IsOverdue ? "Overdue ·" : "Due"} ${dayLabel(f.DueAt) ?? "—"}`
                      : f.Status === "done"
                        ? "Done"
                        : "Skipped"
                  }
                  tone={open ? (f.IsOverdue ? "danger" : "primary") : "neutral"}
                />
              </View>
              {f.Outcome || f.Remarks ? (
                <Text variant="body">{[f.Outcome, f.Remarks].filter(Boolean).join(" — ")}</Text>
              ) : null}
              <Text variant="caption" color="textMuted">
                {open
                  ? `Assigned to ${f.AssignedToName ?? "—"}`
                  : `${f.DoneByName ?? "—"} · ${relativeTime(f.DoneAt)}`}
              </Text>
              {open && onLog && onSkip ? (
                <View style={styles.buttons}>
                  <Button title="Log" icon={CircleCheck} size="sm" onPress={() => onLog(f)} style={styles.grow} />
                  <Button
                    title="Skip"
                    icon={SkipForward}
                    size="sm"
                    variant="secondary"
                    onPress={() => onSkip(f)}
                    style={styles.grow}
                  />
                </View>
              ) : null}
            </Card>
          );
        })
      ) : (
        <Text variant="secondary">No follow-ups yet.</Text>
      )}
    </ScrollView>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.block}>
      <Text variant="overline" color="textMuted">
        {title}
      </Text>
      {children}
    </View>
  );
}

/** The EAV row splits by type; exactly one column is populated. */
function customValue(field: CustomFieldValue): string {
  if (field.Type === "checkbox") {
    return field.ValueText === "true" || field.ValueNumber === 1 ? "Yes" : "No";
  }
  if (field.Type === "number") return field.ValueNumber?.toString() ?? "—";
  if (field.Type === "date") return field.ValueDate ? field.ValueDate.slice(0, 10) : "—";
  return field.ValueText || "—";
}

function Fact({
  Icon,
  label,
  value,
  danger = false,
  last = false,
}: {
  Icon: LucideIcon;
  label: string;
  value: string;
  danger?: boolean;
  last?: boolean;
}) {
  return (
    <View style={[styles.fact, !last && styles.factDivider]}>
      <Icon size={16} color={colors.textMuted} />
      <Text variant="caption" color="textMuted" style={styles.factLabel}>
        {label}
      </Text>
      <View style={styles.factValue}>
        <Text variant="body" color={danger ? "danger" : undefined} numberOfLines={1} align="right">
          {value}
        </Text>
      </View>
    </View>
  );
}

export const styles = StyleSheet.create({
  list: {
    paddingHorizontal: SCREEN_PADDING,
    paddingBottom: spacing[20],
    gap: spacing[4],
  },
  row: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  buttons: { flexDirection: "row", gap: spacing[2] },
  grow: { flex: 1 },
  factCard: { paddingHorizontal: spacing[4] },
  fact: { flexDirection: "row", alignItems: "center", gap: spacing[3], paddingVertical: spacing[3] },
  factDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  factLabel: { width: 96 },
  factValue: { flex: 1, alignItems: "flex-end" },
  block: { gap: spacing[2] },
  fieldRow: { gap: spacing[1] },
});
