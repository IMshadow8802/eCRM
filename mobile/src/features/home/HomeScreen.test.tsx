import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";

import { fetchLookups } from "../../api/configQueries";
import { fetchFollowUps } from "../../api/followupQueries";
import { fetchLeads } from "../../api/leadQueries";
import { fetchNotifications } from "../../api/notificationQueries";
import { fetchTasks } from "../../api/taskQueries";
import { fetchTickets, type FetchTicketsParams } from "../../api/ticketQueries";
import { fetchMyDay } from "../../api/todayQueries";
import { overdueFollowUpsCountQuery, overdueTicketsCountQuery } from "../../navigation/badges";
import { colors } from "../../theme";
import type { AppNotification, DayTask, Lookup, ModuleKey } from "../../types/api";
import { envelope, followUp, lead, makeTask, pagination, ticket } from "../../test/fixtures";
import { makeNavigation, renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import { flat } from "../../test/style";
import { PHONE, setWindow, TABLET } from "../../test/window";
import { followUpViewParams, leadQueueParams } from "../sales/leadHelpers";
import { complaintQueueParams } from "../support/ticketHelpers";
import HomeScreen, { resolvedWindow } from "./HomeScreen";

jest.mock("../../api/configQueries");
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

const mockCreate = { open: jest.fn(), label: "New" };
jest.mock("../../navigation/Shell", () => ({
  ...jest.requireActual("../../navigation/Shell"),
  useCreate: () => mockCreate,
}));

// The bell re-reads every minute; fake timers keep that inside the test.
jest.useFakeTimers();
// Mon 2 Nov 2026, 2:41 pm IST — E's clock.
const NOW = new Date("2026-11-02T14:41:00+05:30");

const ME = 7;
const VIEW = { view: true, add: false, edit: false, delete: false, reach: "Own" as const };
const signInWith = (...modules: ModuleKey[]) =>
  seedAuth({ UserId: ME, user: { FullName: "Ayush Mishra" }, access: { modules: Object.fromEntries(modules.map((m) => [m, VIEW])) } });

const NO_FLAGS = {
  given: false, done: false, doneLate: false, open: true, working: false, notStarted: false, dueToday: false,
  overdue: false, atRisk: false, onHold: false, reasonOwed: false, toRule: false,
};
const day = ({ flags, ...patch }: Omit<Partial<DayTask>, "flags"> & { flags: Partial<DayTask["flags"]> }) =>
  ({
    TaskId: 1, TatId: 5, Title: "Verify GST numbers", WorkspaceId: 3, WorkspaceName: "Sales Ops", StepsTotal: 5, StepsDone: 2,
    ...patch, flags: { ...NO_FLAGS, ...flags },
  }) as DayTask;
const reasonOwed = day({ flags: { overdue: true, reasonOwed: true } });
const unread = (n: number, notifications: Partial<AppNotification>[] = []) =>
  envelope({ notifications: notifications as AppNotification[], unreadCount: n, pagination: pagination(n) });
const isResolved = (p: FetchTicketsParams = {}) => p.ResolvedFrom != null;

beforeEach(() => {
  jest.setSystemTime(NOW);
  setWindow(...PHONE);
  mockCreate.label = "New";
  jest.mocked(fetchTasks).mockResolvedValue(
    envelope({ tasks: [makeTask({ Id: 1 }), makeTask({ Id: 2 }), makeTask({ Id: 3 })], pagination: pagination(3) }),
  );
  jest.mocked(fetchMyDay).mockResolvedValue(
    envelope({
      day: { key: "2026-11-02", live: true },
      me: { UserId: ME, FullName: "Ayush Mishra", ShiftEnd: "2026-11-02T18:30:00+05:30", tasks: [reasonOwed] },
    }),
  );
  jest.mocked(fetchTickets).mockImplementation(async (p = {}) => {
    if (isResolved(p)) return envelope({ tickets: [], pagination: pagination(11) });
    if (p.Overdue) return envelope({ tickets: [], pagination: pagination(2) });
    return envelope({
      tickets: [
        ticket({ Id: 1042, TicketNo: "C-1042", Subject: "AC not cooling after service", CustomerName: "Sharma Electronics", IsOverdue: true, EscalatedTo: 9, DueAt: "2026-11-02 12:41:00" }),
        ticket({ Id: 1043, Subject: "Fan noise", IsOverdue: false, EscalatedTo: null }),
        ticket({ Id: 1044, Subject: "Remote missing", IsOverdue: false, EscalatedTo: null }),
      ],
      pagination: pagination(7),
    });
  });
  jest.mocked(fetchLeads).mockImplementation(async (p = {}) => {
    if (p.PageSize === 1) return envelope({ leads: [], pagination: pagination(p.Overdue ? 3 : p.StatusCode ? 2 : 5) });
    return envelope({
      leads: [
        lead({ Id: 1, StatusCode: "open", EstValue: 1_000_000 }),
        lead({ Id: 2, StatusCode: "qualified", EstValue: 430_000 }),
        lead({ Id: 3, StatusCode: "lost", EstValue: 999_999 }),
      ],
      pagination: pagination(12),
    });
  });
  jest.mocked(fetchFollowUps).mockImplementation(async (p = {}) =>
    p.Overdue
      ? envelope({ followups: [followUp({ Id: 90, LeadId: 4, LeadName: "Harpreet Singh", LeadCompany: "Bhatia Auto", DueAt: "2026-11-01 17:41:00", IsOverdue: true })], pagination: pagination(6) })
      : envelope({ followups: [followUp({ Id: 91, LeadId: 5, LeadName: "Anil Khanna", LeadCompany: "Khanna Packaging", DueAt: "2026-11-02 15:00:00" })], pagination: pagination(4) }),
  );
  jest.mocked(fetchLookups).mockResolvedValue([
    { Id: 31, Code: "open", Value: "New" },
    { Id: 32, Code: "open", Value: "Contacted" },
  ] as Lookup[]);
  jest.mocked(fetchNotifications).mockResolvedValue(
    unread(63, [{ Id: 1, Type: "ticket_escalated", IsRead: false }, { Id: 2, Type: "ticket_escalated", IsRead: true }]),
  );
});

interface Node { props: Record<string, unknown>; parent: Node | null }
/** The nearest ancestor (or self) that matches. */
const ancestor = (from: unknown, match: (n: Node) => boolean) => {
  let at = from as Node | null;
  while (at && !match(at)) at = at.parent;
  return at;
};
/** The ScrollView that carries the pull-to-refresh. */
const scroller = () =>
  ancestor(screen.getByTestId("home-list"), (n) => !!n.props.refreshControl)!.props.refreshControl as {
    props: { onRefresh: () => void; refreshing: boolean };
  };

describe("04 · complaints, tasks and leads", () => {
  it("band → shift row + New → hero → tiles → Needs you, in E's order and copy", async () => {
    signInWith("tasks", "complaints", "leads");
    await renderWithProviders(<HomeScreen />);
    expect(await screen.findByText("Good afternoon, Ayush")).toBeOnTheScreen();
    expect(screen.getByText("Monday, 2 November")).toBeOnTheScreen();
    expect(await screen.findByText("On shift until 6:30 pm")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "New new" })).toBeOnTheScreen();
    expect(await screen.findByText("This week · 2 past their TAT")).toBeOnTheScreen();
    const order = ["Good afternoon, Ayush", "On shift until 6:30 pm", "My complaints", "Tasks", "Follow-ups", "Leads", "Inbox", "Needs you"];
    const all = screen.getAllByText(/./).map((n) => n.props.children);
    const at = order.map((t) => all.indexOf(t));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("hero stats Open · Overdue · Escalated · Resolved; Overdue is the warm figure", async () => {
    signInWith("tasks", "complaints", "leads");
    await renderWithProviders(<HomeScreen />);
    expect(await screen.findByRole("button", { name: "Open 7" })).toBeOnTheScreen();
    expect(await screen.findByRole("button", { name: "Overdue 2" })).toBeOnTheScreen();
    expect(flat(within(screen.getByRole("button", { name: "Overdue 2" })).getByText("2")).color).toBe(colors.onBrandWarn);
    // G12: one of my active complaints carries EscalatedTo. G11: the 118 count.
    expect(await screen.findByText("Escalated")).toBeOnTheScreen();
    await waitFor(() => expect(screen.getByText("11")).toBeOnTheScreen());
    expect(screen.queryByRole("button", { name: /^Escalated/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Resolved/ })).toBeNull();
  });

  it("asks each number with its list's own filter; the overdue counts share the bar badge's entries", async () => {
    signInWith("tasks", "complaints", "leads");
    await renderWithProviders(<HomeScreen />);
    await screen.findByText("Needs you");
    expect(fetchTasks).toHaveBeenCalledWith({ WorkspaceId: null, AssigneeUserId: ME, OnlyOpen: true, PageSize: 200 });
    expect(fetchTickets).toHaveBeenCalledWith({ ...complaintQueueParams("mine", "active", ME, ""), PageSize: 200 });
    expect(fetchTickets).toHaveBeenCalledWith({ ...complaintQueueParams("overdue", "active", ME, ""), PageSize: 1 });
    expect(fetchTickets).toHaveBeenCalledWith({ AssignedTo: ME, ...resolvedWindow(NOW), PageSize: 1 });
    expect(fetchLeads).toHaveBeenCalledWith({ ...leadQueueParams("mine", "all", ME, ""), PageSize: 200 });
    expect(fetchFollowUps).toHaveBeenCalledWith({ ...followUpViewParams("today"), PageSize: 3 });
    expect(fetchFollowUps).toHaveBeenCalledWith({ ...followUpViewParams("overdue"), PageSize: 1 });
    expect(overdueTicketsCountQuery(ME).queryKey).toEqual(["tickets", "count", complaintQueueParams("overdue", "active", ME, "")]);
    expect(overdueFollowUpsCountQuery().queryKey).toEqual(["followups", "count", followUpViewParams("overdue")]);
  });

  it("G11: Resolved is a rolling 7 days — six days back through tonight", () => {
    expect(resolvedWindow(NOW)).toEqual({ ResolvedFrom: "2026-10-27", ResolvedTo: "2026-11-03" });
  });

  it("G11: before SQL 118 the Resolved count fails — it reads '—', the rest of Home stands", async () => {
    jest.mocked(fetchTickets).mockImplementation(async (p = {}) => {
      if (isResolved(p)) throw new Error("Procedure has no parameter named @ResolvedFrom");
      return envelope({ tickets: [], pagination: pagination(p.Overdue ? 2 : 7) });
    });
    signInWith("complaints");
    await renderWithProviders(<HomeScreen />);
    expect(await screen.findByRole("button", { name: "Open 7" })).toBeOnTheScreen();
    await waitFor(() => expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1));
    expect(screen.queryByText("11")).toBeNull();
  });

  it("G12: past one 200-row page the escalated count is '—', never a guess", async () => {
    jest.mocked(fetchTickets).mockImplementation(async (p = {}) =>
      envelope({ tickets: [ticket({ EscalatedTo: 9 })], pagination: pagination(isResolved(p) ? 12 : p.Overdue ? 2 : 201) }),
    );
    signInWith("complaints");
    await renderWithProviders(<HomeScreen />);
    expect(await screen.findByRole("button", { name: "Open 201" })).toBeOnTheScreen();
    expect(screen.getByText("—")).toBeOnTheScreen();
  });

  it("tiles: Tasks · Follow-ups · Leads · Inbox, with E's subtitles (G3, G27)", async () => {
    signInWith("tasks", "complaints", "leads");
    await renderWithProviders(<HomeScreen />);
    expect(await screen.findByRole("button", { name: "Tasks, 3 assigned to you" })).toBeOnTheScreen();
    expect(await screen.findByText("1 needs you")).toBeOnTheScreen();
    expect(await screen.findByText("Next at 3:00 pm")).toBeOnTheScreen();
    expect(await screen.findByRole("button", { name: "Follow-ups, 4 due today" })).toBeOnTheScreen();
    // open 10,00,000 + qualified 4,30,000; the lost lead is not in play.
    expect(await screen.findByText("₹14,30,000 in play")).toBeOnTheScreen();
    expect(await screen.findByRole("button", { name: "Leads, 12 yours" })).toBeOnTheScreen();
    expect(await screen.findByText("1 escalation")).toBeOnTheScreen();
    expect(await screen.findByRole("button", { name: "Inbox, 63 unread" })).toBeOnTheScreen();
  });

  it("G3: past one 200-row page the value is hidden", async () => {
    jest.mocked(fetchLeads).mockResolvedValue(envelope({ leads: [lead({ StatusCode: "open", EstValue: 5 })], pagination: pagination(201) }));
    signInWith("tasks", "complaints", "leads");
    await renderWithProviders(<HomeScreen />);
    expect(await screen.findByRole("button", { name: "Leads, 201 yours" })).toBeOnTheScreen();
    expect(screen.queryByText(/in play/)).toBeNull();
  });

  it("every tappable figure opens exactly the list it counted", async () => {
    signInWith("tasks", "complaints", "leads");
    await renderWithProviders(<HomeScreen />);
    await screen.findByRole("button", { name: "Inbox, 63 unread" });
    for (const [name, ...target] of [
      ["Open 7", "Complaints", { queue: "mine" }],
      ["Overdue 2", "Complaints", { queue: "overdue" }],
      ["Open My complaints", "Complaints", { queue: "mine" }],
      ["Tasks, 3 assigned to you", "Tabs", { screen: "Tasks", params: { filter: "mine" } }],
      ["Follow-ups, 4 due today", "FollowUps", { view: "today" }],
      ["Leads, 12 yours", "Leads", { queue: "mine" }],
      ["Inbox, 63 unread", "Inbox"],
      ["Search", "Search"],
    ] as const) {
      await fireEvent.press(screen.getByRole(name === "Open My complaints" ? "link" : "button", { name }));
      expect(mockNav.navigate).toHaveBeenLastCalledWith(...target);
    }
  });

  it("the bell carries the unread count, capped at 99+", async () => {
    jest.mocked(fetchNotifications).mockResolvedValue(unread(150));
    signInWith("complaints");
    await renderWithProviders(<HomeScreen />);
    expect(await screen.findByText("99+")).toBeOnTheScreen();
  });

  it("Needs you: my overdue complaints, then tasks owed, then overdue calls — at most 3; See all opens Mine", async () => {
    signInWith("tasks", "complaints", "leads");
    await renderWithProviders(<HomeScreen />);
    const group = await screen.findByTestId("needs-you");
    await within(group).findByText("Harpreet Singh");
    const titles = within(group).getAllByText(/AC not cooling|Verify GST|Harpreet/).map((n) => n.props.children);
    expect(titles).toEqual(["AC not cooling after service", "Verify GST numbers", "Harpreet Singh"]);
    expect(within(group).getByText("Overdue 2 h")).toBeOnTheScreen();
    expect(within(group).getByText("Explain")).toBeOnTheScreen();
    expect(within(group).getByText("Missed")).toBeOnTheScreen();
    expect(within(group).getByText("Overdue 21 h")).toBeOnTheScreen();
    expect(within(group).getByTestId("escalated-dot")).toBeOnTheScreen();
    // 1 complaint + 1 task + 6 overdue follow-ups (the rows stop at 3).
    expect(screen.getByText("8")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("link", { name: "See all" }));
    expect(mockNav.navigate).toHaveBeenLastCalledWith("Tabs", { screen: "Tasks", params: { filter: "mine" } });
    await fireEvent.press(within(group).getByText("AC not cooling after service"));
    expect(mockNav.navigate).toHaveBeenLastCalledWith("ComplaintDetail", { ticketId: 1042 });
    await fireEvent.press(within(group).getByText("Verify GST numbers"));
    expect(mockNav.navigate).toHaveBeenLastCalledWith("TaskDetail", { taskId: 1, workspaceId: 3, tab: "tat", explainTatId: 5 });
    await fireEvent.press(within(group).getByText("Harpreet Singh"));
    expect(mockNav.navigate).toHaveBeenLastCalledWith("LeadDetail", { leadId: 4 });
  });

  it("a task near its deadline (not missed) is 'At risk' and owes no Explain", async () => {
    jest.mocked(fetchMyDay).mockResolvedValue(
      envelope({ day: { key: "x", live: true }, me: { UserId: ME, FullName: null, tasks: [day({ TaskId: 2, StepsTotal: 0, flags: { atRisk: true } })] } }),
    );
    signInWith("tasks");
    await renderWithProviders(<HomeScreen />);
    expect(await screen.findByText("At risk")).toBeOnTheScreen();
    expect(screen.queryByText("Explain")).toBeNull();
    await fireEvent.press(screen.getByText("Verify GST numbers"));
    expect(mockNav.navigate).toHaveBeenLastCalledWith("TaskDetail", { taskId: 2, workspaceId: 3, tab: "tat" });
  });

  it("no shift today (ShiftEnd null): the row keeps only + New", async () => {
    jest.mocked(fetchMyDay).mockResolvedValue(envelope({ day: { key: "x", live: true }, me: null }));
    signInWith("complaints");
    await renderWithProviders(<HomeScreen />);
    await screen.findByRole("button", { name: "Open 7" });
    expect(screen.queryByText(/On shift until/)).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "New new" }));
    expect(mockCreate.open).toHaveBeenCalled();
  });

  it("complaints + leads: three tiles would leave a hole, so Inbox gives way", async () => {
    signInWith("complaints", "leads");
    await renderWithProviders(<HomeScreen />);
    await screen.findByRole("button", { name: "Leads, 12 yours" });
    expect(screen.getByRole("button", { name: "Follow-ups, 4 due today" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: /^Inbox,/ })).toBeNull();
    // Without tasks, See all opens the overdue complaints.
    await fireEvent.press(screen.getByRole("link", { name: "See all" }));
    expect(mockNav.navigate).toHaveBeenLastCalledWith("Complaints", { queue: "overdue" });
  });

  it("pull to refresh re-asks every query that ran", async () => {
    signInWith("complaints");
    await renderWithProviders(<HomeScreen />);
    await screen.findByRole("button", { name: "Open 7" });
    const before = jest.mocked(fetchTickets).mock.calls.length;
    await act(async () => scroller().props.onRefresh());
    await waitFor(() => expect(jest.mocked(fetchTickets).mock.calls.length).toBeGreaterThan(before));
    expect(scroller().props.refreshing).toBe(false);
  });
});

describe("27 · leads only", () => {
  it("'My leads' hero (Yours · Overdue · New · Won), two tiles, follow-ups need you; + Lead", async () => {
    mockCreate.label = "Lead";
    signInWith("leads");
    await renderWithProviders(<HomeScreen />);
    expect(await screen.findByText("My leads")).toBeOnTheScreen();
    expect(await screen.findByText("₹14,30,000 open value")).toBeOnTheScreen();
    expect(await screen.findByRole("button", { name: "Yours 12" })).toBeOnTheScreen();
    expect(await screen.findByRole("button", { name: "Overdue 3" })).toBeOnTheScreen();
    expect(screen.getByText("New")).toBeOnTheScreen();
    expect(screen.getByText("Won")).toBeOnTheScreen();
    await waitFor(() => expect(screen.getAllByText("5").length).toBeGreaterThan(0));
    expect(fetchLeads).toHaveBeenCalledWith({ OwnerId: ME, StatusId: 31, PageSize: 1 });
    expect(fetchLeads).toHaveBeenCalledWith({ OwnerId: ME, StatusCode: "converted", PageSize: 1 });
    expect(await screen.findByText("6 overdue calls")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Leads, 12 yours" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Follow-ups, 4 due today" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: /^Inbox,/ })).toBeNull();
    const group = screen.getByTestId("needs-you");
    expect(await within(group).findByText("Anil Khanna")).toBeOnTheScreen();
    expect(within(group).getByText("3:00 pm")).toBeOnTheScreen();
    expect(within(group).getByText("Call · Khanna Packaging")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "New lead" })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Overdue 3" }));
    expect(mockNav.navigate).toHaveBeenLastCalledWith("Leads", { queue: "overdue" });
    await fireEvent.press(screen.getByRole("link", { name: "See all" }));
    expect(mockNav.navigate).toHaveBeenLastCalledWith("FollowUps", { view: "today" });
    expect(fetchTickets).not.toHaveBeenCalled();
    expect(fetchTasks).not.toHaveBeenCalled();
  });
});

describe("other roles", () => {
  it("tasks only: 'My tasks' hero and Tasks + Inbox tiles", async () => {
    jest.mocked(fetchTasks).mockImplementation(async (p = {}) =>
      p.OnlyOpen === false
        ? envelope({ tasks: [makeTask({ Id: 9, IsCompleted: true, CompletedDate: "2026-11-02T10:00:00" })], pagination: pagination(1) })
        : envelope({ tasks: [makeTask({ Id: 1, DueDate: "2026-10-01" }), makeTask({ Id: 2 })], pagination: pagination(2) }),
    );
    signInWith("tasks");
    await renderWithProviders(<HomeScreen />);
    expect(await screen.findByText("My tasks")).toBeOnTheScreen();
    expect(await screen.findByRole("button", { name: "Assigned 2" })).toBeOnTheScreen();
    expect(await screen.findByRole("button", { name: "Needs you 1" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Tasks, 2 assigned to you" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Inbox, 63 unread" })).toBeOnTheScreen();
    await waitFor(() => expect(within(screen.getByText("Done").parent!).getByText("1")).toBeOnTheScreen());
    expect(fetchTasks).toHaveBeenCalledWith({ WorkspaceId: null, AssigneeUserId: ME, OnlyOpen: false, PageSize: 200 });
    for (const fn of [fetchTickets, fetchLeads, fetchFollowUps]) expect(fn).not.toHaveBeenCalled();
  });

  it("G10: past one full 200-row page, Done reads '—'", async () => {
    jest.mocked(fetchTasks).mockImplementation(async (p = {}) =>
      p.OnlyOpen === false
        ? envelope({ tasks: [makeTask({ Id: 9, IsCompleted: true, CompletedDate: "2026-11-02T10:00:00" })], pagination: pagination(201) })
        : envelope({ tasks: [], pagination: pagination(0) }),
    );
    signInWith("tasks");
    await renderWithProviders(<HomeScreen />);
    await screen.findByRole("button", { name: "Assigned 0" });
    await waitFor(() => expect(fetchTasks).toHaveBeenCalledTimes(2));
    expect(within(screen.getByText("Done").parent!).getByText("—")).toBeOnTheScreen();
  });

  it("complaints only: the hero and one Inbox tile", async () => {
    signInWith("complaints");
    await renderWithProviders(<HomeScreen />);
    expect(await screen.findByRole("button", { name: "Inbox, 63 unread" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: /^Tasks,/ })).toBeNull();
    for (const fn of [fetchTasks, fetchLeads, fetchFollowUps]) expect(fn).not.toHaveBeenCalled();
  });

  it("no modules: the empty state, and no module requests", async () => {
    signInWith();
    await renderWithProviders(<HomeScreen />);
    expect(await screen.findByText("Nothing here yet")).toBeOnTheScreen();
    for (const fn of [fetchTasks, fetchTickets, fetchLeads, fetchFollowUps]) expect(fn).not.toHaveBeenCalled();
  });
});

describe("T1 · tablet", () => {
  it("search field, hero beside Tasks, then three tiles, Needs you | Follow-ups today", async () => {
    setWindow(...TABLET);
    signInWith("tasks", "complaints", "leads");
    await renderWithProviders(<HomeScreen />);
    expect(await screen.findByText("Monday, 2 November · On shift until 6:30 pm")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("search", { name: "Search complaints, leads, tasks" }));
    expect(mockNav.navigate).toHaveBeenLastCalledWith("Search");
    expect(await screen.findByText("Next at 3:00 pm · 6 overdue")).toBeOnTheScreen();
    expect(await screen.findByRole("button", { name: "Inbox, 63 unread" })).toBeOnTheScreen();
    expect(screen.getByText("Follow-ups today")).toBeOnTheScreen();
    expect(await screen.findByText("Explain delay")).toBeOnTheScreen();
    expect(screen.getByText("Missed deadline")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("link", { name: "Queue" }));
    expect(mockNav.navigate).toHaveBeenLastCalledWith("FollowUps", { view: "today" });
    // The hero spans two of three columns.
    expect(ancestor(screen.getByText("My complaints"), (n) => flat(n).flex === 2)).not.toBeNull();
  });

  it("no follow-ups today: says so", async () => {
    setWindow(...TABLET);
    jest.mocked(fetchFollowUps).mockResolvedValue(envelope({ followups: [], pagination: pagination(0) }));
    signInWith("leads");
    await renderWithProviders(<HomeScreen />);
    expect(await screen.findByText("Nothing due today.")).toBeOnTheScreen();
  });
});
