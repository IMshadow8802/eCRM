import type { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";

import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../../api/notificationQueries";
import { badgeTones, colors, typography } from "../../theme";
import type { AppNotification } from "../../types/api";
import { envelope, pagination } from "../../test/fixtures";
import { makeNavigation, renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import { flat } from "../../test/style";
import { PHONE, setWindow } from "../../test/window";
import NotificationsScreen from "./NotificationsScreen";

jest.mock("../../api/notificationQueries");

const mockNav = makeNavigation<"Tabs">();
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => mockNav,
}));

// E 18's clock: Monday 2 November, 2:41 pm IST (jest pins TZ=Asia/Kolkata).
const NOW = new Date("2026-11-02T14:41:00+05:30");

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
  CreatedDate: "2026-11-02T11:20:00+05:30",
  ...patch,
});

const reply = (notifications: AppNotification[], unreadCount = notifications.filter((n) => !n.IsRead).length) =>
  envelope({ notifications, unreadCount, pagination: pagination(notifications.length) });

let client: QueryClient | null = null;
const mountInbox = async () => {
  const r = await renderWithProviders(<NotificationsScreen />);
  client = r.queryClient;
  return r;
};

jest.useFakeTimers({ now: NOW });

// A write invalidates the list; let that refetch land inside the test, not after it.
afterEach(async () => {
  const c = client;
  client = null;
  if (c) await waitFor(() => expect(c.isFetching() + c.isMutating()).toBe(0));
});

beforeEach(() => {
  jest.setSystemTime(NOW);
  setWindow(...PHONE);
  seedAuth();
  jest.mocked(markNotificationRead).mockResolvedValue(envelope({}));
  jest.mocked(markAllNotificationsRead).mockResolvedValue(envelope({ updatedCount: 0 }));
});

describe("E 18 — Today / Earlier", () => {
  it("groups by the local (IST) day, today's rows with a clock time, older ones with a date", async () => {
    jest.mocked(fetchNotifications).mockResolvedValue(
      reply([
        note({ Title: "C-1042 escalated to Neha Kapoor", Type: "ticket_escalated", CreatedDate: "2026-11-02T14:05:00+05:30" }),
        // 00:10 IST on the 2nd is still the 1st in UTC: it belongs to Today.
        note({ Title: "Just after midnight", CreatedDate: "2026-11-01T18:40:00Z" }),
        // 23:30 IST on the 1st: Earlier.
        note({ Title: "Missed deadline: Verify GST numbers", Type: "tat_breach", CreatedDate: "2026-11-01T23:30:00+05:30", IsRead: true }),
        note({ Title: "You were added to Website Revamp", Type: "workspace_added", CreatedDate: "2026-10-31T09:00:00+05:30", IsRead: true }),
        // A row with no Id is a broken SP row: skipped, not rendered.
        note({ Id: null as unknown as number, Title: "Ghost row" }),
      ]),
    );
    await mountInbox();
    const today = await screen.findByTestId("inbox-today");
    const earlier = screen.getByTestId("inbox-earlier");
    expect(screen.getByText("Today")).toBeOnTheScreen();
    expect(screen.getByText("Earlier")).toBeOnTheScreen();
    // E 18: the day groups are overlines (E `.gh-row b`), not h3 titles.
    expect(flat(screen.getByText("Today"))).toMatchObject({ textTransform: "uppercase", fontSize: 12 });
    expect(flat(screen.getByText("Earlier"))).toMatchObject({ textTransform: "uppercase", fontSize: 12 });

    expect(within(today).getByText("C-1042 escalated to Neha Kapoor")).toBeOnTheScreen();
    expect(within(today).getByText("2:05 pm")).toBeOnTheScreen();
    expect(within(today).getByText("Just after midnight")).toBeOnTheScreen();
    expect(within(today).getByText("12:10 am")).toBeOnTheScreen();

    expect(within(earlier).getByText("Missed deadline: Verify GST numbers")).toBeOnTheScreen();
    expect(within(earlier).getByText("Sun, 1 Nov")).toBeOnTheScreen();
    expect(within(earlier).getByText("Sat, 31 Oct")).toBeOnTheScreen();
    expect(screen.queryByText("Ghost row")).toBeNull();
  });

  it("with nothing from today, there is no Today header", async () => {
    jest.mocked(fetchNotifications).mockResolvedValue(
      reply([note({ Title: "Old one", CreatedDate: "2026-10-30T09:00:00+05:30", IsRead: true })]),
    );
    await mountInbox();
    expect(await screen.findByText("Old one")).toBeOnTheScreen();
    expect(screen.queryByText("Today")).toBeNull();
    expect(screen.getByText("Fri, 30 Oct")).toBeOnTheScreen();
  });

  it("unread: tinted row, semibold title, a dot; read: white, medium, ink 2, no dot", async () => {
    const unread = note({ Title: "Fresh", Body: "Fix the inverter" });
    const read = note({ Title: "Seen", IsRead: true });
    jest.mocked(fetchNotifications).mockResolvedValue(reply([unread, read]));
    await mountInbox();
    expect(await screen.findByText("Fix the inverter")).toBeOnTheScreen();

    expect(flat(screen.getByTestId(`notification-${unread.Id}`)).backgroundColor).toBe(colors.unreadTint);
    expect(flat(screen.getByText("Fresh"))).toMatchObject({ fontFamily: typography.rowTitle.fontFamily, color: colors.text });
    const dot = within(screen.getByTestId(`notification-${unread.Id}`)).getByTestId("unread-dot");
    // E 18: the dot ends line 2 (the body), not the row.
    const line2 = screen.getByText("Fix the inverter").parent!;
    expect(line2.children[line2.children.length - 1]).toBe(dot);

    expect(flat(screen.getByTestId(`notification-${read.Id}`)).backgroundColor).toBe(colors.surface);
    expect(flat(screen.getByText("Seen"))).toMatchObject({
      fontFamily: typography.rowTitleRead.fontFamily,
      color: colors.textSecondary,
    });
    expect(within(screen.getByTestId(`notification-${read.Id}`)).queryByTestId("unread-dot")).toBeNull();
  });

  it.each([
    ["ticket_escalated", "lilac"],
    ["tat_warning", "butter"],
    ["tat_breach", "red"],
    ["task_assigned", "indigo"],
    ["comment_added", "teal"],
    ["reply", "teal"],
    ["workspace_added", "indigo"],
    ["presence_not_signed_in", "slate"],
  ] as const)("%s leads with a %s badge (G26)", async (Type, tone) => {
    const n = note({ Type, Title: Type });
    jest.mocked(fetchNotifications).mockResolvedValue(reply([n]));
    await mountInbox();
    expect(await screen.findByText(Type)).toBeOnTheScreen();
    expect(flat(screen.getByTestId(`badge-${n.Id}`)).backgroundColor).toBe(badgeTones[tone].fill);
  });
});

describe("the band", () => {
  it("shows the unread count and Mark all read only while something is unread", async () => {
    jest.mocked(fetchNotifications).mockResolvedValue(reply([note({ Title: "Unread one" })], 63));
    await mountInbox();
    expect(await screen.findByText("63 unread")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Mark all read" })).toBeOnTheScreen();
  });

  it("at 0 unread: no count, no Mark all read", async () => {
    jest.mocked(fetchNotifications).mockResolvedValue(reply([note({ Title: "Old news", IsRead: true })]));
    await mountInbox();
    expect(await screen.findByText("Old news")).toBeOnTheScreen();
    expect(screen.queryByText(/unread/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Mark all read" })).toBeNull();
  });

  it("mark all read tells the server and reloads the inbox", async () => {
    jest.mocked(fetchNotifications).mockResolvedValue(reply([note({ Title: "Unread one" })]));
    await mountInbox();
    await screen.findByText("1 unread");
    await fireEvent.press(screen.getByRole("button", { name: "Mark all read" }));
    await waitFor(() => expect(markAllNotificationsRead).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(fetchNotifications).toHaveBeenCalledTimes(2));
  });

  it("mark all read shows the server's message when it fails", async () => {
    jest.mocked(markAllNotificationsRead).mockRejectedValue(new Error("Inbox is locked"));
    jest.mocked(fetchNotifications).mockResolvedValue(reply([note({ Title: "Unread one" })]));
    await mountInbox();
    await screen.findByText("1 unread");
    await fireEvent.press(screen.getByRole("button", { name: "Mark all read" }));
    expect(await screen.findByText("Inbox is locked")).toBeOnTheScreen();
    expect(fetchNotifications).toHaveBeenCalledTimes(1);
  });

  it("a double tap on Mark all read sends one request: the button is disabled while it runs", async () => {
    let done: (v: Awaited<ReturnType<typeof markAllNotificationsRead>>) => void = () => {};
    jest.mocked(markAllNotificationsRead).mockReturnValue(new Promise((r) => (done = r)));
    jest.mocked(fetchNotifications).mockResolvedValue(reply([note({ Title: "Unread one" })]));
    await mountInbox();
    await screen.findByText("1 unread");
    await fireEvent.press(screen.getByRole("button", { name: "Mark all read" }));
    expect(screen.getByRole("button", { name: "Mark all read" })).toBeDisabled();
    await fireEvent.press(screen.getByRole("button", { name: "Mark all read" }));
    expect(markAllNotificationsRead).toHaveBeenCalledTimes(1);
    await act(async () => done(envelope({ updatedCount: 1 })));
    await waitFor(() => expect(fetchNotifications).toHaveBeenCalledTimes(2));
  });

  // Task 32: the Inbox is pushed from Home's bell or More.
  it("its back button goes back", async () => {
    jest.mocked(fetchNotifications).mockResolvedValue(reply([]));
    await mountInbox();
    await fireEvent.press(await screen.findByRole("button", { name: "Go back" }));
    expect(mockNav.goBack).toHaveBeenCalled();
  });
});

describe("states", () => {
  it("empty: the caught-up state", async () => {
    jest.mocked(fetchNotifications).mockResolvedValue(reply([]));
    await mountInbox();
    expect(await screen.findByText("You're all caught up")).toBeOnTheScreen();
  });

  it("a failed load shows the error card, and Try again refetches", async () => {
    jest.mocked(fetchNotifications).mockRejectedValueOnce(new Error("boom"));
    await mountInbox();
    expect(await screen.findByText("Could not load. Try again")).toBeOnTheScreen();
    jest.mocked(fetchNotifications).mockResolvedValue(reply([note({ Title: "Back again" })]));
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Back again")).toBeOnTheScreen();
  });

  it("a failed refresh keeps the list on screen and says so in a toast", async () => {
    jest.mocked(fetchNotifications).mockResolvedValueOnce(reply([note({ Title: "Still here" })]));
    const { queryClient } = await mountInbox();
    expect(await screen.findByText("Still here")).toBeOnTheScreen();
    jest.mocked(fetchNotifications).mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ["notifications"] });
    });
    expect(await screen.findByText("Could not refresh your inbox.")).toBeOnTheScreen();
    expect(screen.getByText("Still here")).toBeOnTheScreen();
    expect(screen.queryByText("Could not load. Try again")).toBeNull();
  });
});

describe("tap → read + open", () => {
  // Unread rows: each tap sends the read receipt (read rows: see NOTIF-03 below).
  it.each([
    ["a task", { EntityType: "task", EntityId: 10 }, ["TaskDetail", { taskId: 10, workspaceId: null }]],
    ["a TAT warning, whatever its EntityType", { Type: "tat_warn", EntityType: "ticket", EntityId: 11 }, ["TaskDetail", { taskId: 11, workspaceId: null }]],
    ["a sweep covering several tasks", { Type: "tat_breach", EntityType: "task", EntityId: 0 }, ["Tabs", { screen: "Tasks" }]],
    ["a ticket", { Type: "ticket_assigned", EntityType: "ticket", EntityId: 12 }, ["ComplaintDetail", { ticketId: 12 }]],
    ["a workspace (mixed-case EntityType)", { Type: "workspace_invite", EntityType: "Workspace", EntityId: 3 }, ["Boards"]],
    ["a presence notice (NOTIF-03: Home, the tab every role has)", { Type: "presence_not_signed_in", EntityType: "user", EntityId: 4 }, ["Tabs", { screen: "Home" }]],
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

  // parity: NOTIF-02 — a null EntityType must not crash the tap.
  it("a notification with no EntityType is marked read and goes nowhere", async () => {
    const n = note({ Type: "custom", EntityType: null as unknown as string, Title: "Odd one" });
    jest.mocked(fetchNotifications).mockResolvedValue(reply([n]));
    await mountInbox();
    await fireEvent.press(await screen.findByText("Odd one"));
    expect(markNotificationRead).toHaveBeenCalledWith(n.Id);
    expect(mockNav.navigate).not.toHaveBeenCalled();
  });

  // parity: NOTIF-03 — a read row is not marked read again.
  it("a read notification opens without a read receipt", async () => {
    jest.mocked(fetchNotifications).mockResolvedValue(reply([note({ Title: "Seen it", IsRead: true })]));
    await mountInbox();
    await fireEvent.press(await screen.findByText("Seen it"));
    expect(mockNav.navigate).toHaveBeenCalledWith("TaskDetail", { taskId: 10, workspaceId: null });
    expect(markNotificationRead).not.toHaveBeenCalled();
  });

  it("opening does not wait on, or fail with, the read receipt", async () => {
    jest.mocked(markNotificationRead).mockRejectedValue(new Error("offline"));
    jest.mocked(fetchNotifications).mockResolvedValue(reply([note({ Title: "Tap me" })]));
    await mountInbox();
    await fireEvent.press(await screen.findByText("Tap me"));
    expect(mockNav.navigate).toHaveBeenCalledWith("TaskDetail", { taskId: 10, workspaceId: null });
    expect(screen.queryByText(/Could not/)).toBeNull();
  });
});
