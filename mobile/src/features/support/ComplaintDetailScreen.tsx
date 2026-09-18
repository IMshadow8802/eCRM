import { useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import {
  ArrowRightLeft,
  ArrowUpRight,
  Ban,
  Building2,
  CircleCheck,
  CircleCheckBig,
  CircleDot,
  CirclePause,
  Clock,
  EllipsisVertical,
  Flag,
  History,
  Link2,
  Lock,
  MessageSquare,
  Package,
  Pencil,
  PhoneCall,
  PhoneIncoming,
  PhoneOutgoing,
  Plus,
  RotateCcw,
  Tag,
  Trash2,
  User,
  UserPlus,
  type LucideIcon,
} from "lucide-react-native";
import type { StackScreenProps } from "@react-navigation/stack";

import {
  deleteTicket,
  escalateTicket,
  fetchEscalationTargets,
  fetchTicketDetail,
  setTicketStatus,
  transferTicket,
} from "../../api/ticketQueries";
import { fetchCalls, logCall, type CallDirection } from "../../api/callQueries";
import { fetchUserDirectory } from "../../api/userQueries";
import { apiErrorMessage } from "../../api/errors";
import type { RootStackParamList } from "../../navigation/RootNavigator";
import useAuthStore from "../../stores/useAuthStore";
import type {
  AssignableUser,
  CustomFieldValue,
  EscalationTarget,
  Lookup,
  TicketStatusCode,
} from "../../types/api";
import { colors, spacing, SCREEN_PADDING } from "../../theme";
import {
  ActionSheet,
  Card,
  Chip,
  ComposeSheet,
  Dialog,
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
import { relativeTime } from "../tasks/taskHelpers";
import {
  asStatusCode,
  dueLabel,
  isActive,
  isTerminal,
  lifecycleOf,
  lookupMap,
  priorityTone,
  statusTone,
} from "./ticketHelpers";
import { useTicketRefData } from "./useTicketRefData";

type Props = StackScreenProps<RootStackParamList, "ComplaintDetail">;
type Tab = "details" | "files" | "history";

/** What a move into `target` needs before the SP will take it (spec §2). */
interface PendingMove {
  target: Lookup;
  reopen: boolean;
  needsResolution: boolean;
  needsRemarks: boolean;
}

const STATUS_ICON: Record<TicketStatusCode, LucideIcon> = {
  open: CircleDot,
  onhold: CirclePause,
  resolved: CircleCheck,
  closed: CircleCheckBig,
  rejected: Ban,
};

const STATUS_HINT: Record<TicketStatusCode, string | undefined> = {
  open: undefined,
  onhold: "Waiting on the customer or on parts",
  resolved: "Fixed — needs a resolution and remarks",
  closed: "Customer confirmed",
  rejected: "Closed without a fix — remarks required",
};

/**
 * Timeline node per tblTicketActivity.Type — the vocabulary the SPs write
 * since 086. Anything unmapped still gets a node rather than being dropped, so
 * a type added later shows up without a release here.
 */
const ACTIVITY_NODE: Record<string, { Icon: LucideIcon; tone: keyof typeof colors }> = {
  created: { Icon: Plus, tone: "success" },
  updated: { Icon: Pencil, tone: "textSecondary" },
  status: { Icon: ArrowRightLeft, tone: "primary" },
  resolved: { Icon: CircleCheck, tone: "success" },
  closed: { Icon: CircleCheckBig, tone: "success" },
  rejected: { Icon: Ban, tone: "danger" },
  reopened: { Icon: RotateCcw, tone: "warning" },
  assigned: { Icon: UserPlus, tone: "info" },
  escalated: { Icon: ArrowUpRight, tone: "danger" },
};

export default function ComplaintDetailScreen({ route, navigation }: Props) {
  const { ticketId } = route.params;
  const queryClient = useQueryClient();
  const toast = useToast();
  const userId = useAuthStore((s) => s.UserId);

  const [tab, setTab] = useState<Tab>("details");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  // Held between the first sheet (pick) and the second (details) of each flow.
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [transferTo, setTransferTo] = useState<AssignableUser | null>(null);
  const [escalateTo, setEscalateTo] = useState<EscalationTarget | null>(null);

  const menuRef = useRef<SheetRef>(null);
  const statusRef = useRef<SheetRef>(null);
  const moveRef = useRef<SheetRef>(null);
  const transferPickRef = useRef<SheetRef>(null);
  const transferRef = useRef<SheetRef>(null);
  const escalatePickRef = useRef<SheetRef>(null);
  const escalateRef = useRef<SheetRef>(null);
  const callRef = useRef<SheetRef>(null);

  const detailQuery = useQuery({
    queryKey: ["ticket", ticketId],
    queryFn: () => fetchTicketDetail({ TicketId: ticketId }),
  });
  const ticket = detailQuery.data?.ticket;

  // Pickers only — every name shown on this screen is on the row itself.
  const { statuses, resolutions, transferReasons, callOutcomes, users } =
    useTicketRefData();

  // tblCall rows carry only a UserId; the directory turns it into a name.
  // Activity rows carry UserName since 086 and need no map.
  const { data: directory } = useQuery({
    queryKey: ["users", "directory"],
    queryFn: () => fetchUserDirectory(),
  });
  // sp_LogCall's activity row only says "Outbound call logged" — the notes and
  // outcome live on tblCall. Fetching them is what makes a logged call
  // readable rather than just countable.
  const { data: calls } = useQuery({
    queryKey: ["calls", "ticket", ticketId],
    queryFn: () => fetchCalls({ TicketId: ticketId }),
  });

  // The chain above whoever is WORKING it — the assignee, else me. Only while
  // the complaint can still be escalated; the SP refuses on a terminal one.
  const forUserId = ticket?.AssignedTo ?? userId;
  const { data: seniors } = useQuery({
    queryKey: ["escalation-targets", forUserId],
    queryFn: () => fetchEscalationTargets(forUserId),
    enabled: !!ticket && isActive(lifecycleOf(ticket)),
  });

  const outcomeNames = useMemo(() => lookupMap(callOutcomes), [callOutcomes]);
  const people = useMemo(
    () => new Map((directory ?? []).map((u) => [u.Id, u.FullName])),
    [directory],
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["ticket", ticketId] });
    queryClient.invalidateQueries({ queryKey: ["tickets"] });
  };

  /**
   * One mutation for every status move. Failures surface through the toast,
   * not an inline line: the direct path (open ↔ on hold) has no sheet to draw
   * on, and on the sheet path the sheet stays OPEN with what was typed. The
   * SP's own words — "Reopening requires a manager", "Resolution is required"
   * — arrive via apiErrorMessage and are the whole explanation.
   */
  const move = useMutation({
    mutationFn: setTicketStatus,
    onError: (err) =>
      toast.error(apiErrorMessage(err, "Could not change the status.")),
    onSuccess: () => {
      moveRef.current?.dismiss();
      setPending(null);
      invalidate();
    },
  });

  const transfer = useMutation({
    mutationFn: transferTicket,
    onError: (err) =>
      toast.error(apiErrorMessage(err, "Could not transfer this complaint.")),
    onSuccess: () => {
      transferRef.current?.dismiss();
      setTransferTo(null);
      invalidate();
    },
  });

  const escalate = useMutation({
    mutationFn: escalateTicket,
    onError: (err) =>
      toast.error(apiErrorMessage(err, "Could not escalate this complaint.")),
    onSuccess: () => {
      escalateRef.current?.dismiss();
      setEscalateTo(null);
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
    onError: (err) =>
      toast.error(apiErrorMessage(err, "Could not delete this complaint.")),
    onSuccess: () => {
      setConfirmingDelete(false);
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      navigation.goBack();
    },
  });

  // The header renders here too — a loading screen with no back button is a
  // dead end (see TaskDetailScreen).
  //
  // One gate decides loading vs. the two ways this can fail — never two
  // branches making the same call. `fetchTicketDetail` REJECTS on a 404
  // (rather than resolving with a null ticket — see its JSDoc), so a 403/404
  // means the row does not exist or this caller cannot see it: no retry can
  // fix that, and telling them to check their connection sends them to call
  // support about a network that was never broken. Anything else — a
  // timeout, a 500, no route to host — is a genuine transport/server fault,
  // where retry can actually help. `detailQuery.isSuccess && !ticket` is a
  // belt-and-braces fallback for the same "cannot see it" outcome, since
  // `TicketDetail.ticket` is still typed `Ticket | null`.
  if (detailQuery.isLoading || detailQuery.isError || !ticket) {
    const status = isAxiosError(detailQuery.error)
      ? detailQuery.error.response?.status
      : undefined;
    const forbidden =
      status === 403 || status === 404 || (detailQuery.isSuccess && !ticket);

    return (
      <Screen>
        <ScreenHeader title="Complaint" onBack={navigation.goBack} />
        {forbidden ? (
          <View style={styles.centre}>
            <Lock size={30} color={colors.textMuted} />
            <Text variant="h3">Complaint not available</Text>
            <Text variant="secondary" align="center">
              It may have been deleted, or it belongs to a branch you cannot see.
            </Text>
          </View>
        ) : (
          <ScreenLoader
            failed={detailQuery.isError}
            onRetry={detailQuery.refetch}
            message={
              detailQuery.isError
                ? "The complaint could not be loaded. Check your connection and try again."
                : undefined
            }
          />
        )}
      </Screen>
    );
  }

  const code = lifecycleOf(ticket);
  const active = isActive(code);
  const due = dueLabel(ticket);
  const fields = detailQuery.data?.fields ?? [];
  const activity = detailQuery.data?.activity ?? [];
  const linkedLead = detailQuery.data?.linkedLead ?? null;

  const who = (id: number | null) => people.get(id ?? -1) ?? "System";

  /**
   * The history is two sources woven together.
   *
   * `tblTicketActivity` records that a call happened; `tblCall` records what
   * was said. Showing both would list every call twice, so the activity rows
   * of type 'call' are dropped and the richer call rows take their place.
   */
  const timeline: TimelineEntry[] = [
    ...activity
      .filter((entry) => (entry.Type ?? "").toLowerCase() !== "call")
      .map((entry) => {
        const node = ACTIVITY_NODE[(entry.Type ?? "").toLowerCase()] ?? {
          Icon: History,
          tone: "textSecondary" as const,
        };
        return {
          key: `a-${entry.Id}`,
          at: entry.CreatedAt,
          title: entry.Summary ?? entry.Type,
          meta: `${entry.UserName ?? "System"} · ${relativeTime(entry.CreatedAt)}`,
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

  /**
   * What the SP will demand for this move (spec §2), decided here so the sheet
   * asks for exactly that and nothing more:
   *
   *   active → active              free — fires straight away, no sheet
   *   → resolved                   resolution + remarks
   *   not-resolved → closed        resolution + remarks (sp_SetTicketStatus:
   *                                 @ToCode='closed' AND @FromCode<>'resolved')
   *   resolved → closed            remarks optional
   *   → rejected                   remarks
   *   terminal → active  (reopen)  remarks; manager-only — the SERVER decides
   *
   * The client never pre-empts the reopen gate. A Self agent gets the SP's
   * 403 in a toast, which is the truthful answer, not a hidden row.
   */
  const pickStatus = (target: Lookup) => {
    const to = asStatusCode(target.Code);
    if (active && isActive(to)) {
      move.mutate({ TicketId: ticketId, StatusId: target.Id });
      return;
    }
    const reopen = isTerminal(code) && isActive(to);
    const straightToClosed = to === "closed" && code !== "resolved";
    setPending({
      target,
      reopen,
      needsResolution: to === "resolved" || straightToClosed,
      needsRemarks:
        reopen || to === "resolved" || to === "rejected" || straightToClosed,
    });
    moveRef.current?.present();
  };

  const statusActions: SheetAction[] = statuses
    .filter((s) => s.Id !== ticket.StatusId)
    .map((s) => {
      const to = asStatusCode(s.Code);
      const reopen = isTerminal(code) && isActive(to);
      return {
        key: String(s.Id),
        label: s.Value,
        sublabel: reopen
          ? "Reopens the complaint — remarks required"
          : STATUS_HINT[to],
        icon: reopen ? RotateCcw : STATUS_ICON[to],
        tone: to === "rejected" ? "danger" : undefined,
        onPress: () => pickStatus(s),
      };
    });

  const transferActions: SheetAction[] = users
    .filter((u) => u.Id !== ticket.AssignedTo)
    .map((u) => ({
      key: String(u.Id),
      label: u.FullName,
      sublabel: [u.JobTitle, u.BranchName].filter(Boolean).join(" · ") || undefined,
      icon: User,
      onPress: () => {
        setTransferTo(u);
        transferRef.current?.present();
      },
    }));

  const escalateActions: SheetAction[] = (seniors ?? []).map((s) => ({
    key: String(s.Id),
    label: s.FullName,
    sublabel: [s.Depth === 1 ? "Direct manager" : `${s.Depth} levels up`, s.JobTitle]
      .filter(Boolean)
      .join(" · "),
    icon: ArrowUpRight,
    selected: s.Id === ticket.EscalatedTo,
    onPress: () => {
      setEscalateTo(s);
      escalateRef.current?.present();
    },
  }));

  // Built as a literal with a conditional spread, never `.push()` — see
  // CLAUDE.md §9.5 on `react-hooks/refs`.
  const escalateEntry: SheetAction[] = active
    ? [
        {
          key: "escalate",
          label: "Escalate",
          sublabel: ticket.EscalatedToName
            ? `Escalated to ${ticket.EscalatedToName}`
            : "Flag a senior — it stays with the assignee",
          icon: ArrowUpRight,
          onPress: () => escalatePickRef.current?.present(),
        },
      ]
    : [];

  const menuActions: SheetAction[] = [
    {
      key: "status",
      label: "Change status",
      sublabel: ticket.StatusName ?? undefined,
      icon: ArrowRightLeft,
      onPress: () => statusRef.current?.present(),
    },
    {
      key: "transfer",
      label: "Transfer",
      sublabel: ticket.AssigneeName ? `Now with ${ticket.AssigneeName}` : "Unassigned",
      icon: UserPlus,
      onPress: () => transferPickRef.current?.present(),
    },
    ...escalateEntry,
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

  const customerSub = [
    ticket.CustomerMobile,
    ticket.PreviousTickets ? `${ticket.PreviousTickets} previous` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Screen>
      <ScreenHeader
        title={ticket.Subject}
        subtitle={`${ticket.TicketNo} · ${ticket.StatusName ?? code}`}
        tint="danger"
        onBack={navigation.goBack}
        actions={[
          {
            icon: EllipsisVertical,
            label: "Complaint actions",
            onPress: () => menuRef.current?.present(),
          },
        ]}
      />

      <View style={styles.summary}>
        {/* The chips are the one line worth reading from across a room: where
            it stands, how urgent, whether the clock has run out, who else is
            watching. Same four the list card shows, so nothing changes shape
            between the two screens. */}
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
            <Chip
              label={`Escalated to ${ticket.EscalatedToName ?? "a senior"}`}
              icon={ArrowUpRight}
              tone="primary"
              maxWidth={220}
            />
          ) : null}
        </View>

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
            <Fact
              Icon={Building2}
              label="Customer"
              value={ticket.CustomerName ?? "—"}
              sub={customerSub || undefined}
            />
            <Fact
              Icon={User}
              label="Reported by"
              value={
                [ticket.ContactPerson, ticket.Contact].filter(Boolean).join(" · ") || "—"
              }
            />
            <Fact Icon={STATUS_ICON[code]} label="Status" value={ticket.StatusName ?? code} />
            <Fact
              Icon={Flag}
              label="Priority"
              value={ticket.PriorityName ?? "—"}
              tone={priorityTone(ticket.PriorityName)}
            />
            <Fact
              Icon={Clock}
              label="Due"
              value={due?.label ?? "—"}
              tone={due?.overdue ? "danger" : undefined}
            />
            <Fact
              Icon={ArrowUpRight}
              label="Escalated to"
              value={ticket.EscalatedToName ?? "—"}
            />
            <Fact
              Icon={UserPlus}
              label="Assigned to"
              value={ticket.AssigneeName ?? "Unassigned"}
            />
            <Fact Icon={Tag} label="Category" value={ticket.CategoryName ?? "—"} />
            <Fact
              Icon={MessageSquare}
              label="Channel"
              value={ticket.ChannelName ?? "—"}
            />
            <Fact Icon={Package} label="Product" value={ticket.ProductName ?? "—"} />
            {ticket.ResolutionName ? (
              <Fact Icon={CircleCheck} label="Resolution" value={ticket.ResolutionName} />
            ) : null}
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
        ref={statusRef}
        title="Change status"
        actions={statusActions}
        emptyMessage="No other statuses are configured. Add them on the web first."
      />

      {/* One sheet for every move that needs more than a tap. Its fields are
          computed from `pending`: Resolve shows resolution chips + remarks,
          Reject / Reopen show required remarks, Close from Resolved shows
          optional remarks — so the SP is asked for exactly what it needs. */}
      <ComposeSheet
        ref={moveRef}
        title={
          pending
            ? pending.reopen
              ? `Reopen as ${pending.target.Value}`
              : `Mark as ${pending.target.Value}`
            : "Change status"
        }
        submitLabel={pending?.reopen ? "Reopen" : "Update status"}
        busy={move.isPending}
        choices={
          pending?.needsResolution
            ? [
                {
                  key: "resolution",
                  label: "Resolution",
                  required: true,
                  options: resolutions.map((r) => ({ value: r.Id, label: r.Value })),
                },
              ]
            : []
        }
        fields={[
          {
            key: "remarks",
            label: "Remarks",
            placeholder: pending?.needsRemarks
              ? "Why — this goes on the history"
              : "Optional note for the history",
            multiline: true,
            required: pending?.needsRemarks ?? false,
          },
        ]}
        onSubmit={(values, picked) => {
          if (!pending) return;
          move.mutate({
            TicketId: ticketId,
            StatusId: pending.target.Id,
            ResolutionId: (picked.resolution as number | undefined) ?? null,
            Remarks: values.remarks || null,
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
            TicketId: ticketId,
            ToUserId: transferTo.Id,
            // Only when the target sits in another branch. Whether the caller
            // MAY move it there is the server's call (wide scopes only).
            ToBranchId:
              transferTo.BranchId != null && transferTo.BranchId !== ticket.BranchId
                ? transferTo.BranchId
                : null,
            ReasonId: picked.reason as number,
            Remarks: values.remarks ?? "",
          });
        }}
      />

      <ActionSheet
        ref={escalatePickRef}
        title="Escalate to…"
        actions={escalateActions}
        emptyMessage={
          ticket.AssignedTo
            ? "The assignee has nobody above them in the reporting chain."
            : "You have nobody above you in the reporting chain."
        }
      />
      <ComposeSheet
        ref={escalateRef}
        title={escalateTo ? `Escalate to ${escalateTo.FullName}` : "Escalate"}
        submitLabel="Escalate"
        busy={escalate.isPending}
        fields={[
          {
            key: "remarks",
            label: "Why",
            placeholder: "What they need to know — they get a notification",
            multiline: true,
            required: true,
          },
        ]}
        onSubmit={(values) => {
          if (!escalateTo) return;
          escalate.mutate({
            TicketId: ticketId,
            ToUserId: escalateTo.Id,
            Remarks: values.remarks ?? "",
          });
        }}
      />

      {/* One sheet, not a chain of them: direction and outcome are chips so
          the whole call fits on screen with the keyboard up. NextFollowupDate
          is absent on purpose — tblFollowUp hangs off LeadId, so a ticket
          cannot carry one; its next step is its status. */}
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
        message="Its history, calls and attachments go with it. This cannot be undone."
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
  sub,
  tone,
  last = false,
}: {
  Icon: LucideIcon;
  label: string;
  value: string;
  /** A quieter second line under the value — the customer's mobile, say. */
  sub?: string;
  /** A chip tone; "neutral" means plain ink. */
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
        {sub ? (
          <Text variant="caption" color="textMuted" numberOfLines={1} align="right">
            {sub}
          </Text>
        ) : null}
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
  chips: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing[2],
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
  factValue: { flex: 1, alignItems: "flex-end" },
  block: { gap: spacing[2] },
  fieldRow: { gap: spacing[1] },
  leadRow: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  leadText: { flex: 1, gap: spacing[1] },
  // Lines up under the entry text, not under the rail.
  end: { paddingLeft: spacing[10] },
});
