import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useTheme } from "@mui/material/styles";
import { ArrowRightLeft, CalendarPlus, Pencil, Save as SaveIcon } from "lucide-react";
import dayjs from "dayjs";

import { PageHeader, Card, Chip, Button, Tabs, EmptyState, Skeleton, Combobox, Modal, DateField } from "../../components/ui";
import DynamicField from "../../components/DynamicField";
import Attachments from "../../components/Attachments";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useApiMutation } from "../../hooks/useApiMutation";
import { useLookups } from "../../hooks/useLookups";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import { FOLLOWUP_TYPES } from "./leadStatus";
import Timeline from "./Timeline";
import LogFollowUpModal from "./LogFollowUpModal";
import TransferLeadModal from "./TransferLeadModal";
import LeadCreateModal from "./LeadCreateModal";

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
      <div style={{ fontSize: 12, fontWeight: 500, color: p.text.tertiary }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2, color: p.text.primary }}>
        {value || "—"}
      </div>
    </div>
  );
}

const fmt = (d, f = "DD-MM-YYYY") => (d ? dayjs(d).format(f) : null);

export default function LeadDetail({ leadId: leadIdProp }) {
  const { leadId: leadIdParam } = useParams();
  const leadId = Number(leadIdProp ?? leadIdParam);

  const [tab, setTab] = useState("details");
  const [editOpen, setEditOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [logging, setLogging] = useState(null);          // follow-up row being completed
  const [lostPick, setLostPick] = useState(null);        // status option awaiting a reason
  const [lostReason, setLostReason] = useState(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleType, setScheduleType] = useState(FOLLOWUP_TYPES[0]);
  const [scheduleDate, setScheduleDate] = useState("");
  const [draft, setDraft] = useState({});

  // sp_FetchLeadDetail joins the labels itself (StatusName, OwnerName,
  // ProductName, SourceName, BranchName), so this page resolves nothing
  // client-side — one round-trip, and no stale name from a separate cache.
  const { data, isLoading, refetch } = useApiQuery({
    queryKey: ["lead-detail", leadId], endpoint: SALES_ENDPOINTS.leads.fetchLeadDetail,
    params: { LeadId: leadId }, enabled: Boolean(leadId), showErrorMessage: false,
  });
  const { data: defsData } = useApiQuery({
    queryKey: ["custom-field-defs", "lead"], endpoint: SALES_ENDPOINTS.config.fetchCustomFields,
    params: { Entity: "lead" }, showErrorMessage: false,
  });
  const { lookups: statuses } = useLookups("lead_status", { showErrorMessage: false });
  const { lookups: lostReasons } = useLookups("lost_reason", { enabled: Boolean(lostPick), showErrorMessage: false });

  const lead = data?.lead ?? null;
  const activity = data?.activity ?? [];
  const followups = data?.followups ?? [];
  const assignments = data?.assignments ?? [];
  const openFollowups = followups.filter((f) => f.Status === "open");

  // `converted` is not a status you pick — it is the outcome of the conversion
  // flow, and setLeadStatus refuses it. Offering it here would only ever
  // produce a server error. `junk` stays: the SP accepts it as a manual
  // terminal status.
  const statusOpts = useMemo(
    () => statuses.filter((s) => s.Code !== "converted").map((s) => ({ value: s.Id, label: s.Value, code: s.Code })),
    [statuses],
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
      // holds. OwnerId/StatusId are ignored on update (transfer/setStatus own
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

  const statusMutation = useApiMutation({ endpoint: SALES_ENDPOINTS.leads.setLeadStatus, successMessage: "Status updated", invalidateQueries: [["lead-detail", leadId], ["leads"]] });
  const scheduleMutation = useApiMutation({ endpoint: SALES_ENDPOINTS.followups.scheduleFollowUp, successMessage: "Follow-up scheduled", invalidateQueries: [["lead-detail", leadId], ["followups"], ["leads"]] });

  // Lost needs a reason — the SP refuses without one, so ask before posting.
  const onStatusPick = (opt) => {
    if (!opt || opt.value === lead?.StatusId) return;
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
    await scheduleMutation.mutateAsync({ LeadId: leadId, Type: scheduleType.value, DueAt: scheduleDate });
    setScheduleOpen(false); setScheduleDate("");
  };

  if (isLoading || !lead) return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="lead-detail-loading">
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
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ width: 180 }}>
              {/* blurOnSelect: picking `lost` opens a modal instead of moving
                  the status, and a focused Autocomplete keeps showing what was
                  picked. Blurring resyncs the input to the controlled value, so
                  a dismissed prompt cannot leave the header contradicting the
                  chip beside it. */}
              <Combobox size="sm" blurOnSelect options={statusOpts} value={statusOpts.find((o) => o.value === lead.StatusId) ?? null} onChange={onStatusPick} placeholder="Status" data-testid="lead-status-select" />
            </div>
            <Button variant="tonal" leftIcon={<Pencil size={14} />} onClick={() => setEditOpen(true)} data-testid="edit-lead-btn">Edit</Button>
            <Button variant="tonal" leftIcon={<ArrowRightLeft size={14} />} onClick={() => setTransferOpen(true)} data-testid="transfer-lead-btn">Transfer</Button>
            {openFollowups[0]
              ? <Button variant="primary" onClick={() => setLogging(openFollowups[0])} data-testid="log-followup-btn">Log follow-up</Button>
              : <Button variant="primary" leftIcon={<CalendarPlus size={14} />} onClick={() => setScheduleOpen(true)} data-testid="schedule-followup-btn">Schedule follow-up</Button>}
          </div>
        }
      />

      <Tabs value={tab} onChange={setTab} data-testid="lead-detail-tabs" items={[
        { value: "details", label: "Details" },
        { value: "followups", label: "Follow-ups", badge: openFollowups.length },
        { value: "history", label: "History", badge: activity.length },
      ]} />

      <div style={{ marginTop: 20 }}>
        {tab === "details" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <Card data-testid="lead-core-info">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 16 }}>
                <InfoItem label="Mobile" value={lead.MobileNo} />
                <InfoItem label="Alternate" value={lead.AltMobile} />
                <InfoItem label="Email" value={lead.Email} />
                <InfoItem label="Product" value={lead.ProductName} />
                <InfoItem label="Estimated value" value={lead.EstValue} />
                <InfoItem label="Owner" value={lead.OwnerName || "Unassigned"} />
                <InfoItem label="Branch" value={lead.BranchName} />
                <InfoItem label="Source" value={lead.SourceName} />
                <InfoItem label="Next follow-up" value={fmt(lead.NextFollowupDate)} />
                <InfoItem label="Assigned since" value={fmt(lead.AssignedAt)} />
                {Boolean(lead.LostReason) && <InfoItem label="Lost reason" value={lead.LostReason} />}
              </div>
              {(address || lead.Remarks) && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
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
                    marginBottom: 16,
                  }}
                >
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Custom fields</h3>
                  <Button
                    variant="primary"
                    size="sm"
                    leftIcon={<SaveIcon size={14} />}
                    onClick={saveCustomFields}
                    disabled={!isDirty}
                    loading={saveMutation.isPending}
                    data-testid="save-custom-fields-btn"
                  >
                    Save changes
                  </Button>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                    gap: 16,
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
              <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>Attachments</h3>
              <Attachments entity="lead" entityId={lead.Id} />
            </Card>
          </div>
        )}

        {tab === "followups" && (
          <div data-testid="lead-followups" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {followups.length === 0 && <EmptyState title="No follow-ups" description="Schedule one from the header." size="sm" data-testid="followups-empty" />}
            {followups.map((f) => (
              <Card key={f.Id} data-testid="followup-item">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>
                      {FOLLOWUP_TYPES.find((t) => t.value === f.Type)?.label ?? f.Type} · {f.Status === "open" ? `due ${fmt(f.DueAt)}` : `${f.Status} ${fmt(f.DoneAt, "DD-MM-YYYY HH:mm")} by ${f.DoneByName ?? "—"}`}
                      {f.IsOverdue ? " · overdue" : ""}
                    </div>
                    {(f.Outcome || f.Remarks) && <div style={{ fontSize: 13, marginTop: 2 }}>{[f.Outcome, f.Remarks].filter(Boolean).join(" — ")}</div>}
                    {f.Status === "open" && f.AssignedToName && <div style={{ fontSize: 12, marginTop: 2 }}>Assigned to {f.AssignedToName}</div>}
                  </div>
                  {f.Status === "open"
                    ? <Button size="sm" variant="primary" onClick={() => setLogging(f)} data-testid={`log-followup-${f.Id}`}>Log</Button>
                    : <Chip label={f.Status === "done" ? "Done" : "Skipped"} size="sm" />}
                  {f.Status === "open" && <Chip label="Open" size="sm" tone="primary" />}
                </div>
              </Card>
            ))}
          </div>
        )}

        {tab === "history" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <Card>
              <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700 }}>Assignments</h3>
              {assignments.length === 0 ? <div style={{ fontSize: 13 }}>Never assigned.</div> : assignments.map((a) => (
                <div key={a.Id} data-testid="assignment-item" style={{ fontSize: 13, padding: "6px 0" }}>
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
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* disableClearable: a follow-up with no type is not a thing the
                SP accepts, and a cleared value would blow up submitSchedule. */}
            <Combobox label="Type" disableClearable options={FOLLOWUP_TYPES} value={scheduleType} onChange={setScheduleType} data-testid="schedule-type" />
            <DateField label="Due" required value={scheduleDate} onChange={setScheduleDate} data-testid="schedule-date" />
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={() => setScheduleOpen(false)}>Cancel</Button>
          <Button variant="primary" onClick={submitSchedule} disabled={!scheduleDate || !scheduleType} loading={scheduleMutation.isPending} data-testid="schedule-submit">Schedule</Button>
        </Modal.Footer>
      </Modal>

      <LogFollowUpModal open={Boolean(logging)} followUp={logging} onClose={() => setLogging(null)} onLogged={refetch} />
      <TransferLeadModal open={transferOpen} leadIds={[leadId]} canCrossBranch onClose={() => setTransferOpen(false)} onTransferred={refetch} />
      <LeadCreateModal open={editOpen} lead={lead} onClose={() => setEditOpen(false)} onSaved={refetch} />
    </div>
  );
}
