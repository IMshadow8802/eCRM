import { useMemo, useRef, useState, type RefObject } from "react";
import { Linking, ScrollView, StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import {
  ArrowRightLeft,
  Ban,
  CalendarClock,
  CalendarPlus,
  CalendarX,
  EllipsisVertical,
  History,
  Lock,
  MessageCircle,
  Paperclip,
  Pencil,
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneOutgoing,
  Plus,
  Tag,
  Trophy,
  Undo2,
  UserPlus,
  type LucideIcon,
} from "lucide-react-native";

import { convertLead, fetchLeadDetail, setLeadStatus, transferLead } from "../../api/leadQueries";
import { scheduleFollowUp } from "../../api/followupQueries";
import { fetchCalls, logCall } from "../../api/callQueries";
import { fetchAssignableUsers, fetchUserDirectory } from "../../api/userQueries";
import { apiErrorMessage, RECORD_GONE_MESSAGE, recordGone } from "../../api/errors";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import type { FollowUp, FollowUpType } from "../../types/api";
import { colors, metrics, spacing } from "../../theme";
import {
  ActionSheet,
  AssignSheet,
  Band,
  BandSheet,
  Chip,
  ComposeSheet,
  EmptyState,
  ErrorCard,
  HeaderButton,
  IconButton,
  LogCallSheet,
  SegmentedTabs,
  SkeletonRows,
  Text,
  Timeline,
  useLayout,
  useToast,
  type BarAction,
  type SheetAction,
  type SheetRef,
  type TimelineEntry,
} from "../../ui";
import { activityText } from "../../utils/activityText";
import AttachmentList from "../attachments/AttachmentList";
import { useAccess } from "../auth/useAccess";
import { lookupMap } from "../support/ticketHelpers";
import { relativeTime } from "../tasks/taskHelpers";
import { FollowUpSheets, type FollowUpSheetsHandle } from "./FollowUpSheets";
import { ContactCard, DetailsFacts, FollowUpsTab } from "./LeadDetailParts";
import { FOLLOWUP_TYPES, isActiveLead, leadStatusBadge, nextOpen, rupees } from "./leadHelpers";
import { StatusSheet, type StatusChange } from "./StatusSheet";
import { useLeadRefData } from "./useLeadRefData";

type Tab = "details" | "followups" | "activity";
/** The sheets that can show a server refusal inline. */
type SheetKey = "status" | "schedule" | "call";

const first = (name: string) => name.split(" ")[0];

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

export interface LeadNavigation {
  navigate: <R extends keyof RootStackParamList>(name: R, params: RootStackParamList[R]) => void;
}

export interface LeadDetailBodyProps {
  leadId: number;
  navigation: LeadNavigation;
  onBack?: () => void;
  /** No longer the caller's (reassigned, sent back, a 404): leave the record. Defaults to `onBack`. */
  onGone?: () => void;
  /**
   * Publishes the record's actions (LeadDetailScreen passes the Shell's
   * useActionBar). `inBand` = the rail is up: the actions go in the band (T3).
   * Must be a stable hook.
   */
  useBar: (actions: BarAction[]) => { inBand: boolean };
  /** The detail pane of the T3 two-pane list: Navy 800 band, no back. */
  pane?: boolean;
}

/**
 * Every write here goes through this. A 404 (the lead left the caller while
 * the screen was open) runs `onGone`; any other refusal reaches `onFail` with
 * the server's sentence; success closes `sheet` (ComposeSheet keeps what was typed
 * on a failure) and refetches the lead, the lists and the follow-up queue.
 */
function useLeadWrite<P>(
  leadId: number,
  mutationFn: (params: P) => Promise<unknown>,
  sheet: RefObject<SheetRef | null>,
  onFail: (message: string) => void,
  fallback: string,
  onGone: () => void,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onError: (err) => (recordGone(err) ? onGone() : onFail(apiErrorMessage(err, fallback))),
    onSuccess: () => {
      sheet.current?.dismiss();
      queryClient.invalidateQueries({ queryKey: ["lead", leadId] });
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["followups"] });
      queryClient.invalidateQueries({ queryKey: ["calls", "lead", leadId] });
    },
  });
}

/**
 * The lead record (E 15; T3 as a pane or at the rail). On a phone its actions
 * are the action bar (Call · Message · Log follow-up · Status · Reassign); at
 * the rail they sit in the band and the sheet splits into the 300 facts column
 * and the tabs.
 */
export function LeadDetailBody({ leadId, navigation, onBack, onGone = onBack, useBar, pane = false }: LeadDetailBodyProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const layout = useLayout();
  // Every write here needs the leads edit grant on the server. Courtesy only.
  const can = useAccess("leads");

  const [tab, setTab] = useState<Tab>("followups");
  const [failure, setFailure] = useState<{ on: SheetKey; message: string } | null>(null);
  const [picked, setPicked] = useState<FollowUp | null>(null);

  const menuRef = useRef<SheetRef>(null);
  const rowMenuRef = useRef<SheetRef>(null);
  const statusRef = useRef<SheetRef>(null);
  const scheduleRef = useRef<SheetRef>(null);
  const callRef = useRef<SheetRef>(null);
  const reassignRef = useRef<SheetRef>(null);
  const sendBackRef = useRef<SheetRef>(null);
  const followUpSheets = useRef<FollowUpSheetsHandle>(null);

  const detailQuery = useQuery({ queryKey: ["lead", leadId], queryFn: () => fetchLeadDetail({ LeadId: leadId }) });
  const lead = detailQuery.data?.lead ?? null;
  // The server's per-record answers (fn_RecordActions) on top of the module grant.
  const canEdit = can.edit && lead?.CanEdit === true;
  const canReassign = canEdit && lead?.CanReassign === true;
  // A send back is a reassign: offered only where the server would take one.
  const canSendBack = canReassign && !!lead?.SendBackToId && !!lead?.SendBackToName;
  // A closed lead goes back to an active status only with CanReopen (139, the
  // complaint rule); without it the status sheet does not offer those rows.
  const lockedClosed = !!lead && !isActiveLead(lead.StatusCode) && lead.CanReopen !== true;
  // A follow-up answers for itself (its CanAct, Task 13): one delegated to the
  // caller stays actionable on a lead they cannot edit. Rows without the field
  // follow the lead. The routes still need the leads edit grant.
  const actsOn = (f: FollowUp) => can.edit && (f.CanAct ?? canEdit);
  const ref = useLeadRefData();
  // Per record, so the server can mark who gave it (IsGiver) — only once the sheet opens.
  const [picking, setPicking] = useState(false);
  const { data: assignable = [] } = useQuery({
    queryKey: ["users", "assignable", "leads", leadId],
    queryFn: () => fetchAssignableUsers({ Module: "leads", RecordId: leadId }),
    enabled: picking,
  });
  // Call rows and follow-ups carry only a user id; the directory names them (G18).
  const { data: directory } = useQuery({ queryKey: ["users", "directory"], queryFn: () => fetchUserDirectory() });
  const { data: calls } = useQuery({ queryKey: ["calls", "lead", leadId], queryFn: () => fetchCalls({ LeadId: leadId }) });
  const outcomeNames = useMemo(() => lookupMap(ref.callOutcomes), [ref.callOutcomes]);
  const people = useMemo(() => new Map((directory ?? []).map((u) => [u.Id, u.FullName])), [directory]);

  const inSheet = (on: SheetKey) => (message: string) => setFailure({ on, message });
  const failed = (on: SheetKey) => (failure?.on === on ? failure.message : null);
  /** The lead is no longer the caller's to look at here (Review Focus 4): drop it and leave. */
  const leave = (say: () => void) => {
    for (const r of [statusRef, scheduleRef, callRef, reassignRef, sendBackRef, menuRef]) r.current?.dismiss();
    onGone?.();
    queryClient.removeQueries({ queryKey: ["lead", leadId] });
    void queryClient.invalidateQueries({ queryKey: ["leads"] });
    void queryClient.invalidateQueries({ queryKey: ["followups"] });
    say();
  };
  const gone = () => leave(() => toast.error(RECORD_GONE_MESSAGE));
  const status = useLeadWrite(leadId, setLeadStatus, statusRef, inSheet("status"), "Could not change the status.", gone);
  const won = useLeadWrite(leadId, convertLead, statusRef, inSheet("status"), "Could not mark this lead won.", gone);
  const schedule = useLeadWrite(leadId, scheduleFollowUp, scheduleRef, inSheet("schedule"), "Could not schedule the follow-up.", gone);
  const call = useLeadWrite(leadId, logCall, callRef, inSheet("call"), "Could not log that call.", gone);
  const reassign = useMutation({
    mutationFn: transferLead,
    onError: (err, vars) => {
      if (recordGone(err)) return gone();
      // Send back refused (the giver lost the module, say): the server's
      // sentence, then the refetched lead drops the item (Review Focus 3).
      if (vars.SendBack) sendBackRef.current?.dismiss();
      toast.error(apiErrorMessage(err, "Could not reassign this lead."));
      void queryClient.invalidateQueries({ queryKey: ["lead", leadId] });
    },
    onSuccess: (_r, vars) => {
      const to = vars.SendBack ? lead?.SendBackToName : assignable.find((u) => u.Id === vars.ToUserId)?.FullName;
      const verb = vars.SendBack ? "Sent back" : "Reassigned";
      leave(() => toast.success(to ? `${verb} to ${to}` : verb));
    },
  });

  const followups = detailQuery.data?.followups ?? [];
  const next = nextOpen(followups);
  const mobile = lead?.MobileNo ?? null;

  const openSheet = (sheet: RefObject<SheetRef | null>) => {
    setFailure(null);
    sheet.current?.present();
  };
  const dial = () => {
    if (mobile) Linking.openURL(`tel:${mobile}`).catch(() => toast.error("Can't open the dialer on this device"));
  };
  // G30: WhatsApp when it is installed, else a plain SMS.
  const message = () => {
    if (!mobile) return;
    Linking.openURL(`whatsapp://send?phone=91${mobile}`)
      .catch(() => Linking.openURL(`sms:${mobile}`))
      .catch(() => toast.error("Can't open messaging on this device"));
  };
  // Log follow-up = finish the next open one, or book one when none is open.
  const logFollowUp = () => (next ? followUpSheets.current?.done(next) : openSheet(scheduleRef));
  const changeStatus = () => openSheet(statusRef);
  const startReassign = () => {
    setPicking(true);
    reassignRef.current?.present();
  };
  const edit = () => navigation.navigate("LeadForm", { leadId });

  const barActions: BarAction[] = lead
    ? [
        { key: "call", label: "Call", icon: Phone, onPress: dial, disabled: !mobile },
        { key: "message", label: "Message", icon: MessageCircle, onPress: message, disabled: !mobile },
        ...(canEdit
          ? [
              { key: "log", label: "Log follow-up", icon: Plus, onPress: logFollowUp, main: true },
              { key: "status", label: "Status", icon: Tag, onPress: changeStatus },
            ]
          : []),
        ...(canReassign ? [{ key: "reassign", label: "Reassign", icon: ArrowRightLeft, onPress: startReassign }] : []),
      ]
    : [];
  const { inBand } = useBar(barActions);
  // T3 columns need the expanded width; at medium the rail is up but the sheet stacks.
  const wide = layout.sizeClass === "expanded";

  if (!lead) {
    const code = isAxiosError(detailQuery.error) ? detailQuery.error.response?.status : undefined;
    // 404 = not visible / gone (X404); a 403 is a refusal, not a missing record.
    const forbidden = code === 404 || detailQuery.isSuccess;
    return (
      <>
        <Band variant="record" title="Lead" onBack={onBack} tone={pane ? "raised" : "band"} gutter={pane ? metrics.pane.detailBand : undefined} />
        <BandSheet center={forbidden}>
          {forbidden ? (
            <EmptyState
              module="leads"
              icon={Lock}
              title="Lead not available"
              message="It may have been deleted, or it belongs to someone you cannot see."
            />
          ) : detailQuery.isError ? (
            <ErrorCard
              message="The lead could not be loaded. Check your connection and try again."
              onRetry={() => void detailQuery.refetch()}
            />
          ) : (
            <SkeletonRows rows={4} />
          )}
        </BandSheet>
      </>
    );
  }

  const badge = leadStatusBadge(ref.statuses, lead.StatusCode, lead.StatusId);
  const value = rupees(lead.EstValue);
  const plannedBy = (f: FollowUp) => (f.CreatedBy != null ? (people.get(f.CreatedBy) ?? null) : null);
  const openRowMenu = (f: FollowUp) => {
    setPicked(f);
    rowMenuRef.current?.present();
  };

  // Activity (minus its 'call' rows — the call rows say more), calls, reassignments.
  // Titles stay plain: E has no lead-activity sample, so the complaint's bold
  // verb (E 11 / T2) is not carried over here.
  const timeline: TimelineEntry[] = [
    ...(detailQuery.data?.activity ?? [])
      .filter((a) => (a.Type ?? "").toLowerCase() !== "call")
      .map((a) => {
        const node = ACTIVITY_NODE[(a.Type ?? "").toLowerCase()] ?? { Icon: History, tone: "textSecondary" as const };
        return { key: `a-${a.Id}`, at: a.CreatedAt, title: activityText(a.Summary) ?? a.Type, meta: `${a.UserName ?? "System"} · ${relativeTime(a.CreatedAt)}`, icon: node.Icon, tone: node.tone };
      }),
    ...(calls ?? []).map((c) => ({
      key: `c-${c.Id}`,
      at: c.CalledAt,
      title: c.Notes || (c.Direction === "in" ? "Incoming call" : "Outgoing call"),
      meta: [people.get(c.UserId) ?? "System", c.OutcomeId ? outcomeNames.get(c.OutcomeId) : undefined, c.Duration ? `${c.Duration} min` : undefined, relativeTime(c.CalledAt)]
        .filter(Boolean)
        .join(" · "),
      icon: c.Direction === "in" ? PhoneIncoming : PhoneOutgoing,
      tone: "info" as const,
    })),
    ...(detailQuery.data?.assignments ?? []).map((a) => ({
      key: `t-${a.Id}`,
      at: a.AssignedAt,
      title: `${a.FromUserName ?? "Unassigned"} → ${a.ToUserName ?? "Unassigned"}${a.Remarks ? ` — ${a.Remarks}` : ""}`,
      meta: [a.Reason, a.AssignedByName, relativeTime(a.AssignedAt)].filter(Boolean).join(" · "),
      icon: UserPlus,
      tone: "info" as const,
    })),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .map(({ at: _at, ...entry }) => entry);

  const menuActions: SheetAction[] = [
    { key: "call", label: "Log a call", sublabel: "Goes straight onto the history", icon: PhoneCall, onPress: () => openSheet(callRef) },
    { key: "schedule", label: "Schedule follow-up", icon: CalendarPlus, onPress: () => openSheet(scheduleRef) },
    // Only when the server names who gave it (fn_RecordGiver); the bar is full at five.
    ...(canSendBack
      ? [{ key: "sendback", label: `Send back to ${lead.SendBackToName}`, icon: Undo2, onPress: () => sendBackRef.current?.present() }]
      : []),
    ...(next ? [{ key: "skip", label: "Skip follow-up", sublabel: "It is not happening", icon: CalendarX, onPress: () => followUpSheets.current?.skip(next) }] : []),
    { key: "status", label: "Won or lost", sublabel: "Through the status sheet", icon: Trophy, onPress: changeStatus },
    { key: "files", label: "Files", sublabel: "On the Details tab", icon: Paperclip, onPress: () => setTab("details") },
  ];
  const rowActions: SheetAction[] = picked
    ? [
        { key: "done", label: "Mark done", icon: CalendarClock, onPress: () => followUpSheets.current?.done(picked) },
        { key: "reschedule", label: "Reschedule", icon: CalendarPlus, onPress: () => followUpSheets.current?.reschedule(picked) },
        { key: "skip", label: "Skip", icon: CalendarX, tone: "danger", onPress: () => followUpSheets.current?.skip(picked) },
      ]
    : [];

  const onStatus = (change: StatusChange) =>
    change.kind === "won"
      ? won.mutate({ LeadId: leadId, WonValue: change.WonValue, Remarks: change.Remarks })
      : status.mutate({ LeadId: leadId, StatusId: change.StatusId, LostReasonId: change.LostReasonId });

  const contact = (
    <ContactCard lead={lead} fields={detailQuery.data?.fields ?? []} wide={wide} onCall={dial} onMessage={message} />
  );
  const tabs = (
    <View style={[styles.flex, !wide && styles.tabsGap]}>
      <SegmentedTabs
        value={tab}
        onChange={setTab}
        options={[
          { value: "details", label: "Details" },
          // E counts every follow-up on the lead, open or not.
          { value: "followups", label: "Follow-ups", count: followups.length },
          { value: "activity", label: "Activity" },
        ]}
      />
      {tab === "details" ? (
        // Not in a ScrollView: AttachmentList is a FlatList and scrolls itself.
        <View style={[styles.flex, styles.body]}>
          <DetailsFacts lead={lead} fields={detailQuery.data?.fields ?? []} wide={wide} />
          <AttachmentList entity="lead" entityId={leadId} canManage={canEdit} />
        </View>
      ) : (
        <ScrollView style={styles.flex} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {tab === "followups" ? (
            <FollowUpsTab
              followups={followups}
              next={next}
              plannedBy={plannedBy}
              wide={wide}
              acts={actsOn}
              onOpen={openRowMenu}
              onDone={(f) => followUpSheets.current?.done(f)}
              onReschedule={(f) => followUpSheets.current?.reschedule(f)}
            />
          ) : timeline.length ? (
            <Timeline entries={timeline} />
          ) : (
            <Text variant="meta">Nothing has happened yet.</Text>
          )}
        </ScrollView>
      )}
    </View>
  );


  return (
    <>
      <Band
        variant="record"
        onBack={onBack}
        tone={pane ? "raised" : "band"}
        gutter={pane ? metrics.pane.detailBand : undefined}
        actions={
          <View style={styles.bandActions}>
            {inBand && canEdit ? (
              <>
                {canReassign ? (
                    <HeaderButton label="Reassign" icon={ArrowRightLeft} variant="ghost" on={pane ? "raised" : "band"} onPress={startReassign} />
                ) : null}
                <HeaderButton label="Edit" icon={Pencil} variant="ghost" on={pane ? "raised" : "band"} onPress={edit} />
                <HeaderButton label="Log follow-up" icon={Plus} onPress={logFollowUp} />
              </>
            ) : canEdit ? (
              <IconButton icon={Pencil} accessibilityLabel="Edit lead" onPress={edit} />
            ) : null}
            {canEdit ? (
              <IconButton icon={EllipsisVertical} accessibilityLabel="Lead actions" onPress={() => menuRef.current?.present()} />
            ) : null}
          </View>
        }
      >
        <View style={[styles.titleRow, wide && styles.titleRowWide]}>
          <View style={styles.flex}>
            <Text variant={wide ? "titleXl" : "h1"} color="textOnBrand" numberOfLines={2} accessibilityRole="header">
              {lead.Name}
            </Text>
            {lead.Company || lead.ProductName ? (
              <Text variant="meta" color="onBandMuted" numberOfLines={1}>
                {[lead.Company, lead.ProductName].filter(Boolean).join(" · ")}
              </Text>
            ) : null}
          </View>
          {value ? (
            <View style={styles.value}>
              <Text variant="meta" color="onBandMuted">{wide ? "Estimated value" : "Est. value"}</Text>
              <Text variant={wide ? "statValue" : "h1"} color="textOnBrand" tabular>{value}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.statusRow}>
          <Chip label={lead.StatusName ?? "—"} tone={badge.chip} icon={badge.icon} size="md" />
          {canEdit ? (
            <HeaderButton small label="Change status" variant="ghost" on={pane ? "raised" : "band"} onPress={changeStatus} />
          ) : null}
        </View>
      </Band>

      <BandSheet style={wide ? styles.sheetWide : undefined}>
        {wide ? (
          <View style={[styles.flex, styles.columns]}>
            <View style={styles.factsColumn}>{contact}</View>
            {tabs}
          </View>
        ) : (
          <>
            {contact}
            {tabs}
          </>
        )}
      </BandSheet>

      {can.edit ? (
        <>
          <FollowUpSheets ref={followUpSheets} />
          <ActionSheet ref={rowMenuRef} title="Follow-up" actions={rowActions} />
        </>
      ) : null}
      {canEdit ? (
        <>
          <ActionSheet ref={menuRef} title="Lead actions" actions={menuActions} />
          <StatusSheet
            ref={statusRef}
            lead={lead}
            statuses={lockedClosed ? ref.statuses.filter((s) => !isActiveLead(s.Code)) : ref.statuses}
            lostReasons={ref.lostReasons}
            lostReasonsLoaded={ref.lostReasonsLoaded}
            busy={status.isPending || won.isPending}
            error={failed("status")}
            onSubmit={onStatus}
          />
          <ComposeSheet
            ref={scheduleRef}
            title="Schedule follow-up"
            subtitle={lead.Name}
            badge={{ tone: "butter", icon: CalendarClock }}
            submitLabel="Add follow-up"
            busy={schedule.isPending}
            error={failed("schedule")}
            choices={[{ key: "type", label: "Type", required: true, options: FOLLOWUP_TYPES }]}
            when={{ label: "When", required: true }}
            fields={[]}
            // `due` is never null here: the when row is required.
            onSubmit={(_, p, due) => schedule.mutate({ LeadId: leadId, Type: p.type as FollowUpType, DueAt: due! })}
          />
          <LogCallSheet
            ref={callRef}
            subtitle={[lead.Name, lead.MobileNo].filter(Boolean).join(" · ")}
            outcomes={ref.callOutcomes}
            busy={call.isPending}
            error={failed("call")}
            onSubmit={(v) =>
              call.mutate({ LeadId: leadId, Direction: v.direction, OutcomeId: v.outcomeId, Notes: v.notes, Duration: v.minutes || null })
            }
          />
          {canReassign ? (
            <AssignSheet
              ref={reassignRef}
              testID="reassign"
              title="Reassign lead"
              subtitle={`${lead.Name} · ${lead.OwnerName ? `now with ${lead.OwnerName}` : "Unassigned"}`}
              badge={{ tone: "indigo", icon: ArrowRightLeft }}
              pickLabel="Reassign to"
              searchable
              awayLabel="Away today"
              giverLabel="Gave it to you"
              people={assignable
                .filter((u) => u.Id !== lead.OwnerId)
                .map((u) => ({
                  Id: u.Id,
                  FullName: u.FullName,
                  note: [u.JobTitle, u.BranchName].filter(Boolean).join(" · ") || undefined,
                  group: u.GroupRank,
                  away: u.AwayToday === true,
                  giver: u.IsGiver === true,
                }))}
              reasons={ref.transferReasons}
              remarksPlaceholder={(name) => (name ? `Tell ${first(name)} where it stands` : "Anything the next person should know")}
              remarksError="Remarks are required to reassign."
              submitLabel={(name) => (name ? `Reassign to ${first(name)}` : "Reassign")}
              emptyMessage="Nobody can take this. Ask a manager."
              busy={reassign.isPending}
              onSubmit={({ userId, reasonId, remarks }) =>
                reassign.mutate({
                  LeadId: leadId,
                  ToUserId: userId,
                  // Never inferred from the new person's office: the server refuses a
                  // non-wide caller that sends one. ponytail: no office picker yet.
                  ToBranchId: null,
                  ReasonId: reasonId,
                  Remarks: remarks,
                })
              }
            />
          ) : null}
          {canSendBack ? (
            <ComposeSheet
              ref={sendBackRef}
              title={lead.SendBackToName ? `Send back to ${lead.SendBackToName}` : "Send back"}
              subtitle={lead.Name}
              badge={{ tone: "teal", icon: Undo2 }}
              submitLabel={lead.SendBackToName ? `Send back to ${first(lead.SendBackToName)}` : "Send back"}
              busy={reassign.isPending}
              fields={[
                { key: "sendback", label: "Remarks", placeholder: "Why it goes back — they get a notification", multiline: true, required: true },
              ]}
              onSubmit={(values) => {
                if (!lead.SendBackToId) return;
                // No ReasonId: the server stamps its own "Sent back" reason.
                reassign.mutate({ LeadId: leadId, ToUserId: lead.SendBackToId, ToBranchId: null, Remarks: values.sendback!, SendBack: true });
              }}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  bandActions: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  titleRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing[3] },
  titleRowWide: { gap: spacing[4] },
  value: { alignItems: "flex-end" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: spacing[2], marginTop: spacing[3] },
  tabsGap: { marginTop: spacing[3] },
  body: { paddingTop: spacing[3], paddingBottom: spacing[6] },
  sheetWide: { paddingTop: spacing[5], paddingHorizontal: metrics.pane.detailSheet },
  columns: { flexDirection: "row", gap: spacing[4] },
  factsColumn: { width: metrics.factsColumn },
});
