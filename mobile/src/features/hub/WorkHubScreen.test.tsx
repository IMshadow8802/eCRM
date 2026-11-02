import { fireEvent, screen } from "@testing-library/react-native";

import { fetchTickets } from "../../api/ticketQueries";
import { fetchWorkspaces } from "../../api/workspaceQueries";
import type { MenuItem, Workspace } from "../../types/api";
import { envelope, makeWorkspace, pagination } from "../../test/fixtures";
import { makeNavigation, renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import WorkHubScreen from "./WorkHubScreen";

jest.mock("../../api/ticketQueries");
jest.mock("../../api/workspaceQueries");

const mockNav = makeNavigation<"Tabs">();
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => mockNav,
}));

// parity: HUB-01 — the complaints count is fetched even for users without complaints; not pinned.
// parity: HUB-02 — "/support/customers" also unlocks the Complaints row; not pinned.

const row = (route: string, canView = true): MenuItem => ({
  menuid: 1,
  parentid: 0,
  description: route,
  image: null,
  route,
  formname: null,
  formclass: null,
  openStyle: null,
  permissions: { canView, canAdd: false, canEdit: false, canDelete: false },
  groupName: null,
});

const signInWith = (routes: MenuItem[]) => seedAuth({ permissions: { rawPermissions: routes } });

const ws = (Id: number, patch: Partial<Workspace> = {}) => makeWorkspace({ Id, ...patch });

beforeEach(() => {
  jest.mocked(fetchWorkspaces).mockResolvedValue([
    ws(1), ws(2), ws(3), ws(4, { IsArchived: true }), ws(5, { MyInviteStatus: "pending" }),
  ]);
  jest.mocked(fetchTickets).mockResolvedValue(envelope({ tickets: [], pagination: pagination(5) }));
});

it("a role with all three menus sees every module with its live count", async () => {
  signInWith([row("/tasks"), row("/support/tickets"), row("/sales/leads")]);
  await renderWithProviders(<WorkHubScreen />);
  expect(await screen.findByText("3 boards")).toBeOnTheScreen();
  expect(await screen.findByText("5 open")).toBeOnTheScreen();
  expect(screen.getByText("Leads")).toBeOnTheScreen();
  expect(screen.getByText("Coming soon")).toBeOnTheScreen();
  expect(fetchTickets).toHaveBeenCalledWith({ StatusCode: "active", PageSize: 1 });
});

it("a task-only role sees only Boards", async () => {
  signInWith([row("/tasks"), row("/sales/leads", false)]);
  await renderWithProviders(<WorkHubScreen />);
  expect(await screen.findByText("3 boards")).toBeOnTheScreen();
  expect(screen.queryByText("Complaints")).toBeNull();
  expect(screen.queryByText("Leads")).toBeNull();
  expect(screen.queryByText("Support")).toBeNull();
});

it("a role with no modules gets the empty state", async () => {
  signInWith([]);
  await renderWithProviders(<WorkHubScreen />);
  expect(await screen.findByText("Nothing here yet")).toBeOnTheScreen();
  expect(screen.queryByText("Boards")).toBeNull();
});

it("falls back to a description when there is nothing to count", async () => {
  signInWith([row("/tasks"), row("/support")]);
  jest.mocked(fetchWorkspaces).mockResolvedValue([]);
  jest.mocked(fetchTickets).mockResolvedValue(envelope({ tickets: [], pagination: pagination(0) }));
  await renderWithProviders(<WorkHubScreen />);
  expect(await screen.findByText("Your task workspaces")).toBeOnTheScreen();
  expect(screen.getByText("Log and track customer issues")).toBeOnTheScreen();
});

it("one board reads singular", async () => {
  signInWith([row("/tasks")]);
  jest.mocked(fetchWorkspaces).mockResolvedValue([ws(1)]);
  await renderWithProviders(<WorkHubScreen />);
  expect(await screen.findByText("1 board")).toBeOnTheScreen();
});

it("each row opens its module", async () => {
  signInWith([row("/tasks"), row("/support/tickets"), row("/sales")]);
  await renderWithProviders(<WorkHubScreen />);
  await screen.findByText("3 boards");
  await fireEvent.press(screen.getByText("Boards"));
  expect(mockNav.navigate).toHaveBeenLastCalledWith("Boards");
  await fireEvent.press(screen.getByText("Complaints"));
  expect(mockNav.navigate).toHaveBeenLastCalledWith("Complaints");
  await fireEvent.press(screen.getByText("Leads"));
  expect(mockNav.navigate).toHaveBeenLastCalledWith(
    "ComingSoon",
    expect.objectContaining({ title: "Leads" }),
  );
});
