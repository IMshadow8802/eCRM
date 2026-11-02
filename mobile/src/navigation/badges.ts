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
 * The Overdue complaints count. Same key as Home's current "Overdue" row
 * (complaintQueueParams("overdue", "active", …)), so the two share one
 * request; Phase 2's Home hero must read this factory to keep sharing it.
 */
export const overdueTicketsCountQuery = (userId: number | null) => {
  const params = complaintQueueParams("overdue", "active", userId, "");
  return { queryKey: ["tickets", "count", params], queryFn: () => fetchTickets({ ...params, PageSize: 1 }) };
};

/** Overdue follow-ups, a count (PageSize 1). Home has no such query yet; Phase 2's tile must use this one. */
export const overdueFollowUpsCountQuery = () => {
  const params = followUpViewParams("overdue");
  return { queryKey: ["followups", "count", params], queryFn: () => fetchFollowUps({ ...params, PageSize: 1 }) };
};

/**
 * Badge counts for the bar and rail (spec §3.3): Tasks = "Needs you",
 * Complaints = Overdue, Follow-ups = overdue, Inbox = unread. Each query runs
 * only for a module the role can view. Tasks and Complaints share Home's
 * cache keys; Follow-ups and Inbox share the factories above / useUnreadCount.
 */
export function useNavBadges(can: { tasks: boolean; complaints: boolean; leads: boolean }): Partial<Record<RailItem, number>> {
  const userId = useAuthStore((s) => s.UserId);
  const myDay = useQuery({ ...MY_DAY_QUERY, enabled: can.tasks });
  const tickets = useQuery({ ...overdueTicketsCountQuery(userId), enabled: can.complaints });
  const followUps = useQuery({ ...overdueFollowUpsCountQuery(), enabled: can.leads });
  const unread = useUnreadCount();
  return {
    Tasks: can.tasks ? needsYou(myDay.data?.data).length : 0,
    Complaints: can.complaints ? (tickets.data?.data?.pagination.totalRecords ?? 0) : 0,
    FollowUps: can.leads ? (followUps.data?.data?.pagination.totalRecords ?? 0) : 0,
    Inbox: unread,
  };
}
