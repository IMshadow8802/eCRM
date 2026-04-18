import { createTheme } from "@mui/material/styles";
import {
  palettes,
  radii,
  typography as typoTokens,
  fontFamilies,
  fontWeights,
  motion as motionTokens,
} from "./styles/tokens";

/**
 * MUI theme built from the design tokens in src/styles/tokens.js.
 *
 * Every palette color, radius, typography step, and component override
 * comes from the token file. Never hardcode colors or sizes here —
 * change `tokens.js` and the whole app updates.
 */
export function buildTheme(mode = "light") {
  const p = palettes[mode] ?? palettes.light;
  const isDark = mode === "dark";

  const typeOf = (key) => ({
    fontSize: `${typoTokens[key].size / 15}rem`,
    lineHeight: `${typoTokens[key].line / typoTokens[key].size}`,
    fontWeight: typoTokens[key].weight,
    letterSpacing: typoTokens[key].tracking,
    ...(typoTokens[key].transform ? { textTransform: typoTokens[key].transform } : {}),
    ...(typoTokens[key].family === "mono"
      ? { fontFamily: fontFamilies.mono }
      : {}),
  });

  return createTheme({
    palette: {
      mode,
      primary: {
        main: p.primary.main,
        light: p.primary.hover,
        dark: p.primary.hover,
        contrastText: p.primary.contrastText,
      },
      secondary: {
        main: p.accent.main,
        light: p.accent.hover,
        dark: p.accent.hover,
        contrastText: p.accent.contrastText,
      },
      success: { main: p.success.main, contrastText: p.success.contrastText },
      warning: { main: p.warning.main, contrastText: p.warning.contrastText },
      error: { main: p.error.main, contrastText: p.error.contrastText },
      info: { main: p.info.main, contrastText: p.info.contrastText },
      background: {
        default: p.surface.page,
        paper: p.surface.card,
        sidebar: p.surface.sidebar,
      },
      text: {
        primary: p.text.primary,
        secondary: p.text.secondary,
        disabled: p.text.disabled,
      },
      divider: p.border.default,
      action: {
        hover: isDark ? "rgba(255,255,255,0.04)" : "rgba(15,23,42,0.04)",
        selected: isDark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.06)",
        disabled: p.text.disabled,
      },
    },
    shape: { borderRadius: radii.md },
    // Accessible via theme.radii + theme.tokens.
    radii,
    tokens: { ...p, radii, motion: motionTokens, fontFamilies },
    typography: {
      fontFamily: fontFamilies.sans,
      fontSize: typoTokens.body.size,
      htmlFontSize: 15,
      fontWeightLight: fontWeights.regular,
      fontWeightRegular: fontWeights.medium,
      fontWeightMedium: fontWeights.semibold,
      fontWeightBold: fontWeights.bold,
      display: typeOf("display"),
      h1: typeOf("h1"),
      h2: typeOf("h2"),
      h3: typeOf("h3"),
      h4: typeOf("h4"),
      h5: typeOf("h4"),
      h6: typeOf("h4"),
      subtitle1: typeOf("bodyLg"),
      subtitle2: typeOf("body"),
      body1: typeOf("body"),
      body2: typeOf("bodySm"),
      button: typeOf("button"),
      caption: typeOf("caption"),
      overline: typeOf("overline"),
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            fontFamily: fontFamilies.sans,
            fontWeight: fontWeights.medium,
            color: p.text.primary,
            backgroundColor: p.surface.page,
          },
          "code, pre, .mono": { fontFamily: fontFamilies.mono },
          "*:focus-visible": {
            outline: `2px solid ${p.border.focus}`,
            outlineOffset: 2,
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            textTransform: "none",
            fontWeight: fontWeights.semibold,
            borderRadius: radii.md,
            paddingInline: 16,
            minHeight: 36,
            transition: `background-color ${motionTokens.duration.slow}ms ${motionTokens.easing.standard}, transform ${motionTokens.duration.base}ms ${motionTokens.easing.standard}, box-shadow ${motionTokens.duration.slow}ms ${motionTokens.easing.standard}`,
          },
          sizeSmall: { minHeight: 30, paddingInline: 12, fontSize: typoTokens.bodySm.size / 15 + "rem" },
          sizeLarge: { minHeight: 44, paddingInline: 20 },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            borderRadius: radii.md,
            transition: `background-color ${motionTokens.duration.slow}ms ${motionTokens.easing.standard}`,
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: "none",
            backgroundColor: p.surface.card,
            borderRadius: radii.lg,
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: radii.lg,
            backgroundColor: p.surface.card,
            boxShadow: p.shadow.xl,
            border: `1px solid ${p.border.default}`,
          },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            borderRadius: radii.md,
            border: `1px solid ${p.border.default}`,
            boxShadow: p.shadow.lg,
            marginTop: 6,
          },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            fontSize: typoTokens.body.size / 15 + "rem",
            fontWeight: fontWeights.medium,
            borderRadius: radii.sm,
            marginInline: 4,
            marginBlock: 1,
          },
        },
      },
      MuiPopover: {
        styleOverrides: {
          paper: {
            borderRadius: radii.md,
            border: `1px solid ${p.border.default}`,
            boxShadow: p.shadow.lg,
          },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            fontSize: typoTokens.caption.size / 15 + "rem",
            fontWeight: fontWeights.medium,
            padding: "6px 10px",
            borderRadius: radii.sm,
            backgroundColor: isDark ? p.surface.elevated : p.surface.inverse,
            color: isDark ? p.text.primary : p.text.onAccent,
          },
          arrow: {
            color: isDark ? p.surface.elevated : p.surface.inverse,
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: radii.md,
            transition: `box-shadow ${motionTokens.duration.base}ms ${motionTokens.easing.standard}`,
            "& fieldset": { borderColor: p.border.default },
            "&:hover fieldset": { borderColor: p.border.strong },
            "&.Mui-focused fieldset": {
              borderColor: p.border.focus,
              borderWidth: 1.5,
            },
          },
          input: { fontWeight: fontWeights.medium },
        },
      },
      MuiInputBase: {
        styleOverrides: {
          input: { fontWeight: fontWeights.medium },
        },
      },
      MuiInputLabel: {
        styleOverrides: {
          root: { fontWeight: fontWeights.medium },
        },
      },
      MuiAutocomplete: {
        styleOverrides: {
          paper: {
            borderRadius: radii.md,
            border: `1px solid ${p.border.default}`,
            boxShadow: p.shadow.lg,
          },
          option: {
            borderRadius: radii.sm,
            marginInline: 4,
          },
        },
      },
      MuiSelect: {
        styleOverrides: {
          root: { borderRadius: radii.md },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: radii.full,
            fontWeight: fontWeights.semibold,
            fontSize: typoTokens.caption.size / 15 + "rem",
            height: 24,
          },
          sizeSmall: { height: 20, fontSize: 11 / 15 + "rem" },
        },
      },
      MuiCheckbox: {
        styleOverrides: {
          root: {
            borderRadius: radii.sm,
            padding: 6,
            color: p.border.strong,
            "&.Mui-checked": { color: p.primary.main },
          },
        },
      },
      MuiSwitch: {
        styleOverrides: {
          switchBase: {
            "&.Mui-checked": { color: "#FFFFFF" },
            "&.Mui-checked + .MuiSwitch-track": {
              backgroundColor: p.primary.main,
              opacity: 1,
            },
          },
          track: {
            borderRadius: radii.full,
            backgroundColor: isDark ? "#475569" : "#CBD5E1",
            opacity: 1,
          },
          thumb: { boxShadow: p.shadow.sm },
        },
      },
      MuiTabs: {
        styleOverrides: {
          indicator: {
            height: 3,
            borderRadius: radii.full,
            backgroundColor: p.primary.main,
          },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            textTransform: "none",
            fontWeight: fontWeights.semibold,
            fontSize: typoTokens.body.size / 15 + "rem",
            minHeight: 40,
          },
        },
      },
      MuiBadge: {
        styleOverrides: {
          badge: {
            fontWeight: fontWeights.semibold,
            fontSize: 11 / 15 + "rem",
            borderRadius: radii.full,
          },
        },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: { borderRadius: radii.full, height: 6 },
          bar: { borderRadius: radii.full },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: {
            fontSize: typoTokens.body.size / 15 + "rem",
            fontWeight: fontWeights.medium,
            padding: "10px 14px",
            borderColor: p.border.subtle,
          },
          head: {
            fontWeight: fontWeights.semibold,
            fontSize: typoTokens.caption.size / 15 + "rem",
            color: p.text.secondary,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            backgroundColor: p.surface.subtle,
          },
        },
      },
    },
  });
}

const customTheme = buildTheme("light");
export default customTheme;
