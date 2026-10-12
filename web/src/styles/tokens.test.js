import { describe, it, expect } from "vitest";
import {
  palettes,
  radii,
  spacing,
  fontFamilies,
  fontWeights,
  typography,
  motion,
  zIndex,
  controlHeight,
} from "./tokens";

describe("design tokens", () => {
  it("exposes light + dark palettes with matching shape", () => {
    expect(palettes.light.mode).toBe("light");
    expect(palettes.dark.mode).toBe("dark");
    const keys = Object.keys(palettes.light);
    for (const k of keys) expect(palettes.dark).toHaveProperty(k);
  });

  it("every semantic color has main/hover/subtle/border/contrastText in both modes", () => {
    const semantics = ["primary", "accent", "success", "warning", "error", "info"];
    for (const mode of ["light", "dark"]) {
      for (const s of semantics) {
        const c = palettes[mode][s];
        expect(c.main).toMatch(/^(#|rgba?)/);
        expect(c.hover).toBeTruthy();
        expect(c.subtle).toBeTruthy();
        expect(c.border).toBeTruthy();
        expect(c.contrastText).toBeTruthy();
      }
    }
  });

  it("surface/text/border tokens defined per mode", () => {
    for (const mode of ["light", "dark"]) {
      expect(palettes[mode].surface.page).toBeTruthy();
      expect(palettes[mode].surface.card).toBeTruthy();
      expect(palettes[mode].text.primary).toBeTruthy();
      expect(palettes[mode].border.default).toBeTruthy();
    }
  });

  it("has three elevation steps in both modes, each a layered shadow", () => {
    for (const mode of ["light", "dark"]) {
      for (const step of [1, 2, 3]) {
        const e = palettes[mode].elevation[step];
        // contact shadow + ambient shadow (dark adds a top highlight)
        expect(e.split("), ").length).toBeGreaterThanOrEqual(2);
      }
    }
    // dark lifts with a hairline highlight; light does not need one
    expect(palettes.dark.elevation[1]).toContain("inset");
    expect(palettes.light.elevation[1]).not.toContain("inset");
  });

  it("the page sits one step darker than a card, so a card reads as raised", () => {
    expect(palettes.light.surface.page).not.toBe(palettes.light.surface.card);
    expect(palettes.dark.surface.page).not.toBe(palettes.dark.surface.card);
  });

  it("inputs share one height scale, md flush with a medium button (36)", () => {
    expect(controlHeight).toEqual({ sm: 32, md: 36, lg: 48 });
  });

  it("is solid: no gradients, and no alpha outside the scrim and shadows", () => {
    for (const mode of ["light", "dark"]) {
      const { overlay, shadow, elevation, ...rest } = palettes[mode];
      expect(JSON.stringify(rest)).not.toMatch(/gradient|rgba\(/);
      expect(palettes[mode].brand.cta).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it("radii follow the 8/12/16/24 scale with full=9999", () => {
    expect(radii.sm).toBe(8);
    expect(radii.md).toBe(12);
    expect(radii.lg).toBe(16);
    expect(radii.xl).toBe(24);
    expect(radii.full).toBe(9999);
  });

  it("spacing is a 4px grid", () => {
    for (const key of Object.keys(spacing)) {
      expect(spacing[key] % 4).toBe(0);
    }
  });

  it("typography scale has all expected steps", () => {
    for (const step of [
      "display",
      "h1",
      "h2",
      "h3",
      "h4",
      "bodyLg",
      "body",
      "bodySm",
      "caption",
      "overline",
      "mono",
      "button",
      "label",
    ]) {
      expect(typography[step].size).toBeGreaterThan(0);
      expect(typography[step].line).toBeGreaterThan(0);
      expect([400, 500, 600, 700]).toContain(typography[step].weight);
    }
  });

  it("font families include Inter sans + JetBrains mono", () => {
    expect(fontFamilies.sans).toContain("Inter");
    expect(fontFamilies.mono).toContain("JetBrains Mono");
  });

  it("font weights expose the 4 intended levels", () => {
    expect(fontWeights.regular).toBe(400);
    expect(fontWeights.medium).toBe(500);
    expect(fontWeights.semibold).toBe(600);
    expect(fontWeights.bold).toBe(700);
  });

  it("motion tokens default to mellow durations", () => {
    expect(motion.duration.base).toBeGreaterThanOrEqual(200);
    expect(motion.duration.slow).toBeGreaterThanOrEqual(300);
    expect(motion.easing.standard).toContain("cubic-bezier");
    expect(motion.easing.emphasized).toContain("cubic-bezier");
  });

  it("z-index ladder is strictly increasing", () => {
    const order = ["base", "dropdown", "sticky", "overlay", "modal", "popover", "tooltip", "toast"];
    for (let i = 1; i < order.length; i++) {
      expect(zIndex[order[i]]).toBeGreaterThan(zIndex[order[i - 1]]);
    }
  });

  it("warning.text is amber readable as text (WCAG AA 4.5:1 on a card) in both modes", () => {
    const lum = (hex) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a, b) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    expect(palettes.light.warning.text).toBe("#B45309");
    for (const mode of ["light", "dark"]) {
      expect(ratio(palettes[mode].warning.text, palettes[mode].surface.card)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
