import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";

vi.mock("../utils/axiosConfig", () => ({
  apiClient: { post: vi.fn(() => Promise.resolve({ data: { success: true } })) },
}));

import { apiClient } from "../utils/axiosConfig";
import * as supportQueries from "./supportQueries";
import { SUPPORT_ENDPOINTS } from "./supportQueries";
import { SALES_ENDPOINTS } from "./salesQueries";

describe("SUPPORT_ENDPOINTS", () => {
  it("exposes the spec-2 ticket + customer contract and nothing from the stage era", () => {
    expect(SUPPORT_ENDPOINTS.tickets).toEqual({
      saveTicket: "/api/tickets/saveTicket",
      fetchTickets: "/api/tickets/fetchTickets",
      fetchTicketDetail: "/api/tickets/fetchTicketDetail",
      setTicketStatus: "/api/tickets/setTicketStatus",
      resolveTicket: "/api/tickets/resolveTicket",
      closeTicket: "/api/tickets/closeTicket",
      rejectTicket: "/api/tickets/rejectTicket",
      reopenTicket: "/api/tickets/reopenTicket",
      transferTicket: "/api/tickets/transferTicket",
      bulkTransferTickets: "/api/tickets/bulkTransferTickets",
      escalateTicket: "/api/tickets/escalateTicket",
      fetchEscalationTargets: "/api/tickets/fetchEscalationTargets",
      deleteTicket: "/api/tickets/deleteTicket",
    });
    expect(SUPPORT_ENDPOINTS.customers).toEqual({
      saveCustomer: "/api/customers/saveCustomer",
      fetchCustomers: "/api/customers/fetchCustomers",
      fetchCustomerDetail: "/api/customers/fetchCustomerDetail",
      deleteCustomer: "/api/customers/deleteCustomer",
    });
    expect(SUPPORT_ENDPOINTS.reports).toEqual({
      ticketsByCategory: "/api/reports/ticketsByCategory",
      resolutionSummary: "/api/reports/resolutionSummary",
    });
    expect(SUPPORT_ENDPOINTS.tickets).not.toHaveProperty("moveTicketStage");
  });

  it("re-exports the shared config engine and call log", () => {
    expect(SUPPORT_ENDPOINTS.config).toBe(SALES_ENDPOINTS.config);
    expect(SUPPORT_ENDPOINTS.calls).toBe(SALES_ENDPOINTS.calls);
  });
});

// Every fetcher is the same `post(endpoint)` factory — one table proves them all.
const FETCHERS = {
  saveTicket: SUPPORT_ENDPOINTS.tickets.saveTicket,
  fetchTickets: SUPPORT_ENDPOINTS.tickets.fetchTickets,
  fetchTicketDetail: SUPPORT_ENDPOINTS.tickets.fetchTicketDetail,
  setTicketStatus: SUPPORT_ENDPOINTS.tickets.setTicketStatus,
  resolveTicket: SUPPORT_ENDPOINTS.tickets.resolveTicket,
  closeTicket: SUPPORT_ENDPOINTS.tickets.closeTicket,
  rejectTicket: SUPPORT_ENDPOINTS.tickets.rejectTicket,
  reopenTicket: SUPPORT_ENDPOINTS.tickets.reopenTicket,
  transferTicket: SUPPORT_ENDPOINTS.tickets.transferTicket,
  bulkTransferTickets: SUPPORT_ENDPOINTS.tickets.bulkTransferTickets,
  escalateTicket: SUPPORT_ENDPOINTS.tickets.escalateTicket,
  fetchEscalationTargets: SUPPORT_ENDPOINTS.tickets.fetchEscalationTargets,
  deleteTicket: SUPPORT_ENDPOINTS.tickets.deleteTicket,
  saveCustomer: SUPPORT_ENDPOINTS.customers.saveCustomer,
  fetchCustomers: SUPPORT_ENDPOINTS.customers.fetchCustomers,
  fetchCustomerDetail: SUPPORT_ENDPOINTS.customers.fetchCustomerDetail,
  deleteCustomer: SUPPORT_ENDPOINTS.customers.deleteCustomer,
  ticketsByCategory: SUPPORT_ENDPOINTS.reports.ticketsByCategory,
  resolutionSummary: SUPPORT_ENDPOINTS.reports.resolutionSummary,
};

describe("supportQueries", () => {
  beforeEach(() => { apiClient.post.mockClear(); });

  it.each(Object.entries(FETCHERS))("%s posts to its endpoint with the given params", async (name, endpoint) => {
    const params = { foo: "bar" };
    await supportQueries[name](params);
    expect(apiClient.post).toHaveBeenCalledWith(endpoint, params);
  });

  it("defaults params to {} when called with no arguments", async () => {
    await supportQueries.fetchTickets();
    expect(apiClient.post).toHaveBeenCalledWith(SUPPORT_ENDPOINTS.tickets.fetchTickets, {});
  });

  it("no longer exports the stage-era fetcher", () => {
    expect(supportQueries.moveTicketStage).toBeUndefined();
  });
});
