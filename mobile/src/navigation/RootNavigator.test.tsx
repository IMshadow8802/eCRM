import { StyleSheet } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import useAuthStore from "../stores/useAuthStore";
import type { ModuleKey } from "../types/api";
import { seedAuth } from "../test/renderWithProviders";

// @react-navigation/stack warns once, at import, that RN deprecated
// InteractionManager — library noise, not ours. Swallow exactly that line.
let RootNavigator: typeof import("./RootNavigator").default;
beforeAll(() => {
  const original = console.warn;
  const warn = jest.spyOn(console, "warn").mockImplementation((msg: unknown, ...rest: unknown[]) => {
    if (!String(msg).startsWith("InteractionManager has been deprecated")) original(msg, ...rest);
  });
  RootNavigator = require("./RootNavigator").default;
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
  ];
  const Home = () => {
    const nav = useNavigation();
    return createElement(View, null,
      createElement(Text, null, "Home screen"),
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
jest.mock("../features/support/ComplaintDetailScreen", () => mockStub("ComplaintDetail"));
jest.mock("../features/support/ComplaintFormScreen", () => mockStub("ComplaintForm"));
jest.mock("../features/sales/LeadsScreen", () => mockList("Leads"));
jest.mock("../features/sales/LeadDetailScreen", () => mockStub("LeadDetail"));
jest.mock("../features/sales/LeadFormScreen", () => mockStub("LeadForm"));
jest.mock("../features/sales/FollowUpsScreen", () => mockList("FollowUps"));

// The stack animates a screen in and sets state when that finishes. Fake
// timers let each test run the animation to its end inside act(), instead of
// it landing after the test on a slow machine.
beforeEach(() => jest.useFakeTimers());
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
          <RootNavigator />
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
    ["complaints-only", () => signInWith("complaints"), ["Home", "Complaints", "More"]],
    ["leads-only", () => signInWith("leads"), ["Home", "Leads", "Follow-ups", "More"]],
    ["tasks-only", () => signInWith("tasks"), ["Home", "Tasks", "More"]],
    ["tasks and leads", () => signInWith("tasks", "leads"), ["Home", "Tasks", "Leads", "Follow-ups", "More"]],
    ["all three", () => signInWith("leads", "complaints", "tasks"), ["Home", "Tasks", "Complaints", "Leads", "More"]],
    ["an admin", () => seedAuth({ access: { isAdmin: true } }), ["Home", "Tasks", "Complaints", "Leads", "More"]],
    // Customers is its own module (096): it does not open complaints.
    ["customers-only", () => signInWith("customers"), ["Home", "More"]],
    // Access not known yet: nothing is granted.
    ["access not loaded", () => seedAuth(), ["Home", "More"]],
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
    ["Home", "Home screen"],
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
  expect(tabLabels()).toEqual(["Home", "Tasks", "Complaints", "More"]);
  await act(async () => signInWith("tasks"));
  expect(tabLabels()).toEqual(["Home", "Tasks", "More"]);
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
});
