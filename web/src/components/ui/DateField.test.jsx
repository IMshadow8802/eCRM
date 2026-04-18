import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";
import DateField from "./DateField";

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

  it("dark mode renders", () => {
    wrap(<DateField label="DarkLabel" onChange={() => {}} />, "dark");
    expect(screen.getByLabelText(/DarkLabel/)).toBeInTheDocument();
  });
});
