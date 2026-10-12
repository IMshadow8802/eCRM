import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { Clock } from "lucide-react";

import { buildTheme } from "../../theme";
import { palettes } from "../../styles/tokens";
import IconBadge from "./IconBadge";

const wrap = (ui, mode = "light") => render(<ThemeProvider theme={buildTheme(mode)}>{ui}</ThemeProvider>);
const hex = (h) => `rgb(${[1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(", ")})`;

describe("IconBadge", () => {
  it("fills solid with the tone's main colour and hides from assistive tech", () => {
    wrap(<IconBadge icon={Clock} tone="success" data-testid="b" />);
    const b = screen.getByTestId("b");
    expect(b).toHaveAttribute("aria-hidden", "true");
    expect(b.style.background).toBe(hex(palettes.light.success.main));
    expect(b.style.color).toBe(hex(palettes.light.success.contrastText));
    expect(b.querySelector("svg")).toBeInTheDocument();
  });

  it("is solid in dark mode too, never a translucent tint", () => {
    wrap(<IconBadge icon={Clock} tone="violet" size="lg" data-testid="d" />, "dark");
    const d = screen.getByTestId("d");
    expect(d.style.background).toBe(hex(palettes.dark.violet.main));
    expect(d.style.background).not.toContain("rgba");
  });

  it("falls back to primary for an unknown tone and md for an unknown size", () => {
    wrap(<IconBadge icon={Clock} tone="nope" size="xx" data-testid="f" />);
    const f = screen.getByTestId("f");
    expect(f.style.background).toBe(hex(palettes.light.primary.main));
    expect(f.style.width).toBe(`${28 / 15}rem`);
  });
});
