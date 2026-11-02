import type { QueryClient } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../../api/notificationQueries";
import type { AppNotification } from "../../types/api";
import { envelope, pagination } from "../../test/fixtures";
import { makeNavigation, renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import NotificationsScreen from "./NotificationsScreen";

jest.mock("../../api/notificationQueries");

const mockNav = makeNavigation<"Tabs">();
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => mockNav,
}));

let nextId = 1;
const note = (patch: Partial<AppNotification>): AppNotification => ({
  Id: nextId++,
  UserId: 1,
  Type: "task_assigned",
  EntityType: "task",
  EntityId: 10,
  ActorUserId: 2,
  ActorName: "Asha",
  Title: "A note",
  Body: null,
  IsRead: false,
  ReadAt: null,
  CreatedDate: new Date().toISOString(),
  ...patch,
});

const reply = (notifications: AppNotification[], unreadCount = notifications.filter((n) => !n.IsRead).length) =>
  envelope({ notifications, unreadCount, pagination: pagination(notifications.length) });

const mountInbox = async () => {
  const r = await renderWithProviders(<NotificationsScreen />);
  client = r.queryClient;
  return r;
};

// FlatList renders new rows in a batch on a timer; under load it fired between
// waitFor polls, outside act(). Fake timers park it (RNTL's waitFor/findBy
// advance them), as in BoardsScreen.test.
jest.useFakeTimers();

// A write invalidates the list; let that refetch land inside the test, not after it.
let client: QueryClient | null = null;
afterEach(async () => {
  const c = client;
  client = null;
  if (c) await waitFor(() => expect(c.isFetching() + c.isMutating()).toBe(0));
});

beforeEach(() => {
  seedAuth();
  jest.mocked(markNotificationRead).mockResolvedValue(envelope({}));
  jest.mocked(markAllNotificationsRead).mockResolvedValue(envelope({ updatedCount: 0 }));
});

it("lists notifications with their body and the unread count", async () => {
  jest.mocked(fetchNotifications).mockResolvedValue(
    reply([
      note({ Title: "Task given to you", Body: "Fix the inverter" }),
      note({ Title: "Old news", IsRead: true }),
      // A row with no Id is a broken SP row: skipped, not rendered.
      note({ Id: null as unknown as number, Title: "Ghost row" }),
    ], 1),
  );
  await mountInbox();
  expect(await screen.findByText("Task given to you")).toBeOnTheScreen();
  expect(screen.getByText("Fix the inverter")).toBeOnTheScreen();
  expect(screen.getByText("Old news")).toBeOnTheScreen();
  expect(screen.getByText("1 unread")).toBeOnTheScreen();
  expect(screen.queryByText("Ghost row")).toBeNull();
});

it("renders every notification type without falling over", async () => {
  const types = [
    "task_assigned", "task_completed", "task_reopened", "task_unblocked", "comment_added",
    "reply", "ticket_escalated", "workspace_invite", "presence_not_signed_in",
  ];
  jest.mocked(fetchNotifications).mockResolvedValue(
    reply(types.map((Type) => note({ Type, Title: Type, IsRead: true }))),
  );
  await mountInbox();
  for (const t of types) expect(await screen.findByText(t)).toBeOnTheScreen();
  // Nothing unread: no subtitle, no mark-all action.
  expect(screen.queryByText(/unread/)).toBeNull();
  expect(screen.queryByLabelText("Mark all read")).toBeNull();
});

it("shows the caught-up state when the inbox is empty", async () => {
  jest.mocked(fetchNotifications).mockResolvedValue(reply([]));
  await mountInbox();
  expect(await screen.findByText("You're all caught up")).toBeOnTheScreen();
});

it("shows an error state when the inbox cannot load", async () => {
  jest.mocked(fetchNotifications).mockRejectedValue(new Error("boom"));
  await mountInbox();
  expect(await screen.findByText("Couldn't load your inbox")).toBeOnTheScreen();
  expect(screen.getByText("Pull down to try again.")).toBeOnTheScreen();
});

// Unread rows: each tap sends the read receipt (read rows: see NOTIF-03 below).
it.each([
  ["a task", { EntityType: "task", EntityId: 10 }, ["TaskDetail", { taskId: 10, workspaceId: null }]],
  ["a TAT warning, whatever its EntityType", { Type: "tat_warn", EntityType: "ticket", EntityId: 11 }, ["TaskDetail", { taskId: 11, workspaceId: null }]],
  ["a sweep covering several tasks", { Type: "tat_breach", EntityType: "task", EntityId: 0 }, ["Tabs", { screen: "MyWork" }]],
  ["a ticket", { Type: "ticket_assigned", EntityType: "ticket", EntityId: 12 }, ["ComplaintDetail", { ticketId: 12 }]],
  ["a workspace (mixed-case EntityType)", { Type: "workspace_invite", EntityType: "Workspace", EntityId: 3 }, ["Boards"]],
] as const)("tapping %s marks it read and opens it", async (_label, patch, target) => {
  const n = note({ ...patch, Title: "Tap me" });
  jest.mocked(fetchNotifications).mockResolvedValue(reply([n]));
  await mountInbox();
  await fireEvent.press(await screen.findByText("Tap me"));
  expect(markNotificationRead).toHaveBeenCalledWith(n.Id);
  expect(mockNav.navigate).toHaveBeenCalledWith(...target);
  // The receipt refetches the inbox so the dot goes away.
  await waitFor(() => expect(fetchNotifications).toHaveBeenCalledTimes(2));
});

// parity: NOTIF-03 — a `user` notification (not signed in yet) opens My Work; the
// phone has no Today screen, so this is the nearest place to act on it.
it("tapping a presence notification opens My Work", async () => {
  jest.mocked(fetchNotifications).mockResolvedValue(
    reply([note({ Type: "presence_not_signed_in", EntityType: "user", EntityId: 4, Title: "Ravi has not signed in" })]),
  );
  await mountInbox();
  await fireEvent.press(await screen.findByText("Ravi has not signed in"));
  expect(mockNav.navigate).toHaveBeenCalledWith("Tabs", { screen: "MyWork" });
});

// parity: NOTIF-03 — a read row is not marked read again (NotificationBell.jsx:58-61).
it("tapping a read notification opens it without a read receipt", async () => {
  jest.mocked(fetchNotifications).mockResolvedValue(reply([note({ Title: "Seen it", IsRead: true })]));
  await mountInbox();
  await fireEvent.press(await screen.findByText("Seen it"));
  expect(mockNav.navigate).toHaveBeenCalledWith("TaskDetail", { taskId: 10, workspaceId: null });
  expect(markNotificationRead).not.toHaveBeenCalled();
});

it("opening a notification does not wait on, or fail with, the read receipt", async () => {
  jest.mocked(markNotificationRead).mockRejectedValue(new Error("offline"));
  jest.mocked(fetchNotifications).mockResolvedValue(reply([note({ Title: "Tap me" })]));
  await mountInbox();
  await fireEvent.press(await screen.findByText("Tap me"));
  expect(mockNav.navigate).toHaveBeenCalledWith("TaskDetail", { taskId: 10, workspaceId: null });
  expect(screen.queryByText(/Could not/)).toBeNull();
});

it("mark all read tells the server and reloads the inbox", async () => {
  jest.mocked(fetchNotifications).mockResolvedValue(reply([note({ Title: "Unread one" })]));
  await mountInbox();
  await screen.findByText("1 unread");
  await fireEvent.press(screen.getByLabelText("Mark all read"));
  await waitFor(() => expect(markAllNotificationsRead).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(fetchNotifications).toHaveBeenCalledTimes(2));
});

it("mark all read shows the server's message when it fails", async () => {
  jest.mocked(markAllNotificationsRead).mockRejectedValue(new Error("Inbox is locked"));
  jest.mocked(fetchNotifications).mockResolvedValue(reply([note({ Title: "Unread one" })]));
  await mountInbox();
  await screen.findByText("1 unread");
  await fireEvent.press(screen.getByLabelText("Mark all read"));
  expect(await screen.findByText("Inbox is locked")).toBeOnTheScreen();
  expect(fetchNotifications).toHaveBeenCalledTimes(1);
});
