// src/api/customerQueries.ts
// The customer behind a complaint. Payloads taken from
// backend/src/controllers/customerController.js.
//
// Mobile has no Customers screen — the complaint form embeds a search-or-create
// picker, so only the two calls it needs live here. Customer detail and delete
// are desk work and stay on the web.
import { post, postData } from "./client";
import type { ApiEnvelope, Customer } from "../types/api";

export const CUSTOMER_ENDPOINTS = {
  fetchCustomers: "/api/customers/fetchCustomers",
  saveCustomer: "/api/customers/saveCustomer",
} as const;

/**
 * Company-wide on purpose: a customer is one record however many branches they
 * have complained to, and the picker has to find the existing row before
 * someone creates a fourth spelling of the same mobile. The SP searches
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
   * another active customer in the company already has that mobile.
   */
  Mobile?: string | null;
  AltMobile?: string | null;
  Email?: string | null;
  Address?: string | null;
  City?: string | null;
  State?: string | null;
  Pincode?: string | null;
  Remarks?: string | null;
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
  });
