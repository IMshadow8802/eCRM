// src/api/supportQueries.js
// Endpoint constants + thin POST fetchers for the Support/ticketing module.
// Reuses the shared config engine (custom fields / pipelines / lookups) and
// call logging from salesQueries via Entity/Kind='ticket'.
import { apiClient } from "../utils/axiosConfig";
import { SALES_ENDPOINTS } from "./salesQueries";

export const SUPPORT_ENDPOINTS = {
  tickets: {
    saveTicket: "/api/tickets/saveTicket",
    fetchTickets: "/api/tickets/fetchTickets",
    fetchTicketDetail: "/api/tickets/fetchTicketDetail",
    moveTicketStage: "/api/tickets/moveTicketStage",
    resolveTicket: "/api/tickets/resolveTicket",
    closeTicket: "/api/tickets/closeTicket",
    reopenTicket: "/api/tickets/reopenTicket",
    deleteTicket: "/api/tickets/deleteTicket",
  },
  reports: {
    ticketsByCategory: "/api/reports/ticketsByCategory",
    resolutionSummary: "/api/reports/resolutionSummary",
  },
  // shared engine (same SPs as sales, Entity/Kind='ticket')
  config: SALES_ENDPOINTS.config,
  calls: SALES_ENDPOINTS.calls,
};

const post = (endpoint) => (params = {}) => apiClient.post(endpoint, params);

// Tickets
export const saveTicket = post(SUPPORT_ENDPOINTS.tickets.saveTicket);
export const fetchTickets = post(SUPPORT_ENDPOINTS.tickets.fetchTickets);
export const fetchTicketDetail = post(SUPPORT_ENDPOINTS.tickets.fetchTicketDetail);
export const moveTicketStage = post(SUPPORT_ENDPOINTS.tickets.moveTicketStage);
export const resolveTicket = post(SUPPORT_ENDPOINTS.tickets.resolveTicket);
export const closeTicket = post(SUPPORT_ENDPOINTS.tickets.closeTicket);
export const reopenTicket = post(SUPPORT_ENDPOINTS.tickets.reopenTicket);
export const deleteTicket = post(SUPPORT_ENDPOINTS.tickets.deleteTicket);

// Reports
export const ticketsByCategory = post(SUPPORT_ENDPOINTS.reports.ticketsByCategory);
export const resolutionSummary = post(SUPPORT_ENDPOINTS.reports.resolutionSummary);
