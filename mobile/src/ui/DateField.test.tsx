import { Platform } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";

import { DateField, toISODate } from "./DateField";

// The suite runs in IST (jest.config.js), so a UTC conversion rolls a
// just-past-midnight pick back a day — the bug the first test guards.
const nativeEvent = { timestamp: 0, utcOffset: 330 };

async function openPicker(props: Partial<Parameters<typeof DateField>[0]> = {}) {
  const onChange = jest.fn();
  await render(<DateField label="Due" value={null} onChange={onChange} {...props} />);
  await fireEvent.press(screen.getByText(props.placeholder ?? "Select a date"));
  return { onChange, picker: screen.getByTestId("date-picker") };
}

it("a pick just after midnight IST is sent as that local day, never the UTC day before", async () => {
  const { onChange, picker } = await openPicker();
  await fireEvent(picker, "valueChange", { nativeEvent }, new Date(2026, 10, 2, 0, 30));
  expect(onChange).toHaveBeenCalledWith("2026-11-02");
});

it("toISODate is the local day, never the UTC one", () => {
  // 00:30 IST on 3 Nov is still 2 Nov in UTC.
  expect(toISODate(new Date(2026, 10, 3, 0, 30))).toBe("2026-11-03");
});

it("shows the stored day formatted, opens the picker on it, and clears to null", async () => {
  const onChange = jest.fn();
  await render(<DateField value="2026-01-05" onChange={onChange} />);
  expect(screen.getByText("5 Jan 2026")).toBeOnTheScreen();
  await fireEvent.press(screen.getByText("5 Jan 2026"));
  const shown: Date = screen.getByTestId("date-picker").props.value;
  expect([shown.getFullYear(), shown.getMonth(), shown.getDate()]).toEqual([2026, 0, 5]);
  await fireEvent.press(screen.getByLabelText("Clear date"));
  expect(onChange).toHaveBeenCalledWith(null);
});

it("iOS keeps the inline calendar open after a pick until Done", async () => {
  const { onChange, picker } = await openPicker();
  await fireEvent(picker, "valueChange", { nativeEvent }, new Date(2026, 10, 3));
  expect(onChange).toHaveBeenCalledWith("2026-11-03");
  expect(screen.getByTestId("date-picker")).toBeOnTheScreen();
  await fireEvent.press(screen.getByText("Done"));
  expect(screen.queryByTestId("date-picker")).toBeNull();
});

it("Android closes its dialog on a pick, and a dismiss changes nothing", async () => {
  jest.replaceProperty(Platform, "OS", "android");
  const { onChange, picker } = await openPicker();
  expect(screen.queryByText("Done")).toBeNull();
  await fireEvent(picker, "valueChange", { nativeEvent }, new Date(2026, 10, 4));
  expect(onChange).toHaveBeenCalledWith("2026-11-04");
  expect(screen.queryByTestId("date-picker")).toBeNull();

  await fireEvent.press(screen.getByText("Select a date"));
  await fireEvent(screen.getByTestId("date-picker"), "dismiss");
  expect(screen.queryByTestId("date-picker")).toBeNull();
  expect(onChange).toHaveBeenCalledTimes(1);
});

it("disabled never opens; required and error are shown", async () => {
  const onChange = jest.fn();
  await render(<DateField label="Due" required error="Pick a day" disabled value={null} onChange={onChange} />);
  expect(screen.getByText(" *")).toBeOnTheScreen();
  expect(screen.getByText("Pick a day")).toBeOnTheScreen();
  await fireEvent.press(screen.getByText("Select a date"));
  expect(screen.queryByTestId("date-picker")).toBeNull();
});

it("a value with no clearable flag has no clear control", async () => {
  await render(<DateField value="2026-01-05" clearable={false} onChange={jest.fn()} />);
  expect(screen.queryByLabelText("Clear date")).toBeNull();
});

it("time mode opens the clock on the stored time, sends HH:mm, and clears to null", async () => {
  const onChange = jest.fn();
  await render(<DateField mode="time" value="09:05" onChange={onChange} />);
  expect(screen.getByText("09:05")).toBeOnTheScreen();
  await fireEvent.press(screen.getByText("09:05"));
  const picker = screen.getByTestId("date-picker");
  expect(picker.props.mode).toBe("time");
  const shown: Date = picker.props.value;
  expect([shown.getHours(), shown.getMinutes()]).toEqual([9, 5]);
  await fireEvent(picker, "valueChange", { nativeEvent }, new Date(2026, 10, 2, 0, 30));
  expect(onChange).toHaveBeenCalledWith("00:30");
  await fireEvent.press(screen.getByLabelText("Clear time"));
  expect(onChange).toHaveBeenLastCalledWith(null);
});

it("time mode with nothing stored says so and opens the clock", async () => {
  await render(<DateField mode="time" value={null} onChange={jest.fn()} />);
  await fireEvent.press(screen.getByText("Select a time"));
  expect(screen.getByTestId("date-picker").props.value).toBeInstanceOf(Date);
});
