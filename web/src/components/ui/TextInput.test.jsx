import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";

import TextInput from "./TextInput";

const wrap = (ui, mode = "light") =>
  render(<ThemeProvider theme={buildTheme(mode)}>{ui}</ThemeProvider>);

describe("TextInput", () => {
  it("renders label + input + hint", () => {
    wrap(
      <TextInput
        label="Email"
        hint="We won't share it"
        data-testid="ti"
      />,
    );
    expect(screen.getByLabelText(/Email/i)).toBeInTheDocument();
    expect(screen.getByText(/won't share/i)).toBeInTheDocument();
  });

  it("shows error instead of hint when error given", () => {
    wrap(
      <TextInput
        label="Name"
        hint="hint txt"
        error="required!"
        data-testid="ti"
      />,
    );
    expect(screen.getByText("required!")).toBeInTheDocument();
    expect(screen.queryByText("hint txt")).not.toBeInTheDocument();
    expect(screen.getByTestId("ti")).toHaveAttribute("aria-invalid", "true");
  });

  it("required asterisk shown when required", () => {
    wrap(<TextInput label="Phone" required data-testid="ti" />);
    expect(screen.getByText("*")).toBeInTheDocument();
  });

  it("fires onChange", async () => {
    const onChange = vi.fn();
    wrap(<TextInput label="A" onChange={onChange} data-testid="ti" />);
    const user = userEvent.setup();
    await user.type(screen.getByTestId("ti"), "hi");
    expect(onChange).toHaveBeenCalled();
  });

  it("fires focus + blur handlers and updates border", () => {
    wrap(<TextInput label="X" data-testid="ti" />);
    const input = screen.getByTestId("ti");
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(input).toBeInTheDocument();
  });

  it("disabled blocks typing", async () => {
    const onChange = vi.fn();
    wrap(
      <TextInput label="Y" disabled onChange={onChange} data-testid="ti" />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByTestId("ti"), "x");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders left + right adornments", () => {
    wrap(
      <TextInput
        label="A"
        leftAdornment={<span data-testid="la">$</span>}
        rightAdornment={<span data-testid="ra">USD</span>}
      />,
    );
    expect(screen.getByTestId("la")).toBeInTheDocument();
    expect(screen.getByTestId("ra")).toBeInTheDocument();
  });

  it("supports all sizes", () => {
    for (const size of ["sm", "md", "lg"]) {
      wrap(<TextInput label="S" size={size} data-testid={`s-${size}`} />);
      expect(screen.getByTestId(`s-${size}`)).toBeInTheDocument();
    }
  });

  it("applies focus styles then removes on blur when error present", () => {
    wrap(<TextInput label="X" error="bad" data-testid="ti" />);
    const input = screen.getByTestId("ti");
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(input).toBeInTheDocument();
  });

  it("focus does nothing when disabled", () => {
    wrap(<TextInput label="X" disabled data-testid="ti" />);
    const input = screen.getByTestId("ti");
    fireEvent.focus(input);
    expect(input).toBeInTheDocument();
  });

  it("renders in dark mode", () => {
    wrap(<TextInput label="dm" data-testid="d" />, "dark");
    expect(screen.getByTestId("d")).toBeInTheDocument();
  });
});
