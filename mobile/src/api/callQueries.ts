// src/api/callQueries.ts
// Manual call logging against a lead OR a ticket. Payloads taken from
// backend/src/controllers/callController.js.
//
// Both halves of the ticket path were dead until SQL 067: sp_LogCall stored a
// TicketId but never wrote to the ticket timeline, and sp_FetchCalls had no
// TicketId parameter at all — so a call logged on a complaint appeared in no
// list and no history. Do not use these against a backend older than that.
import { post, postData } from "./client";
import type { ApiEnvelope, Call } from "../types/api";

export const CALL_ENDPOINTS = {
  logCall: "/api/calls/logCall",
  fetchCalls: "/api/calls/fetchCalls",
} as const;

export type CallDirection = "in" | "out";

/**
 * Exactly one of LeadId / TicketId. `NextFollowupDate` schedules a follow-up in
 * the same round trip, and is lead-only — tblFollowUp hangs off LeadId, and a
 * ticket's next step is its stage rather than a diary entry.
 */
export const logCall = (params: {
  LeadId?: number | null;
  TicketId?: number | null;
  Direction: CallDirection;
  OutcomeId?: number | null;
  Notes?: string | null;
  /** Minutes. */
  Duration?: number | null;
  NextFollowupDate?: string | null;
  FollowupRemarks?: string | null;
}): Promise<ApiEnvelope<{ Id: number }>> =>
  post(CALL_ENDPOINTS.logCall, {
    LeadId: null,
    TicketId: null,
    OutcomeId: null,
    Notes: null,
    Duration: null,
    NextFollowupDate: null,
    FollowupRemarks: null,
    ...params,
  });

/**
 * Filters by lead, else by ticket, else falls back to the caller's own calls.
 * Sending both ids narrows to the lead rather than returning the union.
 */
export const fetchCalls = (
  params: { LeadId?: number | null; TicketId?: number | null } = {},
): Promise<Call[]> =>
  postData<Call>(
    CALL_ENDPOINTS.fetchCalls,
    { LeadId: null, TicketId: null, ...params },
    "calls",
  );
