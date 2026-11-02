import { fireEvent, screen } from "@testing-library/react-native";

import { assigneesJson, makeTask } from "../../test/fixtures";
import { renderWithProviders } from "../../test/renderWithProviders";
import { TaskCard } from "./TaskCard";
import { TaskRow } from "./TaskRow";

jest.useFakeTimers();
beforeEach(() => jest.setSystemTime(new Date("2026-11-02T12:00:00+05:30")));

describe("TaskCard (07, a board card)", () => {
  it("title, priority, due chip, steps and assignees", async () => {
    await renderWithProviders(
      <TaskCard
        task={makeTask({ Title: "Call back Arora Traders", Priority: "high", DueDate: "2026-11-03", ChecklistDone: 0, ChecklistTotal: 3, AssigneesJson: assigneesJson([1, "Ayush Mishra"]) })}
        onPress={jest.fn()}
      />,
    );
    expect(screen.getByText("Call back Arora Traders")).toBeOnTheScreen();
    expect(screen.getByText("High")).toBeOnTheScreen();
    expect(screen.getByText("Tue, 3 Nov")).toBeOnTheScreen();
    expect(screen.getByLabelText("0 of 3 steps")).toBeOnTheScreen();
    expect(screen.getByText("0/3")).toBeOnTheScreen();
    expect(screen.getByText("AM")).toBeOnTheScreen();
  });

  it("a missed clock reads Missed; nothing optional is drawn when absent", async () => {
    await renderWithProviders(<TaskCard task={makeTask({ Priority: null, TatDueAt: "2026-11-02 11:00:00", ChecklistTotal: 0 })} onPress={jest.fn()} />);
    expect(screen.getByText("Missed")).toBeOnTheScreen();
    expect(screen.queryByText(/\/\d/)).toBeNull();
  });

  it("tap opens; long-press hands the task to Move to…", async () => {
    const onPress = jest.fn();
    const onLongPress = jest.fn();
    const task = makeTask({ Id: 9 });
    await renderWithProviders(<TaskCard task={task} onPress={onPress} onLongPress={onLongPress} />);
    await fireEvent.press(screen.getByTestId("task-card-9"));
    expect(onPress).toHaveBeenCalledWith(task);
    await fireEvent(screen.getByTestId("task-card-9"), "longPress");
    expect(onLongPress).toHaveBeenCalledWith(task);
  });
});

describe("TaskRow (05)", () => {
  it("stage badge, priority, workspace · column, steps, chip and people", async () => {
    const onPress = jest.fn();
    const task = makeTask({
      Title: "BITME", WorkspaceName: "Website Revamp", ColumnTitle: "In Progress", Priority: "medium",
      ChecklistDone: 11, ChecklistTotal: 12, TatDueAt: "2026-11-02 15:00:00", AssigneesJson: assigneesJson([1, "Ayush Mishra"]),
    });
    await renderWithProviders(<TaskRow task={task} onPress={onPress} first />);
    expect(screen.getByTestId("stage-inProgress")).toBeOnTheScreen();
    expect(screen.getByText("Medium")).toBeOnTheScreen();
    expect(screen.getByText("Website Revamp · In Progress")).toBeOnTheScreen();
    expect(screen.getByText("11 of 12")).toBeOnTheScreen();
    expect(screen.getByRole("progressbar")).toBeOnTheScreen();
    expect(screen.getByText("Due in 3 h")).toBeOnTheScreen();
    expect(screen.queryByTestId("row-separator")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "BITME, In progress" }));
    expect(onPress).toHaveBeenCalledWith(task);
  });

  it("a personal to-do with no steps or people: Personal chip, no bar, a separator", async () => {
    await renderWithProviders(<TaskRow task={makeTask({ ChecklistTotal: 0, ChecklistDone: 0, AssigneesJson: null, AssignedToUserId: null })} onPress={jest.fn()} personal />);
    expect(screen.getByTestId("stage-todo")).toBeOnTheScreen();
    expect(screen.getByText("Personal")).toBeOnTheScreen();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByTestId("row-separator")).toBeOnTheScreen();
  });

  it("a finished task with no date and nobody on it has no third line", async () => {
    await renderWithProviders(<TaskRow task={makeTask({ IsCompleted: true, DueDate: null, AssigneesJson: null, AssignedToUserId: null })} onPress={jest.fn()} />);
    expect(screen.getByTestId("stage-done")).toBeOnTheScreen();
    expect(screen.queryByText("Personal")).toBeNull();
    expect(screen.queryByLabelText(/people/)).toBeNull();
  });
});
