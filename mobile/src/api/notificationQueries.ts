// src/api/notificationQueries.ts
// In-app notification list only. Push (Expo tokens, APNs/FCM) is out of scope
// for Phase A — see spec §5.3.
import { post, postData } from "./client";
import type { ApiEnvelope, Notification } from "../types/api";

export const NOTIFICATION_ENDPOINTS = {
  fetchNotifications: "/api/notifications/fetchNotifications",
  markNotificationRead: "/api/notifications/markNotificationRead",
  markAllNotificationsRead: "/api/notifications/markAllNotificationsRead",
} as const;

export const fetchNotifications = (
  params: {
    UnreadOnly?: boolean;
    PageNumber?: number;
    PageSize?: number;
    SearchTerm?: string | null;
  } = {},
): Promise<Notification[]> =>
  postData<Notification>(
    NOTIFICATION_ENDPOINTS.fetchNotifications,
    {
      UnreadOnly: false,
      PageNumber: 1,
      PageSize: 25,
      SearchTerm: null,
      ...params,
    },
    "notifications",
  );

export const markNotificationRead = (params: {
  Id: number;
}): Promise<ApiEnvelope<unknown>> =>
  post(NOTIFICATION_ENDPOINTS.markNotificationRead, params);

export const markAllNotificationsRead = (): Promise<ApiEnvelope<unknown>> =>
  post(NOTIFICATION_ENDPOINTS.markAllNotificationsRead, {});
