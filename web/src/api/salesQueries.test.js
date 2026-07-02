import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../utils/axiosConfig", () => ({
  apiClient: { post: vi.fn(() => Promise.resolve({ data: { success: true } })) },
}));

import { apiClient } from "../utils/axiosConfig";
import * as salesQueries from "./salesQueries";
import { SALES_ENDPOINTS } from "./salesQueries";

// Every fetcher is the same `post(endpoint)` factory (see salesQueries.js) —
// one table-driven test proves the pattern for all 20 rather than hand
// duplicating the same assertion 20 times.
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
  saveLeads: SALES_ENDPOINTS.leads.saveLeads,
  fetchLeads: SALES_ENDPOINTS.leads.fetchLeads,
  deleteLeads: SALES_ENDPOINTS.leads.deleteLeads,
  transferLead: SALES_ENDPOINTS.leads.transferLead,
  fetchLeadDetail: SALES_ENDPOINTS.leads.fetchLeadDetail,
  moveLeadStage: SALES_ENDPOINTS.leads.moveLeadStage,
  logCall: SALES_ENDPOINTS.calls.logCall,
  fetchCalls: SALES_ENDPOINTS.calls.fetchCalls,
  pipelineFunnel: SALES_ENDPOINTS.reports.pipelineFunnel,
  callsPerUser: SALES_ENDPOINTS.reports.callsPerUser,
  conversionBySource: SALES_ENDPOINTS.reports.conversionBySource,
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
});
