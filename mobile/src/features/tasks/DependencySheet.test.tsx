import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { fetchTaskDependencies, removeTaskDependency } from "../../api/taskQueries";
import type { TaskDependency } from "../../types/api";
import { envelope, serverError } from "../../test/fixtures";
import { renderWithProviders } from "../../test/renderWithProviders";
import { DependencySheet } from "./DependencySheet";

jest.mock("../../api/taskQueries");

const dep = (patch: Partial<TaskDependency>): TaskDependency => ({
  Direction: "blocker",
  TaskId: 20,
  Title: "Order parts",
  ColumnTitle: null,
  IsCompleted: false,
  Type: "finish_to_start",
  ...patch,
});

const mount = (canEdit = true) =>
  renderWithProviders(<DependencySheet taskId={1} workspaceId={10} canEdit={canEdit} />);

beforeEach(() => {
  jest.mocked(fetchTaskDependencies).mockResolvedValue({
    blockers: [
      dep({ TaskId: 20, Title: "Order parts", ColumnTitle: "Doing" }),
      dep({ TaskId: 21, Title: null, IsCompleted: true }),
    ],
    dependents: [dep({ Direction: "dependent", TaskId: 30, Title: "Hand over to customer" })],
  });
  jest.mocked(removeTaskDependency).mockResolvedValue(envelope(null));
});

it("leads with how many blockers are still open — dependencies are hard blocks", async () => {
  await mount();
  expect(await screen.findByText("1 unfinished blocker")).toBeOnTheScreen();
  expect(fetchTaskDependencies).toHaveBeenCalledWith({ TaskId: 1 });
  expect(screen.getByText("Blocked by")).toBeOnTheScreen();
  expect(screen.getByText("Still open · Doing")).toBeOnTheScreen();
  // A blocker with no title still has a name.
  expect(screen.getByText("Task #21")).toBeOnTheScreen();
  expect(screen.getAllByText("Done").length).toBeGreaterThan(0);
  expect(screen.getByText("Waiting on this")).toBeOnTheScreen();
  expect(screen.getByText("Hand over to customer")).toBeOnTheScreen();
});

it("counts several open blockers in the plural", async () => {
  jest.mocked(fetchTaskDependencies).mockResolvedValue({
    blockers: [dep({ TaskId: 20 }), dep({ TaskId: 22, Title: "Permit" })],
    dependents: [],
  });
  await mount();
  expect(await screen.findByText("2 unfinished blockers")).toBeOnTheScreen();
  expect(screen.queryByText("Waiting on this")).toBeNull();
});

it("removing a blocker unlinks it on the server", async () => {
  await mount();
  await screen.findByText("Order parts");
  await fireEvent.press(screen.getAllByLabelText("Remove this dependency")[0]!);
  await waitFor(() => expect(removeTaskDependency).toHaveBeenCalled());
  expect(jest.mocked(removeTaskDependency).mock.calls[0]![0]).toEqual({
    TaskId: 1,
    DependsOnTaskId: 20,
    WorkspaceId: 10,
  });
});

// TASK-05: a dependent is unlinked from its own side — it is the one waiting.
it("removing a dependent unlinks the other task from this one", async () => {
  await mount();
  await screen.findByText("Hand over to customer");
  const crosses = screen.getAllByLabelText("Remove this dependency");
  expect(crosses).toHaveLength(3);
  await fireEvent.press(crosses[2]!);
  await waitFor(() => expect(removeTaskDependency).toHaveBeenCalled());
  expect(jest.mocked(removeTaskDependency).mock.calls[0]![0]).toEqual({
    TaskId: 30,
    DependsOnTaskId: 1,
    WorkspaceId: 10,
  });
});

it("a refused removal shows the server's reason", async () => {
  jest.mocked(removeTaskDependency).mockRejectedValue(serverError(403, "Only an owner can change dependencies"));
  await mount();
  await screen.findByText("Order parts");
  await fireEvent.press(screen.getAllByLabelText("Remove this dependency")[0]!);
  expect(await screen.findByText("Only an owner can change dependencies")).toBeOnTheScreen();
});

it("without edit rights nothing can be removed", async () => {
  await mount(false);
  await screen.findByText("Order parts");
  expect(screen.queryByLabelText("Remove this dependency")).toBeNull();
});

it("a task with no dependencies says so", async () => {
  jest.mocked(fetchTaskDependencies).mockResolvedValue({ blockers: [], dependents: [] });
  await mount();
  expect(await screen.findByText("This task has no dependencies.")).toBeOnTheScreen();
  expect(screen.getByText("Nothing is blocking this task")).toBeOnTheScreen();
});
