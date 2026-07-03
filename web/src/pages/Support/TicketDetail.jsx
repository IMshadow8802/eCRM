import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useTheme } from "@mui/material/styles";
import { PhoneCall, Save as SaveIcon, CheckCircle, XCircle, RotateCcw } from "lucide-react";
import dayjs from "dayjs";

import {
  PageHeader,
  Card,
  Chip,
  Button,
  Tabs,
  EmptyState,
  Skeleton,
  Modal,
  Combobox,
} from "../../components/ui";
import DynamicField from "../../components/DynamicField";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useApiMutation } from "../../hooks/useApiMutation";
import { useUsers } from "../../hooks";
import { findUserById, getUserName } from "../../utils/userShape";
import { SUPPORT_ENDPOINTS } from "../../api/supportQueries";
import Timeline from "../Sales/Timeline";
import LogCallModal from "../Sales/LogCallModal";

// fetchTicketDetail's `fields` recordset only carries stored value columns
// (ValueText/ValueNumber/ValueDate) for fields that HAVE a value — no
// Options/IsRequired. Those live on the definitions fetched separately via
// fetchCustomFields and merged in by FieldId, exactly like LeadDetail.
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

export default function TicketDetail({ ticketId: ticketIdProp }) {
  const { ticketId: ticketIdParam } = useParams();
  const ticketId = Number(ticketIdProp ?? ticketIdParam);

  const [tab, setTab] = useState("details");
  const [callModalOpen, setCallModalOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolution, setResolution] = useState(null);
  const [draft, setDraft] = useState({});

  const { data, isLoading, refetch } = useApiQuery({
    queryKey: ["ticket-detail", ticketId],
    endpoint: SUPPORT_ENDPOINTS.tickets.fetchTicketDetail,
    params: { TicketId: ticketId },
    enabled: Boolean(ticketId),
    showErrorMessage: false,
  });

  const { data: defsData } = useApiQuery({
    queryKey: ["custom-field-defs", "ticket"],
    endpoint: SUPPORT_ENDPOINTS.config.fetchCustomFields,
    params: { Entity: "ticket" },
    showErrorMessage: false,
  });

  // sp_FetchTicketDetail returns raw FK ids only — resolve stage/priority/
  // category/assignee display names client-side, like LeadDetail does.
  const { data: usersData } = useUsers({ PageSize: 1000 });
  const users = usersData?.users || [];
  const { data: prioritiesData } = useApiQuery({
    queryKey: ["ticket-lookups", "priority"],
    endpoint: SUPPORT_ENDPOINTS.config.fetchLookups,
    params: { Kind: "priority" },
    showErrorMessage: false,
  });
  const priorities = prioritiesData?.lookups || [];
  const { data: categoriesData } = useApiQuery({
    queryKey: ["ticket-lookups", "category"],
    endpoint: SUPPORT_ENDPOINTS.config.fetchLookups,
    params: { Kind: "category" },
    showErrorMessage: false,
  });
  const categories = categoriesData?.lookups || [];
  const { data: resolutionsData } = useApiQuery({
    queryKey: ["ticket-lookups", "resolution"],
    endpoint: SUPPORT_ENDPOINTS.config.fetchLookups,
    params: { Kind: "resolution" },
    showErrorMessage: false,
  });
  const resolutions = resolutionsData?.lookups || [];
  const { data: pipelinesData } = useApiQuery({
    queryKey: ["support-pipelines", "ticket"],
    endpoint: SUPPORT_ENDPOINTS.config.fetchPipelines,
    params: { Entity: "ticket" },
    showErrorMessage: false,
  });
  const stages = pipelinesData?.stages || [];

  const ticket = data?.ticket ?? null;
  const activity = data?.activity ?? [];
  const linkedLead = data?.linkedLead ?? null;

  const stageName = stages.find((s) => s.Id === ticket?.StageId)?.Name;
  const priorityName = priorities.find((l) => l.Id === ticket?.Priority)?.Value;
  const categoryName = categories.find((l) => l.Id === ticket?.CategoryId)?.Value;
  const assigneeName = getUserName(findUserById(users, ticket?.AssignedTo));
  const isClosedOrResolved = Boolean(ticket?.ResolvedAt || ticket?.ClosedAt);

  // Merge field definitions (Options/IsRequired/order) with stored values
  // keyed by FieldId. Definitions drive rendering so blank fields still show.
  const fields = useMemo(() => {
    const defs = defsData?.customFields ?? [];
    const valueByFieldId = new Map((data?.fields ?? []).map((v) => [v.FieldId, v]));
    return defs.map((def) => ({ def, valueRow: valueByFieldId.get(def.Id) }));
  }, [defsData, data]);

  useEffect(() => {
    const seeded = {};
    fields.forEach(({ def, valueRow }) => {
      seeded[def.Id] = fieldValue(def, valueRow);
    });
    setDraft(seeded);
  }, [fields]);

  const isDirty = fields.some(({ def, valueRow }) => draft[def.Id] !== fieldValue(def, valueRow));

  const saveMutation = useApiMutation({
    endpoint: SUPPORT_ENDPOINTS.tickets.saveTicket,
    successMessage: "Ticket saved",
  });
  const resolveMutation = useApiMutation({
    endpoint: SUPPORT_ENDPOINTS.tickets.resolveTicket,
    successMessage: "Ticket resolved",
  });
  const closeMutation = useApiMutation({
    endpoint: SUPPORT_ENDPOINTS.tickets.closeTicket,
    successMessage: "Ticket closed",
  });
  const reopenMutation = useApiMutation({
    endpoint: SUPPORT_ENDPOINTS.tickets.reopenTicket,
    successMessage: "Ticket reopened",
  });

  const saveCustomFields = async () => {
    const customJson = fields.map(({ def }) => ({
      fieldId: def.Id,
      type: def.Type,
      value: draft[def.Id],
    }));
    try {
      await saveMutation.mutateAsync({
        Id: ticket?.Id ?? ticketId,
        CustomerName: ticket?.CustomerName,
        Contact: ticket?.Contact,
        Channel: ticket?.Channel,
        CategoryId: ticket?.CategoryId,
        Priority: ticket?.Priority,
        PipelineId: ticket?.PipelineId,
        StageId: ticket?.StageId,
        AssignedTo: ticket?.AssignedTo,
        LinkedLeadId: ticket?.LinkedLeadId,
        Description: ticket?.Description,
        CustomJSON: JSON.stringify(customJson),
      });
      refetch();
    } catch {
      // useApiMutation already surfaced an error toast.
    }
  };

  const runAction = async (mutation, extra = {}) => {
    try {
      await mutation.mutateAsync({ TicketId: ticket?.Id ?? ticketId, ...extra });
      refetch();
    } catch {
      // toast handled by useApiMutation
    }
  };

  const submitResolve = async () => {
    if (!resolution) return;
    await runAction(resolveMutation, { ResolutionId: resolution.value });
    setResolveOpen(false);
    setResolution(null);
  };

  if (isLoading || !ticket) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="ticket-detail-loading">
        <Skeleton variant="text" height={28} width={240} />
        <Skeleton variant="rect" height={160} />
      </div>
    );
  }

  const slaChip = ticket.IsBreached ? (
    <Chip label="Breached" tone="error" variant="solid" size="sm" data-testid="ticket-sla-chip" />
  ) : (
    <Chip
      label={ticket.SLADueAt ? `SLA ${dayjs(ticket.SLADueAt).format("DD-MM-YYYY")}` : "No SLA"}
      tone="warning"
      size="sm"
      data-testid="ticket-sla-chip"
    />
  );

  return (
    <div data-testid="ticket-detail">
      <PageHeader
        title={ticket.TicketNo}
        subtitle={ticket.CustomerName}
        titleSuffix={
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Chip label={stageName || "No stage"} tone="primary" size="sm" data-testid="ticket-stage-chip" />
            {slaChip}
            {priorityName && (
              <Chip label={priorityName} tone="accent" size="sm" data-testid="ticket-priority-chip" />
            )}
          </div>
        }
        actions={
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Button
              variant="ghost"
              leftIcon={<PhoneCall size={14} />}
              onClick={() => setCallModalOpen(true)}
              data-testid="log-call-btn"
            >
              Log Call
            </Button>
            {isClosedOrResolved ? (
              <Button
                variant="secondary"
                leftIcon={<RotateCcw size={14} />}
                onClick={() => runAction(reopenMutation)}
                loading={reopenMutation.isPending}
                data-testid="reopen-btn"
              >
                Reopen
              </Button>
            ) : (
              <>
                <Button
                  variant="secondary"
                  leftIcon={<XCircle size={14} />}
                  onClick={() => runAction(closeMutation)}
                  loading={closeMutation.isPending}
                  data-testid="close-btn"
                >
                  Close
                </Button>
                <Button
                  variant="primary"
                  leftIcon={<CheckCircle size={14} />}
                  onClick={() => setResolveOpen(true)}
                  data-testid="resolve-btn"
                >
                  Resolve
                </Button>
              </>
            )}
          </div>
        }
      />

      {linkedLead && (
        <div style={{ marginBottom: 8 }}>
          <a
            href={`/sales/leads/${linkedLead.Id}`}
            data-testid="linked-lead-link"
            style={{ fontSize: 13, fontWeight: 600 }}
          >
            Linked lead: {linkedLead.Name}
          </a>
        </div>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: "details", label: "Details" },
          { value: "timeline", label: "Timeline", badge: activity.length },
        ]}
        data-testid="ticket-detail-tabs"
      />

      <div style={{ marginTop: 20 }}>
        {tab === "details" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <Card data-testid="ticket-core-info">
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                  gap: 16,
                }}
              >
                <InfoItem label="Contact" value={ticket.Contact} />
                <InfoItem label="Channel" value={ticket.Channel} />
                <InfoItem label="Category" value={categoryName} />
                <InfoItem label="Priority" value={priorityName} />
                <InfoItem label="Assignee" value={assigneeName} />
                <InfoItem
                  label="SLA due"
                  value={ticket.SLADueAt ? dayjs(ticket.SLADueAt).format("DD-MM-YYYY HH:mm") : null}
                />
                <InfoItem
                  label="Resolved"
                  value={ticket.ResolvedAt ? dayjs(ticket.ResolvedAt).format("DD-MM-YYYY") : null}
                />
                <InfoItem
                  label="Closed"
                  value={ticket.ClosedAt ? dayjs(ticket.ClosedAt).format("DD-MM-YYYY") : null}
                />
                <InfoItem label="Description" value={ticket.Description} />
              </div>
            </Card>

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
              {fields.length === 0 ? (
                <EmptyState
                  title="No custom fields"
                  description="This company hasn't configured any custom fields for tickets yet."
                  size="sm"
                  data-testid="custom-fields-empty"
                />
              ) : (
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
                      onChange={(v) => setDraft((d) => ({ ...d, [def.Id]: v }))}
                    />
                  ))}
                </div>
              )}
            </Card>
          </div>
        )}

        {tab === "timeline" && <Timeline activity={activity} />}
      </div>

      <LogCallModal
        open={callModalOpen}
        onClose={() => setCallModalOpen(false)}
        ticketId={ticketId}
        onLogged={refetch}
      />

      <Modal open={resolveOpen} onClose={() => setResolveOpen(false)} size="sm" data-testid="resolve-modal">
        <Modal.Header title="Resolve ticket" icon={<CheckCircle size={18} />} onClose={() => setResolveOpen(false)} />
        <Modal.Body>
          <Combobox
            label="Resolution"
            required
            options={resolutions.map((l) => ({ value: l.Id, label: l.Value }))}
            value={resolution}
            onChange={setResolution}
            placeholder="Pick a resolution"
            data-testid="resolution-combobox"
          />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={() => setResolveOpen(false)} disabled={resolveMutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submitResolve}
            disabled={!resolution}
            loading={resolveMutation.isPending}
            data-testid="resolve-submit"
          >
            Resolve
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
