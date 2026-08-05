import { useState } from "react";
import { DndContext, DragOverlay, pointerWithin } from "@dnd-kit/core";
import { HeartCrack, Workflow } from "lucide-react";

import { useLookups } from "../../hooks/useLookups";
import { useStageBoard } from "../../hooks/useStageBoard";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import { PageHeader, EmptyState, Modal, Combobox, Button } from "../../components/ui";
import HelpGuide from "../../components/HelpGuide";
import { HELP_GUIDES } from "../../data/helpGuides";
import PipelineColumn from "./PipelineColumn";
import { PipelineCardView } from "./PipelineCard";

export default function Pipeline() {
  const board = useStageBoard({
    entity: "lead",
    pipelineQueryKey: ["sales-pipelines", "lead"],
    fetchPipelines: SALES_ENDPOINTS.config.fetchPipelines,
    itemsQueryKey: ["sales-leads"],
    fetchItems: SALES_ENDPOINTS.leads.fetchLeads,
    itemsKey: "leads",
    moveEndpoint: SALES_ENDPOINTS.leads.moveLeadStage,
    // Only lost moves carry a reason — keep other payloads unchanged.
    movePayload: (LeadId, StageId, LostReasonId) => ({
      LeadId,
      StageId,
      ...(LostReasonId ? { LostReasonId } : {}),
    }),
    // sp_MoveLeadStage rejects a lost move without a LostReasonId, so ask first.
    needsPrompt: (targetStage) => targetStage?.StageType === "lost",
    dragDataKey: "lead",
    dragIdKey: "leadId",
  });

  const { lookups: lostReasons } = useLookups("lost_reason", {
    showErrorMessage: false,
  });
  const [lostReason, setLostReason] = useState(null);

  const closeLostModal = () => {
    board.setPendingMove(null);
    setLostReason(null);
  };

  const submitPendingMove = async () => {
    if (!board.pendingMove || !lostReason) return;
    const { id, targetStageId } = board.pendingMove;
    closeLostModal();
    await board.commitMove(id, targetStageId, lostReason.value);
  };

  // Don't flash the empty state while the pipeline query is still in flight.
  if (board.pipelinesPending) {
    return <div style={{ padding: 32 }} data-testid="pipeline-loading" />;
  }

  if (!board.activePipeline || board.stages.length === 0) {
    return (
      <div style={{ padding: 32 }}>
        <EmptyState
          icon={<Workflow size={32} />}
          title="No pipeline configured"
          description="Set up a lead pipeline with stages to see your sales board here."
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
        title="Pipeline"
        subtitle={board.activePipeline.Name}
        icon={<Workflow size={22} />}
        actions={<HelpGuide guide={HELP_GUIDES.leads} />}
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
            <PipelineColumn
              key={stage.Id}
              stage={stage}
              leads={board.itemsByStage[stage.Id] || []}
            />
          ))}
        </div>
        <DragOverlay>
          {board.activeCard ? (
            <PipelineCardView lead={board.activeCard} overlay dragging />
          ) : null}
        </DragOverlay>
      </DndContext>

      <Modal
        open={Boolean(board.pendingMove)}
        onClose={closeLostModal}
        size="sm"
        data-testid="board-lost-modal"
      >
        <Modal.Header
          title="Why was this lead lost?"
          icon={<HeartCrack size={18} />}
          onClose={closeLostModal}
        />
        <Modal.Body>
          <Combobox
            label="Lost reason"
            required
            options={lostReasons.map((l) => ({ value: l.Id, label: l.Value }))}
            value={lostReason}
            onChange={setLostReason}
            placeholder="Pick a reason"
            data-testid="board-lost-reason-combobox"
          />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="ghost" onClick={closeLostModal}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submitPendingMove}
            disabled={!lostReason}
            data-testid="board-lost-submit"
          >
            Move lead
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
