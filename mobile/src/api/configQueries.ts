// src/api/configQueries.ts
// The per-company config engine, shared by Support and Sales. One set of
// tables — tblLookup, tblCustomFieldDef — discriminated by `Entity`/`Kind`, so
// a ticket category and a lead source are the same row shape in the same
// table. The pipeline engine (tblPipeline/tblPipelineStage) was dropped in 086;
// tickets carry a flat `ticket_status` lookup with a Code, like leads.
//
// Payloads taken from backend/src/controllers/configController.js.
import { postData } from "./client";
import type { ConfigEntity, CustomFieldDef, Lookup } from "../types/api";

export const CONFIG_ENDPOINTS = {
  fetchLookups: "/api/config/fetchLookups",
  fetchCustomFields: "/api/config/fetchCustomFields",
} as const;

// Writes (saveLookup, saveCustomField and their deletes) are deliberately
// absent: configuring a company's lists and field definitions is admin desk
// work and stays on the web.

/**
 * The lists a phone actually needs. `Kind` is free text in the DB, so these
 * constants exist to stop a typo becoming an empty picker with no error.
 */
export const LOOKUP_KIND = {
  ticketCategory: "ticket_category",
  ticketStatus: "ticket_status",
  ticketChannel: "ticket_channel",
  priority: "priority",
  resolution: "resolution",
  callOutcome: "call_outcome",
  transferReason: "transfer_reason",
  leadSource: "lead_source",
  lostReason: "lost_reason",
} as const;

export type LookupKind = (typeof LOOKUP_KIND)[keyof typeof LOOKUP_KIND];

/** Active rows of one kind, in SortOrder. `Code` and `TatHours` travel with the row. */
export const fetchLookups = (params: { Kind: LookupKind | string }): Promise<Lookup[]> =>
  postData<Lookup>(CONFIG_ENDPOINTS.fetchLookups, params, "lookups");

export const fetchCustomFields = (params: {
  Entity: ConfigEntity;
}): Promise<CustomFieldDef[]> =>
  postData<CustomFieldDef>(
    CONFIG_ENDPOINTS.fetchCustomFields,
    params,
    "customFields",
  );
