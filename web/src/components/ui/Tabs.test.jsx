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

// Regression, 2026-09-19: the strip was an `inline-flex` that neither wrapped
// nor scrolled. Tab lists here are DB-driven — lookup kinds, ticket presets,
// report group-bys — so their width is not something a designer ever fixed.
// `<main>` clips rather than scrolls, so the tabs past the edge were not
// off-screen, they were gone: no gesture could reach them. Five separate
// areas of the app lost tabs this way.
describe("overflow", () => {
  const many = Array.from({ length: 9 }, (_, i) => ({
    value: `k${i}`,
    label: `Lookup kind number ${i}`,
  }));

  it("scrolls the strip instead of letting it overflow the page", () => {
    wrap(
      <Tabs value="k0" onChange={() => {}} items={many} data-testid="t" />,
    );
    const strip = screen.getByTestId("t");
    expect(strip.style.overflowX).toBe("auto");
    expect(strip.style.display).toBe("flex");
  });

  it("keeps every tab in the DOM and reachable", () => {
    wrap(
      <Tabs value="k0" onChange={() => {}} items={many} data-testid="t" />,
    );
    expect(screen.getAllByRole("tab")).toHaveLength(9);
    expect(screen.getByRole("tab", { name: "Lookup kind number 8" })).toBeInTheDocument();
  });

  // Without these the buttons squash to min-content first and still overflow,
  // so labels break mid-word before anything scrolls.
  it("stops the tabs squashing or wrapping their labels", () => {
    wrap(
      <Tabs value="k0" onChange={() => {}} items={many} data-testid="t" />,
    );
    const tab = screen.getAllByRole("tab")[0];
    expect(tab.style.flexShrink).toBe("0");
    expect(tab.style.whiteSpace).toBe("nowrap");
  });
});
