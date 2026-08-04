// src/api/platformQueries.js
// Endpoint constants + thin POST fetchers for cross-cutting platform concerns
// (kanban columns, notifications, auth). Same shape as api/salesQueries.js.
import { apiClient } from "../utils/axiosConfig";

export const PLATFORM_ENDPOINTS = {
  kanban: {
    fetchKanbanColumns: "/api/kanban/fetchKanbanColumns",
    saveKanbanColumn: "/api/kanban/saveKanbanColumn",
    deleteKanbanColumn: "/api/kanban/deleteKanbanColumn",
  },
  notifications: {
    fetchNotifications: "/api/notifications/fetchNotifications",
    markNotificationRead: "/api/notifications/markNotificationRead",
    markAllNotificationsRead: "/api/notifications/markAllNotificationsRead",
  },
  auth: {
    loginUser: "/api/auth/loginUser",
    logoutUser: "/api/auth/logoutUser",
  },
};

// ponytail: same one-line factory as the other query modules.
const post = (endpoint) => (params = {}) => apiClient.post(endpoint, params);

// Kanban columns
export const fetchKanbanColumns = post(PLATFORM_ENDPOINTS.kanban.fetchKanbanColumns);
export const saveKanbanColumn = post(PLATFORM_ENDPOINTS.kanban.saveKanbanColumn);
export const deleteKanbanColumn = post(PLATFORM_ENDPOINTS.kanban.deleteKanbanColumn);

// Notifications
export const fetchNotifications = post(PLATFORM_ENDPOINTS.notifications.fetchNotifications);
export const markNotificationRead = post(PLATFORM_ENDPOINTS.notifications.markNotificationRead);
export const markAllNotificationsRead = post(
  PLATFORM_ENDPOINTS.notifications.markAllNotificationsRead,
);

// Auth
export const loginUser = post(PLATFORM_ENDPOINTS.auth.loginUser);
export const logoutUser = post(PLATFORM_ENDPOINTS.auth.logoutUser);
