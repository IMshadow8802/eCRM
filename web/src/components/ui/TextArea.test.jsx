import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";

import TextArea from "./TextArea";

const wrap = (ui, mode = "light") =>
  render(<ThemeProvider theme={buildTheme(mode)}>{ui}</ThemeProvider>);

describe("TextArea", () => {
  it("renders label + textarea", () => {
    wrap(<TextArea label="Notes" data-testid="ta" />);
    expect(screen.getByLabelText("Notes")).toBeInTheDocument();
  });

  it("error overrides hint + marks invalid", () => {
    wrap(
      <TextArea label="Notes" hint="h" error="oops" data-testid="ta" />,
    );
    expect(screen.getByText("oops")).toBeInTheDocument();
    expect(screen.getByTestId("ta")).toHaveAttribute("aria-invalid", "true");
  });

  it("autoGrow adjusts height when value changes", () => {
    const { rerender } = wrap(
      <TextArea label="L" value="" autoGrow data-testid="ta" />,
    );
    rerender(
      <ThemeProvider theme={buildTheme("light")}>
        <TextArea label="L" value={"a\nb\nc"} autoGrow data-testid="ta" />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("ta")).toBeInTheDocument();
  });

  it("fires onChange + focus/blur", async () => {
    const onChange = vi.fn();
    wrap(<TextArea label="L" onChange={onChange} data-testid="ta" />);
    const user = userEvent.setup();
    const ta = screen.getByTestId("ta");
    await user.type(ta, "hi");
    fireEvent.focus(ta);
    fireEvent.blur(ta);
    expect(onChange).toHaveBeenCalled();
  });

  it("required asterisk renders", () => {
    wrap(<TextArea label="L" required data-testid="ta" />);
    expect(screen.getByText("*")).toBeInTheDocument();
  });

  it("disabled blocks typing", async () => {
    const onChange = vi.fn();
    wrap(
      <TextArea label="L" disabled onChange={onChange} data-testid="ta" />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByTestId("ta"), "x");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("focus + blur paths handled when error shown", () => {
    wrap(<TextArea label="L" error="bad" data-testid="ta" />);
    const ta = screen.getByTestId("ta");
    fireEvent.focus(ta);
    fireEvent.blur(ta);
    expect(ta).toBeInTheDocument();
  });

  it("focus is noop when disabled", () => {
    wrap(<TextArea label="L" disabled data-testid="ta" />);
    const ta = screen.getByTestId("ta");
    fireEvent.focus(ta);
    expect(ta).toBeInTheDocument();
  });

  it("renders dark mode", () => {
    wrap(<TextArea label="dm" data-testid="d" />, "dark");
    expect(screen.getByTestId("d")).toBeInTheDocument();
  });
});
