import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { fetchTaskById, saveTask } from "../../api/taskQueries";
import { fetchWorkspaceMembers, fetchWorkspaces } from "../../api/workspaceQueries";
import type { WorkspaceMember } from "../../types/api";
import { assigneesJson, envelope, makeTask, makeWorkspace, serverError } from "../../test/fixtures";
import { makeNavigation, makeRoute, renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import TaskFormScreen from "./TaskFormScreen";

jest.mock("../../api/taskQueries");
jest.mock("../../api/workspaceQueries");

const ME = 42;

const member = (UserId: number, FullName: string, patch: Partial<WorkspaceMember> = {}): WorkspaceMember => ({
  Id: UserId,
  WorkspaceId: 10,
  UserId,
  Role: "member",
  AddedByUserId: null,
  JoinedDate: "2026-10-01",
  IsActive: true,
  InviteStatus: "active",
  InvitedDate: null,
  RespondedDate: null,
  FullName,
  Username: null,
  Avatar: null,
  Email: null,
  ...patch,
});

const MEMBERS = [
  member(5, "Asha Rao"),
  member(6, "Pending Pal", { InviteStatus: "pending" }),
  member(7, "Viewer Vik", { Role: "viewer" }),
  member(8, "Gone Gita", { IsActive: false }),
  member(9, "", { FullName: null, Username: "ravi.k" }),
];

type Params = { workspaceId: number; taskId?: number; columnId?: number | null };
const mount = async (params: Params = { workspaceId: 10, columnId: 100 }) => {
  const navigation = makeNavigation<"TaskForm">();
  await renderWithProviders(<TaskFormScreen navigation={navigation} route={makeRoute("TaskForm", params)} />);
  return navigation;
};

/** The body of the last saveTask call (useMutation passes a context second). */
const sent = () => jest.mocked(saveTask).mock.calls.at(-1)?.[0];

/** The form is ready once the board type is known — the submit button waits for it. */
const ready = (label: string) =>
  waitFor(() => expect(screen.getByRole("button", { name: label })).toBeEnabled());

beforeEach(() => {
  seedAuth({ UserId: ME });
  jest.mocked(fetchWorkspaces).mockResolvedValue([makeWorkspace({ Id: 10, Type: "shared" })]);
  jest.mocked(fetchWorkspaceMembers).mockResolvedValue(MEMBERS);
  jest.mocked(saveTask).mockResolvedValue(envelope({ taskId: 77 }));
});

describe("create", () => {
  it("sends a new task with its steps, assignee and the tapped column", async () => {
    const navigation = await mount();
    await ready("Create task");

    await fireEvent.changeText(screen.getByPlaceholderText("What needs doing?"), "  Fit the inverter  ");
    await fireEvent.changeText(screen.getByPlaceholderText("Any detail worth keeping"), "Sector 4 ");
    await fireEvent.changeText(screen.getByPlaceholderText("Step 1"), "Order parts");
    await fireEvent.press(screen.getByText("Add step"));
    await fireEvent.changeText(screen.getByPlaceholderText("Step 2"), "  ");
    await fireEvent.press(screen.getByText("Asha Rao"));
    await fireEvent.press(screen.getByText("High"));
    await fireEvent.press(screen.getByText("Bug"));
    await fireEvent.changeText(screen.getByPlaceholderText("0"), "2.5");
    await fireEvent.press(screen.getByText("Select a date"));
    // The native picker is a plain View in jest; its change event carries the date.
    const picker = screen.container.queryAll((n) => n.props.mode === "date")[0]!;
    await fireEvent(picker, "change", { type: "set" }, new Date(2026, 10, 20));
    await fireEvent.press(screen.getByText("Create task"));

    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(sent()).toMatchObject({
        Id: 0,
        Title: "Fit the inverter",
        Description: "Sector 4",
        WorkspaceId: 10,
        ColumnId: 100,
        AssigneeIds: [5],
        Priority: "high",
        Type: "bug",
        DueDate: "2026-11-20",
        EstimatedHours: 2.5,
        LoggedHours: 0,
        Progress: 0,
        ParentTaskId: null,
        // Blank steps are dropped; completion is derived from what is left.
        ChecklistItems: ["Order parts"],
    });
  });

  it("offers only active, non-viewer members as assignees", async () => {
    await mount();
    await ready("Create task");
    expect(screen.getByText("Asha Rao")).toBeOnTheScreen();
    expect(screen.getByText("ravi.k")).toBeOnTheScreen();
    expect(screen.queryByText("Pending Pal")).toBeNull();
    expect(screen.queryByText("Viewer Vik")).toBeNull();
    expect(screen.queryByText("Gone Gita")).toBeNull();
  });

  it("falls back to 'User n' for a member with no name at all", async () => {
    jest.mocked(fetchWorkspaceMembers).mockResolvedValue([member(11, "", { FullName: null })]);
    await mount();
    expect(await screen.findByText("User 11")).toBeOnTheScreen();
  });

  it("on a personal board hides the picker and assigns the owner", async () => {
    jest.mocked(fetchWorkspaces).mockResolvedValue([makeWorkspace({ Id: 10, Type: "personal" })]);
    await mount({ workspaceId: 10 });
    await ready("Create task");
    expect(screen.queryByText("Assignees")).toBeNull();

    await fireEvent.changeText(screen.getByPlaceholderText("What needs doing?"), "Call bank");
    await fireEvent.changeText(screen.getByPlaceholderText("Step 1"), "Dial");
    await fireEvent.press(screen.getByText("Create task"));
    await waitFor(() => expect(saveTask).toHaveBeenCalled());
    // No column param: the server puts it in the first column.
    expect(sent()).toMatchObject({ AssigneeIds: [ME], ColumnId: null });
  });

  it("needs a title", async () => {
    await mount();
    await ready("Create task");
    await fireEvent.changeText(screen.getByPlaceholderText("Step 1"), "Dial");
    await fireEvent.press(screen.getByText("Create task"));
    expect(screen.getByText("A task needs a title.")).toBeOnTheScreen();
    expect(saveTask).not.toHaveBeenCalled();
  });

  it("needs at least one step, because the checklist is what completes it", async () => {
    await mount();
    await ready("Create task");
    await fireEvent.changeText(screen.getByPlaceholderText("What needs doing?"), "Call bank");
    await fireEvent.press(screen.getByText("Create task"));
    expect(screen.getByText(/Add at least one step/)).toBeOnTheScreen();
    expect(saveTask).not.toHaveBeenCalled();
  });

  it("removing steps never leaves the form without a step row", async () => {
    await mount();
    await ready("Create task");
    await fireEvent.press(screen.getByText("Add step"));
    await fireEvent.changeText(screen.getByPlaceholderText("Step 2"), "Second");
    await fireEvent.press(screen.getByLabelText("Remove step 1"));
    expect(screen.getByDisplayValue("Second")).toBeOnTheScreen();
    expect(screen.queryByPlaceholderText("Step 2")).toBeNull();

    await fireEvent.press(screen.getByLabelText("Remove step 1"));
    expect(screen.getByPlaceholderText("Step 1")).toHaveDisplayValue("");
  });

  it("shows the server's sentence when it refuses, and keeps what was typed", async () => {
    jest.mocked(saveTask).mockRejectedValue(serverError(400, "Assignee is not a member of this board"));
    const navigation = await mount();
    await ready("Create task");
    await fireEvent.changeText(screen.getByPlaceholderText("What needs doing?"), "Call bank");
    await fireEvent.changeText(screen.getByPlaceholderText("Step 1"), "Dial");
    await fireEvent.press(screen.getByText("Create task"));

    expect(await screen.findByText("Assignee is not a member of this board")).toBeOnTheScreen();
    expect(screen.getByDisplayValue("Call bank")).toBeOnTheScreen();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it("a network failure gets the connection sentence", async () => {
    jest.mocked(saveTask).mockRejectedValue(new Error("Network Error"));
    await mount();
    await ready("Create task");
    await fireEvent.changeText(screen.getByPlaceholderText("What needs doing?"), "Call bank");
    await fireEvent.changeText(screen.getByPlaceholderText("Step 1"), "Dial");
    await fireEvent.press(screen.getByText("Create task"));
    expect(await screen.findByText("Could not save this task. Check your connection.")).toBeOnTheScreen();
  });

  it("an unsuccessful envelope shows its message, or a fallback", async () => {
    jest.mocked(saveTask).mockResolvedValueOnce(envelope({ taskId: 0 }, { success: false, message: "Board is archived" }));
    jest.mocked(saveTask).mockResolvedValueOnce(envelope({ taskId: 0 }, { success: false, message: "" }));
    const navigation = await mount();
    await ready("Create task");
    await fireEvent.changeText(screen.getByPlaceholderText("What needs doing?"), "Call bank");
    await fireEvent.changeText(screen.getByPlaceholderText("Step 1"), "Dial");
    await fireEvent.press(screen.getByText("Create task"));
    expect(await screen.findByText("Board is archived")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Create task"));
    expect(await screen.findByText("Could not save this task.")).toBeOnTheScreen();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });
});

describe("edit", () => {
  const existing = makeTask({
    Id: 9,
    Title: "Fit the inverter",
    Description: "Sector 4",
    WorkspaceName: "Ops board",
    Priority: "urgent",
    Type: "feature",
    DueDate: "2026-11-20T00:00:00",
    EstimatedHours: 3,
    LoggedHours: 1.5,
    Progress: 40,
    ParentTaskId: 3,
    ProjectId: 4,
    TeamId: 5,
    IsBlocked: true,
    Labels: "site",
    Watchers: "1,2",
    AssigneesJson: assigneesJson([5, "Asha Rao"]),
  });

  it("starts from the task and re-sends every column it does not edit", async () => {
    jest.mocked(fetchTaskById).mockResolvedValue(existing);
    // Opened from a board column: an edit still never sends one (moving is the Move action).
    const navigation = await mount({ workspaceId: 10, taskId: 9, columnId: 100 });
    await ready("Save changes");

    expect(fetchTaskById).toHaveBeenCalledWith(9);
    expect(screen.getByDisplayValue("Fit the inverter")).toBeOnTheScreen();
    expect(screen.getByDisplayValue("3")).toBeOnTheScreen();
    // The checklist is the detail screen's job once the task exists.
    expect(screen.queryByText("Add step")).toBeNull();

    await fireEvent.changeText(screen.getByDisplayValue("Fit the inverter"), "Fit two inverters");
    await fireEvent.press(screen.getByText("Save changes"));

    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    // parity: TASK-02 — DueTime/TatMinutes are not sent yet; Phase B adds them.
    expect(sent()).toMatchObject({
        Id: 9,
        Title: "Fit two inverters",
        ColumnId: null,
        AssigneeIds: [5],
        Priority: "urgent",
        Type: "feature",
        DueDate: "2026-11-20",
        EstimatedHours: 3,
        ParentTaskId: 3,
        ProjectId: 4,
        TeamId: 5,
        LoggedHours: 1.5,
        Progress: 40,
        IsBlocked: true,
        Labels: "site",
        Watchers: "1,2",
        ChecklistItems: null,
    });
  });

  it("a task with no due date or estimate edits to the same", async () => {
    jest.mocked(fetchTaskById).mockResolvedValue(makeTask({ Id: 9, Title: "Bare", Priority: null, Type: null }));
    await mount({ workspaceId: 10, taskId: 9 });
    await ready("Save changes");
    await fireEvent.press(screen.getByText("Save changes"));
    await waitFor(() => expect(saveTask).toHaveBeenCalled());
    expect(sent()).toMatchObject({ DueDate: null, EstimatedHours: 0, Priority: "medium", Type: "task", AssigneeIds: [] });
  });

  it("a task that is gone says so, with a way back", async () => {
    jest.mocked(fetchTaskById).mockResolvedValue(null);
    const navigation = await mount({ workspaceId: 10, taskId: 9 });
    expect(await screen.findByText("Task not available")).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText("Go back"));
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it("a failed load offers a retry", async () => {
    jest.mocked(fetchTaskById).mockRejectedValueOnce(new Error("boom")).mockResolvedValue(existing);
    await mount({ workspaceId: 10, taskId: 9 });
    await fireEvent.press(await screen.findByText("Try again"));
    expect(await screen.findByDisplayValue("Fit the inverter")).toBeOnTheScreen();
  });
});
