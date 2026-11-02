import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { fetchFollowUps } from "../../api/followupQueries";
import { fetchLeads } from "../../api/leadQueries";
import { fetchTickets } from "../../api/ticketQueries";
import { fetchWorkspaces } from "../../api/workspaceQueries";
import type { MenuItem, Workspace } from "../../types/api";
import { envelope, makeWorkspace, pagination } from "../../test/fixtures";
import { makeNavigation, renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import { followUpViewParams } from "../sales/leadHelpers";
import WorkHubScreen from "./WorkHubScreen";

jest.mock("../../api/followupQueries");
jest.mock("../../api/leadQueries");
jest.mock("../../api/ticketQueries");
jest.mock("../../api/workspaceQueries");

const mockNav = makeNavigation<"Tabs">();
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => mockNav,
}));


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

const VIEW = { view: true, add: false, edit: false, delete: false, reach: "Own" as const };
// Menu rights draw the rows; module access gates the count requests (HUB-01).
const signInWith = (routes: MenuItem[], complaints = true, leads = true) =>
  seedAuth({
    UserId: 7,
    permissions: { rawPermissions: routes },
    access: { modules: { ...(complaints ? { complaints: VIEW } : {}), ...(leads ? { leads: VIEW } : {}) } },
  });

const ws = (Id: number, patch: Partial<Workspace> = {}) => makeWorkspace({ Id, ...patch });

beforeEach(() => {
  jest.mocked(fetchWorkspaces).mockResolvedValue([
    ws(1), ws(2), ws(3), ws(4, { IsArchived: true }), ws(5, { MyInviteStatus: "pending" }),
  ]);
  jest.mocked(fetchTickets).mockResolvedValue(envelope({ tickets: [], pagination: pagination(5) }));
  jest.mocked(fetchLeads).mockResolvedValue(envelope({ leads: [], pagination: pagination(12) }));
  jest.mocked(fetchFollowUps).mockResolvedValue(envelope({ followups: [], pagination: pagination(4) }));
});

it("a role with all three menus sees every module with its live count", async () => {
  signInWith([row("/tasks"), row("/support/tickets"), row("/sales/leads")]);
  await renderWithProviders(<WorkHubScreen />);
  expect(await screen.findByText("3 boards · 1 invite")).toBeOnTheScreen();
  expect(await screen.findByText("5 open")).toBeOnTheScreen();
  expect(screen.getByText("Leads")).toBeOnTheScreen();
  expect(screen.getByText("Follow-ups")).toBeOnTheScreen();
  expect(await screen.findByText("12 yours")).toBeOnTheScreen();
  expect(await screen.findByText("4 due today")).toBeOnTheScreen();
  expect(screen.queryByText("Coming soon")).toBeNull();
  expect(fetchTickets).toHaveBeenCalledWith({ StatusCode: "active", PageSize: 1 });
  expect(fetchLeads).toHaveBeenCalledWith({ OwnerId: 7, PageSize: 1 });
  expect(fetchFollowUps).toHaveBeenCalledWith({ ...followUpViewParams("today"), PageSize: 1 });
});

it("a /sales menu right alone opens both Sales rows", async () => {
  signInWith([row("/sales")]);
  await renderWithProviders(<WorkHubScreen />);
  expect(await screen.findByText("12 yours")).toBeOnTheScreen();
  expect(screen.getByText("Follow-ups")).toBeOnTheScreen();
});

it("does not ask for the sales counts without leads access", async () => {
  signInWith([row("/tasks"), row("/sales/leads")], true, false);
  await renderWithProviders(<WorkHubScreen />);
  expect(await screen.findByText("3 boards · 1 invite")).toBeOnTheScreen();
  expect(screen.getByText("Leads")).toBeOnTheScreen();
  expect(fetchLeads).not.toHaveBeenCalled();
  expect(fetchFollowUps).not.toHaveBeenCalled();
  // No count was asked for, so the row must not claim there is nothing due.
  expect(screen.getByText("Calls and visits to make")).toBeOnTheScreen();
  expect(screen.queryByText("Nothing due today")).toBeNull();
});

it("while the follow-up count is loading the row stays neutral", async () => {
  signInWith([row("/sales")]);
  jest.mocked(fetchFollowUps).mockReturnValue(new Promise(() => {}));
  await renderWithProviders(<WorkHubScreen />);
  expect(await screen.findByText("12 yours")).toBeOnTheScreen();
  expect(screen.getByText("Calls and visits to make")).toBeOnTheScreen();
  expect(screen.queryByText("Nothing due today")).toBeNull();
});

it("a failed follow-up count stays neutral", async () => {
  signInWith([row("/sales")]);
  jest.mocked(fetchFollowUps).mockRejectedValue(new Error("boom"));
  await renderWithProviders(<WorkHubScreen />);
  expect(await screen.findByText("12 yours")).toBeOnTheScreen();
  await waitFor(() => expect(fetchFollowUps).toHaveBeenCalled());
  expect(screen.getByText("Calls and visits to make")).toBeOnTheScreen();
  expect(screen.queryByText("Nothing due today")).toBeNull();
});

it("a task-only role sees only Boards", async () => {
  signInWith([row("/tasks"), row("/sales/leads", false)]);
  await renderWithProviders(<WorkHubScreen />);
  expect(await screen.findByText("3 boards · 1 invite")).toBeOnTheScreen();
  expect(screen.queryByText("Complaints")).toBeNull();
  expect(screen.queryByText("Leads")).toBeNull();
  expect(screen.queryByText("Follow-ups")).toBeNull();
  expect(screen.queryByText("Sales")).toBeNull();
  expect(screen.queryByText("Support")).toBeNull();
});

it("a role with no modules gets the empty state", async () => {
  signInWith([]);
  await renderWithProviders(<WorkHubScreen />);
  expect(await screen.findByText("Nothing here yet")).toBeOnTheScreen();
  expect(screen.queryByText("Boards")).toBeNull();
});

it("falls back to a description when there is nothing to count", async () => {
  signInWith([row("/tasks"), row("/support/tickets"), row("/sales")]);
  jest.mocked(fetchWorkspaces).mockResolvedValue([]);
  jest.mocked(fetchTickets).mockResolvedValue(envelope({ tickets: [], pagination: pagination(0) }));
  jest.mocked(fetchLeads).mockResolvedValue(envelope({ leads: [], pagination: pagination(0) }));
  jest.mocked(fetchFollowUps).mockResolvedValue(envelope({ followups: [], pagination: pagination(0) }));
  await renderWithProviders(<WorkHubScreen />);
  expect(await screen.findByText("Your task workspaces")).toBeOnTheScreen();
  expect(screen.getByText("Log and track customer issues")).toBeOnTheScreen();
  // Only a settled 0 reply may say "Nothing due today".
  expect(await screen.findByText("Nothing due today")).toBeOnTheScreen();
  expect(screen.getByText("Your leads and calls")).toBeOnTheScreen();
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
  await screen.findByText("3 boards · 1 invite");
  await fireEvent.press(screen.getByText("Boards"));
  expect(mockNav.navigate).toHaveBeenLastCalledWith("Boards");
  await fireEvent.press(screen.getByText("Complaints"));
  expect(mockNav.navigate).toHaveBeenLastCalledWith("Complaints");
  await fireEvent.press(screen.getByText("Leads"));
  expect(mockNav.navigate).toHaveBeenLastCalledWith("Leads");
  await fireEvent.press(screen.getByText("Follow-ups"));
  expect(mockNav.navigate).toHaveBeenLastCalledWith("FollowUps");
});

describe("the Boards row's invites and count (WS-14)", () => {
  it("counts pending invites next to boards", async () => {
    signInWith([row("/tasks")]);
    jest.mocked(fetchWorkspaces).mockResolvedValue([
      ws(1),
      ws(2, { MyRole: null, MyInviteStatus: "pending" }),
      ws(3, { MyRole: null, MyInviteStatus: "pending" }),
    ]);
    await renderWithProviders(<WorkHubScreen />);
    expect(await screen.findByText("1 board · 2 invites")).toBeOnTheScreen();
  });

  it("one invite and no boards yet still shows the invite", async () => {
    signInWith([row("/tasks")]);
    jest.mocked(fetchWorkspaces).mockResolvedValue([ws(2, { MyRole: null, MyInviteStatus: "pending" })]);
    await renderWithProviders(<WorkHubScreen />);
    expect(await screen.findByText("Your task workspaces · 1 invite")).toBeOnTheScreen();
  });

  it("boards an admin sees only through the bypass are not counted, as on Boards", async () => {
    signInWith([row("/tasks")]);
    jest.mocked(fetchWorkspaces).mockResolvedValue([ws(1), ws(2, { MyRole: null, MyInviteStatus: null })]);
    await renderWithProviders(<WorkHubScreen />);
    expect(await screen.findByText("1 board")).toBeOnTheScreen();
  });
});

// parity: HUB-01 — a role without complaints must not fire a request that 403s.
it("does not ask for the complaint count without complaints access", async () => {
  signInWith([row("/tasks"), row("/support/tickets")], false);
  await renderWithProviders(<WorkHubScreen />);
  expect(await screen.findByText("3 boards · 1 invite")).toBeOnTheScreen();
  expect(fetchTickets).not.toHaveBeenCalled();
});

// parity: HUB-02 — /support/customers is the customers module (096); it does not open complaints.
it("a customers-only role gets no Complaints row", async () => {
  signInWith([row("/tasks"), row("/support"), row("/support/customers")], false);
  await renderWithProviders(<WorkHubScreen />);
  expect(await screen.findByText("3 boards · 1 invite")).toBeOnTheScreen();
  expect(screen.queryByText("Complaints")).toBeNull();
});
