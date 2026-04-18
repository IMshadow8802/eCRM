import { forwardRef } from "react";
import { motion } from "framer-motion";
import { useTheme } from "@mui/material/styles";
import CircularProgress from "@mui/material/CircularProgress";

import { motion as motionTokens } from "../../styles/tokens";

/**
 * Unified Button primitive. Replaces ActionButton, CustomButton, raw <Button>.
 *
 * Variants:
 *   primary      — brand gradient, hero CTA
 *   secondary    — solid accent color
 *   tonal        — subtle colored background, primary text
 *   ghost        — transparent, colored text, hover fills tonal
 *   destructive  — red solid
 *   text         — no background, colored text, minimal
 *
 * Sizes: sm (30) / md (36) / lg (44) — matches theme MuiButton heights.
 */

const SIZE_STYLES = {
  sm: { minHeight: 30, paddingInline: 12, fontSize: 13, gap: 6 },
  md: { minHeight: 36, paddingInline: 16, fontSize: 14, gap: 8 },
  lg: { minHeight: 44, paddingInline: 20, fontSize: 15, gap: 10 },
};

function variantStyles(variant, tokens) {
  const p = tokens;
  switch (variant) {
    case "primary":
      return {
        background: p.primary.main,
        color: p.primary.contrastText,
        boxShadow: p.shadow.xs,
        hover: { background: p.primary.hover, boxShadow: p.shadow.sm },
      };
    case "hero":
      return {
        background: p.gradient.heroCTA,
        color: "#FFFFFF",
        boxShadow: p.shadow.sm,
        hover: { background: p.gradient.heroCTAHover, boxShadow: p.shadow.md },
      };
    case "secondary":
      return {
        background: p.accent.main,
        color: p.accent.contrastText,
        hover: { background: p.accent.hover, boxShadow: p.shadow.sm },
      };
    case "tonal":
      return {
        background: p.primary.subtle,
        color: p.primary.main,
        hover: { background: p.primary.border, color: p.primary.hover },
      };
    case "ghost":
      return {
        background: "transparent",
        color: p.text.primary,
        hover: {
          background:
            p.mode === "dark" ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.04)",
        },
      };
    case "destructive":
      return {
        background: p.error.main,
        color: p.error.contrastText,
        hover: { background: p.error.hover, boxShadow: p.shadow.md },
      };
    case "text":
      return {
        background: "transparent",
        color: p.primary.main,
        hover: { color: p.primary.hover },
      };
    default:
      return {
        background: p.primary.main,
        color: p.primary.contrastText,
        hover: { background: p.primary.hover },
      };
  }
}

const Button = forwardRef(function Button(
  {
    variant = "primary",
    size = "md",
    leftIcon,
    rightIcon,
    loading = false,
    disabled = false,
    fullWidth = false,
    children,
    onClick,
    type = "button",
    "data-testid": testId,
    sx,
    className,
    ...rest
  },
  ref,
) {
  const theme = useTheme();
  const sz = SIZE_STYLES[size] ?? SIZE_STYLES.md;
  const v = variantStyles(variant, theme.tokens);
  const isDisabled = disabled || loading;

  return (
    <motion.button
      ref={ref}
      type={type}
      onClick={isDisabled ? undefined : onClick}
      aria-disabled={isDisabled}
      aria-busy={loading || undefined}
      disabled={isDisabled}
      data-testid={testId}
      whileTap={isDisabled ? undefined : { scale: 0.99 }}
      whileHover={
        isDisabled ? undefined : { backgroundColor: v.hover?.background }
      }
      transition={{
        duration: motionTokens.duration.base / 1000,
        ease: [0.4, 0, 0.2, 1],
      }}
      className={className}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: sz.gap,
        minHeight: sz.minHeight,
        paddingInline: sz.paddingInline,
        fontSize: sz.fontSize,
        lineHeight: 1,
        fontWeight: 600,
        fontFamily: theme.tokens.fontFamilies.sans,
        borderRadius: theme.radii.md,
        border: "none",
        cursor: isDisabled ? "not-allowed" : "pointer",
        opacity: isDisabled && !loading ? 0.5 : 1,
        width: fullWidth ? "100%" : "auto",
        transition: `box-shadow ${motionTokens.duration.slow}ms ${motionTokens.easing.standard}`,
        background: v.background,
        color: v.color,
        boxShadow: v.boxShadow ?? "none",
        outline: "none",
        ...(typeof sx === "object" ? sx : {}),
      }}
      {...rest}
    >
      {loading && (
        <CircularProgress
          size={sz.fontSize}
          thickness={5}
          sx={{
            color: v.color,
            position: "absolute",
            left: sz.paddingInline,
          }}
          data-testid={testId ? `${testId}-spinner` : undefined}
        />
      )}
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: sz.gap,
          visibility: loading ? "hidden" : "visible",
        }}
      >
        {leftIcon && <span style={{ display: "inline-flex" }}>{leftIcon}</span>}
        {children}
        {rightIcon && (
          <span style={{ display: "inline-flex" }}>{rightIcon}</span>
        )}
      </span>
    </motion.button>
  );
});

export default Button;
