import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { fetchFollowUps } from "../../api/followupQueries";
import { fetchLeads } from "../../api/leadQueries";
import { fetchNotifications } from "../../api/notificationQueries";
import { fetchTasks } from "../../api/taskQueries";
import { fetchTickets } from "../../api/ticketQueries";
import { fetchMyDay } from "../../api/todayQueries";
import type { DayTask, ModuleKey } from "../../types/api";
import { envelope, makeTask, pagination } from "../../test/fixtures";
import { makeNavigation, renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import { followUpViewParams, leadQueueParams } from "../sales/leadHelpers";
import { complaintQueueParams } from "../support/ticketHelpers";
import HomeScreen from "./HomeScreen";

jest.mock("../../api/followupQueries");
jest.mock("../../api/leadQueries");
jest.mock("../../api/notificationQueries");
jest.mock("../../api/taskQueries");
jest.mock("../../api/ticketQueries");
jest.mock("../../api/todayQueries");

const mockNav = makeNavigation<"Tabs">();
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => mockNav,
}));

// The bell re-reads every minute; fake timers keep that inside the test.
jest.useFakeTimers();

const ME = 7;
const VIEW = { view: true, add: false, edit: false, delete: false, reach: "Own" as const };
const signInWith = (...modules: ModuleKey[]) =>
  seedAuth({ UserId: ME, access: { modules: Object.fromEntries(modules.map((m) => [m, VIEW])) } });

const overdueTask = { TaskId: 1, flags: { overdue: true } } as DayTask;
const unread = (n: number) => envelope({ notifications: [], unreadCount: n, pagination: pagination(n) });

beforeEach(() => {
  jest.mocked(fetchTasks).mockResolvedValue(
    envelope({ tasks: [makeTask({ Id: 1 }), makeTask({ Id: 2 }), makeTask({ Id: 3 })], pagination: pagination(3) }),
  );
  jest.mocked(fetchMyDay).mockResolvedValue(
    envelope({ day: { key: "2026-11-02", live: true }, me: { UserId: ME, FullName: "Asha", tasks: [overdueTask] } }),
  );
  jest.mocked(fetchTickets).mockImplementation(async (p = {}) =>
    envelope({ tickets: [], pagination: pagination(p.Overdue ? 2 : 5) }),
  );
  jest.mocked(fetchLeads).mockResolvedValue(envelope({ leads: [], pagination: pagination(12) }));
  jest.mocked(fetchFollowUps).mockResolvedValue(envelope({ followups: [], pagination: pagination(4) }));
  jest.mocked(fetchNotifications).mockResolvedValue(unread(0));
});

it("shows today's numbers for every module the role has", async () => {
  signInWith("tasks", "complaints", "leads");
  await renderWithProviders(<HomeScreen />);
  expect(await screen.findByText("3 tasks assigned to you")).toBeOnTheScreen();
  expect(await screen.findByText("1 task past or near a deadline")).toBeOnTheScreen();
  expect(await screen.findByText("5 open")).toBeOnTheScreen();
  expect(await screen.findByText("2 overdue")).toBeOnTheScreen();
  expect(await screen.findByText("12 yours")).toBeOnTheScreen();
  expect(await screen.findByText("4 due today")).toBeOnTheScreen();
});

it("each number is asked for with its list's own filter, one row at a time", async () => {
  signInWith("tasks", "complaints", "leads");
  await renderWithProviders(<HomeScreen />);
  await screen.findByText("4 due today");
  // My Work's own "Mine" query — the same cache entry.
  expect(fetchTasks).toHaveBeenCalledWith({ WorkspaceId: null, AssigneeUserId: ME, OnlyOpen: true, PageSize: 200 });
  expect(fetchMyDay).toHaveBeenCalled();
  expect(fetchTickets).toHaveBeenCalledWith({ ...complaintQueueParams("mine", "active", ME, ""), PageSize: 1 });
  expect(fetchTickets).toHaveBeenCalledWith({ ...complaintQueueParams("overdue", "active", ME, ""), PageSize: 1 });
  expect(fetchLeads).toHaveBeenCalledWith({ ...leadQueueParams("mine", "all", ME, ""), PageSize: 1 });
  expect(fetchFollowUps).toHaveBeenCalledWith({ ...followUpViewParams("today"), PageSize: 1 });
});

it("each row opens its list on the matching filter", async () => {
  signInWith("tasks", "complaints", "leads");
  await renderWithProviders(<HomeScreen />);
  await screen.findByText("4 due today");
  for (const [row, ...target] of [
    ["My tasks", "Tabs", { screen: "Tasks" }],
    ["Needs you", "Tabs", { screen: "Tasks" }],
    ["My complaints", "Complaints", { queue: "mine" }],
    ["Overdue complaints", "Complaints", { queue: "overdue" }],
    ["My leads", "Leads", { queue: "mine" }],
    ["Follow-ups due today", "FollowUps", { view: "today" }],
  ] as const) {
    await fireEvent.press(screen.getByText(row));
    expect(mockNav.navigate).toHaveBeenLastCalledWith(...target);
  }
});

describe("a module the role cannot view is neither shown nor asked for", () => {
  it("complaints-only", async () => {
    signInWith("complaints");
    await renderWithProviders(<HomeScreen />);
    expect(await screen.findByText("5 open")).toBeOnTheScreen();
    expect(screen.queryByText("My tasks")).toBeNull();
    expect(screen.queryByText("My leads")).toBeNull();
    expect(fetchTasks).not.toHaveBeenCalled();
    expect(fetchMyDay).not.toHaveBeenCalled();
    expect(fetchLeads).not.toHaveBeenCalled();
    expect(fetchFollowUps).not.toHaveBeenCalled();
  });

  it("leads-only", async () => {
    signInWith("leads");
    await renderWithProviders(<HomeScreen />);
    expect(await screen.findByText("12 yours")).toBeOnTheScreen();
    expect(screen.queryByText("My complaints")).toBeNull();
    expect(fetchTickets).not.toHaveBeenCalled();
    expect(fetchTasks).not.toHaveBeenCalled();
  });

  it("tasks-only", async () => {
    signInWith("tasks");
    await renderWithProviders(<HomeScreen />);
    expect(await screen.findByText("3 tasks assigned to you")).toBeOnTheScreen();
    expect(screen.queryByText("My complaints")).toBeNull();
    expect(fetchTickets).not.toHaveBeenCalled();
    expect(fetchLeads).not.toHaveBeenCalled();
    expect(fetchFollowUps).not.toHaveBeenCalled();
  });

  it("no modules: the empty state, and no module requests at all", async () => {
    signInWith();
    await renderWithProviders(<HomeScreen />);
    expect(await screen.findByText("Nothing here yet")).toBeOnTheScreen();
    for (const fn of [fetchTasks, fetchMyDay, fetchTickets, fetchLeads, fetchFollowUps]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
});

it("an admin sees every module", async () => {
  seedAuth({ UserId: ME, access: { isAdmin: true } });
  await renderWithProviders(<HomeScreen />);
  expect(await screen.findByText("3 tasks assigned to you")).toBeOnTheScreen();
  expect(await screen.findByText("5 open")).toBeOnTheScreen();
  expect(await screen.findByText("12 yours")).toBeOnTheScreen();
});

it("while counts load, every row stays neutral", async () => {
  signInWith("tasks", "complaints", "leads");
  const never = () => new Promise<never>(() => {});
  jest.mocked(fetchTasks).mockImplementation(never);
  jest.mocked(fetchMyDay).mockImplementation(never);
  jest.mocked(fetchTickets).mockImplementation(never);
  jest.mocked(fetchLeads).mockImplementation(never);
  jest.mocked(fetchFollowUps).mockImplementation(never);
  await renderWithProviders(<HomeScreen />);
  for (const text of [
    "Tasks assigned to you", "Deadlines and reasons owed", "Complaints assigned to you",
    "Past their due time", "Leads you own", "Calls and visits to make",
  ]) {
    expect(await screen.findByText(text)).toBeOnTheScreen();
  }
  expect(screen.queryByText(/^Nothing/)).toBeNull();
});

it("a failed count stays neutral rather than claiming nothing", async () => {
  signInWith("leads");
  jest.mocked(fetchFollowUps).mockRejectedValue(new Error("boom"));
  await renderWithProviders(<HomeScreen />);
  expect(await screen.findByText("12 yours")).toBeOnTheScreen();
  await waitFor(() => expect(fetchFollowUps).toHaveBeenCalled());
  expect(screen.getByText("Calls and visits to make")).toBeOnTheScreen();
  expect(screen.queryByText("Nothing due today")).toBeNull();
});

it("only a settled zero says there is nothing", async () => {
  signInWith("tasks", "complaints", "leads");
  jest.mocked(fetchTasks).mockResolvedValue(envelope({ tasks: [], pagination: pagination(0) }));
  jest.mocked(fetchMyDay).mockResolvedValue(envelope({ day: { key: "2026-11-02", live: false }, me: null }));
  jest.mocked(fetchTickets).mockResolvedValue(envelope({ tickets: [], pagination: pagination(0) }));
  jest.mocked(fetchLeads).mockResolvedValue(envelope({ leads: [], pagination: pagination(0) }));
  jest.mocked(fetchFollowUps).mockResolvedValue(envelope({ followups: [], pagination: pagination(0) }));
  await renderWithProviders(<HomeScreen />);
  for (const text of [
    "Nothing assigned to you", "Nothing needs you", "Nothing open on you",
    "Nothing overdue", "No leads yet", "Nothing due today",
  ]) {
    expect(await screen.findByText(text)).toBeOnTheScreen();
  }
});

it("one task reads singular", async () => {
  signInWith("tasks");
  jest.mocked(fetchTasks).mockResolvedValue(envelope({ tasks: [makeTask()], pagination: pagination(1) }));
  await renderWithProviders(<HomeScreen />);
  expect(await screen.findByText("1 task assigned to you")).toBeOnTheScreen();
});

describe("the Inbox bell", () => {
  // parity: NOTIF-01 — the bell shows the unread count and keeps it fresh every 60 s.
  it("shows the unread count, re-reads it each minute, and opens the Inbox", async () => {
    jest.mocked(fetchNotifications).mockResolvedValueOnce(unread(4)).mockResolvedValue(unread(120));
    signInWith();
    await renderWithProviders(<HomeScreen />);
    const bell = () => screen.getByRole("button", { name: "Inbox" });
    await waitFor(() => expect(bell()).toHaveTextContent("4"));
    expect(bell().props.accessibilityValue).toEqual({ text: "4 unread" });
    expect(fetchNotifications).toHaveBeenCalledWith({ PageSize: 1 });
    await act(async () => { jest.advanceTimersByTime(60_000); });
    await waitFor(() => expect(bell()).toHaveTextContent("99+"));
    await fireEvent.press(bell());
    expect(mockNav.navigate).toHaveBeenLastCalledWith("Inbox");
  });

  it("no unread, no badge", async () => {
    signInWith();
    await renderWithProviders(<HomeScreen />);
    await waitFor(() => expect(fetchNotifications).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Inbox" })).not.toHaveTextContent(/\d/);
  });
});
