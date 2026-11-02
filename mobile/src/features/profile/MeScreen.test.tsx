import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { logout } from "../../api/authQueries";
import { fetchTasks } from "../../api/taskQueries";
import { fetchWorkspaces } from "../../api/workspaceQueries";
import useAuthStore from "../../stores/useAuthStore";
import type { Company } from "../../types/api";
import { assigneesJson, envelope, makeTask, makeWorkspace, pagination } from "../../test/fixtures";
import { renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import MeScreen from "./MeScreen";

jest.mock("../../api/authQueries");
jest.mock("../../api/taskQueries");
jest.mock("../../api/workspaceQueries");

// parity: ME-01 — no edit-profile / change-password UI yet; only display + sign out are tested.
// parity: ME-03 — the "v1.0.0" footer is hardcoded; not asserted.


beforeEach(() => {
  jest.mocked(logout).mockResolvedValue(envelope({}));
  jest.mocked(fetchTasks).mockResolvedValue(
    envelope({
      tasks: [
        makeTask({ Id: 1, AssignedToUserId: 7, IsCompleted: true }),
        makeTask({ Id: 2, AssigneesJson: assigneesJson([7, "Asha"]) }),
        makeTask({ Id: 3, AssignedToUserId: 99, IsCompleted: true }),
      ],
      pagination: pagination(3),
    }),
  );
  jest.mocked(fetchWorkspaces).mockResolvedValue([
    makeWorkspace({ Id: 1 }),
    makeWorkspace({ Id: 2, IsArchived: true }),
    makeWorkspace({ Id: 3, MyInviteStatus: "pending" }),
  ]);
});

// A stat tile reads "<value><label>"; anchored so a neighbouring tile cannot satisfy it.
const statTile = (label: string) => screen.getByText(label).parent;

it("shows who is signed in, their account details and their work counts", async () => {
  seedAuth({
    user: { Id: 7, FullName: "Asha Patel", JobTitle: "Field engineer", Email: "asha@x.in", Mobile: "9825012345", Username: "asha" },
    access: { isAdmin: true },
  });
  useAuthStore.setState({ company: { CompName: "PRD Infotech" } as Company });
  await renderWithProviders(<MeScreen />);

  expect(screen.getByText("Asha Patel")).toBeOnTheScreen();
  expect(screen.getByText("Field engineer")).toBeOnTheScreen();
  expect(screen.getByText("Administrator")).toBeOnTheScreen();
  expect(screen.getByText("asha@x.in")).toBeOnTheScreen();
  expect(screen.getByText("9825012345")).toBeOnTheScreen();
  expect(screen.getByText("asha")).toBeOnTheScreen();
  expect(screen.getByText("PRD Infotech")).toBeOnTheScreen();

  // Tasks 1 + 2 are Asha's (mirror column + JSON list), one done; one live board.
  await waitFor(() => expect(statTile("Assigned")).toHaveTextContent(/^2\s*Assigned$/));
  expect(statTile("Completed")).toHaveTextContent(/^1\s*Completed$/);
  expect(statTile("Boards")).toHaveTextContent(/^1\s*Boards$/);
  expect(fetchTasks).toHaveBeenCalledWith({ WorkspaceId: null, PageSize: 200 });
});

// CLAUDE.md §3: IsAdmin is read from the server's access, never from the login-time user.
it("the admin badge follows access, not the user record", async () => {
  seedAuth({ user: { Id: 7, FullName: "Asha", IsAdmin: true } });
  await renderWithProviders(<MeScreen />);
  await waitFor(() => expect(fetchWorkspaces).toHaveBeenCalled());
  expect(screen.queryByText("Administrator")).toBeNull();
});

it("leaves out the rows a user has no value for", async () => {
  seedAuth({ user: { Id: 7, FullName: "Ravi", Email: null, Mobile: null, JobTitle: null, Username: "ravi" } });
  jest.mocked(fetchTasks).mockResolvedValue(envelope({ tasks: [], pagination: pagination(0) }));
  jest.mocked(fetchWorkspaces).mockResolvedValue([]);
  await renderWithProviders(<MeScreen />);
  expect(screen.getByText("Ravi")).toBeOnTheScreen();
  expect(screen.getByText("ravi")).toBeOnTheScreen();
  for (const label of ["Email", "Mobile", "Company", "Administrator"]) {
    expect(screen.queryByText(label)).toBeNull();
  }
  await waitFor(() => expect(fetchWorkspaces).toHaveBeenCalled());
});

it("signs out only after the confirm, and clears the session", async () => {
  seedAuth({ user: { Id: 7, FullName: "Asha" } });
  await renderWithProviders(<MeScreen />);
  await fireEvent.press(screen.getByText("Sign out"));
  expect(await screen.findByText("Sign out?")).toBeOnTheScreen();
  expect(useAuthStore.getState().isAuthenticated).toBe(true);

  // The dialog's confirm is the second "Sign out" on screen.
  const buttons = screen.getAllByText("Sign out");
  await fireEvent.press(buttons[buttons.length - 1]!);
  await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(false));
  expect(logout).toHaveBeenCalledTimes(1);
});

it("cancelling the confirm keeps the user signed in", async () => {
  seedAuth({ user: { Id: 7, FullName: "Asha" } });
  await renderWithProviders(<MeScreen />);
  await fireEvent.press(screen.getByText("Sign out"));
  await fireEvent.press(await screen.findByText("Cancel"));
  await waitFor(() => expect(screen.queryByText("Sign out?")).toBeNull());
  expect(logout).not.toHaveBeenCalled();
  expect(useAuthStore.getState().isAuthenticated).toBe(true);
});

it("shows a dash when no user is loaded", async () => {
  seedAuth();
  useAuthStore.setState({ user: null });
  await renderWithProviders(<MeScreen />);
  expect(screen.getByText("—")).toBeOnTheScreen();
  await waitFor(() => expect(fetchWorkspaces).toHaveBeenCalled());
});
