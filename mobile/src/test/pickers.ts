import { fireEvent, screen } from "@testing-library/react-native";

/**
 * Picks a day in the in-app calendar (ui/CalendarSheet), paging months until
 * the day is shown. The sheet mock keeps the calendar mounted, so the field
 * does not need opening first; open it anyway when the test is about that.
 * With several calendars mounted, the last one is used.
 */
export async function pickDay(iso: string) {
  for (let i = 0; i < 60 && !screen.queryAllByTestId(`calendar-day-${iso}`).length; i++) {
    const shown = String(screen.getAllByTestId(/^calendar-month-/).at(-1)!.props.testID).slice("calendar-month-".length);
    const way = iso.slice(0, 7) < shown ? "Previous month" : "Next month";
    await fireEvent.press(screen.getAllByLabelText(way).at(-1)!);
  }
  await fireEvent.press(screen.getAllByTestId(`calendar-day-${iso}`).at(-1)!);
}

/**
 * Picks "HH:mm" in the in-app time sheet (ui/TimeSheet): its slot when it is
 * one, otherwise through the custom-time steppers. The last sheet mounted wins.
 */
export async function pickTime(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  const last = (label: string) => screen.getAllByLabelText(label).at(-1)!;
  await fireEvent.press(last(h < 12 ? "Morning" : h < 17 ? "Afternoon" : "Evening"));
  const slot = screen.queryAllByTestId(`time-slot-${hhmm}`).at(-1);
  if (slot) {
    await fireEvent.press(slot);
    return;
  }
  // The steppers clamp, so walking to the floor first makes the start irrelevant.
  for (let i = 0; i < 23; i++) await fireEvent.press(last("Less hour"));
  for (let i = 0; i < h; i++) await fireEvent.press(last("More hour"));
  for (let i = 0; i < 11; i++) await fireEvent.press(last("Less minute"));
  for (let i = 0; i < m / 5; i++) await fireEvent.press(last("More minute"));
  await fireEvent.press(screen.getAllByTestId("time-custom-set").at(-1)!);
}

/** Fakes only Date (timers, promises and animation frames stay real), so "now" is fixed. */
export function fakeNow(now: Date) {
  jest.useFakeTimers({
    now,
    doNotFake: [
      "hrtime", "nextTick", "performance", "queueMicrotask", "requestAnimationFrame", "cancelAnimationFrame",
      "requestIdleCallback", "cancelIdleCallback", "setImmediate", "clearImmediate", "setInterval",
      "clearInterval", "setTimeout", "clearTimeout",
    ],
  });
}
