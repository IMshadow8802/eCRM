import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import Constants from "expo-constants";

import { logout } from "../../api/authQueries";
import { fetchTasks } from "../../api/taskQueries";
import { changeMyPassword, updateMyProfile } from "../../api/userQueries";
import { fetchWorkspaces } from "../../api/workspaceQueries";
import useAuthStore from "../../stores/useAuthStore";
import type { Company } from "../../types/api";
import { assigneesJson, envelope, makeTask, makeWorkspace, pagination, serverError } from "../../test/fixtures";
import { makeNavigation, makeRoute, renderWithProviders, seedAuth as seed } from "../../test/renderWithProviders";
import MeScreen from "./MeScreen";

// Profile's work counts need tasks:view (Task 32 review). Most tests here are
// about a task user, so that is the default; a test passing `access` overrides it.
const TASKS_VIEW = { tasks: { view: true, add: false, edit: false, delete: false, reach: "Own" as const } };
const seedAuth = (patch: Parameters<typeof seed>[0] = {}) => seed({ access: { modules: TASKS_VIEW }, ...patch });

jest.mock("../../api/authQueries");
jest.mock("../../api/taskQueries");
jest.mock("../../api/userQueries");
jest.mock("../../api/workspaceQueries");
// The build's version: in jest there is no native manifest, so pin one. Only
// `expoConfig` is replaced (its getter is not configurable, so no spyOn);
// expo-asset reads the rest of Constants at import.
const mockExpo: { config: Partial<NonNullable<typeof Constants.expoConfig>> | null } = { config: null };
jest.mock("expo-constants", () => {
  const actual = jest.requireActual("expo-constants");
  return {
    ...actual,
    __esModule: true,
    default: new Proxy(actual.default, {
      get: (target, key) => (key === "expoConfig" ? mockExpo.config : Reflect.get(target, key)),
    }),
  };
});
beforeEach(() => {
  mockExpo.config = { version: "1.0.1", ios: { buildNumber: "20261102" } };
});

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

// Same rule as Boards' "Your boards": a board seen only through the admin bypass is not yours.
it("does not count boards an admin sees only through the bypass", async () => {
  seedAuth({ user: { Id: 7, FullName: "Asha" } });
  jest.mocked(fetchWorkspaces).mockResolvedValue([
    makeWorkspace({ Id: 1 }),
    makeWorkspace({ Id: 2, MyRole: null, MyInviteStatus: null }),
  ]);
  await renderWithProviders(<MeScreen />);
  await waitFor(() => expect(statTile("Boards")).toHaveTextContent(/^1\s*Boards$/));
});

// parity: ME-03 — the footer reads the build's version, not a hardcoded "v1.0.0".
it("shows the app version and build from the build's config", async () => {
  seedAuth({ user: { Id: 7, FullName: "Asha" } });
  await renderWithProviders(<MeScreen />);
  expect(screen.getByText("Nexus CRM · v1.0.1 (20261102)")).toBeOnTheScreen();
  await waitFor(() => expect(fetchWorkspaces).toHaveBeenCalled());
});

it("without a build config the footer names the app only", async () => {
  mockExpo.config = null;
  seedAuth({ user: { Id: 7, FullName: "Asha" } });
  await renderWithProviders(<MeScreen />);
  expect(screen.getByText("Nexus CRM")).toBeOnTheScreen();
  await waitFor(() => expect(fetchWorkspaces).toHaveBeenCalled());
});

// parity: ME-01 — edit own profile, as the web's AccountModal.
describe("Edit profile", () => {
  const asha = { Id: 7, FullName: "Asha Patel", Email: "asha@x.in", Mobile: "9825012345", Avatar: "color:violet", Username: "asha" };

  it("sends all four fields, cleaned, and updates who is signed in", async () => {
    jest.mocked(updateMyProfile).mockResolvedValue(envelope({}));
    seedAuth({ user: asha });
    await renderWithProviders(<MeScreen />);
    await fireEvent.press(screen.getByText("Edit profile"));

    expect(screen.getByLabelText("Display name")).toHaveDisplayValue("Asha Patel");
    await fireEvent.changeText(screen.getByLabelText("Display name"), "  Asha P  ");
    await fireEvent.changeText(screen.getByLabelText("Mobile"), "+91 98250 99999");
    await fireEvent.press(screen.getByLabelText("Icon rocket"));
    await fireEvent.press(screen.getByLabelText("Colour blue"));
    await fireEvent.press(screen.getByText("Save profile"));

    const sent = { FullName: "Asha P", Email: "asha@x.in", Mobile: "9825099999", Avatar: "icon:rocket|blue" };
    await waitFor(() => expect(updateMyProfile).toHaveBeenCalledWith(sent));
    expect(await screen.findByText("Profile updated")).toBeOnTheScreen();
    expect(useAuthStore.getState().user).toMatchObject(sent);
    // Back to the read-only view, showing the new values.
    expect(screen.queryByText("Save profile")).toBeNull();
    expect(screen.getByText("9825099999")).toBeOnTheScreen();
  });

  it("blank email and mobile go as null; a colour alone gives coloured initials", async () => {
    jest.mocked(updateMyProfile).mockResolvedValue(envelope({}));
    seedAuth({ user: { ...asha, Avatar: null } });
    await renderWithProviders(<MeScreen />);
    await fireEvent.press(screen.getByText("Edit profile"));
    await fireEvent.changeText(screen.getByLabelText("Email"), "  ");
    await fireEvent.changeText(screen.getByLabelText("Mobile"), "");
    await fireEvent.press(screen.getByLabelText("Colour green"));
    await fireEvent.press(screen.getByText("Save profile"));
    await waitFor(() =>
      expect(updateMyProfile).toHaveBeenCalledWith({ FullName: "Asha Patel", Email: null, Mobile: null, Avatar: "color:green" }),
    );
  });

  it("refuses a blank name or a mobile that is not ten digits, without a request", async () => {
    seedAuth({ user: asha });
    await renderWithProviders(<MeScreen />);
    await fireEvent.press(screen.getByText("Edit profile"));
    await fireEvent.changeText(screen.getByLabelText("Mobile"), "12345");
    await fireEvent.press(screen.getByText("Save profile"));
    expect(await screen.findByText("A mobile number is ten digits.")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText("Mobile"), "9825012345");
    await fireEvent.changeText(screen.getByLabelText("Display name"), " ");
    await fireEvent.press(screen.getByText("Save profile"));
    expect(await screen.findByText("Your name cannot be blank.")).toBeOnTheScreen();
    expect(updateMyProfile).not.toHaveBeenCalled();
  });

  it("shows the server's reason and keeps the form open", async () => {
    jest.mocked(updateMyProfile).mockRejectedValue(serverError(409, "Mobile already in use"));
    seedAuth({ user: asha });
    await renderWithProviders(<MeScreen />);
    await fireEvent.press(screen.getByText("Edit profile"));
    await fireEvent.press(screen.getByText("Save profile"));
    expect(await screen.findByText("Mobile already in use")).toBeOnTheScreen();
    expect(screen.getByText("Save profile")).toBeOnTheScreen();
    expect(useAuthStore.getState().user?.FullName).toBe("Asha Patel");
  });

  it("cancel leaves the profile as it was", async () => {
    seedAuth({ user: asha });
    await renderWithProviders(<MeScreen />);
    await fireEvent.press(screen.getByText("Edit profile"));
    await fireEvent.changeText(screen.getByLabelText("Display name"), "Someone else");
    await fireEvent.press(screen.getByText("Cancel"));
    expect(screen.getByText("Asha Patel")).toBeOnTheScreen();
    expect(updateMyProfile).not.toHaveBeenCalled();
  });
});

// parity: ME-01 — change own password: at least 6 characters (userController.js:434), typed twice.
describe("Change password", () => {
  const fill = async (current: string, next: string, confirm: string) => {
    await fireEvent.changeText(screen.getByLabelText("Current password"), current);
    await fireEvent.changeText(screen.getByLabelText("New password"), next);
    await fireEvent.changeText(screen.getByLabelText("Confirm new password"), confirm);
    await fireEvent.press(screen.getByText("Save password"));
  };

  it("checks length and the confirm before asking the server, then changes it", async () => {
    jest.mocked(changeMyPassword).mockResolvedValue(envelope({}));
    seedAuth({ user: { Id: 7, FullName: "Asha" } });
    await renderWithProviders(<MeScreen />);
    await fireEvent.press(screen.getByText("Change password"));

    await fill("old-fixture", "short", "short");
    expect(await screen.findByText("At least 6 characters.")).toBeOnTheScreen();
    await fill("old-fixture", "new-fixture", "new-fixturX");
    expect(await screen.findByText("The two new passwords do not match.")).toBeOnTheScreen();
    expect(changeMyPassword).not.toHaveBeenCalled();

    await fill("old-fixture", "new-fixture", "new-fixture");
    await waitFor(() =>
      expect(changeMyPassword).toHaveBeenCalledWith({ CurrentPassword: "old-fixture", NewPassword: "new-fixture" }),
    );
    expect(await screen.findByText("Password changed")).toBeOnTheScreen();
    expect(screen.queryByText("Save password")).toBeNull();
  });

  it("needs the current password", async () => {
    seedAuth({ user: { Id: 7, FullName: "Asha" } });
    await renderWithProviders(<MeScreen />);
    await fireEvent.press(screen.getByText("Change password"));
    await fill("", "new-fixture", "new-fixture");
    expect(await screen.findByText("Enter your current password.")).toBeOnTheScreen();
    expect(changeMyPassword).not.toHaveBeenCalled();
  });

  it("shows the server's reason when the current password is wrong", async () => {
    jest.mocked(changeMyPassword).mockRejectedValue(serverError(401, "Current password is incorrect"));
    seedAuth({ user: { Id: 7, FullName: "Asha" } });
    await renderWithProviders(<MeScreen />);
    await fireEvent.press(screen.getByText("Change password"));
    await fill("wrong-fixture", "new-fixture", "new-fixture");
    expect(await screen.findByText("Current password is incorrect")).toBeOnTheScreen();
    expect(screen.getByText("Save password")).toBeOnTheScreen();
  });
});

// Task 32: Profile moved under More and is pushed on the stack.
it("pushed from More, its back button goes back", async () => {
  seedAuth();
  const navigation = makeNavigation<"Me">();
  await renderWithProviders(<MeScreen navigation={navigation} route={makeRoute("Me", undefined)} />);
  expect(screen.getByText("Profile")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Go back" }));
  expect(navigation.goBack).toHaveBeenCalled();
});

// Task 32 review: Profile is reachable by every role from More; a role without
// tasks must not fire task/workspace requests that only 403.
it("without the tasks module: no work counts and no task requests", async () => {
  seedAuth({
    user: { Id: 7, FullName: "Asha" },
    access: { modules: { complaints: { view: true, add: false, edit: false, delete: false, reach: "Own" } } },
  });
  await renderWithProviders(<MeScreen />);
  expect(screen.getByText("Asha")).toBeOnTheScreen();
  expect(screen.queryByText("Assigned")).toBeNull();
  expect(screen.queryByText("Boards")).toBeNull();
  expect(fetchTasks).not.toHaveBeenCalled();
  expect(fetchWorkspaces).not.toHaveBeenCalled();
});
