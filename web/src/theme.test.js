import { describe, it, expect } from "vitest";
import { buildTheme } from "./theme";
import { palettes, radii } from "./styles/tokens";

describe("buildTheme", () => {
  it("returns an MUI theme for light mode with token palette", () => {
    const t = buildTheme("light");
    expect(t.palette.mode).toBe("light");
    expect(t.palette.primary.main).toBe(palettes.light.primary.main);
    expect(t.palette.secondary.main).toBe(palettes.light.accent.main);
    expect(t.palette.background.default).toBe(palettes.light.surface.page);
    expect(t.palette.background.paper).toBe(palettes.light.surface.card);
  });

  it("returns an MUI theme for dark mode with token palette", () => {
    const t = buildTheme("dark");
    expect(t.palette.mode).toBe("dark");
    expect(t.palette.primary.main).toBe(palettes.dark.primary.main);
    expect(t.palette.secondary.main).toBe(palettes.dark.accent.main);
    expect(t.palette.background.default).toBe(palettes.dark.surface.page);
  });

  it("defaults to light when no mode given", () => {
    const t = buildTheme();
    expect(t.palette.mode).toBe("light");
  });

  it("shape.borderRadius matches radii.md (12)", () => {
    const t = buildTheme();
    expect(t.shape.borderRadius).toBe(radii.md);
  });

  it("exposes radii + tokens on theme", () => {
    const t = buildTheme("dark");
    expect(t.radii).toEqual(radii);
    expect(t.tokens.surface.page).toBe(palettes.dark.surface.page);
    expect(t.tokens.radii).toEqual(radii);
  });

  it("MuiButton override uses tokens (radius md, no uppercase)", () => {
    const t = buildTheme("light");
    const btn = t.components.MuiButton.styleOverrides.root;
    expect(btn.textTransform).toBe("none");
    expect(btn.borderRadius).toBe(radii.md);
  });

  it("MuiDialog uses lg radius + elevated border", () => {
    const t = buildTheme("light");
    expect(t.components.MuiDialog.styleOverrides.paper.borderRadius).toBe(radii.lg);
  });

  it("MuiChip uses pill radius (full)", () => {
    const t = buildTheme("light");
    expect(t.components.MuiChip.styleOverrides.root.borderRadius).toBe(radii.full);
  });
});
