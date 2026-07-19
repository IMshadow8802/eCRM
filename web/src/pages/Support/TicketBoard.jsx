import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DragDropProvider } from "@dnd-kit/react";
import { CheckCircle, LifeBuoy } from "lucide-react";

import { useApiQuery } from "../../hooks/useApiQuery";
import { useApiMutation } from "../../hooks/useApiMutation";
import { useUsers } from "../../hooks";
import { SUPPORT_ENDPOINTS } from "../../api/supportQueries";
import { PageHeader, EmptyState, Modal, Combobox, Button } from "../../components/ui";
import HelpGuide from "../../components/HelpGuide";
import { HELP_GUIDES } from "../../data/helpGuides";
import TicketColumn from "./TicketColumn";
import TicketDetailModal from "./TicketDetailModal";

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

  // Resolutions for the drag-into-won prompt (stage is the lifecycle's source
  // of truth: entering a won stage requires a resolution, like the lead board
  // requires a lost reason).
  const { data: resolutionsPayload } = useApiQuery({
    queryKey: ["support-resolutions"],
    endpoint: SUPPORT_ENDPOINTS.config.fetchLookups,
    params: { Kind: "resolution" },
    showErrorMessage: false,
  });
  const resolutions = resolutionsPayload?.lookups ?? [];

  // A drag into a won stage parks here until the user picks a resolution.
  const [pendingMove, setPendingMove] = useState(null); // { ticketId, targetStageId }
  const [resolution, setResolution] = useState(null);

  // Card "open" button -> full detail in a modal, board position preserved.
  const [detailTicketId, setDetailTicketId] = useState(null);

  const moveStageMutation = useApiMutation({
    endpoint: SUPPORT_ENDPOINTS.tickets.moveTicketStage,
    showSuccessMessage: false,
  });

  const ticketsByStage = useMemo(
    () => bucketTicketsByStage(stages, tickets),
    [stages, tickets],
  );

  const commitMove = async (ticketId, targetStageId, resolutionId = null) => {
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
      await moveStageMutation.mutateAsync({
        TicketId: ticketId,
        StageId: targetStageId,
        ResolutionId: resolutionId,
      });
      queryClient.invalidateQueries({ queryKey: TICKETS_QUERY_KEY, refetchType: "none" });
    } catch {
      // Rollback on failure
      if (previousPayload) {
        queryClient.setQueryData(TICKETS_QUERY_KEY, previousPayload);
      }
      refetchTickets();
    }
  };

  const handleDragEnd = async (event) => {
    if (event.canceled) return;
    const { source, target } = event.operation || {};
    if (!source || !target || source.type !== "ticket") return;

    const ticketId = source.data?.ticketId;
    const ticket = tickets.find((t) => t.Id === ticketId);
    if (!ticket) return;

    const targetStageId = target.data?.stageId;
    if (!targetStageId || targetStageId === ticket.StageId) return;

    // First entry into a won stage needs a resolution — hold the move and ask.
    // (Resolved -> Closed drags sail through: the resolution already exists.)
    const targetStage = stages.find((s) => s.Id === targetStageId);
    if (targetStage?.StageType === "won" && !ticket.ResolutionId) {
      setPendingMove({ ticketId, targetStageId });
      return;
    }

    await commitMove(ticketId, targetStageId);
  };

  const submitPendingMove = async () => {
    if (!pendingMove || !resolution) return;
    const { ticketId, targetStageId } = pendingMove;
    setPendingMove(null);
    setResolution(null);
    await commitMove(ticketId, targetStageId, resolution.value);
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
        actions={<HelpGuide guide={HELP_GUIDES.tickets} />}
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
              onOpen={setDetailTicketId}
            />
          ))}
        </div>
      </DragDropProvider>

      <TicketDetailModal
        ticketId={detailTicketId}
        open={Boolean(detailTicketId)}
        onClose={() => {
          setDetailTicketId(null);
          refetchTickets(); // resolve/close in the modal must reflect on the board
        }}
      />

      <Modal
        open={Boolean(pendingMove)}
        onClose={() => {
          setPendingMove(null);
          setResolution(null);
        }}
        size="sm"
        data-testid="board-resolve-modal"
      >
        <Modal.Header
          title="How was it resolved?"
          icon={<CheckCircle size={18} />}
          onClose={() => {
            setPendingMove(null);
            setResolution(null);
          }}
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
          <Button
            variant="ghost"
            onClick={() => {
              setPendingMove(null);
              setResolution(null);
            }}
          >
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
