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
  /**
   * Warm neutrals for SURFACES and LINES — the page background is warm
   * off-white, and a cool grey border on it reads as dirty rather than neutral.
   * Text keeps the `gray` ramp below: at text darkness the temperature does not
   * register, and the cool greys have better contrast.
   */
  stone: {
    50: "#F7F6F3",
    100: "#F1EFEA",
    200: "#E7E4DD",
    300: "#D8D4CB",
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
    // #FBBF24 was too pale to carry a white glyph, #D97706 too brown to read as
    // "medium". This sits between them — clearly amber, white icon still legible.
    500: "#F59E0B",
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
  // The PAGE is tinted and CARDS are white. With both white there is no figure
  // and no ground, so nothing reads as a card — it all looks like one sheet.
  //
  // Warm off-white rather than a cool grey: it reads as paper, and the white
  // cards sitting on it feel lifted rather than merely lighter. Do not push it
  // closer to white — the separation from the cards is the whole point.
  background: palette.stone[50],
  surface: palette.white,
  surfaceMuted: palette.stone[100],
  surfaceSunken: palette.stone[200],
  // The ONE place alpha is allowed, and only because a modal scrim must show
  // the screen behind it — an opaque one is a different screen, not a dialog.
  // Everything else in this file is a solid colour.
  overlay: "rgba(17, 24, 39, 0.55)",

  // text
  text: palette.gray[900],
  textSecondary: palette.gray[500],
  textMuted: palette.gray[400],
  textInverse: palette.white,
  textOnBrand: palette.white,

  // lines
  border: palette.stone[200],
  borderStrong: palette.stone[300],
  divider: palette.stone[100],

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
  priorityLow: palette.green[600],
  priorityMedium: palette.amber[500],
  priorityHigh: palette.red[500],
  priorityUrgent: palette.red[700],

  /** Fallback glyph colour for a task with no priority set. */
  neutralIcon: palette.purple[500],

  // Surfaces and text that sit ON the brand gradient (auth screens). Solid
  // shades picked off the brand ramp, NOT translucent white — washes look
  // washed out and change colour depending on what is behind them.
  surfaceOnBrand: palette.brand.light,
  textOnBrandMuted: "#C3CAEA",
  veilOnBrand: palette.brand.light,
  veilOnBrandDeep: "#4A5AB8",

  transparentBorder: "transparent",

  // Solid press/disabled fills. Dimming with opacity lets whatever is behind
  // bleed through and makes the control look faded rather than pressed.
  surfacePressed: palette.stone[100],
  primaryDim: "#8F99D4",
  dangerDim: "#EFA3A3",

  // gray[100]/gray[400] was too faint — a disabled button read as an empty box.
  disabledBg: palette.stone[200],
  disabledText: palette.gray[500],
} as const;

/** Brand gradient, dark -> light. The auth backdrop. */
export const gradients = {
  brand: [palette.brand.dark, palette.brand.base, palette.brand.light],
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
  sm: 6,
  base: 10,
  md: 14,
  lg: 20,
  xl: 24,
  "2xl": 28,
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
    shadowColor: "#1E34AE",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 14,
    elevation: 5,
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

/**
 * The height of every form control — Input, Select, DateField, Button. They
 * sit next to each other constantly, so one shared number is the only way they
 * line up. Never set a control height locally.
 */
export const CONTROL_HEIGHT = 50;

/**
 * The floating tab bar's height plus the gap beneath it. Scrollable content
 * must reserve this at the bottom — the bar is absolutely positioned, so it
 * covers whatever is under it instead of pushing it up.
 */
export const TAB_BAR_HEIGHT = 64;
export const TAB_BAR_CLEARANCE = TAB_BAR_HEIGHT + 28;

export type SpacingKey = keyof typeof spacing;
export type RadiusKey = keyof typeof radius;
export type ColorKey = keyof typeof colors;
