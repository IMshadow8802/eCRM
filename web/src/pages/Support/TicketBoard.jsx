import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DragDropProvider } from "@dnd-kit/react";
import { LifeBuoy } from "lucide-react";

import { useApiQuery } from "../../hooks/useApiQuery";
import { useApiMutation } from "../../hooks/useApiMutation";
import { useUsers } from "../../hooks";
import { SUPPORT_ENDPOINTS } from "../../api/supportQueries";
import { PageHeader, EmptyState } from "../../components/ui";
import TicketColumn from "./TicketColumn";

const PIPELINE_ENTITY = "ticket";
const TICKETS_QUERY_KEY = ["support-tickets"];

function bucketTicketsByStage(stages, tickets) {
  const bucket = {};
  for (const stage of stages) bucket[stage.Id] = [];
  for (const ticket of tickets) {
    if (ticket?.StageId != null && bucket[ticket.StageId]) {
      bucket[ticket.StageId].push(ticket);
    }
  }
  return bucket;
}

export default function TicketBoard() {
  const queryClient = useQueryClient();

  const { data: pipelinesPayload, isPending: pipelinesPending } = useApiQuery({
    queryKey: ["support-pipelines", PIPELINE_ENTITY],
    endpoint: SUPPORT_ENDPOINTS.config.fetchPipelines,
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

  const { data: ticketsPayload, refetch: refetchTickets } = useApiQuery({
    queryKey: TICKETS_QUERY_KEY,
    endpoint: SUPPORT_ENDPOINTS.tickets.fetchTickets,
    params: { PageNumber: 1, PageSize: 200 },
    showErrorMessage: false,
  });
  const tickets = ticketsPayload?.tickets ?? [];

  // Priority id → name, so the card chip reads "High" not "3".
  const { data: prioritiesPayload } = useApiQuery({
    queryKey: ["support-priorities"],
    endpoint: SUPPORT_ENDPOINTS.config.fetchLookups,
    params: { Kind: "priority" },
    showErrorMessage: false,
  });
  const priorityById = useMemo(() => {
    const map = new Map();
    for (const l of prioritiesPayload?.lookups ?? []) map.set(l.Id, l.Value);
    return map;
  }, [prioritiesPayload]);

  // AssignedTo id → user, resolved like Leads.jsx does.
  const { data: usersData } = useUsers({ PageSize: 1000 });
  const users = usersData?.users ?? [];

  const moveStageMutation = useApiMutation({
    endpoint: SUPPORT_ENDPOINTS.tickets.moveTicketStage,
    showSuccessMessage: false,
  });

  const ticketsByStage = useMemo(
    () => bucketTicketsByStage(stages, tickets),
    [stages, tickets],
  );

  const handleDragEnd = async (event) => {
    if (event.canceled) return;
    const { source, target } = event.operation || {};
    if (!source || !target || source.type !== "ticket") return;

    const ticketId = source.data?.ticketId;
    const ticket = tickets.find((t) => t.Id === ticketId);
    if (!ticket) return;

    const targetStageId = target.data?.stageId;
    if (!targetStageId || targetStageId === ticket.StageId) return;

    // Optimistic: patch the cache so the card jumps to the target column
    // immediately, before the save round-trip completes.
    const previousPayload = queryClient.getQueryData(TICKETS_QUERY_KEY);
    queryClient.setQueryData(TICKETS_QUERY_KEY, (prev) => {
      if (!prev?.tickets) return prev;
      return {
        ...prev,
        tickets: prev.tickets.map((t) =>
          t.Id === ticketId ? { ...t, StageId: targetStageId } : t,
        ),
      };
    });

    try {
      await moveStageMutation.mutateAsync({ TicketId: ticketId, StageId: targetStageId });
      queryClient.invalidateQueries({ queryKey: TICKETS_QUERY_KEY, refetchType: "none" });
    } catch {
      // Rollback on failure
      if (previousPayload) {
        queryClient.setQueryData(TICKETS_QUERY_KEY, previousPayload);
      }
      refetchTickets();
    }
  };

  // Don't flash the empty state while the pipeline query is still in flight.
  if (pipelinesPending) {
    return <div style={{ padding: 32 }} data-testid="ticket-board-loading" />;
  }

  if (!activePipeline || stages.length === 0) {
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
        subtitle={activePipeline.Name}
        icon={<LifeBuoy size={22} />}
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
            <TicketColumn
              key={stage.Id}
              stage={stage}
              tickets={ticketsByStage[stage.Id] || []}
              priorityById={priorityById}
              users={users}
            />
          ))}
        </div>
      </DragDropProvider>
    </div>
  );
}
