import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../utils/axiosConfig", () => ({
  apiClient: { post: vi.fn(() => Promise.resolve({ data: { success: true } })) },
}));

import { apiClient } from "../utils/axiosConfig";
import * as salesQueries from "./salesQueries";
import { SALES_ENDPOINTS } from "./salesQueries";

describe("SALES_ENDPOINTS", () => {
  it("exposes the spec-1 lead contract and nothing from the pipeline era", () => {
    expect(SALES_ENDPOINTS.leads).toEqual({
      saveLeads: "/api/leads/saveLeads",
      fetchLeads: "/api/leads/fetchLeads",
      fetchLeadDetail: "/api/leads/fetchLeadDetail",
      setLeadStatus: "/api/leads/setLeadStatus",
      transferLead: "/api/leads/transferLead",
      bulkTransferLeads: "/api/leads/bulkTransferLeads",
      deleteLeads: "/api/leads/deleteLeads",
    });
    expect(SALES_ENDPOINTS.followups).toEqual({
      fetchFollowups: "/api/followups/fetchFollowups",
      scheduleFollowUp: "/api/followups/scheduleFollowUp",
      completeFollowUp: "/api/followups/completeFollowUp",
      skipFollowUp: "/api/followups/skipFollowUp",
      deleteFollowup: "/api/followups/deleteFollowup",
    });
    expect(SALES_ENDPOINTS.products).toEqual({
      saveProduct: "/api/products/saveProduct",
      fetchProducts: "/api/products/fetchProducts",
      deleteProduct: "/api/products/deleteProduct",
    });
    expect(SALES_ENDPOINTS.users).toEqual({
      fetchAssignableUsers: "/api/users/fetchAssignableUsers",
      fetchBranches: "/api/users/fetchBranches",
    });
    expect(SALES_ENDPOINTS.reports).toEqual({
      funnel: "/api/reports/funnel",
      followUpCompliance: "/api/reports/followUpCompliance",
      activity: "/api/reports/activity",
      lost: "/api/reports/lost",
      aging: "/api/reports/aging",
      transfers: "/api/reports/transfers",
      pipelineValue: "/api/reports/pipelineValue",
      leaderboard: "/api/reports/leaderboard",
    });
    expect(SALES_ENDPOINTS.reports).not.toHaveProperty("pipelineFunnel");
  });

  it("keeps the config + calls endpoints Support still reads", () => {
    expect(SALES_ENDPOINTS.config.fetchPipelines).toBe("/api/config/fetchPipelines");
    expect(SALES_ENDPOINTS.calls.logCall).toBe("/api/calls/logCall");
  });
});

// Every fetcher is the same `post(endpoint)` factory (see salesQueries.js) —
// one table-driven test proves the pattern for all of them rather than hand
// duplicating the same assertion 25 times.
const FETCHERS = {
  saveCustomField: SALES_ENDPOINTS.config.saveCustomField,
  fetchCustomFields: SALES_ENDPOINTS.config.fetchCustomFields,
  deleteCustomField: SALES_ENDPOINTS.config.deleteCustomField,
  savePipeline: SALES_ENDPOINTS.config.savePipeline,
  fetchPipelines: SALES_ENDPOINTS.config.fetchPipelines,
  saveStage: SALES_ENDPOINTS.config.saveStage,
  deleteStage: SALES_ENDPOINTS.config.deleteStage,
  saveLookup: SALES_ENDPOINTS.config.saveLookup,
  fetchLookups: SALES_ENDPOINTS.config.fetchLookups,
  deleteLookup: SALES_ENDPOINTS.config.deleteLookup,
  saveProduct: SALES_ENDPOINTS.products.saveProduct,
  fetchProducts: SALES_ENDPOINTS.products.fetchProducts,
  deleteProduct: SALES_ENDPOINTS.products.deleteProduct,
  fetchAssignableUsers: SALES_ENDPOINTS.users.fetchAssignableUsers,
  fetchBranches: SALES_ENDPOINTS.users.fetchBranches,
  saveLeads: SALES_ENDPOINTS.leads.saveLeads,
  fetchLeads: SALES_ENDPOINTS.leads.fetchLeads,
  fetchLeadDetail: SALES_ENDPOINTS.leads.fetchLeadDetail,
  setLeadStatus: SALES_ENDPOINTS.leads.setLeadStatus,
  transferLead: SALES_ENDPOINTS.leads.transferLead,
  bulkTransferLeads: SALES_ENDPOINTS.leads.bulkTransferLeads,
  deleteLeads: SALES_ENDPOINTS.leads.deleteLeads,
  logCall: SALES_ENDPOINTS.calls.logCall,
  fetchCalls: SALES_ENDPOINTS.calls.fetchCalls,
  fetchFollowups: SALES_ENDPOINTS.followups.fetchFollowups,
  scheduleFollowUp: SALES_ENDPOINTS.followups.scheduleFollowUp,
  completeFollowUp: SALES_ENDPOINTS.followups.completeFollowUp,
  skipFollowUp: SALES_ENDPOINTS.followups.skipFollowUp,
  deleteFollowup: SALES_ENDPOINTS.followups.deleteFollowup,
  funnel: SALES_ENDPOINTS.reports.funnel,
  followUpCompliance: SALES_ENDPOINTS.reports.followUpCompliance,
  activity: SALES_ENDPOINTS.reports.activity,
  lost: SALES_ENDPOINTS.reports.lost,
  aging: SALES_ENDPOINTS.reports.aging,
  transfers: SALES_ENDPOINTS.reports.transfers,
  pipelineValue: SALES_ENDPOINTS.reports.pipelineValue,
  leaderboard: SALES_ENDPOINTS.reports.leaderboard,
};

describe("salesQueries", () => {
  beforeEach(() => {
    apiClient.post.mockClear();
  });

  it.each(Object.entries(FETCHERS))(
    "%s posts to its endpoint with the given params",
    async (name, endpoint) => {
      const params = { foo: "bar" };
      await salesQueries[name](params);
      expect(apiClient.post).toHaveBeenCalledWith(endpoint, params);
    },
  );

  it("defaults params to {} when called with no arguments", async () => {
    await salesQueries.fetchLeads();
    expect(apiClient.post).toHaveBeenCalledWith(SALES_ENDPOINTS.leads.fetchLeads, {});
  });

  it("no longer exports the retired pipeline-era or spec-1 report fetchers", () => {
    expect(salesQueries.moveLeadStage).toBeUndefined();
    expect(salesQueries.saveFollowup).toBeUndefined();
    expect(salesQueries.pipelineFunnel).toBeUndefined();
    expect(salesQueries.leadsByStatus).toBeUndefined();
    expect(salesQueries.callsPerUser).toBeUndefined();
    expect(salesQueries.conversionBySource).toBeUndefined();
  });
});
