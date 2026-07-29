import { useMemo } from "react";

import { useApiQuery } from "./useApiQuery";

/**
 * Combobox options for the people who can actually be assigned on a board.
 *
 * Only ACTIVE members qualify. Assigning anyone else used to notify them and
 * then 404 them on every action, including opening the task — sp_SaveTask now
 * rejects it outright, so offering them in the picker would just produce a
 * confusing 400.
 *
 * Personal workspaces have no member rows at all (the owner is implicitly the
 * only person), so callers should skip the picker entirely there.
 */
export default function useWorkspaceMemberOptions(workspaceId, { enabled = true } = {}) {
  const { data, isPending } = useApiQuery({
    queryKey: ["workspace-members", workspaceId],
    endpoint: "/api/workspaces/fetchWorkspaceMembers",
    params: { WorkspaceId: workspaceId },
    enabled: Boolean(workspaceId) && enabled,
    showErrorMessage: false,
  });

  const options = useMemo(() => {
    const members = data?.members ?? [];
    return members
      .filter((m) => m.IsActive && m.InviteStatus === "active")
      .map((m) => ({
        value: Number(m.UserId),
        label: m.FullName || m.Username || `User #${m.UserId}`,
      }));
  }, [data]);

  return { options, isPending };
}
