import { useMemo, useRef, useState, type RefObject } from "react";
import { Linking, ScrollView, StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import {
  ArrowRightLeft,
  Ban,
  Building2,
  CalendarClock,
  CalendarPlus,
  CircleCheck,
  CircleDot,
  EllipsisVertical,
  History,
  IndianRupee,
  Lock,
  Mail,
  MapPin,
  Package,
  Pencil,
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneOutgoing,
  Plus,
  SkipForward,
  Sparkles,
  Star,
  Trophy,
  User,
  UserPlus,
  type LucideIcon,
} from "lucide-react-native";
import type { StackScreenProps } from "@react-navigation/stack";

import {
  convertLead,
  fetchLeadDetail,
  setLeadStatus,
  transferLead,
} from "../../api/leadQueries";
import {
  completeFollowUp,
  scheduleFollowUp,
  skipFollowUp,
} from "../../api/followupQueries";
import { fetchCalls, logCall, type CallDirection } from "../../api/callQueries";
import { fetchUserDirectory } from "../../api/userQueries";
import { apiErrorMessage } from "../../api/errors";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import type {
  AssignableUser,
  CustomFieldValue,
  FollowUp,
  FollowUpType,
  Lookup,
} from "../../types/api";
import { colors, spacing, SCREEN_PADDING } from "../../theme";
import {
  ActionSheet,
  Button,
  Card,
  Chip,
  ComposeSheet,
  Screen,
  ScreenHeader,
  ScreenLoader,
  Segmented,
  Text,
  Timeline,
  type ChipTone,
  type SheetAction,
  type SheetRef,
  type TimelineEntry,
  useToast,
} from "../../ui";
import AttachmentList from "../attachments/AttachmentList";
import { lookupMap } from "../support/ticketHelpers";
import { relativeTime } from "../tasks/taskHelpers";
import {
  dayLabel,
  dueFromChoice,
  followUpTypeLabel,
  FOLLOWUP_TYPES,
  isActiveLead,
  leadTone,
  nextOpen,
  rupees,
  WHEN_CHOICES,
  type WhenChoice,
} from "./leadHelpers";
import { useLeadRefData } from "./useLeadRefData";

type Props = StackScreenProps<RootStackParamList, "LeadDetail">;
type Tab = "details" | "followups" | "files" | "history";

const DIRECTIONS = [
  { value: "out", label: "Outgoing" },
  { value: "in", label: "Incoming" },
];

/** Timeline node per tblLeadActivity.Type; unmapped types still get a node. */
const ACTIVITY_NODE: Record<string, { Icon: LucideIcon; tone: keyof typeof colors }> = {
  created: { Icon: Plus, tone: "success" },
  updated: { Icon: Pencil, tone: "textSecondary" },
  status: { Icon: ArrowRightLeft, tone: "primary" },
  converted: { Icon: Trophy, tone: "success" },
  won: { Icon: Trophy, tone: "success" },
  lost: { Icon: Ban, tone: "danger" },
  assigned: { Icon: UserPlus, tone: "info" },
  transfer: { Icon: UserPlus, tone: "info" },
  followup: { Icon: CalendarClock, tone: "warning" },
};

export default function LeadDetailScreen({ route, navigation }: Props) {
  const { leadId } = route.params;
  const queryClient = useQueryClient();
  const toast = useToast();

  const [tab, setTab] = useState<Tab>("details");
  const [error, setError] = useState<string | null>(null);
  // Held between a pick and the sheet that finishes it.
  const [target, setTarget] = useState<Lookup | null>(null);
  const [followUp, setFollowUp] = useState<FollowUp | null>(null);
  const [transferTo, setTransferTo] = useState<AssignableUser | null>(null);

  const menuRef = useRef<SheetRef>(null);
  const statusRef = useRef<SheetRef>(null);
  const lostRef = useRef<SheetRef>(null);
  const wonRef = useRef<SheetRef>(null);
  const scheduleRef = useRef<SheetRef>(null);
  const completeRef = useRef<SheetRef>(null);
  const skipRef = useRef<SheetRef>(null);
  const callRef = useRef<SheetRef>(null);
  const transferPickRef = useRef<SheetRef>(null);
  const transferRef = useRef<SheetRef>(null);

  const detailQuery = useQuery({
    queryKey: ["lead", leadId],
    queryFn: () => fetchLeadDetail({ LeadId: leadId }),
  });
  const lead = detailQuery.data?.lead;

  const { statuses, lostReasons, transferReasons, callOutcomes, users } = useLeadRefData();

  const { data: directory } = useQuery({
    queryKey: ["users", "directory"],
    queryFn: () => fetchUserDirectory(),
  });
  const { data: calls } = useQuery({
    queryKey: ["calls", "lead", leadId],
    queryFn: () => fetchCalls({ LeadId: leadId }),
  });

  const outcomeNames = useMemo(() => lookupMap(callOutcomes), [callOutcomes]);
  const people = useMemo(
    () => new Map((directory ?? []).map((u) => [u.Id, u.FullName])),
    [directory],
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["lead", leadId] });
    queryClient.invalidateQueries({ queryKey: ["leads"] });
    queryClient.invalidateQueries({ queryKey: ["followups"] });
  };

  const writes = { setError, toast, invalidate };
  // Lost is the one sheet whose action can also fire without a sheet (any
  // plain status), so its failures toast rather than hide in a closed sheet.
  const status = useLeadWrite(setLeadStatus, lostRef, "Could not change the status.", writes, false);
  const won = useLeadWrite(convertLead, wonRef, "Could not mark this lead won.", writes);
  const schedule = useLeadWrite(scheduleFollowUp, scheduleRef, "Could not schedule the follow-up.", writes);
  const complete = useLeadWrite(completeFollowUp, completeRef, "Could not log the follow-up.", writes);
  const skip = useLeadWrite(skipFollowUp, skipRef, "Could not skip the follow-up.", writes);
  const transfer = useLeadWrite(transferLead, transferRef, "Could not transfer this lead.", writes);
  const call = useMutation({
    mutationFn: logCall,
    onMutate: () => setError(null),
    onError: (err) => setError(apiErrorMessage(err, "Could not log that call.")),
    onSuccess: () => {
      callRef.current?.dismiss();
      queryClient.invalidateQueries({ queryKey: ["calls", "lead", leadId] });
      invalidate();
    },
  });

  if (detailQuery.isLoading || detailQuery.isError || !lead) {
    const code = isAxiosError(detailQuery.error) ? detailQuery.error.response?.status : undefined;
    const forbidden = code === 403 || code === 404 || (detailQuery.isSuccess && !lead);
    return (
      <Screen>
        <ScreenHeader title="Lead" onBack={navigation.goBack} />
        {forbidden ? (
          <View style={styles.centre}>
            <Lock size={30} color={colors.textMuted} />
            <Text variant="h3">Lead not available</Text>
            <Text variant="secondary" align="center">
              It may have been deleted, or it belongs to someone you cannot see.
            </Text>
          </View>
        ) : (
          <ScreenLoader
            failed={detailQuery.isError}
            onRetry={detailQuery.refetch}
            message={
              detailQuery.isError
                ? "The lead could not be loaded. Check your connection and try again."
                : undefined
            }
          />
        )}
      </Screen>
    );
  }

  const followups = detailQuery.data?.followups ?? [];
  const activity = detailQuery.data?.activity ?? [];
  const assignments = detailQuery.data?.assignments ?? [];
  const fields = detailQuery.data?.fields ?? [];
  const openFollowups = followups.filter((f) => f.Status === "open");
  const pendingFollowUp = nextOpen(followups);
  const active = isActiveLead(lead.StatusCode);
  const next = active ? dayLabel(lead.NextFollowupDate) : null;
  const address = [lead.Address, lead.City, lead.State, lead.Pincode].filter(Boolean).join(", ");
  const who = (id: number | null) => people.get(id ?? -1) ?? "System";

  const openSheet = (ref: RefObject<SheetRef | null>) => {
    setError(null);
    ref.current?.present();
  };
  const startComplete = (f: FollowUp) => {
    setFollowUp(f);
    openSheet(completeRef);
  };
  const startSkip = (f: FollowUp) => {
    setFollowUp(f);
    openSheet(skipRef);
  };

  // --- history: activity (minus call rows) + the calls themselves + transfers
  const timeline: TimelineEntry[] = [
    ...activity
      .filter((a) => (a.Type ?? "").toLowerCase() !== "call")
      .map((a) => {
        const node = ACTIVITY_NODE[(a.Type ?? "").toLowerCase()] ?? {
          Icon: History,
          tone: "textSecondary" as const,
        };
        return {
          key: `a-${a.Id}`,
          at: a.CreatedAt,
          title: a.Summary ?? a.Type,
          meta: `${a.UserName ?? "System"} · ${relativeTime(a.CreatedAt)}`,
          icon: node.Icon,
          tone: node.tone,
        };
      }),
    ...(calls ?? []).map((c) => ({
      key: `c-${c.Id}`,
      at: c.CalledAt,
      title: c.Notes || (c.Direction === "in" ? "Incoming call" : "Outgoing call"),
      meta: [
        who(c.UserId),
        c.OutcomeId ? outcomeNames.get(c.OutcomeId) : undefined,
        c.Duration ? `${c.Duration} min` : undefined,
        relativeTime(c.CalledAt),
      ]
        .filter(Boolean)
        .join(" · "),
      icon: c.Direction === "in" ? PhoneIncoming : PhoneOutgoing,
      tone: "info" as const,
    })),
    ...assignments.map((a) => ({
      key: `t-${a.Id}`,
      at: a.AssignedAt,
      title: `${a.FromUserName ?? "Unassigned"} → ${a.ToUserName ?? "Unassigned"}${
        a.Remarks ? ` — ${a.Remarks}` : ""
      }`,
      meta: [a.Reason, a.AssignedByName, relativeTime(a.AssignedAt)].filter(Boolean).join(" · "),
      icon: UserPlus,
      tone: "info" as const,
    })),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .map(({ at, ...entry }) => {
      void at;
      return entry;
    });

  // --- status: Won and Lost need more than a tap; the rest post directly
  const pickStatus = (s: Lookup) => {
    if (s.Code === "converted") {
      setTarget(s);
      openSheet(wonRef);
    } else if (s.Code === "lost") {
      setTarget(s);
      openSheet(lostRef);
    } else {
      status.mutate({ LeadId: leadId, StatusId: s.Id });
    }
  };

  const statusActions: SheetAction[] = statuses
    .filter((s) => s.Id !== lead.StatusId)
    .map((s) => ({
      key: String(s.Id),
      label: s.Value,
      sublabel:
        s.Code === "converted"
          ? "Won — asks for the value"
          : s.Code === "lost"
            ? "Asks for a reason"
            : undefined,
      icon: s.Code === "converted" ? Trophy : s.Code === "lost" ? Ban : s.Code === "qualified" ? Star : CircleDot,
      tone: s.Code === "lost" || s.Code === "junk" ? "danger" : undefined,
      onPress: () => pickStatus(s),
    }));

  const transferActions: SheetAction[] = users
    .filter((u) => u.Id !== lead.OwnerId)
    .map((u) => ({
      key: String(u.Id),
      label: u.FullName,
      sublabel: [u.JobTitle, u.BranchName].filter(Boolean).join(" · ") || undefined,
      icon: User,
      onPress: () => {
        setTransferTo(u);
        openSheet(transferRef);
      },
    }));

  const followUpEntry: SheetAction[] = pendingFollowUp
    ? [
        {
          key: "log",
          label: `Log ${followUpTypeLabel(pendingFollowUp.Type).toLowerCase()}`,
          sublabel: `Due ${dayLabel(pendingFollowUp.DueAt) ?? "—"}`,
          icon: CircleCheck,
          onPress: () => startComplete(pendingFollowUp),
        },
      ]
    : [];

  const menuActions: SheetAction[] = [
    {
      key: "status",
      label: "Change status",
      sublabel: lead.StatusName ?? undefined,
      icon: ArrowRightLeft,
      onPress: () => statusRef.current?.present(),
    },
    ...followUpEntry,
    {
      key: "schedule",
      label: "Schedule follow-up",
      icon: CalendarPlus,
      onPress: () => openSheet(scheduleRef),
    },
    {
      key: "call",
      label: "Log a call",
      sublabel: "Goes straight onto the history",
      icon: PhoneCall,
      onPress: () => openSheet(callRef),
    },
    {
      key: "transfer",
      label: "Transfer",
      sublabel: lead.OwnerName ? `Now with ${lead.OwnerName}` : "Unassigned",
      icon: UserPlus,
      onPress: () => transferPickRef.current?.present(),
    },
    {
      key: "edit",
      label: "Edit lead",
      icon: Pencil,
      onPress: () => navigation.navigate("LeadForm", { leadId }),
    },
  ];

  const isCall = followUp?.Type === "call";

  return (
    <Screen>
      <ScreenHeader
        title={lead.Name}
        subtitle={[lead.Company, lead.StatusName].filter(Boolean).join(" · ")}
        tint="success"
        onBack={navigation.goBack}
        actions={[
          {
            icon: EllipsisVertical,
            label: "Lead actions",
            onPress: () => menuRef.current?.present(),
          },
        ]}
      />

      <View style={styles.summary}>
        <View style={styles.chips}>
          <Chip label={lead.StatusName ?? "—"} tone={leadTone(lead.StatusCode)} />
          {next ? (
            <Chip
              label={lead.IsOverdue ? `Overdue · ${next}` : `Next: ${next}`}
              icon={CalendarClock}
              tone={lead.IsOverdue ? "danger" : "neutral"}
            />
          ) : null}
          <Chip label={lead.OwnerName ?? "Unassigned"} icon={User} maxWidth={200} />
        </View>

        <View style={styles.quick}>
          {lead.MobileNo ? (
            <Button
              title="Call"
              icon={Phone}
              variant="secondary"
              size="sm"
              onPress={() => void Linking.openURL(`tel:${lead.MobileNo}`)}
              style={styles.quickButton}
            />
          ) : null}
          {pendingFollowUp ? (
            <Button
              title="Log follow-up"
              icon={CircleCheck}
              size="sm"
              onPress={() => startComplete(pendingFollowUp)}
              style={styles.quickButton}
            />
          ) : (
            <Button
              title="Schedule"
              icon={CalendarPlus}
              size="sm"
              onPress={() => openSheet(scheduleRef)}
              style={styles.quickButton}
            />
          )}
        </View>

        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "details", label: "Details" },
            { value: "followups", label: "Follow-ups", count: openFollowups.length },
            { value: "files", label: "Files" },
            { value: "history", label: "History" },
          ]}
        />
      </View>

      {tab === "details" ? (
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {lead.StatusCode === "converted" ? (
            <Card style={styles.banner}>
              <View style={styles.bannerRow}>
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
              <Fact Icon={Ban} label="Lost reason" value={lead.LostReason} tone="danger" />
            ) : null}
            <Fact Icon={History} label="Added" value={relativeTime(lead.CreatedAt)} last />
          </Card>

          {address ? (
            <View style={styles.block}>
              <Text variant="overline" color="textMuted">
                Address
              </Text>
              <View style={styles.bannerRow}>
                <MapPin size={16} color={colors.textMuted} />
                <Text variant="body" style={styles.grow}>
                  {address}
                </Text>
              </View>
            </View>
          ) : null}

          {lead.Remarks ? (
            <View style={styles.block}>
              <Text variant="overline" color="textMuted">
                Remarks
              </Text>
              <Text variant="body">{lead.Remarks}</Text>
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
        </ScrollView>
      ) : null}

      {tab === "followups" ? (
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {followups.length ? (
            followups.map((f) => (
              <Card key={f.Id}>
                <View style={styles.bannerRow}>
                  <CalendarClock size={18} color={f.IsOverdue ? colors.danger : colors.textMuted} />
                  <Text variant="h3" style={styles.grow}>
                    {followUpTypeLabel(f.Type)}
                  </Text>
                  <Chip
                    label={
                      f.Status === "open"
                        ? f.IsOverdue
                          ? `Overdue · ${dayLabel(f.DueAt)}`
                          : `Due ${dayLabel(f.DueAt)}`
                        : f.Status === "done"
                          ? "Done"
                          : "Skipped"
                    }
                    tone={f.Status === "open" ? (f.IsOverdue ? "danger" : "primary") : "neutral"}
                  />
                </View>
                {f.Outcome || f.Remarks ? (
                  <Text variant="body">{[f.Outcome, f.Remarks].filter(Boolean).join(" — ")}</Text>
                ) : null}
                <Text variant="caption" color="textMuted">
                  {f.Status === "open"
                    ? `Assigned to ${f.AssignedToName ?? "—"}`
                    : `${f.DoneByName ?? "—"} · ${relativeTime(f.DoneAt)}`}
                </Text>
                {f.Status === "open" ? (
                  <View style={styles.quick}>
                    <Button
                      title="Log"
                      icon={CircleCheck}
                      size="sm"
                      onPress={() => startComplete(f)}
                      style={styles.quickButton}
                    />
                    <Button
                      title="Skip"
                      icon={SkipForward}
                      size="sm"
                      variant="secondary"
                      onPress={() => startSkip(f)}
                      style={styles.quickButton}
                    />
                  </View>
                ) : null}
              </Card>
            ))
          ) : (
            <Text variant="secondary">No follow-ups yet. Schedule one from the button above.</Text>
          )}
        </ScrollView>
      ) : null}

      {tab === "files" ? <AttachmentList entity="lead" entityId={leadId} canManage /> : null}

      {tab === "history" ? (
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {timeline.length ? (
            <Timeline entries={timeline} />
          ) : (
            <Text variant="secondary">Nothing has happened yet.</Text>
          )}
        </ScrollView>
      ) : null}

      <ActionSheet ref={menuRef} title="Lead actions" actions={menuActions} />

      <ActionSheet
        ref={statusRef}
        title="Change status"
        actions={statusActions}
        emptyMessage="No other statuses are configured. Add them on the web first."
      />

      <ComposeSheet
        ref={lostRef}
        title={`Mark as ${target?.Value ?? "lost"}`}
        submitLabel="Mark lost"
        busy={status.isPending}
        error={error ?? (lostReasons.length ? null : "No lost reasons are set up. Add them on the web first.")}
        choices={[
          {
            key: "reason",
            label: "Why was it lost?",
            required: true,
            options: lostReasons.map((r) => ({ value: r.Id, label: r.Value })),
          },
        ]}
        fields={[]}
        onSubmit={(_, picked) => {
          if (!target) return;
          status.mutate({ LeadId: leadId, StatusId: target.Id, LostReasonId: picked.reason as number });
        }}
      />

      <ComposeSheet
        ref={wonRef}
        title={`Mark as ${target?.Value ?? "won"}`}
        submitLabel="Mark won"
        busy={won.isPending}
        error={error}
        fields={[
          { key: "value", label: "Won value (₹)", placeholder: "0", numeric: true, required: true },
          { key: "remarks", label: "Remarks", placeholder: "Optional note for the history", multiline: true },
        ]}
        onSubmit={(values) => {
          const amount = Number(values.value?.replace(/,/g, ""));
          if (!Number.isFinite(amount) || amount < 0) {
            setError("Enter the value this lead was won for.");
            return;
          }
          won.mutate({ LeadId: leadId, WonValue: amount, Remarks: values.remarks || null });
        }}
      />

      <ComposeSheet
        ref={scheduleRef}
        title="Schedule follow-up"
        submitLabel="Schedule"
        busy={schedule.isPending}
        error={error}
        choices={[
          {
            key: "type",
            label: "Type",
            required: true,
            options: FOLLOWUP_TYPES.map((t) => ({ value: t.value, label: t.label })),
          },
          {
            key: "when",
            label: "When",
            required: true,
            options: WHEN_CHOICES.map((w) => ({ value: w.value, label: w.label })),
          },
        ]}
        fields={[]}
        onSubmit={(_, picked) =>
          schedule.mutate({
            LeadId: leadId,
            Type: picked.type as FollowUpType,
            DueAt: dueFromChoice(picked.when as WhenChoice),
          })
        }
      />

      <ComposeSheet
        ref={completeRef}
        title={followUp ? `Log ${followUpTypeLabel(followUp.Type).toLowerCase()}` : "Log follow-up"}
        submitLabel="Log follow-up"
        busy={complete.isPending}
        error={error}
        choices={[
          ...(callOutcomes.length
            ? [
                {
                  key: "outcome",
                  label: "Outcome",
                  options: callOutcomes.map((o) => ({ value: o.Id, label: o.Value })),
                },
              ]
            : []),
          ...(isCall ? [{ key: "direction", label: "Direction", options: DIRECTIONS }] : []),
          {
            key: "next",
            label: "Next follow-up",
            options: WHEN_CHOICES.map((w) => ({ value: w.value, label: w.label })),
          },
        ]}
        fields={[
          {
            key: "remarks",
            label: "Remarks",
            placeholder: "What was discussed — the next person reads this",
            multiline: true,
            required: true,
          },
          ...(isCall ? [{ key: "minutes", label: "Minutes", placeholder: "0", numeric: true }] : []),
        ]}
        onSubmit={(values, picked) => {
          if (!followUp) return;
          const minutes = Number(values.minutes);
          complete.mutate({
            Id: followUp.Id,
            Remarks: values.remarks ?? "",
            OutcomeId: (picked.outcome as number | undefined) ?? null,
            Direction: isCall ? ((picked.direction as "in" | "out" | undefined) ?? "out") : null,
            Duration: isCall && Number.isFinite(minutes) && minutes > 0 ? minutes : null,
            NextType: picked.next ? "call" : null,
            NextDueAt: picked.next ? dueFromChoice(picked.next as WhenChoice) : null,
          });
        }}
      />

      <ComposeSheet
        ref={skipRef}
        title="Skip this follow-up"
        submitLabel="Skip"
        busy={skip.isPending}
        error={error}
        fields={[
          { key: "remarks", label: "Why", placeholder: "Why it is not happening", multiline: true, required: true },
        ]}
        onSubmit={(values) => {
          if (!followUp) return;
          skip.mutate({ Id: followUp.Id, Remarks: values.remarks ?? "" });
        }}
      />

      <ComposeSheet
        ref={callRef}
        title="Log a call"
        submitLabel="Log call"
        busy={call.isPending}
        error={error}
        choices={[
          { key: "direction", label: "Direction", required: true, options: DIRECTIONS },
          ...(callOutcomes.length
            ? [
                {
                  key: "outcome",
                  label: "Outcome",
                  options: callOutcomes.map((o) => ({ value: o.Id, label: o.Value })),
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
          call.mutate({
            LeadId: leadId,
            Direction: (picked.direction as CallDirection) ?? "out",
            OutcomeId: (picked.outcome as number) ?? null,
            Notes: values.notes || null,
            Duration: Number.isFinite(minutes) && minutes > 0 ? minutes : null,
          });
        }}
      />

      <ActionSheet
        ref={transferPickRef}
        title="Transfer to…"
        actions={transferActions}
        emptyMessage="There is nobody else you can hand this to."
      />
      <ComposeSheet
        ref={transferRef}
        title={transferTo ? `Transfer to ${transferTo.FullName}` : "Transfer"}
        submitLabel="Transfer"
        busy={transfer.isPending}
        error={error}
        choices={[
          {
            key: "reason",
            label: "Reason",
            required: true,
            options: transferReasons.map((r) => ({ value: r.Id, label: r.Value })),
          },
        ]}
        fields={[
          {
            key: "remarks",
            label: "Remarks",
            placeholder: "Anything the next person should know",
            multiline: true,
            required: true,
          },
        ]}
        onSubmit={(values, picked) => {
          if (!transferTo) return;
          transfer.mutate({
            LeadId: leadId,
            ToUserId: transferTo.Id,
            ToBranchId:
              transferTo.BranchId != null && transferTo.BranchId !== lead.BranchId
                ? transferTo.BranchId
                : null,
            ReasonId: picked.reason as number,
            Remarks: values.remarks ?? "",
          });
        }}
      />
    </Screen>
  );
}

/**
 * One write from this screen: clears the sheet's error before it runs, puts
 * the server's own sentence in the open sheet (or a toast) when it fails, and
 * dismisses the sheet and refetches when it succeeds. A failed sheet keeps
 * what was typed (ComposeSheet resets only on dismiss).
 */
function useLeadWrite<T>(
  fn: (params: T) => Promise<unknown>,
  sheet: RefObject<SheetRef | null>,
  fail: string,
  { setError, toast, invalidate }: {
    setError: (message: string | null) => void;
    toast: ReturnType<typeof useToast>;
    invalidate: () => void;
  },
  inline = true,
) {
  return useMutation({
    mutationFn: fn,
    onMutate: () => setError(null),
    onError: (err) => {
      const message = apiErrorMessage(err, fail);
      if (inline) setError(message);
      else toast.error(message);
    },
    onSuccess: () => {
      sheet.current?.dismiss();
      invalidate();
    },
  });
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
  tone,
  last = false,
}: {
  Icon: LucideIcon;
  label: string;
  value: string;
  tone?: ChipTone;
  last?: boolean;
}) {
  const ink = tone && tone !== "neutral" ? tone : undefined;
  return (
    <View style={[styles.fact, !last && styles.factDivider]}>
      <Icon size={16} color={colors.textMuted} />
      <Text variant="caption" color="textMuted" style={styles.factLabel}>
        {label}
      </Text>
      <View style={styles.factValue}>
        <Text variant="body" color={ink} numberOfLines={1} align="right">
          {value}
        </Text>
      </View>
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
  chips: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing[2] },
  quick: { flexDirection: "row", gap: spacing[2] },
  quickButton: { flex: 1 },
  list: {
    paddingHorizontal: SCREEN_PADDING,
    paddingBottom: spacing[20],
    gap: spacing[4],
  },
  banner: { gap: spacing[2] },
  bannerRow: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  grow: { flex: 1 },
  factCard: { paddingHorizontal: spacing[4] },
  fact: { flexDirection: "row", alignItems: "center", gap: spacing[3], paddingVertical: spacing[3] },
  factDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  factLabel: { width: 96 },
  factValue: { flex: 1, alignItems: "flex-end" },
  block: { gap: spacing[2] },
  fieldRow: { gap: spacing[1] },
});
