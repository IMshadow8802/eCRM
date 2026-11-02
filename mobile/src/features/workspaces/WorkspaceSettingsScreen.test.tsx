import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { fetchUserDirectory } from "../../api/userQueries";
import {
  addWorkspaceMember,
  archiveWorkspace,
  deleteWorkspace,
  fetchWorkspaceMembers,
  fetchWorkspaces,
  removeWorkspaceMember,
  setWorkspaceMemberRole,
  transferWorkspaceOwnership,
} from "../../api/workspaceQueries";
import type { DirectoryUser, Workspace, WorkspaceMember, WorkspaceRole } from "../../types/api";
import { envelope } from "../../test/fixtures";
import { makeNavigation, makeRoute, renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import WorkspaceSettingsScreen from "./WorkspaceSettingsScreen";

jest.mock("../../api/workspaceQueries");
jest.mock("../../api/userQueries");

const ME = 42;
const WS = 9;

const board = (MyRole: WorkspaceRole | null, patch: Partial<Workspace> = {}) =>
  ({ Id: WS, Name: "Site works", Type: "shared", MyRole, IsArchived: false, ...patch }) as Workspace;

const member = (UserId: number, FullName: string, Role: WorkspaceRole, patch: Partial<WorkspaceMember> = {}) =>
  ({ UserId, FullName, Role, InviteStatus: "active", Avatar: null, Username: null, ...patch }) as WorkspaceMember;

const me = member(ME, "Me Myself", "owner");
const asha = member(5, "Asha Rao", "member");
const pending = member(6, "Pending Pat", "member", { InviteStatus: "pending" });

const ravi = { Id: 7, FullName: "Ravi Shah", Username: "ravi", Avatar: null, JobTitle: "Driver" } as DirectoryUser;

const mount = (navigation = makeNavigation<"WorkspaceSettings">()) =>
  renderWithProviders(
    <WorkspaceSettingsScreen navigation={navigation} route={makeRoute("WorkspaceSettings", { workspaceId: WS })} />,
  );

const ok = envelope(null);

beforeEach(() => {
  seedAuth({ UserId: ME });
  jest.mocked(fetchWorkspaces).mockResolvedValue([board("owner")]);
  jest.mocked(fetchWorkspaceMembers).mockResolvedValue([me, asha, pending]);
  jest.mocked(fetchUserDirectory).mockResolvedValue([
    { Id: ME, FullName: "Me Myself" } as DirectoryUser,
    { Id: 5, FullName: "Asha Rao" } as DirectoryUser,
    ravi,
  ]);
  for (const fn of [addWorkspaceMember, setWorkspaceMemberRole, removeWorkspaceMember, transferWorkspaceOwnership, archiveWorkspace]) {
    jest.mocked(fn).mockResolvedValue(ok);
  }
  jest.mocked(deleteWorkspace).mockResolvedValue(envelope({ taskCount: 3, attachmentCount: 1 }));
});

it("lists the roster, marking you and pending invites", async () => {
  await mount();
  expect(await screen.findByText("Me Myself (you)")).toBeOnTheScreen();
  expect(screen.getByText("Asha Rao")).toBeOnTheScreen();
  expect(screen.getByText("Invite pending")).toBeOnTheScreen();
  expect(screen.getByText("Site works")).toBeOnTheScreen();
  expect(fetchWorkspaceMembers).toHaveBeenCalledWith({ WorkspaceId: WS });
  // parity: WS-10 — declined rows are hidden today and should be shown; not pinned.
});

it("an owner changes a member's role", async () => {
  await mount();
  await fireEvent.press(await screen.findByText("Asha Rao"));
  await fireEvent.press(screen.getByText("Change role"));
  await fireEvent.press(screen.getByText("Viewer"));
  await waitFor(() => expect(setWorkspaceMemberRole).toHaveBeenCalled());
  expect(jest.mocked(setWorkspaceMemberRole).mock.calls[0]![0]).toEqual({ WorkspaceId: WS, UserId: 5, Role: "viewer" });
});

it("a refused role change says why", async () => {
  jest.mocked(setWorkspaceMemberRole).mockRejectedValue(new Error("Only the owner can do that"));
  await mount();
  await fireEvent.press(await screen.findByText("Asha Rao"));
  await fireEvent.press(screen.getByText("Change role"));
  await fireEvent.press(screen.getByText("Manager"));
  expect(await screen.findByText("Only the owner can do that")).toBeOnTheScreen();
});

it("an owner removes an active member", async () => {
  await mount();
  await fireEvent.press(await screen.findByText("Asha Rao"));
  await fireEvent.press(screen.getByText("Remove from board"));
  await waitFor(() => expect(removeWorkspaceMember).toHaveBeenCalled());
  expect(jest.mocked(removeWorkspaceMember).mock.calls[0]![0]).toEqual({ WorkspaceId: WS, UserId: 5 });
});

it("an owner hands ownership to an active member", async () => {
  await mount();
  await fireEvent.press(await screen.findByText("Asha Rao"));
  await fireEvent.press(screen.getByText("Make owner"));
  await waitFor(() => expect(transferWorkspaceOwnership).toHaveBeenCalled());
  expect(jest.mocked(transferWorkspaceOwnership).mock.calls[0]![0]).toEqual({ WorkspaceId: WS, NewOwnerUserId: 5 });
});

it("ownership is never offered for a pending invite", async () => {
  await mount();
  await fireEvent.press(await screen.findByText("Pending Pat"));
  expect(screen.getByText("Change role")).toBeOnTheScreen();
  expect(screen.queryByText("Make owner")).toBeNull();
});

it("invites someone not already on the board", async () => {
  await mount();
  await screen.findByText("Asha Rao");
  await fireEvent.press(screen.getByText("Add"));
  // Only Ravi is addable; members already on the board are not offered again.
  expect(screen.getByText("Driver")).toBeOnTheScreen();
  expect(screen.getAllByText("Asha Rao")).toHaveLength(1);
  await fireEvent.press(screen.getByText("Ravi Shah"));
  await waitFor(() => expect(addWorkspaceMember).toHaveBeenCalled());
  // parity: WS-06 — the invite's role is fixed to member today; not pinned.
  expect(jest.mocked(addWorkspaceMember).mock.calls[0]![0]).toEqual(
    expect.objectContaining({ WorkspaceId: WS, UserId: 7 }),
  );
});

it("a refused invite says why", async () => {
  jest.mocked(addWorkspaceMember).mockRejectedValue(new Error("Already invited"));
  await mount();
  await screen.findByText("Asha Rao");
  await fireEvent.press(screen.getByText("Add"));
  await fireEvent.press(screen.getByText("Ravi Shah"));
  expect(await screen.findByText("Already invited")).toBeOnTheScreen();
});

it("a refused remove and a refused transfer each say why", async () => {
  jest.mocked(removeWorkspaceMember).mockRejectedValue(new Error("Cannot remove"));
  jest.mocked(transferWorkspaceOwnership).mockRejectedValue(new Error("Cannot transfer"));
  await mount();
  await fireEvent.press(await screen.findByText("Asha Rao"));
  await fireEvent.press(screen.getByText("Remove from board"));
  expect(await screen.findByText("Cannot remove")).toBeOnTheScreen();
  // Asha is still the selected member.
  await fireEvent.press(screen.getByText("Make owner"));
  expect(await screen.findByText("Cannot transfer")).toBeOnTheScreen();
});

it("a manager may manage members but not transfer ownership", async () => {
  jest.mocked(fetchWorkspaces).mockResolvedValue([board("manager")]);
  await mount();
  await fireEvent.press(await screen.findByText("Asha Rao"));
  expect(screen.getByText("Add")).toBeOnTheScreen();
  expect(screen.getByText("Change role")).toBeOnTheScreen();
  expect(screen.queryByText("Make owner")).toBeNull();
  // parity: WS-02, WS-03 — the manager's Archive/Delete rows are wrong today; not pinned.
});

it("a member sees the roster read-only", async () => {
  jest.mocked(fetchWorkspaces).mockResolvedValue([board("member")]);
  await mount();
  await fireEvent.press(await screen.findByText("Asha Rao"));
  // Rows are disabled, so no member sheet opens.
  expect(screen.queryByText("Change role")).toBeNull();
  expect(screen.queryByText("Add")).toBeNull();
  expect(screen.queryByText("Archive board")).toBeNull();
  expect(screen.queryByLabelText("Rename this board")).toBeNull();
  // parity: WS-05 — "Leave board" does not exist yet.
});

it("a personal board explains itself instead of a roster", async () => {
  jest.mocked(fetchWorkspaces).mockResolvedValue([board("owner", { Type: "personal" })]);
  await mount();
  expect(await screen.findByText(/Personal boards are yours alone/)).toBeOnTheScreen();
  expect(screen.queryByText("Add")).toBeNull();
  expect(screen.queryByText("Asha Rao")).toBeNull();
});

it("an empty roster says so", async () => {
  jest.mocked(fetchWorkspaceMembers).mockResolvedValue([]);
  await mount();
  expect(await screen.findByText("Nobody on this board yet.")).toBeOnTheScreen();
});

it("the rename shortcut opens the form for this board", async () => {
  const navigation = makeNavigation<"WorkspaceSettings">();
  await mount(navigation);
  await screen.findByText("Asha Rao");
  await fireEvent.press(screen.getByLabelText("Rename this board"));
  expect(navigation.navigate).toHaveBeenCalledWith("WorkspaceForm", { workspaceId: WS });
});

it("an owner archives an active board", async () => {
  await mount();
  await fireEvent.press(await screen.findByText("Archive board"));
  await waitFor(() => expect(archiveWorkspace).toHaveBeenCalled());
  expect(jest.mocked(archiveWorkspace).mock.calls[0]![0]).toEqual({ WorkspaceId: WS, IsArchived: true });
});

it("a refused archive says why", async () => {
  jest.mocked(archiveWorkspace).mockRejectedValue(new Error("Only the owner"));
  await mount();
  await fireEvent.press(await screen.findByText("Archive board"));
  expect(await screen.findByText("Only the owner")).toBeOnTheScreen();
});

describe("an archived board", () => {
  beforeEach(() => {
    jest.mocked(fetchWorkspaces).mockResolvedValue([board("owner", { IsArchived: true })]);
  });

  it("is restored by the owner", async () => {
    await mount();
    await fireEvent.press(await screen.findByText("Restore board"));
    await waitFor(() => expect(archiveWorkspace).toHaveBeenCalled());
    expect(jest.mocked(archiveWorkspace).mock.calls[0]![0]).toEqual({ WorkspaceId: WS, IsArchived: false });
  });

  it("is deleted only after a dry run shows what goes with it", async () => {
    const navigation = makeNavigation<"WorkspaceSettings">();
    await mount(navigation);
    await fireEvent.press(await screen.findByText("Delete board"));
    expect(await screen.findByText(/3 tasks and 1 file will be destroyed\./)).toBeOnTheScreen();
    expect(jest.mocked(deleteWorkspace).mock.calls[0]![0]).toEqual({ WorkspaceId: WS, DryRun: true });
    await fireEvent.press(screen.getByText("Delete"));
    await waitFor(() => expect(deleteWorkspace).toHaveBeenCalledTimes(2));
    expect(jest.mocked(deleteWorkspace).mock.calls[1]![0]).toEqual({ WorkspaceId: WS });
    await waitFor(() => expect(navigation.navigate).toHaveBeenCalledWith("Boards"));
  });

  it("an empty board's dry run says nothing else goes", async () => {
    jest.mocked(deleteWorkspace).mockResolvedValue(envelope({ taskCount: 0, attachmentCount: 0 }));
    await mount();
    await fireEvent.press(await screen.findByText("Delete board"));
    expect(await screen.findByText(/It is empty — nothing else goes with it\./)).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Cancel"));
    expect(screen.queryByText(/It is empty/)).toBeNull();
    expect(deleteWorkspace).toHaveBeenCalledTimes(1);
  });

  it("one task and two files read naturally", async () => {
    jest.mocked(deleteWorkspace).mockResolvedValue(envelope({ taskCount: 1, attachmentCount: 2 }));
    await mount();
    await fireEvent.press(await screen.findByText("Delete board"));
    expect(await screen.findByText(/1 task and 2 files will be destroyed\./)).toBeOnTheScreen();
  });

  it("a failed dry run or delete says why", async () => {
    jest.mocked(deleteWorkspace).mockRejectedValueOnce(new Error("Dry run failed"));
    await mount();
    await fireEvent.press(await screen.findByText("Delete board"));
    expect(await screen.findByText("Dry run failed")).toBeOnTheScreen();
    jest.mocked(deleteWorkspace)
      .mockResolvedValueOnce(envelope({ taskCount: 0, attachmentCount: 0 }))
      .mockRejectedValueOnce(new Error("Delete refused"));
    await fireEvent.press(screen.getByText("Delete board"));
    await fireEvent.press(await screen.findByText("Delete"));
    expect(await screen.findByText("Delete refused")).toBeOnTheScreen();
  });
});
