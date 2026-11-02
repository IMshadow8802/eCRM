import { fireEvent, screen } from "@testing-library/react-native";

import { assigneesJson, localDay, makeTask } from "../../test/fixtures";
import { renderWithProviders } from "../../test/renderWithProviders";
import { TaskCard } from "./TaskCard";

// A TAT due time far enough ahead that the chip reads "Due …", whatever today is.
const FUTURE_TAT = "2099-01-01 10:00:00";

it("shows the facts sp_FetchTask returns", async () => {
  await renderWithProviders(
    <TaskCard
      onPress={jest.fn()}
      task={makeTask({
        Title: "Fix the inverter",
        Description: "Customer at sector 4",
        WorkspaceName: "Ops board",
        ColumnTitle: "Doing",
        ChecklistDone: 2,
        ChecklistTotal: 5,
        Priority: "high",
        LoggedHours: 1.5,
        EstimatedHours: 4,
        SubTaskCount: 3,
        BlockerCount: 2,
        DueDate: localDay(1),
      })}
    />,
  );
  for (const text of ["Fix the inverter", "Customer at sector 4", "Ops board", "Doing", "2 of 5", "high", "1.5h / 4h", "3", "2", "Due tomorrow"]) {
    expect(screen.getByText(text)).toBeOnTheScreen();
  }
});

it("leaves out what the task does not have", async () => {
  await renderWithProviders(
    <TaskCard onPress={jest.fn()} showWorkspace={false} task={makeTask({ WorkspaceName: "Ops board", ColumnTitle: null })} />,
  );
  expect(screen.queryByText("Ops board")).toBeNull();
  expect(screen.queryByText(/ of /)).toBeNull();
  expect(screen.queryByText(/^Due/)).toBeNull();
});

it("shows logged hours alone when there is no estimate", async () => {
  await renderWithProviders(<TaskCard onPress={jest.fn()} task={makeTask({ LoggedHours: 2 })} />);
  expect(screen.getByText("2h")).toBeOnTheScreen();
});

it("says how late an overdue task is", async () => {
  await renderWithProviders(<TaskCard onPress={jest.fn()} task={makeTask({ DueDate: localDay(-2) })} />);
  expect(screen.getByText("2 days overdue")).toBeOnTheScreen();
});

it("shows two assignees and counts the rest", async () => {
  await renderWithProviders(
    <TaskCard
      onPress={jest.fn()}
      task={makeTask({ AssigneesJson: assigneesJson([1, "Asha Rao"], [2, "Ravi Kumar"], [3, "Meena Shah"]) })}
    />,
  );
  expect(screen.getByText("AR")).toBeOnTheScreen();
  expect(screen.getByText("RK")).toBeOnTheScreen();
  expect(screen.queryByText("MS")).toBeNull();
  expect(screen.getByText("+1")).toBeOnTheScreen();
});

it("an open task with a TAT clock shows its chip", async () => {
  await renderWithProviders(<TaskCard onPress={jest.fn()} task={makeTask({ TatDueAt: FUTURE_TAT })} />);
  expect(screen.getByText(/^Due .* IST$/)).toBeOnTheScreen();
});

it("a finished task drops its TAT chip", async () => {
  // Completion is derived from the checklist; the server reports it as IsCompleted.
  await renderWithProviders(
    <TaskCard
      onPress={jest.fn()}
      task={makeTask({ TatDueAt: FUTURE_TAT, IsCompleted: true, ChecklistDone: 1, ChecklistTotal: 1 })}
    />,
  );
  expect(screen.queryByText(/IST$/)).toBeNull();
  expect(screen.getByText("1 of 1")).toBeOnTheScreen();
});

it("tap opens the task; long-press hands it to the board", async () => {
  const onPress = jest.fn();
  const onLongPress = jest.fn();
  const task = makeTask({ Id: 9, Title: "Tap me" });
  await renderWithProviders(<TaskCard task={task} onPress={onPress} onLongPress={onLongPress} />);
  await fireEvent.press(screen.getByText("Tap me"));
  expect(onPress).toHaveBeenCalledWith(task);
  await fireEvent(screen.getByText("Tap me"), "longPress");
  expect(onLongPress).toHaveBeenCalledWith(task);
});
