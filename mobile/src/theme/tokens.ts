// src/theme/tokens.ts
//
// The single source of every colour, size, space, radius and shadow in the app.
// Nothing else may define one. No component writes `fontSize: 14`, `#3F4FAF`,
// `padding: 12` — it reads a token. Change a value here and it changes
// everywhere, which is the entire point.
//
// Enforced, not just requested: eslint bans colour literals and inline styles
// in components (see .eslintrc.js).
//
// The palette is unchanged from the previous app — the scheme was already
// right. What changed is that it is now the only place it lives.

export const palette = {
  brand: {
    base: "#3F4FAF",
    light: "#5A6BC0",
    dark: "#1E34AE",
  },
  accent: {
    base: "#F9629F",
    light: "#FF7AB7",
    dark: "#E5558C",
  },
  gray: {
    50: "#F9FAFB",
    100: "#F3F4F6",
    200: "#E5E7EB",
    300: "#D1D5DB",
    400: "#9CA3AF",
    500: "#6B7280",
    600: "#4B5563",
    700: "#374151",
    800: "#1F2937",
    900: "#111827",
  },
  red: {
    50: "#FEF2F2",
    100: "#FEE2E2",
    300: "#FCA5A5",
    500: "#EF4444",
    600: "#DC2626",
    700: "#B91C1C",
  },
  green: {
    50: "#F0FDF4",
    100: "#DCFCE7",
    300: "#86EFAC",
    500: "#22C55E",
    600: "#16A34A",
    700: "#15803D",
  },
  amber: {
    50: "#FFFBEB",
    100: "#FEF3C7",
    500: "#FBBF24",
    600: "#D97706",
    700: "#B45309",
  },
  blue: {
    50: "#EFF6FF",
    100: "#DBEAFE",
    500: "#3B82F6",
    600: "#2563EB",
    700: "#1D4ED8",
  },
  purple: {
    100: "#EDE9FE",
    400: "#A78BFA",
    500: "#8B5CF6",
  },
  white: "#FFFFFF",
  black: "#000000",
  transparent: "transparent",
} as const;

/**
 * Semantic colours. Components use THESE, not `palette.*` — so "the danger
 * colour" can be retuned in one line without hunting for every red.
 */
export const colors = {
  // surfaces
  background: palette.white,
  surface: palette.white,
  surfaceMuted: palette.gray[50],
  surfaceSunken: palette.gray[100],
  overlay: "rgba(17, 24, 39, 0.45)",

  // text
  text: palette.gray[900],
  textSecondary: palette.gray[500],
  textMuted: palette.gray[400],
  textInverse: palette.white,
  textOnBrand: palette.white,

  // lines
  border: palette.gray[200],
  borderStrong: palette.gray[300],
  divider: palette.gray[100],

  // interactive
  primary: palette.brand.base,
  primaryPressed: palette.brand.dark,
  primarySoft: "#EEF0FA",
  accent: palette.accent.base,
  accentPressed: palette.accent.dark,

  // feedback
  success: palette.green[600],
  successSoft: palette.green[50],
  warning: palette.amber[600],
  warningSoft: palette.amber[50],
  danger: palette.red[600],
  dangerSoft: palette.red[50],
  info: palette.blue[600],
  infoSoft: palette.blue[50],

  // task priority — used by chips and card accents
  priorityLow: palette.green[500],
  priorityMedium: palette.amber[500],
  priorityHigh: palette.red[500],
  priorityUrgent: palette.red[700],

  disabledBg: palette.gray[100],
  disabledText: palette.gray[400],
} as const;

/** 4px grid. `spacing[3]` is 12px. Never write a raw padding number. */
export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 28,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
  20: 80,
} as const;

export const radius = {
  none: 0,
  sm: 4,
  base: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  full: 9999,
} as const;

export const shadows = {
  none: {},
  sm: {
    shadowColor: palette.black,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  base: {
    shadowColor: palette.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: palette.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  lg: {
    shadowColor: palette.black,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
    elevation: 8,
  },
} as const;

/**
 * Minimum touch target. Anything tappable must reach this in both axes —
 * below it, taps get missed on real devices.
 */
export const HIT_TARGET = 44;

export type SpacingKey = keyof typeof spacing;
export type RadiusKey = keyof typeof radius;
export type ColorKey = keyof typeof colors;
