import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useTheme } from "@mui/material/styles";
import { PhoneCall, Save as SaveIcon } from "lucide-react";
import dayjs from "dayjs";

import { PageHeader, Card, Chip, Button, Tabs, EmptyState, Skeleton } from "../../components/ui";
import DynamicField from "../../components/DynamicField";
import { useApiQuery } from "../../hooks/useApiQuery";
import { useApiMutation } from "../../hooks/useApiMutation";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import Timeline from "./Timeline";
import LogCallModal from "./LogCallModal";

// A `fields` row is the custom-field def joined with its current value
// (one of ValueText/ValueNumber/ValueDate populated, chosen by Type).
const fieldDef = (row) => ({
  Id: row.FieldId,
  Label: row.Label,
  Type: row.Type,
  Options: row.Options,
  IsRequired: row.IsRequired,
});

const fieldValue = (row) => {
  switch (row.Type) {
    case "number":
      return row.ValueNumber ?? "";
    case "date":
      return row.ValueDate ?? "";
    case "checkbox":
      return Boolean(row.ValueNumber);
    case "dropdown":
      return row.ValueText ?? null;
    case "text":
    default:
      return row.ValueText ?? "";
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

export default function LeadDetail({ leadId: leadIdProp }) {
  const { leadId: leadIdParam } = useParams();
  const leadId = Number(leadIdProp ?? leadIdParam);

  const [tab, setTab] = useState("details");
  const [callModalOpen, setCallModalOpen] = useState(false);
  const [draft, setDraft] = useState({});

  const { data, isLoading, refetch } = useApiQuery({
    queryKey: ["lead-detail", leadId],
    endpoint: SALES_ENDPOINTS.leads.fetchLeadDetail,
    params: { LeadId: leadId },
    enabled: Boolean(leadId),
    showErrorMessage: false,
  });

  const lead = data?.lead ?? null;
  const fields = useMemo(() => data?.fields ?? [], [data]);
  const activity = data?.activity ?? [];

  // Draft mirrors the fetched field values so edits are local until saved.
  useEffect(() => {
    const seeded = {};
    fields.forEach((row) => {
      seeded[row.FieldId] = fieldValue(row);
    });
    setDraft(seeded);
  }, [fields]);

  const isDirty = fields.some((row) => draft[row.FieldId] !== fieldValue(row));

  const saveMutation = useApiMutation({
    endpoint: SALES_ENDPOINTS.leads.saveLeads,
    successMessage: "Lead saved",
  });

  const saveCustomFields = async () => {
    const customJson = fields.map((row) => ({
      fieldId: row.FieldId,
      type: row.Type,
      value: draft[row.FieldId],
    }));
    try {
      await saveMutation.mutateAsync({
        Id: lead?.Id ?? leadId,
        Name: lead?.Name,
        MobileNo: lead?.MobileNo,
        AltMobile: lead?.AltMobile,
        Email: lead?.Email,
        SourceId: lead?.SourceId,
        PipelineId: lead?.PipelineId,
        StageId: lead?.StageId,
        OwnerId: lead?.OwnerId,
        EstValue: lead?.EstValue,
        NextFollowupDate: lead?.NextFollowupDate,
        CustomJSON: JSON.stringify(customJson),
      });
      refetch();
    } catch {
      // useApiMutation already surfaced an error toast.
    }
  };

  if (isLoading || !lead) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="lead-detail-loading">
        <Skeleton variant="text" height={28} width={240} />
        <Skeleton variant="rect" height={160} />
      </div>
    );
  }

  return (
    <div data-testid="lead-detail">
      <PageHeader
        title={lead.Name}
        subtitle={[lead.MobileNo, lead.Email].filter(Boolean).join(" · ")}
        titleSuffix={
          <Chip
            label={lead.StageName || "No stage"}
            tone="primary"
            size="sm"
            data-testid="lead-stage-chip"
          />
        }
        actions={
          <Button
            variant="primary"
            leftIcon={<PhoneCall size={14} />}
            onClick={() => setCallModalOpen(true)}
            data-testid="log-call-btn"
          >
            Log Call
          </Button>
        }
      />

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: "details", label: "Details" },
          { value: "timeline", label: "Timeline", badge: activity.length },
        ]}
        data-testid="lead-detail-tabs"
      />

      <div style={{ marginTop: 20 }}>
        {tab === "details" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <Card data-testid="lead-core-info">
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                  gap: 16,
                }}
              >
                <InfoItem label="Mobile" value={lead.MobileNo} />
                <InfoItem label="Email" value={lead.Email} />
                <InfoItem label="Estimated value" value={lead.EstValue} />
                <InfoItem label="Owner" value={lead.OwnerName} />
                <InfoItem label="Source" value={lead.SourceName} />
                <InfoItem
                  label="Next follow-up"
                  value={
                    lead.NextFollowupDate
                      ? dayjs(lead.NextFollowupDate).format("DD-MM-YYYY")
                      : null
                  }
                />
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
                  description="This company hasn't configured any custom fields for leads yet."
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
                  {fields.map((row) => (
                    <DynamicField
                      key={row.FieldId}
                      field={fieldDef(row)}
                      value={draft[row.FieldId]}
                      onChange={(v) =>
                        setDraft((d) => ({ ...d, [row.FieldId]: v }))
                      }
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
        leadId={leadId}
        onLogged={refetch}
      />
    </div>
  );
}
