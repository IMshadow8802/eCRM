import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AttendanceGrid, { halves } from "./AttendanceGrid";
import renderWithProviders from "../../test/renderWithProviders";

const CODES = [
  ["on_time", 0, "✓", "On time"],
  ["late", 14, "14", "Late 14 minutes"],
  ["absent", 0, "A", "Absent"],
  ["leave", 0, "LV", "On leave"],
  ["half", 0, "½", "Half-day leave"],
  ["on_duty", 0, "OD", "On duty"],
  ["holiday", 0, "HO", "Holiday"],
  ["off", 0, "–", "Weekly off"],
  ["future", 0, "", "Not yet"],
  ["before_start", 0, "", "Before tracking started"],
];
const DAYS = CODES.map((_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
const ROW = (over) => ({
  UserId: 80, FullName: "Kavya Nair", Present: 6.5, WorkingDays: 8, Late: 1, LateMinutes: 14, Absent: 1, Leave: 1.5,
  LeftEarly: 2, OnlineMedianMin: 370, ShiftMedianMin: 540, LateStreak: false,
  cells: CODES.map(([code, lateMin], i) => ({ date: DAYS[i], code, lateMin, onlineMin: 0 })),
  ...over,
});

const render = (props) => renderWithProviders(<AttendanceGrid days={DAYS} rows={[ROW()]} {...props} />, { router: false });

describe("AttendanceGrid", () => {
  it.each(CODES)("%s shows its word and an accessible label", (code, _late, word, label) => {
    render();
    const cell = screen.getByLabelText(new RegExp(`^${label}, `));
    expect(cell).toHaveTextContent(word === "" ? /^$/ : word);
    expect(cell).toHaveAttribute("data-code", code);
  });

  it("a half day that was also late says both", () => {
    const row = ROW({ cells: [{ date: DAYS[0], code: "half", lateMin: 9, onlineMin: 0 }] });
    renderWithProviders(<AttendanceGrid days={[DAYS[0]]} rows={[row]} />, { router: false });
    expect(screen.getByLabelText(/^Half-day leave, late 9 minutes, /)).toHaveTextContent("½");
  });

  it("shows totals per person, halves as ½ and online over shift", () => {
    render();
    const totals = screen.getByTestId("att-totals-80");
    expect(within(totals).getByTestId("att-present")).toHaveTextContent("6½");
    expect(within(totals).getByTestId("att-late")).toHaveTextContent("1");
    expect(within(totals).getByTestId("att-absent")).toHaveTextContent("1");
    expect(within(totals).getByTestId("att-early")).toHaveTextContent("2");
    expect(within(totals).getByTestId("att-hours")).toHaveTextContent("6h 10m / 9h 0m");
  });

  it("no sign-in days show a dash for hours", () => {
    renderWithProviders(<AttendanceGrid days={[]} rows={[ROW({ cells: [], OnlineMedianMin: null, ShiftMedianMin: null })]} />, { router: false });
    expect(screen.getByTestId("att-hours")).toHaveTextContent("—");
  });

  it("flags a late streak with a red dot on the name", () => {
    renderWithProviders(<AttendanceGrid days={DAYS} rows={[ROW({ LateStreak: true }), ROW({ UserId: 81, FullName: "Priya Singh" })]} />, { router: false });
    expect(screen.getAllByRole("img", { name: "Late 3 working days in a row" })).toHaveLength(1);
  });

  it("a cell click hands back the person and day; future days are not clickable", async () => {
    const onCell = vi.fn();
    render({ onCellClick: onCell });
    await userEvent.click(screen.getByRole("button", { name: /^Late 14 minutes, / }));
    expect(onCell).toHaveBeenCalledWith(expect.objectContaining({ UserId: 80 }), DAYS[1]);
    expect(screen.queryByRole("button", { name: /^Not yet, / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Before tracking started, / })).toBeNull();
  });

  it("without a handler no cell is a button", () => {
    render();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("halves() writes whole and half days", () => {
    expect(halves(0)).toBe("0");
    expect(halves(0.5)).toBe("½");
    expect(halves(6.5)).toBe("6½");
    expect(halves(8)).toBe("8");
  });
});
