import { fireEvent, render, screen } from "@testing-library/react-native";

import { TimeSheet, isPastSlot, partAt, slotLabel, slotsFor } from "./TimeSheet";

const now = new Date(2026, 10, 16, 14, 10); // Mon 16 Nov 2026, 2:10 pm
const today = "2026-11-16";

describe("helpers", () => {
  it("slots are every 30 minutes inside each part of the day", () => {
    expect(slotsFor("morning")).toEqual(["08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30"]);
    expect(slotsFor("afternoon")).toHaveLength(10);
    expect(slotsFor("afternoon").at(-1)).toBe("16:30");
    expect(slotsFor("evening")).toEqual(["17:00", "17:30", "18:00", "18:30", "19:00", "19:30", "20:00", "20:30", "21:00"]);
  });

  it("partAt splits the whole day at noon and 5 pm", () => {
    expect(partAt("06:15")).toBe("morning");
    expect(partAt("11:59")).toBe("morning");
    expect(partAt("12:00")).toBe("afternoon");
    expect(partAt("17:00")).toBe("evening");
    expect(partAt("23:30")).toBe("evening");
  });

  it("slotLabel is 12-hour with am/pm", () => {
    expect(slotLabel("08:00")).toBe("8:00 am");
    expect(slotLabel("12:30")).toBe("12:30 pm");
    expect(slotLabel("00:05")).toBe("12:05 am");
    expect(slotLabel("21:00")).toBe("9:00 pm");
  });

  it("a slot is past only on today, before the current minute", () => {
    expect(isPastSlot("14:00", today, now)).toBe(true);
    expect(isPastSlot("14:10", today, now)).toBe(false);
    expect(isPastSlot("14:00", "2026-11-17", now)).toBe(false);
    expect(isPastSlot("14:00", null, now)).toBe(false);
  });
});

it("opens on the tab holding the stored time, marks it, and a tap picks a slot", async () => {
  const onPick = jest.fn();
  await render(<TimeSheet value="18:30" now={now} clearable={false} onPick={onPick} />);
  expect(screen.getByRole("tab", { name: "Evening" })).toBeSelected();
  expect(screen.getByTestId("time-slot-18:30")).toBeSelected();
  expect(screen.queryByText("No time")).toBeNull();
  await fireEvent.press(screen.getByRole("tab", { name: "Morning" }));
  await fireEvent.press(screen.getByTestId("time-slot-09:30"));
  expect(onPick).toHaveBeenCalledWith("09:30");
  expect(screen.getByText("9:30 am")).toBeOnTheScreen();
});

it("with nothing stored it opens on the current part of the day", async () => {
  await render(<TimeSheet value={null} now={now} clearable onPick={jest.fn()} />);
  expect(screen.getByRole("tab", { name: "Afternoon" })).toBeSelected();
  // Nothing to clear yet.
  expect(screen.queryByText("No time")).toBeNull();
});

it("on today, slots already past are disabled; on another day they are not", async () => {
  const onPick = jest.fn();
  const { rerender } = await render(<TimeSheet value={null} day={today} now={now} clearable onPick={onPick} />);
  expect(screen.getByTestId("time-slot-14:00")).toBeDisabled();
  await fireEvent.press(screen.getByTestId("time-slot-14:00"));
  expect(onPick).not.toHaveBeenCalled();
  expect(screen.getByTestId("time-slot-14:30")).toBeEnabled();
  await rerender(<TimeSheet value={null} day="2026-11-17" now={now} clearable onPick={onPick} />);
  expect(screen.getByTestId("time-slot-14:00")).toBeEnabled();
});

it("custom time: hour and 5-minute steppers set an exact time", async () => {
  const onPick = jest.fn();
  await render(<TimeSheet value="09:07" now={now} clearable={false} onPick={onPick} />);
  // Starts on the stored time, minutes snapped down to the 5-minute step.
  expect(screen.getByLabelText("Hour 9 am")).toBeOnTheScreen();
  expect(screen.getByLabelText("Minute :05")).toBeOnTheScreen();
  await fireEvent.press(screen.getByLabelText("More hour"));
  await fireEvent.press(screen.getByLabelText("More minute"));
  await fireEvent.press(screen.getByText("Set 10:10 am"));
  expect(onPick).toHaveBeenCalledWith("10:10");
});

it("custom time with nothing stored starts at 9:00 am; a past custom time on today cannot be set", async () => {
  const onPick = jest.fn();
  await render(<TimeSheet value={null} day={today} now={now} clearable onPick={onPick} />);
  const set = screen.getByText("Set 9:00 am");
  await fireEvent.press(set);
  expect(onPick).not.toHaveBeenCalled();
});

it("No time clears a stored time when the field is clearable", async () => {
  const onPick = jest.fn();
  await render(<TimeSheet value="10:00" now={now} clearable onPick={onPick} />);
  await fireEvent.press(screen.getByText("No time"));
  expect(onPick).toHaveBeenCalledWith(null);
});
