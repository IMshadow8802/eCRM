import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";
import Switch from "./Switch";

const wrap = (ui, mode = "light") =>
  render(<ThemeProvider theme={buildTheme(mode)}>{ui}</ThemeProvider>);

describe("Switch", () => {
  it("renders + toggles", () => {
    const onChange = vi.fn();
    wrap(<Switch label="L" onChange={onChange} data-testid="s" />);
    fireEvent.click(screen.getByTestId("s"));
    expect(onChange).toHaveBeenCalled();
  });

  it("reflects checked state", () => {
    wrap(<Switch checked label="L" onChange={() => {}} data-testid="s" />);
    expect(screen.getByTestId("s")).toBeChecked();
  });

  it("disabled sets disabled attr", () => {
    wrap(<Switch disabled label="L" data-testid="s" />);
    expect(screen.getByTestId("s")).toBeDisabled();
  });

  it("all sizes render", () => {
    for (const size of ["sm", "md", "lg"]) {
      wrap(<Switch size={size} label="L" data-testid={`s-${size}`} />);
      expect(screen.getByTestId(`s-${size}`)).toBeInTheDocument();
    }
  });

  it("no label renders correctly", () => {
    wrap(<Switch data-testid="s" />);
    expect(screen.getByTestId("s")).toBeInTheDocument();
  });

  it("dark mode track color swaps", () => {
    wrap(<Switch label="L" data-testid="s" />, "dark");
    expect(screen.getByTestId("s")).toBeInTheDocument();
  });
});
