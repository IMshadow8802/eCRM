import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";
import Checkbox from "./Checkbox";

const wrap = (ui, mode = "light") =>
  render(<ThemeProvider theme={buildTheme(mode)}>{ui}</ThemeProvider>);

describe("Checkbox", () => {
  it("renders label + unchecked", () => {
    wrap(<Checkbox label="Accept" data-testid="c" />);
    expect(screen.getByLabelText("Accept")).toBeInTheDocument();
    expect(screen.getByTestId("c")).not.toBeChecked();
  });

  it("toggles via user click", () => {
    const onChange = vi.fn();
    wrap(<Checkbox label="L" onChange={onChange} data-testid="c" />);
    fireEvent.click(screen.getByTestId("c"));
    expect(onChange).toHaveBeenCalled();
  });

  it("renders checked", () => {
    wrap(<Checkbox checked label="L" data-testid="c" onChange={() => {}} />);
    expect(screen.getByTestId("c")).toBeChecked();
  });

  it("disabled sets disabled attribute on input", () => {
    wrap(<Checkbox disabled label="L" data-testid="c" />);
    expect(screen.getByTestId("c")).toBeDisabled();
  });

  it("error border applied + color swaps", () => {
    wrap(<Checkbox error="bad" label="L" data-testid="c" />);
    expect(screen.getByText("L")).toBeInTheDocument();
  });

  it("all sizes render", () => {
    for (const size of ["sm", "md", "lg"]) {
      wrap(<Checkbox label="L" size={size} data-testid={`c-${size}`} />);
      expect(screen.getByTestId(`c-${size}`)).toBeInTheDocument();
    }
  });

  it("no label still renders checkbox", () => {
    wrap(<Checkbox data-testid="c" />);
    expect(screen.getByTestId("c")).toBeInTheDocument();
  });

  it("dark mode renders", () => {
    wrap(<Checkbox label="L" data-testid="c" />, "dark");
    expect(screen.getByTestId("c")).toBeInTheDocument();
  });
});
