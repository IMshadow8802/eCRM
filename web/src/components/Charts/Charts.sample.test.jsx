import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";

import { buildTheme } from "../../theme";
import AreaTrend from "./AreaTrend";
import Donut from "./Donut";
import Funnel from "./Funnel";
import RadialLoad from "./RadialLoad";
import ActivityBar from "./ActivityBar";
import RadialGoal from "./RadialGoal";
import SparkLine from "./SparkLine";
import SparkBar from "./SparkBar";
import Gauge from "./Gauge";

const wrap = (ui) => render(<ThemeProvider theme={buildTheme("light")}>{ui}</ThemeProvider>);

describe("charts never invent numbers", () => {
  // Regression: with no data these charts drew a hard-coded demo series
  // ("Google 42", "Visit 1200", ...) behind a small "Sample data" badge.
  it.each([
    ["AreaTrend", <AreaTrend />, <AreaTrend data={[{ name: "Mon", leads: 2, converted: 1 }]} />, "18"],
    ["Donut", <Donut />, <Donut data={[{ name: "Google", value: 3 }]} />, "Direct"],
    ["Funnel", <Funnel />, <Funnel data={[{ name: "New", value: 4 }]} />, "Inquiry"],
    ["RadialLoad", <RadialLoad />, <RadialLoad data={[{ name: "Asha", value: 80 }]} />, "Emails"],
    ["ActivityBar", <ActivityBar />, <ActivityBar data={[{ name: "Q1", leads: 1, calls: 2, tickets: 3 }]} />, "Q3"],
  ])("%s shows an empty state, not demo data, when it has none", (_name, withoutData, withData, demo) => {
    const { unmount, container } = wrap(withoutData);
    expect(screen.getByText("No data yet")).toBeInTheDocument();
    expect(screen.queryByText("Sample data")).not.toBeInTheDocument();
    expect(screen.queryByText(demo)).not.toBeInTheDocument();
    expect(container.querySelector(".recharts-responsive-container")).toBeNull();
    unmount();

    wrap(withData);
    expect(screen.queryByText("No data yet")).not.toBeInTheDocument();
  });

  it.each([["SparkLine", SparkLine], ["SparkBar", SparkBar]])(
    "%s shows only the real value, no invented trend or delta, without data",
    (_name, Comp) => {
      const { container, unmount } = wrap(<Comp label="Follow-ups" value={3} />);
      expect(screen.getByText("3")).toBeInTheDocument();
      expect(screen.queryByText(/%/)).not.toBeInTheDocument();
      expect(container.querySelector(".recharts-responsive-container")).toBeNull();
      unmount();

      const real = wrap(<Comp label="Follow-ups" value={3} data={[1, 2, 3]} />);
      expect(real.container.querySelector(".recharts-responsive-container")).not.toBeNull();
    },
  );

  it("Gauge shows 'of N' only when a real cap is given", () => {
    const { unmount } = wrap(<Gauge label="Missed" value={4} />);
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.queryByText(/^of /)).not.toBeInTheDocument();
    unmount();

    for (const [value, max] of [[1, 10], [4, 10], [9, 10]]) {
      const { unmount: u } = wrap(<Gauge label="Missed" value={value} max={max} unit="x" />);
      expect(screen.getByText(`of ${max}`)).toBeInTheDocument();
      u();
    }
  });

  it("SparkLine draws a real downward trend with its unit", () => {
    wrap(<SparkLine label="Calls" data={[10, 5]} unit="calls" tone="nope" />);
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("calls")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("AreaTrend totals reflect the real series when passed", () => {
    wrap(
      <AreaTrend
        data={[
          { name: "Mon", leads: 2, converted: 1 },
          { name: "Tue", leads: 3, converted: 2 },
        ]}
      />,
    );
    // Totals appear both in the KPI strip and the legend.
    expect(screen.getAllByText("5").length).toBeGreaterThan(0);
    expect(screen.getAllByText("3").length).toBeGreaterThan(0);
    expect(screen.queryByText("Sample data")).not.toBeInTheDocument();
  });

  it("AreaTrend handles a single row and a downward delta", () => {
    const { unmount } = wrap(<AreaTrend data={[{ name: "Mon", leads: 2, converted: 1 }]} />);
    expect(screen.queryByText("Sample data")).not.toBeInTheDocument();
    unmount();

    wrap(
      <AreaTrend
        data={[
          { name: "Mon", leads: 10, converted: 5 },
          { name: "Tue", leads: 2, converted: 1 },
        ]}
      />,
    );
    // down-delta chips render as percentages (both series dropped 80%)
    expect(screen.getAllByText(/80/).length).toBeGreaterThan(0);
  });

  it("Donut renders as a solid pie when variant is not donut", () => {
    wrap(<Donut variant="pie" data={[{ name: "Google", value: 3 }]} />);
    expect(screen.queryByText("Sample data")).not.toBeInTheDocument();
  });

  it("RadialGoal handles a downward delta and no secondary stats", () => {
    wrap(
      <RadialGoal value={2} goal={100} previousValue={10} label="Today's new leads" suffix="" secondary={[]} />,
    );
    expect(screen.getByText("Today's new leads")).toBeInTheDocument();
    expect(screen.queryByText("Yesterday")).not.toBeInTheDocument();
  });

  it("RadialGoal renders the given label, value and secondary stats", () => {
    wrap(
      <RadialGoal
        value={7}
        goal={100}
        previousValue={4}
        label="Today's new leads"
        suffix=""
        secondary={[
          { label: "Goal", value: "100" },
          { label: "Yesterday", value: "4" },
        ]}
      />,
    );
    expect(screen.getByText("Today's new leads")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("Yesterday")).toBeInTheDocument();
  });
});
