// src/pages/Support/TicketDetail.jsx
//
// One complaint (spec 2 §4). The lifecycle is driven entirely from the status
// dropdown: every move posts sp_SetTicketStatus, and the moves that need a
// sentence or a resolution prompt for it first. Nothing here matches on a
// status NAME — companies rename them — and nothing resolves an id into a
// label: sp_FetchTicketDetail joins every one of them, custom fields included.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTheme } from "@mui/material/styles";
import { useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";
import { CircleCheck, Flag, Pencil, PhoneCall, RotateCcw, Undo2, Users } from "lucide-react";

import { PageHeader, Card, Chip, Button, Tabs, Skeleton, Combobox } from "../../components/ui";
import Attachments from "../../components/Attachments";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useApiMutation } from "../../hooks/useApiMutation";
import { useLookups } from "../../hooks/useLookups";
import { SUPPORT_ENDPOINTS } from "../../api/supportQueries";
import { formatDate, formatDateTime } from "../../utils/format";
import { recordGone, RECORD_GONE_MESSAGE } from "../../utils/recordGone";
import { statusTone, dueLabel, isActiveCode, isTerminalCode } from "./ticketStatus";
import Timeline, { timelineCount } from "../Sales/Timeline";
import LogCallModal from "../Sales/LogCallModal";
import TicketCreateModal from "./TicketCreateModal";
import TransferTicketModal from "./TransferTicketModal";
import EscalateTicketModal from "./EscalateTicketModal";
import ResolveTicketModal from "./ResolveTicketModal";
import RemarksModal from "./RemarksModal";

function InfoItem({ label, value }) {
  const p = useTheme().tokens;
  return (
    <div>
      <div style={{ fontSize: "calc(12rem / 15)", fontWeight: 500, color: p.text.tertiary }}>{label}</div>
      <div style={{ fontSize: "calc(14rem / 15)", fontWeight: 600, marginTop: 2, color: p.text.primary, overflowWrap: "anywhere" }}>{value || "—"}</div>
    </div>
  );
}

// RS2 carries Label and Type beside the stored value, so a custom field needs
// no definition fetch to be READ. Editing them is the create/edit modal's job.
const customValue = (f) => {
  switch (f.Type) {
    case "number": return f.ValueNumber ?? "—";
    case "date": return formatDate(f.ValueDate, { empty: "—" });
    case "checkbox": return f.ValueNumber ? "Yes" : "No";
    default: return f.ValueText || "—";
  }
};

export default function TicketDetail({ ticketId: ticketIdProp }) {
  const { ticketId: ticketIdParam } = useParams();
  const ticketId = Number(ticketIdProp ?? ticketIdParam);
  const navigate = useNavigate();
  const p = useTheme().tokens;

  const [tab, setTab] = useState("details");
  const [callOpen, setCallOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [resolvePick, setResolvePick] = useState(null);   // status awaiting a resolution
  const [remarksPick, setRemarksPick] = useState(null);   // { status | sendBack, title, submitLabel }
  const queryClient = useQueryClient();
  const movedRef = useRef(false);   // true while checking whether our own reassign took it away

  const { data, isLoading, error, refetch } = useApiQuery({
    queryKey: ["ticket-detail", ticketId],
    endpoint: SUPPORT_ENDPOINTS.tickets.fetchTicketDetail,
    params: { TicketId: ticketId },
    enabled: Boolean(ticketId),
    showErrorMessage: false,
    // A 404 is an answer (the complaint left this user), not a blip.
    retry: (n, e) => !recordGone(e) && n < 1,
  });

  // The complaint is no longer this user's (Review Focus 4): drop the cached
  // copy, go back to the list, say why. `message` null = already said.
  const leave = useCallback((message) => {
    queryClient.removeQueries({ queryKey: ["ticket-detail", ticketId] });
    navigate("/support/tickets");
    if (message) enqueueSnackbar(message, { variant: "info" });
  }, [queryClient, navigate, ticketId]);

  useEffect(() => {
    if (recordGone(error)) leave(movedRef.current ? null : RECORD_GONE_MESSAGE);
  }, [error, leave]);

  // Every action on this page: a 404 means a stale screen; anything else (403 refused,
  // 400, 409 race, "<Name> can no longer take this") is shown and
  // the detail refetched so the buttons match the server again.
  const onActionError = (e) => {
    if (recordGone(e)) return leave(RECORD_GONE_MESSAGE);
    enqueueSnackbar(e?.response?.data?.message || e?.message || "Operation failed", { variant: "error" });
    refetch();
  };

  // After a reassign / send back: if the refetch says it is gone, leave
  // quietly (the move's own toast already named the person).
  const afterMove = async () => {
    movedRef.current = true;
    const r = await refetch();
    if (!recordGone(r.error)) movedRef.current = false;
  };

  const quiet = { showErrorMessage: false };
  const { lookups: statuses } = useLookups("ticket_status", quiet);
  const { lookups: outcomes } = useLookups("call_outcome", quiet);
  // The activity row for a call only records that one happened; tblCall holds
  // the notes and the outcome (reachable for tickets since SQL 067).
  const { data: callsData, refetch: refetchCalls } = useApiQuery({
    queryKey: ["ticket-calls", ticketId],
    endpoint: SUPPORT_ENDPOINTS.calls.fetchCalls,
    params: { TicketId: ticketId },
    enabled: Boolean(ticketId),
    showErrorMessage: false,
  });

  const ticket = data?.ticket ?? null;
  const fields = data?.fields ?? [];
  const activity = data?.activity ?? [];
  const assignments = data?.assignments ?? [];
  const linkedLead = data?.linkedLead ?? null;
  const calls = callsData?.calls ?? [];

  const statusOpts = useMemo(
    () => statuses.map((s) => ({ value: s.Id, label: s.Value, code: s.Code })),
    [statuses],
  );
  const resolvedOpt = statusOpts.find((o) => o.code === "resolved") ?? null;

  const statusMutation = useApiMutation({
    endpoint: SUPPORT_ENDPOINTS.tickets.setTicketStatus,
    successMessage: "Status updated",
    showErrorMessage: false,
    onError: onActionError,
    invalidateQueries: [["tickets"], ["ticket-detail", ticketId], ["customer-detail"], ["logged-by-me"]],
  });

  // Send back: remarks only, to whoever gave it (SendBackToId, from the server).
  const sendBackMutation = useApiMutation({
    endpoint: SUPPORT_ENDPOINTS.tickets.transferTicket,
    showSuccessMessage: false,
    showErrorMessage: false,
    onError: onActionError,
    invalidateQueries: [["tickets"], ["logged-by-me"]],
  });

  /**
   * One endpoint, three prompts:
   *  - resolved, or closed from anything but resolved (sp_SetTicketStatus:
   *    @ToCode='closed' AND @FromCode<>'resolved' needs a resolution) → resolution + remarks
   *  - rejected → remarks ("never solved" has to say why)
   *  - terminal → active → remarks, and the server decides whether the caller
   *    is allowed to reopen at all (AllowReopen; a 403 comes back as-is)
   */
  const onStatusPick = (opt) => {
    if (!opt || opt.value === ticket?.StatusId) return;
    const from = ticket?.StatusCode;
    if (opt.code === "resolved" || (opt.code === "closed" && from !== "resolved")) {
      setResolvePick(opt);
      return;
    }
    if (opt.code === "rejected") {
      setRemarksPick({ status: opt, title: "Reject complaint", subtitle: "It was never solved — say why, for the record.", submitLabel: "Reject" });
      return;
    }
    if (isTerminalCode(from) && isActiveCode(opt.code)) {
      setRemarksPick({ status: opt, title: "Reopen complaint", subtitle: "The due date restarts from now. Only a manager may do this.", submitLabel: "Reopen" });
      return;
    }
    statusMutation.mutate({ TicketId: ticketId, StatusId: opt.value, Remarks: null });
  };

  const submitRemarks = async (remarks) => {
    if (remarksPick.sendBack) {
      const name = ticket.SendBackToName;
      try {
        await sendBackMutation.mutateAsync({ TicketId: ticketId, SendBack: true, Remarks: remarks });
        enqueueSnackbar(`Sent back to ${name}`, { variant: "success" });
        setRemarksPick(null);
        await afterMove();
      } catch {
        // Refused ("<Name> can no longer take this…"): shown, refetched; the
        // button disappears with the refetch, so the prompt closes too.
        setRemarksPick(null);
      }
      return;
    }
    try {
      await statusMutation.mutateAsync({ TicketId: ticketId, StatusId: remarksPick.status.value, Remarks: remarks });
      setRemarksPick(null);
    } catch {
      // The server's own words are already on screen; the prompt stays open
      // so the move is not silently lost (unless the record left, see leave).
    }
  };

  const openOpt = statusOpts.find((o) => o.code === "open") ?? null;
  const reopen = () => setRemarksPick({ status: openOpt, title: "Reopen complaint", subtitle: "The due date restarts from now.", submitLabel: "Reopen" });

  if (isLoading || !ticket) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "calc(12rem / 15)" }} data-testid="ticket-detail-loading">
        <Skeleton variant="text" height={28} width={240} />
        <Skeleton variant="rect" height={160} />
      </div>
    );
  }

  const address = [ticket.CustomerAddress, ticket.CustomerCity].filter(Boolean).join(", ");

  return (
    <div data-testid="ticket-detail">
      <PageHeader
        title={ticket.TicketNo}
        subtitle={ticket.Subject}
        titleSuffix={
          <div style={{ display: "inline-flex", alignItems: "center", gap: "calc(8rem / 15)", flexWrap: "wrap" }}>
            <Chip label={ticket.StatusName || "—"} tone={statusTone(ticket.StatusCode)} size="sm" data-testid="ticket-status-chip" />
            {ticket.PriorityName && <Chip label={ticket.PriorityName} tone="accent" size="sm" data-testid="ticket-priority-chip" />}
            <Chip
              label={dueLabel(ticket.DueAt, ticket.IsOverdue)}
              tone={ticket.IsOverdue ? "error" : "default"}
              size="sm"
              data-testid="ticket-due-chip"
            />
            {ticket.EscalatedTo && (
              <Chip
                icon={<Flag size={12} />}
                label={`Escalated to ${ticket.EscalatedToName ?? "a senior"}`}
                tone="warning"
                size="sm"
                data-testid="ticket-escalated-chip"
              />
            )}
          </div>
        }
        actions={
          <div style={{ display: "flex", gap: "calc(8rem / 15)", alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ width: "calc(190rem / 15)" }}>
              {/* blurOnSelect: a pick that opens a prompt instead of moving the
                  status must not linger in the input, or the header contradicts
                  the chip beside it. Blurring resyncs to the controlled value. */}
              <Combobox
                size="sm"
                blurOnSelect
                options={statusOpts}
                value={statusOpts.find((o) => o.value === ticket.StatusId) ?? null}
                onChange={onStatusPick}
                placeholder="Status"
                data-testid="ticket-status-select"
              />
            </div>
            <Button variant="ghost" leftIcon={<PhoneCall size={14} />} onClick={() => setCallOpen(true)} data-testid="log-call-btn">Log call</Button>
            {isActiveCode(ticket.StatusCode) && resolvedOpt && (
              <Button variant="primary" leftIcon={<CircleCheck size={14} />} onClick={() => setResolvePick(resolvedOpt)} data-testid="resolve-ticket-btn">Resolve</Button>
            )}
            {Boolean(ticket.CanReopen) && openOpt && (
              <Button variant="primary" leftIcon={<RotateCcw size={14} />} onClick={reopen} data-testid="reopen-ticket-btn">Reopen</Button>
            )}
            {Boolean(ticket.CanReassign) && (
              <Button variant="tonal" leftIcon={<Users size={14} />} onClick={() => setTransferOpen(true)} data-testid="reassign-ticket-btn">Reassign</Button>
            )}
            {ticket.SendBackToId != null && (
              <Button
                variant="tonal"
                leftIcon={<Undo2 size={14} />}
                onClick={() => setRemarksPick({ sendBack: true, title: `Send back to ${ticket.SendBackToName}`, subtitle: "Say why it is going back.", submitLabel: "Send back" })}
                data-testid="send-back-ticket-btn"
              >
                Send back to {ticket.SendBackToName}
              </Button>
            )}
            <Button variant="tonal" leftIcon={<Flag size={14} />} onClick={() => setEscalateOpen(true)} data-testid="escalate-ticket-btn">Escalate</Button>
            <Button variant="tonal" leftIcon={<Pencil size={14} />} onClick={() => setEditOpen(true)} data-testid="edit-ticket-btn">Edit</Button>
          </div>
        }
      />

      <Card data-testid="ticket-customer-card" padding="md" sx={{ marginTop: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(calc(170rem / 15), 1fr))", gap: "calc(16rem / 15)" }}>
          <InfoItem label="Customer" value={ticket.CustomerName} />
          <InfoItem label="Contact person" value={ticket.CustomerContactPerson} />
          <InfoItem label="Mobile" value={ticket.CustomerMobile} />
          <InfoItem label="Email" value={ticket.CustomerEmail} />
          <InfoItem label="Where" value={address} />
          <div>
            <div style={{ fontSize: "calc(12rem / 15)", fontWeight: 500, color: p.text.tertiary }}>History</div>
            <button
              type="button"
              onClick={() => navigate(`/support/customers?customerId=${ticket.CustomerId}`)}
              data-testid="ticket-previous-complaints"
              style={{
                marginTop: 2, padding: 0, border: "none", background: "none", cursor: "pointer",
                fontSize: "calc(14rem / 15)", fontWeight: 600, fontFamily: "inherit", color: p.primary.main,
              }}
            >
              {ticket.PreviousTickets ?? 0} previous complaints
            </button>
          </div>
        </div>
      </Card>

      {linkedLead && (
        <div style={{ margin: "calc(8rem / 15) 0" }}>
          <Link to={`/sales/leads/${linkedLead.Id}`} data-testid="linked-lead-link" style={{ fontSize: "calc(13rem / 15)", fontWeight: 600 }}>
            Linked lead: {linkedLead.Name}
          </Link>
        </div>
      )}

      <div style={{ marginTop: "calc(12rem / 15)" }}>
        <Tabs
          value={tab}
          onChange={setTab}
          data-testid="ticket-detail-tabs"
          items={[
            { value: "details", label: "Details" },
            { value: "timeline", label: "Timeline", badge: timelineCount(activity, calls) },
          ]}
        />
      </div>

      <div style={{ marginTop: "calc(20rem / 15)" }}>
        {tab === "details" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "calc(20rem / 15)" }}>
            <Card data-testid="ticket-core-info">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(calc(180rem / 15), 1fr))", gap: "calc(16rem / 15)" }}>
                <InfoItem label="Status" value={ticket.StatusName} />
                <InfoItem label="Priority" value={ticket.PriorityName} />
                <InfoItem label="Due" value={formatDateTime(ticket.DueAt, { empty: "—" })} />
                <InfoItem label="Category" value={ticket.CategoryName} />
                <InfoItem label="Channel" value={ticket.ChannelName} />
                <InfoItem label="Product" value={ticket.ProductName} />
                <InfoItem label="Assigned to" value={ticket.AssigneeName || "Unassigned"} />
                <InfoItem label="Assigned since" value={formatDate(ticket.AssignedAt, { empty: "—" })} />
                <InfoItem label="Office" value={ticket.BranchName} />
                <InfoItem label="Reported by" value={[ticket.ContactPerson, ticket.Contact].filter(Boolean).join(" · ")} />
                <InfoItem label="Raised" value={formatDateTime(ticket.CreatedAt, { empty: "—" })} />
                <InfoItem label="Resolution" value={ticket.ResolutionName} />
                <InfoItem label="Resolved" value={formatDateTime(ticket.ResolvedAt, { empty: "—" })} />
                <InfoItem label="Closed" value={formatDateTime(ticket.ClosedAt, { empty: "—" })} />
              </div>
              {ticket.Description && (
                <div style={{ marginTop: "calc(16rem / 15)" }}>
                  <div style={{ fontSize: "calc(12rem / 15)", fontWeight: 500, color: p.text.tertiary }}>Description</div>
                  <div
                    data-testid="ticket-description-block"
                    style={{ fontSize: "calc(14rem / 15)", lineHeight: 1.6, marginTop: "calc(6rem / 15)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                  >
                    {ticket.Description}
                  </div>
                </div>
              )}
            </Card>

            {/* An unconfigured optional feature earns no screen space. */}
            {fields.length > 0 && (
              <Card data-testid="ticket-custom-fields">
                <h3 style={{ margin: "0 0 calc(16rem / 15)", fontSize: "calc(15rem / 15)", fontWeight: 700 }}>Custom fields</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(calc(200rem / 15), 1fr))", gap: "calc(16rem / 15)" }}>
                  {fields.map((f) => <InfoItem key={f.FieldId} label={f.Label} value={customValue(f)} />)}
                </div>
              </Card>
            )}

            <Card>
              <h3 style={{ margin: "0 0 calc(16rem / 15)", fontSize: "calc(15rem / 15)", fontWeight: 700 }}>Attachments</h3>
              <Attachments entity="ticket" entityId={ticket.Id} />
            </Card>
          </div>
        )}

        {tab === "timeline" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "calc(20rem / 15)" }}>
            <Card>
              <h3 style={{ margin: "0 0 calc(12rem / 15)", fontSize: "calc(15rem / 15)", fontWeight: 700 }}>Assignments</h3>
              {assignments.length === 0 ? (
                <div style={{ fontSize: "calc(13rem / 15)" }}>Never assigned.</div>
              ) : assignments.map((a) => (
                <div key={a.Id} data-testid="assignment-item" style={{ fontSize: "calc(13rem / 15)", padding: "calc(6rem / 15) 0" }}>
                  <strong>{formatDateTime(a.AssignedAt)}</strong> · {a.FromUserName ?? "Unassigned"} → {a.ToUserName ?? "Unassigned"}
                  {a.ToBranchName && a.FromBranchName !== a.ToBranchName ? ` (${a.ToBranchName})` : ""}
                  {a.Reason ? ` · ${a.Reason}` : ""} — {a.Remarks} <em>by {a.AssignedByName}</em>
                </div>
              ))}
            </Card>
            <Timeline activity={activity} calls={calls} outcomes={outcomes} />
          </div>
        )}
      </div>

      <LogCallModal
        open={callOpen}
        onClose={() => setCallOpen(false)}
        ticketId={ticketId}
        onLogged={() => { refetch(); refetchCalls(); }}
      />
      <TicketCreateModal open={editOpen} ticket={ticket} onClose={() => setEditOpen(false)} onSaved={refetch} />
      <TransferTicketModal open={transferOpen} ticketIds={[ticketId]} onClose={() => setTransferOpen(false)} onDone={afterMove} onError={onActionError} />
      <EscalateTicketModal open={escalateOpen} ticket={ticket} onClose={() => setEscalateOpen(false)} onDone={refetch} onError={onActionError} />
      <ResolveTicketModal
        open={Boolean(resolvePick)}
        ticket={ticket}
        status={resolvePick}
        onClose={() => setResolvePick(null)}
        onDone={refetch}
        onError={onActionError}
      />
      <RemarksModal
        open={Boolean(remarksPick)}
        title={remarksPick?.title}
        subtitle={remarksPick?.subtitle}
        submitLabel={remarksPick?.submitLabel}
        required
        busy={statusMutation.isPending || sendBackMutation.isPending}
        onClose={() => setRemarksPick(null)}
        onSubmit={submitRemarks}
      />
    </div>
  );
}
