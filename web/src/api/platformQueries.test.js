import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../utils/axiosConfig", () => ({
  apiClient: { post: vi.fn(() => Promise.resolve({ data: { success: true } })) },
}));

import { apiClient } from "../utils/axiosConfig";
import * as platformQueries from "./platformQueries";
import { PLATFORM_ENDPOINTS } from "./platformQueries";

// Every fetcher is the same `post(endpoint)` factory (see platformQueries.js).
const FETCHERS = {
  fetchKanbanColumns: PLATFORM_ENDPOINTS.kanban.fetchKanbanColumns,
  saveKanbanColumn: PLATFORM_ENDPOINTS.kanban.saveKanbanColumn,
  deleteKanbanColumn: PLATFORM_ENDPOINTS.kanban.deleteKanbanColumn,
  fetchNotifications: PLATFORM_ENDPOINTS.notifications.fetchNotifications,
  markNotificationRead: PLATFORM_ENDPOINTS.notifications.markNotificationRead,
  markAllNotificationsRead: PLATFORM_ENDPOINTS.notifications.markAllNotificationsRead,
  loginUser: PLATFORM_ENDPOINTS.auth.loginUser,
  logoutUser: PLATFORM_ENDPOINTS.auth.logoutUser,
};

describe("platformQueries", () => {
  beforeEach(() => {
    apiClient.post.mockClear();
  });

  it.each(Object.entries(FETCHERS))(
    "%s posts to its endpoint with the given params",
    async (name, endpoint) => {
      const params = { foo: "bar" };
      await platformQueries[name](params);
      expect(apiClient.post).toHaveBeenCalledWith(endpoint, params);
    },
  );

  it("defaults params to {} when called with no arguments", async () => {
    await platformQueries.logoutUser();
    expect(apiClient.post).toHaveBeenCalledWith(PLATFORM_ENDPOINTS.auth.logoutUser, {});
  });

  // utils/authRedirectGuard skips the logout/redirect for auth endpoints by
  // matching on the URL, so these two paths are load-bearing beyond routing.
  it("pins the auth paths the 401 guard matches on", () => {
    expect(PLATFORM_ENDPOINTS.auth.loginUser).toBe("/api/auth/loginUser");
    expect(PLATFORM_ENDPOINTS.auth.logoutUser).toBe("/api/auth/logoutUser");
  });
});
