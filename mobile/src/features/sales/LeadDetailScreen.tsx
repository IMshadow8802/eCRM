import { useMemo, useRef, useState, type RefObject } from "react";
import { Linking, ScrollView, StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import {
  ArrowRightLeft,
  Ban,
  CalendarClock,
  CalendarPlus,
  CircleCheck,
  CircleDot,
  EllipsisVertical,
  History,
  Lock,
  Pencil,
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneOutgoing,
  Plus,
  Star,
  Trophy,
  User,
  UserPlus,
  type LucideIcon,
} from "lucide-react-native";
import type { StackScreenProps } from "@react-navigation/stack";

import { convertLead, fetchLeadDetail, setLeadStatus, transferLead } from "../../api/leadQueries";
import { completeFollowUp, scheduleFollowUp, skipFollowUp } from "../../api/followupQueries";
import { fetchCalls, logCall, type CallDirection } from "../../api/callQueries";
import { fetchUserDirectory } from "../../api/userQueries";
import { apiErrorMessage } from "../../api/errors";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import type { AssignableUser, FollowUp, FollowUpType, Lookup } from "../../types/api";
import { colors, spacing, SCREEN_PADDING } from "../../theme";
import {
  ActionSheet,
  Button,
  Chip,
  ComposeSheet,
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
import { useAccess } from "../auth/useAccess";
import { lookupMap } from "../support/ticketHelpers";
import { relativeTime } from "../tasks/taskHelpers";
import { FollowUpsTab, LeadDetailsTab } from "./LeadDetailParts";
import {
  dayLabel,
  dueFromChoice,
  followUpTypeLabel,
  FOLLOWUP_TYPES,
  isActiveLead,
  leadTone,
  nextOpen,
  WHEN_CHOICES,
  type WhenChoice,
} from "./leadHelpers";
import { useLeadRefData } from "./useLeadRefData";

type Props = StackScreenProps<RootStackParamList, "LeadDetail">;
type Tab = "details" | "followups" | "files" | "history";
/** The sheets that can show a server refusal inline. */
type SheetKey = "lost" | "won" | "schedule" | "complete" | "skip" | "call" | "transfer";

const DIRECTIONS = [
  { value: "out", label: "Outgoing" },
  { value: "in", label: "Incoming" },
];
const WHEN_OPTIONS = WHEN_CHOICES.map((w) => ({ value: w.value, label: w.label }));
const NO_LOST_REASONS = "No lost reasons are set up. Add them on the web first.";
const NO_TRANSFER_REASONS = "No transfer reasons are set up. Add them on the web first.";
/** Whole minutes: completeFollowUp's positiveInt drops a fraction, so both sheets round. */
const wholeMinutes = (text: string | undefined): number | null => {
  const minutes = Math.round(Number(text));
  return minutes > 0 ? minutes : null;
};

/** Timeline node per tblLeadActivity.Type; unmapped types still get a node. */
const ACTIVITY_NODE: Record<string, { Icon: LucideIcon; tone: keyof typeof colors }> = {
  created: { Icon: Plus, tone: "success" },
  updated: { Icon: Pencil, tone: "textSecondary" },
  status: { Icon: ArrowRightLeft, tone: "primary" },
  converted: { Icon: Trophy, tone: "success" },
  lost: { Icon: Ban, tone: "danger" },
  assigned: { Icon: UserPlus, tone: "info" },
  followup: { Icon: CalendarClock, tone: "warning" },
};

/**
 * Every write on this screen goes through here. A refusal reaches `onFail`
 * with the server's own sentence; success closes `sheet` (ComposeSheet only
 * clears on dismiss, so a refused sheet keeps what was typed) and refetches
 * the lead, the leads list and the follow-up queue so going back is fresh.
 */
function useLeadWrite<P>(
  leadId: number,
  mutationFn: (params: P) => Promise<unknown>,
  sheet: RefObject<SheetRef | null> | null,
  onFail: (message: string) => void,
  fallback: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onError: (err) => onFail(apiErrorMessage(err, fallback)),
    onSuccess: () => {
      sheet?.current?.dismiss();
      queryClient.invalidateQueries({ queryKey: ["lead", leadId] });
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["followups"] });
      queryClient.invalidateQueries({ queryKey: ["calls", "lead", leadId] });
    },
  });
}

export default function LeadDetailScreen({ route, navigation }: Props) {
  const { leadId } = route.params;
  const toast = useToast();
  // Every write here needs the leads edit grant on the server (leadRoutes,
  // followupRoutes; callController asserts write on the lead). Courtesy only.
  const can = useAccess("leads");

  const [tab, setTab] = useState<Tab>("details");
  const [failure, setFailure] = useState<{ on: SheetKey; message: string } | null>(null);
  // Held between a pick and the sheet that finishes it.
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

  const { statuses, lostReasons, transferReasons, callOutcomes, users, lostReasonsLoaded, transferReasonsLoaded } =
    useLeadRefData();
  // tblCall rows carry only a UserId; the directory turns it into a name.
  const { data: directory } = useQuery({
    queryKey: ["users", "directory"],
    queryFn: () => fetchUserDirectory(),
  });
  const { data: calls } = useQuery({
    queryKey: ["calls", "lead", leadId],
    queryFn: () => fetchCalls({ LeadId: leadId }),
  });
  const outcomeNames = useMemo(() => lookupMap(callOutcomes), [callOutcomes]);
  const people = useMemo(() => new Map((directory ?? []).map((u) => [u.Id, u.FullName])), [directory]);

  const inSheet = (on: SheetKey) => (message: string) => setFailure({ on, message });
  const failed = (on: SheetKey) => (failure?.on === on ? failure.message : null);

  // A direct pick has no sheet to draw on, so its refusal is a toast.
  const status = useLeadWrite(leadId, setLeadStatus, null, toast.error, "Could not change the status.");
  const lost = useLeadWrite(leadId, setLeadStatus, lostRef, inSheet("lost"), "Could not mark this lead lost.");
  const won = useLeadWrite(leadId, convertLead, wonRef, inSheet("won"), "Could not mark this lead won.");
  const schedule = useLeadWrite(leadId, scheduleFollowUp, scheduleRef, inSheet("schedule"), "Could not schedule the follow-up.");
  const complete = useLeadWrite(leadId, completeFollowUp, completeRef, inSheet("complete"), "Could not log the follow-up.");
  const skip = useLeadWrite(leadId, skipFollowUp, skipRef, inSheet("skip"), "Could not skip the follow-up.");
  const call = useLeadWrite(leadId, logCall, callRef, inSheet("call"), "Could not log that call.");
  const transfer = useLeadWrite(leadId, transferLead, transferRef, inSheet("transfer"), "Could not transfer this lead.");

  // One gate for loading vs. the two ways this can fail (see ComplaintDetailScreen).
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
              detailQuery.isError ? "The lead could not be loaded. Check your connection and try again." : undefined
            }
          />
        )}
      </Screen>
    );
  }

  const followups = detailQuery.data?.followups ?? [];
  const activity = detailQuery.data?.activity ?? [];
  const assignments = detailQuery.data?.assignments ?? [];
  const pendingFollowUp = nextOpen(followups);
  const next = isActiveLead(lead.StatusCode) ? dayLabel(lead.NextFollowupDate) : null;

  const openSheet = (ref: RefObject<SheetRef | null>) => {
    setFailure(null);
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

  // Activity (minus its 'call' rows — the call rows say more), calls, transfers.
  const timeline: TimelineEntry[] = [
    ...activity
      .filter((a) => (a.Type ?? "").toLowerCase() !== "call")
      .map((a) => {
        const node = ACTIVITY_NODE[(a.Type ?? "").toLowerCase()] ?? { Icon: History, tone: "textSecondary" as const };
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
        people.get(c.UserId) ?? "System",
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
      title: `${a.FromUserName ?? "Unassigned"} → ${a.ToUserName ?? "Unassigned"}${a.Remarks ? ` — ${a.Remarks}` : ""}`,
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

  // Won and Lost need more than a tap; `converted` never goes to setLeadStatus.
  // Status logic keys on Code; the Won/Lost sheets take their titles from those rows.
  const wonStatus = statuses.find((s) => s.Code === "converted");
  const lostStatus = statuses.find((s) => s.Code === "lost");
  const pickStatus = (s: Lookup) => {
    if (s.Code === "converted" || s.Code === "lost") {
      openSheet(s.Code === "converted" ? wonRef : lostRef);
    } else {
      status.mutate({ LeadId: leadId, StatusId: s.Id });
    }
  };

  const statusActions: SheetAction[] = statuses
    .filter((s) => s.Id !== lead.StatusId)
    .map((s) => ({
      key: String(s.Id),
      label: s.Value,
      sublabel: s.Code === "converted" ? "Won — asks for the value" : s.Code === "lost" ? "Asks for a reason" : undefined,
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

  const menuActions: SheetAction[] = [
    {
      key: "status",
      label: "Change status",
      sublabel: lead.StatusName ?? undefined,
      icon: ArrowRightLeft,
      onPress: () => statusRef.current?.present(),
    },
    { key: "schedule", label: "Schedule follow-up", icon: CalendarPlus, onPress: () => openSheet(scheduleRef) },
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
    { key: "edit", label: "Edit lead", icon: Pencil, onPress: () => navigation.navigate("LeadForm", { leadId }) },
  ];

  const isCall = followUp?.Type === "call";

  return (
    <Screen>
      <ScreenHeader
        title={lead.Name}
        subtitle={[lead.Company, lead.StatusName].filter(Boolean).join(" · ")}
        tint="success"
        onBack={navigation.goBack}
        // Every menu entry needs edit; a view-only role gets no ⋮.
        actions={
          can.edit ? [{ icon: EllipsisVertical, label: "Lead actions", onPress: () => menuRef.current?.present() }] : []
        }
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

        <View style={styles.buttons}>
          {lead.MobileNo ? (
            <Button
              title="Call"
              icon={Phone}
              variant="secondary"
              size="sm"
              onPress={() =>
                Linking.openURL(`tel:${lead.MobileNo}`).catch(() =>
                  toast.error("Can't open the dialer on this device"),
                )
              }
              style={styles.grow}
            />
          ) : null}
          {can.edit ? (
            pendingFollowUp ? (
              <Button
                title="Log follow-up"
                icon={CircleCheck}
                size="sm"
                onPress={() => startComplete(pendingFollowUp)}
                style={styles.grow}
              />
            ) : (
              <Button
                title="Schedule"
                icon={CalendarPlus}
                size="sm"
                onPress={() => openSheet(scheduleRef)}
                style={styles.grow}
              />
            )
          ) : null}
        </View>

        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "details", label: "Details" },
            { value: "followups", label: "Follow-ups", count: followups.filter((f) => f.Status === "open").length },
            { value: "files", label: "Files" },
            { value: "history", label: "History" },
          ]}
        />
      </View>

      {tab === "details" ? <LeadDetailsTab lead={lead} fields={detailQuery.data?.fields ?? []} /> : null}

      {tab === "followups" ? (
        <FollowUpsTab
          followups={followups}
          onLog={can.edit ? startComplete : undefined}
          onSkip={can.edit ? startSkip : undefined}
        />
      ) : null}

      {tab === "files" ? <AttachmentList entity="lead" entityId={leadId} canManage={can.edit} /> : null}

      {tab === "history" ? (
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {timeline.length ? (
            <Timeline entries={timeline} />
          ) : (
            <Text variant="secondary">Nothing has happened yet.</Text>
          )}
        </ScrollView>
      ) : null}

      {can.edit ? (
        <>
          <ActionSheet ref={menuRef} title="Lead actions" actions={menuActions} />

          <ActionSheet
            ref={statusRef}
            title="Change status"
            actions={statusActions}
            emptyMessage="No other statuses are configured. Add them on the web first."
          />

          <ComposeSheet
            ref={lostRef}
            title={`Mark as ${lostStatus?.Value ?? "lost"}`}
            submitLabel="Mark lost"
            busy={lost.isPending}
            error={failed("lost") ?? (lostReasonsLoaded && !lostReasons.length ? NO_LOST_REASONS : null)}
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
              if (!lostStatus) return;
              lost.mutate({ LeadId: leadId, StatusId: lostStatus.Id, LostReasonId: picked.reason as number });
            }}
          />

          <ComposeSheet
            ref={wonRef}
            title={`Mark as ${wonStatus?.Value ?? "won"}`}
            submitLabel="Mark won"
            busy={won.isPending}
            error={failed("won")}
            fields={[
              { key: "value", label: "Won value (₹)", placeholder: "e.g. 50,000", numeric: true, required: true },
              { key: "remarks", label: "Remarks", placeholder: "Optional note for the history", multiline: true },
            ]}
            onSubmit={(values) => {
              const amount = Number((values.value ?? "").replace(/,/g, ""));
              if (!Number.isFinite(amount) || amount < 0) {
                setFailure({ on: "won", message: "Enter the value this lead was won for." });
                return;
              }
              won.mutate({ LeadId: leadId, WonValue: amount, Remarks: values.remarks || null });
            }}
          />

          <ComposeSheet
            ref={scheduleRef}
            title="Schedule follow-up"
            submitLabel="Add follow-up"
            busy={schedule.isPending}
            error={failed("schedule")}
            choices={[
              { key: "type", label: "Type", required: true, options: FOLLOWUP_TYPES },
              { key: "when", label: "When", required: true, options: WHEN_OPTIONS },
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
            title={`Log the ${followUpTypeLabel(followUp?.Type).toLowerCase()}`}
            submitLabel="Mark done"
            busy={complete.isPending}
            error={failed("complete")}
            choices={[
              ...(callOutcomes.length
                ? [{ key: "outcome", label: "Outcome", options: callOutcomes.map((o) => ({ value: o.Id, label: o.Value })) }]
                : []),
              ...(isCall ? [{ key: "direction", label: "Direction", options: DIRECTIONS }] : []),
              { key: "next", label: "Next follow-up", options: WHEN_OPTIONS },
            ]}
            fields={[
              {
                key: "remarks",
                label: "Remarks",
                placeholder: "What was discussed — the next person reads this",
                multiline: true,
                required: true,
              },
              ...(isCall ? [{ key: "minutes", label: "Minutes", placeholder: "Call minutes", numeric: true }] : []),
            ]}
            onSubmit={(values, picked) => {
              if (!followUp) return;
              complete.mutate({
                Id: followUp.Id,
                Remarks: values.remarks ?? "",
                OutcomeId: (picked.outcome as number | undefined) ?? null,
                Direction: isCall ? ((picked.direction as CallDirection | undefined) ?? "out") : null,
                Duration: isCall ? wholeMinutes(values.minutes) : null,
                // ponytail: the next step is always a call, as the web's default; no type picker.
                NextType: picked.next ? "call" : null,
                NextDueAt: picked.next ? dueFromChoice(picked.next as WhenChoice) : null,
              });
            }}
          />

          <ComposeSheet
            ref={skipRef}
            title="Skip this follow-up"
            submitLabel="Skip follow-up"
            busy={skip.isPending}
            error={failed("skip")}
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
            error={failed("call")}
            choices={[
              { key: "direction", label: "Direction", required: true, options: DIRECTIONS },
              ...(callOutcomes.length
                ? [{ key: "outcome", label: "Outcome", options: callOutcomes.map((o) => ({ value: o.Id, label: o.Value })) }]
                : []),
            ]}
            fields={[
              { key: "notes", label: "Notes", placeholder: "What was said", multiline: true },
              { key: "minutes", label: "Minutes", placeholder: "0", numeric: true },
            ]}
            onSubmit={(values, picked) => {
              call.mutate({
                LeadId: leadId,
                Direction: picked.direction as CallDirection,
                OutcomeId: (picked.outcome as number | undefined) ?? null,
                Notes: values.notes || null,
                Duration: wholeMinutes(values.minutes),
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
            error={failed("transfer") ?? (transferReasonsLoaded && !transferReasons.length ? NO_TRANSFER_REASONS : null)}
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
                // Never inferred from the new owner's office: assertCanAssign
                // 403s a non-wide caller that sends one, and a wide caller
                // would silently move the lead. ponytail: no office picker yet.
                ToBranchId: null,
                ReasonId: picked.reason as number,
                Remarks: values.remarks ?? "",
              });
            }}
          />
        </>
      ) : null}
    </Screen>
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
  buttons: { flexDirection: "row", gap: spacing[2] },
  grow: { flex: 1 },
  list: { paddingHorizontal: SCREEN_PADDING, paddingBottom: spacing[20], gap: spacing[4] },
});
