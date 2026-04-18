import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import NotificationBell from "./NotificationBell";
import useAuthStore from "../../stores/useAuthStore";
import useNotificationStore from "../../stores/useNotificationStore";
import { notificationFixture } from "../../test/mocks/handlers";
import renderWithProviders from "../../test/renderWithProviders";

const renderBell = (props = {}) =>
  renderWithProviders(<NotificationBell {...props} />, { router: false });

describe("NotificationBell", () => {
  beforeEach(() => {
    notificationFixture.reset();
    useNotificationStore.setState({ unreadCount: 0, lastFetchAt: null });
    useAuthStore.setState({
      isAuthenticated: true,
      token: null,
      user: { UserId: 1 },
      API_BASE_URL: "https://prdinfotech.in/CRM",
    });
  });

  it("renders bell with zero badge when no notifications", async () => {
    renderBell();
    const bell = await screen.findByTestId("notification-bell");
    expect(bell).toBeInTheDocument();
  });

  it("shows unread count badge", async () => {
    notificationFixture.seed({
      UserId: 1,
      Type: "task_assigned",
      Title: "New task",
      Body: "Alice assigned you X",
      EntityType: "task",
      EntityId: 500,
    });
    renderBell();
    await waitFor(() => {
      expect(useNotificationStore.getState().unreadCount).toBe(1);
    });
  });

  it("opens dropdown and lists notifications", async () => {
    notificationFixture.seed({
      UserId: 1,
      Type: "comment_added",
      Title: "New comment",
      Body: "Bob commented",
      EntityType: "comment",
      EntityId: 900,
    });
    renderBell();
    await waitFor(() => {
      expect(useNotificationStore.getState().unreadCount).toBe(1);
    });
    const user = userEvent.setup();
    await user.click(screen.getByTestId("notification-bell"));
    expect(await screen.findByText("New comment")).toBeInTheDocument();
  });

  it("mark all read clears unreadCount", async () => {
    notificationFixture.seed({
      UserId: 1,
      Type: "task_assigned",
      Title: "T",
      EntityType: "task",
      EntityId: 1,
    });
    renderBell();
    await waitFor(() => {
      expect(useNotificationStore.getState().unreadCount).toBe(1);
    });
    const user = userEvent.setup();
    await user.click(screen.getByTestId("notification-bell"));
    const btn = await screen.findByTestId("mark-all-read");
    await user.click(btn);
    await waitFor(() => {
      expect(useNotificationStore.getState().unreadCount).toBe(0);
    });
  });

  it("clicking a notification fires onOpenEntity", async () => {
    notificationFixture.seed({
      UserId: 1,
      Type: "task_assigned",
      Title: "Open me",
      EntityType: "task",
      EntityId: 42,
    });
    const onOpen = vi.fn();
    renderBell({ onOpenEntity: onOpen });
    await waitFor(() => {
      expect(useNotificationStore.getState().unreadCount).toBe(1);
    });
    const user = userEvent.setup();
    await user.click(screen.getByTestId("notification-bell"));
    const item = await screen.findByText("Open me");
    await user.click(item);
    await waitFor(() => {
      expect(onOpen).toHaveBeenCalledWith(
        expect.objectContaining({ EntityType: "task", EntityId: 42 }),
      );
    });
  });

  it("shows empty state when no notifications", async () => {
    renderBell();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("notification-bell"));
    expect(await screen.findByText(/All caught up/i)).toBeInTheDocument();
  });
});
