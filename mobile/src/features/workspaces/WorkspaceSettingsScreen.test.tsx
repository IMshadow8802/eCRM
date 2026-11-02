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
  syncProjectWorkspaceMembers,
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
const gone = member(8, "Gone Gita", "viewer", { InviteStatus: "declined" });

const ravi = { Id: 7, FullName: "Ravi Shah", Username: "ravi", Avatar: null, JobTitle: "Driver" } as DirectoryUser;

const mount = (navigation = makeNavigation<"WorkspaceSettings">()) =>
  renderWithProviders(
    <WorkspaceSettingsScreen navigation={navigation} route={makeRoute("WorkspaceSettings", { workspaceId: WS })} />,
  );

const ok = envelope(null);

beforeEach(() => {
  seedAuth({ UserId: ME });
  jest.mocked(fetchWorkspaces).mockResolvedValue([board("owner")]);
  jest.mocked(fetchWorkspaceMembers).mockResolvedValue([me, asha, pending, gone]);
  jest.mocked(fetchUserDirectory).mockResolvedValue([
    { Id: ME, FullName: "Me Myself" } as DirectoryUser,
    { Id: 5, FullName: "Asha Rao" } as DirectoryUser,
    { Id: 8, FullName: "Gone Gita" } as DirectoryUser,
    ravi,
  ]);
  for (const fn of [addWorkspaceMember, setWorkspaceMemberRole, removeWorkspaceMember, transferWorkspaceOwnership, archiveWorkspace]) {
    jest.mocked(fn).mockResolvedValue(ok);
  }
  jest.mocked(deleteWorkspace).mockResolvedValue(envelope({ taskCount: 3, attachmentCount: 1 }));
  jest.mocked(syncProjectWorkspaceMembers).mockResolvedValue(
    envelope({ workspaceId: WS, membersAddedOrRestored: 2, membersDeactivated: 1 }),
  );
});

it("lists the roster, marking you, pending invites and declined ones (WS-10)", async () => {
  await mount();
  expect(await screen.findByText("Me Myself (you)")).toBeOnTheScreen();
  expect(screen.getByText("Asha Rao")).toBeOnTheScreen();
  expect(screen.getByText("Waiting for reply")).toBeOnTheScreen();
  expect(screen.getByText("Gone Gita")).toBeOnTheScreen();
  expect(screen.getByText("Declined")).toBeOnTheScreen();
  expect(screen.getByText("Site works")).toBeOnTheScreen();
  expect(fetchWorkspaceMembers).toHaveBeenCalledWith({ WorkspaceId: WS });
});

it("a declined member is re-invited, and offered nothing else (WS-10)", async () => {
  await mount();
  await fireEvent.press(await screen.findByText("Gone Gita"));
  expect(screen.queryByText("Change role")).toBeNull();
  expect(screen.queryByText("Remove from board")).toBeNull();
  await fireEvent.press(screen.getByText("Re-invite"));
  await waitFor(() => expect(addWorkspaceMember).toHaveBeenCalled());
  expect(jest.mocked(addWorkspaceMember).mock.calls[0]![0]).toEqual({ WorkspaceId: WS, UserId: 8, Role: "member" });
});

it("Remove is never offered on a pending invite or on yourself (WS-10)", async () => {
  await mount();
  await fireEvent.press(await screen.findByText("Pending Pat"));
  expect(screen.queryByText("Remove from board")).toBeNull();
  await fireEvent.press(screen.getByText("Me Myself (you)"));
  expect(screen.queryByText("Remove from board")).toBeNull();
  expect(screen.queryByText("Re-invite")).toBeNull();
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

it("invites someone not already on the board, as the role picked (WS-06)", async () => {
  await mount();
  await screen.findByText("Asha Rao");
  await fireEvent.press(screen.getByText("Add"));
  // Only Ravi is addable; anyone already on the roster (declined too) is not offered again.
  expect(screen.getByText("Driver")).toBeOnTheScreen();
  expect(screen.getAllByText("Asha Rao")).toHaveLength(1);
  expect(screen.getAllByText("Gone Gita")).toHaveLength(1);
  await fireEvent.press(screen.getByText("Ravi Shah"));
  expect(screen.getByText("Invite Ravi Shah as")).toBeOnTheScreen();
  expect(addWorkspaceMember).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText("Viewer"));
  await waitFor(() => expect(addWorkspaceMember).toHaveBeenCalled());
  expect(jest.mocked(addWorkspaceMember).mock.calls[0]![0]).toEqual({ WorkspaceId: WS, UserId: 7, Role: "viewer" });
});

it("a refused invite says why", async () => {
  jest.mocked(addWorkspaceMember).mockRejectedValue(new Error("Already invited"));
  await mount();
  await screen.findByText("Asha Rao");
  await fireEvent.press(screen.getByText("Add"));
  await fireEvent.press(screen.getByText("Ravi Shah"));
  await fireEvent.press(screen.getByText("Manager"));
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

it("a manager may manage members but not transfer, archive or delete (WS-02)", async () => {
  jest.mocked(fetchWorkspaces).mockResolvedValue([board("manager")]);
  await mount();
  await fireEvent.press(await screen.findByText("Asha Rao"));
  expect(screen.getByText("Add")).toBeOnTheScreen();
  expect(screen.getByText("Change role")).toBeOnTheScreen();
  expect(screen.queryByText("Make owner")).toBeNull();
  // sp_ArchiveWorkspace / sp_DeleteWorkspace are owner-or-admin only.
  expect(screen.queryByText("Archive board")).toBeNull();
  expect(screen.queryByText("Delete board")).toBeNull();
  // A manager is not the owner, so they may leave.
  expect(screen.getByText("Leave board")).toBeOnTheScreen();
});

it("a member sees the roster read-only", async () => {
  jest.mocked(fetchWorkspaces).mockResolvedValue([board("member")]);
  await mount();
  await fireEvent.press(await screen.findByText("Asha Rao"));
  // Rows are disabled, so no member sheet opens.
  expect(screen.queryByText("Change role")).toBeNull();
  expect(screen.queryByText("Add")).toBeNull();
  expect(screen.queryByText("Archive board")).toBeNull();
  expect(screen.queryByText("Sync members from team")).toBeNull();
  expect(screen.queryByLabelText("Rename this board")).toBeNull();
});

it("a member leaves the board after confirming (WS-05)", async () => {
  jest.mocked(fetchWorkspaces).mockResolvedValue([board("member")]);
  const navigation = makeNavigation<"WorkspaceSettings">();
  await mount(navigation);
  await fireEvent.press(await screen.findByText("Leave board"));
  expect(removeWorkspaceMember).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText("Leave"));
  await waitFor(() => expect(removeWorkspaceMember).toHaveBeenCalled());
  expect(jest.mocked(removeWorkspaceMember).mock.calls[0]![0]).toEqual({ WorkspaceId: WS, UserId: ME });
  await waitFor(() => expect(navigation.navigate).toHaveBeenCalledWith("Boards"));
});

it("a refused leave says why and keeps you here; cancel does nothing", async () => {
  jest.mocked(fetchWorkspaces).mockResolvedValue([board("viewer")]);
  jest.mocked(removeWorkspaceMember).mockRejectedValue(new Error("Cannot leave"));
  const navigation = makeNavigation<"WorkspaceSettings">();
  await mount(navigation);
  await fireEvent.press(await screen.findByText("Leave board"));
  await fireEvent.press(screen.getByText("Cancel"));
  expect(removeWorkspaceMember).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText("Leave board"));
  await fireEvent.press(screen.getByText("Leave"));
  expect(await screen.findByText("Cannot leave")).toBeOnTheScreen();
  expect(navigation.navigate).not.toHaveBeenCalled();
});

it("the owner cannot leave their own board", async () => {
  await mount();
  await screen.findByText("Asha Rao");
  expect(screen.queryByText("Leave board")).toBeNull();
});

describe("an admin who is not on the board (WS-07)", () => {
  beforeEach(() => {
    seedAuth({ UserId: ME, access: { isAdmin: true } });
    jest.mocked(fetchWorkspaces).mockResolvedValue([board(null, { MyInviteStatus: null })]);
  });

  it("manages members, transfers, and archives a shared board — but has nothing to leave", async () => {
    await mount();
    await fireEvent.press(await screen.findByText("Asha Rao"));
    expect(screen.getByText("Add")).toBeOnTheScreen();
    expect(screen.getByText("Change role")).toBeOnTheScreen();
    expect(screen.getByText("Make owner")).toBeOnTheScreen();
    expect(screen.getByText("Archive board")).toBeOnTheScreen();
    expect(screen.queryByText("Leave board")).toBeNull();
  });

  it("gets no bypass on a personal board", async () => {
    jest.mocked(fetchWorkspaces).mockResolvedValue([board(null, { Type: "personal", MyInviteStatus: null })]);
    await mount();
    expect(await screen.findByText(/Personal boards are yours alone/)).toBeOnTheScreen();
    expect(screen.queryByText("Archive board")).toBeNull();
  });
});

it("admin comes from access, never from the login-time user.IsAdmin (WS-07)", async () => {
  seedAuth({ UserId: ME, user: { IsAdmin: true } });
  jest.mocked(fetchWorkspaces).mockResolvedValue([board(null, { MyInviteStatus: null })]);
  await mount();
  await fireEvent.press(await screen.findByText("Asha Rao"));
  expect(screen.queryByText("Change role")).toBeNull();
  expect(screen.queryByText("Add")).toBeNull();
  expect(screen.queryByText("Archive board")).toBeNull();
});

describe("a project board (WS-09)", () => {
  beforeEach(() => {
    jest.mocked(fetchWorkspaces).mockResolvedValue([board("manager", { Type: "project" })]);
  });

  it("syncs its members from the team and says what changed", async () => {
    await mount();
    await fireEvent.press(await screen.findByText("Sync members from team"));
    await waitFor(() => expect(syncProjectWorkspaceMembers).toHaveBeenCalledWith({ WorkspaceId: WS }));
    expect(await screen.findByText("2 added, 1 removed")).toBeOnTheScreen();
  });

  it("a refused sync says why", async () => {
    jest.mocked(syncProjectWorkspaceMembers).mockRejectedValue(new Error("No team linked"));
    await mount();
    await fireEvent.press(await screen.findByText("Sync members from team"));
    expect(await screen.findByText("No team linked")).toBeOnTheScreen();
  });
});

it("a shared board has no team to sync from", async () => {
  await mount();
  await screen.findByText("Asha Rao");
  expect(screen.queryByText("Sync members from team")).toBeNull();
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

it("an owner archives an active board; Delete waits until it is archived (WS-03)", async () => {
  await mount();
  expect(await screen.findByText("Archive the board first to delete it.")).toBeOnTheScreen();
  expect(screen.queryByText("Delete board")).toBeNull();
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
