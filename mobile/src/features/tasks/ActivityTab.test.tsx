import { screen } from "@testing-library/react-native";

import { getTaskActivity } from "../../api/taskQueries";
import type { TaskActivityEntry } from "../../types/api";
import { renderWithProviders } from "../../test/renderWithProviders";
import ActivityTab from "./ActivityTab";

jest.mock("../../api/taskQueries");

const row = (patch: Partial<TaskActivityEntry>): TaskActivityEntry => ({
  Id: 1,
  TaskId: 1,
  UserId: 5,
  UserName: "Asha Rao",
  Action: "created",
  OldValue: null,
  NewValue: null,
  Description: null,
  CreatedDate: new Date().toISOString(),
  ...patch,
});

it("lists what happened, with who and the change", async () => {
  jest.mocked(getTaskActivity).mockResolvedValue([
    row({ Id: 1, Action: "created", Description: "Task created" }),
    row({ Id: 2, Action: "column_moved", OldValue: "To do", NewValue: "Doing", UserName: null }),
    row({ Id: 3, Action: "updated", OldValue: "x", NewValue: "x", Description: "Title edited" }),
    row({ Id: 4, Action: "something_new" }),
  ]);
  await renderWithProviders(<ActivityTab taskId={1} />);

  expect(await screen.findByText("Task created")).toBeOnTheScreen();
  expect(getTaskActivity).toHaveBeenCalledWith({ TaskId: 1 });
  expect(screen.getByText("column_moved · To do → Doing")).toBeOnTheScreen();
  expect(screen.getByText(/^System · /)).toBeOnTheScreen();
  // An unchanged value is not a change worth an arrow.
  expect(screen.getByText("Title edited")).toBeOnTheScreen();
  // An action the app has never heard of still shows up.
  expect(screen.getByText("something_new")).toBeOnTheScreen();
  expect(screen.getByText("Start of history")).toBeOnTheScreen();
});

it("an empty log says nothing has happened yet", async () => {
  jest.mocked(getTaskActivity).mockResolvedValue([]);
  await renderWithProviders(<ActivityTab taskId={1} />);
  expect(await screen.findByText("No history yet")).toBeOnTheScreen();
});
