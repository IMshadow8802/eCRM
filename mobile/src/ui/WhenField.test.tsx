import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";

import { EMPTY_WHEN, WhenField, dueAt, isPastDue, whenDue, type WhenValue } from "./WhenField";

const now = new Date(2026, 10, 16, 14, 0);
const nativeEvent = { timestamp: 0, utcOffset: 330 };

it("dueAt joins a local day and an optional time", () => {
  expect(dueAt("2026-11-17", "12:30")).toBe("2026-11-17T12:30");
  expect(dueAt("2026-11-17", null)).toBe("2026-11-17");
});

it("whenDue: chips are local days, pick uses its day, the time rides along", () => {
  expect(whenDue({ chip: "tomorrow", day: null, time: null }, now)).toBe("2026-11-17");
  expect(whenDue({ chip: "3days", day: null, time: "09:15" }, now)).toBe("2026-11-19T09:15");
  expect(whenDue({ chip: "pick", day: "2026-12-01", time: null }, now)).toBe("2026-12-01");
  expect(whenDue({ chip: "pick", day: null, time: "10:00" }, now)).toBeNull();
  expect(whenDue(EMPTY_WHEN, now)).toBeNull();
  expect(whenDue({ chip: "today", day: null, time: null }, new Date(2026, 10, 16, 0, 30))).toBe("2026-11-16");
});

it("isPastDue: today day-only is fine, an earlier time today is not, the current minute is", () => {
  expect(isPastDue("2026-11-16", now)).toBe(false);
  expect(isPastDue("2026-11-15", now)).toBe(true);
  expect(isPastDue("2026-11-16T09:00", now)).toBe(true);
  expect(isPastDue("2026-11-16T14:00", new Date(2026, 10, 16, 14, 0, 40))).toBe(false);
  expect(isPastDue(null, now)).toBe(false);
});

function Harness({ initial = EMPTY_WHEN, onValue }: { initial?: WhenValue; onValue?: (v: WhenValue) => void }) {
  const [v, setV] = useState(initial);
  return (
    <WhenField
      label="Follow-up"
      value={v}
      now={now}
      onChange={(n) => {
        setV(n);
        onValue?.(n);
      }}
    />
  );
}

it("shows the four chips; the time row appears once a day is chosen; Pick date shows a date field", async () => {
  await render(<Harness />);
  for (const l of ["Today", "Tomorrow", "In 3 days", "Pick date"]) expect(screen.getByText(l)).toBeOnTheScreen();
  expect(screen.queryByText("Add a time (optional)")).toBeNull();
  await fireEvent.press(screen.getByText("Tomorrow"));
  expect(screen.getByText("Add a time (optional)")).toBeOnTheScreen();
  expect(screen.queryByText("Choose a day")).toBeNull();
  await fireEvent.press(screen.getByText("Pick date"));
  await fireEvent.press(screen.getByText("Choose a day"));
  await fireEvent(screen.getByTestId("date-picker"), "valueChange", { nativeEvent }, new Date(2026, 11, 1));
  expect(screen.getByText("1 Dec 2026")).toBeOnTheScreen();
});

it("Today at 09:00 when it is 14:00 shows 'Pick a time from now on'", async () => {
  await render(<Harness initial={{ chip: "today", day: null, time: "09:00" }} />);
  expect(screen.getByText("Pick a time from now on")).toBeOnTheScreen();
});

it("a chip keeps the time; clearing the time returns time: null", async () => {
  const onValue = jest.fn();
  await render(<Harness initial={{ chip: "today", day: null, time: "18:00" }} onValue={onValue} />);
  expect(screen.queryByText("Pick a time from now on")).toBeNull();
  await fireEvent.press(screen.getByText("Tomorrow"));
  expect(onValue).toHaveBeenLastCalledWith({ chip: "tomorrow", day: null, time: "18:00" });
  await fireEvent.press(screen.getByLabelText("Clear time"));
  expect(onValue).toHaveBeenLastCalledWith({ chip: "tomorrow", day: null, time: null });
});

it("picking a time sets it; required label renders", async () => {
  const onValue = jest.fn();
  await render(<WhenField label="When" required value={{ chip: "today", day: null, time: null }} now={now} onChange={onValue} />);
  await fireEvent.press(screen.getByText("Add a time (optional)"));
  await fireEvent(screen.getByTestId("date-picker"), "valueChange", { nativeEvent }, new Date(2026, 10, 16, 17, 5));
  expect(onValue).toHaveBeenCalledWith({ chip: "today", day: null, time: "17:05" });
});
