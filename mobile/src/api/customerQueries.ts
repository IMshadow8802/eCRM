// src/api/customerQueries.ts
// The customer behind a complaint. Payloads taken from
// backend/src/controllers/customerController.js.
//
// Mobile has no Customers screen — the complaint form embeds a search-or-create
// picker and the complaint detail lists a customer's history, so only those
// calls live here. Editing and deleting a customer are desk work on the web.
//
// Customers belong to an office: mobile is unique per (CompId, BranchId,
// Mobile), and what a caller sees and writes follows the `customers` reach.
import { post, postData } from "./client";
import type { ApiEnvelope, Customer, CustomerDetail } from "../types/api";

const CUSTOMER_ENDPOINTS = {
  fetchCustomers: "/api/customers/fetchCustomers",
  saveCustomer: "/api/customers/saveCustomer",
  fetchCustomerDetail: "/api/customers/fetchCustomerDetail",
} as const;

/**
 * Customers are per office since 2026-09-16 (mobile unique per CompId +
 * BranchId); `BranchId: null` asks for every office the caller's `customers`
 * reach covers, and the server narrows to that. The SP searches
 * Name / ContactPerson / Mobile / Email / City.
 */
export const fetchCustomers = ({
  SearchTerm = null,
  PageSize = 10,
}: { SearchTerm?: string | null; PageSize?: number } = {}): Promise<Customer[]> =>
  postData<Customer>(
    CUSTOMER_ENDPOINTS.fetchCustomers,
    { PageNumber: 1, PageSize, SearchTerm, BranchId: null, IsActive: true },
    "customers",
  );

export interface SaveCustomerPayload {
  /** 0 inserts, > 0 updates. */
  Id?: number;
  /** The business or the person. Required. */
  Name: string;
  ContactPerson?: string | null;
  /**
   * Digits and `+` only. The SP strips spaces/dashes and answers 409 when
   * another active customer in the same office already has that mobile.
   */
  Mobile?: string | null;
  AltMobile?: string | null;
  Email?: string | null;
  Address?: string | null;
  City?: string | null;
  State?: string | null;
  Pincode?: string | null;
  Remarks?: string | null;
  /**
   * Create: the office the customer belongs to; null = the caller's home
   * office. On an edit the server reads a different office as a move, so only
   * send it when the office really changes.
   */
  BranchId?: number | null;
}

/** Mobile OR email is required — the SP answers 400 with neither. `data.Id` is the row. */
export const saveCustomer = ({
  Id = 0,
  Name,
  ContactPerson = null,
  Mobile = null,
  AltMobile = null,
  Email = null,
  Address = null,
  City = null,
  State = null,
  Pincode = null,
  Remarks = null,
  BranchId = null,
}: SaveCustomerPayload): Promise<ApiEnvelope<{ Id: number }>> =>
  post(CUSTOMER_ENDPOINTS.saveCustomer, {
    Id,
    Name,
    ContactPerson,
    Mobile,
    AltMobile,
    Email,
    Address,
    City,
    State,
    Pincode,
    Remarks,
    BranchId,
  });

/**
 * The customer (gated by `customers` reach; 403 outside it) and their
 * complaints, newest first — the complaints filtered by the caller's
 * `complaints` reach, so a role without it gets an empty list.
 */
export const fetchCustomerDetail = (params: {
  CustomerId: number;
}): Promise<ApiEnvelope<CustomerDetail>> =>
  post<CustomerDetail>(CUSTOMER_ENDPOINTS.fetchCustomerDetail, params);
