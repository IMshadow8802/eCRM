// src/api/salesQueries.js
// Endpoint constants + thin POST fetchers for the sales module (config,
// products, leads, follow-ups, reports). Mirrors how pages call
// useApiQuery/useApiMutation today (POST via the shared apiClient) — see
// hooks/useApiQuery.jsx.
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
  products: {
    saveProduct: "/api/products/saveProduct",
    fetchProducts: "/api/products/fetchProducts",
    deleteProduct: "/api/products/deleteProduct",
  },
  users: {
    fetchAssignableUsers: "/api/users/fetchAssignableUsers",
    fetchBranches: "/api/users/fetchBranches",
  },
  leads: {
    saveLeads: "/api/leads/saveLeads",
    fetchLeads: "/api/leads/fetchLeads",
    fetchLeadDetail: "/api/leads/fetchLeadDetail",
    setLeadStatus: "/api/leads/setLeadStatus",
    transferLead: "/api/leads/transferLead",
    bulkTransferLeads: "/api/leads/bulkTransferLeads",
    deleteLeads: "/api/leads/deleteLeads",
  },
  // Tickets still log calls here (Support/TicketDetail + supportQueries).
  calls: {
    logCall: "/api/calls/logCall",
    fetchCalls: "/api/calls/fetchCalls",
  },
  followups: {
    fetchFollowups: "/api/followups/fetchFollowups",
    scheduleFollowUp: "/api/followups/scheduleFollowUp",
    completeFollowUp: "/api/followups/completeFollowUp",
    skipFollowUp: "/api/followups/skipFollowUp",
    deleteFollowup: "/api/followups/deleteFollowup",
  },
  reports: {
    leadsByStatus: "/api/reports/leadsByStatus",
    callsPerUser: "/api/reports/callsPerUser",
    conversionBySource: "/api/reports/conversionBySource",
  },
};

// ponytail: every fetcher is `apiClient.post(endpoint, params)` — no per-endpoint
// logic exists yet, so one factory beats 30 hand-written near-duplicates.
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

// Products
export const saveProduct = post(SALES_ENDPOINTS.products.saveProduct);
export const fetchProducts = post(SALES_ENDPOINTS.products.fetchProducts);
export const deleteProduct = post(SALES_ENDPOINTS.products.deleteProduct);

// Users / branches (assignment + transfer pickers)
export const fetchAssignableUsers = post(SALES_ENDPOINTS.users.fetchAssignableUsers);
export const fetchBranches = post(SALES_ENDPOINTS.users.fetchBranches);

// Leads
export const saveLeads = post(SALES_ENDPOINTS.leads.saveLeads);
export const fetchLeads = post(SALES_ENDPOINTS.leads.fetchLeads);
export const fetchLeadDetail = post(SALES_ENDPOINTS.leads.fetchLeadDetail);
export const setLeadStatus = post(SALES_ENDPOINTS.leads.setLeadStatus);
export const transferLead = post(SALES_ENDPOINTS.leads.transferLead);
export const bulkTransferLeads = post(SALES_ENDPOINTS.leads.bulkTransferLeads);
export const deleteLeads = post(SALES_ENDPOINTS.leads.deleteLeads);

// Calls
export const logCall = post(SALES_ENDPOINTS.calls.logCall);
export const fetchCalls = post(SALES_ENDPOINTS.calls.fetchCalls);

// Follow-ups
export const fetchFollowups = post(SALES_ENDPOINTS.followups.fetchFollowups);
export const scheduleFollowUp = post(SALES_ENDPOINTS.followups.scheduleFollowUp);
export const completeFollowUp = post(SALES_ENDPOINTS.followups.completeFollowUp);
export const skipFollowUp = post(SALES_ENDPOINTS.followups.skipFollowUp);
export const deleteFollowup = post(SALES_ENDPOINTS.followups.deleteFollowup);

// Reports
export const leadsByStatus = post(SALES_ENDPOINTS.reports.leadsByStatus);
export const callsPerUser = post(SALES_ENDPOINTS.reports.callsPerUser);
export const conversionBySource = post(SALES_ENDPOINTS.reports.conversionBySource);
