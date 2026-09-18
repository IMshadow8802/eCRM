// src/pages/Support/TicketDetail.jsx
//
// One complaint (spec 2 §4). The lifecycle is driven entirely from the status
// dropdown: every move posts sp_SetTicketStatus, and the moves that need a
// sentence or a resolution prompt for it first. Nothing here matches on a
// status NAME — companies rename them — and nothing resolves an id into a
// label: sp_FetchTicketDetail joins every one of them, custom fields included.
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTheme } from "@mui/material/styles";
import { ArrowRightLeft, Flag, Pencil, PhoneCall } from "lucide-react";

import { PageHeader, Card, Chip, Button, Tabs, Skeleton, Combobox } from "../../components/ui";
import Attachments from "../../components/Attachments";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useApiMutation } from "../../hooks/useApiMutation";
import { useLookups } from "../../hooks/useLookups";
import { SUPPORT_ENDPOINTS } from "../../api/supportQueries";
import { formatDate, formatDateTime } from "../../utils/format";
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
      <div style={{ fontSize: 12, fontWeight: 500, color: p.text.tertiary }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2, color: p.text.primary }}>{value || "—"}</div>
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
  const [remarksPick, setRemarksPick] = useState(null);   // { status, title, submitLabel }

  const { data, isLoading, refetch } = useApiQuery({
    queryKey: ["ticket-detail", ticketId],
    endpoint: SUPPORT_ENDPOINTS.tickets.fetchTicketDetail,
    params: { TicketId: ticketId },
    enabled: Boolean(ticketId),
    showErrorMessage: false,
  });

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

  const statusMutation = useApiMutation({
    endpoint: SUPPORT_ENDPOINTS.tickets.setTicketStatus,
    successMessage: "Status updated",
    invalidateQueries: [["tickets"], ["ticket-detail", ticketId], ["customer-detail"]],
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
    try {
      await statusMutation.mutateAsync({ TicketId: ticketId, StatusId: remarksPick.status.value, Remarks: remarks });
      setRemarksPick(null);
    } catch {
      // The server's own words are already on screen (the reopen gate's 403);
      // the prompt stays open so the move is not silently lost.
    }
  };

  if (isLoading || !ticket) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="ticket-detail-loading">
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
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
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
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ width: 190 }}>
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
            <Button variant="tonal" leftIcon={<ArrowRightLeft size={14} />} onClick={() => setTransferOpen(true)} data-testid="transfer-ticket-btn">Transfer</Button>
            <Button variant="tonal" leftIcon={<Flag size={14} />} onClick={() => setEscalateOpen(true)} data-testid="escalate-ticket-btn">Escalate</Button>
            <Button variant="tonal" leftIcon={<Pencil size={14} />} onClick={() => setEditOpen(true)} data-testid="edit-ticket-btn">Edit</Button>
          </div>
        }
      />

      <Card data-testid="ticket-customer-card" padding="md" sx={{ marginTop: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 16 }}>
          <InfoItem label="Customer" value={ticket.CustomerName} />
          <InfoItem label="Contact person" value={ticket.CustomerContactPerson} />
          <InfoItem label="Mobile" value={ticket.CustomerMobile} />
          <InfoItem label="Email" value={ticket.CustomerEmail} />
          <InfoItem label="Where" value={address} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: p.text.tertiary }}>History</div>
            <button
              type="button"
              onClick={() => navigate(`/support/customers?customerId=${ticket.CustomerId}`)}
              data-testid="ticket-previous-complaints"
              style={{
                marginTop: 2, padding: 0, border: "none", background: "none", cursor: "pointer",
                fontSize: 14, fontWeight: 600, fontFamily: "inherit", color: p.primary.main,
              }}
            >
              {ticket.PreviousTickets ?? 0} previous complaints
            </button>
          </div>
        </div>
      </Card>

      {linkedLead && (
        <div style={{ margin: "8px 0" }}>
          <Link to={`/sales/leads/${linkedLead.Id}`} data-testid="linked-lead-link" style={{ fontSize: 13, fontWeight: 600 }}>
            Linked lead: {linkedLead.Name}
          </Link>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
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

      <div style={{ marginTop: 20 }}>
        {tab === "details" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <Card data-testid="ticket-core-info">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 16 }}>
                <InfoItem label="Status" value={ticket.StatusName} />
                <InfoItem label="Priority" value={ticket.PriorityName} />
                <InfoItem label="Due" value={formatDateTime(ticket.DueAt, { empty: "—" })} />
                <InfoItem label="Category" value={ticket.CategoryName} />
                <InfoItem label="Channel" value={ticket.ChannelName} />
                <InfoItem label="Product" value={ticket.ProductName} />
                <InfoItem label="Assignee" value={ticket.AssigneeName || "Unassigned"} />
                <InfoItem label="Assigned since" value={formatDate(ticket.AssignedAt, { empty: "—" })} />
                <InfoItem label="Branch" value={ticket.BranchName} />
                <InfoItem label="Reported by" value={[ticket.ContactPerson, ticket.Contact].filter(Boolean).join(" · ")} />
                <InfoItem label="Raised" value={formatDateTime(ticket.CreatedAt, { empty: "—" })} />
                <InfoItem label="Resolution" value={ticket.ResolutionName} />
                <InfoItem label="Resolved" value={formatDateTime(ticket.ResolvedAt, { empty: "—" })} />
                <InfoItem label="Closed" value={formatDateTime(ticket.ClosedAt, { empty: "—" })} />
              </div>
              {ticket.Description && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: p.text.tertiary }}>Description</div>
                  <div
                    data-testid="ticket-description-block"
                    style={{ fontSize: 14, lineHeight: 1.6, marginTop: 6, whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                  >
                    {ticket.Description}
                  </div>
                </div>
              )}
            </Card>

            {/* An unconfigured optional feature earns no screen space. */}
            {fields.length > 0 && (
              <Card data-testid="ticket-custom-fields">
                <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>Custom fields</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
                  {fields.map((f) => <InfoItem key={f.FieldId} label={f.Label} value={customValue(f)} />)}
                </div>
              </Card>
            )}

            <Card>
              <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>Attachments</h3>
              <Attachments entity="ticket" entityId={ticket.Id} />
            </Card>
          </div>
        )}

        {tab === "timeline" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <Card>
              <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700 }}>Assignments</h3>
              {assignments.length === 0 ? (
                <div style={{ fontSize: 13 }}>Never assigned.</div>
              ) : assignments.map((a) => (
                <div key={a.Id} data-testid="assignment-item" style={{ fontSize: 13, padding: "6px 0" }}>
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
      <TransferTicketModal open={transferOpen} ticketIds={[ticketId]} onClose={() => setTransferOpen(false)} onDone={refetch} />
      <EscalateTicketModal open={escalateOpen} ticket={ticket} onClose={() => setEscalateOpen(false)} onDone={refetch} />
      <ResolveTicketModal
        open={Boolean(resolvePick)}
        ticket={ticket}
        status={resolvePick}
        onClose={() => setResolvePick(null)}
        onDone={refetch}
      />
      <RemarksModal
        open={Boolean(remarksPick)}
        title={remarksPick?.title}
        subtitle={remarksPick?.subtitle}
        submitLabel={remarksPick?.submitLabel}
        required
        busy={statusMutation.isPending}
        onClose={() => setRemarksPick(null)}
        onSubmit={submitRemarks}
      />
    </div>
  );
}
