import { useMemo } from "react";
import { useApiQuery } from "./useApiQuery.jsx";
import { SALES_ENDPOINTS } from "../api/salesQueries";

/**
 * The `tblLookup` fetcher, shared by Sales, Support and Settings.
 *
 * Nineteen call sites hand-rolled this, and between them they invented six
 * different query keys for the same rows — `["ticket-priorities"]`,
 * `["support-priorities"]` and `["ticket-lookups", "priority"]` all cached the
 * `priority` list separately. That was not merely wasteful: the Settings pages
 * invalidate `["lookups", kind]` after a save or delete, so a rename applied in
 * Settings reached none of the pages that actually display the name. The
 * Tickets table went on showing the old label until its own five-minute
 * staleTime lapsed. One key per kind is what makes that invalidation land.
 *
 * The endpoint is deliberately the Sales one: `SUPPORT_ENDPOINTS.config` is
 * literally `SALES_ENDPOINTS.config` (supportQueries.js:24) — one config engine
 * serves both, discriminated by `Kind`, so there is nothing to choose between.
 *
 * Returns the React Query result with `lookups` added, so a caller that only
 * wants the rows destructures `{ lookups }` while the Settings pages keep the
 * `isLoading` / `refetch` they already use.
 *
 * @param {string} kind          - `tblLookup.Kind` ("priority", "lead_source", …)
 * @param {object} [options]
 * @param {boolean} [options.enabled]           - gate the request (a closed modal)
 * @param {boolean} [options.showErrorMessage]  - toast on failure; matches useApiQuery's default
 */
export function useLookups(kind, { enabled = true, showErrorMessage = true } = {}) {
  const query = useApiQuery({
    queryKey: ["lookups", kind],
    endpoint: SALES_ENDPOINTS.config.fetchLookups,
    params: { Kind: kind },
    enabled: enabled && Boolean(kind),
    showErrorMessage,
  });

  // Stable identity so a consumer can pass it to useMemo/useEffect deps without
  // re-running on every render, which a bare `?? []` fallback would do.
  const lookups = useMemo(() => query.data?.lookups ?? [], [query.data]);

  return { ...query, lookups };
}

export default useLookups;
