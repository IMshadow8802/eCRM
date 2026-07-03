// src/api/salesQueries.js
// Endpoint constants + thin POST fetchers for the sales module (config,
// leads, calls, reports). Mirrors how pages call useApiQuery/useApiMutation
// today (POST via the shared apiClient) — see hooks/useApiQuery.jsx.
import { apiClient } from "../utils/axiosConfig";

export const SALES_ENDPOINTS = {
  config: {
    saveCustomField: "/api/config/saveCustomField",
    fetchCustomFields: "/api/config/fetchCustomFields",
    deleteCustomField: "/api/config/deleteCustomField",
    savePipeline: "/api/config/savePipeline",
    fetchPipelines: "/api/config/fetchPipelines",
    saveStage: "/api/config/saveStage",
    deleteStage: "/api/config/deleteStage",
    saveLookup: "/api/config/saveLookup",
    fetchLookups: "/api/config/fetchLookups",
    deleteLookup: "/api/config/deleteLookup",
  },
  leads: {
    saveLeads: "/api/leads/saveLeads",
    fetchLeads: "/api/leads/fetchLeads",
    deleteLeads: "/api/leads/deleteLeads",
    transferLead: "/api/leads/transferLead",
    fetchLeadDetail: "/api/leads/fetchLeadDetail",
    moveLeadStage: "/api/leads/moveLeadStage",
  },
  calls: {
    logCall: "/api/calls/logCall",
    fetchCalls: "/api/calls/fetchCalls",
  },
  followups: {
    fetchFollowups: "/api/followups/fetchFollowups",
  },
  reports: {
    pipelineFunnel: "/api/reports/pipelineFunnel",
    callsPerUser: "/api/reports/callsPerUser",
    conversionBySource: "/api/reports/conversionBySource",
  },
};

// ponytail: every fetcher is `apiClient.post(endpoint, params)` — no per-endpoint
// logic exists yet, so one factory beats 19 hand-written near-duplicates.
const post = (endpoint) => (params = {}) => apiClient.post(endpoint, params);

// Config (custom fields, pipelines, stages, lookups)
export const saveCustomField = post(SALES_ENDPOINTS.config.saveCustomField);
export const fetchCustomFields = post(SALES_ENDPOINTS.config.fetchCustomFields);
export const deleteCustomField = post(SALES_ENDPOINTS.config.deleteCustomField);
export const savePipeline = post(SALES_ENDPOINTS.config.savePipeline);
export const fetchPipelines = post(SALES_ENDPOINTS.config.fetchPipelines);
export const saveStage = post(SALES_ENDPOINTS.config.saveStage);
export const deleteStage = post(SALES_ENDPOINTS.config.deleteStage);
export const saveLookup = post(SALES_ENDPOINTS.config.saveLookup);
export const fetchLookups = post(SALES_ENDPOINTS.config.fetchLookups);
export const deleteLookup = post(SALES_ENDPOINTS.config.deleteLookup);

// Leads
export const saveLeads = post(SALES_ENDPOINTS.leads.saveLeads);
export const fetchLeads = post(SALES_ENDPOINTS.leads.fetchLeads);
export const deleteLeads = post(SALES_ENDPOINTS.leads.deleteLeads);
export const transferLead = post(SALES_ENDPOINTS.leads.transferLead);
export const fetchLeadDetail = post(SALES_ENDPOINTS.leads.fetchLeadDetail);
export const moveLeadStage = post(SALES_ENDPOINTS.leads.moveLeadStage);

// Calls
export const logCall = post(SALES_ENDPOINTS.calls.logCall);
export const fetchCalls = post(SALES_ENDPOINTS.calls.fetchCalls);

// Follow-ups
export const fetchFollowups = post(SALES_ENDPOINTS.followups.fetchFollowups);

// Reports
export const pipelineFunnel = post(SALES_ENDPOINTS.reports.pipelineFunnel);
export const callsPerUser = post(SALES_ENDPOINTS.reports.callsPerUser);
export const conversionBySource = post(SALES_ENDPOINTS.reports.conversionBySource);
