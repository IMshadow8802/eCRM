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
  LoggedByMeRow,
  Pagination,
  Ticket,
  TicketDetail,
  TicketStatusCode,
} from "../types/api";

const TICKET_ENDPOINTS = {
  saveTicket: "/api/tickets/saveTicket",
  fetchTickets: "/api/tickets/fetchTickets",
  fetchTicketDetail: "/api/tickets/fetchTicketDetail",
  setTicketStatus: "/api/tickets/setTicketStatus",
  transferTicket: "/api/tickets/transferTicket",
  escalateTicket: "/api/tickets/escalateTicket",
  fetchEscalationTargets: "/api/tickets/fetchEscalationTargets",
  fetchLoggedByMe: "/api/tickets/fetchLoggedByMe",
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
  /**
   * 118: a ResolvedAt bracket — From inclusive, To an EXCLUSIVE instant (send
   * tomorrow for "through today"). Sent only when set: an sp_FetchTickets
   * from before 118 has no such params and would error on them.
   */
  ResolvedFrom?: string | null;
  ResolvedTo?: string | null;
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
  ResolvedFrom = null,
  ResolvedTo = null,
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
    ...(ResolvedFrom ? { ResolvedFrom } : null),
    ...(ResolvedTo ? { ResolvedTo } : null),
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
  /** Optional, like the web's (only CustomerId + Subject are required). */
  Description: string | null;
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

/**
 * Reassign (reason + remarks) or, with `SendBack`, return it to whoever gave
 * it to the caller (`SendBackToId` on the detail; remarks only, no reason).
 */
export const transferTicket = (params: {
  TicketId: number;
  ToUserId: number;
  ToBranchId?: number | null;
  ReasonId?: number | null;
  Remarks: string;
  SendBack?: boolean;
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
 * Who this complaint may be escalated to, nearest first — the server works out
 * the chain above whoever is working it.
 */
export const fetchEscalationTargets = (ticketId: number): Promise<EscalationTarget[]> =>
  postData<EscalationTarget>(TICKET_ENDPOINTS.fetchEscalationTargets, { TicketId: ticketId }, "users");

/** Complaints the caller logged, wherever they went. A row with `CanOpen` false has `Id` null. */
export const fetchLoggedByMe = ({
  SearchTerm = null,
  PageNumber = 1,
  PageSize = 50,
}: { SearchTerm?: string | null; PageNumber?: number; PageSize?: number } = {}): Promise<{
  rows: LoggedByMeRow[];
  pagination: Pagination;
}> =>
  post<{ rows?: LoggedByMeRow[]; pagination?: Pagination }>(TICKET_ENDPOINTS.fetchLoggedByMe, {
    SearchTerm,
    PageNumber,
    PageSize,
  }).then((b) => ({
    rows: b.data?.rows ?? [],
    pagination: b.data?.pagination ?? { currentPage: PageNumber, pageSize: PageSize, totalRecords: 0, totalPages: 0 },
  }));

export const deleteTicket = (params: {
  Id: number;
}): Promise<ApiEnvelope<unknown>> => post(TICKET_ENDPOINTS.deleteTicket, params);
