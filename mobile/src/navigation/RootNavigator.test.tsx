import { StyleSheet } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { fetchNotifications } from "../api/notificationQueries";
import useAuthStore from "../stores/useAuthStore";
import { envelope, pagination } from "../test/fixtures";
import { seedAuth } from "../test/renderWithProviders";

jest.mock("../api/notificationQueries");

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

// The subject is which tree mounts and how the tabs switch; every screen has
// its own test, so each is a labelled stub here.
// A function declaration, so it is hoisted above the hoisted jest.mock calls.
function mockStub(label: string) {
  const { createElement } = require("react");
  const { Text } = require("react-native");
  // Capitalised: React Navigation warns about a component named "default".
  const Stub = () => createElement(Text, null, label);
  return { __esModule: true, default: Stub };
}
jest.mock("../features/auth/LoginScreen", () => mockStub("Login screen"));
jest.mock("../features/tasks/MyWorkScreen", () => mockStub("My Work screen"));
jest.mock("../features/notifications/NotificationsScreen", () => mockStub("Inbox screen"));
jest.mock("../features/hub/WorkHubScreen", () => mockStub("Work hub screen"));
jest.mock("../features/profile/MeScreen", () => mockStub("Profile screen"));
jest.mock("../features/tasks/TaskDetailScreen", () => mockStub("TaskDetail"));
jest.mock("../features/tasks/TaskFormScreen", () => mockStub("TaskForm"));
jest.mock("../features/workspaces/BoardsScreen", () => mockStub("Boards"));
jest.mock("../features/workspaces/BoardScreen", () => mockStub("Board"));
jest.mock("../features/workspaces/ColumnsScreen", () => mockStub("Columns"));
jest.mock("../features/workspaces/WorkspaceFormScreen", () => mockStub("WorkspaceForm"));
jest.mock("../features/workspaces/WorkspaceSettingsScreen", () => mockStub("WorkspaceSettings"));
jest.mock("../features/support/ComplaintsScreen", () => mockStub("Complaints"));
jest.mock("../features/support/ComplaintDetailScreen", () => mockStub("ComplaintDetail"));
jest.mock("../features/support/ComplaintFormScreen", () => mockStub("ComplaintForm"));
jest.mock("../features/hub/ComingSoonScreen", () => mockStub("ComingSoon"));

// The stack animates a screen in and sets state when that finishes. Fake
// timers let each test run the animation to its end inside act(), instead of
// it landing after the test on a slow machine.
beforeEach(() => {
  jest.useFakeTimers();
  jest.mocked(fetchNotifications).mockResolvedValue(
    envelope({ notifications: [], unreadCount: 0, pagination: pagination(0) }),
  );
});
afterEach(async () => {
  await act(async () => { jest.runOnlyPendingTimers(); });
  jest.useRealTimers();
});

const METRICS ={ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
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

it("signed out, only the login screen mounts", async () => {
  useAuthStore.setState(useAuthStore.getInitialState(), true);
  await mountApp();
  expect(await screen.findByText("Login screen")).toBeOnTheScreen();
  expect(screen.queryByRole("tab")).toBeNull();
});

it("signed in, the tabs mount on My Work", async () => {
  seedAuth();
  await mountApp();
  expect(await screen.findByText("My Work screen")).toBeOnTheScreen();
  expect(screen.getAllByRole("tab").map((t) => t.props.accessibilityLabel)).toEqual(["My Work", "Inbox", "Work", "Profile"]);
  expect(screen.queryByText("Login screen")).toBeNull();
});

it("the tab bar switches between the four tabs", async () => {
  seedAuth();
  await mountApp();
  await screen.findByText("My Work screen");
  for (const [tab, body] of [["Inbox", "Inbox screen"], ["Work", "Work hub screen"], ["Profile", "Profile screen"]] as const) {
    await fireEvent.press(screen.getByRole("tab", { name: tab }));
    expect(await screen.findByText(body)).toBeOnTheScreen();
    expect(screen.getByRole("tab", { name: tab })).toBeSelected();
  }
});

it("logging out swaps the whole tree back to login", async () => {
  seedAuth();
  await mountApp();
  await screen.findByText("My Work screen");
  await act(async () => useAuthStore.getState().logout());
  expect(await screen.findByText("Login screen")).toBeOnTheScreen();
  expect(screen.queryByRole("tab")).toBeNull();
});

// parity: NOTIF-01 — the Inbox tab shows the unread count and keeps it fresh every 60 s.
it("the Inbox tab shows the unread count and re-reads it each minute", async () => {
  const unread = (n: number) => envelope({ notifications: [], unreadCount: n, pagination: pagination(n) });
  jest.mocked(fetchNotifications).mockResolvedValueOnce(unread(4)).mockResolvedValue(unread(5));
  seedAuth();
  await mountApp();
  const inbox = () => screen.getByRole("tab", { name: "Inbox" });
  await waitFor(() => expect(inbox()).toHaveTextContent(/4/));
  expect(fetchNotifications).toHaveBeenCalledWith({ PageSize: 1 });
  await act(async () => { jest.advanceTimersByTime(60_000); });
  await waitFor(() => expect(inbox()).toHaveTextContent(/5/));
});

it("no unread, no badge", async () => {
  seedAuth();
  await mountApp();
  await screen.findByText("My Work screen");
  await waitFor(() => expect(fetchNotifications).toHaveBeenCalled());
  expect(screen.getByRole("tab", { name: "Inbox" })).not.toHaveTextContent(/\d/);
});
