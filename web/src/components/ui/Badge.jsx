import { useTheme } from "@mui/material/styles";
import { motion } from "framer-motion";

/**
 * Badge — dot or count indicator. Wrap with children (e.g., an icon)
 * and badge renders absolutely positioned top-right.
 *
 * variant: dot | numeric
 * pulse: ring pulse animation (for new notifications)
 */
export default function Badge({
  children,
  count = 0,
  max = 99,
  variant = "numeric",
  tone = "error",
  pulse = false,
  show = true,
  "data-testid": testId,
}) {
  const theme = useTheme();
  const p = theme.tokens;
  const color = p[tone] ?? p.error;
  const display = count > max ? `${max}+` : String(count);
  const visible = show && (variant === "dot" || count > 0);

  return (
    <span style={{ position: "relative", display: "inline-flex" }} data-testid={testId}>
      {children}
      {visible && (
        <span
          aria-live="polite"
          aria-atomic="true"
          style={{
            position: "absolute",
            top: variant === "dot" ? -2 : -6,
            right: variant === "dot" ? -2 : -8,
            pointerEvents: "none",
          }}
        >
          {pulse && (
            <motion.span
              aria-hidden="true"
              initial={{ opacity: 0.5, scale: 1 }}
              animate={{ opacity: 0, scale: 2.4 }}
              transition={{
                duration: 1.4,
                repeat: Infinity,
                ease: "easeOut",
              }}
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: theme.radii.full,
                background: color.main,
              }}
            />
          )}
          <span
            style={{
              position: "relative",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: variant === "dot" ? 8 : 16,
              height: variant === "dot" ? 8 : 16,
              paddingInline: variant === "dot" ? 0 : 4,
              borderRadius: theme.radii.full,
              backgroundColor: color.main,
              color: color.contrastText,
              fontSize: 10,
              fontWeight: 700,
              lineHeight: 1,
              border: `2px solid ${p.surface.card}`,
            }}
          >
            {variant === "numeric" ? display : ""}
          </span>
        </span>
      )}
    </span>
  );
}
