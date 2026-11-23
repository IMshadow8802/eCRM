import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";
import { useTheme } from "@mui/material/styles";
import { CalendarPlus, Undo2, UserRoundPen, Pencil, Save as SaveIcon, Trophy } from "lucide-react";
import dayjs from "dayjs";

import { PageHeader, Card, Chip, Button, Tabs, EmptyState, Skeleton, Combobox, Modal } from "../../components/ui";
import DynamicField from "../../components/DynamicField";
import Attachments from "../../components/Attachments";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useApiMutation } from "../../hooks/useApiMutation";
import { useLookups } from "../../hooks/useLookups";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import { formatCurrency, formatDue } from "../../utils/format";
import { dueAt, isPastDue } from "./followUpDue";
import DueInputs from "./DueInputs";
import { FOLLOWUP_TYPES, isActiveCode } from "./leadStatus";
import Timeline from "./Timeline";
import { recordGone, RECORD_GONE_MESSAGE } from "../../utils/recordGone";
import LogFollowUpModal from "./LogFollowUpModal";
import RescheduleFollowUpModal from "./RescheduleFollowUpModal";
import TransferLeadModal from "./TransferLeadModal";
import LeadCreateModal from "./LeadCreateModal";
import LeadPartnerCard from "./LeadPartnerCard";
import WonDialog from "./Quotations/WonDialog";
import LeadQuotations from "./Quotations/LeadQuotations";

// fetchLeadDetail's `fields` recordset only carries the stored value columns
// (ValueText/ValueNumber/ValueDate) for fields that HAVE a value — it has no
// Options/IsRequired. Those live on the field definitions, fetched separately
// via /api/config/fetchCustomFields and merged in by FieldId below.
const fieldValue = (def, valueRow) => {
  if (!valueRow) return def.Type === "checkbox" ? false : def.Type === "dropdown" ? null : "";
  switch (def.Type) {
    case "number":
      return valueRow.ValueNumber ?? "";
    case "date":
      return valueRow.ValueDate ?? "";
    case "checkbox":
      return Boolean(valueRow.ValueNumber);
    case "dropdown":
      return valueRow.ValueText ?? null;
    case "text":
    default:
      return valueRow.ValueText ?? "";
  }
};

function InfoItem({ label, value }) {
  const theme = useTheme();
  const p = theme.tokens;
  return (
    <div>
      <div style={{ fontSize: "calc(12rem / 15)", fontWeight: 500, color: p.text.tertiary }}>{label}</div>
      <div style={{ fontSize: "calc(14rem / 15)", fontWeight: 600, marginTop: 2, color: p.text.primary, overflowWrap: "anywhere" }}>
        {value || "—"}
      </div>
    </div>
  );
}

const fmt = (d, f = "DD-MM-YYYY") => (d ? dayjs(d).format(f) : null);

export default function LeadDetail({ leadId: leadIdProp }) {
  const { leadId: leadIdParam } = useParams();
  const leadId = Number(leadIdProp ?? leadIdParam);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState("details");
  const [editOpen, setEditOpen] = useState(false);
  const [moving, setMoving] = useState(null);         // "reassign" | "back" | null
  const [logging, setLogging] = useState(null);          // follow-up row being completed
  const [rescheduling, setRescheduling] = useState(null); // follow-up row being moved
  const [lostPick, setLostPick] = useState(null);        // status option awaiting a reason
  const [lostReason, setLostReason] = useState(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleType, setScheduleType] = useState(FOLLOWUP_TYPES[0]);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [draft, setDraft] = useState({});
  const [wonOpen, setWonOpen] = useState(false);
  const [quoteCount, setQuoteCount] = useState(0);

  // sp_FetchLeadDetail joins the labels itself (StatusName, OwnerName,
  // ProductName, SourceName, BranchName), so this page resolves nothing
  // client-side — one round-trip, and no stale name from a separate cache.
  const { data, isLoading, refetch, error } = useApiQuery({
    queryKey: ["lead-detail", leadId], endpoint: SALES_ENDPOINTS.leads.fetchLeadDetail,
    params: { LeadId: leadId }, enabled: Boolean(leadId), showErrorMessage: false,
    retry: (n, e) => !recordGone(e) && n < 1,
  });

  // The lead left this user (reassigned, moved, deleted) — by our own hand or
  // someone else's while the page was open. Drop the cached detail, go back to
  // the list (404 only; a 403 is a refused action and stays). Our own reassign already said "Reassigned to X"; anything else
  // says RECORD_GONE_MESSAGE. `left` makes it fire once.
  const departing = useRef(false);
  const left = useRef(false);
  const leave = (message) => {
    if (left.current) return;
    left.current = true;
    queryClient.removeQueries({ queryKey: ["lead-detail", leadId] });
    if (message) enqueueSnackbar(message, { variant: "warning" });
    navigate("/sales/leads");
  };
  useEffect(() => {
    if (recordGone(error)) leave(departing.current ? null : RECORD_GONE_MESSAGE);
  }, [error]); // leave/departing are refs and stable callbacks
  const onActionError = (e) => {
    if (recordGone(e)) leave(RECORD_GONE_MESSAGE);
    else enqueueSnackbar(e?.response?.data?.message || e?.message || "Operation failed", { variant: "error" });
  };
  const onMoved = () => {
    departing.current = true;
    refetch().then((r) => { if (!recordGone(r?.error)) departing.current = false; });
  };
  const { data: defsData } = useApiQuery({
    queryKey: ["custom-field-defs", "lead"], endpoint: SALES_ENDPOINTS.config.fetchCustomFields,
    params: { Entity: "lead" }, showErrorMessage: false,
  });
  const { lookups: statuses } = useLookups("lead_status", { showErrorMessage: false });
  const { lookups: lostReasons } = useLookups("lost_reason", { enabled: Boolean(lostPick), showErrorMessage: false });

  const lead = data?.lead ?? null;
  // The server's verdict (fn_RecordActions): a control that can only earn a
  // 403 is not shown. A follow-up row answers for itself (CanAct); the
  // lead-detail rows carry none today, and a visible lead's follow-ups are all
  // actable (132 §10, Via 1), so a missing CanAct means yes.
  const canEdit = Boolean(lead?.CanEdit);
  const canAct = (f) => f.CanAct == null || Boolean(f.CanAct);
  const activity = data?.activity ?? [];
  const followups = data?.followups ?? [];
  const assignments = data?.assignments ?? [];
  const openFollowups = followups.filter((f) => f.Status === "open");

  // `converted` (Won) IS offered — the owner asked for it to be an ordinary
  // choice — but it is the one status that never goes through setLeadStatus,
  // which refuses it ("Use convert…"). Picking it opens WonDialog, which posts
  // to convertLead: one engine writes a win, whether it arrives from here or
  // from "Accepted" on a quotation.
  //
  // A closed lead (lost / junk / won) goes back to an active status only with
  // the server's CanReopen (139, the complaint reopen rule): without it the
  // active statuses are not offered. A refusal that slips through (stale page)
  // shows the server's sentence and stays.
  const lockedClosed = Boolean(lead) && !isActiveCode(lead.StatusCode) && !lead.CanReopen;
  const statusOpts = useMemo(
    () => statuses
      .filter((s) => !lockedClosed || !isActiveCode(s.Code))
      .map((s) => ({ value: s.Id, label: s.Value, code: s.Code })),
    [statuses, lockedClosed],
  );
  const lostOpts = useMemo(() => lostReasons.map((r) => ({ value: r.Id, label: r.Value })), [lostReasons]);

  // Merge field definitions (Options/IsRequired/order) with the lead's stored
  // values (keyed by FieldId). Definitions drive rendering so blank fields
  // still appear; values just seed the draft.
  const fields = useMemo(() => {
    const defs = defsData?.customFields ?? [];
    const valueByFieldId = new Map((data?.fields ?? []).map((v) => [v.FieldId, v]));
    return defs.map((def) => ({ def, valueRow: valueByFieldId.get(def.Id) }));
  }, [defsData, data]);

  // Draft mirrors the fetched field values so edits are local until saved.
  useEffect(() => {
    const seeded = {};
    fields.forEach(({ def, valueRow }) => {
      seeded[def.Id] = fieldValue(def, valueRow);
    });
    setDraft(seeded);
  }, [fields]);

  const isDirty = fields.some(({ def, valueRow }) => draft[def.Id] !== fieldValue(def, valueRow));

  const saveMutation = useApiMutation({
    endpoint: SALES_ENDPOINTS.leads.saveLeads,
    successMessage: "Lead saved",
    showErrorMessage: false,
    onError: onActionError,
  });

  const saveCustomFields = async () => {
    const customJson = fields.map(({ def }) => ({
      fieldId: def.Id,
      type: def.Type,
      value: draft[def.Id],
    }));
    try {
      // sp_SaveLead's UPDATE writes every base column unconditionally, and the
      // controller's pick() turns a missing key into null — so a partial body
      // blanks whatever it omits. Resend the whole record the page already
      // holds. OwnerId/StatusId are ignored on update (reassign/setStatus own
      // them) and NextFollowupDate is not a column the SP takes.
      await saveMutation.mutateAsync({
        Id: lead?.Id ?? leadId,
        Name: lead?.Name,
        MobileNo: lead?.MobileNo,
        AltMobile: lead?.AltMobile,
        Email: lead?.Email,
        Company: lead?.Company,
        Address: lead?.Address,
        City: lead?.City,
        State: lead?.State,
        Pincode: lead?.Pincode,
        SourceId: lead?.SourceId,
        ProductId: lead?.ProductId,
        EstValue: lead?.EstValue,
        Remarks: lead?.Remarks,
        CustomJSON: JSON.stringify(customJson),
      });
      refetch();
    } catch {
      // useApiMutation already surfaced an error toast.
    }
  };

  const statusMutation = useApiMutation({ endpoint: SALES_ENDPOINTS.leads.setLeadStatus, successMessage: "Status updated", invalidateQueries: [["lead-detail", leadId], ["leads"]], showErrorMessage: false, onError: onActionError });
  const scheduleMutation = useApiMutation({ endpoint: SALES_ENDPOINTS.followups.scheduleFollowUp, successMessage: "Follow-up scheduled", invalidateQueries: [["lead-detail", leadId], ["followups"], ["leads"]], showErrorMessage: false, onError: onActionError });

  // Lost needs a reason — the SP refuses without one, so ask before posting.
  const onStatusPick = (opt) => {
    if (!opt || opt.value === lead?.StatusId) return;
    if (opt.code === "converted") { setWonOpen(true); return; }
    if (opt.code === "lost") { setLostPick(opt); setLostReason(null); return; }
    statusMutation.mutate({ LeadId: leadId, StatusId: opt.value, LostReasonId: null });
  };
  const submitLost = async () => {
    if (!lostPick || !lostReason) return;
    await statusMutation.mutateAsync({ LeadId: leadId, StatusId: lostPick.value, LostReasonId: lostReason.value });
    setLostPick(null);
  };
  const submitSchedule = async () => {
    if (!scheduleDate) return;
    await scheduleMutation.mutateAsync({ LeadId: leadId, Type: scheduleType.value, DueAt: dueAt(scheduleDate, scheduleTime) });
    setScheduleOpen(false); setScheduleDate(""); setScheduleTime("");
  };

  if (isLoading || !lead) return (
    <div style={{ display: "flex", flexDirection: "column", gap: "calc(12rem / 15)" }} data-testid="lead-detail-loading">
      <Skeleton variant="text" height={28} width={240} /><Skeleton variant="rect" height={160} />
    </div>
  );

  const address = [lead.Address, lead.City, lead.State, lead.Pincode].filter(Boolean).join(", ");

  return (
    <div data-testid="lead-detail">
      <PageHeader
        title={lead.Name}
        subtitle={[lead.Company, lead.MobileNo, lead.Email].filter(Boolean).join(" · ")}
        titleSuffix={<Chip label={lead.StatusName || "—"} tone="primary" size="sm" data-testid="lead-status-chip" />}
        actions={
          // flexWrap here, not only in ui/PageHeader: the slot wraps its
          // children, and this row IS one child — without it the row stays a
          // single unbroken line and PageHeader's wrap cannot reach inside.
          <div style={{ display: "flex", gap: "calc(8rem / 15)", alignItems: "center", flexWrap: "wrap" }}>
            {canEdit && <div style={{ minWidth: "calc(150rem / 15)", flex: "1 1 calc(160rem / 15)", maxWidth: "calc(220rem / 15)" }}>
              {/* blurOnSelect: picking `lost` opens a modal instead of moving
                  the status, and a focused Autocomplete keeps showing what was
                  picked. Blurring resyncs the input to the controlled value, so
                  a dismissed prompt cannot leave the header contradicting the
                  chip beside it. */}
              <Combobox size="sm" blurOnSelect options={statusOpts} value={statusOpts.find((o) => o.value === lead.StatusId) ?? null} onChange={onStatusPick} placeholder="Status" data-testid="lead-status-select" />
            </div>}
            {canEdit && <Button variant="tonal" leftIcon={<Pencil size={14} />} onClick={() => setEditOpen(true)} data-testid="edit-lead-btn">Edit</Button>}
            {Boolean(lead.CanReassign) && (
              <Button variant="tonal" leftIcon={<UserRoundPen size={14} />} onClick={() => setMoving("reassign")} data-testid="reassign-lead-btn">Reassign</Button>
            )}
            {lead.SendBackToId != null && Boolean(lead.CanReassign) && (
              <Button variant="tonal" leftIcon={<Undo2 size={14} />} onClick={() => setMoving("back")} data-testid="send-back-btn">Send back to {lead.SendBackToName}</Button>
            )}
            {openFollowups[0]
              ? canAct(openFollowups[0]) && <Button variant="primary" onClick={() => setLogging(openFollowups[0])} data-testid="log-followup-btn">Log follow-up</Button>
              : canEdit && <Button variant="primary" leftIcon={<CalendarPlus size={14} />} onClick={() => setScheduleOpen(true)} data-testid="schedule-followup-btn">Schedule follow-up</Button>}
          </div>
        }
      />

      <Tabs value={tab} onChange={setTab} data-testid="lead-detail-tabs" items={[
        { value: "details", label: "Details" },
        { value: "followups", label: "Follow-ups", badge: openFollowups.length },
        { value: "quotations", label: "Quotations", badge: quoteCount },
        { value: "history", label: "History", badge: activity.length },
      ]} />

      <div style={{ marginTop: "calc(20rem / 15)" }}>
        {tab === "details" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "calc(20rem / 15)" }}>
            {lead.StatusCode === "converted" && (
              <Card variant="outlined" padding="md" data-testid="won-banner">
                <div style={{ display: "flex", alignItems: "center", gap: "calc(12rem / 15)" }}>
                  <Trophy size={20} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "calc(15rem / 15)", fontWeight: 700 }}>Won for {formatCurrency(lead.WonValue, { empty: "—" })}</div>
                    <div style={{ fontSize: "calc(13rem / 15)", marginTop: 2 }}>
                      {fmt(lead.WonAt)}{lead.CustomerName ? ` · customer: ${lead.CustomerName}` : ""}
                    </div>
                  </div>
                </div>
              </Card>
            )}
            <LeadPartnerCard lead={lead} commissions={data?.commissions} />
            <Card data-testid="lead-core-info">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(calc(180rem / 15), 1fr))", gap: "calc(16rem / 15)" }}>
                <InfoItem label="Mobile" value={lead.MobileNo} />
                <InfoItem label="Alternate" value={lead.AltMobile} />
                <InfoItem label="Email" value={lead.Email} />
                <InfoItem label="Product" value={lead.ProductName} />
                <InfoItem label="Estimated value" value={lead.EstValue} />
                <InfoItem label="Assigned to" value={lead.OwnerName || "Unassigned"} />
                <InfoItem label="Office" value={lead.BranchName} />
                <InfoItem label="Source" value={lead.SourceName} />
                <InfoItem label="Next follow-up" value={formatDue(lead.NextFollowupDate) || null} />
                <InfoItem label="Assigned since" value={fmt(lead.AssignedAt)} />
                {Boolean(lead.LostReason) && <InfoItem label="Lost reason" value={lead.LostReason} />}
              </div>
              {(address || lead.Remarks) && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(calc(220rem / 15), 1fr))", gap: "calc(16rem / 15)", marginTop: "calc(16rem / 15)" }}>
                  <InfoItem label="Address" value={address} />
                  <InfoItem label="Remarks" value={lead.Remarks} />
                </div>
              )}
            </Card>

            {/* An unconfigured optional feature earns no screen space — the
                card only exists once the company defines a field. */}
            {fields.length > 0 && (
              <Card>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: "calc(16rem / 15)",
                  }}
                >
                  <h3 style={{ margin: 0, fontSize: "calc(15rem / 15)", fontWeight: 700 }}>Custom fields</h3>
                  {canEdit && <Button
                    variant="primary"
                    size="sm"
                    leftIcon={<SaveIcon size={14} />}
                    onClick={saveCustomFields}
                    disabled={!isDirty}
                    loading={saveMutation.isPending}
                    data-testid="save-custom-fields-btn"
                  >
                    Save changes
                  </Button>}
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(calc(220rem / 15), 1fr))",
                    gap: "calc(16rem / 15)",
                  }}
                >
                  {fields.map(({ def }) => (
                    <DynamicField
                      key={def.Id}
                      field={def}
                      value={draft[def.Id]}
                      onChange={(v) =>
                        setDraft((d) => ({ ...d, [def.Id]: v }))
                      }
                    />
                  ))}
                </div>
              </Card>
            )}

            <Card>
              <h3 style={{ margin: "0 0 calc(16rem / 15)", fontSize: "calc(15rem / 15)", fontWeight: 700 }}>Attachments</h3>
              <Attachments entity="lead" entityId={lead.Id} disabled={!canEdit} />
            </Card>
          </div>
        )}

        {tab === "followups" && (
          <div data-testid="lead-followups" style={{ display: "flex", flexDirection: "column", gap: "calc(10rem / 15)" }}>
            {followups.length === 0 && <EmptyState title="No follow-ups" description="Schedule one from the header." size="sm" data-testid="followups-empty" />}
            {followups.map((f) => (
              <Card key={f.Id} data-testid="followup-item">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "calc(12rem / 15)" }}>
                  <div>
                    <div style={{ fontSize: "calc(14rem / 15)", fontWeight: 600 }}>
                      {FOLLOWUP_TYPES.find((t) => t.value === f.Type)?.label ?? f.Type} · {f.Status === "open" ? `due ${formatDue(f.DueAt)}` : `${f.Status} ${fmt(f.DoneAt, "DD-MM-YYYY HH:mm")}${f.Status === "cancelled" ? "" : ` by ${f.DoneByName ?? "—"}`}`}
                      {f.IsOverdue ? " · overdue" : ""}
                    </div>
                    {(f.Outcome || f.Remarks) && <div style={{ fontSize: "calc(13rem / 15)", marginTop: 2 }}>{[f.Outcome, f.Remarks].filter(Boolean).join(" — ")}</div>}
                    {f.Status === "open" && f.AssignedToName && <div style={{ fontSize: "calc(12rem / 15)", marginTop: 2 }}>Assigned to {f.AssignedToName}</div>}
                  </div>
                  {f.Status === "open"
                    ? canAct(f) && <div style={{ display: "flex", gap: "calc(6rem / 15)" }}>
                        <Button size="sm" variant="ghost" onClick={() => setRescheduling(f)} data-testid={`reschedule-followup-${f.Id}`}>Reschedule</Button>
                        <Button size="sm" variant="primary" onClick={() => setLogging(f)} data-testid={`log-followup-${f.Id}`}>Log</Button>
                      </div>
                    : <Chip label={{ done: "Done", cancelled: "Cancelled" }[f.Status] ?? "Skipped"} size="sm" />}
                  {f.Status === "open" && <Chip label="Open" size="sm" tone="primary" />}
                </div>
              </Card>
            ))}
          </div>
        )}

        <div hidden={tab !== "quotations"}><LeadQuotations lead={lead} onCount={setQuoteCount} /></div>

        {tab === "history" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "calc(20rem / 15)" }}>
            <Card>
              <h3 style={{ margin: "0 0 calc(12rem / 15)", fontSize: "calc(15rem / 15)", fontWeight: 700 }}>Assignments</h3>
              {assignments.length === 0 ? <div style={{ fontSize: "calc(13rem / 15)" }}>Never assigned.</div> : assignments.map((a) => (
                <div key={a.Id} data-testid="assignment-item" style={{ fontSize: "calc(13rem / 15)", padding: "calc(6rem / 15) 0" }}>
                  <strong>{fmt(a.AssignedAt, "DD-MM-YYYY HH:mm")}</strong> · {a.FromUserName ?? "Unassigned"} → {a.ToUserName ?? "Unassigned"}
                  {a.ToBranchName && a.FromBranchName !== a.ToBranchName ? ` (${a.ToBranchName})` : ""}
                  {a.Reason ? ` · ${a.Reason}` : ""} — {a.Remarks} <em>by {a.AssignedByName}</em>
                </div>
              ))}
            </Card>
            <Timeline activity={activity} />
          </div>
        )}
      </div>

      <Modal open={Boolean(lostPick)} onClose={() => setLostPick(null)} size="sm" data-testid="lost-reason-modal">
        <Modal.Header title="Why was this lead lost?" onClose={() => setLostPick(null)} />
        <Modal.Body><Combobox label="Reason" required options={lostOpts} value={lostReason} onChange={setLostReason} data-testid="lost-reason" /></Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={() => setLostPick(null)}>Cancel</Button>
          <Button variant="primary" onClick={submitLost} disabled={!lostReason} loading={statusMutation.isPending} data-testid="lost-reason-submit">Mark lost</Button>
        </Modal.Footer>
      </Modal>

      <Modal open={scheduleOpen} onClose={() => setScheduleOpen(false)} size="sm" data-testid="schedule-modal">
        <Modal.Header title="Schedule follow-up" onClose={() => setScheduleOpen(false)} />
        <Modal.Body>
          <div style={{ display: "flex", flexDirection: "column", gap: "calc(16rem / 15)" }}>
            {/* disableClearable: a follow-up with no type is not a thing the
                SP accepts, and a cleared value would blow up submitSchedule. */}
            <Combobox label="Type" disableClearable options={FOLLOWUP_TYPES} value={scheduleType} onChange={setScheduleType} data-testid="schedule-type" />
            <DueInputs dateLabel="Due" required date={scheduleDate} time={scheduleTime} onDateChange={setScheduleDate} onTimeChange={setScheduleTime} dateTestId="schedule-date" timeTestId="schedule-time" />
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={() => setScheduleOpen(false)}>Cancel</Button>
          <Button variant="primary" onClick={submitSchedule} disabled={!scheduleDate || !scheduleType || isPastDue(scheduleDate, scheduleTime)} loading={scheduleMutation.isPending} data-testid="schedule-submit">Schedule</Button>
        </Modal.Footer>
      </Modal>

      <LogFollowUpModal open={Boolean(logging)} followUp={logging} onClose={() => setLogging(null)} onLogged={refetch} />
      <RescheduleFollowUpModal open={Boolean(rescheduling)} followUp={rescheduling} onClose={() => setRescheduling(null)} onDone={refetch} />
      <TransferLeadModal
        open={Boolean(moving)}
        leadIds={[leadId]}
        sendBackTo={moving === "back" ? { id: lead.SendBackToId, name: lead.SendBackToName } : null}
        onClose={() => setMoving(null)}
        onDone={onMoved}
        onFailed={refetch}
        onError={onActionError}
      />
      <LeadCreateModal open={editOpen} lead={lead} onClose={() => setEditOpen(false)} onSaved={refetch} />
      <WonDialog open={wonOpen} lead={lead} onClose={() => setWonOpen(false)} onWon={refetch} />
    </div>
  );
}
