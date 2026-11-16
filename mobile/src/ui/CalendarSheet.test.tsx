import { fireEvent, render, screen } from "@testing-library/react-native";

import { colors } from "../theme";
import { CalendarSheet, monthGrid, toISODate } from "./CalendarSheet";

const now = new Date(2026, 10, 16, 14, 0); // Mon 16 Nov 2026

describe("monthGrid", () => {
  it("is 42 cells, Monday first; a month starting Sunday leads with six blanks", () => {
    const g = monthGrid(2026, 10); // 1 Nov 2026 is a Sunday
    expect(g).toHaveLength(42);
    expect(g.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(g[6]).toBe("2026-11-01");
    expect(g[35]).toBe("2026-11-30");
    expect(g[36]).toBeNull();
  });

  it("a month starting Monday has no leading blank", () => {
    expect(monthGrid(2026, 5)[0]).toBe("2026-06-01");
  });

  it("leap February ends on the 29th", () => {
    const g = monthGrid(2028, 1); // 1 Feb 2028 is a Tuesday
    expect(g[0]).toBeNull();
    expect(g[1]).toBe("2028-02-01");
    expect(g[29]).toBe("2028-02-29");
    expect(g[30]).toBeNull();
    expect(monthGrid(2026, 1).filter(Boolean)).toHaveLength(28);
  });
});

it("toISODate is the local day, never the UTC one", () => {
  // 00:30 IST on 3 Nov is still 2 Nov in UTC.
  expect(toISODate(new Date(2026, 10, 3, 0, 30))).toBe("2026-11-03");
});

it("opens on the stored month with the stored day selected and today ringed; a tap picks", async () => {
  const onPick = jest.fn();
  await render(<CalendarSheet value="2026-11-20" now={now} onPick={onPick} />);
  expect(screen.getByText("November 2026")).toBeOnTheScreen();
  expect(screen.getByTestId("calendar-day-2026-11-20")).toBeSelected();
  expect(screen.getByTestId("calendar-day-2026-11-16")).toHaveStyle({ borderColor: colors.primary });
  expect(screen.getByTestId("calendar-day-2026-11-20")).toHaveStyle({ backgroundColor: colors.primary });
  await fireEvent.press(screen.getByTestId("calendar-day-2026-11-17"));
  expect(onPick).toHaveBeenCalledWith("2026-11-17");
});

it("with nothing stored it opens on today's month; months page both ways", async () => {
  await render(<CalendarSheet value={null} now={now} onPick={jest.fn()} />);
  expect(screen.getByText("November 2026")).toBeOnTheScreen();
  await fireEvent.press(screen.getByLabelText("Next month"));
  await fireEvent.press(screen.getByLabelText("Next month"));
  expect(screen.getByText("January 2027")).toBeOnTheScreen();
  expect(screen.getByTestId("calendar-day-2027-01-01")).toBeOnTheScreen();
  await fireEvent.press(screen.getByLabelText("Previous month"));
  expect(screen.getByText("December 2026")).toBeOnTheScreen();
});

it("days before minimumDate are disabled and the month before it cannot be reached", async () => {
  const onPick = jest.fn();
  await render(<CalendarSheet value={null} now={now} minimumDate={new Date(2026, 10, 16, 18, 0)} onPick={onPick} />);
  const past = screen.getByTestId("calendar-day-2026-11-15");
  expect(past).toBeDisabled();
  await fireEvent.press(past);
  expect(onPick).not.toHaveBeenCalled();
  // The minimum day itself is still pickable, whatever its time.
  await fireEvent.press(screen.getByTestId("calendar-day-2026-11-16"));
  expect(onPick).toHaveBeenCalledWith("2026-11-16");
  expect(screen.getByLabelText("Previous month")).toBeDisabled();
});
