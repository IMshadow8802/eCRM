import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";
import RadioGroup from "./RadioGroup";

const wrap = (ui, mode = "light") =>
  render(<ThemeProvider theme={buildTheme(mode)}>{ui}</ThemeProvider>);

const OPTS = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month", disabled: true },
];

describe("RadioGroup", () => {
  it("renders all options", () => {
    wrap(
      <RadioGroup
        options={OPTS}
        value="day"
        onChange={() => {}}
        data-testid="rg"
      />,
    );
    expect(screen.getByTestId("rg-day")).toBeInTheDocument();
    expect(screen.getByTestId("rg-week")).toBeInTheDocument();
    expect(screen.getByTestId("rg-month")).toBeInTheDocument();
  });

  it("active option aria-checked true", () => {
    wrap(<RadioGroup options={OPTS} value="week" onChange={() => {}} data-testid="rg" />);
    expect(screen.getByTestId("rg-week")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("rg-day")).toHaveAttribute("aria-checked", "false");
  });

  it("click fires onChange with option value", async () => {
    const onChange = vi.fn();
    wrap(<RadioGroup options={OPTS} value="day" onChange={onChange} data-testid="rg" />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("rg-week"));
    expect(onChange).toHaveBeenCalledWith("week");
  });

  it("disabled option blocks click", async () => {
    const onChange = vi.fn();
    wrap(<RadioGroup options={OPTS} value="day" onChange={onChange} data-testid="rg" />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("rg-month"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("group-level disabled blocks all", async () => {
    const onChange = vi.fn();
    wrap(
      <RadioGroup
        options={OPTS}
        value="day"
        disabled
        onChange={onChange}
        data-testid="rg"
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId("rg-week"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("column orientation + sizes render", () => {
    for (const size of ["sm", "md", "lg"]) {
      wrap(
        <RadioGroup
          options={OPTS}
          value="day"
          onChange={() => {}}
          orientation="col"
          size={size}
          data-testid={`rg-${size}`}
        />,
      );
      expect(screen.getByTestId(`rg-${size}`)).toBeInTheDocument();
    }
  });

  it("renders icon when option provides one", () => {
    wrap(
      <RadioGroup
        options={[{ value: "a", label: "A", icon: <span data-testid="ic">I</span> }]}
        value="a"
        onChange={() => {}}
        data-testid="rg"
      />,
    );
    expect(screen.getByTestId("ic")).toBeInTheDocument();
  });
});
