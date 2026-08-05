import { useDroppable } from "@dnd-kit/core";
import { useTheme } from "@mui/material/styles";

/**
 * A droppable stage column for the Pipeline and Ticket boards.
 *
 * PipelineColumn and TicketColumn were byte-identical apart from their
 * `data-testid` prefix and which card they rendered — the same 70 lines of
 * drop-target styling, header dot, title and count badge twice over. The count
 * badge and the drop-target highlight are the parts that must not drift: a
 * board where one column highlights differently on hover reads as a bug.
 *
 * Cards come through `children` rather than a render prop because the two
 * boards pass entirely different card props (tickets carry a priority map, a
 * user list and an open handler; leads carry none of that), and threading
 * those through a generic column would put ticket vocabulary in a shared file.
 *
 * KanbanColumn deliberately does NOT use this: it also owns rename, delete,
 * WIP capacity and an orphan-column case, which is a different component that
 * happens to be a column too.
 */
export default function BoardColumn({ stage, count, testId, children }) {
  const theme = useTheme();
  const p = theme.tokens;
  const { setNodeRef: dropRef, isOver: isDropTarget } = useDroppable({
    id: `stage-${stage.Id}`,
    data: { stageId: stage.Id },
  });

  const dot = stage.Color || p.text.tertiary;

  return (
    <div
      data-testid={testId}
      style={{
        flex: "0 0 300px",
        minWidth: 300,
        backgroundColor: isDropTarget ? p.primary.subtle : p.surface.subtle,
        borderRadius: theme.radii.lg,
        border: `1px solid ${isDropTarget ? p.primary.border : p.border.default}`,
        display: "flex",
        flexDirection: "column",
        maxHeight: "calc(100vh - 240px)",
        transition:
          "background-color 240ms cubic-bezier(0.4,0,0.2,1), border-color 240ms cubic-bezier(0.4,0,0.2,1)",
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
            background: dot,
            // The stage colour at 13% alpha as a halo. Appended as hex rather
            // than rgba() because tblPipelineStage.Color is stored as #rrggbb.
            boxShadow: `0 0 0 3px ${dot}22`,
          }}
        />
        <span
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: 700,
            color: p.text.primary,
            letterSpacing: "0.01em",
          }}
        >
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
          {count}
        </div>
      </div>

      <div ref={dropRef} style={{ padding: 10, overflowY: "auto", flex: 1, minHeight: 100 }}>
        {children}
      </div>
    </div>
  );
}
