import { Dimensions } from "react-native";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { fetchKanbanColumns } from "../../api/kanbanQueries";
import { fetchTasks, moveTaskColumn } from "../../api/taskQueries";
import { fetchWorkspaces } from "../../api/workspaceQueries";
import type { KanbanColumn, Task, Workspace, WorkspaceRole } from "../../types/api";
import { access, envelope, pagination } from "../../test/fixtures";
import { makeNavigation, makeRoute, renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import { spacing } from "../../theme";
import { BOARD_COLUMN_RATIO } from "../../ui/BoardColumns";
import BoardScreen from "./BoardScreen";

jest.mock("../../api/kanbanQueries");
jest.mock("../../api/taskQueries");
jest.mock("../../api/workspaceQueries");

// Lists arm VirtualizedList's 50 ms batch timer on every data change; under
// load it fired between waitFor polls, outside act(). Fake timers park it
// (RNTL's waitFor/findBy advance them).
jest.useFakeTimers();

const ME = 42;
const WS = 9;

const column = (Id: number, Title: string) => ({ Id, Title, Color: null, SortOrder: Id }) as KanbanColumn;
const todo = column(1, "Backlog");
const doing = column(2, "Underway");

const task = (patch: Partial<Task>) =>
  ({
    WorkspaceId: WS,
    ColumnId: 1,
    CreatedByUserId: 7,
    AssigneesJson: null,
    AssignedToUserId: null,
    IsCompleted: false,
    Priority: null,
    DueDate: null,
    ...patch,
  }) as Task;

const mineTask = task({ Id: 100, Title: "Fix the gate", AssignedToUserId: ME });
const theirTask = task({ Id: 101, Title: "Order cement", ColumnId: 2, AssignedToUserId: 7 });
const orphan = task({ Id: 102, Title: "Lost card", ColumnId: null });

const board = (MyRole: WorkspaceRole | null, patch: Partial<Workspace> = {}) =>
  ({ Id: WS, Name: "Site works", Type: "shared", MyRole, MyInviteStatus: "active", IsArchived: false, ...patch }) as Workspace;

const tasksReply = (tasks: Task[]) => envelope({ tasks, pagination: pagination(tasks.length) });

const mount = (navigation = makeNavigation<"Board">()) =>
  renderWithProviders(
    <BoardScreen navigation={navigation} route={makeRoute("Board", { workspaceId: WS, name: "Site works" })} />,
  );

beforeEach(() => {
  seedAuth({ UserId: ME });
  jest.mocked(fetchKanbanColumns).mockResolvedValue([todo, doing]);
  jest.mocked(fetchTasks).mockResolvedValue(tasksReply([mineTask, theirTask]));
  jest.mocked(fetchWorkspaces).mockResolvedValue([board("owner")]);
  jest.mocked(moveTaskColumn).mockResolvedValue(envelope(null));
});

it("renders each column with its own cards and a count", async () => {
  await mount();
  expect(await screen.findByText("Fix the gate")).toBeOnTheScreen();
  expect(screen.getByText("Order cement")).toBeOnTheScreen();
  expect(screen.getByText("2 tasks · 2 columns")).toBeOnTheScreen();
  expect(fetchKanbanColumns).toHaveBeenCalledWith({ WorkspaceId: WS });
  expect(fetchTasks).toHaveBeenCalledWith(expect.objectContaining({ WorkspaceId: WS }));
  // Neither column is empty.
  expect(screen.queryByText("Nothing here yet.")).toBeNull();
});

it("a task with no known column lands in an extra Unsorted column", async () => {
  jest.mocked(fetchTasks).mockResolvedValue(tasksReply([orphan, task({ Id: 103, Title: "Ghost", ColumnId: 77 })]));
  await mount();
  expect(await screen.findByText("Lost card")).toBeOnTheScreen();
  expect(screen.getByText("Ghost")).toBeOnTheScreen();
  expect(screen.getByText("Unsorted")).toBeOnTheScreen();
  expect(screen.getByText("2 tasks · 3 columns")).toBeOnTheScreen();
  // The two real columns are now empty.
  expect(screen.getAllByText("Nothing here yet.")).toHaveLength(2);
});

it("long-press then a column moves the task there", async () => {
  await mount();
  await fireEvent(await screen.findByText("Fix the gate"), "longPress");
  expect(screen.getByText("Move to column")).toBeOnTheScreen();
  // The sheet lists real columns only; its rows render after the board's headers.
  const rows = screen.getAllByText("Underway");
  await fireEvent.press(rows[rows.length - 1]!);
  await waitFor(() => expect(moveTaskColumn).toHaveBeenCalled());
  expect(jest.mocked(moveTaskColumn).mock.calls[0]![0]).toEqual({ TaskId: 100, ColumnId: 2, WorkspaceId: WS });
});

it("a refused move says why", async () => {
  jest.mocked(moveTaskColumn).mockRejectedValue(new Error("Blocked by a dependency"));
  await mount();
  await fireEvent(await screen.findByText("Fix the gate"), "longPress");
  const rows = screen.getAllByText("Underway");
  await fireEvent.press(rows[rows.length - 1]!);
  expect(await screen.findByText("Blocked by a dependency")).toBeOnTheScreen();
});

it("a member may move their own card but not someone else's", async () => {
  jest.mocked(fetchWorkspaces).mockResolvedValue([board("member")]);
  await mount();
  await fireEvent(await screen.findByText("Order cement"), "longPress");
  expect(screen.getByText("Cannot move this task")).toBeOnTheScreen();
  expect(screen.getByText("You can only move tasks you created or are assigned to.")).toBeOnTheScreen();
  await fireEvent(screen.getByText("Fix the gate"), "longPress");
  expect(screen.getByText("Move to column")).toBeOnTheScreen();
});

it("a member may move a card they created even when someone else is assigned", async () => {
  jest.mocked(fetchWorkspaces).mockResolvedValue([board("member")]);
  const created = task({ Id: 104, Title: "My idea", CreatedByUserId: ME, AssignedToUserId: 7, ColumnId: 2 });
  jest.mocked(fetchTasks).mockResolvedValue(tasksReply([theirTask, created]));
  await mount();
  await fireEvent(await screen.findByText("My idea"), "longPress");
  expect(screen.getByText("Move to column")).toBeOnTheScreen();
  const rows = screen.getAllByText("Backlog");
  await fireEvent.press(rows[rows.length - 1]!);
  await waitFor(() => expect(moveTaskColumn).toHaveBeenCalled());
  expect(jest.mocked(moveTaskColumn).mock.calls[0]![0]).toEqual({ TaskId: 104, ColumnId: 1, WorkspaceId: WS });
});

it("a manager gets column and settings shortcuts", async () => {
  const navigation = makeNavigation<"Board">();
  await mount(navigation);
  await screen.findByText("Fix the gate");
  await fireEvent.press(await screen.findByLabelText("Manage columns"));
  expect(navigation.navigate).toHaveBeenCalledWith("Columns", { workspaceId: WS });
  await fireEvent.press(screen.getByLabelText("Workspace settings"));
  expect(navigation.navigate).toHaveBeenLastCalledWith("WorkspaceSettings", { workspaceId: WS });
});

it("a member sees no management shortcuts, a viewer cannot add tasks", async () => {
  jest.mocked(fetchWorkspaces).mockResolvedValue([board("member")]);
  const { unmount } = await mount();
  await screen.findByText("Fix the gate");
  // WS-05: every member reaches settings (read-only roster, Leave); columns stay managers'.
  expect(screen.queryByLabelText("Manage columns")).toBeNull();
  expect(screen.getByLabelText("Workspace settings")).toBeOnTheScreen();
  expect(screen.getByLabelText(/^Add a task/)).toBeOnTheScreen();
  await unmount();

  jest.mocked(fetchWorkspaces).mockResolvedValue([board("viewer")]);
  await mount();
  await screen.findByText("Fix the gate");
  expect(screen.queryByLabelText(/^Add a task/)).toBeNull();
});

it("an admin outside the board gets both shortcuts on a shared board (WS-07)", async () => {
  seedAuth({ UserId: ME, access: access({ isAdmin: true }) });
  jest.mocked(fetchWorkspaces).mockResolvedValue([board(null, { MyInviteStatus: null })]);
  await mount();
  await screen.findByText("Fix the gate");
  expect(screen.getByLabelText("Manage columns")).toBeOnTheScreen();
  expect(screen.getByLabelText("Workspace settings")).toBeOnTheScreen();
});

/** Swipe the board so the column at `index` is the one on screen. */
const settleOn = async (index: number) => {
  const snap = Math.round(Dimensions.get("window").width * BOARD_COLUMN_RATIO) + spacing[3];
  // Fired on the first column's header; it bubbles to the horizontal list.
  await fireEvent(screen.getAllByText("Backlog")[0]!, "momentumScrollEnd", {
    nativeEvent: { contentOffset: { x: snap * index, y: 0 } },
  });
};

it("the FAB adds a task to the column on screen", async () => {
  const navigation = makeNavigation<"Board">();
  await mount(navigation);
  await screen.findByText("Fix the gate");
  await fireEvent.press(screen.getByLabelText("Add a task to Backlog"));
  expect(navigation.navigate).toHaveBeenCalledWith("TaskForm", { workspaceId: WS, columnId: 1 });
});

it("a middle column is where the FAB adds", async () => {
  jest.mocked(fetchKanbanColumns).mockResolvedValue([todo, doing, column(3, "Finished")]);
  const navigation = makeNavigation<"Board">();
  await mount(navigation);
  await screen.findByText("Fix the gate");
  await settleOn(1);
  await fireEvent.press(screen.getByLabelText("Add a task to Underway"));
  expect(navigation.navigate).toHaveBeenCalledWith("TaskForm", { workspaceId: WS, columnId: 2 });
});

it("in the last column the FAB adds to the first — a new task is open (COL-03)", async () => {
  const navigation = makeNavigation<"Board">();
  await mount(navigation);
  await screen.findByText("Fix the gate");
  await settleOn(1);
  // The label tells the truth about where it lands.
  await fireEvent.press(screen.getByLabelText("Add a task to Backlog"));
  expect(navigation.navigate).toHaveBeenCalledWith("TaskForm", { workspaceId: WS, columnId: 1 });
});

it("a one-column board adds to that column", async () => {
  jest.mocked(fetchKanbanColumns).mockResolvedValue([todo]);
  const navigation = makeNavigation<"Board">();
  await mount(navigation);
  await screen.findByText("Fix the gate");
  await fireEvent.press(screen.getByLabelText("Add a task to Backlog"));
  expect(navigation.navigate).toHaveBeenCalledWith("TaskForm", { workspaceId: WS, columnId: 1 });
});

it("from the Unsorted column the FAB lets the server place the task", async () => {
  jest.mocked(fetchTasks).mockResolvedValue(tasksReply([mineTask, orphan]));
  const navigation = makeNavigation<"Board">();
  await mount(navigation);
  await screen.findByText("Lost card");
  await settleOn(2);
  await fireEvent.press(screen.getByLabelText("Add a task to this board"));
  expect(navigation.navigate).toHaveBeenCalledWith("TaskForm", { workspaceId: WS, columnId: null });
});

it("a column with a limit shows n / max and flags when it is full (COL-02)", async () => {
  jest.mocked(fetchKanbanColumns).mockResolvedValue([
    { ...todo, MaxTasks: 1 },
    { ...doing, MaxTasks: 3 },
  ]);
  await mount();
  await screen.findByText("Fix the gate");
  expect(screen.getByText("1 / 1")).toBeOnTheScreen();
  expect(screen.getByLabelText("1 of 1 tasks, at the limit")).toBeOnTheScreen();
  expect(screen.getByText("1 / 3")).toBeOnTheScreen();
  expect(screen.queryByLabelText("1 of 3 tasks, at the limit")).toBeNull();
});

it("searching the board asks the server with SearchTerm (COL-04)", async () => {
  await mount();
  await screen.findByText("Fix the gate");
  expect(fetchTasks).toHaveBeenCalledWith(expect.objectContaining({ SearchTerm: null }));
  jest.mocked(fetchTasks).mockResolvedValue(tasksReply([theirTask]));
  await fireEvent.changeText(screen.getByPlaceholderText("Search this board"), "  cement ");
  await waitFor(() =>
    expect(fetchTasks).toHaveBeenLastCalledWith({ WorkspaceId: WS, PageSize: 200, SearchTerm: "cement" }),
  );
  await waitFor(() => expect(screen.queryByText("Fix the gate")).toBeNull());
  expect(screen.getByText("Order cement")).toBeOnTheScreen();
});

it("a move shows at once, before the server answers (COL-05)", async () => {
  let finish: (v: Awaited<ReturnType<typeof moveTaskColumn>>) => void = () => {};
  jest.mocked(moveTaskColumn).mockReturnValue(new Promise((resolve) => (finish = resolve)));
  await mount();
  await fireEvent(await screen.findByText("Fix the gate"), "longPress");
  expect(screen.queryByText("Nothing here yet.")).toBeNull();
  const rows = screen.getAllByText("Underway");
  await fireEvent.press(rows[rows.length - 1]!);
  // Backlog emptied while the request is still in flight.
  expect(await screen.findByText("Nothing here yet.")).toBeOnTheScreen();
  expect(screen.getByText("Fix the gate")).toBeOnTheScreen();
  finish(envelope(null));
  await waitFor(() => expect(fetchTasks).toHaveBeenCalledTimes(2));
});

it("a refused move puts the card back and says why (COL-05)", async () => {
  jest.mocked(fetchTasks)
    .mockResolvedValueOnce(tasksReply([mineTask, theirTask]))
    // The refetch after the error never lands, so only the rollback can restore the card.
    .mockReturnValue(new Promise(() => {}));
  let refuse: (e: Error) => void = () => {};
  jest.mocked(moveTaskColumn).mockReturnValue(new Promise((_, reject) => (refuse = reject)));
  await mount();
  await fireEvent(await screen.findByText("Fix the gate"), "longPress");
  const rows = screen.getAllByText("Underway");
  await fireEvent.press(rows[rows.length - 1]!);
  expect(await screen.findByText("Nothing here yet.")).toBeOnTheScreen();
  refuse(new Error("Blocked by a dependency"));
  expect(await screen.findByText("Blocked by a dependency")).toBeOnTheScreen();
  await waitFor(() => expect(screen.queryByText("Nothing here yet.")).toBeNull());
  expect(screen.getByText("Fix the gate")).toBeOnTheScreen();
});

it("a cardless, columnless board: managers are pointed at column setup", async () => {
  jest.mocked(fetchKanbanColumns).mockResolvedValue([]);
  jest.mocked(fetchTasks).mockResolvedValue(tasksReply([]));
  const navigation = makeNavigation<"Board">();
  await mount(navigation);
  expect(await screen.findByText("This board has no columns")).toBeOnTheScreen();
  expect(screen.getByText("Add a column to start placing tasks.")).toBeOnTheScreen();
  expect(screen.queryByLabelText(/^Add a task/)).toBeNull();
  await fireEvent.press(screen.getByText("Manage columns"));
  expect(navigation.navigate).toHaveBeenCalledWith("Columns", { workspaceId: WS });
});

it("a columnless board tells a member to ask the owner", async () => {
  jest.mocked(fetchKanbanColumns).mockResolvedValue([]);
  jest.mocked(fetchTasks).mockResolvedValue(tasksReply([]));
  jest.mocked(fetchWorkspaces).mockResolvedValue([board("member")]);
  await mount();
  expect(await screen.findByText("Ask the board's owner to set up its columns.")).toBeOnTheScreen();
});

it("before the workspace loads the route's name is the title", async () => {
  jest.mocked(fetchWorkspaces).mockResolvedValue([]);
  jest.mocked(fetchTasks).mockResolvedValue(tasksReply([mineTask]));
  jest.mocked(fetchKanbanColumns).mockResolvedValue([todo]);
  await mount();
  expect(await screen.findByText("1 task · 1 column")).toBeOnTheScreen();
  expect(screen.getByText("Site works")).toBeOnTheScreen();
});
