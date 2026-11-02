import { useQueries } from "@tanstack/react-query";

import { fetchLookups, LOOKUP_KIND } from "../../api/configQueries";
import { fetchProducts } from "../../api/productQueries";
import { fetchAssignableUsers } from "../../api/userQueries";
import type { AssignableUser, Lookup, Product } from "../../types/api";

/**
 * The lists the sales screens offer as choices — pickers only; sp_FetchLeads
 * joins every name a row displays. Same per-kind keys as useTicketRefData,
 * so a list both modules use (transfer reasons, call outcomes) is fetched once.
 */
export interface LeadRefData {
  /** lead_status rows in SortOrder — each carries its Code. */
  statuses: Lookup[];
  sources: Lookup[];
  lostReasons: Lookup[];
  transferReasons: Lookup[];
  callOutcomes: Lookup[];
  /** Who the caller may assign a lead to — server-scoped by the leads reach. */
  users: AssignableUser[];
  products: Product[];
}

const lookup = (kind: string) => ({
  queryKey: ["lookups", kind],
  queryFn: () => fetchLookups({ Kind: kind }),
});

export function useLeadRefData(): LeadRefData {
  return useQueries({
    queries: [
      lookup(LOOKUP_KIND.leadStatus),
      lookup(LOOKUP_KIND.leadSource),
      lookup(LOOKUP_KIND.lostReason),
      lookup(LOOKUP_KIND.transferReason),
      lookup(LOOKUP_KIND.callOutcome),
      {
        queryKey: ["users", "assignable", "leads"],
        queryFn: () => fetchAssignableUsers({ Module: "leads" }),
      },
      { queryKey: ["products"], queryFn: () => fetchProducts() },
    ],
    combine: (r) => ({
      statuses: r[0]?.data ?? [],
      sources: r[1]?.data ?? [],
      lostReasons: r[2]?.data ?? [],
      transferReasons: r[3]?.data ?? [],
      callOutcomes: r[4]?.data ?? [],
      users: r[5]?.data ?? [],
      products: r[6]?.data ?? [],
    }),
  });
}

export default useLeadRefData;
