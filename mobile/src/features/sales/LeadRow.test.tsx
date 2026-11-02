import { fireEvent, render, screen } from "@testing-library/react-native";

import type { Lookup } from "../../types/api";
import { lead } from "../../test/fixtures";
import { flat } from "../../test/style";
import { badgeTones, colors } from "../../theme";
import { LeadRow } from "./LeadRow";

const st = (Id: number, Code: string, SortOrder: number, Value = Code) => ({ Id, Code, SortOrder, Value }) as Lookup;
const STATUSES = [st(1, "open", 1, "New"), st(2, "open", 2, "Contacted"), st(3, "open", 3, "Proposal"), st(4, "qualified", 4), st(6, "lost", 6)];

const badgeFill = () => flat(screen.getByTestId("lead-badge")).backgroundColor;

it("E 14 row: badge by status, name and ₹ amount, company · product with the status pill, the follow-up line", async () => {
  const onPress = jest.fn();
  const row = lead({
    StatusId: 2,
    StatusName: "Contacted",
    EstValue: 240000,
    ProductName: "Inverter 10 kVA",
    NextFollowupDate: "2000-01-05T17:00:00",
    IsOverdue: true,
  });
  await render(<LeadRow lead={row} statuses={STATUSES} onPress={onPress} />);

  expect(screen.getByText("Ravi Patel")).toBeOnTheScreen();
  expect(screen.getByText("₹2,40,000")).toBeOnTheScreen();
  expect(screen.getByText("Patel Solar · Inverter 10 kVA")).toBeOnTheScreen();
  expect(screen.getByText("Contacted")).toBeOnTheScreen();
  // G1: the second open-coded status is the teal phone.
  expect(badgeFill()).toBe(badgeTones.teal.fill);
  const line = screen.getByText("Follow-up overdue · Wed, 5 Jan 5:00 pm");
  expect(flat(line).color).toBe(colors.dangerText);

  await fireEvent.press(screen.getByText("Ravi Patel"));
  expect(onPress).toHaveBeenCalledWith(row);
});

it("no follow-up reads muted; no value shows no ₹; no company or product, no meta", async () => {
  await render(<LeadRow lead={lead({ Company: null })} statuses={STATUSES} onPress={jest.fn()} />);
  expect(flat(screen.getByText("No follow-up planned")).color).toBe(colors.textMuted);
  expect(screen.queryByText(/₹/)).toBeNull();
  expect(badgeFill()).toBe(badgeTones.sky.fill);
});

it("a lost row: muted name and amount, the reason and the day it was lost instead of a follow-up", async () => {
  await render(
    <LeadRow
      lead={lead({ StatusId: 6, StatusCode: "lost", StatusName: "Lost", EstValue: 210000, LostReason: "Price too high", LostAt: "2026-10-30T12:00:00" })}
      statuses={STATUSES}
      onPress={jest.fn()}
    />,
  );
  expect(flat(screen.getByText("Ravi Patel")).color).toBe(colors.textSecondary);
  // ListRow's muted amount is Ink 2 (E draws Ink 3; ui/ is not ours to change).
  expect(flat(screen.getByText("₹2,10,000")).color).toBe(colors.textSecondary);
  expect(screen.getByText("Price too high · Fri, 30 Oct")).toBeOnTheScreen();
  expect(screen.queryByText("No follow-up planned")).toBeNull();
  expect(badgeFill()).toBe(badgeTones.red.fill);
});

it("a lost row with no reason or date still says Lost", async () => {
  await render(<LeadRow lead={lead({ StatusCode: "lost", StatusName: "Lost" })} statuses={[]} onPress={jest.fn()} selected />);
  expect(screen.getAllByText("Lost")).toHaveLength(2);
});
