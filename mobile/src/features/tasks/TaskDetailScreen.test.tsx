// The detail screen's read side and its checklist. Menu actions, comments and
// time are in TaskDetailScreen.actions.test.tsx.
import { fireEvent, screen, waitFor, within } from "@testing-library/react-native";

import { fetchAttachments } from "../../api/attachmentQueries";
import { fetchLookups } from "../../api/configQueries";
import { fetchKanbanColumns } from "../../api/kanbanQueries";
import { fetchTaskTat } from "../../api/tatQueries";
import {
  deleteTaskChecklist,
  fetchTaskById,
  fetchTaskDependencies,
  fetchTasks,
  getTaskActivity,
  getTaskChecklist,
  getTaskComments,
  getTaskTimeEntries,
  saveTaskChecklist,
} from "../../api/taskQueries";
import { fetchWorkspaces } from "../../api/workspaceQueries";
import type { Task, TaskChecklistItem, Workspace } from "../../types/api";
import { assigneesJson, envelope, localDay, makeTask, makeWorkspace, pagination, serverError } from "../../test/fixtures";
import { makeNavigation, makeRoute, renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import { spySheets } from "../../test/sheets";
import TaskDetailScreen from "./TaskDetailScreen";

jest.mock("../../api/taskQueries");
jest.mock("../../api/attachmentQueries");
jest.mock("../../api/kanbanQueries");
jest.mock("../../api/workspaceQueries");
jest.mock("../../api/tatQueries");
jest.mock("../../api/configQueries", () => ({
  ...jest.requireActual("../../api/configQueries"),
  fetchLookups: jest.fn(),
}));

const ME = 42;

const item = (Id: number, ItemText: string, IsCompleted = false): TaskChecklistItem => ({
  Id,
  TaskId: 1,
  ItemText,
  IsCompleted,
  SortOrder: Id,
});

const TASK = makeTask({
  Id: 1,
  Title: "Fit the inverter",
  WorkspaceId: 10,
  WorkspaceName: "Ops board",
  ColumnTitle: "To do",
  CreatedByUserId: ME,
  AssigneesJson: assigneesJson([ME, "Asha Rao"]),
});

function serve({ task = TASK, ws = makeWorkspace({ Id: 10 }), items = [item(1, "Order parts", true), item(2, "Fit it")] }: {
  task?: Task | null;
  ws?: Workspace;
  items?: TaskChecklistItem[];
} = {}) {
  jest.mocked(fetchTaskById).mockResolvedValue(task);
  jest.mocked(fetchWorkspaces).mockResolvedValue([ws]);
  jest.mocked(getTaskChecklist).mockResolvedValue(items);
  jest.mocked(getTaskComments).mockResolvedValue([]);
  jest.mocked(fetchAttachments).mockResolvedValue([]);
  jest.mocked(fetchKanbanColumns).mockResolvedValue([]);
  jest.mocked(fetchTasks).mockResolvedValue(envelope({ tasks: [], pagination: pagination(0) }));
  jest.mocked(fetchTaskDependencies).mockResolvedValue({ blockers: [], dependents: [] });
  jest.mocked(getTaskTimeEntries).mockResolvedValue([]);
  jest.mocked(getTaskActivity).mockResolvedValue([]);
  jest.mocked(fetchTaskTat).mockResolvedValue({ clocks: [], holds: [], events: [] });
  jest.mocked(fetchLookups).mockResolvedValue([]);
  jest.mocked(saveTaskChecklist).mockResolvedValue(envelope(null));
  jest.mocked(deleteTaskChecklist).mockResolvedValue(envelope(null));
}

const mount = async () => {
  const navigation = makeNavigation<"TaskDetail">();
  await renderWithProviders(
    <TaskDetailScreen navigation={navigation} route={makeRoute("TaskDetail", { taskId: 1, workspaceId: 10 })} />,
  );
  return navigation;
};

/** Loaded, with the board role known (abilities depend on it). */
const loaded = async () => {
  await screen.findByText("Fit the inverter");
  await waitFor(() => expect(fetchWorkspaces).toHaveBeenCalled());
  await screen.findByText("Order parts");
};

beforeEach(() => {
  seedAuth({ UserId: ME });
  serve();
});

describe("loading", () => {
  it("a failed load keeps a back button and offers a retry", async () => {
    jest.mocked(fetchTaskById).mockRejectedValueOnce(new Error("boom"));
    const navigation = await mount();
    expect(await screen.findByText(/could not be loaded/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText("Go back"));
    expect(navigation.goBack).toHaveBeenCalled();
    await fireEvent.press(screen.getByText("Try again"));
    expect(await screen.findByText("Fit the inverter")).toBeOnTheScreen();
  });

  it("a task that is gone or hidden says so, without a retry", async () => {
    serve({ task: null });
    await mount();
    expect(await screen.findByText("Task not available")).toBeOnTheScreen();
    expect(screen.queryByText("Try again")).toBeNull();
  });
});

describe("summary", () => {
  it("shows the board, column, title and facts", async () => {
    serve({
      task: {
        ...TASK,
        Description: "Sector 4",
        Priority: "high",
        DueDate: localDay(-1),
        LoggedHours: 5,
        EstimatedHours: 4,
        BlockerCount: 2,
      },
    });
    await mount();
    await loaded();
    expect(screen.getByText("Ops board")).toBeOnTheScreen();
    expect(screen.getByText("Sector 4")).toBeOnTheScreen();
    expect(screen.getByText("high")).toBeOnTheScreen();
    expect(screen.getByText("1 day overdue")).toBeOnTheScreen();
    expect(screen.getByText("5h / 4h")).toBeOnTheScreen();
    expect(screen.getByText("2 blockers")).toBeOnTheScreen();
    expect(screen.getByText("AR")).toBeOnTheScreen();
  });

  it("a lone blocker, logged time with no estimate, and nobody on it", async () => {
    serve({ task: { ...TASK, AssigneesJson: null, BlockerCount: 1, LoggedHours: 2, DueDate: localDay(3) } });
    await mount();
    await loaded();
    expect(screen.getByText("1 blocker")).toBeOnTheScreen();
    expect(screen.getByText("2h")).toBeOnTheScreen();
    expect(screen.getByText("Unassigned")).toBeOnTheScreen();
    // The two tappable facts open their sheets. parity: TASK-08 — the time
    // sheet is only reachable through this chip, i.e. only once LoggedHours > 0.
    const { present } = spySheets();
    await fireEvent.press(screen.getByText("2h"));
    await fireEvent.press(screen.getByText("1 blocker"));
    expect(present).toHaveBeenCalledTimes(2);
  });

  it("falls back to 'Task' with no board name", async () => {
    serve({ task: { ...TASK, WorkspaceName: null, ColumnTitle: null } });
    await mount();
    await loaded();
    expect(screen.getByText("Task")).toBeOnTheScreen();
  });
});

describe("checklist", () => {
  it("shows completion derived from the checklist", async () => {
    await mount();
    await loaded();
    expect(screen.getByText("1 of 2 done")).toBeOnTheScreen();
    expect(getTaskChecklist).toHaveBeenCalledWith({ TaskId: 1 });
  });

  it("ticking a step flips it on the server", async () => {
    await mount();
    await loaded();
    await fireEvent.press(screen.getByRole("checkbox", { name: "Fit it" }));
    await waitFor(() => expect(saveTaskChecklist).toHaveBeenCalled());
    // parity: TASK-03 — the reply's completionChange / tatReasonNeeded are not read yet.
    expect(jest.mocked(saveTaskChecklist).mock.calls[0]![0]).toEqual({
      Id: 2,
      TaskId: 1,
      ItemText: "Fit it",
      IsCompleted: true,
      SortOrder: 2,
      WorkspaceId: 10,
    });
  });

  it("unticking sends IsCompleted false; a step with no order sends 0", async () => {
    serve({ items: [{ ...item(1, "Order parts", true), SortOrder: null }] });
    await mount();
    await loaded();
    await fireEvent.press(screen.getByRole("checkbox", { name: "Order parts" }));
    await waitFor(() => expect(saveTaskChecklist).toHaveBeenCalled());
    expect(jest.mocked(saveTaskChecklist).mock.calls[0]![0]).toMatchObject({ IsCompleted: false, SortOrder: 0 });
  });

  it("a refused tick is explained in a toast", async () => {
    jest.mocked(saveTaskChecklist).mockRejectedValue(serverError(400, "Finish the blocking task first"));
    await mount();
    await loaded();
    await fireEvent.press(screen.getByRole("checkbox", { name: "Fit it" }));
    expect(await screen.findByText("Finish the blocking task first")).toBeOnTheScreen();
  });

  it("removing a step deletes it on the server", async () => {
    await mount();
    await loaded();
    await fireEvent.press(screen.getByLabelText("Remove Fit it"));
    await waitFor(() => expect(deleteTaskChecklist).toHaveBeenCalled());
    expect(jest.mocked(deleteTaskChecklist).mock.calls[0]![0]).toEqual({ Id: 2, TaskId: 1, WorkspaceId: 10 });
  });

  it("a refused removal is explained in a toast", async () => {
    jest.mocked(deleteTaskChecklist).mockRejectedValue(serverError(400, "A task needs at least one step"));
    await mount();
    await loaded();
    await fireEvent.press(screen.getByLabelText("Remove Fit it"));
    expect(await screen.findByText("A task needs at least one step")).toBeOnTheScreen();
  });

  it("the FAB adds a step at the end of the list", async () => {
    await mount();
    await loaded();
    const { present, dismiss } = spySheets();
    await fireEvent.press(screen.getByLabelText("Add a checklist item"));
    expect(present).toHaveBeenCalledTimes(1);
    await fireEvent.changeText(screen.getByPlaceholderText("What needs doing?"), " Test run ");
    await fireEvent.press(screen.getByText("Add item"));
    await waitFor(() => expect(saveTaskChecklist).toHaveBeenCalled());
    // Success closes the sheet.
    await waitFor(() => expect(dismiss).toHaveBeenCalledTimes(1));
    expect(jest.mocked(saveTaskChecklist).mock.calls[0]![0]).toEqual({
      TaskId: 1,
      ItemText: "Test run",
      SortOrder: 2,
      WorkspaceId: 10,
    });
  });

  it("a refused add keeps the sheet's text and shows why", async () => {
    jest.mocked(saveTaskChecklist).mockRejectedValue(serverError(403, "You cannot edit this task"));
    await mount();
    await loaded();
    const { dismiss } = spySheets();
    await fireEvent.press(screen.getByLabelText("Add a checklist item"));
    await fireEvent.changeText(screen.getByPlaceholderText("What needs doing?"), "Test run");
    await fireEvent.press(screen.getByText("Add item"));
    expect(await screen.findByText("You cannot edit this task")).toBeOnTheScreen();
    expect(screen.getByDisplayValue("Test run")).toBeOnTheScreen();
    // A refusal leaves the sheet open (the mock keeps it mounted either way).
    expect(dismiss).not.toHaveBeenCalled();
  });
});

describe("who may do what", () => {
  it("a viewer not on the task reads it: no actions, no ticking, a view-only note", async () => {
    serve({
      task: { ...TASK, CreatedByUserId: 1, AssigneesJson: assigneesJson([7, "Ravi Kumar"]) },
      ws: makeWorkspace({ Id: 10, MyRole: "viewer" }),
    });
    await mount();
    await loaded();
    expect(screen.getByText(/View only/)).toBeOnTheScreen();
    expect(screen.queryByLabelText("Task actions")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByLabelText("Add a checklist item")).toBeNull();
  });

  it("a personal board is private even from an admin", async () => {
    seedAuth({ UserId: ME, user: { IsAdmin: true } });
    serve({
      task: { ...TASK, CreatedByUserId: 1, AssigneesJson: assigneesJson([1, "Owner"]) },
      ws: makeWorkspace({ Id: 10, Type: "personal", MyRole: null }),
    });
    await mount();
    await loaded();
    expect(screen.getByText(/View only/)).toBeOnTheScreen();
    expect(screen.queryByLabelText("Task actions")).toBeNull();
  });

  it("an admin works any task on a shared board", async () => {
    seedAuth({ UserId: ME, user: { IsAdmin: true } });
    serve({
      task: { ...TASK, CreatedByUserId: 1, AssigneesJson: assigneesJson([1, "Owner"]) },
      ws: makeWorkspace({ Id: 10, Type: "shared", MyRole: null }),
    });
    await mount();
    await loaded();
    expect(screen.queryByText(/View only/)).toBeNull();
    expect(screen.getByLabelText("Task actions")).toBeOnTheScreen();
  });
});

describe("tabs", () => {
  it("each tab shows its own panel, with counts on the badges", async () => {
    jest.mocked(getTaskComments).mockResolvedValue([
      {
        Id: 1,
        TaskId: 1,
        Comment: "Parts arrive Monday",
        UserId: 7,
        UserName: null,
        Avatar: null,
        ParentCommentId: null,
        IsPinned: null,
        CreatedDate: new Date().toISOString(),
        UpdatedDate: null,
      },
    ]);
    await mount();
    await loaded();
    const tabs = screen.getAllByRole("tab");
    expect(within(tabs[0]!).getByText("2")).toBeOnTheScreen();
    expect(within(tabs[2]!).getByText("1")).toBeOnTheScreen();

    await fireEvent.press(screen.getByText("Files"));
    await waitFor(() => expect(fetchAttachments).toHaveBeenCalledWith({ Entity: "task", EntityId: 1 }));

    await fireEvent.press(screen.getByText("Comments"));
    expect(screen.getByText("Parts arrive Monday")).toBeOnTheScreen();
    expect(screen.getByText(/^Someone · /)).toBeOnTheScreen();

    // parity: TASK-07 — the Deadline tab shows on personal boards too; not pinned either way.
    await fireEvent.press(screen.getByText("Deadline"));
    expect(await screen.findByText("No deadline on you")).toBeOnTheScreen();

    await fireEvent.press(screen.getByText("History"));
    expect(await screen.findByText("No history yet")).toBeOnTheScreen();
  });
});
