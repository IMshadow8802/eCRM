import { useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
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
  PhoneCall,
  PhoneIncoming,
  PhoneOutgoing,
  Plus,
  Tag,
  Trash2,
  User,
  type LucideIcon,
} from "lucide-react-native";
import type { StackScreenProps } from "@react-navigation/stack";

import {
  deleteTicket,
  fetchTicketDetail,
  moveTicketStage,
} from "../../api/ticketQueries";
import { fetchCalls, logCall, type CallDirection } from "../../api/callQueries";
import { apiErrorMessage } from "../../api/errors";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import type { CustomFieldValue, PipelineStage } from "../../types/api";
import { colors, radius, spacing, SCREEN_PADDING } from "../../theme";
import {
  ActionSheet,
  Card,
  ComposeSheet,
  Dialog,
  Screen,
  ScreenHeader,
  ScreenLoader,
  Segmented,
  Text,
  Timeline,
  type SheetAction,
  type SheetRef,
  type TimelineEntry,
  useToast,
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
  LIFECYCLE_LABEL,
} from "./ticketHelpers";
import { useTicketRefData } from "./useTicketRefData";

type Props = StackScreenProps<RootStackParamList, "ComplaintDetail">;
type Tab = "details" | "files" | "history";

export default function ComplaintDetailScreen({ route, navigation }: Props) {
  const { ticketId } = route.params;
  const queryClient = useQueryClient();
  const toast = useToast();

  const [tab, setTab] = useState<Tab>("details");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  // Held between the two sheets when a move needs a resolution first.
  const [pendingStage, setPendingStage] = useState<PipelineStage | null>(null);

  const menuRef = useRef<SheetRef>(null);
  const stageRef = useRef<SheetRef>(null);
  const resolutionRef = useRef<SheetRef>(null);
  const callRef = useRef<SheetRef>(null);

  const detailQuery = useQuery({
    queryKey: ["ticket", ticketId],
    queryFn: () => fetchTicketDetail({ TicketId: ticketId }),
  });

  // Scoped to the pipeline this ticket is actually in — not the default one.
  // The move sheet and the Resolved/Closed labels are built from these, and
  // offering a stage from another pipeline moves the ticket out of its own.
  const { categories, priorities, resolutions, outcomes, directory, roles } =
    useTicketRefData(detailQuery.data?.ticket?.PipelineId ?? null);
  // sp_LogCall's activity row only says "Outbound call logged" — the notes and
  // outcome live on tblCall. Fetching them is what makes a logged call
  // readable rather than just countable.
  const { data: calls } = useQuery({
    queryKey: ["calls", "ticket", ticketId],
    queryFn: () => fetchCalls({ TicketId: ticketId }),
  });

  const categoryNames = useMemo(() => lookupMap(categories), [categories]);
  const priorityNames = useMemo(() => lookupMap(priorities), [priorities]);
  const resolutionNames = useMemo(() => lookupMap(resolutions), [resolutions]);
  const outcomeNames = useMemo(() => lookupMap(outcomes), [outcomes]);
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
    onError: (err) => {
      setPendingStage(null);
      toast.error(apiErrorMessage(err, "Could not move this complaint."));
    },
    onSuccess: () => {
      setPendingStage(null);
      invalidate();
    },
  });

  const logTheCall = useMutation({
    mutationFn: logCall,
    onError: (err) => setCallError(apiErrorMessage(err, "Could not log that call.")),
    onSuccess: () => {
      callRef.current?.dismiss();
      queryClient.invalidateQueries({ queryKey: ["calls", "ticket", ticketId] });
      // sp_LogCall writes a ticket-activity row (SQL 067), so the call appears
      // on the History tab without a second request.
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: deleteTicket,
    onError: (err) => toast.error(apiErrorMessage(err, "Could not delete this complaint.")),
    onSuccess: () => {
      setConfirmingDelete(false);
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      navigation.goBack();
    },
  });

  const ticket = detailQuery.data?.ticket;

  // The header renders here too — a loading screen with no back button is a
  // dead end (see TaskDetailScreen).
  if (detailQuery.isLoading || detailQuery.isError) {
    return (
      <Screen>
        <ScreenHeader title="Complaint" onBack={navigation.goBack} />
        <ScreenLoader
          failed={detailQuery.isError}
          onRetry={detailQuery.refetch}
          message={
            detailQuery.isError
              ? "The complaint could not be loaded. Check your connection and try again."
              : undefined
          }
        />
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

  const who = (userId: number | null) => people.get(userId ?? -1) ?? "System";

  /**
   * The history is two sources woven together.
   *
   * `tblTicketActivity` records that a call happened; `tblCall` records what
   * was said. Showing both would list every call twice, so the activity rows
   * of type 'call' are dropped and the richer call rows take their place.
   *
   * tblTicketActivity.Type is the vocabulary each SP writes — 'created',
   * 'stage', 'note', 'call'. Anything unmapped still gets a node rather than
   * being dropped, so a type added later shows up without a release here.
   */
  const timeline: TimelineEntry[] = [
    ...activity
      .filter((entry) => !(entry.Type ?? "").toLowerCase().includes("call"))
      .map((entry) => {
        const type = (entry.Type ?? "").toLowerCase();
        const node = type.includes("creat")
          ? { Icon: Plus, tone: "success" as const }
          : type.includes("stage")
            ? { Icon: ArrowRightLeft, tone: "primary" as const }
            : type.includes("resolv") || type.includes("clos")
              ? { Icon: CircleCheck, tone: "success" as const }
              : { Icon: History, tone: "textSecondary" as const };

        return {
          key: `a-${entry.Id}`,
          at: entry.CreatedAt,
          title: entry.Summary ?? entry.Type,
          meta: `${who(entry.UserId)} · ${relativeTime(entry.CreatedAt)}`,
          icon: node.Icon,
          tone: node.tone,
        };
      }),
    ...(calls ?? []).map((call) => {
      const outcome = call.OutcomeId ? outcomeNames.get(call.OutcomeId) : undefined;
      const bits = [
        who(call.UserId),
        outcome,
        call.Duration ? `${call.Duration} min` : undefined,
        relativeTime(call.CalledAt),
      ].filter(Boolean);

      return {
        key: `c-${call.Id}`,
        at: call.CalledAt,
        title:
          call.Notes ||
          (call.Direction === "in" ? "Incoming call" : "Outgoing call"),
        meta: bits.join(" · "),
        icon: call.Direction === "in" ? PhoneIncoming : PhoneOutgoing,
        tone: "info" as const,
      };
    }),
  ]
    // Newest first, matching what sp_FetchTicketDetail already returns.
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .map(({ at, ...entry }) => {
      void at;
      return entry;
    });

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
      key: "call",
      label: "Log a call",
      sublabel: "Goes straight onto the history",
      icon: PhoneCall,
      onPress: () => {
        setCallError(null);
        callRef.current?.present();
      },
    },
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
          <Card padded={false} gap={0} style={styles.factCard}>
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
          </Card>

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
          {timeline.length ? (
            <>
              <Timeline entries={timeline} />
              <Text variant="caption" color="textMuted" style={styles.end}>
                Complaint logged
              </Text>
            </>
          ) : (
            <Text variant="secondary">Nothing has happened yet.</Text>
          )}
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

      {/* One sheet, not a chain of them: direction and outcome are chips so
          the whole call fits on screen with the keyboard up. NextFollowupDate
          is absent on purpose — tblFollowUp hangs off LeadId, so a ticket
          cannot carry one, and its next step is its stage anyway. */}
      <ComposeSheet
        ref={callRef}
        title="Log a call"
        submitLabel="Log call"
        busy={logTheCall.isPending}
        error={callError}
        choices={[
          {
            key: "direction",
            label: "Direction",
            required: true,
            options: [
              { value: "in", label: "Incoming" },
              { value: "out", label: "Outgoing" },
            ],
          },
          ...(outcomes?.length
            ? [
                {
                  key: "outcome",
                  label: "Outcome",
                  options: outcomes.map((o) => ({ value: o.Id, label: o.Value })),
                },
              ]
            : []),
        ]}
        fields={[
          { key: "notes", label: "Notes", placeholder: "What was said", multiline: true },
          { key: "minutes", label: "Minutes", placeholder: "0", numeric: true },
        ]}
        onSubmit={(values, picked) => {
          const minutes = Number(values.minutes);
          logTheCall.mutate({
            TicketId: ticketId,
            Direction: (picked.direction as CallDirection) ?? "out",
            OutcomeId: (picked.outcome as number) ?? null,
            Notes: values.notes || null,
            Duration: Number.isFinite(minutes) && minutes > 0 ? minutes : null,
          });
        }}
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
  factCard: { paddingHorizontal: spacing[4] },
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
  // Lines up under the entry text, not under the rail.
  end: { paddingLeft: spacing[10] },
});
