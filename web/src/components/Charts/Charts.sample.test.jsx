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

const wrap = (ui) => render(<ThemeProvider theme={buildTheme("light")}>{ui}</ThemeProvider>);

describe("chart sample-data hint", () => {
  it.each([
    ["AreaTrend", <AreaTrend />, <AreaTrend data={[{ name: "Mon", leads: 2, converted: 1 }]} />],
    ["Donut", <Donut />, <Donut data={[{ name: "Google", value: 3 }]} />],
    ["Funnel", <Funnel />, <Funnel data={[{ name: "New", value: 4 }]} />],
    ["RadialLoad", <RadialLoad />, <RadialLoad data={[{ name: "Asha", value: 80 }]} />],
    ["ActivityBar", <ActivityBar />, <ActivityBar data={[{ name: "Q1", leads: 1, calls: 2, tickets: 3 }]} />],
  ])("%s shows the badge only on fallback", (_name, withoutData, withData) => {
    const { unmount } = wrap(withoutData);
    expect(screen.getByText("Sample data")).toBeInTheDocument();
    unmount();

    wrap(withData);
    expect(screen.queryByText("Sample data")).not.toBeInTheDocument();
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
