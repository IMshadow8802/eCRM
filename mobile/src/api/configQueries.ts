// src/api/configQueries.ts
// The per-company config engine, shared by Support and Sales. One set of
// tables — tblLookup, tblPipeline/tblPipelineStage, tblCustomFieldDef —
// discriminated by `Entity`/`Kind`, so a ticket category and a lead source are
// the same row shape in the same table.
//
// Payloads taken from backend/src/controllers/configController.js.
import { post, postData } from "./client";
import type {
  ConfigEntity,
  CustomFieldDef,
  Lookup,
  Pipeline,
  PipelineStage,
} from "../types/api";

export const CONFIG_ENDPOINTS = {
  fetchLookups: "/api/config/fetchLookups",
  fetchPipelines: "/api/config/fetchPipelines",
  fetchCustomFields: "/api/config/fetchCustomFields",
} as const;

// Writes (saveLookup, savePipeline, saveStage, saveCustomField, and their
// deletes) are deliberately absent: configuring a company's pipelines and
// field definitions is admin desk work and stays on the web.

/**
 * The lists a phone actually needs. `Kind` is free text in the DB, so these
 * constants exist to stop a typo becoming an empty picker with no error.
 */
export const LOOKUP_KIND = {
  ticketCategory: "ticket_category",
  priority: "priority",
  resolution: "resolution",
  callOutcome: "call_outcome",
  leadSource: "lead_source",
  lostReason: "lost_reason",
} as const;

export type LookupKind = (typeof LOOKUP_KIND)[keyof typeof LOOKUP_KIND];

export const fetchLookups = (params: { Kind: LookupKind | string }): Promise<Lookup[]> =>
  postData<Lookup>(CONFIG_ENDPOINTS.fetchLookups, params, "lookups");

/**
 * Two result sets in one call: the entity's pipelines and every stage across
 * them. Stages carry `SortOrder`, `StageType` and `Color` — everything needed
 * to render a lifecycle without a second request.
 */
export const fetchPipelines = (params: {
  Entity: ConfigEntity;
}): Promise<{ pipelines: Pipeline[]; stages: PipelineStage[] }> =>
  post<{ pipelines: Pipeline[]; stages: PipelineStage[] }>(
    CONFIG_ENDPOINTS.fetchPipelines,
    params,
  ).then((response) => ({
    pipelines: response.data?.pipelines ?? [],
    stages: response.data?.stages ?? [],
  }));

export const fetchCustomFields = (params: {
  Entity: ConfigEntity;
}): Promise<CustomFieldDef[]> =>
  postData<CustomFieldDef>(
    CONFIG_ENDPOINTS.fetchCustomFields,
    params,
    "customFields",
  );
