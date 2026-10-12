// src/styles/tokens.js
//
// Single source of truth for the design system. Every primitive reads
// from here. Never hardcode a color, radius, spacing, or duration in a
// component — import the token.

// ---------- Colors (per-mode palettes) ----------
// 50–900 scales so we have hover / subtle / border shades per semantic.

const indigo = {
  50: "#EEF2FF",
  100: "#E0E7FF",
  200: "#C7D2FE",
  300: "#A5B4FC",
  400: "#818CF8",
  500: "#6366F1",
  600: "#4F46E5",
  700: "#4338CA",
  800: "#3730A3",
  900: "#312E81",
};

const pink = {
  50: "#FDF2F8",
  100: "#FCE7F3",
  200: "#FBCFE8",
  300: "#F9A8D4",
  400: "#F472B6",
  500: "#EC4899",
  600: "#DB2777",
  700: "#BE185D",
  800: "#9D174D",
  900: "#831843",
};

const emerald = {
  50: "#ECFDF5",
  100: "#D1FAE5",
  200: "#A7F3D0",
  400: "#34D399",
  500: "#10B981",
  600: "#059669",
  700: "#047857",
  900: "#064E3B",
};

const amber = {
  50: "#FFFBEB",
  100: "#FEF3C7",
  200: "#FDE68A",
  400: "#FBBF24",
  500: "#F59E0B",
  600: "#D97706",
  700: "#B45309",
  900: "#78350F",
};

const red = {
  50: "#FEF2F2",
  100: "#FEE2E2",
  200: "#FECACA",
  400: "#F87171",
  500: "#EF4444",
  600: "#DC2626",
  700: "#B91C1C",
  900: "#7F1D1D",
};

const sky = {
  50: "#F0F9FF",
  100: "#E0F2FE",
  200: "#BAE6FD",
  400: "#38BDF8",
  500: "#0EA5E9",
  600: "#0284C7",
  700: "#0369A1",
  900: "#0C4A6E",
};

const violet = {
  50: "#F5F3FF",
  200: "#DDD6FE",
  400: "#A78BFA",
  500: "#8B5CF6",
  600: "#7C3AED",
  700: "#6D28D9",
};

const slate = {
  50: "#F8FAFC",
  100: "#F1F5F9",
  200: "#E2E8F0",
  300: "#CBD5E1",
  400: "#94A3B8",
  500: "#64748B",
  600: "#475569",
  700: "#334155",
  800: "#1E293B",
  900: "#0F172A",
  950: "#020617",
};

export const palettes = {
  light: {
    mode: "light",
    primary: {
      main: indigo[600],
      hover: indigo[700],
      subtle: indigo[50],
      border: indigo[200],
      contrastText: "#FFFFFF",
    },
    accent: {
      main: pink[500],
      hover: pink[600],
      subtle: pink[50],
      border: pink[200],
      contrastText: "#FFFFFF",
    },
    success: {
      main: emerald[500],
      hover: emerald[600],
      subtle: emerald[50],
      border: emerald[200],
      contrastText: "#FFFFFF",
    },
    warning: {
      main: amber[500],
      hover: amber[600],
      subtle: amber[50],
      border: amber[200],
      contrastText: slate[900],
      // Amber as TEXT on a card: amber[500/600] fail WCAG AA (~2-3:1); 700 is ~5:1.
      text: amber[700],
    },
    error: {
      main: red[500],
      hover: red[600],
      subtle: red[50],
      border: red[200],
      contrastText: "#FFFFFF",
    },
    info: {
      main: sky[500],
      hover: sky[600],
      subtle: sky[50],
      border: sky[200],
      contrastText: "#FFFFFF",
    },
    // A sixth hue for icon badges and pills (Open tasks), so a row of them
    // does not repeat indigo. Not a brand colour; never a button.
    violet: {
      main: violet[600],
      hover: violet[700],
      subtle: violet[50],
      border: violet[200],
      contrastText: "#FFFFFF",
    },
    surface: {
      // One step darker than a card: depth comes from contrast first, the
      // elevation shadow sits on top. slate[50] next to white read as flat.
      page: "#EEF2F7",
      card: "#FFFFFF",
      elevated: "#FFFFFF",
      subtle: slate[100],
      hover: slate[100],
      selected: slate[200],
      track: slate[200],
      sidebar: "#FFFFFF",
      inverse: slate[900],
    },
    text: {
      primary: slate[900],
      secondary: slate[600],
      tertiary: slate[400],
      disabled: slate[300],
      onAccent: "#FFFFFF",
    },
    border: {
      default: slate[200],
      subtle: slate[100],
      strong: slate[300],
      focus: indigo[500],
    },
    overlay: "rgba(15, 23, 42, 0.48)",
    shadow: {
      xs: "0 1px 2px rgba(15,23,42,0.06)",
      sm: "0 2px 4px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)",
      md: "0 4px 12px rgba(15,23,42,0.08), 0 2px 4px rgba(15,23,42,0.04)",
      lg: "0 12px 24px rgba(15,23,42,0.10), 0 4px 8px rgba(15,23,42,0.06)",
      xl: "0 24px 48px rgba(15,23,42,0.12), 0 8px 16px rgba(15,23,42,0.08)",
      glow: `0 0 0 3px ${indigo[100]}`,
    },
    // Raised surfaces: a tight contact shadow + a soft ambient one. 1 = resting
    // card, 2 = hovered / lifted, 3 = floating (sticky bars, popovers).
    elevation: {
      1: "0 1px 2px rgba(15,23,42,0.06), 0 2px 8px -2px rgba(15,23,42,0.08)",
      2: "0 1px 3px rgba(15,23,42,0.08), 0 8px 20px -6px rgba(15,23,42,0.16)",
      3: "0 2px 4px rgba(15,23,42,0.06), 0 16px 36px -10px rgba(15,23,42,0.22)",
    },
    // Solid colours only — no gradients, no translucent fills (web and
    // mobile alike). The overlay scrim and shadows are the only alpha.
    brand: {
      cta: indigo[600],
      ctaHover: indigo[700],
      loginPanel: indigo[900],
    },
  },
  dark: {
    mode: "dark",
    primary: {
      main: indigo[500],
      hover: indigo[400],
      subtle: "#1F2549",
      border: "#3B4377",
      contrastText: "#FFFFFF",
    },
    accent: {
      main: pink[500],
      hover: pink[400],
      subtle: "#32203D",
      border: "#653A5F",
      contrastText: "#FFFFFF",
    },
    success: {
      main: emerald[500],
      hover: emerald[400],
      subtle: "#13303A",
      border: "#205D55",
      contrastText: "#FFFFFF",
    },
    warning: {
      main: amber[500],
      hover: amber[400],
      subtle: "#342C29",
      border: "#67552A",
      contrastText: slate[900],
      text: amber[400],
    },
    error: {
      main: red[500],
      hover: red[400],
      subtle: "#332031",
      border: "#663946",
      contrastText: "#FFFFFF",
    },
    info: {
      main: sky[500],
      hover: sky[400],
      subtle: "#132D48",
      border: "#215577",
      contrastText: "#FFFFFF",
    },
    violet: {
      main: violet[500],
      hover: violet[400],
      subtle: "#25234A",
      border: "#494377",
      contrastText: "#FFFFFF",
    },
    surface: {
      page: "#0B1020",
      card: "#141A2E",
      elevated: "#1E2642",
      subtle: "#1B2134",
      hover: "#1D2336",
      selected: "#272C3F",
      track: "#232A3F",
      sidebar: "#0E1428",
      inverse: slate[50],
    },
    text: {
      primary: slate[100],
      secondary: slate[400],
      tertiary: slate[500],
      disabled: slate[600],
      onAccent: slate[900],
    },
    border: {
      default: "#232A3F",
      subtle: "#1C2236",
      strong: "#333B4F",
      focus: indigo[400],
    },
    overlay: "rgba(2, 6, 23, 0.72)",
    shadow: {
      xs: "0 1px 2px rgba(0,0,0,0.4)",
      sm: "0 2px 4px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.3)",
      md: "0 4px 12px rgba(0,0,0,0.5), 0 2px 4px rgba(0,0,0,0.3)",
      lg: "0 12px 24px rgba(0,0,0,0.6), 0 4px 8px rgba(0,0,0,0.4)",
      xl: "0 24px 48px rgba(0,0,0,0.7), 0 8px 16px rgba(0,0,0,0.5)",
      glow: `0 0 0 3px rgba(129,140,248,0.24)`,
    },
    // Dark: the shadow barely shows against a dark page, so a hairline top
    // highlight does the lifting and the shadows stay soft.
    elevation: {
      1: "inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 2px rgba(0,0,0,0.35), 0 4px 12px -4px rgba(0,0,0,0.35)",
      2: "inset 0 1px 0 rgba(255,255,255,0.06), 0 2px 4px rgba(0,0,0,0.4), 0 10px 24px -8px rgba(0,0,0,0.5)",
      3: "inset 0 1px 0 rgba(255,255,255,0.07), 0 4px 8px rgba(0,0,0,0.4), 0 20px 40px -12px rgba(0,0,0,0.6)",
    },
    // Solid colours only — no gradients, no translucent fills (web and
    // mobile alike). The overlay scrim and shadows are the only alpha.
    brand: {
      cta: indigo[500],
      ctaHover: indigo[400],
      loginPanel: slate[950],
    },
  },
};

// ---------- Radii ----------
export const radii = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
  full: 9999,
};

// ---------- Control heights ----------
// One scale for every input (TextInput, Combobox, DateField, and the wrappers
// over them). md is 36 to sit flush with a medium Button (2026-10-11: was 40,
// which left every form a step taller than its buttons). sm 32 = small Button.
export const controlHeight = { sm: 32, md: 36, lg: 48 };

// ---------- App chrome ----------
// Row 1 of the top bar and the sidebar's brand header share this height, so
// the sidebar's divider and the bar's hairline sit on exactly the same line.
// Row 2 is the page row (breadcrumb, title, actions).
export const chrome = { row1: 48, row2: 44 };

// ---------- Spacing (4px grid) ----------
export const spacing = {
  "0": 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
  "3xl": 48,
  "4xl": 64,
};

// ---------- Typography ----------
export const fontFamilies = {
  sans: "'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
};

export const fontWeights = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
};

// [fontSize px, lineHeight px, weight, letterSpacing em]
export const typography = {
  display: { size: 32, line: 40, weight: 700, tracking: "-0.02em" },
  h1: { size: 24, line: 32, weight: 700, tracking: "-0.02em" },
  h2: { size: 20, line: 28, weight: 700, tracking: "-0.01em" },
  h3: { size: 18, line: 26, weight: 600, tracking: "-0.005em" },
  h4: { size: 16, line: 24, weight: 600, tracking: "0em" },
  bodyLg: { size: 15, line: 22, weight: 500, tracking: "0em" },
  body: { size: 14, line: 20, weight: 500, tracking: "0em" },
  bodySm: { size: 13, line: 18, weight: 500, tracking: "0em" },
  caption: { size: 12, line: 16, weight: 500, tracking: "0.02em" },
  overline: { size: 11, line: 14, weight: 600, tracking: "0.08em", transform: "uppercase" },
  mono: { size: 13, line: 18, weight: 500, tracking: "0em", family: "mono" },
  button: { size: 14, line: 20, weight: 600, tracking: "0em" },
  label: { size: 13, line: 18, weight: 500, tracking: "0em" },
};

// ---------- Motion (mellow Notion-style) ----------
export const motion = {
  duration: {
    instant: 80,
    fast: 160,
    base: 240,
    slow: 320,
    lazy: 480,
    lazier: 640,
  },
  easing: {
    standard: "cubic-bezier(0.4, 0, 0.2, 1)",
    emphasized: "cubic-bezier(0.2, 0, 0, 1)",
    decelerate: "cubic-bezier(0, 0, 0.2, 1)",
    accelerate: "cubic-bezier(0.4, 0, 1, 1)",
  },
};

// ---------- Z-index scale ----------
export const zIndex = {
  base: 0,
  dropdown: 1000,
  sticky: 1100,
  overlay: 1300,
  modal: 1400,
  popover: 1500,
  tooltip: 1600,
  toast: 1700,
};
