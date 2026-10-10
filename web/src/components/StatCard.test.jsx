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
    expect(value.style.fontSize).toMatch(/^clamp\([\d.]+rem, 6vw, 2rem\)$/);
  });

  it("keeps the icon at its size and makes the label absorb the squeeze", () => {
    const { container } = wrap(
      <StatisticsCard title="TODAY'S FOLLOW-UPS" value="7" icon={<Users />} />,
    );
    const iconSlot = container.querySelector("span");
    expect(iconSlot.style.flexShrink).toBe("0");
    expect(iconSlot.style.width).toBe("calc(2.13333rem)");

    const label = screen.getByText("TODAY'S FOLLOW-UPS");
    expect(label.style.minWidth).toBe("0");
    expect(label.style.overflowWrap).toBe("anywhere");
  });

  it("renders in dark mode without reaching for a light-mode literal", () => {
    wrap(<StatisticsCard title="Open" value="3" icon={<Users />} />, "dark");
    expect(screen.getByText("Open")).toBeInTheDocument();
  });

  const iconSlotColor = (props) => {
    const { container, unmount } = wrap(<StatisticsCard title="T" value="1" {...props} />);
    const color = container.querySelector("span").style.color;
    unmount();
    return color;
  };

  it("maps a colour alias onto its tone and falls back to primary for an unknown one", () => {
    const primary = iconSlotColor({ color: "primary", icon: <Users /> });
    const green = iconSlotColor({ color: "green", icon: <Users /> });
    const success = iconSlotColor({ color: "success", icon: <Users /> });

    expect(green).toBe(success);
    expect(green).not.toBe(primary);
    expect(iconSlotColor({ color: "chartreuse", icon: <Users /> })).toBe(primary);
  });

  it("renders an icon that is not an element as-is", () => {
    wrap(<StatisticsCard title="Stars" value="4" icon="*" />);
    expect(screen.getByText("*")).toBeInTheDocument();
  });

  it("turns the title and value white on a gradient card so they stay legible", () => {
    wrap(<StatisticsCard title="Revenue" value="12" icon={<Users />} gradient />);
    expect(screen.getByText("12").style.color).toBe("rgb(255, 255, 255)");
    expect(screen.getByText("Revenue").style.color).toBe("rgba(255, 255, 255, 0.88)");
  });

  it.each([
    ["up", "lucide-trending-up"],
    ["down", "lucide-trending-down"],
    ["flat", "lucide-minus"],
  ])("shows the %s trend with its own glyph and colour", (direction, glyph) => {
    const { container } = wrap(
      <StatisticsCard
        title="Leads"
        value="9"
        icon={<Users />}
        trend={{ direction, value: "+3%" }}
      />,
    );
    expect(container.querySelector(`.${glyph}`)).toBeInTheDocument();
    expect(screen.getByText("+3%")).toBeInTheDocument();
  });

  it("gives up and down trends different colours, and flat neither", () => {
    const trendColor = (direction) => {
      const { unmount } = wrap(
        <StatisticsCard
          title="Leads"
          value="9"
          icon={<Users />}
          trend={{ direction, value: "1" }}
        />,
      );
      const color = screen.getByText("1").style.color;
      unmount();
      return color;
    };
    const up = trendColor("up");
    const down = trendColor("down");
    const flat = trendColor("flat");
    expect(new Set([up, down, flat]).size).toBe(3);
  });

  it("paints the trend white on a gradient card whatever its direction", () => {
    wrap(
      <StatisticsCard
        title="Leads"
        value="9"
        icon={<Users />}
        gradient
        trend={{ direction: "down", value: "-2%" }}
      />,
    );
    expect(screen.getByText("-2%").style.color).toBe("rgb(255, 255, 255)");
  });

  it("renders a footer on its own, without a trend", () => {
    const { container } = wrap(
      <StatisticsCard title="Leads" value="9" icon={<Users />} footer="vs last week" />,
    );
    expect(screen.getByText("vs last week")).toBeInTheDocument();
    expect(container.querySelector(".lucide-minus")).toBeNull();
  });

  it("renders trend and footer together", () => {
    wrap(
      <StatisticsCard
        title="Leads"
        value="9"
        icon={<Users />}
        trend={{ direction: "up", value: "+3%" }}
        footer="vs last week"
      />,
    );
    expect(screen.getByText("+3%")).toBeInTheDocument();
    expect(screen.getByText("vs last week")).toBeInTheDocument();
  });

  it("tints the footer for the gradient ground", () => {
    wrap(
      <StatisticsCard title="Leads" value="9" icon={<Users />} gradient footer="vs last week" />,
    );
    expect(screen.getByText("vs last week").style.color).toBe("rgba(255, 255, 255, 0.85)");
  });
});
