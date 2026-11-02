import type { QueryClient } from "@tanstack/react-query";
import { fireEvent, screen, waitFor, within } from "@testing-library/react-native";

import { fetchTasks } from "../../api/taskQueries";
import { fetchMyDay } from "../../api/todayQueries";
import { fetchWorkspaces } from "../../api/workspaceQueries";
import type { DayTask, DayTaskFlags, Task } from "../../types/api";
import { assigneesJson, envelope, localDay, makeTask, makeWorkspace, pagination } from "../../test/fixtures";
import { makeNavigation, renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import { PHONE, setWindow } from "../../test/window";
import MyWorkScreen from "./MyWorkScreen";

jest.mock("../../api/taskQueries");
jest.mock("../../api/todayQueries");
jest.mock("../../api/workspaceQueries");

const mockNavigation = makeNavigation<"Tabs">();
// The Tasks tab's route; a test that opens it on a filter swaps the params.
let mockRoute: { key: string; name: "Tasks"; params?: { filter?: "mine" | "unassigned" | "all"; term?: string } } = {
  key: "Tasks-test",
  name: "Tasks",
};
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => mockNavigation,
  useRoute: () => mockRoute,
}));
const mockCreate = { open: jest.fn(), label: "New" };
jest.mock("../../navigation/Shell", () => ({
  ...jest.requireActual("../../navigation/Shell"),
  useCreate: () => mockCreate,
}));

jest.useFakeTimers();

const ME = 42;
const reply = (tasks: Task[]) => envelope({ tasks, pagination: pagination(tasks.length) });

const dueToday = makeTask({ Id: 1, Title: "Due today task", DueDate: localDay(0), WorkspaceId: 10, WorkspaceName: "Website Revamp", ColumnTitle: "In Progress", ChecklistDone: 11, ChecklistTotal: 12, Priority: "high", AssigneesJson: assigneesJson([ME, "Asha Rao"]) });
const late = makeTask({ Id: 2, Title: "Late task", DueDate: localDay(-3), WorkspaceId: 11, AssigneesJson: assigneesJson([ME, "Asha Rao"]) });
const nobodys = makeTask({ Id: 3, Title: "Nobody's task", DueDate: null });
const mineDone = makeTask({ Id: 5, Title: "Shipped this week", IsCompleted: true, CompletedDate: new Date().toISOString() });
const mineDoneLong = makeTask({ Id: 6, Title: "Shipped last month", IsCompleted: true, CompletedDate: "2026-01-05T10:00:00" });

/** Mine (open) · my tasks with done (G10) · the all-workspaces open list. */
function serve(mine: Task[], all: Task[] = [], withDone: Task[] = []) {
  jest.mocked(fetchTasks).mockImplementation(async (p = {}) =>
    reply(p.OnlyOpen === false ? withDone : p.AssigneeUserId ? mine : all),
  );
}

const NO_FLAGS: DayTaskFlags = {
  given: false, done: false, doneLate: false, open: true, working: false, notStarted: true, dueToday: false,
  overdue: false, atRisk: false, onHold: false, reasonOwed: false, toRule: false,
};
const dayTask = (TaskId: number, Title: string, flags: Partial<DayTaskFlags>, timeLeftMin: number | null = null): DayTask => ({
  TaskId, TatId: TaskId * 100, Title, WorkspaceId: 20 + TaskId, WorkspaceName: "Ops", AssignedByName: null, Priority: null,
  StepsTotal: 0, StepsDone: 0, HoldReason: null, CompletedDate: null, BreachedAt: null, due: null, timer: "clock",
  timeLeftMin, flags: { ...NO_FLAGS, ...flags },
});
function serveDay(tasks: DayTask[], live = true) {
  jest.mocked(fetchMyDay).mockResolvedValue(
    envelope({ day: { key: "2026-11-02", live }, me: { UserId: ME, FullName: "Asha Rao", tasks } }),
  );
}

beforeEach(() => {
  setWindow(...PHONE);
  seedAuth({ UserId: ME, user: { FullName: "Asha Rao" } });
  serve([dueToday, late], [dueToday, late, nobodys], [dueToday, mineDone, mineDoneLong]);
  jest.mocked(fetchWorkspaces).mockResolvedValue([
    makeWorkspace({ Id: 11, Type: "personal", OwnerUserId: ME, MyInviteStatus: "active" }),
    makeWorkspace({ Id: 10, Type: "shared", MyInviteStatus: "active" }),
    makeWorkspace({ Id: 12, Type: "shared", MyInviteStatus: "pending" }),
  ]);
  serveDay([]);
  mockRoute = { key: "Tasks-test", name: "Tasks" };
});

const rowTitles = () =>
  within(screen.getByTestId("task-list")).getAllByRole("button").map((b) => b.props.accessibilityLabel.split(",")[0]);

it("05: the band reads My Work with Mine · Unassigned · All and their counts", async () => {
  await renderWithProviders(<MyWorkScreen />);
  expect(await screen.findByRole("header", { name: "My Work" })).toBeOnTheScreen();
  expect(await screen.findByRole("tab", { name: "Mine, 2" })).toBeOnTheScreen();
  expect(await screen.findByRole("tab", { name: "Unassigned, 1" })).toBeOnTheScreen();
  expect(screen.getByRole("tab", { name: "All, 3" })).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
});

it("lists my open tasks, overdue first, as rows with stage, priority, steps, chips and people", async () => {
  await renderWithProviders(<MyWorkScreen />);
  await screen.findByText("Late task");
  expect(rowTitles()).toEqual(["Late task", "Due today task"]);
  expect(screen.getByText("Sorted by deadline")).toBeOnTheScreen();
  expect(screen.getByText(/^Updated /)).toBeOnTheScreen();
  // Due today: in progress (11 of 12 ticked), High, a shared board.
  expect(screen.getByTestId("stage-inProgress")).toBeOnTheScreen();
  expect(screen.getByText("High")).toBeOnTheScreen();
  expect(screen.getByText("Website Revamp · In Progress")).toBeOnTheScreen();
  expect(screen.getByText("11 of 12")).toBeOnTheScreen();
  expect(screen.getAllByLabelText("1 people").length).toBe(2);
  // Late: on my personal board (G9).
  expect(screen.getByText("Personal")).toBeOnTheScreen();
});

it("stage pills count the tab's rows and narrow them (G8)", async () => {
  await renderWithProviders(<MyWorkScreen />);
  await screen.findByText("Late task");
  expect(screen.getByRole("radio", { name: "To Do, 1" })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("radio", { name: "In Progress, 1" }));
  expect(rowTitles()).toEqual(["Due today task"]);
  await fireEvent.press(screen.getByRole("radio", { name: "To Do, 1" }));
  expect(rowTitles()).toEqual(["Late task"]);
  await fireEvent.press(screen.getByRole("radio", { name: "Any status" }));
  expect(rowTitles()).toEqual(["Late task", "Due today task"]);
});

it("Done and 'Completed this week' show my tasks finished since Monday (G10)", async () => {
  await renderWithProviders(<MyWorkScreen />);
  await screen.findByText("Late task");
  expect(fetchTasks).toHaveBeenCalledWith({ WorkspaceId: null, AssigneeUserId: ME, OnlyOpen: false, PageSize: 200 });
  const done = await screen.findByRole("button", { name: "Completed this week" });
  await waitFor(() => expect(within(done).getByText("1")).toBeOnTheScreen());
  await fireEvent.press(screen.getByRole("tab", { name: "All, 3" }));
  await fireEvent.press(done);
  expect(screen.getByRole("tab", { name: "Mine, 2", selected: true })).toBeOnTheScreen();
  expect(rowTitles()).toEqual(["Shipped this week"]);
  expect(screen.getAllByText("Completed this week").length).toBe(2);
  // Leaving the tab leaves Done.
  await fireEvent.press(screen.getByRole("tab", { name: "Unassigned, 1" }));
  expect(rowTitles()).toEqual(["Nobody's task"]);
});

it("Done with nothing finished says so", async () => {
  serve([late], [late], []);
  await renderWithProviders(<MyWorkScreen />);
  await screen.findByText("Late task");
  await fireEvent.press(screen.getByRole("radio", { name: "Done" }));
  expect(await screen.findByText("Nothing finished this week")).toBeOnTheScreen();
});

it("Open a board counts the boards I am in and opens Workspaces", async () => {
  await renderWithProviders(<MyWorkScreen />);
  expect(await screen.findByText("2 workspaces")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Open a board" }));
  expect(mockNavigation.navigate).toHaveBeenCalledWith("Boards");
});

it("+ New opens the task form on my personal board, or the Create flow without one", async () => {
  await renderWithProviders(<MyWorkScreen />);
  await screen.findByText("2 workspaces");
  await fireEvent.press(screen.getByRole("button", { name: "New task" }));
  expect(mockNavigation.navigate).toHaveBeenCalledWith("TaskForm", { workspaceId: 11 });
  jest.mocked(fetchWorkspaces).mockResolvedValue([]);
  await renderWithProviders(<MyWorkScreen />);
  await fireEvent.press(screen.getAllByRole("button", { name: "New task" }).at(-1)!);
  expect(mockCreate.open).toHaveBeenCalled();
});

it("opens on the filter and term a navigate() brings (Home, Search's See all)", async () => {
  mockRoute = { key: "Tasks-test", name: "Tasks", params: { filter: "all", term: "nobody" } };
  await renderWithProviders(<MyWorkScreen />);
  expect(await screen.findByRole("tab", { name: "All, 3", selected: true })).toBeOnTheScreen();
  expect(screen.getByDisplayValue("nobody")).toBeOnTheScreen();
  await waitFor(() => expect(rowTitles()).toEqual(["Nobody's task"]));
});

it("search toggles in the band and narrows by title; closing clears it", async () => {
  await renderWithProviders(<MyWorkScreen />);
  await screen.findByText("Late task");
  await fireEvent.press(screen.getByRole("button", { name: "Search tasks" }));
  await fireEvent.changeText(screen.getByLabelText("Search tasks"), "late");
  expect(rowTitles()).toEqual(["Late task"]);
  await fireEvent.changeText(screen.getByLabelText("Search tasks"), "zzz");
  expect(screen.getByText("No matches")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Close search" }));
  expect(rowTitles()).toEqual(["Late task", "Due today task"]);
});

it("each tab has its own empty state", async () => {
  serve([], [], []);
  await renderWithProviders(<MyWorkScreen />);
  expect(await screen.findByText("Nothing assigned to you")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("tab", { name: /^Unassigned/ }));
  expect(await screen.findByText("Nothing unassigned")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("tab", { name: /^All/ }));
  expect(await screen.findByText("No tasks yet")).toBeOnTheScreen();
});

it("a failed load shows the error card, and Try again asks again", async () => {
  jest.mocked(fetchTasks).mockRejectedValue(new Error("boom"));
  await renderWithProviders(<MyWorkScreen />);
  expect(await screen.findByText("Could not load. Try again")).toBeOnTheScreen();
  serve([late]);
  await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Late task")).toBeOnTheScreen();
});

it("tapping a task opens it on its own board", async () => {
  await renderWithProviders(<MyWorkScreen />);
  await fireEvent.press(await screen.findByText("Late task"));
  expect(mockNavigation.navigate).toHaveBeenCalledWith("TaskDetail", { taskId: 2, workspaceId: 11 });
});

describe("Needs you", () => {
  const nearlyDue = dayTask(7, "Nearly due", { atRisk: true }, 30);
  const runningLate = dayTask(8, "Running late", { overdue: true }, -15);
  const lateLater = dayTask(9, "Later still", { overdue: true }, -5);
  const owesReason = dayTask(6, "Owes a reason", { reasonOwed: true, done: true, open: false });
  const fine = dayTask(5, "On track", { dueToday: true }, 120);

  it("lists reason-owed (finished too), overdue and at-risk tasks, most urgent first", async () => {
    serveDay([nearlyDue, fine, lateLater, runningLate, owesReason]);
    await renderWithProviders(<MyWorkScreen />);
    expect(await screen.findByText("Needs you")).toBeOnTheScreen();
    expect(fetchMyDay).toHaveBeenCalled();

    const rows = screen.getAllByTestId("needs-you-row").map((r) => within(r).getAllByText(/./)[0]!.props.children);
    expect(rows).toEqual(["Owes a reason", "Running late", "Later still", "Nearly due"]);
    expect(screen.queryByText("On track")).toBeNull();
    expect(screen.getByText("Ops · Tell your manager why")).toBeOnTheScreen();
    expect(screen.getAllByText("Ops · Past its deadline")).toHaveLength(2);
    expect(screen.getByText("Ops · Close to its deadline")).toBeOnTheScreen();
    // The rest of My Work is still there.
    expect(screen.getByText("Late task")).toBeOnTheScreen();
  });

  it("a reason-owed row opens the Deadline tab with the reason sheet on its clock", async () => {
    serveDay([owesReason]);
    await renderWithProviders(<MyWorkScreen />);
    await fireEvent.press(await screen.findByText("Owes a reason"));
    expect(mockNavigation.navigate).toHaveBeenCalledWith("TaskDetail", { taskId: 6, workspaceId: 26, tab: "tat", explainTatId: 600 });
  });

  it("an overdue or at-risk row just opens the Deadline tab", async () => {
    serveDay([runningLate]);
    await renderWithProviders(<MyWorkScreen />);
    await fireEvent.press(await screen.findByText("Running late"));
    expect(mockNavigation.navigate).toHaveBeenCalledWith("TaskDetail", { taskId: 8, workspaceId: 28, tab: "tat" });
  });

  /** The Today query has answered (or failed) and the screen re-rendered with it. */
  const settled = async (queryClient: QueryClient, status: "success" | "error" = "success") => {
    await screen.findByText("Late task");
    await waitFor(() => expect(queryClient.getQueryState(["tasks", "today", "mine"])?.status).toBe(status));
  };

  it("is hidden when nothing needs you", async () => {
    serveDay([fine]);
    const { queryClient } = await renderWithProviders(<MyWorkScreen />);
    await settled(queryClient);
    expect(screen.queryByText("Needs you")).toBeNull();
  });

  it("is hidden on a day without live flags", async () => {
    serveDay([runningLate], false);
    const { queryClient } = await renderWithProviders(<MyWorkScreen />);
    await settled(queryClient);
    expect(screen.queryByText("Needs you")).toBeNull();
  });

  it("is hidden when there is no day at all", async () => {
    jest.mocked(fetchMyDay).mockResolvedValue(envelope({ day: { key: "2026-11-02", live: true }, me: null }));
    const { queryClient } = await renderWithProviders(<MyWorkScreen />);
    await settled(queryClient);
    expect(screen.queryByText("Needs you")).toBeNull();
  });

  it("a failed Today load leaves the rest of My Work working", async () => {
    jest.mocked(fetchMyDay).mockRejectedValue(new Error("boom"));
    const { queryClient } = await renderWithProviders(<MyWorkScreen />);
    await settled(queryClient, "error");
    expect(screen.getByText("Late task")).toBeOnTheScreen();
    expect(screen.queryByText("Needs you")).toBeNull();
    expect(screen.queryByText("Couldn't load your tasks")).toBeNull();
  });

  it("hides under Unassigned and All: it is about you", async () => {
    serveDay([runningLate]);
    await renderWithProviders(<MyWorkScreen />);
    await screen.findByText("Needs you");
    await fireEvent.press(screen.getByText("Unassigned"));
    await screen.findByText("Nobody's task");
    expect(screen.queryByText("Needs you")).toBeNull();
    await fireEvent.press(screen.getByText("All"));
    await screen.findByText("Late task");
    expect(screen.queryByText("Needs you")).toBeNull();
  });
});
