import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";

import { buildTheme } from "../../theme";
import { palettes } from "../../styles/tokens";
import TrendArea from "./TrendArea";

const wrap = (ui, mode = "light") =>
  render(<ThemeProvider theme={buildTheme(mode)}>{ui}</ThemeProvider>);

// jsdom reports computed colours as rgb(); the tokens are hex.
const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

const SERIES = [
  { key: "Created", label: "Created", tone: "primary" },
  { key: "Lost", label: "Lost", tone: "error" },
  { key: "Odd", label: "Odd", tone: "nope" }, // unknown tone falls back to primary
];
const DATA = [
  { Bucket: "2026-09-01", Created: 4, Lost: 1, Odd: 0 },
  { Bucket: "2026-09-08", Created: 6, Lost: 2, Odd: 1 },
];

describe("TrendArea", () => {
  it("renders one legend entry per series, in order", () => {
    wrap(<TrendArea data={DATA} series={SERIES} />);
    expect(screen.getByTestId("trend-area-legend-Created")).toHaveTextContent("Created");
    expect(screen.getByTestId("trend-area-legend-Lost")).toHaveTextContent("Lost");
    expect(screen.getByTestId("trend-area-legend-Odd")).toHaveTextContent("Odd");
    expect(screen.getByTestId("trend-area")).toBeInTheDocument();
  });

  // The legend dot is painted with the resolved token, so it is the one DOM
  // node that proves `tone` went through the theme rather than a literal.
  const dotColor = (id) =>
    getComputedStyle(screen.getByTestId(id).previousSibling).backgroundColor;

  it("paints each series with its theme token, unknown tones falling back to primary", () => {
    wrap(<TrendArea data={DATA} series={SERIES} />);
    const { primary, error } = palettes.light;
    expect(dotColor("trend-area-legend-Created")).toBe(hex(primary.main));
    expect(dotColor("trend-area-legend-Lost")).toBe(hex(error.main));
    expect(dotColor("trend-area-legend-Odd")).toBe(hex(primary.main));
  });

  it("follows the theme into dark mode", () => {
    wrap(<TrendArea data={DATA} series={SERIES} />, "dark");
    expect(palettes.dark.primary.main).not.toBe(palettes.light.primary.main);
    expect(dotColor("trend-area-legend-Created")).toBe(hex(palettes.dark.primary.main));
  });

  it("renders in dark mode and with no data or series", () => {
    wrap(<TrendArea data={[]} series={[]} data-testid="empty-trend" />, "dark");
    expect(screen.getByTestId("empty-trend")).toBeInTheDocument();
    expect(screen.queryByTestId("empty-trend-legend-Created")).toBeNull();
  });

});
