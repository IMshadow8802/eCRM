import { fireEvent, screen } from "@testing-library/react-native";

import { pickDay, pickTime } from "../test/pickers";
import { renderWithProviders as render } from "../test/renderWithProviders";
import { spySheets } from "../test/sheets";
import { DateField, toISODate } from "./DateField";

const now = new Date(2026, 10, 16, 14, 10);

it("date mode opens OUR calendar sheet (no native dialog) and a tapped day is sent as local Y-M-D, then closes", async () => {
  const { present, dismiss } = spySheets();
  const onChange = jest.fn();
  await render(<DateField label="Due" value={null} now={now} onChange={onChange} />);
  await fireEvent.press(screen.getByText("Select a date"));
  expect(present).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByTestId("calendar-day-2026-11-02"));
  expect(onChange).toHaveBeenCalledWith("2026-11-02");
  expect(dismiss).toHaveBeenCalledTimes(1);
});

it("toISODate is still exported from DateField and is the local day", () => {
  expect(toISODate(new Date(2026, 10, 3, 0, 30))).toBe("2026-11-03");
});

it("shows the stored day formatted, the calendar opens on its month, and clears to null", async () => {
  const onChange = jest.fn();
  await render(<DateField value="2026-01-05" onChange={onChange} />);
  expect(screen.getByText("5 Jan 2026")).toBeOnTheScreen();
  // Nothing is mounted until the field is opened.
  expect(screen.queryByText("January 2026")).toBeNull();
  await fireEvent.press(screen.getByText("5 Jan 2026"));
  expect(screen.getByText("January 2026")).toBeOnTheScreen();
  expect(screen.getByTestId("calendar-day-2026-01-05")).toBeSelected();
  await fireEvent.press(screen.getByLabelText("Clear date"));
  expect(onChange).toHaveBeenCalledWith(null);
});

it("minimumDate reaches the calendar: earlier days cannot be picked", async () => {
  const onChange = jest.fn();
  await render(<DateField value={null} now={now} minimumDate={now} onChange={onChange} />);
  await fireEvent.press(screen.getByText("Select a date"));
  await fireEvent.press(screen.getByTestId("calendar-day-2026-11-15"));
  expect(onChange).not.toHaveBeenCalled();
  await pickDay("2027-02-03");
  expect(onChange).toHaveBeenCalledWith("2027-02-03");
});

it("disabled never opens; required and error are shown", async () => {
  const { present } = spySheets();
  await render(<DateField label="Due" required error="Pick a day" disabled value={null} onChange={jest.fn()} />);
  expect(screen.getByText(" *")).toBeOnTheScreen();
  expect(screen.getByText("Pick a day")).toBeOnTheScreen();
  await fireEvent.press(screen.getByText("Select a date"));
  expect(present).not.toHaveBeenCalled();
});

it("a value with no clearable flag has no clear control", async () => {
  await render(<DateField value="2026-01-05" clearable={false} onChange={jest.fn()} />);
  expect(screen.queryByLabelText("Clear date")).toBeNull();
});

it("time mode opens OUR time sheet on the stored time, sends HH:mm, and clears to null", async () => {
  const { present, dismiss } = spySheets();
  const onChange = jest.fn();
  await render(<DateField mode="time" value="09:05" now={now} onChange={onChange} />);
  // Shown 12-hour like the cards' due line; still sent as HH:mm.
  expect(screen.getByText("9:05 am")).toBeOnTheScreen();
  await fireEvent.press(screen.getByText("9:05 am"));
  expect(present).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("tab", { name: "Morning" })).toBeSelected();
  await fireEvent.press(screen.getByRole("tab", { name: "Afternoon" }));
  await fireEvent.press(screen.getByTestId("time-slot-12:30"));
  expect(onChange).toHaveBeenCalledWith("12:30");
  expect(dismiss).toHaveBeenCalledTimes(1);
  await pickTime("00:30");
  expect(onChange).toHaveBeenLastCalledWith("00:30");
  await fireEvent.press(screen.getByLabelText("Clear time"));
  expect(onChange).toHaveBeenLastCalledWith(null);
});

it("time mode: No time in the sheet clears", async () => {
  const onChange = jest.fn();
  await render(<DateField mode="time" value="10:00" now={now} onChange={onChange} />);
  await fireEvent.press(screen.getByText("10:00 am"));
  await fireEvent.press(screen.getByText("No time"));
  expect(onChange).toHaveBeenCalledWith(null);
});

it("time mode: a field that is not clearable offers no No time", async () => {
  await render(<DateField mode="time" label="Due time" value="10:00" now={now} clearable={false} onChange={jest.fn()} />);
  await fireEvent.press(screen.getByText("10:00 am"));
  expect(screen.getByText("Pick a time")).toBeOnTheScreen();
  expect(screen.queryByText("No time")).toBeNull();
});

it("time mode with nothing stored says so; with day = today the past slots are off", async () => {
  await render(<DateField mode="time" value={null} day="2026-11-16" now={now} onChange={jest.fn()} />);
  await fireEvent.press(screen.getByText("Select a time"));
  expect(screen.getByTestId("time-slot-14:00")).toBeDisabled();
  expect(screen.getByTestId("time-slot-14:30")).toBeEnabled();
});

it("time mode displays a stored afternoon time 12-hour", async () => {
  await render(<DateField mode="time" value="12:30" onChange={jest.fn()} />);
  expect(screen.getByText("12:30 pm")).toBeOnTheScreen();
  expect(screen.queryByText("12:30")).toBeNull();
});

it("the picker unmounts once the sheet has closed, so the next open starts fresh", async () => {
  // The real sheet calls onDismiss after it closes; the mock's dismiss does not.
  spySheets().dismiss.mockImplementation(function (this: unknown) {
    (this as { props: { onDismiss?: () => void } }).props.onDismiss?.();
  });
  const onChange = jest.fn();
  await render(<DateField value="2026-01-05" onChange={onChange} />);
  await fireEvent.press(screen.getByText("5 Jan 2026"));
  await fireEvent.press(screen.getByTestId("calendar-day-2026-01-09"));
  expect(onChange).toHaveBeenCalledWith("2026-01-09");
  expect(screen.queryByText("January 2026")).toBeNull();
});
