import { useTheme } from "@mui/material/styles";
import { X } from "lucide-react";

/**
 * Chip — pill-shaped label. Variants:
 *   solid, tonal (default), outlined, ghost
 * Tones: default, primary, accent, success, warning, error, info
 */
const TONES = ["default", "primary", "accent", "success", "warning", "error", "info"];

function resolveTone(tone, tokens) {
  const p = tokens;
  if (tone === "default") {
    return {
      main: p.text.secondary,
      subtle: p.surface.subtle,
      border: p.border.default,
      contrast: p.text.primary,
    };
  }
  const key =
    tone === "accent"
      ? "accent"
      : tone === "primary"
        ? "primary"
        : tone;
  return {
    main: p[key]?.main ?? p.primary.main,
    subtle: p[key]?.subtle ?? p.primary.subtle,
    border: p[key]?.border ?? p.primary.border,
    contrast: p[key]?.contrastText ?? "#FFFFFF",
  };
}

export default function Chip({
  label,
  icon,
  onDelete,
  onClick,
  variant = "tonal",
  tone = "default",
  size = "md",
  "data-testid": testId,
  ...rest
}) {
  const theme = useTheme();
  const p = theme.tokens;
  const t = resolveTone(TONES.includes(tone) ? tone : "default", p);

  const SIZE = {
    sm: { h: 20, fz: 11, px: 8, gap: 4, icon: 12 },
    md: { h: 24, fz: 12, px: 10, gap: 6, icon: 14 },
    lg: { h: 32, fz: 13, px: 12, gap: 6, icon: 16 },
  };
  const s = SIZE[size] ?? SIZE.md;

  let bg = t.subtle;
  let fg = t.main;
  let border = "transparent";
  if (variant === "solid") {
    bg = t.main;
    fg = t.contrast;
  } else if (variant === "outlined") {
    bg = "transparent";
    fg = t.main;
    border = t.border;
  } else if (variant === "ghost") {
    bg = "transparent";
    fg = t.main;
  }

  return (
    <span
      role={onClick ? "button" : undefined}
      onClick={onClick}
      tabIndex={onClick ? 0 : undefined}
      data-testid={testId}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: s.gap,
        height: s.h,
        paddingInline: s.px,
        borderRadius: theme.radii.full,
        backgroundColor: bg,
        color: fg,
        border: `1px solid ${border}`,
        fontSize: s.fz,
        fontWeight: 600,
        fontFamily: "inherit",
        letterSpacing: "0.01em",
        lineHeight: 1,
        cursor: onClick ? "pointer" : "default",
        whiteSpace: "nowrap",
      }}
      {...rest}
    >
      {icon && <span style={{ display: "inline-flex" }}>{icon}</span>}
      {label}
      {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(e);
          }}
          aria-label="Remove"
          data-testid={testId ? `${testId}-remove` : undefined}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: s.icon + 4,
            height: s.icon + 4,
            border: "none",
            borderRadius: theme.radii.full,
            background: "transparent",
            color: "inherit",
            cursor: "pointer",
            padding: 0,
            marginLeft: 2,
            opacity: 0.7,
          }}
        >
          <X size={s.icon - 2} />
        </button>
      )}
    </span>
  );
}
