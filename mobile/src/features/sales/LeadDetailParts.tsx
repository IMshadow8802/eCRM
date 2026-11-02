// Presentational halves of the lead record (E 15, T3): the contact card, the
// Details and Follow-ups tabs. No fetching and no writes; actions come in as callbacks.
import { StyleSheet, View } from "react-native";
import { CalendarClock, Check, Megaphone, MessageCircle, Phone, Smartphone, Trophy } from "lucide-react-native";

import type { CustomFieldValue, FollowUp, Lead } from "../../types/api";
import { followUpBadge } from "../../theme/statusBadges";
import { colors, spacing } from "../../theme";
import {
  Avatar,
  Button,
  Card,
  Chip,
  CircleAction,
  Facts,
  ListGroup,
  ListRow,
  StatusBadge,
  Text,
  type Fact,
} from "../../ui";
import { dayLabel, dueTitle, followUpMeta, followUpTypeLabel, fromNow, parseDate, rupees, shortDay } from "./leadHelpers";

/** "98250 12345" — a ten-digit number split as people say it. */
export const spacedMobile = (m: string | null | undefined): string =>
  m && /^\d{10}$/.test(m) ? `${m.slice(0, 5)} ${m.slice(5)}` : (m ?? "—");

/** The EAV row splits by type; exactly one column is populated. */
export function customValue(field: CustomFieldValue): string {
  if (field.Type === "checkbox") return field.ValueText === "true" || field.ValueNumber === 1 ? "Yes" : "No";
  if (field.Type === "number") return field.ValueNumber?.toString() ?? "—";
  if (field.Type === "date") return field.ValueDate ? field.ValueDate.slice(0, 10) : "—";
  return field.ValueText || "—";
}

const created = (lead: Lead) => {
  const d = parseDate(lead.CreatedAt);
  return d ? shortDay(d) : "—";
};

const owner = (lead: Lead) => (
  <View style={styles.person}>
    <Avatar name={lead.OwnerName} uri={lead.OwnerAvatar} userId={lead.OwnerId} size={22} />
    <Text variant="rowTitle" numberOfLines={1}>{lead.OwnerName ?? "Unassigned"}</Text>
  </View>
);

/**
 * Mobile + call/message (G30), then Owner and Source (phone) or the facts
 * list in the 300 column (T3: Owner · Source · Product · custom fields · Created).
 */
export function ContactCard({
  lead, fields, wide, onCall, onMessage,
}: {
  lead: Lead;
  fields: CustomFieldValue[];
  wide: boolean;
  onCall: () => void;
  onMessage: () => void;
}) {
  return (
    <Card padded={false} gap={0}>
      <View style={[styles.contact, wide && styles.contactWide]}>
        <StatusBadge tone="mint" icon={Smartphone} />
        <View style={styles.flex}>
          <Text variant="label" color="textMuted">Mobile</Text>
          <Text variant="bodyStrong" tabular numberOfLines={1}>{spacedMobile(lead.MobileNo)}</Text>
        </View>
        {lead.MobileNo ? (
          <>
            <CircleAction icon={Phone} tone="primary" size={40} accessibilityLabel="Call" onPress={onCall} />
            <CircleAction icon={MessageCircle} tone="success" size={40} accessibilityLabel="Message" onPress={onMessage} />
          </>
        ) : null}
      </View>
      {wide ? (
        <View style={styles.factsList}>
          <Facts
            layout="list"
            items={[
              { label: "Owner", node: owner(lead) },
              { label: "Source", value: lead.SourceName ?? "—" },
              { label: "Product", value: lead.ProductName ?? "—" },
              ...fields.map((f) => ({ label: f.Label, value: customValue(f) })),
              { label: "Created", value: created(lead) },
            ]}
          />
        </View>
      ) : (
        <View style={styles.facts}>
          <View style={styles.flex}>
            <Text variant="label" color="textMuted">Owner</Text>
            <View style={styles.factValue}>{owner(lead)}</View>
          </View>
          <View style={styles.flex}>
            <Text variant="label" color="textMuted">Source</Text>
            <View style={[styles.factValue, styles.person]}>
              <Megaphone size={16} color={colors.textSecondary} />
              <Text variant="rowTitle" numberOfLines={1}>{lead.SourceName ?? "—"}</Text>
            </View>
          </View>
        </View>
      )}
    </Card>
  );
}

/** Details (spec 15, proposed): the facts the card does not carry, and the custom fields. Files follow it. */
export function DetailsFacts({ lead, fields, wide }: { lead: Lead; fields: CustomFieldValue[]; wide: boolean }) {
  const address = [lead.Address, lead.City, lead.State, lead.Pincode].filter(Boolean).join(", ");
  const items: Fact[] = [
    { label: "Email", value: lead.Email ?? "—" },
    { label: "Alternate mobile", value: lead.AltMobile ? spacedMobile(lead.AltMobile) : "—" },
    { label: "Company", value: lead.Company ?? "—" },
    { label: "Office", value: lead.BranchName ?? "—" },
    { label: "Address", value: address || "—" },
    ...(lead.PartnerName ? [{ label: "Partner", value: lead.PartnerName }] : []),
    ...(lead.LostReason ? [{ label: "Lost reason", value: lead.LostReason, tone: "danger" as const }] : []),
    ...(lead.Remarks ? [{ label: "Remarks", value: lead.Remarks }] : []),
    // The 300 column already lists the custom fields and Created.
    ...(wide ? [] : [...fields.map((f) => ({ label: f.Label, value: customValue(f) })), { label: "Created", value: created(lead) }]),
  ];
  return (
    <View style={styles.stack}>
      {lead.StatusCode === "converted" ? (
        <Card tone="brandSoft">
          <View style={styles.row}>
            <StatusBadge tone="green" icon={Trophy} />
            <View style={styles.flex}>
              <Text variant="rowTitle">Won for {rupees(lead.WonValue) ?? "—"}</Text>
              <Text variant="small">
                {[dayLabel(lead.WonAt), lead.CustomerName ? `customer: ${lead.CustomerName}` : null].filter(Boolean).join(" · ") || "—"}
              </Text>
            </View>
          </View>
        </Card>
      ) : null}
      <Facts items={items} />
    </View>
  );
}

/**
 * Follow-ups (E 15 / T3): the next open one as the butter card, then the rest
 * as rows. `onOpen` is absent for a view-only role; T3 puts Mark done and
 * Reschedule on the card itself (`wide`).
 */
export function FollowUpsTab({
  followups, next, plannedBy, wide, onOpen, onDone, onReschedule,
}: {
  followups: FollowUp[];
  next: FollowUp | undefined;
  plannedBy: (f: FollowUp) => string | null;
  wide: boolean;
  onOpen?: (f: FollowUp) => void;
  onDone?: (f: FollowUp) => void;
  onReschedule?: (f: FollowUp) => void;
}) {
  const rest = followups.filter((f) => f !== next);
  if (!followups.length) {
    return <Text variant="meta" style={styles.none}>No follow-ups yet.</Text>;
  }
  const by = next ? plannedBy(next) : null;
  return (
    <View>
      {next ? (
        <Card tone="followUp" gap={0} style={wide ? styles.nextWide : styles.next} onPress={onOpen && !wide ? () => onOpen(next) : undefined} testID="next-followup">
          <View style={styles.row}>
            <StatusBadge tone="butter" icon={CalendarClock} />
            <View style={styles.flex}>
              <View style={styles.person}>
                <Chip label="Next" tone="indigo" />
                <Text variant={wide ? "bodyStrong" : "rowTitle"} tabular numberOfLines={1}>{dueTitle(next.DueAt)}</Text>
              </View>
              <Text variant="small" color={next.IsOverdue ? "dangerText" : "warningText"} style={styles.sub}>
                {[followUpTypeLabel(next.Type), next.IsOverdue ? "overdue" : fromNow(next.DueAt), by ? `planned by ${by}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </View>
          </View>
          {next.Remarks ? <Text variant="text" style={styles.remarks}>{next.Remarks}</Text> : null}
          {wide && onDone && onReschedule ? (
            <View style={styles.buttons}>
              <Button title="Mark done" icon={Check} size="sm" onPress={() => onDone(next)} />
              <Button title="Reschedule" size="sm" variant="secondary" onPress={() => onReschedule(next)} />
            </View>
          ) : null}
        </Card>
      ) : null}
      {rest.length ? (
        <ListGroup style={next ? styles.after : undefined}>
          {rest.map((f, i) => {
            const open = f.Status === "open";
            const badge = followUpBadge(f.Type, open ? (f.IsOverdue ? "overdue" : "open") : "done");
            return (
              <ListRow
                key={f.Id}
                badge={{ tone: badge.tone, icon: badge.icon }}
                title={f.Remarks || followUpTypeLabel(f.Type)}
                titleTone={open ? "default" : "muted"}
                meta={followUpMeta(f)}
                noSeparator={i === 0}
                onPress={open && onOpen ? () => onOpen(f) : undefined}
                testID={`followup-${f.Id}`}
              />
            );
          })}
        </ListGroup>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  person: { flexDirection: "row", alignItems: "center", gap: 6 },
  contact: { flexDirection: "row", alignItems: "center", gap: spacing[3], paddingVertical: spacing[3], paddingHorizontal: 14 },
  contactWide: { paddingVertical: 14, paddingHorizontal: spacing[4] },
  facts: { flexDirection: "row", gap: spacing[4], paddingLeft: 66, paddingRight: 14, paddingBottom: spacing[3] },
  factValue: { marginTop: spacing[1] },
  factsList: { paddingHorizontal: spacing[4], paddingBottom: 6 },
  stack: { gap: spacing[3] },
  next: { padding: 14 },
  nextWide: { padding: spacing[4] },
  sub: { marginTop: 2 },
  remarks: { marginTop: 10 },
  buttons: { flexDirection: "row", gap: spacing[2], marginTop: spacing[3] },
  after: { marginTop: 10 },
  none: { paddingVertical: spacing[4] },
});
