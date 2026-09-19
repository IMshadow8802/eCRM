// src/api/quotationQueries.js
// Endpoint constants + thin POST fetchers for quotations and the lead convert
// engine (spec 3). Same shape as salesQueries.js. Nothing in a page inlines one
// of these URLs.
import { apiClient } from "../utils/axiosConfig";

export const QUOTATION_ENDPOINTS = {
  saveQuotation: "/api/quotations/saveQuotation",
  fetchQuotations: "/api/quotations/fetchQuotations",
  fetchQuotationDetail: "/api/quotations/fetchQuotationDetail",
  finaliseQuotation: "/api/quotations/finaliseQuotation",
  reviseQuotation: "/api/quotations/reviseQuotation",
  rejectQuotation: "/api/quotations/rejectQuotation",
  deleteQuotation: "/api/quotations/deleteQuotation",
  ensureQuoteProfile: "/api/quotations/ensureQuoteProfile",
  saveQuoteProfile: "/api/quotations/saveQuoteProfile",
  // Lives under /api/leads: winning a lead is a lead action, with or without a
  // quotation. Kept here because every caller is a quotation screen or WonDialog.
  convertLead: "/api/leads/convertLead",
};

const post = (endpoint) => (params = {}) => apiClient.post(endpoint, params);

export const saveQuotation = post(QUOTATION_ENDPOINTS.saveQuotation);
export const fetchQuotations = post(QUOTATION_ENDPOINTS.fetchQuotations);
export const fetchQuotationDetail = post(QUOTATION_ENDPOINTS.fetchQuotationDetail);
export const finaliseQuotation = post(QUOTATION_ENDPOINTS.finaliseQuotation);
export const reviseQuotation = post(QUOTATION_ENDPOINTS.reviseQuotation);
export const rejectQuotation = post(QUOTATION_ENDPOINTS.rejectQuotation);
export const deleteQuotation = post(QUOTATION_ENDPOINTS.deleteQuotation);
export const ensureQuoteProfile = post(QUOTATION_ENDPOINTS.ensureQuoteProfile);
export const saveQuoteProfile = post(QUOTATION_ENDPOINTS.saveQuoteProfile);
export const convertLead = post(QUOTATION_ENDPOINTS.convertLead);
