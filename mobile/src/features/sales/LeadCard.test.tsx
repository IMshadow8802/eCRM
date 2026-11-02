import { fireEvent, render, screen } from "@testing-library/react-native";

import { lead } from "../../test/fixtures";
import { LeadCard } from "./LeadCard";

it("shows who, how to reach them, status, an overdue follow-up and the value, and hands the row back", async () => {
  const onPress = jest.fn();
  const row = lead({
    NextFollowupDate: "2000-01-05T00:00:00",
    IsOverdue: true,
    EstValue: 150000,
    ProductName: "5 kW rooftop",
  });
  await render(<LeadCard lead={row} onPress={onPress} />);

  expect(screen.getByText("Ravi Patel")).toBeOnTheScreen();
  expect(screen.getByText("9825012345 · Patel Solar")).toBeOnTheScreen();
  expect(screen.getByText("Open")).toBeOnTheScreen();
  expect(screen.getByText("Overdue · 5 Jan 2000")).toBeOnTheScreen();
  expect(screen.getByText("Priya Shah")).toBeOnTheScreen();
  expect(screen.getByText("₹1,50,000")).toBeOnTheScreen();
  expect(screen.getByText("5 kW rooftop")).toBeOnTheScreen();

  await fireEvent.press(screen.getByText("Ravi Patel"));
  expect(onPress).toHaveBeenCalledWith(row);
});

it("a follow-up that is not overdue is just its day", async () => {
  await render(
    <LeadCard lead={lead({ NextFollowupDate: "2000-01-05T00:00:00" })} onPress={jest.fn()} />,
  );
  expect(screen.getByText("5 Jan 2000")).toBeOnTheScreen();
  expect(screen.queryByText(/^Overdue/)).toBeNull();
});

it("a converted lead has no next-date chip; no owner reads Unassigned; no value, no ₹", async () => {
  await render(
    <LeadCard
      lead={lead({
        StatusCode: "converted",
        StatusName: "Won",
        NextFollowupDate: "2000-01-05T00:00:00",
        IsOverdue: true,
        OwnerId: null,
        OwnerName: null,
      })}
      onPress={jest.fn()}
    />,
  );
  expect(screen.getByText("Won")).toBeOnTheScreen();
  expect(screen.queryByText(/Jan 2000/)).toBeNull();
  expect(screen.getByText("Unassigned")).toBeOnTheScreen();
  expect(screen.queryByText(/₹/)).toBeNull();
});

it("a bare row falls back to plain words", async () => {
  await render(
    <LeadCard
      lead={lead({ MobileNo: null, Company: null, StatusName: null, StatusCode: null })}
      onPress={jest.fn()}
    />,
  );
  expect(screen.getByText("No contact")).toBeOnTheScreen();
  expect(screen.getByText("—")).toBeOnTheScreen();
});
