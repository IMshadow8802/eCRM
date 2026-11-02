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
  // parity: WS-04 — the list is fetched without IncludeArchived, so a real
  // server never returns this row; only where it would land is pinned here.
  expect(screen.getByText("Archived")).toBeOnTheScreen();
  expect(screen.getByText("Old board")).toBeOnTheScreen();
  // parity: WS-15 — "Invited as …" claims a role the SP never returns; not pinned.
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
