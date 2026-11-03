// src/api/followupQueries.ts
// Lead follow-ups (tblFollowUp). Payloads taken from
// backend/src/controllers/followupController.js.
//
// Dates go as local 'YYYY-MM-DD' — the controller treats a bare day as IST
// wall clock. Never toISOString(): that is UTC and rolls the day back in IST.
// deleteFollowup is deliberately absent: a phone logs or skips, it does not
// erase the diary.
import { post } from "./client";
import type { ApiEnvelope, CallDirection, FollowUp, FollowUpStatus, FollowUpType, Pagination } from "../types/api";

export const FOLLOWUP_ENDPOINTS = {
  scheduleFollowUp: "/api/followups/scheduleFollowUp",
  completeFollowUp: "/api/followups/completeFollowUp",
  skipFollowUp: "/api/followups/skipFollowUp",
  fetchFollowups: "/api/followups/fetchFollowups",
} as const;

export interface FetchFollowUpsParams {
  /** Only this person's follow-ups (Home and the badge are "mine", §7.9). Omit for the reach-wide queue. */
  AssignedTo?: number | null;
  Status?: FollowUpStatus | null;
  DueFrom?: string | null;
  DueTo?: string | null;
  /** DoneAt from (inclusive, a local day) — SQL 118. */
  DoneFrom?: string | null;
  /** DoneAt to: an EXCLUSIVE instant ("through today" = tomorrow) — SQL 118. */
  DoneTo?: string | null;
  /** Open and due before today — the SP's verdict, not a client comparison. */
  Overdue?: boolean;
  SearchTerm?: string | null;
  PageNumber?: number;
  PageSize?: number;
}

export interface FollowUpsPayload {
  followups: FollowUp[];
  pagination: Pagination;
}

/**
 * The queue across every lead the caller can see (LeadId 0), soonest due first.
 * Keys are named, not spread: a LeadId riding in on a variable would switch
 * the controller to per-lead mode, which answers without pagination.
 */
export const fetchFollowUps = ({
  AssignedTo = null,
  Status = null,
  DueFrom = null,
  DueTo = null,
  DoneFrom = null,
  DoneTo = null,
  Overdue = false,
  SearchTerm = null,
  PageNumber = 1,
  PageSize = 50,
}: FetchFollowUpsParams = {}): Promise<ApiEnvelope<FollowUpsPayload>> =>
  post<FollowUpsPayload>(FOLLOWUP_ENDPOINTS.fetchFollowups, {
    LeadId: 0,
    Status,
    DueFrom,
    DueTo,
    // Only when set (as the controller): an older server never sees the keys.
    ...(DoneFrom ? { DoneFrom } : null),
    ...(DoneTo ? { DoneTo } : null),
    ...(AssignedTo ? { AssignedTo } : null),
    Overdue,
    SearchTerm,
    PageNumber,
    PageSize,
  });

export const scheduleFollowUp = (params: {
  LeadId: number;
  Type: FollowUpType;
  DueAt: string;
  AssignedTo?: number | null;
}): Promise<ApiEnvelope<{ Id: number }>> =>
  post(FOLLOWUP_ENDPOINTS.scheduleFollowUp, { AssignedTo: null, ...params });

/** Remarks are required (the controller 400s a blank one). */
export const completeFollowUp = (params: {
  Id: number;
  Remarks: string;
  OutcomeId?: number | null;
  Direction?: CallDirection | null;
  /** Minutes. */
  Duration?: number | null;
  NextType?: FollowUpType | null;
  NextDueAt?: string | null;
}): Promise<ApiEnvelope<{ Id: number; NextId: number | null }>> =>
  post(FOLLOWUP_ENDPOINTS.completeFollowUp, {
    OutcomeId: null,
    Direction: null,
    Duration: null,
    NextType: null,
    NextDueAt: null,
    ...params,
  });

export const skipFollowUp = (params: {
  Id: number;
  Remarks: string;
}): Promise<ApiEnvelope<{ Id: number }>> =>
  post(FOLLOWUP_ENDPOINTS.skipFollowUp, params);
