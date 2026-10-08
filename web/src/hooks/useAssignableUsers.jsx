import { useMemo } from "react";
import { useApiQuery } from "./useApiQuery";
import { SALES_ENDPOINTS } from "../api/salesQueries";

/**
 * Who the signed-in user may hand a lead to. The server scopes the list
 * (subtree + manager for Team/Self; readable branches for wide scopes) and
 * re-checks membership on every transfer — this is the pick-list, not the gate.
 *
 * `module` ("leads" | "complaints") picks which module's access the roster is
 * checked against; the caller needs that module or the server answers 403.
 * `branchId` switches to a destination branch's roster for cross-branch moves.
 */
export function useAssignableUsers({ branchId = null, enabled = true, module = "leads" } = {}) {
  const query = useApiQuery({
    queryKey: ["assignable-users", branchId, module],
    endpoint: SALES_ENDPOINTS.users.fetchAssignableUsers,
    params: branchId ? { BranchId: branchId, Module: module } : { Module: module },
    enabled,
    showErrorMessage: false,
  });
  const users = useMemo(() => query.data?.users ?? [], [query.data]);
  return { ...query, users };
}

export default useAssignableUsers;
