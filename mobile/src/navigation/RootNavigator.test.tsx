import { DeviceEventEmitter, StyleSheet } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";

import useAuthStore from "../stores/useAuthStore";
import type { DayTask, DayTaskFlags, ModuleKey } from "../types/api";
import { seedAuth } from "../test/renderWithProviders";
import { PHONE, TABLET, setWindow } from "../test/window";
import { ToastProvider } from "../ui";
import { envelope, makeWorkspace, pagination, serverError } from "../test/fixtures";
import { heartbeat } from "../api/presenceQueries";
import { fetchMyDay } from "../api/todayQueries";
import { fetchTickets } from "../api/ticketQueries";
import { fetchFollowUps } from "../api/followupQueries";
import { fetchNotifications } from "../api/notificationQueries";
import { ensurePersonalWorkspace, fetchWorkspaces } from "../api/workspaceQueries";

// @react-navigation/stack warns once, at import, that RN deprecated
// InteractionManager — library noise, not ours. Swallow exactly that line.
let RootNavigator: typeof import("./RootNavigator").default;
let focusedRoute: typeof import("./RootNavigator").focusedRoute;
let shellNavigator: typeof import("./RootNavigator").shellNavigator;
beforeAll(() => {
  const original = console.warn;
  const warn = jest.spyOn(console, "warn").mockImplementation((msg: unknown, ...rest: unknown[]) => {
    if (!String(msg).startsWith("InteractionManager has been deprecated")) original(msg, ...rest);
  });
  ({ default: RootNavigator, focusedRoute, shellNavigator } = require("./RootNavigator"));
  warn.mockRestore();
});

// The subject is which tree and which tabs mount and how they switch; every
// screen has its own test, so each is a labelled stub here.
// A function declaration, so it is hoisted above the hoisted jest.mock calls.
function mockStub(label: string) {
  const { createElement } = require("react");
  const { Text } = require("react-native");
  // Capitalised: React Navigation warns about a component named "default".
  const Stub = () => createElement(Text, null, label);
  return { __esModule: true, default: Stub };
}
jest.mock("../features/auth/LoginScreen", () => mockStub("Login screen"));
// The Home stub can open any route, proving each is registered where Home's
// own navigate() calls will look for it.
jest.mock("../features/home/HomeScreen", () => {
  const { createElement } = require("react");
  const { Pressable, Text, View } = require("react-native");
  const { useNavigation } = require("@react-navigation/native");
  const targets: [string, object?][] = [
    ["Inbox"], ["Me"], ["Boards"], ["FollowUps", { view: "today" }],
    ["Complaints", { queue: "overdue" }], ["LeadDetail", { leadId: 1 }], ["LeadForm", {}],
    ["ComplaintDetail", { ticketId: 1 }], ["Search"],
  ];
  const Home = () => {
    const nav = useNavigation();
    const create = require("./Shell").useCreate();
    return createElement(View, null,
      createElement(Text, null, "Home screen"),
      createElement(Pressable, { onPress: create.open }, createElement(Text, null, `+ ${create.label}`)),
      ...targets.map(([name, params]) =>
        createElement(Pressable, { key: name, onPress: () => nav.navigate(name, params) },
          createElement(Text, null, `open ${name}`))));
  };
  return { __esModule: true, default: Home };
});
jest.mock("../features/home/MoreScreen", () => mockStub("More screen"));
jest.mock("../features/tasks/MyWorkScreen", () => mockStub("My Work screen"));
jest.mock("../features/notifications/NotificationsScreen", () => mockStub("Inbox screen"));
jest.mock("../features/profile/MeScreen", () => mockStub("Profile screen"));
jest.mock("../features/tasks/TaskDetailScreen", () => mockStub("TaskDetail"));
jest.mock("../features/tasks/TaskFormScreen", () => mockStub("TaskForm"));
jest.mock("../features/workspaces/BoardsScreen", () => mockStub("Boards screen"));
jest.mock("../features/workspaces/BoardScreen", () => mockStub("Board"));
jest.mock("../features/workspaces/ColumnsScreen", () => mockStub("Columns"));
jest.mock("../features/workspaces/WorkspaceFormScreen", () => mockStub("WorkspaceForm"));
jest.mock("../features/workspaces/WorkspaceSettingsScreen", () => mockStub("WorkspaceSettings"));
// The list stubs echo their filter param, so a navigate() can be seen landing.
function mockList(label: string) {
  const { createElement } = require("react");
  const { Text } = require("react-native");
  const List = ({ route, pushed }: { route: { params?: Record<string, string> }; pushed?: boolean }) =>
    createElement(Text, null,
      `${label} screen${pushed ? " (pushed)" : ""}${route.params ? ` ${Object.values(route.params).join(",")}` : ""}`);
  return { __esModule: true, default: List };
}
jest.mock("../features/support/ComplaintsScreen", () => mockList("Complaints"));
// The detail stub publishes an action bar, as the real record screens will.
jest.mock("../features/support/ComplaintDetailScreen", () => {
  const { createElement } = require("react");
  const { Text } = require("react-native");
  const { CircleCheck, PhoneCall } = require("lucide-react-native");
  const Detail = () => {
    require("./Shell").useActionBar([
      { key: "call", label: "Log call", icon: PhoneCall, onPress: mockResolve },
      { key: "resolve", label: "Resolve", icon: CircleCheck, main: true, onPress: mockResolve },
    ]);
    return createElement(Text, null, "ComplaintDetail");
  };
  return { __esModule: true, default: Detail };
});
const mockResolve = jest.fn();
jest.mock("../features/search/SearchScreen", () => mockStub("Search screen"));
jest.mock("../api/presenceQueries", () => ({ heartbeat: jest.fn(), ackNotice: jest.fn() }));
jest.mock("../api/todayQueries", () => ({ fetchMyDay: jest.fn() }));
jest.mock("../api/ticketQueries", () => ({ ...jest.requireActual("../api/ticketQueries"), fetchTickets: jest.fn() }));
jest.mock("../api/followupQueries", () => ({ ...jest.requireActual("../api/followupQueries"), fetchFollowUps: jest.fn() }));
jest.mock("../api/notificationQueries", () => ({ ...jest.requireActual("../api/notificationQueries"), fetchNotifications: jest.fn() }));
jest.mock("../api/workspaceQueries", () => ({
  ...jest.requireActual("../api/workspaceQueries"), fetchWorkspaces: jest.fn(), ensurePersonalWorkspace: jest.fn(),
}));
jest.mock("../features/support/ComplaintFormScreen", () => mockStub("ComplaintForm"));
jest.mock("../features/sales/LeadsScreen", () => mockList("Leads"));
jest.mock("../features/sales/LeadDetailScreen", () => mockStub("LeadDetail"));
jest.mock("../features/sales/LeadFormScreen", () => mockStub("LeadForm"));
jest.mock("../features/sales/FollowUpsScreen", () => mockList("FollowUps"));

// The stack animates a screen in and sets state when that finishes. Fake
// timers let each test run the animation to its end inside act(), instead of
// it landing after the test on a slow machine.
const NO_FLAGS: DayTaskFlags = {
  given: false, done: false, doneLate: false, open: true, working: false, notStarted: true, dueToday: false,
  overdue: false, atRisk: false, onHold: false, reasonOwed: false, toRule: false,
};
const dayTask = (TaskId: number, flags: Partial<DayTaskFlags>): DayTask => ({
  TaskId, TatId: TaskId, Title: "t", WorkspaceId: 1, WorkspaceName: "Ops", AssignedByName: null, Priority: null,
  StepsTotal: 0, StepsDone: 0, HoldReason: null, CompletedDate: null, BreachedAt: null, due: null, timer: "clock",
  timeLeftMin: null, flags: { ...NO_FLAGS, ...flags },
});
/** Badge sources: 2 tasks need you, 3 complaints overdue, 4 follow-ups overdue, 63 unread. */
const serveCounts = () => {
  jest.mocked(fetchMyDay).mockResolvedValue(envelope({
    day: { key: "2026-11-02", live: true },
    me: { UserId: 1, FullName: "Test User", tasks: [dayTask(1, { overdue: true }), dayTask(2, { reasonOwed: true }), dayTask(3, {})] },
  }));
  jest.mocked(fetchTickets).mockResolvedValue(envelope({ tickets: [], pagination: pagination(3) }));
  jest.mocked(fetchFollowUps).mockResolvedValue(envelope({ followups: [], pagination: pagination(4) }));
  jest.mocked(fetchNotifications).mockResolvedValue(envelope({ notifications: [], unreadCount: 63, pagination: pagination(0) }));
};

beforeEach(() => {
  jest.useFakeTimers();
  setWindow(...PHONE);
  serveCounts();
  jest.mocked(heartbeat).mockResolvedValue(envelope({ expiresAt: "2026-11-02T19:00:00.000Z" }));
  jest.mocked(fetchWorkspaces).mockResolvedValue([]);
});
afterEach(async () => {
  await act(async () => { jest.runOnlyPendingTimers(); });
  jest.useRealTimers();
});

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const mountApp = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SafeAreaProvider initialMetrics={METRICS}>
        <GestureHandlerRootView style={StyleSheet.absoluteFill}>
          <BottomSheetModalProvider>
            <ToastProvider>
              <RootNavigator />
            </ToastProvider>
          </BottomSheetModalProvider>
        </GestureHandlerRootView>
      </SafeAreaProvider>
    </QueryClientProvider>,
  );

const VIEW = { view: true, add: false, edit: false, delete: false, reach: "Own" as const };
const signInWith = (...modules: ModuleKey[]) =>
  seedAuth({ access: { modules: Object.fromEntries(modules.map((m) => [m, VIEW])) } });
const tabLabels = () => screen.getAllByRole("tab").map((t) => t.props.accessibilityLabel);

it("signed out, only the login screen mounts", async () => {
  useAuthStore.setState(useAuthStore.getInitialState(), true);
  await mountApp();
  expect(await screen.findByText("Login screen")).toBeOnTheScreen();
  expect(screen.queryByRole("tab")).toBeNull();
});

describe("the tab bar is the role's modules, in a fixed order, never more than five", () => {
  it.each([
    ["complaints-only", () => signInWith("complaints"), ["Today", "Complaints", "More"]],
    ["leads-only", () => signInWith("leads"), ["Today", "Leads", "Follow-ups", "More"]],
    ["tasks-only", () => signInWith("tasks"), ["Today", "Tasks", "More"]],
    ["tasks and leads", () => signInWith("tasks", "leads"), ["Today", "Tasks", "Leads", "Follow-ups", "More"]],
    ["complaints and leads", () => signInWith("complaints", "leads"), ["Today", "Complaints", "Leads", "Follow-ups", "More"]],
    ["all three",() => signInWith("leads", "complaints", "tasks"), ["Today", "Tasks", "Complaints", "Leads", "More"]],
    ["an admin", () => seedAuth({ access: { isAdmin: true } }), ["Today", "Tasks", "Complaints", "Leads", "More"]],
    // Customers is its own module (096): it does not open complaints.
    ["customers-only", () => signInWith("customers"), ["Today", "More"]],
    // Access not known yet: nothing is granted.
    ["access not loaded", () => seedAuth(), ["Today", "More"]],
  ] as const)("%s", async (_role, signIn, tabs) => {
    signIn();
    await mountApp();
    expect(await screen.findByText("Home screen")).toBeOnTheScreen();
    expect(tabLabels()).toEqual(tabs);
    expect(tabs.length).toBeLessThanOrEqual(5);
    expect(screen.queryByText("Login screen")).toBeNull();
  });
});

it("the tab bar switches between every tab, each opening its list", async () => {
  signInWith("tasks", "complaints", "leads");
  await mountApp();
  await screen.findByText("Home screen");
  for (const [tab, body] of [
    ["Tasks", "My Work screen"],
    ["Complaints", "Complaints screen"],
    ["Leads", "Leads screen"],
    ["More", "More screen"],
    ["Today", "Home screen"],
  ] as const) {
    await fireEvent.press(screen.getByRole("tab", { name: tab }));
    expect(await screen.findByText(body)).toBeOnTheScreen();
    expect(screen.getByRole("tab", { name: tab })).toBeSelected();
  }
});

it("a role losing a module loses its tab without a re-login", async () => {
  signInWith("tasks", "complaints");
  await mountApp();
  await screen.findByText("Home screen");
  expect(tabLabels()).toEqual(["Today", "Tasks", "Complaints", "More"]);
  await act(async () => signInWith("tasks"));
  expect(tabLabels()).toEqual(["Today", "Tasks", "More"]);
});

it("logging out swaps the whole tree back to login", async () => {
  signInWith("tasks");
  await mountApp();
  await screen.findByText("Home screen");
  await act(async () => useAuthStore.getState().logout());
  expect(await screen.findByText("Login screen")).toBeOnTheScreen();
  expect(screen.queryByRole("tab")).toBeNull();
});

const openFromHome = async (name: string) => {
  await fireEvent.press(await screen.findByText(`open ${name}`));
  await act(async () => { jest.runOnlyPendingTimers(); });
};

it.each([
  ["Inbox", "Inbox screen"],
  ["Me", "Profile screen"],
  ["Boards", "Boards screen"],
  ["LeadDetail", "LeadDetail"],
  ["LeadForm", "LeadForm"],
])("the %s screen is pushed on the stack", async (name, body) => {
  signInWith("tasks", "complaints", "leads");
  await mountApp();
  await openFromHome(name);
  expect(await screen.findByText(body)).toBeOnTheScreen();
});

it("a navigate() to a tab with a filter lands on that tab with it", async () => {
  signInWith("complaints");
  await mountApp();
  await openFromHome("Complaints");
  expect(await screen.findByText("Complaints screen overdue")).toBeOnTheScreen();
  expect(screen.getByRole("tab", { name: "Complaints" })).toBeSelected();
});

describe("Follow-ups: a tab while there is room, else pushed", () => {
  it("leads-only: Home's row opens the Follow-ups tab", async () => {
    signInWith("leads");
    await mountApp();
    await openFromHome("FollowUps");
    expect(await screen.findByText("FollowUps screen today")).toBeOnTheScreen();
    expect(screen.getByRole("tab", { name: "Follow-ups" })).toBeSelected();
  });

  it("with no room on the bar, the same navigate() pushes it, with a back button", async () => {
    signInWith("tasks", "complaints", "leads");
    await mountApp();
    await openFromHome("FollowUps");
    expect(await screen.findByText("FollowUps screen (pushed) today")).toBeOnTheScreen();
  });

  // Review A-I1: from a pushed screen, navigate("FollowUps") hit the stack and pushed a copy.
  it("tasks+leads: the bar's Follow-ups from a pushed screen switches to the tab, not a pushed copy", async () => {
    signInWith("tasks", "leads");
    await mountApp();
    await openFromHome("Boards");
    expect(await screen.findByText("Boards screen")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("tab", { name: "Follow-ups" }));
    await act(async () => { jest.runOnlyPendingTimers(); });
    expect(await screen.findByText("FollowUps screen")).toBeOnTheScreen();
    expect(screen.queryByText("FollowUps screen (pushed)")).toBeNull();
    expect(screen.getByRole("tab", { name: "Follow-ups" })).toBeSelected();
  });
});

// ------------------------------------------------------------------ the Shell (spec §3.3, §3.4)

const flatOf = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style);
const badgeOf = (name: string) => screen.getByRole("tab", { name }).props.accessibilityValue?.text;
const ADD = { view: true, add: true, edit: true, delete: false, reach: "Own" as const };

describe("the docked bar", () => {
  it("is navy, docked over the home-indicator inset, the active pill in its module tone", async () => {
    signInWith("tasks", "complaints", "leads");
    await mountApp();
    await screen.findByText("Home screen");
    expect(flatOf("bottom-bar")).toMatchObject({ backgroundColor: "#171D47", height: 58 + 34, paddingBottom: 34 });
    expect(flatOf("pill-Home").backgroundColor).toBe("#D5D9F5");
    expect(flatOf("indicator-Home")).toMatchObject({ width: 32, height: 3, backgroundColor: "#8592F0" });
    await fireEvent.press(screen.getByRole("tab", { name: "Complaints" }));
    expect(flatOf("pill-Complaints").backgroundColor).toBe("#FFCCB8");
    expect(screen.queryByTestId("indicator-Home")).toBeNull();
  });

  it("badges come from Home's queries: needs-you tasks, MY overdue complaints (§7.9)", async () => {
    signInWith("tasks", "complaints", "leads");
    await mountApp();
    expect(await screen.findByText("2")).toBeOnTheScreen();
    expect(badgeOf("Tasks")).toBe("2 new");
    expect(badgeOf("Complaints")).toBe("3 new");
    expect(badgeOf("Leads")).toBeUndefined();
    expect(badgeOf("Today")).toBeUndefined();
    expect(jest.mocked(fetchTickets)).toHaveBeenCalledWith(
      expect.objectContaining({ Overdue: true, AssignedTo: useAuthStore.getState().UserId, PageSize: 1 }),
    );
    expect(useAuthStore.getState().UserId).not.toBeNull();
  });

  it("leads-only: Follow-ups carries the overdue follow-ups badge", async () => {
    signInWith("leads");
    await mountApp();
    expect(await screen.findByText("4")).toBeOnTheScreen();
    expect(badgeOf("Follow-ups")).toBe("4 new");
    expect(fetchMyDay).not.toHaveBeenCalled();
    expect(fetchTickets).not.toHaveBeenCalled();
  });

  it.each([
    ["Inbox", "Inbox screen", "Today"],
    ["Boards", "Boards screen", "More"],
    ["Me", "Profile screen", "More"],
    ["Search", "Search screen", "Today"],
  ])("a pushed %s keeps the bar with its owner tab active", async (name, body, owner) => {
    signInWith("tasks", "complaints", "leads");
    await mountApp();
    await openFromHome(name);
    expect(await screen.findByText(body)).toBeOnTheScreen();
    expect(screen.getByRole("tab", { name: owner })).toBeSelected();
  });

  it("a tab press from a pushed screen pops back to that tab", async () => {
    signInWith("tasks", "complaints", "leads");
    await mountApp();
    await openFromHome("Boards");
    await fireEvent.press(screen.getByRole("tab", { name: "Tasks" }));
    await act(async () => { jest.runOnlyPendingTimers(); });
    expect(await screen.findByText("My Work screen")).toBeOnTheScreen();
    expect(screen.getByRole("tab", { name: "Tasks" })).toBeSelected();
  });

  it("a form has no bar", async () => {
    signInWith("leads");
    await mountApp();
    await openFromHome("LeadForm");
    expect(await screen.findByText("LeadForm")).toBeOnTheScreen();
    expect(screen.queryByTestId("bottom-bar")).toBeNull();
  });

  it("a record shows the action bar it publishes, the main action filled", async () => {
    signInWith("complaints");
    await mountApp();
    await openFromHome("ComplaintDetail");
    expect(await screen.findByText("ComplaintDetail")).toBeOnTheScreen();
    expect(screen.queryByTestId("bottom-bar")).toBeNull();
    expect(screen.getByTestId("action-bar")).toBeOnTheScreen();
    expect(flatOf("action-main").backgroundColor).toBe("#3F4FAF");
    await fireEvent.press(screen.getByRole("button", { name: "Resolve" }));
    expect(mockResolve).toHaveBeenCalledTimes(1);
  });
});

describe("with the keyboard up", () => {
  const keyboard = (event: "keyboardDidShow" | "keyboardDidHide") =>
    act(() => {
      DeviceEventEmitter.emit(event, { endCoordinates: { screenX: 0, screenY: 500, width: 400, height: 300 } });
    });

  it("the tab bar steps aside (it would ride the keyboard and eat the list) and comes back after", async () => {
    signInWith("tasks", "complaints");
    await mountApp();
    await screen.findByText("Home screen");
    await keyboard("keyboardDidShow");
    expect(screen.queryByTestId("bottom-bar")).toBeNull();
    await keyboard("keyboardDidHide");
    expect(screen.getByTestId("bottom-bar")).toBeOnTheScreen();
  });

  it("a record's action bar stays: its submit must be reachable over the keyboard", async () => {
    signInWith("complaints");
    await mountApp();
    await openFromHome("ComplaintDetail");
    expect(await screen.findByText("ComplaintDetail")).toBeOnTheScreen();
    await keyboard("keyboardDidShow");
    expect(screen.getByTestId("action-bar")).toBeOnTheScreen();
    await keyboard("keyboardDidHide");
  });
});

describe("the rail (tablet, ≥ medium)", () => {
  const railLabels = () => screen.getAllByRole("tab").map((t) => t.props.accessibilityLabel);

  // Review: all three modules → Follow-ups is no tab, so popTo("Tabs", FollowUps) went nowhere.
  it("all three: Follow-ups opens the pushed queue, and its rail item is the active one", async () => {
    setWindow(...TABLET);
    signInWith("tasks", "complaints", "leads");
    await mountApp();
    await screen.findByText("Home screen");
    await fireEvent.press(screen.getByRole("tab", { name: "Follow-ups" }));
    await act(async () => { jest.runOnlyPendingTimers(); });
    expect(await screen.findByText("FollowUps screen (pushed)")).toBeOnTheScreen();
    expect(screen.getByRole("tab", { name: "Follow-ups" })).toBeSelected();
    expect(screen.getByRole("tab", { name: "More" })).not.toBeSelected();
  });

  it("leads-only: Follow-ups is the tab", async () => {
    setWindow(...TABLET);
    signInWith("leads");
    await mountApp();
    await screen.findByText("Home screen");
    await fireEvent.press(screen.getByRole("tab", { name: "Follow-ups" }));
    await act(async () => { jest.runOnlyPendingTimers(); });
    expect(await screen.findByText("FollowUps screen")).toBeOnTheScreen();
    expect(screen.getByRole("tab", { name: "Follow-ups" })).toBeSelected();
  });

  it.each([
    ["all three", ["tasks", "complaints", "leads"], ["Today", "Tasks", "Complaints", "Leads", "Follow-ups", "Inbox", "More"]],
    ["complaints-only", ["complaints"], ["Today", "Complaints", "Inbox", "More"]],
    ["leads-only", ["leads"], ["Today", "Leads", "Follow-ups", "Inbox", "More"]],
    ["tasks-only", ["tasks"], ["Today", "Tasks", "Inbox", "More"]],
  ] as const)("%s: the rail replaces the bar, in E's order", async (_role, modules, labels) => {
    setWindow(...TABLET);
    signInWith(...modules);
    await mountApp();
    await screen.findByText("Home screen");
    expect(screen.getByTestId("rail")).toBeOnTheScreen();
    expect(screen.queryByTestId("bottom-bar")).toBeNull();
    expect(railLabels()).toEqual(labels);
  });

  it("Inbox is a rail item with the unread badge; a form keeps the rail; no action bar on a record", async () => {
    setWindow(...TABLET);
    signInWith("complaints", "leads");
    await mountApp();
    expect(await screen.findByText("63")).toBeOnTheScreen();
    expect(badgeOf("Inbox")).toBe("63 new");
    await fireEvent.press(screen.getByRole("tab", { name: "Inbox" }));
    await act(async () => { jest.runOnlyPendingTimers(); });
    expect(await screen.findByText("Inbox screen")).toBeOnTheScreen();
    expect(screen.getByRole("tab", { name: "Inbox" })).toBeSelected();
    await fireEvent.press(screen.getByRole("tab", { name: "More" }));
    await act(async () => { jest.runOnlyPendingTimers(); });
    expect(await screen.findByText("More screen")).toBeOnTheScreen();
    expect(screen.getByRole("tab", { name: "More" })).toBeSelected();
  });

  it("a form keeps its module's rail item active (E T4: Leads)", async () => {
    setWindow(...TABLET);
    signInWith("tasks", "complaints", "leads");
    await mountApp();
    await openFromHome("LeadForm");
    expect(await screen.findByText("LeadForm")).toBeOnTheScreen();
    expect(screen.getByRole("tab", { name: "Leads" })).toBeSelected();
  });

  it("a record at the rail has no action bar (actions go in its band)", async () => {
    setWindow(...TABLET);
    signInWith("complaints");
    await mountApp();
    await openFromHome("ComplaintDetail");
    expect(await screen.findByText("ComplaintDetail")).toBeOnTheScreen();
    expect(screen.queryByTestId("action-bar")).toBeNull();
    expect(screen.getByTestId("rail")).toBeOnTheScreen();
  });
});

describe("Create (04b)", () => {
  // Review B-M2: a view-only role's "+" opened an empty sheet.
  it("the rail's + shows only when the role can add to something", async () => {
    setWindow(...TABLET);
    signInWith("tasks", "complaints");
    await mountApp();
    await screen.findByText("Home screen");
    expect(screen.queryByRole("button", { name: "Create" })).toBeNull();
    seedAuth({ access: { modules: { tasks: ADD, complaints: ADD } } });
    await mountApp();
    expect(await screen.findAllByRole("button", { name: "Create" })).not.toHaveLength(0);
  });

  it("rows only for modules the role can add, in E's order, with the footnote", async () => {
    seedAuth({ access: { modules: { tasks: ADD, complaints: ADD, leads: { ...ADD, add: false } } } });
    await mountApp();
    await fireEvent.press(await screen.findByText("+ New"));
    expect(screen.getAllByRole("button", { name: /^New / }).map((b) => b.props.accessibilityLabel)).toEqual(["New task", "New complaint"]);
    expect(screen.getByText("Only the modules you can add to appear here.")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "New complaint" }));
    await act(async () => { jest.runOnlyPendingTimers(); });
    expect(await screen.findByText("ComplaintForm")).toBeOnTheScreen();
  });

  it("one addable module skips the sheet: the band reads + Lead and opens the form", async () => {
    seedAuth({ access: { modules: { leads: ADD } } });
    await mountApp();
    await fireEvent.press(await screen.findByText("+ Lead"));
    await act(async () => { jest.runOnlyPendingTimers(); });
    expect(await screen.findByText("LeadForm")).toBeOnTheScreen();
  });

  it("New task opens the form on the caller's personal workspace", async () => {
    jest.mocked(fetchWorkspaces).mockResolvedValue([
      makeWorkspace({ Id: 7, Type: "shared", OwnerUserId: 1 }),
      makeWorkspace({ Id: 9, Type: "personal", OwnerUserId: 1 }),
    ]);
    seedAuth({ UserId: 1, access: { modules: { tasks: ADD } } });
    await mountApp();
    await fireEvent.press(await screen.findByText("+ Task"));
    await act(async () => { jest.runOnlyPendingTimers(); });
    expect(await screen.findByText("TaskForm")).toBeOnTheScreen();
  });
});

it("the heartbeat records the session's expiry while signed in (G22)", async () => {
  signInWith("tasks");
  await mountApp();
  await screen.findByText("Home screen");
  expect(heartbeat).toHaveBeenCalled();
  await act(async () => {});
  expect(useAuthStore.getState().sessionExpiresAt).toBe("2026-11-02T19:00:00.000Z");
});

describe("Create: a new task without a personal workspace", () => {
  it("asks the server to make one, then opens the form on it", async () => {
    jest.mocked(fetchWorkspaces)
      .mockResolvedValueOnce([])
      .mockResolvedValue([makeWorkspace({ Id: 11, Type: "personal", OwnerUserId: 1 })]);
    jest.mocked(ensurePersonalWorkspace).mockResolvedValue(envelope(null));
    seedAuth({ UserId: 1, access: { modules: { tasks: ADD } } });
    await mountApp();
    await fireEvent.press(await screen.findByText("+ Task"));
    await act(async () => { jest.runOnlyPendingTimers(); });
    expect(await screen.findByText("TaskForm")).toBeOnTheScreen();
    expect(ensurePersonalWorkspace).toHaveBeenCalledTimes(1);
  });

  it("says so when none can be had", async () => {
    jest.mocked(ensurePersonalWorkspace).mockResolvedValue(envelope(null));
    seedAuth({ UserId: 1, access: { modules: { tasks: ADD } } });
    await mountApp();
    await fireEvent.press(await screen.findByText("+ Task"));
    expect(await screen.findByRole("alert", { name: "Could not find your personal workspace." })).toBeOnTheScreen();
  });

  it("says so when the server refuses", async () => {
    jest.mocked(fetchWorkspaces).mockRejectedValue(serverError(500, "Server busy"));
    seedAuth({ UserId: 1, access: { modules: { tasks: ADD } } });
    await mountApp();
    await fireEvent.press(await screen.findByText("+ Task"));
    expect(await screen.findByRole("alert", { name: "Server busy" })).toBeOnTheScreen();
  });

  it("the rail's + names the one module and opens its form", async () => {
    setWindow(...TABLET);
    seedAuth({ access: { modules: { complaints: ADD } } });
    await mountApp();
    await fireEvent.press(within(await screen.findByTestId("rail")).getByRole("button", { name: "New complaint" }));
    await act(async () => { jest.runOnlyPendingTimers(); });
    expect(await screen.findByText("ComplaintForm")).toBeOnTheScreen();
  });
});

describe("focusedRoute / shellNavigator", () => {
  it("reads the stack route, and the tab inside Tabs (or the one asked for, else Home)", () => {
    const tabs = (state?: object, params?: object) => ({ index: 0, routes: [{ key: "t", name: "Tabs", state, params }] }) as never;
    expect(focusedRoute(undefined)).toBeNull();
    expect(focusedRoute({ index: 0, routes: [{ key: "i", name: "Inbox" }] } as never)).toEqual({ name: "Inbox", key: "i", tab: null });
    expect(focusedRoute(tabs({ index: 1, routes: [{ name: "Home" }, { name: "Leads" }] }))).toMatchObject({ tab: "Leads" });
    expect(focusedRoute(tabs(undefined, { screen: "Complaints" }))).toMatchObject({ tab: "Complaints" });
    expect(focusedRoute(tabs())).toMatchObject({ tab: "Home" });
  });

  it("drops a press before the container is ready", () => {
    const ref = { isReady: jest.fn(() => false), navigate: jest.fn(), dispatch: jest.fn() };
    const nav = shellNavigator(ref as never);
    nav.navigate("Inbox");
    nav.toTab("Leads");
    expect(ref.navigate).not.toHaveBeenCalled();
    expect(ref.dispatch).not.toHaveBeenCalled();
    ref.isReady.mockReturnValue(true);
    nav.toTab("Leads");
    expect(ref.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "POP_TO", payload: expect.objectContaining({ name: "Tabs", params: { screen: "Leads" } }) }));
  });
});
