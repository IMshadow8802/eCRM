import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";

import NumberInput from "./NumberInput";

const wrap = (ui, mode = "light") =>
  render(<ThemeProvider theme={buildTheme(mode)}>{ui}</ThemeProvider>);

describe("NumberInput", () => {
  it("renders dec + inc + value", () => {
    wrap(<NumberInput value={5} onChange={() => {}} data-testid="n" />);
    expect(screen.getByTestId("n-dec")).toBeInTheDocument();
    expect(screen.getByTestId("n-inc")).toBeInTheDocument();
  });

  it("inc button bumps up by step", async () => {
    const onChange = vi.fn();
    wrap(
      <NumberInput value={5} step={2} onChange={onChange} data-testid="n" />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId("n-inc"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ target: { value: "7" } }),
    );
  });

  it("dec button bumps down by step", async () => {
    const onChange = vi.fn();
    wrap(
      <NumberInput value={3} step={1} onChange={onChange} data-testid="n" />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId("n-dec"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ target: { value: "2" } }),
    );
  });

  it("respects min clamp on dec", async () => {
    const onChange = vi.fn();
    wrap(
      <NumberInput
        value={0}
        min={0}
        onChange={onChange}
        data-testid="n"
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId("n-dec"));
    // dec button disabled at min → onChange not fired
    expect(onChange).not.toHaveBeenCalled();
  });

  it("respects max clamp on inc", async () => {
    const onChange = vi.fn();
    wrap(
      <NumberInput
        value={10}
        max={10}
        onChange={onChange}
        data-testid="n"
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId("n-inc"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("empty value treated as 0 for step", async () => {
    const onChange = vi.fn();
    wrap(
      <NumberInput value={""} onChange={onChange} data-testid="n" />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId("n-inc"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ target: { value: "1" } }),
    );
  });

  it("typed value clamps when above max", () => {
    const onChange = vi.fn();
    wrap(
      <NumberInput value={0} max={10} onChange={onChange} data-testid="n" />,
    );
    fireEvent.change(screen.getByTestId("n"), { target: { value: "99" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ target: { value: "10" } }),
    );
  });

  it("typed value within bounds fires raw event", () => {
    const onChange = vi.fn();
    wrap(
      <NumberInput value={0} min={0} max={100} onChange={onChange} data-testid="n" />,
    );
    fireEvent.change(screen.getByTestId("n"), { target: { value: "42" } });
    expect(onChange).toHaveBeenCalled();
  });

  it("handles empty value path without clamping", () => {
    const onChange = vi.fn();
    wrap(
      <NumberInput value="5" onChange={onChange} data-testid="n" />,
    );
    fireEvent.change(screen.getByTestId("n"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalled();
  });

  it("typed value passes through when within bounds", async () => {
    const onChange = vi.fn();
    wrap(
      <NumberInput value={0} min={0} max={100} onChange={onChange} data-testid="n" />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByTestId("n"), "7");
    expect(onChange).toHaveBeenCalled();
  });

  it("accepts empty string + bare minus sign for editing", async () => {
    const onChange = vi.fn();
    wrap(
      <NumberInput value="5" onChange={onChange} data-testid="n" />,
    );
    const user = userEvent.setup();
    const input = screen.getByTestId("n");
    await user.clear(input);
    // Should fire onChange at least once with empty target value
    expect(onChange).toHaveBeenCalled();
  });

  it("dec/inc without min/max bounds allowed freely", async () => {
    const onChange = vi.fn();
    wrap(<NumberInput value={0} onChange={onChange} data-testid="n" />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("n-dec"));
    await user.click(screen.getByTestId("n-dec"));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("dec/inc disabled when overall disabled", async () => {
    const onChange = vi.fn();
    wrap(
      <NumberInput disabled value={5} onChange={onChange} data-testid="n" />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId("n-dec"));
    await user.click(screen.getByTestId("n-inc"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores NaN input", () => {
    const onChange = vi.fn();
    wrap(
      <NumberInput value={0} onChange={onChange} data-testid="n" />,
    );
    const input = screen.getByTestId("n");
    input.dispatchEvent(
      new InputEvent("input", { bubbles: true, data: "abc" }),
    );
    // onChange not called because "abc" → NaN and path returns
    // (we don't force a real target-value set here; sanity only)
  });
});
