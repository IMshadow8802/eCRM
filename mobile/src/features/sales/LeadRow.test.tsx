import { fireEvent, render, screen } from "@testing-library/react-native";

import type { Lookup } from "../../types/api";
import { lead } from "../../test/fixtures";
import { flat } from "../../test/style";
import { badgeTones, colors, metrics } from "../../theme";
import { LeadRow } from "./LeadRow";

// The four line icons become named views so a test can tell them apart.
jest.mock("lucide-react-native", () => {
  const actual = jest.requireActual("lucide-react-native");
  const { createElement } = jest.requireActual("react");
  const { View } = jest.requireActual("react-native");
  const stub = (name: string) => (p: { size?: number }) => createElement(View, { testID: `icon-${name}-${p.size}` });
  return { ...actual, CalendarClock: stub("CalendarClock"), MapPin: stub("MapPin"), Phone: stub("Phone"), Users: stub("Users") };
});

/** The follow-up line's icon: the one drawn at the line's size (the badge has its own). */
const lineIcon = (name: string) => screen.queryAllByTestId(`icon-${name}-${metrics.iconSm}`);

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

describe("G2: the follow-up's type (sp_FetchLeads.NextFollowupType, 119)", () => {
  // Far future, so "today"/"tomorrow" never apply and the line is stable.
  const DUE = "2099-01-05T11:00:00";

  it.each([
    ["call", "Call", "Phone"],
    ["visit", "Visit", "MapPin"],
    ["meeting", "Meeting", "Users"],
  ] as const)("%s names the line and draws its icon", async (type, word, Icon) => {
    await render(<LeadRow lead={lead({ NextFollowupDate: DUE, NextFollowupType: type })} statuses={STATUSES} onPress={jest.fn()} />);
    expect(screen.getByText(new RegExp(`^${word} .*11:00 am$`))).toBeOnTheScreen();
    expect(screen.queryByText(/^Follow-up /)).toBeNull();
    expect(lineIcon(Icon)).toHaveLength(1);
    expect(lineIcon("CalendarClock")).toHaveLength(0);
  });

  it("an overdue visit keeps the danger tone", async () => {
    await render(
      <LeadRow
        lead={lead({ NextFollowupDate: "2000-01-05T17:00:00", IsOverdue: true, NextFollowupType: "visit" })}
        statuses={STATUSES}
        onPress={jest.fn()}
      />,
    );
    expect(flat(screen.getByText("Visit overdue · Wed, 5 Jan 5:00 pm")).color).toBe(colors.dangerText);
  });

  it.each([
    ["absent (a DB without 119)", undefined],
    ["null", null],
    ["other", "other"],
  ] as const)("type %s falls back to Follow-up and the calendar icon", async (_, type) => {
    await render(<LeadRow lead={lead({ NextFollowupDate: DUE, NextFollowupType: type })} statuses={STATUSES} onPress={jest.fn()} />);
    expect(screen.getByText(/^Follow-up .*11:00 am$/)).toBeOnTheScreen();
    expect(lineIcon("CalendarClock")).toHaveLength(1);
  });

  it("a closed lead with a stale type still says No follow-up planned", async () => {
    await render(
      <LeadRow lead={lead({ StatusCode: "converted", NextFollowupDate: DUE, NextFollowupType: "call" })} statuses={STATUSES} onPress={jest.fn()} />,
    );
    expect(screen.getByText("No follow-up planned")).toBeOnTheScreen();
    expect(lineIcon("CalendarClock")).toHaveLength(1);
    expect(lineIcon("Phone")).toHaveLength(0);
  });
});
