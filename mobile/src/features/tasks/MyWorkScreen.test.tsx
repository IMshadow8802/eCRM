import type { QueryClient } from "@tanstack/react-query";
import { fireEvent, screen, waitFor, within } from "@testing-library/react-native";

import { logout } from "../../api/authQueries";
import { fetchTasks } from "../../api/taskQueries";
import { fetchMyDay } from "../../api/todayQueries";
import useAuthStore from "../../stores/useAuthStore";
import type { DayTask, DayTaskFlags, Task } from "../../types/api";
import { assigneesJson, envelope, localDay, makeTask, pagination } from "../../test/fixtures";
import { makeNavigation, renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import MyWorkScreen from "./MyWorkScreen";

jest.mock("../../api/taskQueries");
jest.mock("../../api/authQueries");
jest.mock("../../api/todayQueries");

const mockNavigation = makeNavigation<"Tabs">();
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => mockNavigation,
}));

// Lists arm VirtualizedList's 50 ms batch timer on every data change; under
// load it fired between waitFor polls, outside act(). Fake timers park it
// (RNTL's waitFor/findBy advance them).
jest.useFakeTimers();

const ME = 42;
const reply = (tasks: Task[]) => envelope({ tasks, pagination: pagination(tasks.length) });

const dueToday = makeTask({ Id: 1, Title: "Due today task", DueDate: localDay(0), WorkspaceId: 10, AssigneesJson: assigneesJson([ME, "Asha Rao"]) });
const late = makeTask({ Id: 2, Title: "Late task", DueDate: localDay(-3), WorkspaceId: 11, AssigneesJson: assigneesJson([ME, "Asha Rao"]) });
const nobodys = makeTask({ Id: 3, Title: "Nobody's task", DueDate: null });
const lateButDone = makeTask({ Id: 4, Title: "Finished late", DueDate: localDay(-5), IsCompleted: true });

/** "Mine" (AssigneeUserId set) gets `mine`; the all-workspaces query gets `all`. */
function serve(mine: Task[], all: Task[] = []) {
  jest.mocked(fetchTasks).mockImplementation(async (p = {}) => reply(p.AssigneeUserId ? mine : all));
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
  seedAuth({ UserId: ME, user: { FullName: "Asha Rao" } });
  serve([dueToday, late], [dueToday, late, nobodys, lateButDone]);
  jest.mocked(logout).mockResolvedValue(envelope(null));
  serveDay([]);
});

it("lists my open tasks, overdue first, with the counts in the header", async () => {
  await renderWithProviders(<MyWorkScreen />);
  expect(await screen.findByText("Late task")).toBeOnTheScreen();
  expect(fetchTasks).toHaveBeenCalledWith({ WorkspaceId: null, AssigneeUserId: ME, OnlyOpen: true, PageSize: 200 });

  const titles = screen.getAllByText(/ task$/).map((n) => n.props.children);
  expect(titles).toEqual(["Late task", "Due today task"]);
  expect(screen.getByText("2 tasks assigned to you")).toBeOnTheScreen();
  expect(screen.getByText(/1 overdue/)).toBeOnTheScreen();
  expect(screen.getByText("Asha")).toBeOnTheScreen();
});

it("one task reads singular, and no overdue line when nothing is late", async () => {
  serve([dueToday]);
  await renderWithProviders(<MyWorkScreen />);
  expect(await screen.findByText("1 task assigned to you")).toBeOnTheScreen();
  expect(screen.queryByText(/overdue/)).toBeNull();
});

it("says so when nothing is assigned", async () => {
  serve([]);
  await renderWithProviders(<MyWorkScreen />);
  expect(await screen.findByText("Nothing assigned to you")).toBeOnTheScreen();
  expect(screen.getByText("Nothing assigned to you right now")).toBeOnTheScreen();
});

it("greets with a fallback name when the user has none", async () => {
  useAuthStore.setState({ user: null });
  await renderWithProviders(<MyWorkScreen />);
  await screen.findByText("Late task");
  expect(screen.getByText("there")).toBeOnTheScreen();
});

it("the greeting's wave is a lucide icon, not an emoji in the text", async () => {
  await renderWithProviders(<MyWorkScreen />);
  await screen.findByText("Late task");
  const greet = screen.getByText(/^(Good|Working)/);
  expect(greet).toHaveTextContent(/^[A-Za-z ]+,$/);
  // Beside the text sits an SVG (lucide), not a glyph inside the string.
  expect(greet.parent!.children.map((c) => (typeof c === "string" ? c : c.type))).toEqual(["Text", "RNSVGSvgView"]);
});

it("Unassigned shows only tasks nobody is on", async () => {
  await renderWithProviders(<MyWorkScreen />);
  await screen.findByText("Late task");
  await fireEvent.press(screen.getByText("Unassigned"));

  expect(await screen.findByText("Nobody's task")).toBeOnTheScreen();
  expect(screen.queryByText("Late task")).toBeNull();
  // TASK-06: without OnlyOpen, finished tasks leaked into Unassigned/All and
  // into the due buckets, Overdue included.
  expect(fetchTasks).toHaveBeenCalledWith({ WorkspaceId: null, OnlyOpen: true, PageSize: 200 });
});

it("All shows every task, and the overdue count ignores finished ones", async () => {
  await renderWithProviders(<MyWorkScreen />);
  await screen.findByText("Late task");
  await fireEvent.press(screen.getByText("All"));

  expect(await screen.findByText("Nobody's task")).toBeOnTheScreen();
  expect(screen.getByText("Late task")).toBeOnTheScreen();
  // Late task is overdue; "Finished late" is complete and must not count.
  expect(screen.getByText(/1 overdue/)).toBeOnTheScreen();
});

it("Unassigned and All have their own empty states", async () => {
  serve([dueToday], []);
  await renderWithProviders(<MyWorkScreen />);
  await screen.findByText("Due today task");
  await fireEvent.press(screen.getByText("Unassigned"));
  expect(await screen.findByText("Nothing unassigned")).toBeOnTheScreen();
  await fireEvent.press(screen.getByText("All"));
  expect(await screen.findByText("No tasks yet")).toBeOnTheScreen();
});

it("a failed load says so instead of showing an empty list", async () => {
  jest.mocked(fetchTasks).mockRejectedValue(new Error("boom"));
  await renderWithProviders(<MyWorkScreen />);
  expect(await screen.findByText("Couldn't load your tasks")).toBeOnTheScreen();
  expect(screen.queryByText("Nothing assigned to you")).toBeNull();
});

it("tapping a task opens it on its own board", async () => {
  await renderWithProviders(<MyWorkScreen />);
  await fireEvent.press(await screen.findByText("Late task"));
  expect(mockNavigation.navigate).toHaveBeenCalledWith("TaskDetail", { taskId: 2, workspaceId: 11 });
});

it("sign out asks first, then signs out", async () => {
  await renderWithProviders(<MyWorkScreen />);
  await screen.findByText("Late task");
  await fireEvent.press(screen.getByLabelText("Sign out"));
  expect(screen.getByText("Sign out?")).toBeOnTheScreen();

  await fireEvent.press(screen.getByText("Cancel"));
  expect(logout).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByLabelText("Sign out"));
  // The header button is an icon; the only "Sign out" text is the dialog's confirm.
  await fireEvent.press(screen.getByText("Sign out"));
  await waitFor(() => expect(logout).toHaveBeenCalled());
  await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(false));
});

// TAT-06: My Work counted overdue by DueDate day only, from OnlyOpen tasks, so
// a task finished late that still owes a reason was invisible on mobile.
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
    expect(screen.getByText("Tell your manager why")).toBeOnTheScreen();
    expect(screen.getAllByText("Past its deadline")).toHaveLength(2);
    expect(screen.getByText("Close to its deadline")).toBeOnTheScreen();
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
