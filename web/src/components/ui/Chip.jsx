import { useTheme } from "@mui/material/styles";
import { X } from "lucide-react";
import { rem } from "../../utils/rem";

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
      // A span with role="button" gets no key handling for free, so without
      // this a keyboard user can focus a clickable chip and never activate it.
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              onClick(e);
            }
          : undefined
      }
      data-testid={testId}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: rem(s.gap),
        height: rem(s.h),
        paddingInline: rem(s.px),
        borderRadius: theme.radii.full,
        backgroundColor: bg,
        color: fg,
        border: `1px solid ${border}`,
        fontSize: rem(s.fz),
        fontWeight: 600,
        fontFamily: "inherit",
        letterSpacing: "0.01em",
        lineHeight: 1,
        cursor: onClick ? "pointer" : "default",
        whiteSpace: "nowrap",
        // Lookup and status labels are company-editable, so there is no length
        // a designer can rely on. The cap goes on the root; the truncation
        // goes on the label below, NOT here — `text-overflow` applies to block
        // containers, and this is a flex container, so setting it here draws
        // no ellipsis at all. `overflow: hidden` here would still bite, and it
        // bites in the worst way: a hard mid-letter clip, plus the trailing
        // delete button as the first child pushed out of view.
        maxWidth: "100%",
      }}
      {...rest}
    >
      {icon && <span style={{ display: "inline-flex", flexShrink: 0 }}>{icon}</span>}
      {/* The truncation lives on the flex ITEM, where blockification makes it
          a block container and the ellipsis actually draws — the same shape
          ui/Menu uses. `minWidth: 0` is what lets it shrink at all, so the
          delete button beside it keeps its place instead of being cut off. */}
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
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
            width: rem(s.icon + 4),
            height: rem(s.icon + 4),
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
