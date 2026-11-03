import { useQuery } from "@tanstack/react-query";

import { fetchFollowUps } from "../api/followupQueries";
import { fetchTickets } from "../api/ticketQueries";
import { useUnreadCount } from "../features/notifications/useUnreadCount";
import { followUpViewParams } from "../features/sales/leadHelpers";
import { complaintQueueParams } from "../features/support/ticketHelpers";
import { MY_DAY_QUERY, needsYou } from "../features/tasks/taskHelpers";
import useAuthStore from "../stores/useAuthStore";
import type { RailItem } from "./tabs";

/**
 * MY overdue complaints (§7.9): assigned to me, active, past TAT. The bar badge
 * and Home's hero both read this factory, so they share one request.
 */
export const overdueTicketsCountQuery = (userId: number | null) => {
  const params = { ...complaintQueueParams("overdue", "active", userId, ""), AssignedTo: userId };
  return { queryKey: ["tickets", "count", params], queryFn: () => fetchTickets({ ...params, PageSize: 1 }) };
};

/**
 * Overdue follow-ups, a count (PageSize 1). With a user id it is MINE (§7.9
 * ruling): the bar badge and Home share that request. Without one it is the
 * reach-wide count that labels the queue's own Overdue view.
 */
export const overdueFollowUpsCountQuery = (assignedTo: number | null = null) => {
  const params = { ...followUpViewParams("overdue"), ...(assignedTo != null ? { AssignedTo: assignedTo } : null) };
  return { queryKey: ["followups", "count", params], queryFn: () => fetchFollowUps({ ...params, PageSize: 1 }) };
};

/**
 * Badge counts for the bar and rail (spec §3.3): Tasks = "Needs you",
 * Complaints = my overdue, Follow-ups = my overdue, Inbox = unread. Each query runs
 * only for a module the role can view. Tasks and Complaints share Home's
 * cache keys; Follow-ups and Inbox share the factories above / useUnreadCount.
 */
export function useNavBadges(can: { tasks: boolean; complaints: boolean; leads: boolean }): Partial<Record<RailItem, number>> {
  const userId = useAuthStore((s) => s.UserId);
  const myDay = useQuery({ ...MY_DAY_QUERY, enabled: can.tasks });
  // Without a user id a "mine" filter is null — the whole reach, not yours (as Home).
  const me = userId != null;
  const tickets = useQuery({ ...overdueTicketsCountQuery(userId), enabled: can.complaints && me });
  const followUps = useQuery({ ...overdueFollowUpsCountQuery(userId), enabled: can.leads && me });
  const unread = useUnreadCount();
  return {
    Tasks: can.tasks ? needsYou(myDay.data?.data).length : 0,
    Complaints: can.complaints ? (tickets.data?.data?.pagination.totalRecords ?? 0) : 0,
    FollowUps: can.leads ? (followUps.data?.data?.pagination.totalRecords ?? 0) : 0,
    Inbox: unread,
  };
}
