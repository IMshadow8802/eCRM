import { useMemo } from "react";
import { useApiQuery } from "./useApiQuery";
import { SALES_ENDPOINTS } from "../api/salesQueries";

/**
 * Who the signed-in user may hand a lead to. The server scopes the list
 * (subtree + manager for Team/Self; readable branches for wide scopes) and
 * re-checks membership on every transfer — this is the pick-list, not the gate.
 *
 * `branchId` switches to a destination branch's roster for cross-branch moves.
 */
export function useAssignableUsers({ branchId = null, enabled = true } = {}) {
  const query = useApiQuery({
    queryKey: ["assignable-users", branchId],
    endpoint: SALES_ENDPOINTS.users.fetchAssignableUsers,
    params: branchId ? { BranchId: branchId } : {},
    enabled,
    showErrorMessage: false,
  });
  const users = useMemo(() => query.data?.users ?? [], [query.data]);
  return { ...query, users };
}

export default useAssignableUsers;
