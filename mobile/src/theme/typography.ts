// src/theme/typography.ts
//
// Every piece of text in the app picks a VARIANT, never a size and weight.
// `<Text variant="h2">` not `fontSize: 20, fontWeight: "600"`. That way the
// type scale stays consistent and retuning it is one file.
//
// React Native cannot synthesise weights for custom fonts — `fontWeight: 600`
// on Inter silently renders regular on Android. The weight IS the family,
// which is why each variant names a concrete Inter file.
//
// Inter, not Poppins (changed 2026-08-02). Poppins is a geometric display face:
// circular bowls, a small x-height, and wide letterforms that read as friendly
// rather than businesslike. Inter was drawn for UI at small sizes — a tall
// x-height, open apertures, and tabular-width digits, which matters on a screen
// full of counts, hours and dates.
//
// That x-height difference is why the sizes below dropped a step: Inter at 15px
// looks roughly the size Poppins did at 17. Heading line heights came down with
// them so the ratio holds; body line heights did not, which buys running text a
// little more air at the smaller size.

import { colors } from "./tokens";

export const fontFamily = {
  /**
   * Inter Regular (400) is loaded but no variant uses it — the app's baseline
   * weight is Medium (500). Kept available for anything that genuinely needs to
   * recede further than `secondary` does.
   */
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
  black: "Inter_900Black",
} as const;

export type FontWeightName = keyof typeof fontFamily;

/**
 * Tuned for Inter's x-height — a step smaller than the Poppins scale above
 * 13px, unchanged below it. Small text needs every pixel of legibility, and at
 * 11–13px the two faces read at about the same size anyway.
 */
export const fontSize = {
  xs: 11,
  sm: 13,
  base: 14,
  md: 15,
  lg: 17,
  xl: 19,
  "2xl": 22,
  "3xl": 28,
} as const;

export interface TextStyleToken {
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  color: string;
  letterSpacing?: number;
  textTransform?: "uppercase" | "none";
}

/**
 * The full type scale. Add a variant here rather than one-off styles in a
 * screen — if two screens need the same treatment, it belongs in this file.
 */
export const typography = {
  /**
   * Screen titles. One per screen, at most.
   *
   * The negative tracking on the three headings is Inter's own guidance: it is
   * spaced for body copy, so at display sizes the default gaps read loose.
   */
  h1: {
    fontSize: fontSize["2xl"],
    fontFamily: fontFamily.bold,
    lineHeight: 30,
    color: colors.text,
    letterSpacing: -0.4,
  },
  /** Section headers, modal titles. */
  h2: {
    fontSize: fontSize.xl,
    fontFamily: fontFamily.semibold,
    lineHeight: 26,
    color: colors.text,
    letterSpacing: -0.3,
  },
  /** Card titles, list-row primary text. */
  h3: {
    fontSize: fontSize.md,
    fontFamily: fontFamily.semibold,
    lineHeight: 21,
    color: colors.text,
    letterSpacing: -0.15,
  },
  /** Default running text. Medium (500) is the app-wide baseline weight. */
  body: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.medium,
    lineHeight: 22,
    color: colors.text,
  },
  /**
   * Body text that needs emphasis without being a heading. Semibold, because
   * body is already Medium — Medium-on-Medium would read as no emphasis.
   */
  bodyStrong: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.semibold,
    lineHeight: 22,
    color: colors.text,
  },
  /**
   * Supporting text under a title — metadata, timestamps, counts.
   *
   * Semibold, not Medium. Small type needs MORE weight than large type, not
   * less: at 13px a Medium stroke on white is thin enough to grey out, and the
   * headings above it end up carrying the whole page. The small variants below
   * are all semibold for the same reason.
   */
  secondary: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  /** Form labels, tab labels. */
  label: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  /** Button text. */
  button: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.semibold,
    lineHeight: 20,
    color: colors.textOnBrand,
  },
  /** Chips, badges, counters. The smallest type, so the heaviest of the body weights. */
  caption: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  /** Group headers in lists — OVERDUE, TODAY. */
  overline: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    lineHeight: 16,
    color: colors.textSecondary,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
} as const satisfies Record<string, TextStyleToken>;

export type TypographyVariant = keyof typeof typography;
