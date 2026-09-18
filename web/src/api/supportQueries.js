// src/api/supportQueries.js
// Endpoint constants + thin POST fetchers for the Support / complaints module
// (spec 2, 2026-09-16). Tickets are a flat status list now — the pipeline
// engine is gone. Lookups + custom fields still come from the shared config
// engine (Kind/Entity='ticket'); calls from the sales call log.
import { apiClient } from "../utils/axiosConfig";
import { SALES_ENDPOINTS } from "./salesQueries";

export const SUPPORT_ENDPOINTS = {
  tickets: {
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
  },
  customers: {
    saveCustomer: "/api/customers/saveCustomer",
    fetchCustomers: "/api/customers/fetchCustomers",
    fetchCustomerDetail: "/api/customers/fetchCustomerDetail",
    deleteCustomer: "/api/customers/deleteCustomer",
  },
  reports: {
    ticketsByCategory: "/api/reports/ticketsByCategory",
    resolutionSummary: "/api/reports/resolutionSummary",
  },
  // Shared engine (same SPs as sales) — lookups + custom fields, Kind/Entity='ticket'.
  config: SALES_ENDPOINTS.config,
  calls: SALES_ENDPOINTS.calls,
};

const post = (endpoint) => (params = {}) => apiClient.post(endpoint, params);

// Tickets
export const saveTicket = post(SUPPORT_ENDPOINTS.tickets.saveTicket);
export const fetchTickets = post(SUPPORT_ENDPOINTS.tickets.fetchTickets);
export const fetchTicketDetail = post(SUPPORT_ENDPOINTS.tickets.fetchTicketDetail);
export const setTicketStatus = post(SUPPORT_ENDPOINTS.tickets.setTicketStatus);
export const resolveTicket = post(SUPPORT_ENDPOINTS.tickets.resolveTicket);
export const closeTicket = post(SUPPORT_ENDPOINTS.tickets.closeTicket);
export const rejectTicket = post(SUPPORT_ENDPOINTS.tickets.rejectTicket);
export const reopenTicket = post(SUPPORT_ENDPOINTS.tickets.reopenTicket);
export const transferTicket = post(SUPPORT_ENDPOINTS.tickets.transferTicket);
export const bulkTransferTickets = post(SUPPORT_ENDPOINTS.tickets.bulkTransferTickets);
export const escalateTicket = post(SUPPORT_ENDPOINTS.tickets.escalateTicket);
export const fetchEscalationTargets = post(SUPPORT_ENDPOINTS.tickets.fetchEscalationTargets);
export const deleteTicket = post(SUPPORT_ENDPOINTS.tickets.deleteTicket);

// Customers
export const saveCustomer = post(SUPPORT_ENDPOINTS.customers.saveCustomer);
export const fetchCustomers = post(SUPPORT_ENDPOINTS.customers.fetchCustomers);
export const fetchCustomerDetail = post(SUPPORT_ENDPOINTS.customers.fetchCustomerDetail);
export const deleteCustomer = post(SUPPORT_ENDPOINTS.customers.deleteCustomer);

// Reports
export const ticketsByCategory = post(SUPPORT_ENDPOINTS.reports.ticketsByCategory);
export const resolutionSummary = post(SUPPORT_ENDPOINTS.reports.resolutionSummary);
