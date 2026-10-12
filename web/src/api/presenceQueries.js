// src/api/presenceQueries.js
// Sessions + presence (backend routes/presenceRoutes.js).
import { apiClient } from "../utils/axiosConfig";

export const PRESENCE_ENDPOINTS = {
  fetchSessions: "/api/presence/fetchSessions",
  endSession: "/api/presence/endSession",
  heartbeat: "/api/presence/heartbeat",
  ackNotice: "/api/presence/ackNotice",
};

// Sessions (task 9): the 2-minute heartbeat and the first-sign-in notice ack.
export const heartbeat = (params = {}) => apiClient.post(PRESENCE_ENDPOINTS.heartbeat, params);
export const ackNotice = (params = {}) => apiClient.post(PRESENCE_ENDPOINTS.ackNotice, params);
