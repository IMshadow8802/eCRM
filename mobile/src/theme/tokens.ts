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
  /**
   * Emerald, not the old grass green (#16A34A).
   *
   * That one leans yellow, which put it a short hop from the amber beside it —
   * two hues doing different jobs that read as neighbours instead of
   * opposites. Emerald sits further round toward teal, so "done" and "medium
   * priority" are unmistakable side by side, and it holds white text better:
   * ~3.6:1 at the 600 level against ~2.5 for a brighter green.
   */
  green: {
    50: "#ECFDF5",
    100: "#D1FAE5",
    300: "#6EE7B7",
    500: "#10B981",
    600: "#059669",
    700: "#047857",
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
  /**
   * Shadow ink.
   *
   * Neutral, now that the page is white — a warm shadow on white goes brown
   * rather than grey. Pure black is still wrong: at these opacities it reads
   * as a smudge, where a near-black grey reads as depth.
   */
  shadow: "#111827",
  transparent: "transparent",
} as const;

/**
 * Semantic colours. Components use THESE, not `palette.*` — so "the danger
 * colour" can be retuned in one line without hunting for every red.
 */
export const colors = {
  // surfaces
  //
  // The page is WHITE, and so are the cards. That used to be the thing to
  // avoid — with no tint behind them nothing reads as a card — so the page was
  // a warm off-white and the separation came for free.
  //
  // It now comes from the cards instead: a hairline border, a contact shadow,
  // and a colour-tinted footer strip on each one. That is a better trade. The
  // tint was doing its job on a list of cards and nothing else; every plain
  // screen in the app paid for it by looking faintly yellow.
  //
  // Neutrals are cool greys again to match. A warm border on a warm page reads
  // as paper; the same border on white reads as dirty.
  background: palette.white,
  surface: palette.white,
  surfaceMuted: palette.gray[50],
  surfaceSunken: palette.gray[100],
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
  /**
   * Reads as frosted glass over the brand colour, but is a SOLID hex — it is
   * exactly white-at-28%-over-brand, precomputed. On an opaque background a
   * blur has nothing to sample but that background, so real translucency would
   * look identical while costing a native module and breaking the
   * no-transparency rule.
   */
  frostOnBrand: "#7580C5",
  textOnBrandMuted: "#C3CAEA",
  veilOnBrand: palette.brand.light,
  veilOnBrandDeep: "#4A5AB8",

  transparentBorder: "transparent",

  // Solid press/disabled fills. Dimming with opacity lets whatever is behind
  // bleed through and makes the control look faded rather than pressed.
  surfacePressed: palette.gray[100],
  primaryDim: "#8F99D4",
  dangerDim: "#EFA3A3",

  // gray[100]/gray[400] was too faint — a disabled button read as an empty box.
  disabledBg: palette.gray[200],
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
    shadowColor: palette.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  base: {
    shadowColor: palette.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  /**
   * The card shadow — a CONTACT shadow, not an ambient one.
   *
   * Cards in a board column sit 16px apart. Any shadow whose radius approaches
   * that reaches its neighbour, and the overlap makes every gap darker than the
   * open margin beside the column: the cards stop reading as separate objects
   * and turn into one grey lane running down the page. Warming the ink helped
   * but did not fix it, because the problem is reach, not colour.
   *
   * It is the ONLY thing separating a white card from a white page — there is
   * no border any more — so it has to actually read as height rather than as a
   * smudge. Two properties do that work:
   *
   *   offset 4  — a shadow directly under an object reads as contact; one cast
   *               below it reads as the object standing above the surface.
   *   radius 10 — soft enough to be light falling off an edge rather than a
   *               drawn outline.
   *
   * Bounded by the 16px gap between stacked cards. The version that welded a
   * board column into one grey lane was radius 14 at offset 6 across a 12px
   * gap; this reaches meaningfully less far across meaningfully more space.
   */
  md: {
    shadowColor: palette.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 5,
  },
  lg: {
    shadowColor: palette.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
    elevation: 8,
  },
  /**
   * For elements that float free of any edge. Barely offset, so the shadow
   * spreads evenly instead of pooling underneath — an offset shadow makes a
   * centred element look like it is sitting too low.
   */
  floating: {
    shadowColor: palette.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.22,
    shadowRadius: 18,
    elevation: 10,
  },
} as const;

/**
 * The gutter between screen content and the display edge.
 *
 * One number, because every screen has to agree: a list whose cards sit 20px
 * in and a header whose title sits 16px in look broken even though neither
 * value is wrong on its own. Screens read THIS, never `spacing[n]`, for their
 * outer padding — a component's own internal padding is a different decision
 * and stays on the spacing scale.
 *
 * It also matches the board strip's padding, so a board and a list line up
 * when you move between them.
 */
export const SCREEN_PADDING = 16;

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
export const TAB_BAR_HEIGHT = 70;
export const TAB_BAR_CLEARANCE = TAB_BAR_HEIGHT + 28;

export type SpacingKey = keyof typeof spacing;
export type RadiusKey = keyof typeof radius;
export type ColorKey = keyof typeof colors;
