import { Dimensions } from "react-native";
import { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";

import { fetchKanbanColumns } from "../../api/kanbanQueries";
import { fetchTasks, moveTaskColumn } from "../../api/taskQueries";
import { fetchWorkspaces } from "../../api/workspaceQueries";
import type { KanbanColumn, Task, Workspace, WorkspaceRole } from "../../types/api";
import { access, envelope, pagination } from "../../test/fixtures";
import { makeNavigation, makeRoute, renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import { colors } from "../../theme";
import { BOARD_GAP, boardColumnWidth } from "../../ui/BoardColumns";
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

const mount = (navigation = makeNavigation<"Board">(), queryClient?: QueryClient) =>
  renderWithProviders(
    <BoardScreen navigation={navigation} route={makeRoute("Board", { workspaceId: WS, name: "Site works" })} />,
    { queryClient },
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
  expect(screen.getByText("Shared · you are owner")).toBeOnTheScreen();
  expect(screen.getByRole("tab", { name: "Backlog, 1", selected: true })).toBeOnTheScreen();
  expect(screen.getByRole("tab", { name: "Underway, 1" })).toBeOnTheScreen();
  expect(screen.getByLabelText("Page 1 of 2")).toBeOnTheScreen();
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
  expect(screen.getByRole("tab", { name: "Unsorted, 2" })).toBeOnTheScreen();
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
  await fireEvent.press(screen.getByRole("button", { name: "Board options" }));
  await fireEvent.press(screen.getByText("Manage columns"));
  expect(navigation.navigate).toHaveBeenCalledWith("Columns", { workspaceId: WS });
  await fireEvent.press(screen.getByText("Workspace settings"));
  expect(navigation.navigate).toHaveBeenLastCalledWith("WorkspaceSettings", { workspaceId: WS });
});

it("a member sees no management shortcuts, a viewer cannot add tasks", async () => {
  jest.mocked(fetchWorkspaces).mockResolvedValue([board("member")]);
  const { unmount } = await mount();
  await screen.findByText("Fix the gate");
  // WS-05: every member reaches settings (read-only roster, Leave); columns stay managers'.
  await fireEvent.press(screen.getByRole("button", { name: "Board options" }));
  expect(screen.queryByText("Manage columns")).toBeNull();
  expect(screen.getByText("Workspace settings")).toBeOnTheScreen();
  expect(screen.getAllByLabelText(/^Add a task/).length).toBeGreaterThan(0);
  await unmount();

  jest.mocked(fetchWorkspaces).mockResolvedValue([board("viewer")]);
  await mount();
  await screen.findByText("Fix the gate");
  expect(screen.queryByLabelText(/^Add a task/)).toBeNull();
  expect(screen.queryByLabelText(/^New task in/)).toBeNull();
});

it("an admin outside the board gets both shortcuts on a shared board (WS-07)", async () => {
  seedAuth({ UserId: ME, access: access({ isAdmin: true }) });
  jest.mocked(fetchWorkspaces).mockResolvedValue([board(null, { MyInviteStatus: null })]);
  await mount();
  await screen.findByText("Fix the gate");
  await fireEvent.press(screen.getByRole("button", { name: "Board options" }));
  expect(screen.getByText("Manage columns")).toBeOnTheScreen();
  expect(screen.getByText("Workspace settings")).toBeOnTheScreen();
});

it("someone outside a board with no role gets no options menu", async () => {
  jest.mocked(fetchWorkspaces).mockResolvedValue([board(null, { MyInviteStatus: null })]);
  await mount();
  await screen.findByText("Fix the gate");
  expect(screen.queryByRole("button", { name: "Board options" })).toBeNull();
});

/** Swipe the board so the column at `index` is the one on screen. */
const settleOn = async (index: number) => {
  const snap = boardColumnWidth(Dimensions.get("window").width) + BOARD_GAP;
  // Fired on the first column's header; it bubbles to the horizontal list.
  await fireEvent(within(screen.getByTestId("column-1")).getByText("Backlog"), "momentumScrollEnd", {
    nativeEvent: { contentOffset: { x: snap * index, y: 0 } },
  });
};

const col = (id: number) => within(screen.getByTestId(`column-${id}`));

it("each column's Add task adds there; the header plus does too", async () => {
  jest.mocked(fetchKanbanColumns).mockResolvedValue([todo, doing, column(3, "Finished")]);
  const navigation = makeNavigation<"Board">();
  await mount(navigation);
  await screen.findByText("Fix the gate");
  await fireEvent.press(col(1).getByLabelText("Add a task to Backlog"));
  expect(navigation.navigate).toHaveBeenLastCalledWith("TaskForm", { workspaceId: WS, columnId: 1 });
  await fireEvent.press(col(2).getByLabelText("Add a task to Underway"));
  expect(navigation.navigate).toHaveBeenLastCalledWith("TaskForm", { workspaceId: WS, columnId: 2 });
  await fireEvent.press(col(2).getByLabelText("New task in Underway"));
  expect(navigation.navigate).toHaveBeenLastCalledWith("TaskForm", { workspaceId: WS, columnId: 2 });
  expect(col(1).getByText("Add task")).toBeOnTheScreen();
});

it("in the last column Add task adds to the first — a new task is open (COL-03)", async () => {
  const navigation = makeNavigation<"Board">();
  await mount(navigation);
  await screen.findByText("Fix the gate");
  // The label tells the truth about where it lands.
  await fireEvent.press(col(2).getByLabelText("Add a task to Backlog"));
  expect(navigation.navigate).toHaveBeenCalledWith("TaskForm", { workspaceId: WS, columnId: 1 });
});

it("a one-column board adds to that column, with no page dots", async () => {
  jest.mocked(fetchKanbanColumns).mockResolvedValue([todo]);
  jest.mocked(fetchTasks).mockResolvedValue(tasksReply([mineTask]));
  const navigation = makeNavigation<"Board">();
  await mount(navigation);
  await screen.findByText("Fix the gate");
  await fireEvent.press(screen.getByLabelText("Add a task to Backlog"));
  expect(navigation.navigate).toHaveBeenCalledWith("TaskForm", { workspaceId: WS, columnId: 1 });
  expect(screen.queryByLabelText(/^Page /)).toBeNull();
});

it("from the Unsorted column Add task lets the server place the task", async () => {
  jest.mocked(fetchTasks).mockResolvedValue(tasksReply([mineTask, orphan]));
  const navigation = makeNavigation<"Board">();
  await mount(navigation);
  await screen.findByText("Lost card");
  await fireEvent.press(col(-1).getByLabelText("Add a task to this board"));
  expect(navigation.navigate).toHaveBeenCalledWith("TaskForm", { workspaceId: WS, columnId: null });
});

it("a swipe moves the band tab and the page dots with it", async () => {
  await mount();
  await screen.findByText("Fix the gate");
  await settleOn(1);
  expect(screen.getByRole("tab", { name: "Underway, 1", selected: true })).toBeOnTheScreen();
  expect(screen.getByLabelText("Page 2 of 2")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("tab", { name: "Backlog, 1" }));
  expect(screen.getByRole("tab", { name: "Backlog, 1", selected: true })).toBeOnTheScreen();
});

it("G8: the first column is to do; the last is done once every card in it is", async () => {
  jest.mocked(fetchTasks).mockResolvedValue(tasksReply([mineTask, { ...theirTask, IsCompleted: true }]));
  jest.mocked(fetchKanbanColumns).mockResolvedValue([todo, column(3, "Middle"), doing]);
  await mount();
  await screen.findByText("Fix the gate");
  expect(col(1).getByTestId("column-stage-todo")).toBeOnTheScreen();
  expect(col(3).getByTestId("column-stage-inProgress")).toBeOnTheScreen();
  expect(col(2).getByTestId("column-stage-done")).toBeOnTheScreen();
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
  expect(screen.getByText("1 / 1")).toHaveStyle({ color: colors.dangerText });
  expect(screen.getByText("1 / 3")).toHaveStyle({ color: colors.textSecondary });
  expect(screen.queryByLabelText("1 of 3 tasks, at the limit")).toBeNull();
});

it("searching the board asks the server with SearchTerm (COL-04)", async () => {
  await mount();
  await screen.findByText("Fix the gate");
  expect(fetchTasks).toHaveBeenCalledWith(expect.objectContaining({ SearchTerm: null }));
  jest.mocked(fetchTasks).mockResolvedValue(tasksReply([theirTask]));
  await fireEvent.press(screen.getByRole("button", { name: "Search this board" }));
  await fireEvent.changeText(screen.getByPlaceholderText("Search this board"), "  cement ");
  await waitFor(() =>
    expect(fetchTasks).toHaveBeenLastCalledWith({ WorkspaceId: WS, PageSize: 200, SearchTerm: "cement" }),
  );
  await waitFor(() => expect(screen.queryByText("Fix the gate")).toBeNull());
  expect(screen.getByText("Order cement")).toBeOnTheScreen();
});

it("closing the search clears it", async () => {
  await mount();
  await screen.findByText("Fix the gate");
  await fireEvent.press(screen.getByRole("button", { name: "Search this board" }));
  await fireEvent.changeText(screen.getByPlaceholderText("Search this board"), "cement");
  await fireEvent.press(screen.getByRole("button", { name: "Close search" }));
  expect(screen.queryByPlaceholderText("Search this board")).toBeNull();
  await waitFor(() => expect(fetchTasks).toHaveBeenLastCalledWith(expect.objectContaining({ SearchTerm: null })));
});

it("quick typing sends one search, for the final term", async () => {
  await mount();
  await screen.findByText("Fix the gate");
  await fireEvent.press(screen.getByRole("button", { name: "Search this board" }));
  const box = screen.getByPlaceholderText("Search this board");
  await fireEvent.changeText(box, "c");
  await act(() => jest.advanceTimersByTime(100));
  await fireEvent.changeText(box, "ce");
  await act(() => jest.advanceTimersByTime(100));
  await fireEvent.changeText(box, "cem");
  await waitFor(() => expect(fetchTasks).toHaveBeenLastCalledWith(expect.objectContaining({ SearchTerm: "cem" })));
  const terms = jest.mocked(fetchTasks).mock.calls.map(([p]) => p?.SearchTerm);
  expect(terms).toEqual([null, "cem"]);
});

it("the old cards stay on screen while a search loads", async () => {
  await mount();
  await screen.findByText("Fix the gate");
  jest.mocked(fetchTasks).mockReturnValue(new Promise(() => {}));
  await fireEvent.press(screen.getByRole("button", { name: "Search this board" }));
  await fireEvent.changeText(screen.getByPlaceholderText("Search this board"), "cement");
  await waitFor(() => expect(fetchTasks).toHaveBeenLastCalledWith(expect.objectContaining({ SearchTerm: "cement" })));
  expect(screen.getByText("Fix the gate")).toBeOnTheScreen();
  expect(screen.getByText("Order cement")).toBeOnTheScreen();
  expect(screen.queryByText("Nothing here yet.")).toBeNull();
});

it("with no search the board shares the task screen's cache entry", async () => {
  // gcTime Infinity: no collection timer, and the seeded entry survives to mount.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  queryClient.setQueryData(["tasks", "board", WS], tasksReply([task({ Id: 200, Title: "Cached card" })]));
  jest.mocked(fetchTasks).mockReturnValue(new Promise(() => {}));
  await mount(makeNavigation<"Board">(), queryClient);
  expect(await screen.findByText("Cached card")).toBeOnTheScreen();
  queryClient.clear();
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
  await fireEvent.press(screen.getAllByText("Manage columns")[0]!);
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
  expect(await screen.findByText("Fix the gate")).toBeOnTheScreen();
  expect(screen.getByRole("header", { name: "Site works" })).toBeOnTheScreen();
});
