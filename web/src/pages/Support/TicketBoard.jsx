import { useMemo, useState } from "react";
import { DndContext, DragOverlay, pointerWithin } from "@dnd-kit/core";
import { CheckCircle, LifeBuoy } from "lucide-react";

import { useUsers } from "../../hooks";
import { useLookups } from "../../hooks/useLookups";
import { useStageBoard } from "../../hooks/useStageBoard";
import { SUPPORT_ENDPOINTS } from "../../api/supportQueries";
import { PageHeader, EmptyState, Modal, Combobox, Button } from "../../components/ui";
import HelpGuide from "../../components/HelpGuide";
import { HELP_GUIDES } from "../../data/helpGuides";
import TicketColumn from "./TicketColumn";
import { TicketCardView } from "./TicketCard";
import TicketDetailModal from "./TicketDetailModal";

export default function TicketBoard() {
  const board = useStageBoard({
    entity: "ticket",
    pipelineQueryKey: ["support-pipelines", "ticket"],
    fetchPipelines: SUPPORT_ENDPOINTS.config.fetchPipelines,
    itemsQueryKey: ["support-tickets"],
    fetchItems: SUPPORT_ENDPOINTS.tickets.fetchTickets,
    itemsKey: "tickets",
    moveEndpoint: SUPPORT_ENDPOINTS.tickets.moveTicketStage,
    movePayload: (TicketId, StageId, ResolutionId) => ({
      TicketId,
      StageId,
      ResolutionId,
    }),
    // First entry into a won stage needs a resolution. A Resolved -> Closed
    // drag sails through: the resolution already exists.
    needsPrompt: (targetStage, ticket) =>
      targetStage?.StageType === "won" && !ticket.ResolutionId,
    dragDataKey: "ticket",
    dragIdKey: "ticketId",
  });

  // Priority id → name, so the card chip reads "High" not "3".
  const { lookups: priorities } = useLookups("priority", {
    showErrorMessage: false,
  });
  const priorityById = useMemo(() => {
    const map = new Map();
    for (const l of priorities) map.set(l.Id, l.Value);
    return map;
  }, [priorities]);

  // AssignedTo id → user, resolved like Leads.jsx does.
  const { data: usersData } = useUsers({ PageSize: 1000 });
  const users = usersData?.users ?? [];

  // Resolutions for the drag-into-won prompt (stage is the lifecycle's source
  // of truth: entering a won stage requires a resolution, like the lead board
  // requires a lost reason).
  const { lookups: resolutions } = useLookups("resolution", {
    showErrorMessage: false,
  });
  const [resolution, setResolution] = useState(null);

  // Card "open" button -> full detail in a modal, board position preserved.
  const [detailTicketId, setDetailTicketId] = useState(null);

  const closeResolveModal = () => {
    board.setPendingMove(null);
    setResolution(null);
  };

  const submitPendingMove = async () => {
    if (!board.pendingMove || !resolution) return;
    const { id, targetStageId } = board.pendingMove;
    closeResolveModal();
    await board.commitMove(id, targetStageId, resolution.value);
  };

  // Don't flash the empty state while the pipeline query is still in flight.
  if (board.pipelinesPending) {
    return <div style={{ padding: 32 }} data-testid="ticket-board-loading" />;
  }

  if (!board.activePipeline || board.stages.length === 0) {
    return (
      <div style={{ padding: 32 }}>
        <EmptyState
          icon={<LifeBuoy size={32} />}
          title="No ticket pipeline configured"
          description="Set up a ticket pipeline with stages to see your support board here."
          size="lg"
        />
      </div>
    );
  }

  return (
    <div
      style={{
        padding: 24,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        gap: 16,
      }}
    >
      <PageHeader
        title="Ticket Board"
        subtitle={board.activePipeline.Name}
        icon={<LifeBuoy size={22} />}
        actions={<HelpGuide guide={HELP_GUIDES.tickets} />}
      />

      <DndContext
        sensors={board.sensors}
        collisionDetection={pointerWithin}
        onDragStart={board.handleDragStart}
        onDragEnd={board.handleDragEnd}
        onDragCancel={board.handleDragCancel}
      >
        <div
          style={{
            display: "flex",
            gap: 12,
            overflowX: "auto",
            paddingBottom: 12,
            flex: 1,
          }}
        >
          {board.stages.map((stage) => (
            <TicketColumn
              key={stage.Id}
              stage={stage}
              tickets={board.itemsByStage[stage.Id] || []}
              priorityById={priorityById}
              users={users}
              onOpen={setDetailTicketId}
            />
          ))}
        </div>
        <DragOverlay>
          {board.activeCard ? (
            <TicketCardView
              ticket={board.activeCard}
              priorityById={priorityById}
              users={users}
              overlay
              dragging
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      <TicketDetailModal
        ticketId={detailTicketId}
        open={Boolean(detailTicketId)}
        onClose={() => {
          setDetailTicketId(null);
          board.refetchItems(); // resolve/close in the modal must reflect on the board
        }}
      />

      <Modal
        open={Boolean(board.pendingMove)}
        onClose={closeResolveModal}
        size="sm"
        data-testid="board-resolve-modal"
      >
        <Modal.Header
          title="How was it resolved?"
          icon={<CheckCircle size={18} />}
          onClose={closeResolveModal}
        />
        <Modal.Body>
          <Combobox
            label="Resolution"
            required
            options={resolutions.map((l) => ({ value: l.Id, label: l.Value }))}
            value={resolution}
            onChange={setResolution}
            placeholder="Pick a resolution"
            data-testid="board-resolution-combobox"
          />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={closeResolveModal}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submitPendingMove}
            disabled={!resolution}
            data-testid="board-resolve-submit"
          >
            Move ticket
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
