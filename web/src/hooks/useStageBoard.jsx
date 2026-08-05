import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";

import { useApiQuery } from "./useApiQuery.jsx";
import { useApiMutation } from "./useApiMutation.jsx";
import { dragGuard } from "../realtime/dragGuard";

/**
 * The drag-and-drop stage board behind Pipeline (leads) and TicketBoard
 * (tickets). The two pages were 615 lines that differed in 239 — everything
 * below was written twice: resolving the default pipeline and sorting its
 * stages, bucketing records into columns, the dnd sensors, the realtime
 * drag gate, and the optimistic move with cache rollback.
 *
 * That last one is the reason this is a hook rather than a note to be careful.
 * The optimistic patch has to snapshot the cache, patch it, await the save,
 * and on failure restore the snapshot AND refetch — four steps that must stay
 * in that order or a failed drag leaves the card in the wrong column. Keeping
 * one copy is worth more than the line count suggests.
 *
 * What stays with the caller: the modal copy, the columns, and `needsPrompt`.
 * The two boards genuinely gate differently — a lead entering a `lost` stage
 * always needs a reason, while a ticket entering a `won` stage needs a
 * resolution only the first time (a Resolved → Closed drag already has one).
 * Folding that into a shared flag would have broken one of them.
 *
 * @param {object}   cfg
 * @param {string}   cfg.entity            - `Entity` for fetchPipelines ("lead" | "ticket")
 * @param {Array}    cfg.pipelineQueryKey  - cache key for the pipelines query
 * @param {string}   cfg.fetchPipelines    - config-engine pipelines endpoint
 * @param {Array}    cfg.itemsQueryKey     - cache key for the records query
 * @param {string}   cfg.fetchItems        - records endpoint (leads / tickets)
 * @param {string}   cfg.itemsKey          - payload key holding the records
 * @param {string}   cfg.moveEndpoint      - the move-stage endpoint
 * @param {Function} cfg.movePayload       - (id, stageId, promptValue) => request body
 * @param {Function} cfg.needsPrompt       - (targetStage, item) => true to hold the move
 * @param {string}   cfg.dragDataKey       - key on the drag payload holding the record
 * @param {string}   cfg.dragIdKey         - key on the drag payload holding its id
 */
export function useStageBoard({
  entity,
  pipelineQueryKey,
  fetchPipelines,
  itemsQueryKey,
  fetchItems,
  itemsKey,
  moveEndpoint,
  movePayload,
  needsPrompt,
  dragDataKey,
  dragIdKey,
}) {
  const queryClient = useQueryClient();

  const { data: pipelinesPayload, isPending: pipelinesPending } = useApiQuery({
    queryKey: pipelineQueryKey,
    endpoint: fetchPipelines,
    params: { Entity: entity },
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

  const { data: itemsPayload, refetch: refetchItems } = useApiQuery({
    queryKey: itemsQueryKey,
    endpoint: fetchItems,
    params: { PageNumber: 1, PageSize: 200 },
    showErrorMessage: false,
  });
  const items = useMemo(() => itemsPayload?.[itemsKey] ?? [], [itemsPayload, itemsKey]);

  // A drag that needs an answer parks here until the user gives one.
  const [pendingMove, setPendingMove] = useState(null); // { id, targetStageId }
  const [activeCard, setActiveCard] = useState(null); // the card in the drag overlay

  // Distance constraint so a plain click still opens the record (no accidental
  // drag); keyboard sensor keeps drag accessible.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );

  // Safety: release the realtime gate if the board unmounts mid-drag.
  useEffect(() => () => dragGuard.end(), []);

  const moveStageMutation = useApiMutation({
    endpoint: moveEndpoint,
    showSuccessMessage: false,
  });

  const itemsByStage = useMemo(() => {
    const bucket = {};
    for (const stage of stages) bucket[stage.Id] = [];
    for (const item of items) {
      if (item?.StageId != null && bucket[item.StageId]) bucket[item.StageId].push(item);
    }
    return bucket;
  }, [stages, items]);

  const commitMove = async (id, targetStageId, promptValue = null) => {
    // Optimistic: patch the cache so the card jumps to the target column
    // immediately, before the save round-trip completes.
    const previousPayload = queryClient.getQueryData(itemsQueryKey);
    queryClient.setQueryData(itemsQueryKey, (prev) => {
      if (!prev?.[itemsKey]) return prev;
      return {
        ...prev,
        [itemsKey]: prev[itemsKey].map((r) =>
          r.Id === id ? { ...r, StageId: targetStageId } : r,
        ),
      };
    });

    try {
      await moveStageMutation.mutateAsync(movePayload(id, targetStageId, promptValue));
      queryClient.invalidateQueries({ queryKey: itemsQueryKey, refetchType: "none" });
    } catch {
      // Rollback, then refetch — the patch above is otherwise left standing and
      // the card stays in a column the server never accepted.
      if (previousPayload) queryClient.setQueryData(itemsQueryKey, previousPayload);
      refetchItems();
    }
  };

  const handleDragStart = (event) => {
    dragGuard.start(); // hold realtime refetches until the drop lands
    setActiveCard(event.active.data.current?.[dragDataKey] ?? null);
  };

  const handleDragCancel = () => {
    setActiveCard(null);
    dragGuard.end();
  };

  const handleDragEnd = async (event) => {
    setActiveCard(null);
    // Release the realtime gate now — the optimistic patch in commitMove is the
    // source of truth until the save round-trips; deferred refetches can flush.
    dragGuard.end();
    const { active, over } = event;
    if (!over) return;

    const id = active.data.current?.[dragIdKey];
    const item = items.find((r) => r.Id === id);
    if (!item) return;

    const targetStageId = over.data.current?.stageId;
    if (!targetStageId || targetStageId === item.StageId) return;

    const targetStage = stages.find((s) => s.Id === targetStageId);
    if (needsPrompt(targetStage, item)) {
      setPendingMove({ id, targetStageId });
      return;
    }

    await commitMove(id, targetStageId);
  };

  return {
    pipelinesPending,
    activePipeline,
    stages,
    items,
    itemsByStage,
    sensors,
    activeCard,
    pendingMove,
    setPendingMove,
    commitMove,
    refetchItems,
    handleDragStart,
    handleDragCancel,
    handleDragEnd,
  };
}

export default useStageBoard;
