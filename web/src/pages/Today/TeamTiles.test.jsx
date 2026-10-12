import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import TeamTiles from "./TeamTiles";
import renderWithProviders from "../../test/renderWithProviders";

const c = (o = {}) => ({ overdue: 0, atRisk: 0, toRule: 0, ...o });
const S = "2026-10-11 09:30:00";
const people = [
  { UserId: 1, FullName: "Me", ShiftStart: S, status: { code: "online" }, counts: c() },
  { UserId: 2, FullName: "Asha", ShiftStart: S, status: { code: "online", late: "Late by 10 min" }, LateMinutes: 10, counts: c({ overdue: 2, toRule: 1 }) },
  { UserId: 3, FullName: "Ravi", ShiftStart: S, status: { code: "offline", late: "Late by 5 min" }, LateMinutes: 5, counts: c({ overdue: 1, atRisk: 3 }) },
  { UserId: 4, FullName: "Kavya", ShiftStart: S, status: { code: "not_signed_in" }, counts: c() },
  { UserId: 8, FullName: "Sun", ShiftStart: null, status: { code: "offline" }, counts: c() }, // day off: not expected (regression)
  { UserId: 5, FullName: "Neha", status: { code: "leave" }, counts: c() },
  { UserId: 6, FullName: "Om", status: { code: "on_duty" }, counts: c() },
  { UserId: 7, FullName: "Tej", status: { code: "not_tracked" }, counts: c() },
];

const tile = (key) => screen.getByTestId(`tile-${key}`);

describe("TeamTiles", () => {
  it("counts each tile with its sub line", () => {
    renderWithProviders(<TeamTiles people={people} live active={null} onPick={() => {}} />);
    expect(tile("in")).toHaveTextContent("In now2of 4 expected");
    expect(tile("notIn")).toHaveTextContent("Not signed in1");
    expect(tile("late")).toHaveTextContent("Late2total 15m");
    expect(tile("away")).toHaveTextContent("On leave / on duty2Neha, Om");
    expect(tile("overdue")).toHaveTextContent("Overdue tasks3across 2 people");
    expect(tile("atRisk")).toHaveTextContent("Close to deadline3across 1 person");
    expect(tile("toRule")).toHaveTextContent("Waiting for your ruling1missed deadlines");
  });

  it("a click picks the tile; the active one is pressed and a second click clears", async () => {
    const onPick = vi.fn();
    renderWithProviders(<TeamTiles people={people} live active="overdue" onPick={onPick} />);
    expect(tile("overdue")).toHaveAttribute("aria-pressed", "true");
    expect(tile("late")).toHaveAttribute("aria-pressed", "false");
    await userEvent.setup().click(tile("overdue"));
    expect(onPick).toHaveBeenLastCalledWith(null);
    await userEvent.setup().click(tile("late"));
    expect(onPick).toHaveBeenLastCalledWith("late");
  });

  it("past day: live tiles show a dash and cannot be picked", async () => {
    const onPick = vi.fn();
    const past = people.map((p) => ({ ...p, counts: { overdue: null, atRisk: null, toRule: null } }));
    renderWithProviders(<TeamTiles people={past} live={false} active={null} onPick={onPick} />);
    for (const k of ["in", "overdue", "atRisk", "toRule"]) {
      expect(tile(k)).toHaveTextContent("—");
      expect(tile(k)).toBeDisabled();
    }
    await userEvent.setup().click(tile("late"));
    expect(onPick).toHaveBeenCalledWith("late");
  });

  it("nobody away and an empty team", () => {
    renderWithProviders(<TeamTiles people={[]} live active={null} onPick={() => {}} />);
    expect(tile("away")).toHaveTextContent("On leave / on duty0");
    expect(tile("in")).toHaveTextContent("of 0 expected");
  });

  // Colour lives in a tinted icon badge per tile, not in the tile's edge.
  it("gives every tile its icon badge in the tile's hue", () => {
    renderWithProviders(<TeamTiles people={people} live active={null} onPick={() => {}} />);
    const tones = { in: "success", notIn: "error", late: "warning", away: "info", overdue: "error", atRisk: "warning", toRule: "error" };
    for (const [key, tone] of Object.entries(tones)) {
      expect(screen.getByTestId(`tile-badge-${key}`)).toHaveAttribute("data-tone", tone);
    }
  });
});
