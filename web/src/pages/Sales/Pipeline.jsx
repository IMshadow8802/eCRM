import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DragDropProvider } from "@dnd-kit/react";
import { HeartCrack, Workflow } from "lucide-react";

import { useApiQuery } from "../../hooks/useApiQuery";
import { useApiMutation } from "../../hooks/useApiMutation";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import { PageHeader, EmptyState, Modal, Combobox, Button } from "../../components/ui";
import HelpGuide from "../../components/HelpGuide";
import { HELP_GUIDES } from "../../data/helpGuides";
import PipelineColumn from "./PipelineColumn";

const PIPELINE_ENTITY = "lead";
const LEADS_QUERY_KEY = ["sales-leads"];

// sp_FetchPipelines returns 2 result sets (pipelines, then their stages);
// configController.fetchPipelines forwards both as { pipelines, stages }.
function bucketLeadsByStage(stages, leads) {
  const bucket = {};
  for (const stage of stages) bucket[stage.Id] = [];
  for (const lead of leads) {
    if (lead?.StageId != null && bucket[lead.StageId]) {
      bucket[lead.StageId].push(lead);
    }
  }
  return bucket;
}

export default function Pipeline() {
  const queryClient = useQueryClient();

  const { data: pipelinesPayload, isPending: pipelinesPending } = useApiQuery({
    queryKey: ["sales-pipelines", PIPELINE_ENTITY],
    endpoint: SALES_ENDPOINTS.config.fetchPipelines,
    params: { Entity: PIPELINE_ENTITY },
    showErrorMessage: false,
  });
  const pipelines = pipelinesPayload?.pipelines ?? [];
  const allStages = pipelinesPayload?.stages ?? [];
  const activePipeline = pipelines.find((pl) => pl.IsDefault) ?? pipelines[0] ?? null;

  const stages = useMemo(
    () =>
      allStages
        .filter((s) => s.PipelineId === activePipeline?.Id)
        .slice()
        .sort((a, b) => (a.SortOrder ?? 0) - (b.SortOrder ?? 0)),
    [allStages, activePipeline],
  );

  const { data: leadsPayload, refetch: refetchLeads } = useApiQuery({
    queryKey: LEADS_QUERY_KEY,
    endpoint: SALES_ENDPOINTS.leads.fetchLeads,
    params: { PageNumber: 1, PageSize: 200 },
    showErrorMessage: false,
  });
  const leads = leadsPayload?.leads ?? [];

  // Lost reasons for the drag-into-lost prompt (sp_MoveLeadStage rejects a
  // lost move without a LostReasonId, so ask before calling).
  const { data: lostReasonsPayload } = useApiQuery({
    queryKey: ["lost-reasons"],
    endpoint: SALES_ENDPOINTS.config.fetchLookups,
    params: { Kind: "lost_reason" },
    showErrorMessage: false,
  });
  const lostReasons = lostReasonsPayload?.lookups ?? [];

  // A drag into a lost stage parks here until the user picks a reason
  // (same pattern as TicketBoard's drag-into-won resolution prompt).
  const [pendingMove, setPendingMove] = useState(null); // { leadId, targetStageId }
  const [lostReason, setLostReason] = useState(null);

  const moveStageMutation = useApiMutation({
    endpoint: SALES_ENDPOINTS.leads.moveLeadStage,
    showSuccessMessage: false,
  });

  const leadsByStage = useMemo(() => bucketLeadsByStage(stages, leads), [stages, leads]);

  const commitMove = async (leadId, targetStageId, lostReasonId = null) => {
    // Optimistic: patch the cache so the card jumps to the target column
    // immediately, before the save round-trip completes (copied from
    // TaskBoard.jsx's handleDragEnd).
    const previousPayload = queryClient.getQueryData(LEADS_QUERY_KEY);
    queryClient.setQueryData(LEADS_QUERY_KEY, (prev) => {
      if (!prev?.leads) return prev;
      return {
        ...prev,
        leads: prev.leads.map((l) =>
          l.Id === leadId ? { ...l, StageId: targetStageId } : l,
        ),
      };
    });

    try {
      await moveStageMutation.mutateAsync({
        LeadId: leadId,
        StageId: targetStageId,
        // Only lost moves carry a reason — keep other payloads unchanged.
        ...(lostReasonId ? { LostReasonId: lostReasonId } : {}),
      });
      queryClient.invalidateQueries({ queryKey: LEADS_QUERY_KEY, refetchType: "none" });
    } catch {
      // Rollback on failure
      if (previousPayload) {
        queryClient.setQueryData(LEADS_QUERY_KEY, previousPayload);
      }
      refetchLeads();
    }
  };

  const handleDragEnd = async (event) => {
    if (event.canceled) return;
    const { source, target } = event.operation || {};
    if (!source || !target || source.type !== "lead") return;

    const leadId = source.data?.leadId;
    const lead = leads.find((l) => l.Id === leadId);
    if (!lead) return;

    const targetStageId = target.data?.stageId;
    if (!targetStageId || targetStageId === lead.StageId) return;

    // Losing a lead needs a reason — hold the move and ask. Won/open moves
    // sail straight through.
    const targetStage = stages.find((s) => s.Id === targetStageId);
    if (targetStage?.StageType === "lost") {
      setPendingMove({ leadId, targetStageId });
      return;
    }

    await commitMove(leadId, targetStageId);
  };

  const closeLostModal = () => {
    setPendingMove(null);
    setLostReason(null);
  };

  const submitPendingMove = async () => {
    if (!pendingMove || !lostReason) return;
    const { leadId, targetStageId } = pendingMove;
    closeLostModal();
    await commitMove(leadId, targetStageId, lostReason.value);
  };

  // Don't flash the empty state while the pipeline query is still in flight.
  if (pipelinesPending) {
    return <div style={{ padding: 32 }} data-testid="pipeline-loading" />;
  }

  if (!activePipeline || stages.length === 0) {
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
        subtitle={activePipeline.Name}
        icon={<Workflow size={22} />}
        actions={<HelpGuide guide={HELP_GUIDES.leads} />}
      />

      <DragDropProvider onDragEnd={handleDragEnd}>
        <div
          style={{
            display: "flex",
            gap: 12,
            overflowX: "auto",
            paddingBottom: 12,
            flex: 1,
          }}
        >
          {stages.map((stage) => (
            <PipelineColumn key={stage.Id} stage={stage} leads={leadsByStage[stage.Id] || []} />
          ))}
        </div>
      </DragDropProvider>

      <Modal
        open={Boolean(pendingMove)}
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
