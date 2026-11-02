import { fireEvent, screen, waitFor, within } from "@testing-library/react-native";

import { fetchTasks } from "../../api/taskQueries";
import { fetchUserDirectory } from "../../api/userQueries";
import { fetchWorkspaceMembers, fetchWorkspaces, respondInvite } from "../../api/workspaceQueries";
import type { DirectoryUser, Workspace, WorkspaceMember } from "../../types/api";
import { envelope, makeTask, pagination } from "../../test/fixtures";
import { makeNavigation, makeRoute, renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import { PHONE, setWindow } from "../../test/window";
import BoardsScreen from "./BoardsScreen";

jest.mock("../../api/taskQueries");
jest.mock("../../api/userQueries");
jest.mock("../../api/workspaceQueries");

jest.useFakeTimers();

const ws = (patch: Partial<Workspace>) =>
  ({ Type: "shared", IsArchived: false, MyRole: "member", MyInviteStatus: "active", MemberCount: 2, OwnerUserId: 42, ...patch }) as Workspace;

const personal = ws({ Id: 1, Name: "Ayush's Tasks", Type: "personal", MyRole: "owner", MemberCount: 1 });
const sales = ws({ Id: 2, Name: "Sales Ops", MyRole: "manager", MemberCount: 6 });
const project = ws({ Id: 5, Name: "Website Revamp", Type: "project" });
const invite = ws({ Id: 3, Name: "Diwali Dealer Push", MyInviteStatus: "pending", MyRole: null, OwnerUserId: 77 });
const archived = ws({ Id: 4, Name: "Old board", IsArchived: true });
const member = (UserId: number, FullName: string, InviteStatus: "active" | "pending" = "active") =>
  ({ UserId, FullName, InviteStatus, Avatar: null }) as WorkspaceMember;

const mount = (navigation = makeNavigation<"Boards">()) =>
  renderWithProviders(<BoardsScreen navigation={navigation} route={makeRoute("Boards", undefined)} />);

beforeEach(() => {
  setWindow(...PHONE);
  seedAuth({ UserId: 42 });
  jest.mocked(fetchWorkspaces).mockResolvedValue([personal, sales, project, invite, archived]);
  jest.mocked(respondInvite).mockResolvedValue(envelope(null));
  jest.mocked(fetchTasks).mockResolvedValue(
    envelope({ tasks: [1, 1, 1, 1, 2, 2].map((WorkspaceId, i) => makeTask({ Id: i + 1, WorkspaceId })), pagination: pagination(6) }),
  );
  jest.mocked(fetchWorkspaceMembers).mockImplementation(async ({ WorkspaceId }) =>
    WorkspaceId === 2 ? [member(1, "Ayush Mishra"), member(2, "Ravi Kumar"), member(3, "Neha Kapoor"), member(4, "Sita Ram"), member(5, "Om Pal"), member(6, "Pending Guy", "pending")] : [],
  );
  jest.mocked(fetchUserDirectory).mockResolvedValue([{ Id: 77, FullName: "Neha Kapoor" } as DirectoryUser]);
});

it("06: the band (back, Workspaces, + New, search) and a count of the boards I am in", async () => {
  const navigation = makeNavigation<"Boards">();
  await mount(navigation);
  expect(screen.getByRole("header", { name: "Workspaces" })).toBeOnTheScreen();
  expect(await screen.findByText("3 workspaces")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "New workspace" }));
  expect(navigation.navigate).toHaveBeenLastCalledWith("WorkspaceForm", {});
  await fireEvent.press(screen.getByRole("button", { name: "Go back" }));
  expect(navigation.goBack).toHaveBeenCalled();
  // WS-04: archived rows only come when asked for.
  expect(fetchWorkspaces).toHaveBeenCalledWith(expect.objectContaining({ IncludeArchived: true }));
});

it("rows: kind pill and E's meta per kind (G4), members on team boards (G5)", async () => {
  await mount();
  expect(await screen.findByText("Only you · 4 open")).toBeOnTheScreen();
  expect(screen.getByText("6 members · 2 open · manager")).toBeOnTheScreen();
  expect(screen.getByText("Team from project · 0 open")).toBeOnTheScreen();
  const row = screen.getByRole("button", { name: "Sales Ops" });
  expect(within(row).getByText("Shared")).toBeOnTheScreen();
  // Five active members: three shown, "+2"; the pending one is not on the board yet.
  await waitFor(() => expect(within(row).getByLabelText("5 people")).toBeOnTheScreen());
  expect(within(row).getByText("+2")).toBeOnTheScreen();
  expect(within(screen.getByRole("button", { name: "Ayush's Tasks" })).getByText("Personal")).toBeOnTheScreen();
  expect(fetchWorkspaceMembers).not.toHaveBeenCalledWith({ WorkspaceId: 1 });
});

it("invitations: 'from' the owner (G6), Accept and a visible Decline (§7.5)", async () => {
  await mount();
  expect(await screen.findByText("Invitations · 1")).toBeOnTheScreen();
  expect(await screen.findByText("Shared · from Neha Kapoor")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Accept Diwali Dealer Push" }));
  await waitFor(() => expect(respondInvite).toHaveBeenCalledTimes(1));
  expect(jest.mocked(respondInvite).mock.calls[0]![0]).toEqual({ WorkspaceId: 3, Action: "accept" });
  await fireEvent.press(screen.getByRole("button", { name: "Decline Diwali Dealer Push" }));
  await waitFor(() => expect(respondInvite).toHaveBeenCalledTimes(2));
  expect(jest.mocked(respondInvite).mock.calls[1]![0]).toEqual({ WorkspaceId: 3, Action: "decline" });
});

it("an unknown owner leaves the invite line at its kind", async () => {
  jest.mocked(fetchUserDirectory).mockResolvedValue([]);
  await mount();
  expect(await screen.findByText("Invitations · 1")).toBeOnTheScreen();
  await waitFor(() => expect(fetchUserDirectory).toHaveBeenCalled());
  expect(screen.queryByText(/ · from /)).toBeNull();
});

it("a refused invite answer shows the server's reason", async () => {
  jest.mocked(respondInvite).mockRejectedValue(new Error("Invite no longer valid"));
  await mount();
  await fireEvent.press(await screen.findByRole("button", { name: "Accept Diwali Dealer Push" }));
  expect(await screen.findByText("Invite no longer valid")).toBeOnTheScreen();
});

it("the footnote says who can see what", async () => {
  await mount();
  expect(await screen.findByText("Personal workspaces are private, even from admins. Shared ones need the invite accepted.")).toBeOnTheScreen();
});

it("a board opens; an archived one opens its settings (WS-04)", async () => {
  const navigation = makeNavigation<"Boards">();
  await mount(navigation);
  await fireEvent.press(await screen.findByText("Sales Ops"));
  expect(navigation.navigate).toHaveBeenCalledWith("Board", { workspaceId: 2, name: "Sales Ops" });
  expect(screen.getByText("Archived")).toBeOnTheScreen();
  await fireEvent.press(screen.getByText("Old board"));
  expect(navigation.navigate).toHaveBeenLastCalledWith("WorkspaceSettings", { workspaceId: 4 });
});

it("boards an admin sees without being a member get their own read-only group (WS-08)", async () => {
  const adminOnly = ws({ Id: 6, Name: "Their board", MyRole: null, MyInviteStatus: null });
  jest.mocked(fetchWorkspaces).mockResolvedValue([sales, adminOnly]);
  await mount();
  expect(await screen.findByText("Admin view (read-only)")).toBeOnTheScreen();
  expect(screen.getByText("1 workspace")).toBeOnTheScreen();
});

it("search narrows the list by name, and says when nothing matches", async () => {
  await mount();
  await screen.findByText("Sales Ops");
  await fireEvent.changeText(screen.getByLabelText("Search workspaces"), "sales");
  expect(screen.getByText("1 workspace")).toBeOnTheScreen();
  expect(screen.queryByText("Ayush's Tasks")).toBeNull();
  await fireEvent.changeText(screen.getByLabelText("Search workspaces"), "zzz");
  expect(screen.getByText("No matches")).toBeOnTheScreen();
});

it("no boards: the empty state offers to create one", async () => {
  jest.mocked(fetchWorkspaces).mockResolvedValue([]);
  const navigation = makeNavigation<"Boards">();
  await mount(navigation);
  expect(await screen.findByText("No boards yet")).toBeOnTheScreen();
  await fireEvent.press(screen.getByText("Create a board"));
  expect(navigation.navigate).toHaveBeenCalledWith("WorkspaceForm", {});
});

it("a failed fetch shows the error card; Try again asks again", async () => {
  jest.mocked(fetchWorkspaces).mockRejectedValueOnce(new Error("boom"));
  await mount();
  expect(await screen.findByText("Could not load. Try again")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Sales Ops")).toBeOnTheScreen();
});

it("while the task counts load, rows show no count rather than 0", async () => {
  jest.mocked(fetchTasks).mockReturnValue(new Promise(() => {}));
  await mount();
  expect(await screen.findByText("Only you")).toBeOnTheScreen();
});
