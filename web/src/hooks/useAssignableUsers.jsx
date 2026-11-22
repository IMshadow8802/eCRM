import { useMemo } from "react";
import { useApiQuery } from "./useApiQuery";
import { SALES_ENDPOINTS } from "../api/salesQueries";

/**
 * Who the signed-in user may hand a record to ("Can assign to"). The server
 * builds the list and re-checks it on every assignment — this is the
 * pick-list, not the gate.
 *
 * `module` ("leads" | "complaints") picks whose rules apply; `recordId` lets
 * the server put the person who gave it to you on the list (Send back).
 * Rows: Id, FullName, Avatar, JobTitle, BranchId, BranchName, ReportsTo,
 * GroupRank (1 manager and team, 2 my offices, 3 others), IsGiver, AwayToday.
 */
export function useAssignableUsers({ module = "leads", recordId = null, enabled = true } = {}) {
  const query = useApiQuery({
    queryKey: ["assignable-users", module, recordId],
    endpoint: SALES_ENDPOINTS.users.fetchAssignableUsers,
    params: recordId ? { Module: module, RecordId: recordId } : { Module: module },
    enabled,
    showErrorMessage: false,
  });
  const users = useMemo(() => query.data?.users ?? [], [query.data]);
  return { ...query, users };
}

export default useAssignableUsers;
