import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { deleteKanbanColumn, fetchKanbanColumns, saveKanbanColumn } from "../../api/kanbanQueries";
import { fetchTasks } from "../../api/taskQueries";
import type { KanbanColumn, Task } from "../../types/api";
import { envelope, pagination } from "../../test/fixtures";
import { makeNavigation, makeRoute, renderWithProviders, seedAuth } from "../../test/renderWithProviders";
import ColumnsScreen from "./ColumnsScreen";

jest.mock("../../api/kanbanQueries");
jest.mock("../../api/taskQueries");

// Lists arm VirtualizedList's 50 ms batch timer on every data change; under
// load it fired between waitFor polls, outside act(). Fake timers park it
// (RNTL's waitFor/findBy advance them).
jest.useFakeTimers();

const WS = 9;
const backlog = { Id: 1, Title: "Backlog", Color: "#112233", SortOrder: 1, MaxTasks: 5 } as KanbanColumn;
const underway = { Id: 2, Title: "Underway", Color: null, SortOrder: 2, MaxTasks: null } as KanbanColumn;

const task = (Id: number, ColumnId: number) => ({ Id, Title: `T${Id}`, ColumnId }) as Task;
const tasksReply = (tasks: Task[]) => envelope({ tasks, pagination: pagination(tasks.length) });

const mount = () =>
  renderWithProviders(
    <ColumnsScreen navigation={makeNavigation<"Columns">()} route={makeRoute("Columns", { workspaceId: WS })} />,
  );

/** The sheet renders its rows after the list, so the last match is the sheet's. */
const lastText = (text: string) => {
  const all = screen.getAllByText(text);
  return all[all.length - 1]!;
};

beforeEach(() => {
  seedAuth();
  jest.mocked(fetchKanbanColumns).mockResolvedValue([backlog, underway]);
  jest.mocked(fetchTasks).mockResolvedValue(tasksReply([task(10, 1), task(11, 1)]));
  jest.mocked(saveKanbanColumn).mockResolvedValue(envelope({ columnId: 3 }));
  jest.mocked(deleteKanbanColumn).mockResolvedValue(envelope(null));
});

it("lists the board's columns with their task counts", async () => {
  await mount();
  expect(await screen.findByText("2 tasks")).toBeOnTheScreen();
  expect(screen.getByText("0 tasks")).toBeOnTheScreen();
  expect(screen.getByText("2 columns")).toBeOnTheScreen();
  expect(fetchKanbanColumns).toHaveBeenCalledWith({ WorkspaceId: WS });
});

it("adds a column with a trimmed title", async () => {
  await mount();
  await screen.findByText("2 tasks");
  await fireEvent.press(screen.getByLabelText("Add a column"));
  expect(screen.getByText("New column")).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByPlaceholderText("To do"), "  Review  ");
  await fireEvent.press(screen.getByText("Add column"));
  await waitFor(() => expect(saveKanbanColumn).toHaveBeenCalled());
  // COL-01: SortOrder 0 makes sp_SaveKanbanColumn append at MAX+1. Sending
  // columns.length tied the last seeded column (orders 1..n).
  expect(jest.mocked(saveKanbanColumn).mock.calls[0]![0]).toEqual({
    Id: 0,
    WorkspaceId: WS,
    Title: "Review",
    Color: null,
    SortOrder: 0,
    MaxTasks: null,
    IsActive: true,
  });
});

it("a new column can carry a task limit (COL-02)", async () => {
  await mount();
  await screen.findByText("2 tasks");
  await fireEvent.press(screen.getByLabelText("Add a column"));
  await fireEvent.changeText(screen.getByPlaceholderText("To do"), "Review");
  await fireEvent.changeText(screen.getByPlaceholderText("Task limit (blank = none)"), " 4 ");
  await fireEvent.press(screen.getByText("Add column"));
  await waitFor(() => expect(saveKanbanColumn).toHaveBeenCalled());
  expect(jest.mocked(saveKanbanColumn).mock.calls[0]![0]).toEqual(expect.objectContaining({ MaxTasks: 4 }));
});

it("editing a limit: blank keeps it, 0 clears it (COL-02)", async () => {
  await mount();
  await screen.findByText("2 tasks");
  await fireEvent.press(screen.getByLabelText("Rename Backlog"));
  // The current limit is the placeholder, like the current name.
  await fireEvent.changeText(screen.getByPlaceholderText("Backlog"), "Icebox");
  await fireEvent.press(screen.getByText("Save"));
  await waitFor(() => expect(saveKanbanColumn).toHaveBeenCalledTimes(1));
  expect(jest.mocked(saveKanbanColumn).mock.calls[0]![0]).toEqual(expect.objectContaining({ MaxTasks: 5 }));

  await fireEvent.press(screen.getByLabelText("Rename Backlog"));
  await fireEvent.changeText(screen.getByPlaceholderText("Backlog"), "Icebox");
  await fireEvent.changeText(screen.getByPlaceholderText("Task limit: 5 (0 = none)"), "0");
  await fireEvent.press(screen.getByText("Save"));
  await waitFor(() => expect(saveKanbanColumn).toHaveBeenCalledTimes(2));
  expect(jest.mocked(saveKanbanColumn).mock.calls[1]![0]).toEqual(expect.objectContaining({ MaxTasks: null }));
});

it("a limit that is not a whole number is refused before any request (COL-02)", async () => {
  await mount();
  await screen.findByText("2 tasks");
  await fireEvent.press(screen.getByLabelText("Add a column"));
  await fireEvent.changeText(screen.getByPlaceholderText("To do"), "Review");
  await fireEvent.changeText(screen.getByPlaceholderText("Task limit (blank = none)"), "2.5");
  await fireEvent.press(screen.getByText("Add column"));
  expect(screen.getByText("The limit is a whole number of tasks, or 0 for none.")).toBeOnTheScreen();
  expect(saveKanbanColumn).not.toHaveBeenCalled();
});

it("a limit over 1000 is refused before it can overflow the column (COL-02)", async () => {
  await mount();
  await screen.findByText("2 tasks");
  await fireEvent.press(screen.getByLabelText("Add a column"));
  await fireEvent.changeText(screen.getByPlaceholderText("To do"), "Review");
  await fireEvent.changeText(screen.getByPlaceholderText("Task limit (blank = none)"), "99999999999");
  await fireEvent.press(screen.getByText("Add column"));
  expect(screen.getByText("A limit can be at most 1000 tasks.")).toBeOnTheScreen();
  expect(saveKanbanColumn).not.toHaveBeenCalled();
  // 1000 itself is fine.
  await fireEvent.changeText(screen.getByPlaceholderText("Task limit (blank = none)"), "1000");
  await fireEvent.press(screen.getByText("Add column"));
  await waitFor(() => expect(saveKanbanColumn).toHaveBeenCalled());
  expect(jest.mocked(saveKanbanColumn).mock.calls[0]![0]).toEqual(expect.objectContaining({ MaxTasks: 1000 }));
});

it("renaming sends every field back so nothing is blanked", async () => {
  await mount();
  await screen.findByText("2 tasks");
  await fireEvent.press(screen.getByLabelText("Rename Backlog"));
  expect(screen.getByText("Edit column")).toBeOnTheScreen();
  // The old name is the placeholder; the add-column default is gone.
  expect(screen.queryByPlaceholderText("To do")).toBeNull();
  await fireEvent.changeText(screen.getByPlaceholderText("Backlog"), "Icebox");
  await fireEvent.press(screen.getByText("Save"));
  await waitFor(() => expect(saveKanbanColumn).toHaveBeenCalled());
  expect(jest.mocked(saveKanbanColumn).mock.calls[0]![0]).toEqual({
    Id: 1,
    WorkspaceId: WS,
    Title: "Icebox",
    Color: "#112233",
    SortOrder: 1,
    MaxTasks: 5,
    IsActive: true,
  });
});

it("a refused save shows the server's reason in the sheet", async () => {
  jest.mocked(saveKanbanColumn).mockRejectedValue(new Error("A column with that name exists"));
  await mount();
  await screen.findByText("2 tasks");
  await fireEvent.press(screen.getByLabelText("Add a column"));
  await fireEvent.changeText(screen.getByPlaceholderText("To do"), "Backlog");
  await fireEvent.press(screen.getByText("Add column"));
  expect(await screen.findByText("A column with that name exists")).toBeOnTheScreen();
});

it("a blank title is never sent", async () => {
  await mount();
  await screen.findByText("2 tasks");
  await fireEvent.press(screen.getByLabelText("Add a column"));
  await fireEvent.changeText(screen.getByPlaceholderText("To do"), "   ");
  await fireEvent.press(screen.getByText("Add column"));
  expect(saveKanbanColumn).not.toHaveBeenCalled();
});

it("deleting an empty column confirms, then deletes without reassigning", async () => {
  await mount();
  await screen.findByText("2 tasks");
  await fireEvent.press(screen.getByLabelText("Delete Underway"));
  expect(screen.getByText('Delete "Underway"?')).toBeOnTheScreen();
  expect(screen.getByText("The column is empty, so nothing else changes.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByText("Delete"));
  await waitFor(() => expect(deleteKanbanColumn).toHaveBeenCalled());
  expect(jest.mocked(deleteKanbanColumn).mock.calls[0]![0]).toEqual({
    Id: 2,
    ReassignToColumnId: null,
    WorkspaceId: WS,
  });
  await waitFor(() => expect(screen.queryByText('Delete "Underway"?')).toBeNull());
});

it("deleting a column with tasks asks where they go first", async () => {
  await mount();
  await screen.findByText("2 tasks");
  await fireEvent.press(screen.getByLabelText("Delete Backlog"));
  // No confirmation until a destination is picked.
  expect(screen.queryByText('Delete "Backlog"?')).toBeNull();
  expect(screen.getByText("Move its tasks where?")).toBeOnTheScreen();
  await fireEvent.press(lastText("Underway"));
  expect(screen.getByText("Its 2 tasks will move to Underway.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByText("Delete"));
  await waitFor(() => expect(deleteKanbanColumn).toHaveBeenCalled());
  expect(jest.mocked(deleteKanbanColumn).mock.calls[0]![0]).toEqual({
    Id: 1,
    ReassignToColumnId: 2,
    WorkspaceId: WS,
  });
});

it("one task is singular in the reassign confirmation", async () => {
  jest.mocked(fetchTasks).mockResolvedValue(tasksReply([task(10, 1)]));
  await mount();
  await screen.findByText("1 task");
  await fireEvent.press(screen.getByLabelText("Delete Backlog"));
  await fireEvent.press(lastText("Underway"));
  expect(screen.getByText("Its 1 task will move to Underway.")).toBeOnTheScreen();
});

it("cancelling the confirmation deletes nothing", async () => {
  await mount();
  await screen.findByText("2 tasks");
  await fireEvent.press(screen.getByLabelText("Delete Underway"));
  await fireEvent.press(screen.getByText("Cancel"));
  expect(screen.queryByText('Delete "Underway"?')).toBeNull();
  expect(deleteKanbanColumn).not.toHaveBeenCalled();
});

it("a refused delete shows the server's reason", async () => {
  jest.mocked(deleteKanbanColumn).mockRejectedValue(new Error("Column is in use"));
  await mount();
  await screen.findByText("2 tasks");
  await fireEvent.press(screen.getByLabelText("Delete Underway"));
  await fireEvent.press(screen.getByText("Delete"));
  expect(await screen.findByText("Column is in use")).toBeOnTheScreen();
});

it("the last column cannot be deleted", async () => {
  jest.mocked(fetchKanbanColumns).mockResolvedValue([underway]);
  await mount();
  expect(await screen.findByText("1 column")).toBeOnTheScreen();
  expect(screen.getByLabelText("Rename Underway")).toBeOnTheScreen();
  expect(screen.queryByLabelText("Delete Underway")).toBeNull();
});

it("a board with no columns offers to add one", async () => {
  jest.mocked(fetchKanbanColumns).mockResolvedValue([]);
  jest.mocked(fetchTasks).mockResolvedValue(tasksReply([]));
  await mount();
  expect(await screen.findByText("No columns yet")).toBeOnTheScreen();
  await fireEvent.press(screen.getByText("Add a column"));
  expect(screen.getByText("New column")).toBeOnTheScreen();
});
