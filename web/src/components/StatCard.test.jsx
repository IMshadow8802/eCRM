import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { Users } from "lucide-react";

import { buildTheme } from "../theme";
import StatisticsCard from "./StatCard";

const wrap = (ui, mode = "light") =>
  render(<ThemeProvider theme={buildTheme(mode)}>{ui}</ThemeProvider>);

describe("StatisticsCard", () => {
  it("renders its title and value", () => {
    wrap(<StatisticsCard title="Today's new leads" value="55" icon={<Users />} />);
    expect(screen.getByText("Today's new leads")).toBeInTheDocument();
    expect(screen.getByText("55")).toBeInTheDocument();
  });

  // Regression, 2026-09-19: at 360px the KPI grid resolves to two ~162px
  // tiles with ~120px of content each. A money value like ₹45,23,180.00 is 13
  // tabular digits and ONE unbreakable word, so it spilled out of the card and
  // over its neighbour; and the icon, a flex item with a fixed width and the
  // default shrink, was squeezed while the label overran the padding.
  it("lets a long money value shrink and then break instead of spilling", () => {
    wrap(<StatisticsCard title="Open value" value="₹45,23,180.00" icon={<Users />} />);
    const value = screen.getByText("₹45,23,180.00");
    expect(value.style.overflowWrap).toBe("anywhere");
    expect(value.style.fontSize).toBe("clamp(22px, 6vw, 30px)");
  });

  it("keeps the icon at its size and makes the label absorb the squeeze", () => {
    const { container } = wrap(
      <StatisticsCard title="TODAY'S FOLLOW-UPS" value="7" icon={<Users />} />,
    );
    const iconSlot = container.querySelector("span");
    expect(iconSlot.style.flexShrink).toBe("0");
    expect(iconSlot.style.width).toBe("32px");

    const label = screen.getByText("TODAY'S FOLLOW-UPS");
    expect(label.style.minWidth).toBe("0");
    expect(label.style.overflowWrap).toBe("anywhere");
  });

  it("renders in dark mode without reaching for a light-mode literal", () => {
    wrap(<StatisticsCard title="Open" value="3" icon={<Users />} />, "dark");
    expect(screen.getByText("Open")).toBeInTheDocument();
  });
});
