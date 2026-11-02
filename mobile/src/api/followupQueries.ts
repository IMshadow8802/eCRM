// src/api/followupQueries.ts
// Lead follow-ups (tblFollowUp). Payloads taken from
// backend/src/controllers/followupController.js.
//
// Dates go as local 'YYYY-MM-DD' — the controller treats a bare day as IST
// wall clock. Never toISOString(): that is UTC and rolls the day back in IST.
// deleteFollowup is deliberately absent: a phone logs or skips, it does not
// erase the diary.
import { post } from "./client";
import type { ApiEnvelope, FollowUp, FollowUpStatus, FollowUpType, Pagination } from "../types/api";

export const FOLLOWUP_ENDPOINTS = {
  scheduleFollowUp: "/api/followups/scheduleFollowUp",
  completeFollowUp: "/api/followups/completeFollowUp",
  skipFollowUp: "/api/followups/skipFollowUp",
  fetchFollowups: "/api/followups/fetchFollowups",
} as const;

export interface FetchFollowUpsParams {
  Status?: FollowUpStatus | null;
  DueFrom?: string | null;
  DueTo?: string | null;
  /** Open and due before today — the SP's verdict, not a client comparison. */
  Overdue?: boolean;
  SearchTerm?: string | null;
  PageSize?: number;
}

export interface FollowUpsPayload {
  followups: FollowUp[];
  pagination: Pagination;
}

/** The queue across every lead the caller can see (LeadId 0), soonest due first. */
export const fetchFollowUps = (
  params: FetchFollowUpsParams = {},
): Promise<ApiEnvelope<FollowUpsPayload>> =>
  post<FollowUpsPayload>(FOLLOWUP_ENDPOINTS.fetchFollowups, {
    LeadId: 0,
    Status: null,
    DueFrom: null,
    DueTo: null,
    Overdue: false,
    SearchTerm: null,
    PageSize: 50,
    ...params,
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
  Direction?: "in" | "out" | null;
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
