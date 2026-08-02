import { useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  Ban,
  CircleCheck,
  Flag,
  Hash,
  History,
  Link2,
  Lock,
  MessageSquare,
  MoreVertical,
  Pencil,
  Phone,
  Tag,
  Trash2,
  User,
  type LucideIcon,
} from "lucide-react-native";
import type { StackScreenProps } from "@react-navigation/stack";

import { fetchLookups, fetchPipelines, LOOKUP_KIND } from "../../api/configQueries";
import {
  deleteTicket,
  fetchTicketDetail,
  moveTicketStage,
} from "../../api/ticketQueries";
import { fetchUserDirectory } from "../../api/userQueries";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import type { CustomFieldValue, PipelineStage } from "../../types/api";
import { colors, radius, shadows, spacing, SCREEN_PADDING } from "../../theme";
import {
  ActionSheet,
  Dialog,
  Screen,
  ScreenHeader,
  Segmented,
  Text,
  type SheetAction,
  type SheetRef,
} from "../../ui";
import AttachmentList from "../attachments/AttachmentList";
import { relativeTime } from "../tasks/taskHelpers";
import {
  channelLabel,
  lifecycleOf,
  lookupMap,
  needsResolution,
  priorityTone,
  stageOf,
  stageRoles,
  LIFECYCLE_LABEL,
} from "./ticketHelpers";

type Props = StackScreenProps<RootStackParamList, "ComplaintDetail">;
type Tab = "details" | "files" | "history";

export default function ComplaintDetailScreen({ route, navigation }: Props) {
  const { ticketId } = route.params;
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<Tab>("details");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Held between the two sheets when a move needs a resolution first.
  const [pendingStage, setPendingStage] = useState<PipelineStage | null>(null);

  const menuRef = useRef<SheetRef>(null);
  const stageRef = useRef<SheetRef>(null);
  const resolutionRef = useRef<SheetRef>(null);

  const detailQuery = useQuery({
    queryKey: ["ticket", ticketId],
    queryFn: () => fetchTicketDetail({ TicketId: ticketId }),
  });

  const { data: pipeline } = useQuery({
    queryKey: ["pipelines", "ticket"],
    queryFn: () => fetchPipelines({ Entity: "ticket" }),
  });
  const { data: categories } = useQuery({
    queryKey: ["lookups", LOOKUP_KIND.ticketCategory],
    queryFn: () => fetchLookups({ Kind: LOOKUP_KIND.ticketCategory }),
  });
  const { data: priorities } = useQuery({
    queryKey: ["lookups", LOOKUP_KIND.priority],
    queryFn: () => fetchLookups({ Kind: LOOKUP_KIND.priority }),
  });
  const { data: resolutions } = useQuery({
    queryKey: ["lookups", LOOKUP_KIND.resolution],
    queryFn: () => fetchLookups({ Kind: LOOKUP_KIND.resolution }),
  });
  const { data: directory } = useQuery({
    queryKey: ["users", "directory"],
    queryFn: () => fetchUserDirectory(),
  });

  const roles = useMemo(() => stageRoles(pipeline?.stages), [pipeline]);
  const categoryNames = useMemo(() => lookupMap(categories), [categories]);
  const priorityNames = useMemo(() => lookupMap(priorities), [priorities]);
  const resolutionNames = useMemo(() => lookupMap(resolutions), [resolutions]);
  const people = useMemo(
    () => new Map((directory ?? []).map((u) => [u.Id, u.FullName])),
    [directory],
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["ticket", ticketId] });
    queryClient.invalidateQueries({ queryKey: ["tickets"] });
  };

  const move = useMutation({
    mutationFn: moveTicketStage,
    onSuccess: () => {
      setPendingStage(null);
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: deleteTicket,
    onSuccess: () => {
      setConfirmingDelete(false);
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      navigation.goBack();
    },
  });

  const ticket = detailQuery.data?.ticket;

  if (detailQuery.isLoading) {
    return (
      <Screen>
        <View style={styles.centre}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  if (!ticket) {
    return (
      <Screen>
        <ScreenHeader title="Complaint" onBack={navigation.goBack} />
        <View style={styles.centre}>
          <Lock size={30} color={colors.textMuted} />
          <Text variant="h3">Complaint not available</Text>
          <Text variant="secondary" align="center">
            It may have been deleted, or it belongs to a branch you cannot see.
          </Text>
        </View>
      </Screen>
    );
  }

  const stage = stageOf(ticket, roles);
  const lifecycle = lifecycleOf(ticket, roles);
  const fields = detailQuery.data?.fields ?? [];
  const activity = detailQuery.data?.activity ?? [];
  const linkedLead = detailQuery.data?.linkedLead ?? null;

  const priority = ticket.Priority ? priorityNames.get(ticket.Priority) : undefined;
  const category = ticket.CategoryId ? categoryNames.get(ticket.CategoryId) : undefined;
  const assignee = ticket.AssignedTo ? people.get(ticket.AssignedTo) : undefined;
  const resolution = ticket.ResolutionId
    ? resolutionNames.get(ticket.ResolutionId)
    : undefined;

  /**
   * Every transition goes through moveTicketStage. Entering the first `won`
   * stage needs a resolution, so that move opens a second sheet instead of
   * firing — the SP rejects it otherwise, and a silent failure would look like
   * the app ignoring the tap.
   */
  const pickStage = (target: PipelineStage) => {
    if (needsResolution(target, roles) && !ticket.ResolutionId) {
      setPendingStage(target);
      resolutionRef.current?.present();
      return;
    }
    move.mutate({ TicketId: ticketId, StageId: target.Id });
  };

  const stageActions: SheetAction[] = roles.ordered.map((s) => ({
    key: String(s.Id),
    label: s.Name,
    sublabel:
      s.Id === roles.resolved?.Id
        ? "Fixed — awaiting the customer"
        : s.Id === roles.closed?.Id
          ? "Done and confirmed"
          : s.StageType === "lost"
            ? "Closed without a fix"
            : undefined,
    icon:
      s.StageType === "lost"
        ? Ban
        : s.StageType === "won"
          ? CircleCheck
          : ArrowRightLeft,
    tone: s.StageType === "lost" ? "danger" : undefined,
    selected: s.Id === ticket.StageId,
    onPress: () => pickStage(s),
  }));

  const resolutionActions: SheetAction[] = (resolutions ?? []).map((r) => ({
    key: String(r.Id),
    label: r.Value,
    icon: CircleCheck,
    onPress: () =>
      pendingStage &&
      move.mutate({
        TicketId: ticketId,
        StageId: pendingStage.Id,
        ResolutionId: r.Id,
      }),
  }));

  const menuActions: SheetAction[] = [
    {
      key: "stage",
      label: "Move stage",
      sublabel: stage?.Name,
      icon: ArrowRightLeft,
      onPress: () => stageRef.current?.present(),
    },
    {
      key: "edit",
      label: "Edit complaint",
      icon: Pencil,
      onPress: () => navigation.navigate("ComplaintForm", { ticketId }),
    },
    {
      key: "delete",
      label: "Delete complaint",
      icon: Trash2,
      tone: "danger",
      onPress: () => setConfirmingDelete(true),
    },
  ];

  return (
    <Screen>
      <ScreenHeader
        title={ticket.CustomerName || "Complaint"}
        subtitle={`${ticket.TicketNo} · ${stage?.Name ?? LIFECYCLE_LABEL[lifecycle]}`}
        tint="danger"
        onBack={navigation.goBack}
        actions={[
          {
            icon: MoreVertical,
            label: "Complaint actions",
            onPress: () => menuRef.current?.present(),
          },
        ]}
      />

      <View style={styles.summary}>
        {stage ? (
          <View style={[styles.stageBar, { backgroundColor: stage.Color ?? colors.primary }]}>
            <Text variant="bodyStrong" color="textOnBrand">
              {stage.Name}
            </Text>
            {resolution ? (
              <Text variant="caption" color="textOnBrand">
                {resolution}
              </Text>
            ) : null}
          </View>
        ) : null}

        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "details", label: "Details" },
            { value: "files", label: "Files" },
            { value: "history", label: "History", count: activity.length },
          ]}
        />
      </View>

      {tab === "details" ? (
        <ScrollView
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            <Fact Icon={Hash} label="Ticket" value={ticket.TicketNo} />
            <Fact
              Icon={User}
              label="Contact person"
              value={ticket.ContactPerson || "—"}
            />
            <Fact Icon={Phone} label="Contact" value={ticket.Contact || "—"} />
            <Fact
              Icon={MessageSquare}
              label="Channel"
              value={channelLabel(ticket.Channel)}
            />
            <Fact Icon={Tag} label="Category" value={category ?? "—"} />
            <Fact
              Icon={Flag}
              label="Priority"
              value={priority ?? "—"}
              tone={priorityTone(priority)}
            />
            <Fact
              Icon={User}
              label="Assigned to"
              value={assignee ?? "Unassigned"}
            />
            <Fact
              Icon={History}
              label="Logged"
              value={relativeTime(ticket.CreatedAt)}
              last
            />
          </View>

          {ticket.Description ? (
            <View style={styles.block}>
              <Text variant="overline" color="textMuted">
                Complaint
              </Text>
              <Text variant="body">{ticket.Description}</Text>
            </View>
          ) : null}

          {fields.length ? (
            <View style={styles.block}>
              <Text variant="overline" color="textMuted">
                Extra details
              </Text>
              {fields.map((field) => (
                <View key={field.FieldId} style={styles.fieldRow}>
                  <Text variant="caption" color="textMuted">
                    {field.Label}
                  </Text>
                  <Text variant="body">{customValue(field)}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {linkedLead ? (
            <View style={styles.block}>
              <Text variant="overline" color="textMuted">
                Raised from
              </Text>
              <View style={styles.leadRow}>
                <Link2 size={18} color={colors.info} />
                <View style={styles.leadText}>
                  <Text variant="bodyStrong">{linkedLead.Name ?? "Lead"}</Text>
                  <Text variant="caption" color="textMuted">
                    {linkedLead.MobileNo || linkedLead.Email || "No contact"}
                  </Text>
                </View>
              </View>
            </View>
          ) : null}
        </ScrollView>
      ) : null}

      {tab === "files" ? (
        <AttachmentList entity="ticket" entityId={ticketId} canManage />
      ) : null}

      {tab === "history" ? (
        <ScrollView
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        >
          {activity.map((entry) => (
            <View key={entry.Id} style={styles.activityRow}>
              <View style={styles.activityGlyph}>
                <History size={15} color={colors.textOnBrand} />
              </View>
              <View style={styles.activityText}>
                <Text variant="body">{entry.Summary ?? entry.Type}</Text>
                <Text variant="caption" color="textMuted">
                  {people.get(entry.UserId ?? -1) ?? "System"} ·{" "}
                  {relativeTime(entry.CreatedAt)}
                </Text>
              </View>
            </View>
          ))}
          {!activity.length ? (
            <Text variant="secondary">Nothing has happened yet.</Text>
          ) : null}
        </ScrollView>
      ) : null}

      <ActionSheet ref={menuRef} title="Complaint actions" actions={menuActions} />
      <ActionSheet
        ref={stageRef}
        title="Move to stage"
        actions={stageActions}
        emptyMessage="This company has no support pipeline configured."
      />
      <ActionSheet
        ref={resolutionRef}
        title="How was it resolved?"
        actions={resolutionActions}
        emptyMessage="No resolutions are configured. Add them on the web first."
      />

      <Dialog
        visible={confirmingDelete}
        title="Delete this complaint?"
        message="Its activity and attachments go with it. This cannot be undone."
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onConfirm={() => remove.mutate({ Id: ticketId })}
        onCancel={() => setConfirmingDelete(false)}
      />
    </Screen>
  );
}

/** The EAV row splits by type; exactly one column is populated. */
function customValue(field: CustomFieldValue): string {
  if (field.Type === "checkbox") {
    return field.ValueText === "true" || field.ValueNumber === 1 ? "Yes" : "No";
  }
  if (field.Type === "number") return field.ValueNumber?.toString() ?? "—";
  if (field.Type === "date") {
    return field.ValueDate ? field.ValueDate.slice(0, 10) : "—";
  }
  return field.ValueText || "—";
}

function Fact({
  Icon,
  label,
  value,
  tone,
  last = false,
}: {
  Icon: LucideIcon;
  label: string;
  value: string;
  tone?: keyof typeof colors;
  last?: boolean;
}) {
  return (
    <View style={[styles.fact, !last && styles.factDivider]}>
      <Icon size={16} color={colors.textMuted} />
      <Text variant="caption" color="textMuted" style={styles.factLabel}>
        {label}
      </Text>
      <Text
        variant="body"
        color={tone}
        numberOfLines={1}
        style={styles.factValue}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  centre: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    padding: spacing[6],
  },
  summary: {
    paddingHorizontal: SCREEN_PADDING,
    paddingTop: spacing[4],
    paddingBottom: spacing[3],
    gap: spacing[3],
  },
  // Solid band in the stage's own colour — where the ticket stands is the one
  // fact worth reading from across a room.
  stageBar: {
    borderRadius: radius.md,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    gap: spacing[1],
  },
  list: {
    paddingHorizontal: SCREEN_PADDING,
    paddingBottom: spacing[20],
    gap: spacing[4],
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing[4],
    ...shadows.sm,
  },
  fact: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingVertical: spacing[3],
  },
  factDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  factLabel: { width: 96 },
  factValue: { flex: 1, textAlign: "right" },
  block: { gap: spacing[2] },
  fieldRow: { gap: spacing[1] },
  leadRow: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  leadText: { flex: 1, gap: spacing[1] },
  activityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing[3],
    ...shadows.sm,
  },
  activityGlyph: {
    width: 30,
    height: 30,
    borderRadius: radius.full,
    backgroundColor: colors.info,
    alignItems: "center",
    justifyContent: "center",
  },
  activityText: { flex: 1, gap: spacing[1] },
});
