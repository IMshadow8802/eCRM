import { fireEvent, screen } from "@testing-library/react-native";

import { fetchNotifications } from "../../api/notificationQueries";
import type { ModuleKey } from "../../types/api";
import { envelope, pagination } from "../../test/fixtures";
import { makeNavigation, renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import MoreScreen from "./MoreScreen";

jest.mock("../../api/notificationQueries");

const mockNav = makeNavigation<"Tabs">();
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => mockNav,
}));

const VIEW = { view: true, add: false, edit: false, delete: false, reach: "Own" as const };
const signInWith = (...modules: ModuleKey[]) =>
  seedAuth({ access: { modules: Object.fromEntries(modules.map((m) => [m, VIEW])) } });
const unread = (n: number) => envelope({ notifications: [], unreadCount: n, pagination: pagination(n) });
const rowLabels = () => ["Inbox", "Workspaces", "Follow-ups", "Profile"].filter((l) => screen.queryByText(l));

beforeEach(() => {
  jest.mocked(fetchNotifications).mockResolvedValue(unread(0));
});

it.each([
  // Follow-ups is a tab for these two, so it is not repeated here.
  ["leads-only", ["leads"], ["Inbox", "Profile"]],
  ["tasks and leads", ["tasks", "leads"], ["Inbox", "Workspaces", "Profile"]],
  // No room on the bar: Follow-ups moves here.
  ["all three", ["tasks", "complaints", "leads"], ["Inbox", "Workspaces", "Follow-ups", "Profile"]],
  ["complaints-only", ["complaints"], ["Inbox", "Profile"]],
] as const)("%s gets its rows", async (_role, modules, rows) => {
  signInWith(...modules);
  await renderWithProviders(<MoreScreen />);
  expect(await screen.findByText("Profile")).toBeOnTheScreen();
  expect(rowLabels()).toEqual(rows);
});

it("each row opens its screen on the stack", async () => {
  signInWith("tasks", "complaints", "leads");
  await renderWithProviders(<MoreScreen />);
  for (const [row, ...target] of [
    ["Inbox", "Inbox"],
    ["Workspaces", "Boards"],
    ["Follow-ups", "FollowUps", undefined],
    ["Profile", "Me"],
  ] as const) {
    await fireEvent.press(await screen.findByText(row));
    expect(mockNav.navigate).toHaveBeenLastCalledWith(...target);
  }
});

it("the Inbox row carries the unread count", async () => {
  jest.mocked(fetchNotifications).mockResolvedValue(unread(3));
  signInWith();
  await renderWithProviders(<MoreScreen />);
  expect(await screen.findByText("3 unread")).toBeOnTheScreen();
});

it("no unread, a plain description", async () => {
  signInWith();
  await renderWithProviders(<MoreScreen />);
  expect(await screen.findByText("Your notifications")).toBeOnTheScreen();
});
