// src/api/ticketQueries.ts
// Support / complaints. Payloads taken from
// backend/src/controllers/ticketController.js, not guessed.
//
// The lifecycle rule this file exists to protect: **stage is the single source
// of truth**. `sp_MoveTicketStage` stamps ResolvedAt, ClosedAt and ResolutionId;
// resolve/close/reopen are shortcuts into it. Nothing here writes those
// columns directly, and `saveTicket` must never be used to change a stage.
import { post } from "./client";
import type {
  ApiEnvelope,
  Pagination,
  Ticket,
  TicketDetail,
} from "../types/api";

export const TICKET_ENDPOINTS = {
  saveTicket: "/api/tickets/saveTicket",
  fetchTickets: "/api/tickets/fetchTickets",
  fetchTicketDetail: "/api/tickets/fetchTicketDetail",
  moveTicketStage: "/api/tickets/moveTicketStage",
  resolveTicket: "/api/tickets/resolveTicket",
  closeTicket: "/api/tickets/closeTicket",
  reopenTicket: "/api/tickets/reopenTicket",
  deleteTicket: "/api/tickets/deleteTicket",
} as const;

export interface FetchTicketsParams {
  /** Narrows within the caller's scope. It can never widen visibility. */
  BranchId?: number | null;
  PageNumber?: number;
  PageSize?: number;
  SearchTerm?: string | null;
  StageId?: number | null;
  Priority?: number | null;
  CategoryId?: number | null;
  AssignedTo?: number | null;
}

interface TicketsPayload {
  tickets: Ticket[];
  pagination: Pagination;
}

/**
 * A record assigned to — or created by — the caller is always visible,
 * OR-ed against branch scope. That rule lives in the SP; the client just asks.
 */
export const fetchTickets = ({
  BranchId = null,
  PageNumber = 1,
  PageSize = 50,
  SearchTerm = null,
  StageId = null,
  Priority = null,
  CategoryId = null,
  AssignedTo = null,
}: FetchTicketsParams = {}): Promise<ApiEnvelope<TicketsPayload>> =>
  post<TicketsPayload>(TICKET_ENDPOINTS.fetchTickets, {
    BranchId,
    PageNumber,
    PageSize,
    SearchTerm,
    StageId,
    Priority,
    CategoryId,
    AssignedTo,
  });

/**
 * Ticket, custom-field values, activity timeline and the linked lead, in one
 * call. Returns a null ticket when the row exists but the caller cannot see it
 * — the controller answers 404 rather than 403 so nobody learns it exists.
 */
export const fetchTicketDetail = (params: {
  TicketId: number;
}): Promise<TicketDetail> =>
  post<TicketDetail>(TICKET_ENDPOINTS.fetchTicketDetail, params).then(
    (response) => ({
      ticket: response.data?.ticket ?? null,
      fields: response.data?.fields ?? [],
      activity: response.data?.activity ?? [],
      linkedLead: response.data?.linkedLead ?? null,
    }),
  );

export interface SaveTicketPayload {
  /** 0 inserts, > 0 updates. */
  Id?: number;
  CustomerName: string;
  ContactPerson: string;
  Contact: string;
  /** Free varchar(20) on the SP — no lookup drives it. See CHANNELS. */
  Channel: string;
  CategoryId: number | null;
  /** A tblLookup id (Kind = 'priority'), not a string. */
  Priority: number | null;
  PipelineId?: number | null;
  /**
   * Leave null on create — the SP seeds the default pipeline's first stage.
   * Never send this to move a ticket along; that is moveTicketStage's job.
   */
  StageId?: number | null;
  AssignedTo?: number | null;
  LinkedLeadId?: number | null;
  Description: string;
  /** `[{fieldId, type, value}]`, serialised. Null when the company has none. */
  CustomJSON?: string | null;
}

export const saveTicket = ({
  Id = 0,
  PipelineId = null,
  StageId = null,
  AssignedTo = null,
  LinkedLeadId = null,
  CustomJSON = null,
  ...rest
}: SaveTicketPayload): Promise<ApiEnvelope<{ Id: number }>> =>
  post(TICKET_ENDPOINTS.saveTicket, {
    Id,
    PipelineId,
    StageId,
    AssignedTo,
    LinkedLeadId,
    CustomJSON,
    ...rest,
  });

/**
 * The one transition endpoint. `ResolutionId` is required when moving into the
 * first `won` stage (Resolved) — the SP rejects the move without it. Moving
 * back to an `open` stage clears ResolvedAt/ClosedAt/ResolutionId, which is
 * what "reopen" means.
 */
export const moveTicketStage = (params: {
  TicketId: number;
  StageId: number;
  ResolutionId?: number | null;
}): Promise<ApiEnvelope<unknown>> =>
  post(TICKET_ENDPOINTS.moveTicketStage, { ResolutionId: null, ...params });

/** Shortcut into moveTicketStage — jumps to the first `won` stage. */
export const resolveTicket = (params: {
  TicketId: number;
  ResolutionId: number;
}): Promise<ApiEnvelope<unknown>> =>
  post(TICKET_ENDPOINTS.resolveTicket, params);

/** Shortcut into moveTicketStage — jumps to the final `won` stage. */
export const closeTicket = (params: {
  TicketId: number;
}): Promise<ApiEnvelope<unknown>> => post(TICKET_ENDPOINTS.closeTicket, params);

/** Shortcut into moveTicketStage — back to the first `open` stage. */
export const reopenTicket = (params: {
  TicketId: number;
}): Promise<ApiEnvelope<unknown>> => post(TICKET_ENDPOINTS.reopenTicket, params);

export const deleteTicket = (params: {
  Id: number;
}): Promise<ApiEnvelope<unknown>> => post(TICKET_ENDPOINTS.deleteTicket, params);
