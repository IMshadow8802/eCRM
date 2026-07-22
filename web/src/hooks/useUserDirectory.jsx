import { useMemo } from "react";
import { useApiQuery } from "./useApiQuery";

// Company roster {Id → {FullName, Avatar}} for resolving avatars in feeds
// (comments, history, board) without every fetch SP having to project it.
// Cached long — the roster rarely changes within a session.
export function useUserDirectory() {
  const { data } = useApiQuery({
    queryKey: ["userDirectory"],
    endpoint: "/api/users/directory",
    params: {},
    staleTime: 10 * 60 * 1000,
    showErrorMessage: false,
  });

  const byId = useMemo(() => {
    const map = new Map();
    (data?.users ?? []).forEach((u) => map.set(u.Id, u));
    return map;
  }, [data]);

  return byId;
}
