import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { logout } from "../../api/authQueries";
import { fetchTasks } from "../../api/taskQueries";
import useAuthStore from "../../stores/useAuthStore";
import type { Task } from "../../types/api";
import { assigneesJson, envelope, localDay, makeTask, pagination } from "../../test/fixtures";
import { makeNavigation, renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import MyWorkScreen from "./MyWorkScreen";

jest.mock("../../api/taskQueries");
jest.mock("../../api/authQueries");

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

beforeEach(() => {
  seedAuth({ UserId: ME, user: { FullName: "Asha Rao" } });
  serve([dueToday, late], [dueToday, late, nobodys, lateButDone]);
  jest.mocked(logout).mockResolvedValue(envelope(null));
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
