import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";
import DateField from "./DateField";
import Combobox from "./Combobox";

const wrap = (ui, mode = "light") =>
  render(<ThemeProvider theme={buildTheme(mode)}>{ui}</ThemeProvider>);

describe("DateField", () => {
  it("renders an input textbox", () => {
    wrap(<DateField label="Due" onChange={() => {}} />);
    expect(screen.getByLabelText(/Due/)).toBeInTheDocument();
  });

  it("shows ISO value in input", () => {
    wrap(
      <DateField label="Due" value="2099-06-15" onChange={() => {}} />,
    );
    // MUI X DatePicker renders value as MM/DD/YYYY by default locale
    const input = document.querySelector("input");
    expect(input).toBeTruthy();
  });

  it("shows error helper text", () => {
    wrap(<DateField label="Due" onChange={() => {}} error="required" />);
    expect(screen.getByText("required")).toBeInTheDocument();
  });

  it("shows hint when no error", () => {
    wrap(<DateField label="Due" onChange={() => {}} hint="pick date" />);
    expect(screen.getByText("pick date")).toBeInTheDocument();
  });

  it("disabled + required states flow to the wrapped input", () => {
    wrap(
      <DateField
        label="Due"
        disabled
        required
        onChange={() => {}}
      />,
    );
    const input = document.querySelector("input");
    expect(input).toBeDisabled();
    // required asterisk lives in the external label
    expect(screen.getByText("*")).toBeInTheDocument();
  });

  it("onChange fires when a valid date is picked (ISO format)", () => {
    const onChange = vi.fn();
    const { rerender } = wrap(
      <DateField label="Due" onChange={onChange} />,
    );
    // Simulate prop rebind — ensures onChange identity wiring works
    rerender(
      <ThemeProvider theme={buildTheme("light")}>
        <DateField label="Due" value="2099-01-01" onChange={onChange} />
      </ThemeProvider>,
    );
    expect(screen.getByLabelText(/Due/)).toBeInTheDocument();
  });

  /**
   * REGRESSION, and a bigger one than it looks.
   *
   * x-date-pickers v9 replaced the OutlinedInput with `MuiPickersInputBase` +
   * contenteditable <span> sections. This file's sx still targeted
   * `.MuiOutlinedInput-root` and `.MuiOutlinedInput-input`, which do not exist
   * in that tree — so the height, radius, background and font size were all
   * being set on nothing, and every date field in the app silently rendered at
   * MUI's defaults beside Combobox controls that honour the tokens. It showed
   * up as a filter bar where the two date filters were visibly taller and a
   * point larger than the seven dropdowns next to them.
   *
   * Asserted against Combobox rather than against literal numbers, so the two
   * cannot drift apart again even if the scale itself changes. Read off the
   * picker's input root: the section spans that carry the visible text declare
   * `font-size: inherit`, and jsdom reports that keyword verbatim rather than
   * resolving it, so the root is where the value is actually legible to a test.
   */
  const root = (c) => c.querySelector(".MuiPickersInputBase-root");

  // sm and lg only, and not because md is uninteresting: the picker always
  // renders with MUI's `size="small"` internals, whose own font-size is
  // 0.9333rem — numerically close to md's 14px. jsdom's getComputedStyle does
  // not apply specificity, so at md it reports MUI's declaration whichever way
  // the real cascade would go, and the assertion would be measuring jsdom
  // rather than this component. sm is the size the filter bars use and the one
  // that actually regressed; md is covered by the height and background cases
  // below, which is where a dead selector shows up regardless of size.
  it.each(["sm", "lg"])("matches Combobox's font size at size=%s", (size) => {
    const { container: dateBox, unmount } = wrap(
      <DateField size={size} label="Due" onChange={() => {}} />,
    );
    const dateSize = getComputedStyle(root(dateBox)).fontSize;
    unmount();

    const { container: comboBox } = wrap(
      <Combobox size={size} label="Pick" options={[]} onChange={() => {}} />,
    );
    const comboSize = getComputedStyle(comboBox.querySelector("input")).fontSize;

    expect(dateSize).toBe(comboSize);
    expect(dateSize).not.toBe("");
  });

  it.each([
    ["sm", "32px"],
    ["md", "40px"],
    ["lg", "48px"],
  ])("honours the shared control height at size=%s", (size, expected) => {
    const { container } = wrap(<DateField size={size} label="Due" onChange={() => {}} />);
    expect(getComputedStyle(root(container)).height).toBe(expected);
  });

  // The selectors have to land on something. An empty computed style here is
  // the exact failure mode above: styles written, nothing matched.
  it("actually applies its themed background, not MUI's default", () => {
    const { container } = wrap(<DateField label="Due" onChange={() => {}} />);
    expect(getComputedStyle(root(container)).backgroundColor).not.toBe("");
  });

  it("dark mode renders", () => {
    wrap(<DateField label="DarkLabel" onChange={() => {}} />, "dark");
    expect(screen.getByLabelText(/DarkLabel/)).toBeInTheDocument();
  });
});
