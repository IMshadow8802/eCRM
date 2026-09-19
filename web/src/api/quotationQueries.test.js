import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../utils/axiosConfig", () => ({ apiClient: { post: vi.fn() } }));

import { apiClient } from "../utils/axiosConfig";
import * as q from "./quotationQueries";

beforeEach(() => vi.clearAllMocks());

describe("quotationQueries", () => {
  it.each([
    ["saveQuotation", "/api/quotations/saveQuotation"],
    ["fetchQuotations", "/api/quotations/fetchQuotations"],
    ["fetchQuotationDetail", "/api/quotations/fetchQuotationDetail"],
    ["finaliseQuotation", "/api/quotations/finaliseQuotation"],
    ["reviseQuotation", "/api/quotations/reviseQuotation"],
    ["rejectQuotation", "/api/quotations/rejectQuotation"],
    ["deleteQuotation", "/api/quotations/deleteQuotation"],
    ["ensureQuoteProfile", "/api/quotations/ensureQuoteProfile"],
    ["saveQuoteProfile", "/api/quotations/saveQuoteProfile"],
    ["convertLead", "/api/leads/convertLead"],
  ])("%s posts to %s", (fn, url) => {
    q[fn]({ a: 1 });
    expect(apiClient.post).toHaveBeenCalledWith(url, { a: 1 });
  });

  it("defaults to an empty body", () => {
    q.fetchQuotations();
    expect(apiClient.post).toHaveBeenCalledWith("/api/quotations/fetchQuotations", {});
  });

  it("names every endpoint exactly once", () => {
    const urls = Object.values(q.QUOTATION_ENDPOINTS);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls).toHaveLength(10);
  });
});
