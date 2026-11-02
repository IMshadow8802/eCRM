import { useQuery } from "@tanstack/react-query";

import { fetchNotifications } from "../../api/notificationQueries";

/**
 * The web bell's badge (NotificationBell.jsx). A count, not a list: PageSize 1.
 * Refetches on app focus (focusManager, App.tsx) and every minute while the
 * app is in front; the Inbox's own refresh invalidates ["notifications"] too.
 * Home's bell and More's Inbox row share this one cache entry.
 */
export function useUnreadCount(): number {
  const { data = 0 } = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: () => fetchNotifications({ PageSize: 1 }),
    select: (r) => r.data?.unreadCount ?? 0,
    refetchInterval: 60_000,
  });
  return data;
}
