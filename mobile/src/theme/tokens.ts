// src/theme/tokens.ts
//
// The single source of every colour, size, space, radius and shadow in the app.
// Nothing else may define one. No component writes `fontSize: 14`, `#3F4FAF`,
// `padding: 12` — it reads a token. Change a value here and it changes
// everywhere, which is the entire point.
//
// Values are E · Midnight Sorbet (docs/superpowers/specs/2026-11-02-mobile-redesign,
// direction-e-blend.html, approved 2026-11-02). `tokens.test.ts` pins every hex
// to E, so a drift fails a test rather than a review.
//
// Phase 1 (Task 33) retuned the existing keys to E and added E's new ones. The
// old names that E retires stay below as ALIASES so un-migrated screens still
// build; Task 40 deletes them once nothing reads them. Each is marked
// "retired (Task 40)".

export const palette = {
  // ---- E ramps --------------------------------------------------------------
  navy: { 900: "#171D47", 800: "#20285A", 700: "#2C3570", muted: "#A9B0D6", soft: "#D3D7EE" },
  indigo: { 50: "#E6E8F6", 300: "#8592F0", 500: "#3F4FAF", 600: "#34429A" },
  /** The 160° auth gradient, top-left to bottom-right. Auth screens only. */
  auth: ["#4B5BC0", "#3F4FAF", "#27317A"],
  sheet: "#EEF0F8",
  line: "#ECEEF5",
  line2: "#D3D8E6",
  skeleton: "#DFE3EF",
  skeleton2: "#E8EBF4",
  ink: { 900: "#141936", 700: "#4A5072", 500: "#5F6687" },
  coral: "#D23F2A",
  danger: "#C42D1B",
  ok: "#1F7A3E",

  // ---- retired (Task 40): the pre-E ramps, still read by un-migrated screens ----
  brand: { base: "#3F4FAF", light: "#5A6BC0", dark: "#34429A" },
  accent: { base: "#F9629F", light: "#FF7AB7", dark: "#E5558C" },
  gray: {
    50: "#F9FAFB", 100: "#F3F4F6", 200: "#E5E7EB", 300: "#D1D5DB", 400: "#9CA3AF",
    500: "#6B7280", 600: "#4B5563", 700: "#374151", 800: "#1F2937", 900: "#111827",
  },
  red: { 50: "#FEF2F2", 100: "#FEE2E2", 300: "#FCA5A5", 500: "#EF4444", 600: "#DC2626", 700: "#B91C1C", 800: "#991B1B", 900: "#7F1D1D" },
  green: { 50: "#ECFDF5", 100: "#D1FAE5", 300: "#6EE7B7", 500: "#10B981", 600: "#059669", 700: "#047857", 800: "#065F46" },
  amber: { 50: "#FFFBEB", 100: "#FEF3C7", 500: "#F59E0B", 600: "#D97706", 700: "#B45309", 800: "#92400E" },
  blue: { 50: "#EFF6FF", 100: "#DBEAFE", 500: "#3B82F6", 600: "#2563EB", 700: "#1D4ED8", 800: "#1E40AF" },
  purple: { 100: "#EDE9FE", 400: "#A78BFA", 500: "#8B5CF6", 800: "#5B21B6" },
  teal: { 100: "#CCFBF1", 800: "#115E59" },
  shadow: "#111827",

  /**
   * Avatar preset hues, keyed by the name stored in tblUser.Avatar
   * ("color:violet") and mirrored from web/src/utils/avatarPresets.js. The
   * keys are data and never change. On mobile the initials now render in a
   * sorbet tone (`avatarPresetTone`), so these are read only by icon presets.
   */
  avatar: {
    violet: "#7C3AED", blue: "#2563EB", cyan: "#0891B2", green: "#059669",
    amber: "#D97706", red: "#DC2626", pink: "#DB2777", slate: "#475569",
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
  // ---- surfaces (the sheet is one step darker than a card: contrast, not shadow, makes a card)
  background: palette.sheet,
  surface: palette.white,
  surfaceMuted: "#F5F6FB",
  surfaceSunken: "#E2E5F1",
  // The ONE place alpha is allowed: a modal scrim must show the screen behind it.
  overlay: "rgba(9, 12, 34, 0.56)",

  // ---- text
  text: palette.ink[900],
  textSecondary: palette.ink[700],
  textMuted: palette.ink[500],
  textInverse: palette.white,
  textOnBrand: palette.white,

  // ---- lines
  border: palette.line2,
  borderStrong: "#A3AAC6",
  divider: palette.line,

  // ---- interactive
  primary: palette.indigo[500],
  primaryPressed: palette.indigo[600],
  primarySoft: palette.indigo[50],

  // ---- feedback
  success: palette.ok,
  successSoft: "#D3F2CB",
  warning: "#745400",
  warningSoft: "#FFF1C2",
  danger: palette.danger,
  dangerSoft: "#FFDCD7",
  info: "#1E4C96",
  infoSoft: "#DDEBFF",

  // ---- solid press / disabled fills (never opacity)
  surfacePressed: "#F1F2FA",
  disabledBg: "#D6DAE8",
  disabledText: palette.ink[500],

  // ---- the navy band (headers, bottom bar, rail)
  band: palette.navy[900],
  bandRaised: palette.navy[800],
  bandField: palette.navy[700],
  onBandMuted: palette.navy.muted,
  onBandSoft: palette.navy.soft,
  bandMark: palette.indigo[300],
  coral: palette.coral,

  // ---- on the indigo hero
  onBrandMuted: "#DDE1F7",
  onBrandWarn: "#FFD27A",
  onBrandOverrun: "#FFB3A6",
  onBrandDivider: "#5A68C2",

  // ---- toned text
  dangerText: "#A8200F",
  successText: "#1D6312",
  warningText: "#745400",

  // ---- tints
  fieldTint: "#F1F2FA",
  unreadTint: "#F4F5FC",
  followUpTint: "#FFF8DD",
  dangerCardTint: "#FFEDEA",
  dangerRowTint: "#FFF0ED",
  secondaryFill: "#E3E6F3",
  /** Pressed `secondary` button = the slate badge fill. */
  secondaryPressed: "#D9DEEE",
  track: "#DDE1EE",
  iconFaint: "#B9C0D6",
  grabber: "#C9CEDF",
  skeleton: palette.skeleton,
  skeletonSoft: palette.skeleton2,
  swipeHold: "#8A5A00",
  escalate: "#5B2D9E",
  greetIcon: "#FFE48C",
  shadowWhisper: "#DCE0EC",
  shadowPopover: "#D2D6E5",
  footerLine: "#E4E7F1",

  // ---- retired (Task 40) — aliases so un-migrated screens keep building
  accent: palette.indigo[500],
  accentPressed: palette.indigo[600],
  priorityLow: "#39436B",
  priorityMedium: "#745400",
  priorityHigh: palette.danger,
  priorityUrgent: "#A8200F",
  neutralIcon: palette.ink[700],
  surfaceOnBrand: palette.brand.light,
  frostOnBrand: "#7580C5",
  textOnBrandMuted: "#DDE1F7",
  veilOnBrand: palette.brand.light,
  veilOnBrandDeep: "#4A5AB8",
  primaryDim: "#D6DAE8",
  dangerDim: "#D6DAE8",
  transparentBorder: palette.transparent,
} as const;

/** A sorbet pair: soft solid fill, dark ink of the same hue. Every pair ≥ 4.5 : 1. */
export interface ChipTonePair { fill: string; text: string }

const CHIP = {
  sky: { fill: "#DDEBFF", text: "#1E4C96" },
  butter: { fill: "#FFF1C2", text: "#745400" },
  green: { fill: "#D3F2CB", text: "#1D6312" },
  red: { fill: "#FFDCD7", text: "#A8200F" },
  lilac: { fill: "#ECE3FC", text: "#5B2D9E" },
  teal: { fill: "#D2F1F0", text: "#0D5C5A" },
  slate: { fill: "#E4E8F4", text: "#39436B" },
  peach: { fill: "#FFE3D9", text: "#A3321B" },
  mint: { fill: "#D6F3E6", text: "#146345" },
  indigo: { fill: "#E6E8F6", text: "#3F4FAF" },
  brand: { fill: "#3F4FAF", text: "#FFFFFF" },
} as const satisfies Record<string, ChipTonePair>;

/**
 * Chip tones, keyed by hue (E §1.4). The old semantic names stay as aliases
 * until Task 40. Screens pick a tone name, never a colour.
 */
export const chipTones = {
  ...CHIP,
  // retired (Task 40)
  info: CHIP.sky,
  warning: CHIP.butter,
  success: CHIP.green,
  danger: CHIP.red,
  urgent: CHIP.red,
  purple: CHIP.lilac,
  neutral: CHIP.slate,
  primary: CHIP.indigo,
} as const;

export type ChipTone = keyof typeof chipTones;

/** Status badge tones: solid rounded squares, icon in the ink (E §1.5). */
export const badgeTones = {
  sky: { fill: "#CFE0FF", ink: "#1E4C96" },
  butter: { fill: "#FFE48C", ink: "#574000" },
  green: { fill: "#C2EBB8", ink: "#1D6312" },
  red: { fill: "#FFCFC8", ink: "#8F1B0D" },
  lilac: { fill: "#D9C8FA", ink: "#3B1C6B" },
  teal: { fill: "#BDEBE8", ink: "#0D5C5A" },
  slate: { fill: "#D9DEEE", ink: "#2E3760" },
  peach: { fill: "#FFCCB8", ink: "#6E1F0E" },
  mint: { fill: "#BCEBD5", ink: "#0D4A33" },
  indigo: { fill: "#D5D9F5", ink: "#2E3A8C" },
} as const;

export type BadgeTone = keyof typeof badgeTones;

/** Module identity (E §1.3): the bar pill, tile, Create row and empty art read these. */
export const moduleTones = {
  home: { badge: "indigo", chip: "indigo" },
  inbox: { badge: "indigo", chip: "indigo" },
  tasks: { badge: "lilac", chip: "lilac" },
  complaints: { badge: "peach", chip: "peach" },
  leads: { badge: "mint", chip: "mint" },
  followups: { badge: "butter", chip: "butter" },
  more: { badge: "slate", chip: null },
} as const satisfies Record<string, { badge: BadgeTone; chip: ChipTone | null }>;

export type UiModule = keyof typeof moduleTones;

/** Brand gradient. The auth backdrop only (guarded: `expo-linear-gradient` outside features/auth fails). */
export const gradients = {
  auth: palette.auth,
  /** 160° in expo-linear-gradient terms. */
  authStart: { x: 0.33, y: 0 },
  authEnd: { x: 0.67, y: 1 },
  /** retired (Task 40) */
  brand: palette.auth,
} as const;

/** 4px grid. `spacing[3]` is 12px. Never write a raw padding number. */
export const spacing = {
  0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 7: 28, 8: 32, 10: 40, 12: 48, 16: 64, 20: 80,
} as const;

/**
 * E's exact off-grid measurements (§1.8). A component reads these instead of
 * writing a raw number, so a retune is one line.
 */
export const metrics = Object.freeze({
  gutter: 16,
  /** Band/sheet padding at medium (proposed) and expanded (T1–T3). */
  gutterMedium: 24,
  gutterExpanded: 32,
  bandRow: 52,
  bandRowHome: 56,
  bandRowTablet: 60,
  bandPadBottom: Object.freeze({ tabs: 16, home: 28, record: 30, profile: 36 }),
  sheetOverlap: 16,
  sheetOverlapTablet: 20,
  sheetPadTop: 16,
  rowPadV: 11,
  rowPadH: 14,
  rowGap: 12,
  rowLineGap: 3,
  inlineGap: 6,
  sepInset: Object.freeze({ badge: 66, check: 48, none: 14 }),
  controlHeight: 44,
  buttonHeight: Object.freeze({ md: 48, sm: 36, xs: 32 }),
  headerButtonHeight: 36,
  headerButtonSmall: 28,
  iconButton: 40,
  iconButtonGhost: 36,
  searchHeight: 40,
  pillHeight: 32,
  pillHeightSheet: 34,
  segmentHeight: 34,
  segmentHeightTall: 36,
  bandTabHeight: 44,
  bottomBarContent: 58,
  navPill: Object.freeze({ width: 48, height: 30 }),
  navMain: Object.freeze({ width: 56, height: 30 }),
  navIndicator: Object.freeze({ length: 32, thickness: 3 }),
  railWidth: 92,
  railItem: 62,
  railLogo: 44,
  railNew: 52,
  listPaneWidth: 420,
  formMaxWidth: 640,
  factsColumn: 300,
  boardColumnInset: 80,
  /** A board column never grows past this, so a tablet shows several (E draws only the phone). */
  boardColumnMax: 360,
  fieldGap: 12,
  pairGap: 10,
  bentoGap: 10,
  bentoGapTablet: 16,
  tileHeight: 112,
  tileHeightTablet: 128,
  swipeAction: 72,
  swipeActionWide: 88,
  emptyArt: 132,
  stepperValue: 64,
  progress: Object.freeze({ md: 6, lg: 8, rowWidth: 40 }),
  checkbox: 22,
  radio: 22,
  radioOn: 7,
  grabber: Object.freeze({ width: 40, height: 5 }),
  dot: 8,
  pageDot: Object.freeze({ active: 18, idle: 6 }),
  countBadge: Object.freeze({ minWidth: 20, height: 18, border: 2 }),
  countPill: Object.freeze({ minWidth: 20, height: 18 }),
  escalatedDot: 20,
  // Off-grid values E uses inside components (Task 37b).
  /** The small title/shift nudge (E `margin-top:2px`). */
  nudge: 2,
  /** Card/figure gap inside a card (E 10). */
  stackGap: 10,
  /** Inline icon on a row's third line (E `.i14`). */
  iconSm: 14,
  /** Card padding (E `padding:14px`). */
  cardPad: 14,
  /** Space above a sheet's action button (E 14). */
  sheetActionGap: 14,
  /** The load-failed card sits 72 down the sheet (E 20c). */
  errorTop: 72,
  /** Tablet two-pane gutters (E T2/T3): list band 20 / sheet 16, detail band 28 / sheet 24. */
  pane: Object.freeze({ listBand: 20, listSheet: 16, detailBand: 28, detailSheet: 24 }),
});

/** Radius by E's use (§1.9). The pre-E names stay as aliases until Task 40. */
export const radius = {
  mark: 3,
  check: 7,
  badgeXs: 9,
  badgeSm: 10,
  chip: 11,
  badge: 12,
  badgeLg: 14,
  bar: 15,
  card: 16,
  segment: 17,
  column: 18,
  sheet: 20,
  modal: 24,
  errorBadge: 22,
  emptyArt: 40,
  avatarLg: 44,
  full: 9999,
  // retired (Task 40)
  none: 0,
  sm: 6,
  base: 10,
  md: 14,
  lg: 20,
  xl: 24,
  "2xl": 28,
} as const;

type Shadow = { boxShadow?: string };

/**
 * E draws every shadow as a SOLID colour (no opacity), via RN 0.86's CSS
 * `boxShadow`, which renders on both platforms under the new architecture.
 * Must be verified on the Android AVD; the fallback is `shadowColor` = the
 * token + `shadowOpacity: 1` + `elevation: 1` (spec §1.10).
 */
export const elevation = {
  whisper: { boxShadow: `0 1px 2px ${colors.shadowWhisper}` },
  popover: { boxShadow: `0 4px 12px ${colors.shadowPopover}` },
  footer: { boxShadow: `0 -1px 0 ${colors.footerLine}` },
  none: {},
} as const satisfies Record<string, Shadow>;

/**
 * retired (Task 40). `md` is the card shadow and is now E's whisper; the rest
 * keep their old values for the screens that still read them.
 */
export const shadows = {
  none: {},
  sm: { shadowColor: palette.shadow, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  base: { shadowColor: palette.shadow, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  md: elevation.whisper,
  lg: { shadowColor: palette.shadow, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.16, shadowRadius: 16, elevation: 8 },
  floating: { shadowColor: palette.shadow, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.22, shadowRadius: 18, elevation: 10 },
} as const;

/**
 * `maxFontSizeMultiplier` caps (proposed; E does not specify). `Text` takes its
 * cap from the variant's group; chrome (bar labels, chips, counts) caps lower
 * because it cannot reflow.
 */
export const fontScaleCap = { body: 1.3, chrome: 1.15, figure: 1.2 } as const;
export type FontScaleGroup = keyof typeof fontScaleCap;

/** The gutter between screen content and the display edge (phone). */
export const SCREEN_PADDING = metrics.gutter;

/** Minimum touch target. Smaller tappables get `hitSlop` to reach it. */
export const HIT_TARGET = 44;

/** The height of every form field (E `.in`). Buttons are 48 (`metrics.buttonHeight`). */
export const CONTROL_HEIGHT = metrics.controlHeight;

/**
 * retired (Task 40). The bar is docked now (Shell owns it), so content no
 * longer reserves room under a floating one.
 */
export const TAB_BAR_HEIGHT = 70;
export const TAB_BAR_CLEARANCE = 0;

export type SpacingKey = keyof typeof spacing;
export type RadiusKey = keyof typeof radius;
export type ColorKey = keyof typeof colors;
