import { useQueries } from "@tanstack/react-query";

import { fetchLookups, fetchPipelines, LOOKUP_KIND } from "../../api/configQueries";
import { fetchUserDirectory } from "../../api/userQueries";
import type { DirectoryUser, Lookup, Pipeline, PipelineStage } from "../../types/api";
import { stageRoles, type StageRoles } from "./ticketHelpers";

/**
 * The reference data every complaint screen needs.
 *
 * sp_FetchTickets joins nothing — a ticket row carries CategoryId, Priority,
 * StageId and AssignedTo as bare ids — so each screen was opening the same
 * four to six queries just to turn those numbers into words. The list, the
 * detail and the form all did it, with the resolution and call-outcome lists
 * appearing in some and not others depending on what that screen showed.
 *
 * The query keys are unchanged and stay per-kind (`["lookups", kind]`), so
 * this shares React Query's cache with anything already fetching them rather
 * than introducing a second copy — moving between the three screens still
 * costs nothing.
 *
 * `useQueries` rather than a stack of `useQuery` calls: the set is fixed, and
 * one array keeps the screens from drifting apart again over which lists they
 * happen to ask for.
 */
export interface TicketRefData {
  categories: Lookup[];
  priorities: Lookup[];
  resolutions: Lookup[];
  outcomes: Lookup[];
  directory: DirectoryUser[];
  pipelines: Pipeline[];
  /** The company's default ticket pipeline, or its first — what a board shows. */
  defaultPipeline: Pipeline | null;
  stages: PipelineStage[];
  /** Stage roles, scoped per the `scope` argument. */
  roles: StageRoles;
}

/**
 * Which pipeline the returned `roles` describe. Spelled out rather than left
 * to a bare optional id, because all three answers are wanted somewhere and
 * picking the wrong one is silent:
 *
 *   "default"  the board's pipeline — the list and board screens
 *   a number   one specific pipeline — a detail screen uses the ticket's own,
 *              so its move sheet cannot offer stages the ticket may not enter
 *   "all"      every pipeline at once. Only correct for a count, where scoping
 *              would drop tickets outside the default pipeline rather than
 *              counting them.
 */
export type RefScope = number | null | "default" | "all";

export function useTicketRefData(scope: RefScope = "all"): TicketRefData {
  const results = useQueries({
    queries: [
      {
        queryKey: ["pipelines", "ticket"],
        queryFn: () => fetchPipelines({ Entity: "ticket" }),
      },
      {
        queryKey: ["lookups", LOOKUP_KIND.ticketCategory],
        queryFn: () => fetchLookups({ Kind: LOOKUP_KIND.ticketCategory }),
      },
      {
        queryKey: ["lookups", LOOKUP_KIND.priority],
        queryFn: () => fetchLookups({ Kind: LOOKUP_KIND.priority }),
      },
      {
        queryKey: ["lookups", LOOKUP_KIND.resolution],
        queryFn: () => fetchLookups({ Kind: LOOKUP_KIND.resolution }),
      },
      {
        queryKey: ["lookups", LOOKUP_KIND.callOutcome],
        queryFn: () => fetchLookups({ Kind: LOOKUP_KIND.callOutcome }),
      },
      { queryKey: ["users", "directory"], queryFn: () => fetchUserDirectory() },
    ],
    // Derived here rather than in each screen's own useMemo — useQueries only
    // re-runs this when a result actually changes.
    combine: (r) => {
      const pipelines = r[0]?.data?.pipelines ?? [];
      return {
        pipelines,
        defaultPipeline: pipelines.find((p) => p.IsDefault) ?? pipelines[0] ?? null,
        stages: r[0]?.data?.stages ?? [],
        categories: r[1]?.data ?? [],
        priorities: r[2]?.data ?? [],
        resolutions: r[3]?.data ?? [],
        outcomes: r[4]?.data ?? [],
        directory: r[5]?.data ?? [],
      };
    },
  });

  const pipelineId =
    scope === "all"
      ? null
      : scope === "default"
        ? (results.defaultPipeline?.Id ?? null)
        : scope;

  return { ...results, roles: stageRoles(results.stages, pipelineId) };
}

export default useTicketRefData;
