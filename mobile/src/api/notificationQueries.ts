// Payloads taken from backend/src/controllers/notificationController.js.
import { post } from "./client";
import type { ApiEnvelope, AppNotification, Pagination } from "../types/api";

export const NOTIFICATION_ENDPOINTS = {
  fetchNotifications: "/api/notifications/fetchNotifications",
  markNotificationRead: "/api/notifications/markNotificationRead",
  markAllNotificationsRead: "/api/notifications/markAllNotificationsRead",
} as const;

export interface NotificationsPayload {
  notifications: AppNotification[];
  unreadCount: number;
  pagination: Pagination;
}

export const fetchNotifications = ({
  UnreadOnly = false,
  PageNumber = 1,
  PageSize = 50,
  SearchTerm = null,
}: {
  UnreadOnly?: boolean;
  PageNumber?: number;
  PageSize?: number;
  SearchTerm?: string | null;
} = {}): Promise<ApiEnvelope<NotificationsPayload>> =>
  post<NotificationsPayload>(NOTIFICATION_ENDPOINTS.fetchNotifications, {
    UnreadOnly,
    PageNumber,
    PageSize,
    SearchTerm,
  });

export const markNotificationRead = (Id: number) =>
  post(NOTIFICATION_ENDPOINTS.markNotificationRead, { Id });

export const markAllNotificationsRead = () =>
  post<{ updatedCount: number }>(NOTIFICATION_ENDPOINTS.markAllNotificationsRead, {});
