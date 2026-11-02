import { useMemo, useRef, useState, type ReactNode } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import {
  Archive,
  ArrowLeftRight,
  Building2,
  ChevronsUp,
  CircleCheck,
  CirclePause,
  CirclePlay,
  CircleX,
  EllipsisVertical,
  Lock,
  Paperclip,
  Pencil,
  Phone,
  PhoneCall,
  RotateCcw,
  Smartphone,
  Trash2,
  UserCheck,
} from "lucide-react-native";

import { fetchCalls } from "../../api/callQueries";
import { fetchCustomerDetail } from "../../api/customerQueries";
import { apiErrorMessage } from "../../api/errors";
import { deleteTicket, fetchEscalationTargets, fetchTicketDetail } from "../../api/ticketQueries";
import { useActionBar } from "../../navigation/Shell";
import useAuthStore from "../../stores/useAuthStore";
import { activityBadge, colors, complaintBadge, escalatedMark, metrics, priorityChip, spacing } from "../../theme";
import {
  ActionSheet,
  Avatar,
  Band,
  BandSheet,
  Button,
  Card,
  Chip,
  CircleAction,
  Dialog,
  EmptyState,
  ErrorCard,
  Facts,
  GroupHeader,
  HeaderButton,
  IconButton,
  ListGroup,
  ListRow,
  SkeletonRows,
  StatusBadge,
  Text,
  useLayout,
  useToast,
  type BarAction,
  type Fact,
  type ListRowProps,
  type SheetAction,
  type SheetRef,
} from "../../ui";
import AttachmentList from "../attachments/AttachmentList";
import { useAccess } from "../auth/useAccess";
import { ComplaintSheets, type ComplaintAction, type ComplaintSheetsHandle } from "./ComplaintSheets";
import {
  customValue,
  dueFact,
  isActive,
  isTerminal,
  lifecycleOf,
  asStatusCode,
  lookupMap,
  openedText,
  statusFor,
  whenText,
} from "./ticketHelpers";
import { useTicketRefData } from "./useTicketRefData";

export interface ComplaintDetailBodyProps {
  ticketId: number;
  /** Phone: the band's back. The tablet pane has none. */
  onBack?: () => void;
  onEdit: (ticketId: number) => void;
  onDeleted: () => void;
  /** Another of the customer's complaints. */
  onOpenTicket: (ticketId: number) => void;
}

/** Summaries that lead with one of these verbs get it bold (E 11 / T2: "**Escalated** to Neha Kapoor"). */
const ACTIVITY_VERBS = new Set([
  "created", "escalated", "assigned", "transferred", "unassigned", "resolved", "reopened", "closed", "rejected", "called",
]);

/**
 * E 11 / T2 activity titles: a leading verb bold, the rest regular. Only a
 * closed verb list is bolded: sp_LogTicketActivity also writes "Complaint
 * created", "Complaint details updated" and "Status: Open → Resolved", which
 * read as plain titles. Legacy rows wrote a lowercase "resolved" / "closed" /
 * "reopened"; the first letter is capitalised.
 */
function activityTitle(text: string): { titleVerb?: string; title: string } {
  const capped = text.charAt(0).toUpperCase() + text.slice(1);
  const at = capped.indexOf(" ");
  const first = at < 0 ? capped : capped.slice(0, at);
  if (!ACTIVITY_VERBS.has(first.toLowerCase())) return { title: capped };
  return { titleVerb: first, title: at < 0 ? "" : capped.slice(at + 1) };
}

/** Activity shows four until "All n" (E 11). */
const COLLAPSED = 4;

/**
 * One complaint (E 11; the T2 detail pane). On a phone the navy bar becomes
 * the record's action bar (`useActionBar`); at the rail the same actions sit
 * in the band, Resolve filled. One scroll: customer, facts, activity, then
 * details, files and hand-overs under their own headers.
 *
 * Actions the server would refuse are not offered (no edit grant → none);
 * a refusal the client cannot know — the reopen gate — is the server's
 * sentence in a toast.
 */
export function ComplaintDetailBody({ ticketId, onBack, onEdit, onDeleted, onOpenTicket }: ComplaintDetailBodyProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const layout = useLayout();
  const userId = useAuthStore((s) => s.UserId);
  // Courtesy only (CLAUDE.md §3): the routes 403 without these grants anyway.
  const can = useAccess("complaints");
  const canSeeCustomers = useAccess("customers").view;

  // A callback ref into state, so the action handlers close over a value, not a ref.
  const [sheets, setSheets] = useState<ComplaintSheetsHandle | null>(null);
  const menuRef = useRef<SheetRef>(null);
  const historyRef = useRef<SheetRef>(null);
  const statusRef = useRef<SheetRef>(null);
  const scrollRef = useRef<ScrollView>(null);
  const [filesY, setFilesY] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const detailQuery = useQuery({
    queryKey: ["ticket", ticketId],
    queryFn: () => fetchTicketDetail({ TicketId: ticketId }),
  });
  const ticket = detailQuery.data?.ticket ?? null;
  const code = ticket ? lifecycleOf(ticket) : "open";
  const active = isActive(code);

  const { statuses, callOutcomes } = useTicketRefData();
  // sp_LogCall's activity row only says a call happened; the notes are on tblCall.
  const { data: calls } = useQuery({
    queryKey: ["calls", "ticket", ticketId],
    queryFn: () => fetchCalls({ TicketId: ticketId }),
  });
  // The chain above whoever is working it — no chain, no Escalate.
  const forUserId = ticket?.AssignedTo ?? userId;
  const { data: seniors } = useQuery({
    queryKey: ["escalation-targets", forUserId],
    queryFn: () => fetchEscalationTargets(forUserId),
    enabled: can.edit && !!ticket && active,
  });
  // The customer's complaints — only once asked for.
  const historyQuery = useQuery({
    queryKey: ["customer-detail", ticket?.CustomerId],
    queryFn: () => fetchCustomerDetail({ CustomerId: ticket!.CustomerId }),
    enabled: historyOpen && !!ticket?.CustomerId,
  });
  const outcomes = useMemo(() => lookupMap(callOutcomes), [callOutcomes]);

  const remove = useMutation({
    mutationFn: (p: Parameters<typeof deleteTicket>[0]) => deleteTicket(p),
    onError: (err) => toast.error(apiErrorMessage(err, "Could not delete this complaint.")),
    onSuccess: () => {
      setConfirmingDelete(false);
      void queryClient.invalidateQueries({ queryKey: ["tickets"] });
      onDeleted();
    },
  });

  const run = (action: ComplaintAction) => () => ticket && sheets?.open(action, ticket);
  const has = (c: Parameters<typeof statusFor>[1]) => !!statusFor(statuses, c);

  // E 11: Log call · On hold · Resolve (main) · Transfer · Escalate. On hold →
  // Resume; terminal → Reopen is the main one. No edit grant → nothing: every
  // one of them is a write the server would refuse (logCall checks write too).
  const bar: BarAction[] =
    !ticket || !can.edit
      ? []
      : [
          { key: "call", label: "Log call", icon: PhoneCall, onPress: run("call") },
          ...(isTerminal(code)
            ? has("open")
              ? [{ key: "reopen", label: "Reopen", icon: RotateCcw, main: true, onPress: run("reopen") }]
              : []
            : [
                ...(code === "onhold"
                  ? has("open")
                    ? [{ key: "resume", label: "Resume", icon: CirclePlay, onPress: run("resume") }]
                    : []
                  : has("onhold")
                    ? [{ key: "hold", label: "On hold", icon: CirclePause, onPress: run("hold") }]
                    : []),
                ...(has("resolved") ? [{ key: "resolve", label: "Resolve", icon: CircleCheck, main: true, onPress: run("resolve") }] : []),
              ]),
          { key: "transfer", label: "Transfer", icon: ArrowLeftRight, onPress: run("transfer") },
          ...(active && seniors?.length ? [{ key: "escalate", label: "Escalate", icon: ChevronsUp, onPress: run("escalate") }] : []),
        ];
  const { inBand } = useActionBar(bar);

  const back = onBack ? { onBack } : {};

  if (!ticket) {
    const status = isAxiosError(detailQuery.error) ? detailQuery.error.response?.status : undefined;
    const forbidden = status === 403 || status === 404 || (detailQuery.isSuccess && !ticket);
    return (
      <>
        <Band variant="record" title="Complaint" titleVariant="h2" tone={inBand ? "raised" : "band"} gutter={inBand ? metrics.pane.detailBand : undefined} {...back} />
        <BandSheet center={forbidden}>
          {forbidden ? (
            <EmptyState
              module="complaints"
              icon={Lock}
              title="Complaint not available"
              message="It may have been deleted, or it belongs to an office you cannot see."
            />
          ) : detailQuery.isError ? (
            <ErrorCard onRetry={() => void detailQuery.refetch()} />
          ) : (
            <SkeletonRows rows={4} />
          )}
        </BandSheet>
      </>
    );
  }

  const fields = detailQuery.data?.fields ?? [];
  const assignments = detailQuery.data?.assignments ?? [];
  const linkedLead = detailQuery.data?.linkedLead ?? null;
  const badge = complaintBadge(code);
  const flag = priorityChip(ticket.PriorityName);
  const due = dueFact(ticket);
  const contact = ticket.ContactPerson || ticket.CustomerContactPerson;
  const mobile = ticket.CustomerMobile;
  const call = () => mobile && void Linking.openURL(`tel:${mobile}`);
  const rowBadge: 32 | 36 = inBand ? 36 : 32;

  // Two sources woven together: the activity row says a call happened, tblCall
  // says what was said — the call rows replace the activity's 'call' rows.
  const activity: (ListRowProps & { key: string; at: string })[] = [
    ...(detailQuery.data?.activity ?? [])
      .filter((a) => (a.Type ?? "").toLowerCase() !== "call")
      .map((a) => {
        const b = activityBadge(a.Type);
        return {
          key: `a-${a.Id}`,
          at: a.CreatedAt,
          badge: { tone: b.tone, icon: b.icon, size: rowBadge },
          ...activityTitle(a.Summary ?? a.Type ?? ""),
          meta: a.UserName ? `By ${a.UserName}` : undefined,
          right: { text: whenText(a.CreatedAt) },
        };
      }),
    ...(calls ?? []).map((c) => {
      const b = activityBadge("call");
      const outcome = c.OutcomeId ? outcomes.get(c.OutcomeId) : undefined;
      return {
        key: `c-${c.Id}`,
        at: c.CalledAt,
        badge: { tone: b.tone, icon: b.icon, size: rowBadge },
        // E 11 (phone) reads "**Call logged** · 4 min"; T2 adds the direction.
        titleVerb: "Call logged",
        title: [c.Duration ? `${c.Duration} min` : null, outcome ?? (inBand ? (c.Direction === "in" ? "incoming" : "outgoing") : null)]
          .filter(Boolean)
          .map((part) => `· ${part}`)
          .join(" "),
        meta: c.Notes ?? undefined,
        right: { text: whenText(c.CalledAt) },
      };
    }),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const shown = expanded ? activity : activity.slice(0, COLLAPSED);

  const facts: Fact[] = [
    { label: "Category", value: ticket.CategoryName ?? undefined },
    {
      label: "Priority",
      node: ticket.PriorityName ? <Chip label={ticket.PriorityName} tone={flag.tone} icon={flag.icon} /> : undefined,
    },
    {
      label: "Assigned to",
      node: (
        <View style={styles.person}>
          {ticket.AssigneeName ? <Avatar name={ticket.AssigneeName} userId={ticket.AssignedTo} size={22} /> : null}
          <Text variant="rowTitle" numberOfLines={1} style={styles.shrink}>{ticket.AssigneeName ?? "Unassigned"}</Text>
        </View>
      ),
    },
    { label: "Due", value: due?.text, tone: due?.overdue ? "danger" : undefined },
  ];

  const historyCount = ticket.PreviousTickets ?? 0;
  const details: Fact[] = [
    ...(ticket.Description ? [{ label: "Description", value: ticket.Description }] : []),
    { label: "Reported by", value: [ticket.ContactPerson, ticket.Contact].filter(Boolean).join(" · ") || undefined },
    { label: "Channel", value: ticket.ChannelName ?? undefined },
    { label: "Product", value: ticket.ProductName ?? undefined },
    { label: "Office", value: ticket.BranchName ?? undefined },
    ...(ticket.ResolutionName ? [{ label: "Resolution", value: ticket.ResolutionName }] : []),
    ...(ticket.EscalatedToName ? [{ label: "Escalated to", value: ticket.EscalatedToName }] : []),
    ...fields.map((f) => ({ label: f.Label, value: customValue(f) })),
    ...(linkedLead ? [{ label: "Raised from lead", value: linkedLead.Name ?? "Lead" }] : []),
    ...(historyCount
      ? [
          {
            label: "Customer history",
            node: canSeeCustomers ? (
              <Pressable
                hitSlop={spacing[2]}
                accessibilityRole="link"
                accessibilityLabel={`Show ${historyCount} previous complaints`}
                onPress={() => {
                  setHistoryOpen(true);
                  historyRef.current?.present();
                }}
              >
                <Text variant="rowTitle" color="primary">{`${historyCount} previous`}</Text>
              </Pressable>
            ) : (
              <Text variant="rowTitle">{`${historyCount} previous`}</Text>
            ),
          },
        ]
      : []),
  ];

  const menu: SheetAction[] = [
    ...(can.edit ? [{ key: "edit", label: "Edit complaint", icon: Pencil, onPress: () => onEdit(ticketId) }] : []),
    ...(can.edit ? [{ key: "status", label: "Change status", icon: ArrowLeftRight, onPress: () => statusRef.current?.present() }] : []),
    ...(can.edit && code !== "closed"
      ? [{ key: "close", label: "Close", icon: Archive, onPress: run("close") }]
      : []),
    ...(can.edit && active ? [{ key: "reject", label: "Reject", icon: CircleX, onPress: run("reject") }] : []),
    ...(can.edit && isTerminal(code) ? [{ key: "reopen", label: "Reopen", icon: RotateCcw, onPress: run("reopen") }] : []),
    { key: "files", label: "Files", icon: Paperclip, onPress: () => scrollRef.current?.scrollTo({ y: filesY, animated: true }) },
    ...(can.delete
      ? [{ key: "delete", label: "Delete complaint", icon: Trash2, tone: "danger" as const, onPress: () => setConfirmingDelete(true) }]
      : []),
  ];

  // Every company status but the current one (as before E), each with its
  // Code's badge. The pick asks exactly what that Code demands (ComplaintSheets).
  const statusMoves: SheetAction[] = statuses
    .filter((s) => s.Id !== ticket.StatusId)
    .map((s) => {
      const to = asStatusCode(s.Code);
      const b = complaintBadge(to);
      const reopen = isTerminal(code) && isActive(to);
      return {
        key: `s-${s.Id}`,
        label: s.Value,
        accessibilityLabel: `Move to ${s.Value}`,
        badge: { tone: b.tone, icon: b.icon },
        chip: reopen ? { label: "Reopen", tone: b.chip } : undefined,
        onPress: () => sheets?.moveTo(ticket, s),
      };
    });

  const historyActions: SheetAction[] =(historyQuery.data?.data?.tickets ?? [])
    .filter((t) => t.Id !== ticket.Id)
    .map((t) => {
      const b = complaintBadge(t.StatusCode);
      return {
        key: `h-${t.Id}`,
        label: `${t.TicketNo} · ${t.Subject}`,
        sublabel: [t.StatusName, t.AssigneeName ?? "Unassigned"].filter(Boolean).join(" · "),
        badge: { tone: b.tone, icon: b.icon },
        onPress: () => onOpenTicket(t.Id),
      };
    });

  const menuButton = (
    <IconButton icon={EllipsisVertical} accessibilityLabel="Complaint actions" onPress={() => menuRef.current?.present()} />
  );
  // T2: ghost buttons for the rest, the main one filled and last.
  const bandActions: ReactNode = inBand ? (
    <View style={styles.bandActions}>
      {[...bar.filter((a) => !a.main), ...bar.filter((a) => a.main)].map((a) => (
        <HeaderButton key={a.key} label={a.label} icon={a.icon} onPress={a.onPress} variant={a.main ? "primary" : "ghost"} on="raised" />
      ))}
      {menuButton}
    </View>
  ) : (
    menuButton
  );

  const customer = inBand ? (
    <Card style={styles.half} gap={0}>
      <View style={styles.customer}>
        <StatusBadge tone="peach" icon={Building2} />
        <View style={styles.flex}>
          <Text variant="bodyStrong" numberOfLines={1}>{ticket.CustomerName ?? "Unnamed customer"}</Text>
          {contact ? <Text variant="meta" numberOfLines={1}>{`Contact: ${contact}`}</Text> : null}
        </View>
      </View>
      {mobile ? (
        <View style={styles.mobileRow}>
          <Smartphone size={18} color={colors.textMuted} />
          <Text variant="bodyStrong" tabular style={styles.flex}>{mobile}</Text>
          <Button title="Call" icon={Phone} variant="success" size="sm" onPress={call} accessibilityLabel={`Call ${mobile}`} />
        </View>
      ) : null}
    </Card>
  ) : (
    <Card padded={false} gap={0} style={styles.customerCard}>
      <View style={styles.customer}>
        <StatusBadge tone="peach" icon={Building2} />
        <View style={styles.flex}>
          <Text variant="bodyStrong" numberOfLines={1}>{ticket.CustomerName ?? "Unnamed customer"}</Text>
          <Text variant="meta" tabular numberOfLines={1}>{[contact, mobile].filter(Boolean).join(" · ") || "No contact details"}</Text>
        </View>
        {mobile ? <CircleAction icon={Phone} accessibilityLabel={`Call ${mobile}`} onPress={call} /> : null}
      </View>
    </Card>
  );

  return (
    <>
      <Band
        variant="record"
        titleVariant="h2"
        title={ticket.TicketNo}
        subtitle={inBand ? undefined : openedText(ticket.CreatedAt)}
        tone={inBand ? "raised" : "band"}
        gutter={inBand ? metrics.pane.detailBand : undefined}
        actions={bandActions}
        {...back}
      >
        <Text variant={inBand ? "titleLg" : "recordTitle"} color="textOnBrand" style={styles.title}>{ticket.Subject}</Text>
        <View style={styles.chips}>
          <Chip label={ticket.StatusName ?? code} tone={badge.chip} icon={badge.icon} />
          {inBand && ticket.PriorityName ? <Chip label={ticket.PriorityName} tone={flag.tone} icon={flag.icon} /> : null}
          {ticket.EscalatedTo ? (
            <Chip label={`Escalated to ${ticket.EscalatedToName ?? "a senior"}`} tone={escalatedMark.chip} icon={escalatedMark.icon} maxWidth={260} />
          ) : null}
          {inBand ? <Text variant="meta" color="onBandMuted" tabular>{openedText(ticket.CreatedAt)}</Text> : null}
        </View>
      </Band>

      <BandSheet padded={false}>
        <ScrollView
          ref={scrollRef}
          testID="record-scroll"
          contentContainerStyle={[styles.content, inBand ? styles.contentPane : { paddingHorizontal: layout.gutter }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {inBand ? (
            <View style={styles.pair}>
              {customer}
              <Card style={styles.half} gap={0}>
                <Facts layout="list" items={facts} />
              </Card>
            </View>
          ) : (
            <>
              {customer}
              <View style={styles.factsGap}>
                <Facts items={facts} />
              </View>
            </>
          )}

          <GroupHeader
            label="Activity"
            link={activity.length > COLLAPSED ? { label: expanded ? "Fewer" : `All ${activity.length}`, onPress: () => setExpanded((e) => !e) } : undefined}
          />
          {shown.length ? (
            <ListGroup>
              {shown.map(({ key, at: _at, ...row }, i) => (
                <ListRow key={key} {...row} align="top" noSeparator={i === 0} />
              ))}
            </ListGroup>
          ) : (
            <Text variant="meta">Nothing has happened yet.</Text>
          )}

          <GroupHeader label="Details" />
          <Card gap={0} style={styles.details}>
            <Facts layout="list" items={details} />
          </Card>

          <View onLayout={(e) => setFilesY(e.nativeEvent.layout.y)}>
            <GroupHeader label="Files" />
            <AttachmentList entity="ticket" entityId={ticketId} canManage={can.edit} embedded />
          </View>

          {assignments.length ? (
            <>
              <GroupHeader label="Handovers" />
              <ListGroup>
                {assignments.map((a, i) => (
                  <ListRow
                    key={a.Id}
                    noSeparator={i === 0}
                    align="top"
                    badge={<StatusBadge size={inBand ? 36 : 32} tone="teal" icon={UserCheck} />}
                    title={`${a.FromUserName ?? "Unassigned"} → ${a.ToUserName ?? "Unassigned"}`}
                    meta={[a.Reason, a.Remarks, a.AssignedByName ? `by ${a.AssignedByName}` : null].filter(Boolean).join(" · ")}
                    right={{ text: whenText(a.AssignedAt) }}
                  />
                ))}
              </ListGroup>
            </>
          ) : null}
        </ScrollView>
      </BandSheet>

      <ComplaintSheets ref={setSheets} />
      <ActionSheet ref={menuRef} title="Complaint actions" actions={menu} />
      <ActionSheet
        ref={statusRef}
        title="Change status"
        subtitle={`${ticket.TicketNo} · now ${ticket.StatusName ?? code}`}
        actions={statusMoves}
        emptyMessage="No other statuses are set up. Add them on the web first."
      />
      <ActionSheet
        ref={historyRef}
        title={`${ticket.CustomerName ?? "Customer"} · complaints`}
        actions={historyActions}
        emptyMessage={
          historyQuery.isError
            ? apiErrorMessage(historyQuery.error, "Couldn't load this customer's complaints.")
            : historyQuery.isLoading
              ? "Loading…"
              : "No other complaints you can see."
        }
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
    </>
  );
}

const styles = StyleSheet.create({
  title: { marginTop: spacing[1] },
  chips: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing[2], marginTop: metrics.pairGap },
  bandActions: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  content: { paddingTop: metrics.sheetPadTop, paddingBottom: spacing[8] },
  // T2: the record pane's sheet pads 20 24 (E), whatever the window's gutter.
  contentPane: { paddingTop: spacing[5], paddingHorizontal: metrics.pane.detailSheet },
  customerCard: { paddingVertical: spacing[3], paddingHorizontal: metrics.rowPadH },
  customer: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  mobileRow: { flexDirection: "row", alignItems: "center", gap: metrics.pairGap, marginTop: metrics.rowPadH },
  factsGap: { marginTop: metrics.pairGap },
  pair: { flexDirection: "row", gap: spacing[4], alignItems: "stretch" },
  half: { flex: 1, minWidth: 0 },
  details: { paddingVertical: spacing[1], paddingHorizontal: spacing[4] },
  person: { flexDirection: "row", alignItems: "center", gap: metrics.inlineGap, maxWidth: "100%" },
  shrink: { flexShrink: 1 },
  flex: { flex: 1, minWidth: 0 },
});

export default ComplaintDetailBody;
