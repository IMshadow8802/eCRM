// src/api/ticketQueries.ts
// Support / complaints. Payloads taken from
// backend/src/controllers/ticketController.js, not guessed.
//
// The lifecycle rule this file exists to protect: **one engine writes status**.
// `sp_SetTicketStatus` stamps ResolvedAt, ClosedAt, ResolutionId and the reopen
// DueAt; resolve / close / reject / reopen are shortcuts into it. Nothing here
// writes those columns, and `saveTicket` never carries a status — the SP seeds
// the first `open` status on insert and ignores any on update.
import { post, postData } from "./client";
import type {
  ApiEnvelope,
  EscalationTarget,
  Pagination,
  Ticket,
  TicketDetail,
  TicketStatusCode,
} from "../types/api";

export const TICKET_ENDPOINTS = {
  saveTicket: "/api/tickets/saveTicket",
  fetchTickets: "/api/tickets/fetchTickets",
  fetchTicketDetail: "/api/tickets/fetchTicketDetail",
  setTicketStatus: "/api/tickets/setTicketStatus",
  resolveTicket: "/api/tickets/resolveTicket",
  closeTicket: "/api/tickets/closeTicket",
  rejectTicket: "/api/tickets/rejectTicket",
  reopenTicket: "/api/tickets/reopenTicket",
  transferTicket: "/api/tickets/transferTicket",
  escalateTicket: "/api/tickets/escalateTicket",
  fetchEscalationTargets: "/api/tickets/fetchEscalationTargets",
  deleteTicket: "/api/tickets/deleteTicket",
} as const;

// bulkTransferTickets is deliberately absent: multi-select is desk work and
// stays on the web.

export interface FetchTicketsParams {
  /** Narrows within the caller's scope. It can never widen visibility. */
  BranchId?: number | null;
  PageNumber?: number;
  PageSize?: number;
  SearchTerm?: string | null;
  StatusId?: number | null;
  /** One ticket_status code, or `"active"` = open + onhold. */
  StatusCode?: TicketStatusCode | "active" | null;
  Priority?: number | null;
  CategoryId?: number | null;
  ChannelId?: number | null;
  ProductId?: number | null;
  CustomerId?: number | null;
  AssignedTo?: number | null;
  /** Non-terminal and past DueAt. */
  Overdue?: boolean;
  /** Non-terminal and (escalated to the caller OR overdue) — a manager's queue. */
  Escalated?: boolean;
  Unassigned?: boolean;
  /** Window on CreatedAt; `ToDate` inclusive. Local Y-M-D strings. */
  FromDate?: string | null;
  ToDate?: string | null;
}

export interface TicketsPayload {
  tickets: Ticket[];
  pagination: Pagination;
}

/**
 * A record assigned to — or created by — the caller is always visible,
 * OR-ed against branch scope. That rule lives in the SP; the client just asks.
 * Rows come back `ORDER BY IsOverdue DESC, DueAt, CreatedAt DESC` — the list
 * must not re-sort them.
 */
export const fetchTickets = ({
  BranchId = null,
  PageNumber = 1,
  PageSize = 50,
  SearchTerm = null,
  StatusId = null,
  StatusCode = null,
  Priority = null,
  CategoryId = null,
  ChannelId = null,
  ProductId = null,
  CustomerId = null,
  AssignedTo = null,
  Overdue = false,
  Escalated = false,
  Unassigned = false,
  FromDate = null,
  ToDate = null,
}: FetchTicketsParams = {}): Promise<ApiEnvelope<TicketsPayload>> =>
  post<TicketsPayload>(TICKET_ENDPOINTS.fetchTickets, {
    BranchId,
    PageNumber,
    PageSize,
    SearchTerm,
    StatusId,
    StatusCode,
    Priority,
    CategoryId,
    ChannelId,
    ProductId,
    CustomerId,
    AssignedTo,
    // BIT parameters on the SP; 1/0 is the form the controller forwards.
    Overdue: Overdue ? 1 : 0,
    Escalated: Escalated ? 1 : 0,
    Unassigned: Unassigned ? 1 : 0,
    FromDate,
    ToDate,
  });

/**
 * Ticket, custom-field values, timeline, assignment history and the linked
 * lead in one call. When the row does not exist or the caller cannot see it,
 * the controller answers a real 404 (rather than 403, so nobody learns it
 * exists) and the client's response interceptor rejects — this call REJECTS
 * too, it does not resolve with a null ticket. Callers handle that case with
 * `onError`/`isError`, not by checking `.ticket`.
 */
export const fetchTicketDetail = (params: {
  TicketId: number;
}): Promise<TicketDetail> =>
  post<TicketDetail>(TICKET_ENDPOINTS.fetchTicketDetail, params).then(
    (response) => ({
      ticket: response.data?.ticket ?? null,
      fields: response.data?.fields ?? [],
      activity: response.data?.activity ?? [],
      assignments: response.data?.assignments ?? [],
      linkedLead: response.data?.linkedLead ?? null,
    }),
  );

export interface SaveTicketPayload {
  /** 0 inserts, > 0 updates. */
  Id?: number;
  /** An active tblCustomer of the company — the SP answers 404 otherwise. */
  CustomerId: number;
  Subject: string;
  /** "Reported by": who called, and how to reach them back. Both optional. */
  ContactPerson?: string | null;
  Contact?: string | null;
  /** tblLookup id, Kind = 'ticket_channel' (a lookup since 086, not a string). */
  ChannelId?: number | null;
  CategoryId: number | null;
  /** tblLookup id, Kind = 'priority'. Its TatHours sets DueAt. */
  Priority: number | null;
  ProductId?: number | null;
  /** Create only — the SP ignores it on update. Reassigning is transferTicket. */
  AssignedTo?: number | null;
  LinkedLeadId?: number | null;
  Description: string;
  /** `[{fieldId, type, value}]`, serialised. Null when the company has none. */
  CustomJSON?: string | null;
}

/** The status row sp_SaveTicket returns, plus the generated number on insert. */
export interface SaveTicketResult {
  Id: number;
  TicketNo?: string | null;
}

export const saveTicket = ({
  Id = 0,
  ContactPerson = null,
  Contact = null,
  ChannelId = null,
  ProductId = null,
  AssignedTo = null,
  LinkedLeadId = null,
  CustomJSON = null,
  ...rest
}: SaveTicketPayload): Promise<ApiEnvelope<SaveTicketResult>> =>
  post(TICKET_ENDPOINTS.saveTicket, {
    Id,
    ContactPerson,
    Contact,
    ChannelId,
    ProductId,
    AssignedTo,
    LinkedLeadId,
    CustomJSON,
    ...rest,
  });

/**
 * The one transition endpoint — every status move goes through it.
 *
 * What the SP requires depends on where the ticket is and where it is going
 * (spec §2): a `ResolutionId` and remarks into Resolved (or straight into
 * Closed from an active status); remarks into Rejected; remarks to reopen a
 * terminal ticket — and reopening is a manager's act. The controller passes
 * its gate result down and the SP answers 403 "Reopening requires a manager"
 * otherwise. Surface that message; do not second-guess it on the client.
 */
export const setTicketStatus = (params: {
  TicketId: number;
  StatusId: number;
  ResolutionId?: number | null;
  Remarks?: string | null;
}): Promise<ApiEnvelope<unknown>> =>
  post(TICKET_ENDPOINTS.setTicketStatus, {
    ResolutionId: null,
    Remarks: null,
    ...params,
  });

/** Shortcut into setTicketStatus — the company's first `resolved` status. */
export const resolveTicket = (params: {
  TicketId: number;
  ResolutionId: number;
  Remarks: string;
}): Promise<ApiEnvelope<unknown>> =>
  post(TICKET_ENDPOINTS.resolveTicket, params);

/** Shortcut — the first `closed` status. Resolution only when coming from active. */
export const closeTicket = (params: {
  TicketId: number;
  ResolutionId?: number | null;
  Remarks?: string | null;
}): Promise<ApiEnvelope<unknown>> =>
  post(TICKET_ENDPOINTS.closeTicket, {
    ResolutionId: null,
    Remarks: null,
    ...params,
  });

/** Shortcut — the first `rejected` status. Never solved; remarks required. */
export const rejectTicket = (params: {
  TicketId: number;
  Remarks: string;
}): Promise<ApiEnvelope<unknown>> => post(TICKET_ENDPOINTS.rejectTicket, params);

/** Shortcut — back to the first `open` status. Manager-gated server-side. */
export const reopenTicket = (params: {
  TicketId: number;
  Remarks: string;
}): Promise<ApiEnvelope<unknown>> => post(TICKET_ENDPOINTS.reopenTicket, params);

/**
 * Hands the complaint to someone in the caller's assignable list, with a
 * reason (`transfer_reason` lookup) and remarks — both required. The SP writes
 * the assignment row, stamps AssignedAt and notifies the new assignee.
 * `ToBranchId` only when the target sits in another branch; whether the caller
 * MAY do that is decided server-side (wide scopes only).
 */
export const transferTicket = (params: {
  TicketId: number;
  ToUserId: number;
  ToBranchId?: number | null;
  ReasonId: number;
  Remarks: string;
}): Promise<ApiEnvelope<unknown>> =>
  post(TICKET_ENDPOINTS.transferTicket, { ToBranchId: null, ...params });

/**
 * Flags a senior; the ticket stays with its assignee. The target must be an
 * ancestor (ReportsTo chain) of the assignee — offer only what
 * fetchEscalationTargets returned and let the SP's 400 explain anything else.
 */
export const escalateTicket = (params: {
  TicketId: number;
  ToUserId: number;
  Remarks: string;
}): Promise<ApiEnvelope<unknown>> =>
  post(TICKET_ENDPOINTS.escalateTicket, params);

/**
 * The chain of command above `forUserId` (default: the caller), nearest first.
 * Pass the ticket's assignee — an escalation is about who is *working* it.
 */
export const fetchEscalationTargets = (
  forUserId: number | null = null,
): Promise<EscalationTarget[]> =>
  postData<EscalationTarget>(
    TICKET_ENDPOINTS.fetchEscalationTargets,
    { ForUserId: forUserId },
    "users",
  );

export const deleteTicket = (params: {
  Id: number;
}): Promise<ApiEnvelope<unknown>> => post(TICKET_ENDPOINTS.deleteTicket, params);
