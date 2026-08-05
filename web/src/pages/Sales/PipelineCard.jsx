import { memo, useMemo } from "react";
import { useDraggable } from "@dnd-kit/core";
import { useTheme } from "@mui/material/styles";
import { Calendar } from "lucide-react";
import dayjs from "dayjs";

import { Chip, Avatar } from "../../components/ui";
import { formatCurrency } from "../../utils/format";

// Owner name isn't joined by sp_FetchLeads (only the raw OwnerId FK) — fall
// back to a numbered label rather than inventing a lookup this page has no
// data for.
function ownerLabel(lead) {
  if (lead.OwnerName) return lead.OwnerName;
  if (lead.OwnerId != null) return `Owner #${lead.OwnerId}`;
  return "Unassigned";
}

/**
 * Pure presentational card. Shared by the draggable wrapper (below) and the
 * DragOverlay clone, so the visual never diverges. No dnd hooks here — the
 * overlay renders this directly while the real card is dimmed in place, which
 * is why the library never has to reparent a live node (the crash we fixed).
 */
export const PipelineCardView = memo(function PipelineCardView({
  lead,
  dragging = false,
  overlay = false,
  dragRef,
  dragHandleProps = {},
}) {
  const theme = useTheme();
  const p = theme.tokens;

  const estValue = formatCurrency(lead.EstValue);
  const owner = ownerLabel(lead);

  return (
    <div
      ref={dragRef}
      {...dragHandleProps}
      data-testid={`pipeline-card-${lead.Id}`}
      style={{
        padding: 14,
        marginBottom: overlay ? 0 : 10,
        borderRadius: theme.radii.md,
        backgroundColor: p.surface.card,
        border: `1px solid ${p.border.default}`,
        cursor: overlay ? "grabbing" : "grab",
        // Dim the real card while its overlay clone follows the cursor.
        opacity: dragging && !overlay ? 0.4 : 1,
        boxShadow: overlay ? p.shadow.lg : p.shadow.xs,
        willChange: overlay ? "transform" : undefined,
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
});

/**
 * Draggable pipeline card (stable @dnd-kit/core). Stage columns are the
 * droppables; cards are draggable-only — we persist only which stage a card
 * lands in, not intra-column order, so no SortableContext is needed.
 */
export default function PipelineCard({ lead, stageId }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `lead-${lead.Id}`,
    data: { leadId: lead.Id, stageId: stageId ?? lead.StageId ?? null, lead },
  });

  // Stable ref so the memoized view bails while other cards are dragged.
  const dragHandleProps = useMemo(
    () => ({ ...listeners, ...attributes }),
    [listeners, attributes],
  );

  return (
    <PipelineCardView
      lead={lead}
      dragging={isDragging}
      dragRef={setNodeRef}
      dragHandleProps={dragHandleProps}
    />
  );
}
