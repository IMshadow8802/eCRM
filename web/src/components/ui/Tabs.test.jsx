import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@mui/material/styles";
import { buildTheme } from "../../theme";
import Tabs from "./Tabs";

const wrap = (ui) => render(<ThemeProvider theme={buildTheme()}>{ui}</ThemeProvider>);

const ITEMS = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta", badge: 3 },
  { value: "c", label: "Gamma", icon: <span data-testid="ic">i</span> },
];

describe("Tabs", () => {
  it("renders every item", () => {
    wrap(<Tabs value="a" onChange={() => {}} items={ITEMS} data-testid="t" />);
    expect(screen.getByTestId("t-a")).toBeInTheDocument();
    expect(screen.getByTestId("t-b")).toBeInTheDocument();
    expect(screen.getByTestId("t-c")).toBeInTheDocument();
  });

  it("active tab aria-selected true", () => {
    wrap(<Tabs value="b" onChange={() => {}} items={ITEMS} data-testid="t" />);
    expect(screen.getByTestId("t-b")).toHaveAttribute("aria-selected", "true");
  });

  it("click fires onChange", async () => {
    const onChange = vi.fn();
    wrap(<Tabs value="a" onChange={onChange} items={ITEMS} data-testid="t" />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("t-c"));
    expect(onChange).toHaveBeenCalledWith("c");
  });

  it("badge + icon render in tab", () => {
    wrap(<Tabs value="a" onChange={() => {}} items={ITEMS} data-testid="t" />);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByTestId("ic")).toBeInTheDocument();
  });

  it("size variants render", () => {
    for (const size of ["sm", "md", "lg"]) {
      wrap(
        <Tabs
          value="a"
          onChange={() => {}}
          items={ITEMS}
          size={size}
          data-testid={`t-${size}`}
        />,
      );
      expect(screen.getByTestId(`t-${size}`)).toBeInTheDocument();
    }
  });
});
