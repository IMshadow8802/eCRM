import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { deleteTaskTimeEntry, getTaskTimeEntries } from "../../api/taskQueries";
import type { TaskTimeEntry } from "../../types/api";
import { envelope, serverError } from "../../test/fixtures";
import { renderWithProviders } from "../../test/renderWithProviders";
import { chipTones } from "../../theme";
import { TimeSheet } from "./TimeSheet";

jest.mock("../../api/taskQueries");

const ME = 42;
const entry = (patch: Partial<TaskTimeEntry>): TaskTimeEntry => ({
  Id: 1,
  TaskId: 1,
  TaskTitle: null,
  UserId: ME,
  UserName: "Asha Rao",
  Hours: 1.5,
  Description: "Site visit",
  WorkDate: null,
  CreatedDate: new Date().toISOString(),
  ...patch,
});

const mount = (props: Partial<{ canManageAny: boolean; scopedToMe: boolean; userId: number | null }> = {}) =>
  renderWithProviders(
    <TimeSheet taskId={1} workspaceId={10} userId={ME} canManageAny={false} scopedToMe {...props} />,
  );

beforeEach(() => {
  jest.mocked(getTaskTimeEntries).mockResolvedValue([
    entry({ Id: 1, Hours: 1.5 }),
    entry({ Id: 2, UserId: 7, UserName: null, Hours: 2, Description: null }),
  ]);
  jest.mocked(deleteTaskTimeEntry).mockResolvedValue(envelope(null));
});

it("totals the entries and names who booked them", async () => {
  await mount({ scopedToMe: false });
  expect(await screen.findByText("3.5h across 2 entries")).toBeOnTheScreen();
  expect(getTaskTimeEntries).toHaveBeenCalledWith({ TaskId: 1, PageSize: 50 });
  expect(screen.getByText("Time logged")).toBeOnTheScreen();
  expect(screen.getByText("Site visit")).toBeOnTheScreen();
  expect(screen.getByText("No note")).toBeOnTheScreen();
  expect(screen.getByText(/^Someone · /)).toBeOnTheScreen();
});

it("each entry's hours sit in a primary sorbet chip", async () => {
  await mount({ scopedToMe: false });
  await screen.findByText("3.5h across 2 entries");
  const hours = screen.getByText("2h");
  expect(hours).toHaveStyle({ color: chipTones.primary.text });
  expect(hours.parent).toHaveStyle({ backgroundColor: chipTones.primary.fill });
});

it("a member is told the list is only their own time", async () => {
  jest.mocked(getTaskTimeEntries).mockResolvedValue([entry({ Hours: 1 })]);
  await mount({ scopedToMe: true });
  expect(await screen.findByText("1h across 1 entry")).toBeOnTheScreen();
  expect(screen.getByText("Your time")).toBeOnTheScreen();
});

it("offers delete on my own entries only", async () => {
  await mount();
  await screen.findByText("Site visit");
  expect(screen.getAllByLabelText("Delete this time entry")).toHaveLength(1);
  await fireEvent.press(screen.getByLabelText("Delete this time entry"));
  await waitFor(() => expect(deleteTaskTimeEntry).toHaveBeenCalled());
  expect(jest.mocked(deleteTaskTimeEntry).mock.calls[0]![0]).toEqual({ Id: 1, TaskId: 1, WorkspaceId: 10 });
});

it("an owner or manager may delete anyone's entry", async () => {
  await mount({ canManageAny: true });
  await screen.findByText("Site visit");
  expect(screen.getAllByLabelText("Delete this time entry")).toHaveLength(2);
});

it("a signed-out caller owns no entry", async () => {
  await mount({ userId: null });
  await screen.findByText("Site visit");
  expect(screen.queryByLabelText("Delete this time entry")).toBeNull();
});

it("a refused delete shows the server's reason", async () => {
  jest.mocked(deleteTaskTimeEntry).mockRejectedValue(serverError(403, "You can only delete your own time"));
  await mount();
  await screen.findByText("Site visit");
  await fireEvent.press(screen.getByLabelText("Delete this time entry"));
  expect(await screen.findByText("You can only delete your own time")).toBeOnTheScreen();
});

it("an empty log says whose time is missing", async () => {
  jest.mocked(getTaskTimeEntries).mockResolvedValue([]);
  await mount({ scopedToMe: true });
  expect(await screen.findByText("You have not booked any time against this task.")).toBeOnTheScreen();
  expect(screen.getByText("0h across 0 entries")).toBeOnTheScreen();
});

it("an empty team log says so", async () => {
  jest.mocked(getTaskTimeEntries).mockResolvedValue([]);
  await mount({ scopedToMe: false });
  expect(await screen.findByText("No time booked against this task yet.")).toBeOnTheScreen();
});
