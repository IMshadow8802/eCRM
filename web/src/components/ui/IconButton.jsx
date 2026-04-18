import { forwardRef } from "react";
import { motion } from "framer-motion";
import { useTheme } from "@mui/material/styles";
import Tooltip from "@mui/material/Tooltip";

import { motion as motionTokens } from "../../styles/tokens";

const SIZE = {
  sm: { btn: 28, icon: 14 },
  md: { btn: 36, icon: 18 },
  lg: { btn: 44, icon: 22 },
};

function variantStyles(variant, tokens) {
  const p = tokens;
  switch (variant) {
    case "tonal":
      return {
        background: p.primary.subtle,
        color: p.primary.main,
        hoverBg: p.primary.border,
      };
    case "destructive":
      return {
        background: "transparent",
        color: p.error.main,
        hoverBg: p.error.subtle,
      };
    case "solid":
      return {
        background: p.primary.main,
        color: p.primary.contrastText,
        hoverBg: p.primary.hover,
      };
    case "ghost":
    default:
      return {
        background: "transparent",
        color: p.text.secondary,
        hoverBg:
          p.mode === "dark"
            ? "rgba(255,255,255,0.06)"
            : "rgba(15,23,42,0.04)",
      };
  }
}

const IconButton = forwardRef(function IconButton(
  {
    children,
    variant = "ghost",
    size = "md",
    tooltip,
    tooltipPlacement = "bottom",
    onClick,
    disabled = false,
    type = "button",
    "data-testid": testId,
    "aria-label": ariaLabel,
    ...rest
  },
  ref,
) {
  const theme = useTheme();
  const s = SIZE[size] ?? SIZE.md;
  const v = variantStyles(variant, theme.tokens);

  const btn = (
    <motion.button
      ref={ref}
      type={type}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-disabled={disabled}
      aria-label={ariaLabel || tooltip}
      data-testid={testId}
      whileTap={disabled ? undefined : { scale: 0.94 }}
      whileHover={disabled ? undefined : { backgroundColor: v.hoverBg }}
      transition={{
        duration: motionTokens.duration.base / 1000,
        ease: [0.4, 0, 0.2, 1],
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: s.btn,
        height: s.btn,
        borderRadius: theme.radii.md,
        background: v.background,
        color: v.color,
        border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        outline: "none",
        transition: `background-color ${motionTokens.duration.slow}ms ${motionTokens.easing.standard}`,
      }}
      {...rest}
    >
      <span style={{ display: "inline-flex", width: s.icon, height: s.icon }}>
        {children}
      </span>
    </motion.button>
  );

  return tooltip ? (
    <Tooltip title={tooltip} placement={tooltipPlacement} arrow>
      {btn}
    </Tooltip>
  ) : (
    btn
  );
});

export default IconButton;
