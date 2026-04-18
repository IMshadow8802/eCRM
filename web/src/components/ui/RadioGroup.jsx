import { useTheme } from "@mui/material/styles";
import { motion } from "framer-motion";

import { motion as motionTokens } from "../../styles/tokens";

/**
 * Pill-style RadioGroup. Takes options array and controls selection.
 *
 * Props:
 *   value, onChange(value), options: [{value, label, icon?}], orientation: row|col,
 *   size: sm|md|lg, name, disabled
 */

const SIZE = {
  sm: { h: 30, fz: 13, px: 10 },
  md: { h: 36, fz: 14, px: 14 },
  lg: { h: 44, fz: 15, px: 18 },
};

export default function RadioGroup({
  value,
  onChange,
  options = [],
  orientation = "row",
  size = "md",
  name,
  disabled = false,
  "data-testid": testId,
}) {
  const theme = useTheme();
  const p = theme.tokens;
  const s = SIZE[size] ?? SIZE.md;

  return (
    <div
      role="radiogroup"
      data-testid={testId}
      style={{
        display: "inline-flex",
        flexDirection: orientation === "row" ? "row" : "column",
        gap: 6,
        padding: 4,
        background: p.surface.subtle,
        borderRadius: theme.radii.md,
        border: `1px solid ${p.border.default}`,
      }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        const optDisabled = disabled || opt.disabled;
        return (
          <motion.button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-disabled={optDisabled}
            disabled={optDisabled}
            onClick={() => !optDisabled && onChange?.(opt.value)}
            whileTap={optDisabled ? undefined : { scale: 0.98 }}
            transition={{
              duration: motionTokens.duration.base / 1000,
              ease: [0.4, 0, 0.2, 1],
            }}
            data-testid={testId ? `${testId}-${opt.value}` : undefined}
            style={{
              position: "relative",
              minHeight: s.h,
              paddingInline: s.px,
              fontSize: s.fz,
              fontWeight: 600,
              fontFamily: "inherit",
              border: "none",
              borderRadius: theme.radii.sm,
              cursor: optDisabled ? "not-allowed" : "pointer",
              opacity: optDisabled ? 0.5 : 1,
              background: active ? p.surface.card : "transparent",
              color: active ? p.primary.main : p.text.secondary,
              boxShadow: active ? p.shadow.sm : "none",
              outline: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              transition: `background-color ${motionTokens.duration.base}ms ${motionTokens.easing.standard}, color ${motionTokens.duration.base}ms ${motionTokens.easing.standard}`,
            }}
            data-name={name}
          >
            {opt.icon && <span style={{ display: "inline-flex" }}>{opt.icon}</span>}
            {opt.label}
          </motion.button>
        );
      })}
    </div>
  );
}
