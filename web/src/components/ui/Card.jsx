import { forwardRef } from "react";
import { motion } from "framer-motion";
import { useTheme } from "@mui/material/styles";

import { motion as motionTokens } from "../../styles/tokens";

/**
 * Card — container surface. Defaults to padding, rounded-lg, soft shadow.
 * `interactive` adds hover lift. `variant=flat` removes shadow; `ghost`
 * removes border + shadow for subtle grouping.
 */
const Card = forwardRef(function Card(
  {
    children,
    variant = "default", // default | flat | ghost | outlined | gradient
    interactive = false,
    padding = "lg",
    onClick,
    className,
    sx,
    "data-testid": testId,
    ...rest
  },
  ref,
) {
  const theme = useTheme();
  const p = theme.tokens;

  const padMap = { none: 0, sm: 12, md: 16, lg: 20, xl: 28 };
  const pad = padMap[padding] ?? padMap.lg;

  let bg = p.surface.card;
  let border = `1px solid ${p.border.default}`;
  let shadow = p.shadow.sm;

  if (variant === "flat") {
    shadow = "none";
  } else if (variant === "ghost") {
    border = "none";
    shadow = "none";
    bg = p.surface.subtle;
  } else if (variant === "outlined") {
    shadow = "none";
  } else if (variant === "gradient") {
    bg = p.gradient.statAccent;
    border = "none";
  }

  const clickable = Boolean(onClick) || interactive;

  return (
    <motion.div
      ref={ref}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (!onClick) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(e);
        }
      }}
      whileHover={clickable ? { y: -2, boxShadow: p.shadow.md } : undefined}
      whileTap={clickable ? { scale: 0.995 } : undefined}
      transition={{
        duration: motionTokens.duration.base / 1000,
        ease: [0.4, 0, 0.2, 1],
      }}
      className={className}
      data-testid={testId}
      style={{
        position: "relative",
        padding: pad,
        borderRadius: theme.radii.lg,
        backgroundColor: bg,
        background: variant === "gradient" ? bg : undefined,
        border,
        boxShadow: shadow,
        cursor: clickable ? "pointer" : "default",
        color: variant === "gradient" ? "#FFFFFF" : p.text.primary,
        outline: "none",
        ...(typeof sx === "object" ? sx : {}),
      }}
      {...rest}
    >
      {children}
    </motion.div>
  );
});

export default Card;
