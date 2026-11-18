import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";
import DateRangeField from "./DateRangeField";

// MUI X's contenteditable sections cannot be typed into under jsdom.
vi.mock("./DateField", () => import("../../test/DateFieldStub"));

const YESTERDAY = { preset: "yesterday", from: "2026-11-17", to: "2026-11-17" };

function wrap(props = {}) {
  const onChange = vi.fn();
  render(
    <ThemeProvider theme={buildTheme("light")}>
      <DateRangeField value={YESTERDAY} onChange={onChange} means="Work done in" data-testid="date-range" {...props} />
    </ThemeProvider>,
  );
  return onChange;
}
const open = () => fireEvent.click(screen.getByTestId("date-range-button"));
const setDate = (id, v) => fireEvent.change(screen.getByTestId(id), { target: { value: v } });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 18, 9, 40));
});
afterEach(() => vi.useRealTimers());

describe("DateRangeField", () => {
  it("the button shows what the dates mean and the chosen range", () => {
    wrap();
    const b = screen.getByTestId("date-range-button");
    expect(b).toHaveTextContent("Work done in");
    expect(b).toHaveTextContent("Yesterday · 17 Nov 2026");
  });

  it("a custom value shows its range", () => {
    wrap({ value: { preset: "custom", from: "2026-09-01", to: "2026-09-30" } });
    expect(screen.getByTestId("date-range-button")).toHaveTextContent("Custom · 1 – 30 Sep 2026");
  });

  it("any time shows Any time", () => {
    wrap({ value: { preset: "any", from: null, to: null }, allowAny: true });
    expect(screen.getByTestId("date-range-button")).toHaveTextContent("Any time");
  });

  it("opening lists the six presets with their ranges, the chosen one checked", () => {
    wrap();
    open();
    const list = screen.getByRole("listbox");
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Today18-11-2026", "Yesterday17-11-2026", "This week16 – 22 Nov",
      "This month1 – 30 Nov", "Last month1 – 31 Oct", "Custom",
    ]);
    expect(screen.getByTestId("date-range-option-yesterday")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("date-range-option-today")).toHaveAttribute("aria-selected", "false");
    expect(screen.getByText("Weeks run Monday to Sunday.")).toBeInTheDocument();
    expect(screen.getByText("Work done in…")).toBeInTheDocument();
    expect(screen.queryByTestId("date-range-option-any")).not.toBeInTheDocument();
  });

  it("Any time is listed first only with allowAny, and picking it clears the dates", () => {
    const onChange = wrap({ allowAny: true, heading: "Show leads created…" });
    open();
    expect(screen.getAllByRole("option")[0]).toHaveTextContent("Any time");
    expect(screen.getByText("Show leads created…")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("date-range-option-any"));
    expect(onChange).toHaveBeenCalledWith({ preset: "any", from: null, to: null });
  });

  it("clicking a preset reports it once and closes", async () => {
    const onChange = wrap();
    open();
    fireEvent.click(screen.getByTestId("date-range-option-month"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ preset: "month", from: "2026-11-01", to: "2026-11-30" });
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  });

  it("Enter on an option picks it", () => {
    const onChange = wrap();
    open();
    fireEvent.keyDown(screen.getByTestId("date-range-option-today"), { key: "Enter" });
    fireEvent.keyDown(screen.getByTestId("date-range-option-week"), { key: "x" });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ preset: "today", from: "2026-11-18", to: "2026-11-18" });
  });

  it("Custom asks for two dates and reports only on apply", async () => {
    const onChange = wrap();
    open();
    fireEvent.click(screen.getByTestId("date-range-option-custom"));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("From")).toBeInTheDocument();
    expect(screen.getByText("To")).toBeInTheDocument();
    expect(screen.getByTestId("date-range-option-custom")).toHaveAttribute("aria-selected", "true");

    setDate("date-range-from", "2026-09-30");
    setDate("date-range-to", "2026-09-01");
    expect(screen.getByTestId("date-range-apply")).toBeDisabled();
    expect(screen.getByText("To is before From")).toBeInTheDocument();

    setDate("date-range-from", "2026-09-01");
    setDate("date-range-to", "2026-09-30");
    const apply = screen.getByTestId("date-range-apply");
    expect(apply).toBeEnabled();
    expect(apply).toHaveTextContent("Show 1 – 30 Sep");
    expect(screen.queryByText("To is before From")).not.toBeInTheDocument();
    fireEvent.click(apply);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ preset: "custom", from: "2026-09-01", to: "2026-09-30" });
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  });

  // e2e 2026-11-18: side by side in a fixed 312px row the To field was clipped
  // ("30-09-20"). The two fields stack, each the full width of the panel.
  it("Custom stacks From over To so neither field is clipped", () => {
    wrap();
    open();
    fireEvent.click(screen.getByTestId("date-range-option-custom"));
    const fields = screen.getByTestId("date-range-fields");
    expect(fields.style.flexDirection).toBe("column");
    expect(within(fields).getByTestId("date-range-from")).toBeInTheDocument();
    expect(within(fields).getByTestId("date-range-to")).toBeInTheDocument();
  });

  it("a cleared date disables apply", () => {
    wrap();
    open();
    fireEvent.click(screen.getByTestId("date-range-option-custom"));
    setDate("date-range-from", "");
    expect(screen.getByTestId("date-range-apply")).toBeDisabled();
    expect(screen.getByTestId("date-range-apply")).toHaveTextContent(/^Show$/);
  });

  it("an open custom value starts on the custom panel with its dates", () => {
    wrap({ value: { preset: "custom", from: "2026-09-01", to: "2026-09-30" } });
    open();
    expect(screen.getByTestId("date-range-from")).toHaveValue("2026-09-01");
    expect(screen.getByTestId("date-range-apply")).toHaveTextContent("Show 1 – 30 Sep");
  });

  it("Cancel closes without reporting", async () => {
    const onChange = wrap();
    open();
    fireEvent.click(screen.getByTestId("date-range-option-custom"));
    fireEvent.click(screen.getByTestId("date-range-cancel"));
    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  });
});
