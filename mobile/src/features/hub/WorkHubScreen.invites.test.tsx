// WS-14 only — the rest of the hub is covered in WorkHubScreen.test.tsx.
import { screen } from "@testing-library/react-native";

import { fetchTickets } from "../../api/ticketQueries";
import { fetchWorkspaces } from "../../api/workspaceQueries";
import type { MenuItem } from "../../types/api";
import { envelope, makeWorkspace, pagination } from "../../test/fixtures";
import { makeNavigation, renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import WorkHubScreen from "./WorkHubScreen";

jest.mock("../../api/ticketQueries");
jest.mock("../../api/workspaceQueries");

const mockNavigation = makeNavigation<"Tabs">();
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => mockNavigation,
}));

const tasksMenu = {
  route: "/tasks",
  permissions: { canView: true, canAdd: false, canEdit: false, canDelete: false },
} as MenuItem;

beforeEach(() => {
  seedAuth({ permissions: { rawPermissions: [tasksMenu] } });
  jest.mocked(fetchTickets).mockResolvedValue(envelope({ tickets: [], pagination: pagination(0) }));
});

it("the Boards row counts pending invites next to boards", async () => {
  jest.mocked(fetchWorkspaces).mockResolvedValue([
    makeWorkspace({ Id: 1 }),
    makeWorkspace({ Id: 2, MyRole: null, MyInviteStatus: "pending" }),
    makeWorkspace({ Id: 3, MyRole: null, MyInviteStatus: "pending" }),
  ]);
  await renderWithProviders(<WorkHubScreen />);
  expect(await screen.findByText("1 board · 2 invites")).toBeOnTheScreen();
});

it("one invite and no boards yet still shows the invite", async () => {
  jest.mocked(fetchWorkspaces).mockResolvedValue([
    makeWorkspace({ Id: 2, MyRole: null, MyInviteStatus: "pending" }),
  ]);
  await renderWithProviders(<WorkHubScreen />);
  expect(await screen.findByText("Your task workspaces · 1 invite")).toBeOnTheScreen();
});
