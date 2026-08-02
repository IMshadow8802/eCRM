// src/theme/typography.ts
//
// Every piece of text in the app picks a VARIANT, never a size and weight.
// `<Text variant="h2">` not `fontSize: 20, fontWeight: "600"`. That way the
// type scale stays consistent and retuning it is one file.
//
// React Native cannot synthesise weights for custom fonts — `fontWeight: 600`
// on Poppins silently renders regular on Android. The weight IS the family,
// which is why each variant names a concrete Poppins file.

import { colors } from "./tokens";

export const fontFamily = {
  regular: "Poppins-Regular",
  medium: "Poppins-Medium",
  semibold: "Poppins-SemiBold",
  bold: "Poppins-Bold",
  black: "Poppins-Black",
} as const;

export type FontWeightName = keyof typeof fontFamily;

export const fontSize = {
  xs: 11,
  sm: 13,
  base: 15,
  md: 16,
  lg: 18,
  xl: 20,
  "2xl": 24,
  "3xl": 30,
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
  /** Screen titles. One per screen, at most. */
  h1: {
    fontSize: fontSize["2xl"],
    fontFamily: fontFamily.bold,
    lineHeight: 32,
    color: colors.text,
  },
  /** Section headers, modal titles. */
  h2: {
    fontSize: fontSize.xl,
    fontFamily: fontFamily.semibold,
    lineHeight: 28,
    color: colors.text,
  },
  /** Card titles, list-row primary text. */
  h3: {
    fontSize: fontSize.md,
    fontFamily: fontFamily.semibold,
    lineHeight: 22,
    color: colors.text,
  },
  /** Default running text. */
  body: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.regular,
    lineHeight: 22,
    color: colors.text,
  },
  /** Body text that needs emphasis without being a heading. */
  bodyStrong: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.medium,
    lineHeight: 22,
    color: colors.text,
  },
  /** Supporting text under a title — metadata, timestamps, counts. */
  secondary: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.regular,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  /** Form labels, tab labels. */
  label: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.medium,
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
  /** Chips, badges, counters. */
  caption: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.medium,
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
