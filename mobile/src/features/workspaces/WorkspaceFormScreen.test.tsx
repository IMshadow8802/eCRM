import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { fetchUserDirectory } from "../../api/userQueries";
import { fetchWorkspaces, saveWorkspace } from "../../api/workspaceQueries";
import type { DirectoryUser, Workspace } from "../../types/api";
import { envelope } from "../../test/fixtures";
import { makeNavigation, makeRoute, renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import WorkspaceFormScreen from "./WorkspaceFormScreen";

jest.mock("../../api/workspaceQueries");
jest.mock("../../api/userQueries");

const asha = { Id: 5, FullName: "Asha Rao", Username: "asha", Avatar: null, JobTitle: "Site lead" } as DirectoryUser;
const ravi = { Id: 6, FullName: "Ravi Shah", Username: "ravi", Avatar: null, JobTitle: null } as DirectoryUser;

const existing = {
  Id: 9,
  Name: "Site works",
  Type: "shared",
  Color: "#abcdef",
  Icon: "hammer",
  TeamId: 3,
  ProjectId: null,
  IsArchived: false,
  MyRole: "owner",
} as Workspace;

const mount = (params: { workspaceId?: number } = {}, navigation = makeNavigation<"WorkspaceForm">()) =>
  renderWithProviders(
    <WorkspaceFormScreen navigation={navigation} route={makeRoute("WorkspaceForm", params)} />,
  );

beforeEach(() => {
  seedAuth();
  jest.mocked(fetchUserDirectory).mockResolvedValue([asha, ravi]);
  jest.mocked(fetchWorkspaces).mockResolvedValue([existing]);
  jest.mocked(saveWorkspace).mockResolvedValue(envelope({ workspaceId: 12 }));
});

it("creates a shared board with the people picked as invites, then goes back", async () => {
  const navigation = makeNavigation<"WorkspaceForm">();
  await mount({}, navigation);
  expect(screen.getByText("New board")).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByPlaceholderText("Client onboarding"), "  Plant visit  ");
  await fireEvent.press(await screen.findByText("Asha Rao"));
  await fireEvent.press(screen.getByText("Create board"));
  await waitFor(() => expect(saveWorkspace).toHaveBeenCalled());
  expect(jest.mocked(saveWorkspace).mock.calls[0]![0]).toEqual({
    Id: 0,
    Name: "Plant visit",
    Type: "shared",
    TeamId: null,
    ProjectId: null,
    Color: null,
    Icon: null,
    Members: [5],
    TemplateKey: "basic",
  });
  await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
  // A shared board reads the directory for its invites; creating loads no existing board.
  expect(fetchUserDirectory).toHaveBeenCalled();
  expect(fetchWorkspaces).not.toHaveBeenCalled();
});

it("a new board starts from the column template picked (WS-12)", async () => {
  await mount();
  await fireEvent.changeText(screen.getByPlaceholderText("Client onboarding"), "Sprint 4");
  await fireEvent.press(screen.getByText("Scrum"));
  await fireEvent.press(screen.getByText("Create board"));
  await waitFor(() => expect(saveWorkspace).toHaveBeenCalled());
  expect(jest.mocked(saveWorkspace).mock.calls[0]![0]).toEqual(
    expect.objectContaining({ Name: "Sprint 4", TemplateKey: "scrum" }),
  );
});

it("a personal board sends no invites and hides the picker", async () => {
  await mount();
  await fireEvent.changeText(screen.getByPlaceholderText("Client onboarding"), "My list");
  await fireEvent.press(await screen.findByText("Asha Rao"));
  await fireEvent.press(screen.getByText("Personal"));
  expect(screen.queryByText("Who should join?")).toBeNull();
  await fireEvent.press(screen.getByText("Create board"));
  await waitFor(() => expect(saveWorkspace).toHaveBeenCalled());
  expect(jest.mocked(saveWorkspace).mock.calls[0]![0]).toEqual(
    expect.objectContaining({ Name: "My list", Type: "personal", Members: [] }),
  );
});

it("a blank name is refused before any request", async () => {
  await mount();
  await fireEvent.changeText(screen.getByPlaceholderText("Client onboarding"), "   ");
  await fireEvent.press(screen.getByText("Create board"));
  expect(screen.getByText("Give the board a name.")).toBeOnTheScreen();
  expect(saveWorkspace).not.toHaveBeenCalled();
});

it("a success:false reply shows its message and stays", async () => {
  jest.mocked(saveWorkspace).mockResolvedValue(
    envelope({ workspaceId: 0 }, { success: false, message: "Name already used" }),
  );
  const navigation = makeNavigation<"WorkspaceForm">();
  await mount({}, navigation);
  await fireEvent.changeText(screen.getByPlaceholderText("Client onboarding"), "Dup");
  await fireEvent.press(screen.getByText("Create board"));
  expect(await screen.findByText("Name already used")).toBeOnTheScreen();
  expect(navigation.goBack).not.toHaveBeenCalled();
});

it("a success:false reply without a message gets the fallback", async () => {
  jest.mocked(saveWorkspace).mockResolvedValue(envelope({ workspaceId: 0 }, { success: false, message: "" }));
  await mount();
  await fireEvent.changeText(screen.getByPlaceholderText("Client onboarding"), "Dup");
  await fireEvent.press(screen.getByText("Create board"));
  expect(await screen.findByText("Could not save this workspace.")).toBeOnTheScreen();
});

it("a rejected save shows the reason", async () => {
  jest.mocked(saveWorkspace).mockRejectedValue(new Error("Not allowed"));
  await mount();
  await fireEvent.changeText(screen.getByPlaceholderText("Client onboarding"), "X");
  await fireEvent.press(screen.getByText("Create board"));
  expect(await screen.findByText("Not allowed")).toBeOnTheScreen();
});

it("renaming keeps Color and Icon and never re-sends invites", async () => {
  await mount({ workspaceId: 9 });
  expect(await screen.findByDisplayValue("Site works")).toBeOnTheScreen();
  expect(screen.getByText("Rename board")).toBeOnTheScreen();
  // Kind is fixed after creation, and an edit has no invite list.
  expect(screen.queryByText("Kind")).toBeNull();
  expect(screen.queryByText("Invite")).toBeNull();
  await fireEvent.changeText(screen.getByDisplayValue("Site works"), "Site works 2");
  await fireEvent.press(screen.getByText("Save changes"));
  await waitFor(() => expect(saveWorkspace).toHaveBeenCalled());
  // WS-01: sp_SaveWorkspace writes TeamId/ProjectId on update, so they travel back.
  expect(jest.mocked(saveWorkspace).mock.calls[0]![0]).toEqual(
    expect.objectContaining({ Id: 9, Name: "Site works 2", Type: "shared", Color: "#abcdef", Icon: "hammer", TeamId: 3, ProjectId: null, Members: [] }),
  );
  expect(fetchWorkspaces).toHaveBeenCalledWith(expect.objectContaining({ IncludeArchived: true }));
  expect(fetchUserDirectory).not.toHaveBeenCalled();
  // Templates seed columns on create only; an edit offers none and sends none.
  expect(screen.queryByText("Scrum")).toBeNull();
  expect(jest.mocked(saveWorkspace).mock.calls[0]![0]).not.toHaveProperty("TemplateKey");
});

it("renaming a project board re-sends its ProjectId (WS-01)", async () => {
  jest.mocked(fetchWorkspaces).mockResolvedValue([{ ...existing, Type: "project", TeamId: null, ProjectId: 77 }]);
  await mount({ workspaceId: 9 });
  await fireEvent.changeText(await screen.findByDisplayValue("Site works"), "Site works 3");
  await fireEvent.press(screen.getByText("Save changes"));
  await waitFor(() => expect(saveWorkspace).toHaveBeenCalled());
  expect(jest.mocked(saveWorkspace).mock.calls[0]![0]).toEqual(
    expect.objectContaining({ Id: 9, Type: "project", TeamId: null, ProjectId: 77 }),
  );
});

it("an edit whose board fails to load offers a retry", async () => {
  jest.mocked(fetchWorkspaces).mockRejectedValue(new Error("boom"));
  await mount({ workspaceId: 9 });
  expect(await screen.findByText("Could not load this")).toBeOnTheScreen();
  jest.mocked(fetchWorkspaces).mockResolvedValue([existing]);
  await fireEvent.press(screen.getByText("Try again"));
  expect(await screen.findByDisplayValue("Site works")).toBeOnTheScreen();
});
