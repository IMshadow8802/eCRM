import { describe, it, expect, vi, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import dayjs from "dayjs";
import renderWithProviders from "../../test/renderWithProviders";
import TimeSlotPicker from "./TimeSlotPicker";

const future = dayjs().add(1, "day").format("YYYY-MM-DD");
const setup = (props) =>
  renderWithProviders(
    <TimeSlotPicker label="Time (optional)" value="" date={future} onChange={vi.fn()} data-testid="t" {...props} />,
    { router: false },
  );

describe("TimeSlotPicker", () => {
  afterEach(() => vi.useRealTimers());
  it("shows 12h text and is read-only", () => {
    setup({ value: "12:30" });
    expect(screen.getByTestId("t")).toHaveValue("12:30 pm");
    expect(screen.getByTestId("t")).toHaveAttribute("readonly");
  });
  it("is disabled without a date", () => {
    setup({ date: "" });
    expect(screen.getByTestId("t")).toBeDisabled();
  });
  it("picks a slot from the tabs and reports HH:mm", async () => {
    const onChange = vi.fn();
    setup({ onChange });
    const user = userEvent.setup();
    await user.click(screen.getByTestId("t"));
    expect(screen.getByTestId("t-slot-08:00")).toBeInTheDocument();
    expect(screen.getByTestId("t-slot-11:30")).toBeInTheDocument();
    expect(screen.queryByTestId("t-slot-12:00")).toBeNull();
    await user.click(screen.getByTestId("t-tabs-afternoon"));
    await user.click(screen.getByTestId("t-slot-16:30"));
    expect(onChange).toHaveBeenCalledWith("16:30");
    expect(screen.queryByTestId("t-slot-16:30")).toBeNull();
  });
  it("evening runs 17:00 to 21:00", async () => {
    setup();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("t"));
    await user.click(screen.getByTestId("t-tabs-evening"));
    expect(screen.getByTestId("t-slot-17:00")).toBeInTheDocument();
    expect(screen.getByTestId("t-slot-21:00")).toBeInTheDocument();
    expect(screen.queryByTestId("t-slot-21:30")).toBeNull();
  });
  it("opens on the tab holding the current value", async () => {
    setup({ value: "18:00" });
    await userEvent.setup().click(screen.getByTestId("t"));
    expect(screen.getByTestId("t-slot-18:00")).toBeInTheDocument();
  });
  it("disables slots already past when the date is today", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2030, 0, 7, 10, 10));
    setup({ date: "2030-01-07" });
    const user = userEvent.setup();
    await user.click(screen.getByTestId("t"));
    expect(screen.getByTestId("t-slot-08:00")).toBeDisabled();
    expect(screen.getByTestId("t-slot-10:00")).toBeDisabled();
    expect(screen.getByTestId("t-slot-10:30")).toBeEnabled();
    await user.click(screen.getByTestId("t-tabs-afternoon"));
    expect(screen.getByTestId("t-slot-12:00")).toBeEnabled();
  });
  it("a disabled slot does not fire", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2030, 0, 7, 10, 10));
    const onChange = vi.fn();
    setup({ date: "2030-01-07", onChange });
    const user = userEvent.setup();
    await user.click(screen.getByTestId("t"));
    await user.click(screen.getByTestId("t-slot-08:00"));
    expect(onChange).not.toHaveBeenCalled();
  });
  it("sets an exact custom time with the steppers in 5-minute steps", async () => {
    const onChange = vi.fn();
    setup({ onChange });
    const user = userEvent.setup();
    await user.click(screen.getByTestId("t"));
    expect(screen.queryByRole("combobox")).toBeNull();
    for (let i = 0; i < 4; i++) await user.click(screen.getByTestId("t-hour-up"));
    for (let i = 0; i < 7; i++) await user.click(screen.getByTestId("t-minute-up"));
    await user.click(screen.getByTestId("t-custom-set"));
    expect(onChange).toHaveBeenCalledWith("13:35");
  });
  it("steppers wrap and start from the current value", async () => {
    const onChange = vi.fn();
    setup({ value: "00:00", onChange });
    const user = userEvent.setup();
    await user.click(screen.getByTestId("t"));
    await user.click(screen.getByTestId("t-hour-down"));
    await user.click(screen.getByTestId("t-minute-down"));
    expect(screen.getByTestId("t-hour")).toHaveTextContent("23");
    expect(screen.getByTestId("t-minute")).toHaveTextContent("55");
    await user.click(screen.getByTestId("t-minute-up"));
    await user.click(screen.getByTestId("t-hour-up"));
    await user.click(screen.getByTestId("t-custom-set"));
    expect(onChange).toHaveBeenCalledWith("00:00");
  });
  it("clears", async () => {
    const onChange = vi.fn();
    setup({ value: "09:00", onChange });
    const user = userEvent.setup();
    await user.click(screen.getByTestId("t"));
    await user.click(screen.getByTestId("t-clear"));
    expect(onChange).toHaveBeenCalledWith("");
  });
  it("shows an error", () => {
    setup({ error: "Pick a time from now on" });
    expect(screen.getByText("Pick a time from now on")).toBeInTheDocument();
  });
});
