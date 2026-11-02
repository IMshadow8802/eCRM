import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { fetchWorkspaces, respondInvite } from "../../api/workspaceQueries";
import type { Workspace } from "../../types/api";
import { envelope } from "../../test/fixtures";
import { makeNavigation, makeRoute, renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import BoardsScreen from "./BoardsScreen";

jest.mock("../../api/workspaceQueries");

// Lists arm VirtualizedList's 50 ms batch timer on every data change; under
// load it fired between waitFor polls, outside act(). Fake timers park it
// (RNTL's waitFor/findBy advance them).
jest.useFakeTimers();

const ws = (patch: Partial<Workspace>) =>
  ({
    Type: "shared",
    IsArchived: false,
    MyRole: "member",
    MyInviteStatus: "active",
    MemberCount: 2,
    ...patch,
  }) as Workspace;

const mine = ws({ Id: 1, Name: "Ops board", MyRole: "owner" });
const other = ws({ Id: 2, Name: "Sales board" });
const invite = ws({ Id: 3, Name: "Secret project", MyInviteStatus: "pending", MyRole: null });
const archived = ws({ Id: 4, Name: "Old board", IsArchived: true });

const mount = (navigation = makeNavigation<"Boards">()) =>
  renderWithProviders(<BoardsScreen navigation={navigation} route={makeRoute("Boards", undefined)} />);

beforeEach(() => {
  seedAuth({ UserId: 42 });
  jest.mocked(fetchWorkspaces).mockResolvedValue([mine, other, invite, archived]);
  jest.mocked(respondInvite).mockResolvedValue(envelope(null));
});

it("lists joined boards and an invitations block, and keeps archived boards out of the active list", async () => {
  await mount();
  expect(await screen.findByText("Ops board")).toBeOnTheScreen();
  expect(screen.getByText("Sales board")).toBeOnTheScreen();
  expect(screen.getByText("Invitations")).toBeOnTheScreen();
  expect(screen.getByText("Secret project")).toBeOnTheScreen();
  // Archived and pending boards are not counted as boards you are in.
  expect(screen.getByText("2 boards · 1 invite")).toBeOnTheScreen();
  // WS-04: sp_FetchWorkspaces drops archived rows unless asked for them.
  expect(fetchWorkspaces).toHaveBeenCalledWith(expect.objectContaining({ IncludeArchived: true }));
  expect(screen.getByText("Archived")).toBeOnTheScreen();
  expect(screen.getByText("Old board")).toBeOnTheScreen();
  // WS-15: the SP returns no role for a pending row, so the card claims none.
  expect(screen.queryByText(/Invited as/)).toBeNull();
  expect(screen.getByText(/Decline hides the invite for good/)).toBeOnTheScreen();
});

it("an archived board opens its settings, where it is restored or deleted (WS-04)", async () => {
  const navigation = makeNavigation<"Boards">();
  await mount(navigation);
  await fireEvent.press(await screen.findByText("Old board"));
  expect(navigation.navigate).toHaveBeenCalledWith("WorkspaceSettings", { workspaceId: 4 });
});

it("boards an admin sees without being a member get their own read-only section (WS-08)", async () => {
  const adminOnly = ws({ Id: 5, Name: "Their board", MyRole: null, MyInviteStatus: null });
  jest.mocked(fetchWorkspaces).mockResolvedValue([mine, adminOnly]);
  const navigation = makeNavigation<"Boards">();
  await mount(navigation);
  expect(await screen.findByText("Admin view (read-only)")).toBeOnTheScreen();
  // Only boards you are in count as yours.
  expect(screen.getByText("1 board")).toBeOnTheScreen();
  await fireEvent.press(screen.getByText("Their board"));
  expect(navigation.navigate).toHaveBeenCalledWith("Board", { workspaceId: 5, name: "Their board" });
});

it("accepting an invite answers the server", async () => {
  await mount();
  await fireEvent.press(await screen.findByText("Accept"));
  await waitFor(() => expect(respondInvite).toHaveBeenCalled());
  expect(jest.mocked(respondInvite).mock.calls[0]![0]).toEqual({ WorkspaceId: 3, Action: "accept" });
});

it("declining an invite answers the server", async () => {
  await mount();
  await fireEvent.press(await screen.findByText("Decline"));
  await waitFor(() => expect(respondInvite).toHaveBeenCalled());
  expect(jest.mocked(respondInvite).mock.calls[0]![0]).toEqual({ WorkspaceId: 3, Action: "decline" });
});

it("a refused invite answer shows the server's reason", async () => {
  jest.mocked(respondInvite).mockRejectedValue(new Error("Invite no longer valid"));
  await mount();
  await fireEvent.press(await screen.findByText("Accept"));
  expect(await screen.findByText("Invite no longer valid")).toBeOnTheScreen();
});

it("a board tap opens it; the FAB opens a blank form", async () => {
  const navigation = makeNavigation<"Boards">();
  await mount(navigation);
  await fireEvent.press(await screen.findByText("Ops board"));
  expect(navigation.navigate).toHaveBeenCalledWith("Board", { workspaceId: 1, name: "Ops board" });
  await fireEvent.press(screen.getByLabelText("Create a board"));
  expect(navigation.navigate).toHaveBeenLastCalledWith("WorkspaceForm", {});
});

it("one board, no invites: singular subtitle, no invitations block", async () => {
  jest.mocked(fetchWorkspaces).mockResolvedValue([mine]);
  await mount();
  expect(await screen.findByText("1 board")).toBeOnTheScreen();
  expect(screen.queryByText("Invitations")).toBeNull();
});

it("no boards: the empty state offers to create one", async () => {
  jest.mocked(fetchWorkspaces).mockResolvedValue([]);
  const navigation = makeNavigation<"Boards">();
  await mount(navigation);
  expect(await screen.findByText("No boards yet")).toBeOnTheScreen();
  await fireEvent.press(screen.getByText("Create a board"));
  expect(navigation.navigate).toHaveBeenCalledWith("WorkspaceForm", {});
});

it("a failed fetch says so", async () => {
  jest.mocked(fetchWorkspaces).mockRejectedValue(new Error("boom"));
  await mount();
  expect(await screen.findByText("Couldn't load your boards")).toBeOnTheScreen();
});
