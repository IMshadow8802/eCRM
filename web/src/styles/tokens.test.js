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

  it("provides gradient tokens for both modes", () => {
    for (const mode of ["light", "dark"]) {
      expect(palettes[mode].gradient.heroCTA).toContain("linear-gradient");
      expect(palettes[mode].gradient.loginPanel).toContain("linear-gradient");
      expect(palettes[mode].gradient.emptyBlob).toContain("radial-gradient");
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
});
