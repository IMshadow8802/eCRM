import { useSortable } from "@dnd-kit/react/sortable";
import { useTheme } from "@mui/material/styles";
import { Calendar } from "lucide-react";
import dayjs from "dayjs";

import { Chip, Avatar } from "../../components/ui";

function formatCurrency(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  return `₹${n.toLocaleString("en-IN")}`;
}

// Owner name isn't joined by sp_FetchLeads (only the raw OwnerId FK) — fall
// back to a numbered label rather than inventing a lookup this page has no
// data for.
function ownerLabel(lead) {
  if (lead.OwnerName) return lead.OwnerName;
  if (lead.OwnerId != null) return `Owner #${lead.OwnerId}`;
  return "Unassigned";
}

export default function PipelineCard({ lead, index = 0, stageId }) {
  const theme = useTheme();
  const p = theme.tokens;
  const { ref: sortableRef, isDragging } = useSortable({
    id: `lead-${lead.Id}`,
    index,
    type: "lead",
    accepts: "lead",
    group: stageId ?? lead.StageId ?? "default",
    data: { leadId: lead.Id, stageId: stageId ?? lead.StageId ?? null },
  });

  const estValue = formatCurrency(lead.EstValue);
  const owner = ownerLabel(lead);

  return (
    <div
      ref={sortableRef}
      data-testid={`pipeline-card-${lead.Id}`}
      style={{
        padding: 14,
        marginBottom: 10,
        borderRadius: theme.radii.md,
        backgroundColor: p.surface.card,
        border: `1px solid ${p.border.default}`,
        cursor: "grab",
        opacity: isDragging ? 0.6 : 1,
        boxShadow: isDragging ? p.shadow.lg : p.shadow.xs,
      }}
    >
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: p.text.primary,
          marginBottom: 8,
          wordBreak: "break-word",
          lineHeight: 1.4,
        }}
      >
        {lead.Name}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {estValue && <Chip label={estValue} tone="success" size="sm" variant="tonal" />}
        {lead.NextFollowupDate && (
          <Chip
            label={dayjs(lead.NextFollowupDate).format("DD-MM-YYYY")}
            icon={<Calendar size={11} />}
            tone="default"
            size="sm"
            variant="tonal"
            data-testid={`pipeline-followup-${lead.Id}`}
          />
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Avatar name={owner} size="xs" />
        <span style={{ fontSize: 11, fontWeight: 500, color: p.text.secondary }}>{owner}</span>
      </div>
    </div>
  );
}
