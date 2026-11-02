// The detail screen's menu actions, comments and time logging. The read side
// and the checklist are in TaskDetailScreen.test.tsx.
import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { fetchAttachments } from "../../api/attachmentQueries";
import { fetchKanbanColumns } from "../../api/kanbanQueries";
import { fetchTaskTat } from "../../api/tatQueries";
import {
  addTaskComment,
  addTaskDependency,
  claimTask,
  deleteTask,
  fetchTaskById,
  fetchTaskDependencies,
  fetchTasks,
  getTaskActivity,
  getTaskChecklist,
  getTaskComments,
  getTaskTimeEntries,
  logTaskTime,
  moveTaskColumn,
} from "../../api/taskQueries";
import { fetchWorkspaces } from "../../api/workspaceQueries";
import type { KanbanColumn, Task, TaskDependency, Workspace } from "../../types/api";
import { assigneesJson, envelope, makeTask, makeWorkspace, pagination, serverError } from "../../test/fixtures";
import { makeNavigation, makeRoute, renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import { spySheets } from "../../test/sheets";
import TaskDetailScreen from "./TaskDetailScreen";

jest.mock("../../api/taskQueries");
jest.mock("../../api/attachmentQueries");
jest.mock("../../api/kanbanQueries");
jest.mock("../../api/workspaceQueries");
jest.mock("../../api/tatQueries");

const ME = 42;

const column = (Id: number, Title: string): KanbanColumn => ({
  Id,
  WorkspaceId: 10,
  Title,
  Color: null,
  SortOrder: Id,
  MaxTasks: null,
  IsActive: true,
  CompId: 1,
  BranchId: 1,
  CreatedDate: null,
  IsCompanyWide: false,
});

const TASK = makeTask({
  Id: 1,
  Title: "Fit the inverter",
  WorkspaceId: 10,
  ColumnId: 100,
  ColumnTitle: "To do",
  CreatedByUserId: ME,
  AssigneesJson: assigneesJson([ME, "Asha Rao"]),
});
const SIBLING = makeTask({ Id: 2, Title: "Order parts", ColumnTitle: null });

function serve({ task = TASK, ws = makeWorkspace({ Id: 10 }), siblings = [TASK, SIBLING] }: {
  task?: Task;
  ws?: Workspace;
  siblings?: Task[];
} = {}) {
  jest.mocked(fetchTaskById).mockResolvedValue(task);
  jest.mocked(fetchWorkspaces).mockResolvedValue([ws]);
  jest.mocked(getTaskChecklist).mockResolvedValue([]);
  jest.mocked(getTaskComments).mockResolvedValue([]);
  jest.mocked(fetchAttachments).mockResolvedValue([]);
  jest.mocked(fetchKanbanColumns).mockResolvedValue([column(100, "To do"), column(101, "Doing")]);
  jest.mocked(fetchTasks).mockResolvedValue(envelope({ tasks: siblings, pagination: pagination(siblings.length) }));
  jest.mocked(fetchTaskDependencies).mockResolvedValue({ blockers: [], dependents: [] });
  jest.mocked(getTaskTimeEntries).mockResolvedValue([]);
  jest.mocked(getTaskActivity).mockResolvedValue([]);
  jest.mocked(fetchTaskTat).mockResolvedValue({ clocks: [], holds: [], events: [] });
  for (const fn of [addTaskComment, addTaskDependency, claimTask, deleteTask, logTaskTime, moveTaskColumn]) {
    jest.mocked(fn).mockResolvedValue(envelope(null));
  }
}

const mount = async () => {
  const navigation = makeNavigation<"TaskDetail">();
  await renderWithProviders(
    <TaskDetailScreen navigation={navigation} route={makeRoute("TaskDetail", { taskId: 1, workspaceId: 10 })} />,
  );
  // Wait for the task, the board role and the board's columns/tasks: the menu is built from all three.
  await screen.findByText("Fit the inverter");
  await screen.findByText("Doing");
  await screen.findByText("Order parts");
  return navigation;
};

/** Fake only Date: the screen's own timers and promises keep running. */
type TimersConfig = Extract<Parameters<typeof jest.useFakeTimers>[0], { doNotFake?: unknown }>;
const REAL_TIMERS: NonNullable<TimersConfig["doNotFake"]> = [
  "hrtime", "nextTick", "performance", "queueMicrotask", "requestAnimationFrame", "cancelAnimationFrame",
  "requestIdleCallback", "cancelIdleCallback", "setImmediate", "clearImmediate", "setInterval",
  "clearInterval", "setTimeout", "clearTimeout",
];

/** The body a mutation sent (useMutation passes a context second). */
const body = (fn: (...args: never[]) => unknown) => jest.mocked(fn).mock.calls.at(-1)?.[0];

beforeEach(() => {
  seedAuth({ UserId: ME });
  serve();
});

describe("menu", () => {
  it("an owner sees every action except taking an assigned task", async () => {
    await mount();
    const { present } = spySheets();
    await fireEvent.press(screen.getByLabelText("Task actions"));
    expect(present).toHaveBeenCalledTimes(1);
    for (const label of ["Log time", "Edit task", "Add a blocker", "Blocks another task", "Delete task"]) {
      expect(screen.getByText(label)).toBeOnTheScreen();
    }
    expect(screen.queryByText("Take this task")).toBeNull();
  });

  // TASK-08: the time sheet used to open only from the meta chip, which shows
  // only once LoggedHours > 0 — so with nothing logged it was unreachable.
  it("'Time logged' opens the time sheet even with nothing logged", async () => {
    await mount();
    expect(screen.queryByText("0h")).toBeNull();
    const { present } = spySheets();
    await fireEvent.press(screen.getByText("Time logged"));
    expect(present).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(getTaskTimeEntries).toHaveBeenCalled());
  });

  it("a member on someone else's unassigned task can take it — and not edit it", async () => {
    serve({ task: { ...TASK, CreatedByUserId: 1, AssigneesJson: null }, ws: makeWorkspace({ Id: 10, MyRole: "member" }) });
    await mount();
    expect(screen.queryByText("Edit task")).toBeNull();
    expect(screen.queryByText("Delete task")).toBeNull();
    await fireEvent.press(screen.getByText("Take this task"));
    await waitFor(() => expect(claimTask).toHaveBeenCalled());
    expect(body(claimTask)).toEqual({ TaskId: 1, WorkspaceId: 10 });
  });

  it("a finished task cannot be taken", async () => {
    serve({
      task: { ...TASK, CreatedByUserId: 1, AssigneesJson: null, IsCompleted: true },
      ws: makeWorkspace({ Id: 10, MyRole: "member" }),
    });
    await mount();
    expect(screen.queryByText("Take this task")).toBeNull();
  });

  it("a refused claim says why", async () => {
    serve({ task: { ...TASK, CreatedByUserId: 1, AssigneesJson: null }, ws: makeWorkspace({ Id: 10, MyRole: "member" }) });
    jest.mocked(claimTask).mockRejectedValue(serverError(400, "Only a member of this board can take its tasks"));
    await mount();
    await fireEvent.press(screen.getByText("Take this task"));
    expect(await screen.findByText("Only a member of this board can take its tasks")).toBeOnTheScreen();
  });

  it("moving to a column posts the move, the current one ticked", async () => {
    await mount();
    await fireEvent.press(screen.getByText("Doing"));
    await waitFor(() => expect(moveTaskColumn).toHaveBeenCalled());
    expect(body(moveTaskColumn)).toEqual({ TaskId: 1, ColumnId: 101, WorkspaceId: 10 });
  });

  it("a refused move says why", async () => {
    jest.mocked(moveTaskColumn).mockRejectedValue(serverError(400, "Finish the checklist first"));
    await mount();
    await fireEvent.press(screen.getByText("Doing"));
    expect(await screen.findByText("Finish the checklist first")).toBeOnTheScreen();
  });

  it("edit opens the form on this task", async () => {
    const navigation = await mount();
    await fireEvent.press(screen.getByText("Edit task"));
    expect(navigation.navigate).toHaveBeenCalledWith("TaskForm", { workspaceId: 10, taskId: 1 });
  });

  it("a blocker is picked from the board's other tasks, never itself", async () => {
    await mount();
    // The task's own title appears once — as the heading — not as a blocker candidate.
    expect(screen.getAllByText("Fit the inverter")).toHaveLength(1);
    await fireEvent.press(screen.getByText("Order parts"));
    await waitFor(() => expect(addTaskDependency).toHaveBeenCalled());
    expect(body(addTaskDependency)).toEqual({ TaskId: 1, DependsOnTaskId: 2, WorkspaceId: 10 });
  });

  it("a refused blocker says why", async () => {
    jest.mocked(addTaskDependency).mockRejectedValue(serverError(400, "That would create a cycle"));
    await mount();
    await fireEvent.press(screen.getByText("Order parts"));
    expect(await screen.findByText("That would create a cycle")).toBeOnTheScreen();
  });

  it("a board with no other tasks has nothing to depend on", async () => {
    serve({ siblings: [TASK] });
    const navigation = makeNavigation<"TaskDetail">();
    await renderWithProviders(
      <TaskDetailScreen navigation={navigation} route={makeRoute("TaskDetail", { taskId: 1, workspaceId: 10 })} />,
    );
    expect(await screen.findByText("This board has no other tasks to depend on.")).toBeOnTheScreen();
  });

  it("delete asks first, then deletes and leaves", async () => {
    const navigation = await mount();
    await fireEvent.press(screen.getByText("Delete task"));
    expect(screen.getByText("Delete this task?")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Cancel"));
    expect(deleteTask).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByText("Delete task"));
    await fireEvent.press(screen.getByText("Delete"));
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(body(deleteTask)).toEqual({ Id: 1, WorkspaceId: 10 });
  });

  it("a refused delete stays put and says why", async () => {
    jest.mocked(deleteTask).mockRejectedValue(serverError(403, "Someone else has commented on this task"));
    const navigation = await mount();
    await fireEvent.press(screen.getByText("Delete task"));
    await fireEvent.press(screen.getByText("Delete"));
    expect(await screen.findByText("Someone else has commented on this task")).toBeOnTheScreen();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });
});

// TASK-05: both directions, on web's rules (useTaskDependencies.js, DependenciesPanel.jsx).
describe("dependencies", () => {
  const THIRD = makeTask({ Id: 3, Title: "Get permit", ColumnTitle: null });
  const link = (Direction: "blocker" | "dependent", TaskId: number, Title: string): TaskDependency => ({
    Direction,
    TaskId,
    Title,
    ColumnTitle: null,
    IsCompleted: false,
    Type: "blocks",
  });

  /** Mount and wait for the board's tasks — the pickers are built from them. */
  const mountWith = async (deps: { blockers: TaskDependency[]; dependents: TaskDependency[] }) => {
    serve({ siblings: [TASK, SIBLING, THIRD] });
    jest.mocked(fetchTaskDependencies).mockResolvedValue(deps);
    await renderWithProviders(
      <TaskDetailScreen navigation={makeNavigation<"TaskDetail">()} route={makeRoute("TaskDetail", { taskId: 1, workspaceId: 10 })} />,
    );
    await screen.findByText("Doing");
    await waitFor(() => expect(fetchTaskDependencies).toHaveBeenCalled());
  };

  it("'Dependencies' is on the menu for everyone, even with no blockers, and opens the sheet", async () => {
    serve({ ws: makeWorkspace({ Id: 10, MyRole: "viewer" }) });
    await mount();
    const { present } = spySheets();
    // Labelled: the sheet's own heading carries the same word.
    await fireEvent.press(screen.getByLabelText("Open dependencies"));
    expect(present).toHaveBeenCalledTimes(1);
    // A viewer can look, not link.
    expect(screen.queryByText("Add a blocker")).toBeNull();
    expect(screen.queryByText("Blocks another task")).toBeNull();
  });

  it("the blocker picker leaves out tasks already blocking this one", async () => {
    await mountWith({ blockers: [link("blocker", 2, "Order parts")], dependents: [] });
    expect(await screen.findByText("Get permit")).toBeOnTheScreen();
    // Once, in the dependency sheet — not again as a candidate.
    await waitFor(() => expect(screen.getAllByText("Order parts")).toHaveLength(1));
  });

  it("'Blocks another task' makes the picked task wait on this one", async () => {
    await mountWith({ blockers: [], dependents: [link("dependent", 3, "Get permit")] });
    await screen.findByText("Order parts");
    await fireEvent.press(screen.getByText("Blocks another task"));
    expect(await screen.findByText("Which task waits on this one?")).toBeOnTheScreen();
    // Already waiting on this one: only in the sheet, not offered again.
    expect(screen.getAllByText("Get permit")).toHaveLength(1);
    await fireEvent.press(screen.getByText("Order parts"));
    await waitFor(() => expect(addTaskDependency).toHaveBeenCalled());
    expect(body(addTaskDependency)).toEqual({ TaskId: 2, DependsOnTaskId: 1, WorkspaceId: 10 });

    // "Add a blocker" turns the same picker back the other way.
    await fireEvent.press(screen.getByText("Add a blocker"));
    expect(await screen.findByText("Blocked by which task?")).toBeOnTheScreen();
    await fireEvent.press(screen.getByText("Order parts"));
    await waitFor(() => expect(addTaskDependency).toHaveBeenCalledTimes(2));
    expect(body(addTaskDependency)).toEqual({ TaskId: 1, DependsOnTaskId: 2, WorkspaceId: 10 });
  });

  it("a refused link says why", async () => {
    jest.mocked(addTaskDependency).mockRejectedValue(serverError(409, "Dependency already exists"));
    await mount();
    await fireEvent.press(screen.getByText("Blocks another task"));
    await fireEvent.press(screen.getByText("Order parts"));
    expect(await screen.findByText("Dependency already exists")).toBeOnTheScreen();
  });
});

describe("log time", () => {
  /** Opens the time form; returns the sheet spies, cleared of the menu's own dismiss. */
  const openLogTime = async () => {
    await mount();
    const sheets = spySheets();
    await fireEvent.press(screen.getByText("Log time"));
    // The compose sheet now carries the time form.
    await screen.findByPlaceholderText("1.5");
    expect(sheets.present).toHaveBeenCalled();
    sheets.dismiss.mockClear();
    return sheets;
  };

  it("logs hours with a note", async () => {
    const { dismiss } = await openLogTime();
    await fireEvent.changeText(screen.getByPlaceholderText("1.5"), "2.5");
    await fireEvent.changeText(screen.getByPlaceholderText("What did you work on?"), "Wiring");
    await fireEvent.press(screen.getByRole("button", { name: "Log time" }));
    await waitFor(() => expect(logTaskTime).toHaveBeenCalled());
    expect(body(logTaskTime)).toMatchObject({ TaskId: 1, Hours: 2.5, Description: "Wiring", WorkspaceId: 10 });
    await waitFor(() => expect(dismiss).toHaveBeenCalledTimes(1));
  });

  // TASK-01: no WorkDate meant the server's day, which was UTC — 00:30 IST went
  // under yesterday. The phone sends its own local day.
  it("files the entry under the local day, even just after midnight", async () => {
    await openLogTime();
    // 00:30 local on 3 Nov; in IST that instant is still 2 Nov in UTC.
    jest.useFakeTimers({ now: new Date(2026, 10, 3, 0, 30), doNotFake: REAL_TIMERS });
    try {
      await fireEvent.changeText(screen.getByPlaceholderText("1.5"), "1");
      await fireEvent.press(screen.getByRole("button", { name: "Log time" }));
      await waitFor(() => expect(logTaskTime).toHaveBeenCalled());
      expect(body(logTaskTime)).toMatchObject({ WorkDate: "2026-11-03" });
    } finally {
      jest.useRealTimers();
    }
  });

  it("refuses hours that are not a number above zero, before the server", async () => {
    await openLogTime();
    await fireEvent.changeText(screen.getByPlaceholderText("1.5"), "0");
    await fireEvent.press(screen.getByRole("button", { name: "Log time" }));
    expect(screen.getByText("Enter how many hours, as a number above zero.")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByPlaceholderText("1.5"), "lots");
    await fireEvent.press(screen.getByRole("button", { name: "Log time" }));
    expect(screen.getByText("Enter how many hours, as a number above zero.")).toBeOnTheScreen();
    expect(logTaskTime).not.toHaveBeenCalled();
  });

  it("a refused entry keeps the sheet and shows why", async () => {
    jest.mocked(logTaskTime).mockRejectedValue(serverError(403, "Only assignees can log time"));
    const { dismiss } = await openLogTime();
    await fireEvent.changeText(screen.getByPlaceholderText("1.5"), "1");
    await fireEvent.press(screen.getByRole("button", { name: "Log time" }));
    expect(await screen.findByText("Only assignees can log time")).toBeOnTheScreen();
    expect(screen.getByDisplayValue("1")).toBeOnTheScreen();
    expect(dismiss).not.toHaveBeenCalled();
  });
});

describe("comments", () => {
  it("posts a comment from the Comments tab", async () => {
    await mount();
    await fireEvent.press(screen.getByText("Comments"));
    expect(screen.getByText("No comments yet.")).toBeOnTheScreen();
    const { dismiss } = spySheets();
    await fireEvent.press(screen.getByLabelText("Write a comment"));
    await fireEvent.changeText(screen.getByPlaceholderText("Share an update…"), "On site now");
    await fireEvent.press(screen.getByText("Post comment"));
    await waitFor(() => expect(addTaskComment).toHaveBeenCalled());
    expect(body(addTaskComment)).toEqual({ TaskId: 1, Comment: "On site now", WorkspaceId: 10 });
    await waitFor(() => expect(dismiss).toHaveBeenCalledTimes(1));
  });

  it("a refused comment keeps the text and shows why", async () => {
    jest.mocked(addTaskComment).mockRejectedValue(serverError(403, "You are no longer on this board"));
    await mount();
    await fireEvent.press(screen.getByText("Comments"));
    const { dismiss } = spySheets();
    await fireEvent.press(screen.getByLabelText("Write a comment"));
    await fireEvent.changeText(screen.getByPlaceholderText("Share an update…"), "On site now");
    await fireEvent.press(screen.getByText("Post comment"));
    expect(await screen.findByText("You are no longer on this board")).toBeOnTheScreen();
    expect(screen.getByDisplayValue("On site now")).toBeOnTheScreen();
    expect(dismiss).not.toHaveBeenCalled();
  });

  it("a viewer may still comment", async () => {
    serve({ task: { ...TASK, CreatedByUserId: 1, AssigneesJson: null }, ws: makeWorkspace({ Id: 10, MyRole: "viewer" }) });
    await mount();
    await fireEvent.press(screen.getByText("Comments"));
    expect(screen.getByLabelText("Write a comment")).toBeOnTheScreen();
  });
});
