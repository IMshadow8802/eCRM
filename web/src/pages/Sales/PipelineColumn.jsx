import { useDroppable } from "@dnd-kit/react";
import { useTheme } from "@mui/material/styles";

import PipelineCard from "./PipelineCard";

export default function PipelineColumn({ stage, leads }) {
  const theme = useTheme();
  const p = theme.tokens;
  const { ref: dropRef, isDropTarget } = useDroppable({
    id: `stage-${stage.Id}`,
    type: "stage",
    accepts: "lead",
    data: { stageId: stage.Id },
  });

  return (
    <div
      data-testid={`pipeline-stage-${stage.Id}`}
      style={{
        flex: "0 0 300px",
        minWidth: 300,
        backgroundColor: isDropTarget ? p.primary.subtle : p.surface.subtle,
        borderRadius: theme.radii.lg,
        border: `1px solid ${isDropTarget ? p.primary.border : p.border.default}`,
        display: "flex",
        flexDirection: "column",
        maxHeight: "calc(100vh - 240px)",
        transition: "background-color 240ms cubic-bezier(0.4,0,0.2,1), border-color 240ms cubic-bezier(0.4,0,0.2,1)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 14px",
          borderBottom: `1px solid ${p.border.subtle}`,
        }}
      >
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: theme.radii.full,
            background: stage.Color || p.text.tertiary,
            boxShadow: `0 0 0 3px ${stage.Color || p.text.tertiary}22`,
          }}
        />
        <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: p.text.primary, letterSpacing: "0.01em" }}>
          {stage.Name}
        </span>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: p.text.tertiary,
            padding: "2px 8px",
            borderRadius: theme.radii.full,
            backgroundColor: p.surface.card,
          }}
        >
          {leads.length}
        </div>
      </div>

      <div ref={dropRef} style={{ padding: 10, overflowY: "auto", flex: 1, minHeight: 100 }}>
        {leads.map((lead, idx) => (
          <PipelineCard key={lead.Id} lead={lead} index={idx} stageId={stage.Id} />
        ))}
      </div>
    </div>
  );
}
