import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DragDropProvider } from "@dnd-kit/react";
import { Workflow } from "lucide-react";

import { useApiQuery } from "../../hooks/useApiQuery";
import { useApiMutation } from "../../hooks/useApiMutation";
import { SALES_ENDPOINTS } from "../../api/salesQueries";
import { PageHeader, EmptyState } from "../../components/ui";
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

  const moveStageMutation = useApiMutation({
    endpoint: SALES_ENDPOINTS.leads.moveLeadStage,
    showSuccessMessage: false,
  });

  const leadsByStage = useMemo(() => bucketLeadsByStage(stages, leads), [stages, leads]);

  const handleDragEnd = async (event) => {
    if (event.canceled) return;
    const { source, target } = event.operation || {};
    if (!source || !target || source.type !== "lead") return;

    const leadId = source.data?.leadId;
    const lead = leads.find((l) => l.Id === leadId);
    if (!lead) return;

    const targetStageId = target.data?.stageId;
    if (!targetStageId || targetStageId === lead.StageId) return;

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
      await moveStageMutation.mutateAsync({ LeadId: leadId, StageId: targetStageId });
      queryClient.invalidateQueries({ queryKey: LEADS_QUERY_KEY, refetchType: "none" });
    } catch {
      // Rollback on failure
      if (previousPayload) {
        queryClient.setQueryData(LEADS_QUERY_KEY, previousPayload);
      }
      refetchLeads();
    }
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
    </div>
  );
}
