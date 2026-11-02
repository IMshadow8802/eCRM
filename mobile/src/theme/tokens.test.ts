// Pins the theme to E · Midnight Sorbet (direction-e-blend.html). The literal
// table below is copied from E, not from tokens.ts, so a drift in either fails.
import * as tokens from "./tokens";

const { badgeTones, chipTones, colors, elevation, metrics, moduleTones, palette, radius } = tokens;

/** WCAG 2.x relative luminance of a #RRGGBB colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe("E §1.1 palette", () => {
  it.each([
    ["navy 900", palette.navy[900], "#171D47"],
    ["navy 800", palette.navy[800], "#20285A"],
    ["navy 700", palette.navy[700], "#2C3570"],
    ["navy muted", palette.navy.muted, "#A9B0D6"],
    ["navy soft", palette.navy.soft, "#D3D7EE"],
    ["indigo 300", palette.indigo[300], "#8592F0"],
    ["indigo 500", palette.indigo[500], "#3F4FAF"],
    ["indigo 600", palette.indigo[600], "#34429A"],
    ["indigo 50", palette.indigo[50], "#E6E8F6"],
    ["sheet", palette.sheet, "#EEF0F8"],
    ["white", palette.white, "#FFFFFF"],
    ["line", palette.line, "#ECEEF5"],
    ["line2", palette.line2, "#D3D8E6"],
    ["skeleton", palette.skeleton, "#DFE3EF"],
    ["skeleton2", palette.skeleton2, "#E8EBF4"],
    ["ink 900", palette.ink[900], "#141936"],
    ["ink 700", palette.ink[700], "#4A5072"],
    ["ink 500", palette.ink[500], "#5F6687"],
    ["coral", palette.coral, "#D23F2A"],
    ["danger", palette.danger, "#C42D1B"],
    ["ok", palette.ok, "#1F7A3E"],
  ])("%s", (_, actual, expected) => expect(actual).toBe(expected));

  it("auth gradient is E's three stops", () => {
    expect(palette.auth).toEqual(["#4B5BC0", "#3F4FAF", "#27317A"]);
    expect(tokens.gradients.auth).toEqual(palette.auth);
  });
});

describe("E §1.2 semantic colours", () => {
  const E: Record<string, string> = {
    background: "#EEF0F8", surface: "#FFFFFF", surfaceMuted: "#F5F6FB", surfaceSunken: "#E2E5F1",
    text: "#141936", textSecondary: "#4A5072", textMuted: "#5F6687", textInverse: "#FFFFFF", textOnBrand: "#FFFFFF",
    border: "#D3D8E6", borderStrong: "#A3AAC6", divider: "#ECEEF5",
    primary: "#3F4FAF", primaryPressed: "#34429A", primarySoft: "#E6E8F6",
    success: "#1F7A3E", successSoft: "#D3F2CB", warning: "#745400", warningSoft: "#FFF1C2",
    danger: "#C42D1B", dangerSoft: "#FFDCD7", info: "#1E4C96", infoSoft: "#DDEBFF",
    surfacePressed: "#F1F2FA", disabledBg: "#D6DAE8", disabledText: "#5F6687",
    band: "#171D47", bandRaised: "#20285A", bandField: "#2C3570", onBandMuted: "#A9B0D6", onBandSoft: "#D3D7EE",
    bandMark: "#8592F0", coral: "#D23F2A", onBrandMuted: "#DDE1F7", onBrandWarn: "#FFD27A",
    onBrandOverrun: "#FFB3A6", onBrandDivider: "#5A68C2", dangerText: "#A8200F", successText: "#1D6312",
    warningText: "#745400", fieldTint: "#F1F2FA", unreadTint: "#F4F5FC", followUpTint: "#FFF8DD",
    dangerCardTint: "#FFEDEA", dangerRowTint: "#FFF0ED", secondaryFill: "#E3E6F3", track: "#DDE1EE",
    iconFaint: "#B9C0D6", grabber: "#C9CEDF", skeleton: "#DFE3EF", skeletonSoft: "#E8EBF4",
    swipeHold: "#8A5A00", escalate: "#5B2D9E", greetIcon: "#FFE48C", shadowWhisper: "#DCE0EC",
    shadowPopover: "#D2D6E5", footerLine: "#E4E7F1",
  };
  it.each(Object.entries(E))("%s", (key, hex) => expect(colors[key as keyof typeof colors]).toBe(hex));

  it("the scrim is E's and the only translucent value in the theme", () => {
    expect(colors.overlay).toBe("rgba(9, 12, 34, 0.56)");
    const rgba = JSON.stringify(tokens).match(/rgba\(/g) ?? [];
    expect(rgba).toHaveLength(1);
  });

  it("retired keys still resolve, as aliases", () => {
    expect(colors.accent).toBe(colors.primary);
    expect(colors.accentPressed).toBe(colors.primaryPressed);
    expect(colors.textOnBrandMuted).toBe(colors.onBrandMuted);
  });
});

describe("E §1.4 chip tones", () => {
  const E = {
    sky: ["#DDEBFF", "#1E4C96"], butter: ["#FFF1C2", "#745400"], green: ["#D3F2CB", "#1D6312"],
    red: ["#FFDCD7", "#A8200F"], lilac: ["#ECE3FC", "#5B2D9E"], teal: ["#D2F1F0", "#0D5C5A"],
    slate: ["#E4E8F4", "#39436B"], peach: ["#FFE3D9", "#A3321B"], mint: ["#D6F3E6", "#146345"],
    indigo: ["#E6E8F6", "#3F4FAF"], brand: ["#3F4FAF", "#FFFFFF"],
  } as const;
  it.each(Object.entries(E))("%s", (tone, [fill, text]) =>
    expect(chipTones[tone as keyof typeof E]).toEqual({ fill, text }));

  it.each([
    ["info", "sky"], ["warning", "butter"], ["success", "green"], ["danger", "red"], ["urgent", "red"],
    ["purple", "lilac"], ["neutral", "slate"], ["primary", "indigo"],
  ] as const)("old name %s aliases %s", (old, hue) => expect(chipTones[old]).toBe(chipTones[hue]));

  it.each(Object.entries(chipTones))("%s clears 4.5 : 1", (_, { fill, text }) =>
    expect(contrast(fill, text)).toBeGreaterThanOrEqual(4.5));
});

describe("E §1.5 badge tones", () => {
  const E = {
    sky: ["#CFE0FF", "#1E4C96"], butter: ["#FFE48C", "#574000"], green: ["#C2EBB8", "#1D6312"],
    red: ["#FFCFC8", "#8F1B0D"], lilac: ["#D9C8FA", "#3B1C6B"], teal: ["#BDEBE8", "#0D5C5A"],
    slate: ["#D9DEEE", "#2E3760"], peach: ["#FFCCB8", "#6E1F0E"], mint: ["#BCEBD5", "#0D4A33"],
    indigo: ["#D5D9F5", "#2E3A8C"],
  } as const;
  it.each(Object.entries(E))("%s", (tone, [fill, ink]) =>
    expect(badgeTones[tone as keyof typeof E]).toEqual({ fill, ink }));
  it.each(Object.entries(badgeTones))("%s clears 4.5 : 1", (_, { fill, ink }) =>
    expect(contrast(fill, ink)).toBeGreaterThanOrEqual(4.5));
});

describe("E §1.3 module tones", () => {
  it.each([
    ["home", "#D5D9F5", "#2E3A8C"], ["inbox", "#D5D9F5", "#2E3A8C"], ["tasks", "#D9C8FA", "#3B1C6B"],
    ["complaints", "#FFCCB8", "#6E1F0E"], ["leads", "#BCEBD5", "#0D4A33"], ["followups", "#FFE48C", "#574000"],
    ["more", "#D9DEEE", "#2E3760"],
  ] as const)("%s tile is %s / %s", (m, fill, ink) => expect(badgeTones[moduleTones[m].badge]).toEqual({ fill, ink }));
});

describe("text and controls on their surfaces clear AA", () => {
  it.each([
    ["ink 2 on sheet", colors.textSecondary, colors.background],
    ["ink 3 on sheet", colors.textMuted, colors.background],
    ["muted on band", colors.onBandMuted, colors.band],
    ["muted on band field", colors.onBandMuted, colors.bandField],
    ["white on coral", colors.textOnBrand, colors.coral],
    ["white on danger", colors.textOnBrand, colors.danger],
    ["white on success", colors.textOnBrand, colors.success],
    ["white on swipe hold", colors.textOnBrand, colors.swipeHold],
    ["white on escalate", colors.textOnBrand, colors.escalate],
    ["on-brand muted on primary", colors.onBrandMuted, colors.primary],
    ["on-brand warn on primary", colors.onBrandWarn, colors.primary],
  ])("%s", (_, fg, bg) => expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5));
});

describe("E §1.8–1.10 sizes and depth", () => {
  it("metrics", () => {
    expect(metrics).toMatchObject({
      gutter: 16, bandRow: 52, bandRowHome: 56, bandRowTablet: 60, controlHeight: 44,
      buttonHeight: { md: 48, sm: 36, xs: 32 }, iconButton: 40, searchHeight: 40, pillHeight: 32,
      segmentHeight: 34, bandTabHeight: 44, bottomBarContent: 58, railWidth: 92, railItem: 62,
      listPaneWidth: 420, formMaxWidth: 640, tileHeight: 112, sepInset: { badge: 66, check: 48, none: 14 },
    });
    expect(Object.isFrozen(metrics)).toBe(true);
    expect(tokens.CONTROL_HEIGHT).toBe(44);
    expect(tokens.TAB_BAR_CLEARANCE).toBe(0);
  });
  it("radius by use", () => {
    expect(radius).toMatchObject({
      mark: 3, check: 7, badgeXs: 9, badgeSm: 10, chip: 11, badge: 12, badgeLg: 14, bar: 15, card: 16,
      segment: 17, column: 18, sheet: 20, modal: 24, full: 9999,
    });
  });
  it("shadows are solid colours, and the old card shadow is the whisper", () => {
    expect(elevation.whisper).toEqual({ boxShadow: "0 1px 2px #DCE0EC" });
    expect(elevation.popover).toEqual({ boxShadow: "0 4px 12px #D2D6E5" });
    expect(elevation.footer).toEqual({ boxShadow: "0 -1px 0 #E4E7F1" });
    expect(tokens.shadows.md).toBe(elevation.whisper);
  });
  it("font-scale caps", () => expect(tokens.fontScaleCap).toEqual({ body: 1.3, chrome: 1.15, figure: 1.2 }));
});
