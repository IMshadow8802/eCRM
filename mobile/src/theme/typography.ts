// src/theme/typography.ts
//
// Every piece of text picks a VARIANT, never a size and weight (E §1.7).
// React Native cannot synthesise weights for a custom font — `fontWeight: 600`
// on Inter silently renders regular on Android — so the weight IS the family,
// and each variant names a concrete Inter file. `fontWeight` is never written
// (guarded in designRules.test.ts).

import { colors, type FontScaleGroup } from "./tokens";

export const fontFamily = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
  black: "Inter_900Black",
} as const;

export type FontWeightName = keyof typeof fontFamily;

export interface TextStyleToken {
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  color: string;
  letterSpacing?: number;
  textTransform?: "uppercase" | "none";
  fontVariant?: "tabular-nums"[];
}

const TAB = ["tabular-nums"] as "tabular-nums"[];
const v = (
  size: number, line: number, family: string, color: string = colors.text,
  extra: Partial<TextStyleToken> = {},
): TextStyleToken => ({ fontSize: size, lineHeight: line, fontFamily: family, color, ...extra });
const { regular: R, medium: M, semibold: S, bold: B } = fontFamily;

/**
 * The ramp, in E's order. `body`/`bodyStrong` are E's 15/20 (input text,
 * button labels); a pre-E screen that used them for 14 px running text now
 * reads one step larger until Phase 2 moves it to `text` / `rowTitle`.
 */
export const typography = {
  display: v(28, 34, B, colors.text, { letterSpacing: -0.3 }),
  statLg: v(40, 46, B, colors.text, { letterSpacing: -0.5, fontVariant: TAB }),
  stat: v(32, 38, B, colors.text, { letterSpacing: -0.5, fontVariant: TAB }),
  tileValue: v(28, 32, B, colors.text, { fontVariant: TAB }),
  statValue: v(28, 34, B, colors.text, { fontVariant: TAB }),
  titleXl: v(26, 32, B),
  figure: v(24, 30, B, colors.text, { fontVariant: TAB }),
  titleLg: v(24, 30, B),
  h1: v(22, 28, B, colors.text, { letterSpacing: -0.2 }),
  recordTitle: v(20, 26, B),
  sheetTitle: v(18, 24, B),
  h2: v(17, 22, S),
  cardTitle: v(16, 22, S),
  groupTitle: v(16, 22, B),
  stepper: v(16, 22, B, colors.text, { fontVariant: TAB }),
  bodyLg: v(15, 22, R),
  body: v(15, 20, R),
  bodyStrong: v(15, 20, S),
  rowTitle: v(14, 20, S),
  rowTitleRead: v(14, 20, M),
  rowTitleBold: v(14, 20, B),
  text: v(14, 20, R),
  amount: v(14, 20, B, colors.text, { fontVariant: TAB }),
  meta: v(13, 18, R, colors.textSecondary),
  metaMedium: v(13, 18, M, colors.textSecondary),
  metaStrong: v(13, 18, S, colors.textSecondary),
  tab: v(14, 20, S, colors.onBandMuted),
  label: v(12, 16, S, colors.textSecondary),
  small: v(12, 16, R, colors.textMuted),
  smallMedium: v(12, 16, M, colors.textSecondary),
  overline: v(12, 16, S, colors.textMuted, { letterSpacing: 0.6, textTransform: "uppercase" }),
  navLabel: v(11, 14, M, colors.onBandMuted),
  navLabelActive: v(11, 14, S, colors.textOnBrand),
  count: v(11, 18, B, colors.onBandSoft, { fontVariant: TAB }),
  badge: v(10, 14, B, colors.textOnBrand, { fontVariant: TAB }),
  avatar: v(11, 14, B),

  // ---- retired (Task 40): pre-E names, mapped per spec §1.7
  h3: v(14, 20, S),
  secondary: v(13, 18, R, colors.textSecondary),
  button: v(15, 20, S, colors.textOnBrand),
  caption: v(12, 16, S, colors.textSecondary),
} as const satisfies Record<string, TextStyleToken>;

export type TypographyVariant = keyof typeof typography;

/** Which `fontScaleCap` a variant falls under; anything unlisted is `body`. */
export const variantScaleGroup: Partial<Record<TypographyVariant, FontScaleGroup>> = {
  navLabel: "chrome", navLabelActive: "chrome", count: "chrome", badge: "chrome", tab: "chrome",
  stat: "figure", statLg: "figure", tileValue: "figure", statValue: "figure", figure: "figure",
};
