import { useQueries } from "@tanstack/react-query";

import { fetchLookups, LOOKUP_KIND } from "../../api/configQueries";
import { fetchAssignableUsers } from "../../api/userQueries";
import type { AssignableUser, Lookup } from "../../types/api";

/**
 * The reference data every complaint screen needs — for PICKERS only.
 *
 * Since 086 sp_FetchTickets joins every name a row displays (StatusName,
 * PriorityName, AssigneeName, …), so nothing here is needed to render a card
 * or a fact. What remains is the set of lists a screen offers as choices: the
 * status sheet and filter chips, the resolve / transfer / call sheets, and the
 * form's selects.
 *
 * The query keys stay per-kind (`["lookups", kind]`), so this shares React
 * Query's cache with anything already fetching them rather than introducing a
 * second copy — moving between the three screens still costs nothing.
 *
 * `useQueries` rather than a stack of `useQuery` calls: the set is fixed, and
 * one array keeps the screens from drifting apart again over which lists they
 * happen to ask for.
 */
export interface TicketRefData {
  /** ticket_status rows in SortOrder — each carries its Code. */
  statuses: Lookup[];
  categories: Lookup[];
  /** Each carries TatHours; the form shows "due in Nh" off it. */
  priorities: Lookup[];
  channels: Lookup[];
  resolutions: Lookup[];
  transferReasons: Lookup[];
  callOutcomes: Lookup[];
  /**
   * Who the caller may assign or transfer to. Server-scoped: own subtree plus
   * own manager for Team/Self, readable branches for wide scopes. Offering
   * anyone else earns a 403 from assertCanAssign at save time.
   */
  users: AssignableUser[];
}

const lookup = (kind: string) => ({
  queryKey: ["lookups", kind],
  queryFn: () => fetchLookups({ Kind: kind }),
});

export function useTicketRefData(): TicketRefData {
  return useQueries({
    queries: [
      lookup(LOOKUP_KIND.ticketStatus),
      lookup(LOOKUP_KIND.ticketCategory),
      lookup(LOOKUP_KIND.priority),
      lookup(LOOKUP_KIND.ticketChannel),
      lookup(LOOKUP_KIND.resolution),
      lookup(LOOKUP_KIND.transferReason),
      lookup(LOOKUP_KIND.callOutcome),
      {
        queryKey: ["users", "assignable"],
        queryFn: () => fetchAssignableUsers(),
      },
    ],
    // Derived here rather than in each screen's own useMemo — useQueries only
    // re-runs this when a result actually changes.
    combine: (r) => ({
      statuses: r[0]?.data ?? [],
      categories: r[1]?.data ?? [],
      priorities: r[2]?.data ?? [],
      channels: r[3]?.data ?? [],
      resolutions: r[4]?.data ?? [],
      transferReasons: r[5]?.data ?? [],
      callOutcomes: r[6]?.data ?? [],
      users: r[7]?.data ?? [],
    }),
  });
}

export default useTicketRefData;
