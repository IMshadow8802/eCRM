import { fireEvent, render, screen } from "@testing-library/react-native";

import { ticket } from "../../test/fixtures";
import { ComplaintCard } from "./ComplaintCard";

it("shows the urgency chips and who holds it, and hands the row back on press", async () => {
  const onPress = jest.fn();
  const row = ticket({
    PriorityName: "High",
    DueAt: "2000-01-01T00:00:00",
    IsOverdue: true,
    EscalatedTo: 50,
    AssigneeName: "Priya Shah",
  });
  await render(<ComplaintCard ticket={row} onPress={onPress} />);

  expect(screen.getByText("Inverter keeps tripping")).toBeOnTheScreen();
  expect(screen.getByText("Sharma Traders")).toBeOnTheScreen();
  expect(screen.getByText("Open")).toBeOnTheScreen();
  expect(screen.getByText("High")).toBeOnTheScreen();
  expect(screen.getByText(/^Overdue by/)).toBeOnTheScreen();
  expect(screen.getByText("Escalated")).toBeOnTheScreen();
  expect(screen.getByText("Priya Shah")).toBeOnTheScreen();

  await fireEvent.press(screen.getByText("Inverter keeps tripping"));
  expect(onPress).toHaveBeenCalledWith(row);
});

it("a bare row falls back to plain words, with no clock once it is closed", async () => {
  await render(
    <ComplaintCard
      ticket={ticket({
        CustomerName: null,
        StatusName: null,
        StatusCode: "closed",
        DueAt: "2000-01-01T00:00:00",
      })}
      onPress={jest.fn()}
    />,
  );
  expect(screen.getByText("Unnamed customer")).toBeOnTheScreen();
  // The status chip falls back to the Code, never to a guessed label.
  expect(screen.getByText("closed")).toBeOnTheScreen();
  expect(screen.getByText("Unassigned")).toBeOnTheScreen();
  expect(screen.queryByText(/^Overdue|^Due in/)).toBeNull();
  expect(screen.queryByText("Escalated")).toBeNull();
});
