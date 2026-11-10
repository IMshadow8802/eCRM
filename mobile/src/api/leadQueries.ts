// src/api/leadQueries.ts
// Sales leads. Payloads taken from backend/src/controllers/leadController.js.
//
// Two lifecycle rules this file protects:
//   - status moves through setLeadStatus, except a win, which only
//     convertLead writes (setLeadStatus refuses `converted`);
//   - ownership moves only through transferLead (reason + remarks), never
//     through saveLeads — the controller nulls OwnerId/StatusId on update.
//
// Partners, commission, quotations, delete and bulk transfer are desk work
// and stay on the web.
import { post } from "./client";
import type { ApiEnvelope, Lead, LeadDetail, LeadStatusCode, Pagination } from "../types/api";

const LEAD_ENDPOINTS = {
  saveLeads: "/api/leads/saveLeads",
  fetchLeads: "/api/leads/fetchLeads",
  fetchLeadDetail: "/api/leads/fetchLeadDetail",
  setLeadStatus: "/api/leads/setLeadStatus",
  convertLead: "/api/leads/convertLead",
  transferLead: "/api/leads/transferLead",
} as const;

export interface FetchLeadsParams {
  PageNumber?: number;
  PageSize?: number;
  SearchTerm?: string | null;
  StatusId?: number | null;
  StatusCode?: LeadStatusCode | null;
  /** Narrows within the caller's reach; it can never widen it. */
  OwnerId?: number | null;
  /** Active and next follow-up before today — the SP decides. */
  Overdue?: boolean;
  Unassigned?: boolean;
}

export interface LeadsPayload {
  leads: Lead[];
  pagination: Pagination;
}

export const fetchLeads = ({
  PageNumber = 1,
  PageSize = 50,
  SearchTerm = null,
  StatusId = null,
  StatusCode = null,
  OwnerId = null,
  Overdue = false,
  Unassigned = false,
}: FetchLeadsParams = {}): Promise<ApiEnvelope<LeadsPayload>> =>
  post<LeadsPayload>(LEAD_ENDPOINTS.fetchLeads, {
    PageNumber,
    PageSize,
    SearchTerm,
    StatusId,
    StatusCode,
    OwnerId,
    Overdue,
    Unassigned,
  });

/**
 * Rejects on 404 (not visible, or gone) like fetchTicketDetail — the
 * controller answers 404 rather than 403 so nobody learns the lead exists.
 * `commissions` is partners data and web-only, so it is not kept.
 */
export const fetchLeadDetail = (params: { LeadId: number }): Promise<LeadDetail> =>
  post<LeadDetail>(LEAD_ENDPOINTS.fetchLeadDetail, params).then((response) => ({
    lead: response.data?.lead ?? null,
    fields: response.data?.fields ?? [],
    activity: response.data?.activity ?? [],
    followups: response.data?.followups ?? [],
    assignments: response.data?.assignments ?? [],
  }));

/** The base columns sp_SaveLead writes on BOTH insert and update. */
export interface LeadBaseFields {
  Name: string;
  Company: string | null;
  MobileNo: string;
  AltMobile: string | null;
  Email: string | null;
  Address: string | null;
  City: string | null;
  State: string | null;
  Pincode: string | null;
  SourceId: number | null;
  ProductId: number | null;
  EstValue: number | null;
  Remarks: string | null;
}

/**
 * Create. Status, owner and first follow-up are honoured on insert only.
 * `CustomJSON` = `[{ fieldId, type, value }]` serialised.
 */
export const createLead = (
  params: LeadBaseFields & {
    StatusId: number | null;
    OwnerId: number | null;
    FirstFollowupAt: string | null;
    CustomJSON: string | null;
  },
): Promise<ApiEnvelope<{ Id: number }>> =>
  post(LEAD_ENDPOINTS.saveLeads, { Id: 0, ...params });

/**
 * Update. The controller turns every missing base key into NULL, so the
 * whole record is always sent. `PartnerId`/`CommType`/`CommValue` are left
 * OUT on purpose — a missing PartnerId keeps the partner, and only a
 * partners-rights user may touch terms. `CustomJSON: null` makes the SP skip
 * the custom-value merge, so stored custom fields survive.
 *
 * Keys are listed, not spread: TypeScript does not stop a caller passing the
 * loaded Lead row, and a spread would forward its PartnerId/OwnerId/StatusId.
 */
export const updateLead = ({
  Id, Name, Company, MobileNo, AltMobile, Email, Address, City, State, Pincode,
  SourceId, ProductId, EstValue, Remarks,
}: LeadBaseFields & { Id: number }): Promise<ApiEnvelope<{ Id: number }>> =>
  post(LEAD_ENDPOINTS.saveLeads, {
    Id, Name, Company, MobileNo, AltMobile, Email, Address, City, State, Pincode,
    SourceId, ProductId, EstValue, Remarks,
    CustomJSON: null,
  });

/** Any status but `converted`. `lost` needs a LostReasonId or the SP refuses. */
export const setLeadStatus = (params: {
  LeadId: number;
  StatusId: number;
  LostReasonId?: number | null;
}): Promise<ApiEnvelope<unknown>> =>
  post(LEAD_ENDPOINTS.setLeadStatus, { LostReasonId: null, ...params });

/** A win without a quotation: the agent's number is the value (0 is valid). */
export const convertLead = (params: {
  LeadId: number;
  WonValue: number;
  Remarks?: string | null;
}): Promise<ApiEnvelope<unknown>> =>
  post(LEAD_ENDPOINTS.convertLead, { Remarks: null, ...params });

/** Reason and remarks are required. `ToBranchId` only for a cross-office move. */
export const transferLead = (params: {
  LeadId: number;
  ToUserId: number;
  ToBranchId: number | null;
  ReasonId: number;
  Remarks: string;
}): Promise<ApiEnvelope<unknown>> => post(LEAD_ENDPOINTS.transferLead, params);
